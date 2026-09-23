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
    await this.pool.query(`INSERT INTO whatsapp_conversations (conversation_id, human_active, handoff_reason)
      VALUES ($1,$2,$3) ON CONFLICT (conversation_id) DO UPDATE SET
      human_active=$2, handoff_reason=$3, updated_at=now()`, [id, active, reason]);
  }

  async claimHumanHandoff(id, reason) {
    const result = await this.pool.query(`INSERT INTO whatsapp_conversations
      (conversation_id, human_active, handoff_reason) VALUES ($1,true,$2)
      ON CONFLICT (conversation_id) DO UPDATE SET human_active=true,
      handoff_reason=$2, updated_at=now()
      WHERE whatsapp_conversations.human_active=false
      RETURNING conversation_id`, [id, reason]);
    return result.rowCount === 1;
  }

  async recordEmployeeActivity(id, at) {
    await this.pool.query(`INSERT INTO whatsapp_conversations (conversation_id, human_active, handoff_reason, last_employee_at)
      VALUES ($1,true,'employee_activity',$2) ON CONFLICT (conversation_id) DO UPDATE SET
      human_active=true, handoff_reason='employee_activity',
      last_employee_at=GREATEST(COALESCE(whatsapp_conversations.last_employee_at, $2),$2), updated_at=now()`, [id, at]);
  }

  async recordCustomerActivity(id, at) {
    await this.pool.query(`INSERT INTO whatsapp_conversations (conversation_id, latest_customer_at)
      VALUES ($1,$2) ON CONFLICT (conversation_id) DO UPDATE SET
      latest_customer_at=GREATEST(COALESCE(whatsapp_conversations.latest_customer_at, $2),$2), updated_at=now()`, [id, at]);
  }

  async reserveSend(eventId, conversationId, eventAt) {
    const result = await this.pool.query(`UPDATE whatsapp_events SET outcome='send_reserved', updated_at=now()
      WHERE event_id=$1 AND outcome='received' AND NOT EXISTS (
        SELECT 1 FROM whatsapp_conversations WHERE conversation_id=$2 AND (
          human_active=true OR last_employee_at >= $3 OR latest_customer_at > $3
        )
      ) RETURNING event_id`, [eventId, conversationId, eventAt]);
    return result.rowCount === 1;
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
