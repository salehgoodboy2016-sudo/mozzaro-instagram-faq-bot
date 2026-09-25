import { createHmac } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from './db-migrations.mjs';

// A database is required before WhatsApp automation can be enabled. Render's
// ordinary container filesystem does not survive redeploys and cannot provide
// reliable retry deduplication.
export class WhatsAppStore {
  constructor({ databaseUrl, identityKey, pool = null }) {
    if (!databaseUrl && !pool) throw new Error('WHATSAPP_DATABASE_URL is required');
    if (!identityKey) throw new Error('WHATSAPP_IDENTITY_KEY is required');
    this.identityKey = identityKey;
    this.pool = pool || new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 });
  }

  conversationId(phoneId, sender) {
    return createHmac('sha256', this.identityKey).update(`${phoneId}:${sender}`).digest('hex');
  }

  async initialize() {
    return runMigrations(this.pool);
  }

  async recordEvent({ id, conversationId, type, at }) {
    const result = await this.pool.query(
      `INSERT INTO whatsapp_events (event_id, conversation_id, event_type, outcome, event_at)
       VALUES ($1, $2, $3, 'received', $4) ON CONFLICT DO NOTHING`,
      [id, conversationId, type, at],
    );
    return result.rowCount === 1;
  }

  async setOutcome(id, outcome) {
    await this.pool.query('UPDATE whatsapp_events SET outcome=$2, updated_at=now() WHERE event_id=$1', [id, outcome]);
  }

  async getConversation(id) {
    const result = await this.pool.query('SELECT * FROM whatsapp_conversations WHERE conversation_id=$1', [id]);
    return result.rows[0] || null;
  }

  async setHuman(id, active, reason = null) {
    await this.pool.query(`INSERT INTO whatsapp_conversations
      (conversation_id, human_active, handoff_reason, handoff_protected, handoff_expires_at)
      VALUES ($1,$2,$3,$2,NULL) ON CONFLICT (conversation_id) DO UPDATE SET
      human_active=$2, handoff_reason=$3, handoff_protected=$2, handoff_expires_at=NULL, updated_at=now()`, [id, active, reason]);
  }

  // The event ledger makes a conversation resume one-shot across retries,
  // restarts, and overlapping deployments. Admin resumes carry a unique request id.
  async resumeConversationOnce(phoneId, sender, requestId = null) {
    if (sender !== '966545383080' || (requestId !== null && !/^[a-f0-9-]{36}$/i.test(String(requestId)))) {
      throw new Error('Invalid one-time resume request');
    }
    const conversationId = this.conversationId(phoneId, sender);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        'SELECT human_active FROM whatsapp_conversations WHERE conversation_id=$1 FOR UPDATE',
        [conversationId],
      );
      if (!existing.rowCount) {
        await client.query('ROLLBACK');
        return { outcome: 'not_found' };
      }

      const wasHumanActive = existing.rows[0].human_active === true;
      const operationId = `operator_resume:${requestId || conversationId}`;
      const inserted = await client.query(`INSERT INTO whatsapp_events
        (event_id, conversation_id, event_type, outcome, event_at)
        VALUES ($1,$2,'operator_resume','applied',now()) ON CONFLICT DO NOTHING RETURNING event_id`,
      [operationId, conversationId]);
      if (!inserted.rowCount) {
        await client.query('COMMIT');
        return { outcome: 'already_consumed' };
      }

      await client.query(`UPDATE whatsapp_conversations SET human_active=false,
        handoff_reason=NULL, handoff_protected=false, handoff_expires_at=NULL, updated_at=now() WHERE conversation_id=$1`, [conversationId]);
      await client.query('COMMIT');
      return { outcome: 'resumed', wasHumanActive };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // Owner-authorized bulk recovery for conversations that were left paused.
  // Pending inquiries are deliberately discarded so this operation never sends
  // stale or duplicate customer replies; only a future inbound message resumes AI.
  async resumeAllConversations(requestId) {
    if (!/^[a-f0-9-]{36}$/i.test(String(requestId || ''))) {
      throw new Error('Invalid bulk resume request');
    }
    const operationId = `operator_bulk_resume:${requestId}`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(`INSERT INTO whatsapp_events
        (event_id, conversation_id, event_type, outcome, event_at)
        VALUES ($1,NULL,'operator_bulk_resume','applied',now())
        ON CONFLICT DO NOTHING RETURNING event_id`, [operationId]);
      if (!inserted.rowCount) {
        await client.query('COMMIT');
        return { outcome: 'already_consumed', resumed: 0, clearedPending: 0 };
      }

      const pending = await client.query(`UPDATE whatsapp_events
        SET outcome='pending_cleared_by_operator',updated_at=now()
        WHERE event_id IN (SELECT event_id FROM whatsapp_pending_messages)
        RETURNING event_id`);
      await client.query('DELETE FROM whatsapp_pending_messages');
      const resumed = await client.query(`UPDATE whatsapp_conversations SET
        human_active=false,handoff_reason=NULL,handoff_protected=false,
        handoff_expires_at=NULL,updated_at=now()
        WHERE human_active=true RETURNING conversation_id`);
      await client.query('COMMIT');
      return { outcome: 'resumed', resumed: resumed.rowCount, clearedPending: pending.rowCount };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async claimHumanHandoff(id, reason) {
    const result = await this.pool.query(`INSERT INTO whatsapp_conversations
      (conversation_id, human_active, handoff_reason, handoff_protected, handoff_expires_at) VALUES ($1,true,$2,true,NULL)
      ON CONFLICT (conversation_id) DO UPDATE SET human_active=true,
      handoff_reason=$2, handoff_protected=true, handoff_expires_at=NULL, updated_at=now()
      WHERE whatsapp_conversations.human_active=false
      RETURNING conversation_id`, [id, reason]);
    return result.rowCount === 1;
  }

  async recordEmployeeActivity(id, at) {
    await this.pool.query(`INSERT INTO whatsapp_conversations
      (conversation_id, human_active, handoff_reason, last_employee_at, handoff_protected, handoff_expires_at)
      VALUES ($1,true,'employee_activity',$2,false,now()+interval '15 minutes')
      ON CONFLICT (conversation_id) DO UPDATE SET
      human_active=true,
      handoff_reason=CASE WHEN whatsapp_conversations.handoff_protected
        THEN whatsapp_conversations.handoff_reason ELSE 'employee_activity' END,
      last_employee_at=CASE WHEN whatsapp_conversations.last_employee_at IS NULL
        OR whatsapp_conversations.last_employee_at < $2::timestamptz THEN $2::timestamptz
        ELSE whatsapp_conversations.last_employee_at END,
      handoff_expires_at=CASE WHEN whatsapp_conversations.handoff_protected
        THEN NULL ELSE now()+interval '15 minutes' END,
      updated_at=now()`, [id, at]);
  }

  async queuePendingMessage(event, plan) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const conversation = await client.query(
        'SELECT human_active FROM whatsapp_conversations WHERE conversation_id=$1 FOR UPDATE', [event.conversationId]);
      if (!conversation.rows[0]?.human_active) { await client.query('ROLLBACK'); return false; }
      const protectedHandoff = plan.requiresHuman === true;
      const previous = await client.query('SELECT event_id FROM whatsapp_pending_messages WHERE conversation_id=$1', [event.conversationId]);
      if (previous.rowCount && previous.rows[0].event_id !== event.id) {
        await client.query(`UPDATE whatsapp_events SET outcome='pending_superseded',updated_at=now() WHERE event_id=$1`, [previous.rows[0].event_id]);
      }
      await client.query(`INSERT INTO whatsapp_pending_messages
        (conversation_id,event_id,sender,message_text,message_type,event_at,status,claimed_at,queued_at)
        VALUES ($1,$2,$3,$4,$5,$6,'pending',NULL,now())
        ON CONFLICT (conversation_id) DO UPDATE SET event_id=$2,sender=$3,message_text=$4,
          message_type=$5,event_at=$6,status='pending',claimed_at=NULL,queued_at=now()`,
      [event.conversationId, event.id, event.sender, event.text || '', event.type || 'text', event.at]);
      if (protectedHandoff) {
        await client.query(`UPDATE whatsapp_conversations SET handoff_protected=true,
          handoff_reason=$2,handoff_expires_at=NULL,updated_at=now() WHERE conversation_id=$1`,
        [event.conversationId, plan.reason || 'human_required']);
      }
      await client.query(`UPDATE whatsapp_events SET outcome='human_active_pending',updated_at=now() WHERE event_id=$1`, [event.id]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async claimExpiredHandoffs({ conversationId = null, limit = 50 } = {}) {
    const filter = conversationId ? 'AND c.conversation_id=$1' : '';
    const values = conversationId ? [conversationId, limit] : [limit];
    const limitParam = conversationId ? '$2' : '$1';
    const due = await this.pool.query(`SELECT DISTINCT c.conversation_id FROM whatsapp_conversations c
      LEFT JOIN whatsapp_pending_messages p ON p.conversation_id=c.conversation_id
      WHERE ((c.human_active=true AND c.handoff_protected=false AND c.handoff_reason='employee_activity'
        AND c.handoff_expires_at <= now()) OR (c.human_active=false AND p.status='processing'
        AND p.claimed_at < now()-interval '5 minutes')) ${filter}
      ORDER BY c.handoff_expires_at LIMIT ${limitParam}`, values);
    const claimed = [];
    for (const row of due.rows) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const resumed = await client.query(`UPDATE whatsapp_conversations SET human_active=false,
          handoff_reason=NULL,handoff_expires_at=NULL,updated_at=now()
          WHERE conversation_id=$1 AND human_active=true AND handoff_protected=false
          AND handoff_reason='employee_activity' AND handoff_expires_at <= now()
          RETURNING last_employee_at`, [row.conversation_id]);
        let timedOut = resumed.rowCount > 0;
        if (!timedOut) {
          const recoverable = await client.query(`SELECT p.event_id FROM whatsapp_pending_messages p
            JOIN whatsapp_conversations c ON c.conversation_id=p.conversation_id
            WHERE p.conversation_id=$1 AND p.status='processing' AND p.claimed_at < now()-interval '5 minutes'
              AND c.human_active=false`, [row.conversation_id]);
          if (!recoverable.rowCount) { await client.query('ROLLBACK'); continue; }
        }
        const pending = await client.query(`SELECT event_id,conversation_id,sender,message_text,message_type,event_at
          FROM whatsapp_pending_messages WHERE conversation_id=$1 AND
          (status='pending' OR (status='processing' AND claimed_at < now()-interval '5 minutes'))`, [row.conversation_id]);
        if (pending.rowCount) {
          const message = pending.rows[0];
          const claimedMessage = await client.query(`UPDATE whatsapp_pending_messages SET status='processing',claimed_at=now()
            WHERE conversation_id=$1 AND event_id=$2 AND (status='pending'
              OR (status='processing' AND claimed_at < now()-interval '5 minutes')) RETURNING event_id`,
          [message.conversation_id, message.event_id]);
          if (!claimedMessage.rowCount) { await client.query('ROLLBACK'); continue; }
          await client.query(`UPDATE whatsapp_events SET outcome='received',updated_at=now() WHERE event_id=$1`, [message.event_id]);
          claimed.push({ id: message.event_id, kind: 'incoming', phoneId: null, sender: message.sender,
            text: message.message_text, type: message.message_type, at: message.event_at,
            conversationId: message.conversation_id, pending: true });
        }
        if (timedOut) {
          const employeeAt = resumed.rows[0].last_employee_at;
          const auditId = `handoff_timeout:${row.conversation_id}:${new Date(employeeAt).toISOString()}`;
          await client.query(`INSERT INTO whatsapp_events(event_id,conversation_id,event_type,outcome,event_at)
            VALUES ($1,$2,'handoff_timeout','ai_resumed',now()) ON CONFLICT DO NOTHING`, [auditId, row.conversation_id]);
        }
        await client.query('COMMIT');
        if (timedOut) claimed.push({ kind: 'audit', conversationId: row.conversation_id, hadPending: pending.rowCount > 0 });
        else if (pending.rowCount) claimed.push({ kind: 'recovered', conversationId: row.conversation_id });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    }
    return claimed;
  }

  async completePendingMessage(eventId, outcome) {
    if (outcome === 'human_active_pending') return;
    await this.pool.query(`DELETE FROM whatsapp_pending_messages WHERE event_id=$1`, [eventId]);
  }

  async recordCustomerActivity(id, at) {
    await this.pool.query(`INSERT INTO whatsapp_conversations (conversation_id, latest_customer_at)
      VALUES ($1,$2) ON CONFLICT (conversation_id) DO UPDATE SET
      latest_customer_at=CASE WHEN whatsapp_conversations.latest_customer_at IS NULL
        OR whatsapp_conversations.latest_customer_at < $2::timestamptz THEN $2::timestamptz
        ELSE whatsapp_conversations.latest_customer_at END, updated_at=now()`, [id, at]);
  }

  async reserveSend(eventId, conversationId, eventAt) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const conversation = await client.query(`SELECT human_active,last_employee_at,latest_customer_at
        FROM whatsapp_conversations WHERE conversation_id=$1 FOR UPDATE`, [conversationId]);
      if (!conversation.rowCount || conversation.rows[0].human_active
        || (conversation.rows[0].last_employee_at && new Date(conversation.rows[0].last_employee_at) >= new Date(eventAt))
        || (conversation.rows[0].latest_customer_at && new Date(conversation.rows[0].latest_customer_at) > new Date(eventAt))) {
        await client.query('ROLLBACK'); return false;
      }
      // Echo events are persisted before the handoff state update. Checking the
      // event ledger here closes the Claude-preparation race at the final send
      // boundary, even if the echo transaction is still updating conversation state.
      const echo = await client.query(`SELECT 1 FROM whatsapp_events employee
        JOIN whatsapp_events customer ON customer.event_id=$1
        WHERE employee.conversation_id=$2 AND employee.event_type='employee_echo'
          AND employee.created_at > customer.created_at LIMIT 1`, [eventId, conversationId]);
      if (echo.rowCount) { await client.query('ROLLBACK'); return false; }
      const reserved = await client.query(`UPDATE whatsapp_events SET outcome='send_reserved',updated_at=now()
        WHERE event_id=$1 AND outcome='received' RETURNING event_id`, [eventId]);
      if (!reserved.rowCount) { await client.query('ROLLBACK'); return false; }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async getAiContext(conversationId) {
    await this.pool.query('DELETE FROM whatsapp_ai_context WHERE expires_at <= now()');
    const result = await this.pool.query(`SELECT turns FROM whatsapp_ai_context
      WHERE conversation_id=$1 AND expires_at > now()`, [conversationId]);
    return Array.isArray(result.rows[0]?.turns) ? result.rows[0].turns : [];
  }

  async appendAiContext(conversationId, userText, assistantText) {
    const previous = await this.getAiContext(conversationId);
    const turns = [...previous, { role: 'user', content: userText }, { role: 'assistant', content: assistantText }].slice(-6);
    await this.pool.query(`INSERT INTO whatsapp_ai_context (conversation_id, turns, expires_at)
      VALUES ($1,$2::jsonb,now()+interval '24 hours') ON CONFLICT (conversation_id) DO UPDATE SET
      turns=$2::jsonb, expires_at=now()+interval '24 hours', updated_at=now()`,
    [conversationId, JSON.stringify(turns)]);
  }

  async reserveAiBudget(eventId, estimateUsd, monthlyLimitUsd) {
    if (!monthlyLimitUsd || estimateUsd <= 0 || estimateUsd > monthlyLimitUsd) return false;
    const month = new Date().toISOString().slice(0, 7) + '-01';
    const current = await this.pool.query('SELECT reserved_usd,spent_usd FROM whatsapp_ai_budget WHERE month=$1::date', [month]);
    if (current.rowCount && Number(current.rows[0].reserved_usd) + Number(current.rows[0].spent_usd) + estimateUsd > monthlyLimitUsd) return false;
    const inserted = await this.pool.query(`INSERT INTO whatsapp_ai_budget(month,reserved_usd)
      VALUES ($1::date,$2) ON CONFLICT(month) DO UPDATE SET reserved_usd=whatsapp_ai_budget.reserved_usd+$2
      WHERE whatsapp_ai_budget.reserved_usd+whatsapp_ai_budget.spent_usd+$2 <= $3 RETURNING month`,
    [month, estimateUsd, monthlyLimitUsd]);
    if (inserted.rowCount !== 1) return false;
    const call = await this.pool.query(`INSERT INTO whatsapp_ai_calls(event_id,month,reserved_usd)
      VALUES ($1,$2::date,$3) ON CONFLICT DO NOTHING`, [eventId, month, estimateUsd]);
    if (call.rowCount !== 1) {
      await this.pool.query('UPDATE whatsapp_ai_budget SET reserved_usd=reserved_usd-$2 WHERE month=$1::date', [month, estimateUsd]);
      return false;
    }
    return true;
  }

  async recordAiUsage(eventId, actualUsd) {
    const updated = await this.pool.query(`UPDATE whatsapp_ai_calls SET actual_usd=$2
      WHERE event_id=$1 AND actual_usd IS NULL RETURNING month,reserved_usd`, [eventId, actualUsd]);
    if (updated.rowCount) await this.pool.query(`UPDATE whatsapp_ai_budget SET reserved_usd=GREATEST(reserved_usd-$2,0),
      spent_usd=spent_usd+$3 WHERE month=$1::date`, [updated.rows[0].month, updated.rows[0].reserved_usd, actualUsd]);
  }

  async getAiBudgetStatus() {
    const month = new Date().toISOString().slice(0, 7) + '-01';
    const result = await this.pool.query(`SELECT reserved_usd,spent_usd FROM whatsapp_ai_budget WHERE month=$1::date`, [month]);
    return { month, reservedUsd: Number(result.rows[0]?.reserved_usd || 0), spentUsd: Number(result.rows[0]?.spent_usd || 0) };
  }

  async recent(limit = 20) {
    const result = await this.pool.query(`SELECT e.event_type, e.outcome, e.created_at,
      e.conversation_id, c.human_active FROM whatsapp_events e
      LEFT JOIN whatsapp_conversations c ON c.conversation_id=e.conversation_id
      ORDER BY e.created_at DESC LIMIT $1`, [Math.min(limit, 50)]);
    return result.rows;
  }

  async verifyPersistence() {
    const eventId = 'system:storage-self-test-v1';
    const conversationId = this.conversationId('system', 'storage-self-test-v1');
    await this.recordEvent({ id: eventId, conversationId, type: 'self_test', at: new Date() });
    const duplicateRejected = !await this.recordEvent({
      id: eventId, conversationId, type: 'self_test', at: new Date(),
    });
    await this.setHuman(conversationId, true, 'storage_self_test');
    const handoffStored = (await this.getConversation(conversationId))?.human_active === true;
    await this.setHuman(conversationId, false, null);
    await this.setOutcome(eventId, 'storage_self_test_passed');
    if (!duplicateRejected || !handoffStored) throw new Error('WhatsApp persistent storage self-test failed');
    return { deduplication: true, humanHandoff: true };
  }

  async close() { await this.pool.end(); }
}
