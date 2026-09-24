import { createHash, randomUUID } from 'node:crypto';

export const DEFAULT_SAUDI_MARKETING_RATE_USD = 0.0107;

export function normalizeSaudiPhone(value) {
  let digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (digits.startsWith('00966')) digits = digits.slice(2);
  else if (digits.startsWith('05')) digits = `966${digits.slice(1)}`;
  else if (digits.startsWith('5') && digits.length === 9) digits = `966${digits}`;
  return /^9665[0-9]{8}$/.test(digits) ? digits : null;
}

export function validateConsentRow(row) {
  const phone = normalizeSaudiPhone(row.phone);
  if (!phone) return { accepted: false, reason: 'invalid_phone' };
  const affirmative = new Set(['yes', 'true', 'approved', 'opted_in', 'نعم', 'موافق', 'موافقة']);
  const status = String(row.consentStatus ?? '').trim().toLowerCase();
  if (!affirmative.has(status)) return { accepted: false, reason: 'consent_not_verified', phone };
  const source = String(row.consentSource ?? '').trim();
  const evidence = String(row.consentEvidence ?? '').trim();
  const consentAt = new Date(row.consentAt ?? '');
  if (!source || !evidence || !Number.isFinite(consentAt.getTime())) {
    return { accepted: false, reason: 'consent_documentation_incomplete', phone };
  }
  return { accepted: true, phone, displayName: String(row.displayName ?? '').trim() || null,
    consentSource: source, consentEvidence: evidence, consentAt };
}

