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

  async recent(limit = 20) {
    const result = await this.pool.query(`SELECT e.event_type, e.outcome, e.created_at,
      e.conversation_id, c.human_active FROM whatsapp_events e
      LEFT JOIN whatsapp_conversations c ON c.conversation_id=e.conversation_id
      ORDER BY e.created_at DESC LIMIT $1`, [Math.min(limit, 50)]);
    return result.rows;
  }

  async close() { await this.pool.end(); }
}