function nullableDate(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function nullableNumber(value, { integer = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return integer ? Math.trunc(parsed) : parsed;
}

function baseContact(row, phone) {
  return { phone, displayName: String(row.displayName ?? '').trim() || null,
    profile: { source: 'bonat_report', registeredAt: nullableDate(row.registeredAt),
      visits: nullableNumber(row.visits, { integer: true }), loyaltyPoints: nullableNumber(row.loyaltyPoints),
      segment: String(row.segment ?? '').trim() || null } };
}

function batches(rows, size = 250) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

async function insertBatch(client, prefix, rows, suffix = '') {
  for (const batch of batches(rows)) {
    const values = []; const parameters = [];
    for (const row of batch) {
      values.push(`(${row.map((value) => { parameters.push(value); return `$${parameters.length}`; }).join(',')})`);
    }
    await client.query(`${prefix} VALUES ${values.join(',')} ${suffix}`, parameters);
  }
}

export function classifyImportRow(row) {
  const phone = normalizeSaudiPhone(row.phone);
  if (!phone) return { kind: 'rejected', reason: 'invalid_phone' };
  const common = baseContact(row, phone);
  const status = String(row.consentStatus ?? '').trim().toLowerCase();
  const negative = new Set(['no', 'false', 'opted_out', 'لا', 'غير موافق', 'مرفوض']);
  if (negative.has(status)) return { kind: 'opted_out', ...common };
  const consent = validateConsentRow(row);
  if (consent.accepted) return { kind: 'accepted', ...common, consentSource: consent.consentSource,
    consentEvidence: consent.consentEvidence, consentAt: consent.consentAt };
  return { kind: 'pending', ...common, reason: consent.reason };
}

export class MarketingStore {
  constructor({ pool, rateUsd = DEFAULT_SAUDI_MARKETING_RATE_USD }) {
    if (!pool) throw new Error('PostgreSQL pool is required');
    this.pool = pool;
    this.rateUsd = Number(rateUsd);
    if (!Number.isFinite(this.rateUsd) || this.rateUsd <= 0) throw new Error('Invalid marketing rate');
  }

  prepareRows(rows) {
    const seen = new Set(); const accepted = []; const pending = []; const optedOut = []; const rejected = [];
    for (const [index, row] of rows.entries()) {
      const result = classifyImportRow(row);
      if (result.kind === 'rejected') { rejected.push({ row: index + 2, reason: result.reason }); continue; }
      if (seen.has(result.phone)) { rejected.push({ row: index + 2, reason: 'duplicate_phone' }); continue; }
      seen.add(result.phone);
      if (result.kind === 'accepted') accepted.push(result);
      else if (result.kind === 'opted_out') optedOut.push(result);
      else pending.push(result);
    }
    return { accepted, pending, optedOut, rejected, totalRows: rows.length,
      duplicateRows: rejected.filter((row) => row.reason === 'duplicate_phone').length };
  }

  async importRows({ rows, filename, fileSha256 }) {
    const prepared = this.prepareRows(rows);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existingSuppressions = new Set((await client.query('SELECT phone_e164 FROM marketing_suppressions'))
        .rows.map((row) => row.phone_e164));
      await insertBatch(client, `INSERT INTO marketing_suppressions
        (phone_e164,reason,source,occurred_at)`, prepared.optedOut.map((row) =>
        [row.phone, 'source_marked_opt_out', `import:${filename}`, new Date()]),
      'ON CONFLICT (phone_e164) DO NOTHING');
      for (const row of prepared.optedOut) existingSuppressions.add(row.phone);

      const eligibleRows = prepared.accepted.filter((row) => !existingSuppressions.has(row.phone));
      const pendingRows = prepared.pending.filter((row) => !existingSuppressions.has(row.phone));
      const suppressedRows = [...prepared.accepted, ...prepared.pending, ...prepared.optedOut]
        .filter((row) => existingSuppressions.has(row.phone));
      const idFor = (phone) => createHash('sha256').update(`marketing:${phone}`).digest('hex');

      await insertBatch(client, `INSERT INTO marketing_contacts
        (contact_id,phone_e164,display_name,consent_status,consent_source,consent_at,consent_evidence)`,
      eligibleRows.map((row) => [idFor(row.phone), row.phone, row.displayName, 'opted_in', row.consentSource,
        row.consentAt, row.consentEvidence]), `ON CONFLICT (phone_e164) DO UPDATE SET
        display_name=COALESCE(EXCLUDED.display_name,marketing_contacts.display_name),consent_status='opted_in',
        consent_source=EXCLUDED.consent_source,consent_at=EXCLUDED.consent_at,
        consent_evidence=EXCLUDED.consent_evidence,updated_at=now()`);
      await insertBatch(client, `INSERT INTO marketing_contacts
        (contact_id,phone_e164,display_name,consent_status)`, pendingRows.map((row) =>
        [idFor(row.phone), row.phone, row.displayName, 'unknown']), `ON CONFLICT (phone_e164) DO UPDATE SET
        display_name=COALESCE(EXCLUDED.display_name,marketing_contacts.display_name),updated_at=now()`);
      await insertBatch(client, `INSERT INTO marketing_contacts
        (contact_id,phone_e164,display_name,consent_status)`, suppressedRows.map((row) =>
        [idFor(row.phone), row.phone, row.displayName, 'opted_out']), `ON CONFLICT (phone_e164) DO UPDATE SET
        display_name=COALESCE(EXCLUDED.display_name,marketing_contacts.display_name),consent_status='opted_out',
        consent_source=NULL,consent_at=NULL,consent_evidence=NULL,updated_at=now()`);

      const contactByPhone = new Map((await client.query('SELECT contact_id,phone_e164 FROM marketing_contacts'))
        .rows.map((row) => [row.phone_e164, row.contact_id]));
      const importedRows = [...eligibleRows, ...pendingRows, ...suppressedRows];
      await insertBatch(client, `INSERT INTO marketing_contact_profiles
        (contact_id,source,registered_at,visits,loyalty_points,segment)`, importedRows.map((row) =>
        [contactByPhone.get(row.phone), row.profile.source, row.profile.registeredAt, row.profile.visits,
          row.profile.loyaltyPoints, row.profile.segment]), `ON CONFLICT (contact_id) DO UPDATE SET
        source=EXCLUDED.source,registered_at=COALESCE(EXCLUDED.registered_at,marketing_contact_profiles.registered_at),
        visits=COALESCE(EXCLUDED.visits,marketing_contact_profiles.visits),
        loyalty_points=COALESCE(EXCLUDED.loyalty_points,marketing_contact_profiles.loyalty_points),
        segment=COALESCE(EXCLUDED.segment,marketing_contact_profiles.segment),updated_at=now()`);
      await insertBatch(client, `INSERT INTO marketing_consent_events
        (consent_event_id,contact_id,consent_status,source,evidence,occurred_at)`, eligibleRows.map((row) =>
        [randomUUID(), contactByPhone.get(row.phone), 'opted_in', row.consentSource, row.consentEvidence, row.consentAt]));

      const imported = importedRows.length; const eligible = eligibleRows.length; const pending = pendingRows.length;
      const optedOut = prepared.optedOut.length; const suppressed = suppressedRows.length;
      const importId = randomUUID();
      await client.query(`INSERT INTO marketing_imports
        (import_id,filename,file_sha256,total_rows,accepted_rows,rejected_rows,duplicate_rows,
          pending_rows,imported_rows,opted_out_rows)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [importId, filename, fileSha256, prepared.totalRows,
        eligible, prepared.rejected.length, prepared.duplicateRows, pending, imported, optedOut]);
      await client.query('COMMIT');
      return { importId, totalRows: prepared.totalRows, importedRows: imported, eligibleRows: eligible,
        pendingRows: pending, optedOutRows: optedOut, rejectedRows: prepared.rejected.length,
        duplicateRows: prepared.duplicateRows, suppressedRows: suppressed };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async suppress({ phone, reason, source, occurredAt = new Date() }) {
    const normalized = normalizeSaudiPhone(phone);
    if (!normalized || !reason || !source) throw new Error('Invalid suppression');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO marketing_suppressions (phone_e164,reason,source,occurred_at)
        VALUES ($1,$2,$3,$4) ON CONFLICT (phone_e164) DO NOTHING`, [normalized, reason, source, occurredAt]);
      const contact = await client.query(`UPDATE marketing_contacts SET consent_status='opted_out',updated_at=now()
        WHERE phone_e164=$1 RETURNING contact_id`, [normalized]);
      if (contact.rowCount) await client.query(`INSERT INTO marketing_consent_events
        (consent_event_id,contact_id,consent_status,source,evidence,occurred_at)
        VALUES ($1,$2,'opted_out',$3,$4,$5)`, [randomUUID(), contact.rows[0].contact_id, source, reason, occurredAt]);
      await client.query('COMMIT'); return { suppressed: true, phone: normalized };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async syncTemplates(templates) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE marketing_templates SET status='STALE',synced_at=now()");
      for (const item of templates) await client.query(`INSERT INTO marketing_templates
        (template_id,name,language,category,status,quality_rating,components,synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (template_id) DO UPDATE SET
        name=EXCLUDED.name,language=EXCLUDED.language,category=EXCLUDED.category,status=EXCLUDED.status,
        quality_rating=EXCLUDED.quality_rating,components=EXCLUDED.components,synced_at=now()`,
      [String(item.id), String(item.name), String(item.language), String(item.category), String(item.status),
        item.quality_rating ? String(item.quality_rating) : null, JSON.stringify(item.components || [])]);
      await client.query('COMMIT'); return { synced: templates.length };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async listTemplates() {
    return (await this.pool.query(`SELECT template_id,name,language,category,status,quality_rating,synced_at
      FROM marketing_templates ORDER BY name`)).rows;
  }

  async createCampaign({ name, templateId }) {
    if (!String(name || '').trim() || !templateId) throw new Error('Invalid campaign');
    const template = await this.pool.query(`SELECT 1 FROM marketing_templates
      WHERE template_id=$1 AND status='APPROVED' AND category='MARKETING'`, [templateId]);
    if (!template.rowCount) throw new Error('Approved marketing template required');
    const campaignId = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO marketing_campaigns (campaign_id,name,template_id,rate_usd)
        VALUES ($1,$2,$3,$4)`, [campaignId, name.trim(), templateId, this.rateUsd]);
      const eligible = await client.query(`SELECT c.contact_id FROM marketing_contacts c
        LEFT JOIN marketing_suppressions s ON s.phone_e164=c.phone_e164
        WHERE c.consent_status='opted_in' AND s.phone_e164 IS NULL`);
      for (const contact of eligible.rows) {
        const consent = await client.query(`SELECT consent_event_id FROM marketing_consent_events
          WHERE contact_id=$1 AND consent_status='opted_in'
          ORDER BY occurred_at DESC,recorded_at DESC LIMIT 1`, [contact.contact_id]);
        if (consent.rowCount) await client.query(`INSERT INTO marketing_campaign_recipients
          (campaign_id,contact_id,consent_event_id,estimated_cost_usd) VALUES ($1,$2,$3,$4)`,
        [campaignId, contact.contact_id, consent.rows[0].consent_event_id, this.rateUsd]);
      }
      const count = await client.query(`SELECT count(*)::int AS count FROM marketing_campaign_recipients
        WHERE campaign_id=$1`, [campaignId]);
      const recipients = Number(count.rows[0].count);
      await client.query(`UPDATE marketing_campaigns SET eligible_recipient_count=$2,
        estimated_cost_usd=$2*rate_usd,updated_at=now() WHERE campaign_id=$1`, [campaignId, recipients]);
      await client.query('COMMIT'); return this.getCampaign(campaignId);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async approveCampaign(campaignId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const campaign = await client.query(`SELECT campaign_id,template_id,eligible_recipient_count,
        estimated_cost_usd,status FROM marketing_campaigns WHERE campaign_id=$1 FOR UPDATE`, [campaignId]);
      if (!campaign.rowCount || campaign.rows[0].status !== 'draft') throw new Error('Campaign is not reviewable');
      const digest = createHash('sha256').update(JSON.stringify(campaign.rows[0])).digest('hex');
      await client.query(`UPDATE marketing_campaigns SET status='approved',owner_approved_at=now(),
        owner_approval_digest=$2,updated_at=now() WHERE campaign_id=$1`, [campaignId, digest]);
      await client.query(`INSERT INTO marketing_campaign_events
        (event_id,campaign_id,event_type,metadata) VALUES ($1,$2,'owner_approved',$3)`,
      [randomUUID(), campaignId, JSON.stringify({ digest, sendingEnabled: false })]);
      await client.query('COMMIT'); return this.getCampaign(campaignId);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async scheduleCampaign(campaignId, scheduledAt) {
    const at = new Date(scheduledAt);
    if (!Number.isFinite(at.getTime()) || at <= new Date()) throw new Error('Invalid schedule');
    const result = await this.pool.query(`UPDATE marketing_campaigns SET status='scheduled_disabled',
      scheduled_at=$2,updated_at=now() WHERE campaign_id=$1 AND status='approved' RETURNING *`, [campaignId, at]);
    if (!result.rowCount) throw new Error('Approved campaign required');
    return result.rows[0];
  }

  async getCampaign(id) {
    return (await this.pool.query('SELECT * FROM marketing_campaigns WHERE campaign_id=$1', [id])).rows[0] || null;
  }

  async recordKapsoEvents(events) {
    for (const event of events) {
      if (event.kind !== 'status' || !event.providerMessageId) continue;
      const mapping = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
      const status = mapping[event.status];
      if (!status) continue;
      const recipients = await this.pool.query(`UPDATE marketing_campaign_recipients SET status=$2,
        sent_at=CASE WHEN $2='sent' THEN COALESCE(sent_at,$3) ELSE sent_at END,
        delivered_at=CASE WHEN $2='delivered' THEN COALESCE(delivered_at,$3) ELSE delivered_at END,
        read_at=CASE WHEN $2='read' THEN COALESCE(read_at,$3) ELSE read_at END,
        error_category=CASE WHEN $2='failed' THEN 'provider_rejected' ELSE error_category END
        WHERE provider_message_id=$1 AND (($2='sent' AND status='eligible')
          OR ($2='delivered' AND status IN ('eligible','sent'))
          OR ($2='read' AND status IN ('eligible','sent','delivered'))
          OR ($2='failed' AND status IN ('eligible','sent')))
        RETURNING campaign_id,contact_id`,
      [event.providerMessageId, status, event.at || new Date()]);
      for (const row of recipients.rows) await this.pool.query(`INSERT INTO marketing_campaign_events
        (event_id,campaign_id,contact_id,event_type,provider_event_id,metadata)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [randomUUID(), row.campaign_id, row.contact_id,
        status, event.id, JSON.stringify({ source: 'kapso_webhook' })]);
    }
  }

  async dashboard() {
    const [contacts, pending, suppressed, campaigns, templates, imports] = await Promise.all([
      this.pool.query("SELECT count(*)::int AS count FROM marketing_contacts WHERE consent_status='opted_in'"),
      this.pool.query("SELECT count(*)::int AS count FROM marketing_contacts WHERE consent_status='unknown'"),
      this.pool.query('SELECT count(*)::int AS count FROM marketing_suppressions'),
      this.pool.query(`SELECT campaign_id,name,status,eligible_recipient_count,estimated_cost_usd,
        scheduled_at,owner_approved_at,created_at FROM marketing_campaigns ORDER BY created_at DESC LIMIT 50`),
      this.listTemplates(), this.pool.query('SELECT * FROM marketing_imports ORDER BY imported_at DESC LIMIT 20'),
    ]);
    return { eligibleContacts: contacts.rows[0].count, pendingContacts: pending.rows[0].count,
      suppressedContacts: suppressed.rows[0].count,
      campaigns: campaigns.rows, templates, imports: imports.rows, sendingEnabled: false, rateUsd: this.rateUsd };
  }
}
