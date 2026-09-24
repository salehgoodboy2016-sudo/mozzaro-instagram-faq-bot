import assert from 'node:assert/strict';
import test from 'node:test';
import { newDb } from 'pg-mem';
import { runMigrations } from '../src/db-migrations.mjs';
import { MarketingStore, normalizeSaudiPhone } from '../src/marketing-store.mjs';
import { createWebhookServer } from '../src/webhook-server.mjs';
import { parseCustomerImport } from '../src/campaign-dashboard.mjs';

async function setup() {
  const database = newDb({ noAstCoverageCheck: true });
  const adapter = database.adapters.createPg(); const pool = new adapter.Pool();
  await runMigrations(pool, { advisoryLock: false });
  return { pool, store: new MarketingStore({ pool, rateUsd: 0.0107 }) };
}

test('Saudi numbers normalize consistently', () => {
  assert.equal(normalizeSaudiPhone('050 625 2549'), '966506252549');
  assert.equal(normalizeSaudiPhone('+966 50 625 2549'), '966506252549');
  assert.equal(normalizeSaudiPhone('00966506252549'), '966506252549');
  assert.equal(normalizeSaudiPhone('123'), null);
});

test('CSV imports preserve consent evidence without exposing it in preview', async () => {
  const csv = `phone,name,consent_status,consent_source,consent_at,consent_evidence\n"0506252549","عميل، موزارو",yes,checkout,2026-09-20T10:00:00Z,receipt-9\n`;
  const parsed = await parseCustomerImport({ filename: 'customers.csv', base64: Buffer.from(csv).toString('base64') });
  assert.equal(parsed.rows[0].displayName, 'عميل، موزارو');
  assert.equal(parsed.rows[0].consentEvidence, 'receipt-9');
  assert.match(parsed.fileSha256, /^[a-f0-9]{64}$/);
});

test('imports require documented consent, deduplicate, and preserve permanent suppression', async () => {
  const { pool, store } = await setup();
  const rows = [
    { phone: '0506252549', displayName: 'عميل', consentStatus: 'نعم', consentSource: 'نموذج المتجر',
      consentAt: '2026-09-20T10:00:00Z', consentEvidence: 'record-1' },
    { phone: '+966506252549', consentStatus: 'yes', consentSource: 'duplicate',
      consentAt: '2026-09-20T10:00:00Z', consentEvidence: 'record-2' },
    { phone: '0555555555', consentStatus: 'no', consentSource: 'none',
      consentAt: '2026-09-20T10:00:00Z', consentEvidence: 'record-3' },
  ];
  const first = await store.importRows({ rows, filename: 'customers.csv', fileSha256: 'a'.repeat(64) });
  assert.deepEqual({ accepted: first.acceptedRows, rejected: first.rejectedRows, duplicates: first.duplicateRows },
    { accepted: 1, rejected: 2, duplicates: 1 });
  await store.suppress({ phone: '0506252549', reason: 'طلب إيقاف الرسائل', source: 'whatsapp' });
  const second = await store.importRows({ rows: [rows[0]], filename: 'retry.csv', fileSha256: 'b'.repeat(64) });
  assert.equal(second.acceptedRows, 0); assert.equal(second.suppressedRows, 1);
  assert.equal((await store.dashboard()).eligibleContacts, 0);
  await pool.end();
});

test('campaign approval and scheduling never enable sending', async () => {
  const { pool, store } = await setup();
  await store.importRows({ rows: [{ phone: '0545383080', consentStatus: 'approved', consentSource: 'signed form',
    consentAt: '2026-09-20T10:00:00Z', consentEvidence: 'form-88' }], filename: 'one.csv', fileSha256: 'c'.repeat(64) });
  await store.syncTemplates([{ id: 'tpl-1', name: 'offer_ar', language: 'ar', category: 'MARKETING', status: 'APPROVED' }]);
  const draft = await store.createCampaign({ name: 'تجربة', templateId: 'tpl-1' });
  assert.equal(draft.eligible_recipient_count, 1); assert.equal(Number(draft.estimated_cost_usd), 0.0107);
  const approved = await store.approveCampaign(draft.campaign_id);
  assert.equal(approved.status, 'approved'); assert.equal(approved.sending_enabled, false);
  await pool.query(`UPDATE marketing_campaign_recipients SET provider_message_id='wamid.future-test',status='sent'
    WHERE campaign_id=$1`, [draft.campaign_id]);
  await store.recordKapsoEvents([{ kind: 'status', id: 'delivery-1', providerMessageId: 'wamid.future-test',
    status: 'delivered', at: new Date() }]);
  assert.equal((await pool.query(`SELECT status FROM marketing_campaign_recipients WHERE campaign_id=$1`,
    [draft.campaign_id])).rows[0].status, 'delivered');
  const scheduled = await store.scheduleCampaign(draft.campaign_id, new Date(Date.now() + 86_400_000));
  assert.equal(scheduled.status, 'scheduled_disabled'); assert.equal(scheduled.sending_enabled, false);
  assert.equal(typeof store.sendCampaign, 'undefined');
  await pool.end();
});

test('campaign dashboard APIs require authentication and expose no send route', async () => {
  const { pool, store } = await setup();
  const server = createWebhookServer({ adminApiToken: 'owner-token', marketingStore: store,
    campaignKapsoClient: { listApprovedMarketingTemplates: async () => [] } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/admin/campaigns`)).status, 200);
  assert.equal((await fetch(`${base}/admin/campaigns/api/summary`)).status, 401);
  const summary = await fetch(`${base}/admin/campaigns/api/summary`, { headers: { Authorization: 'Bearer owner-token' } });
  assert.equal(summary.status, 200); assert.equal((await summary.json()).sendingEnabled, false);
  const send = await fetch(`${base}/admin/campaigns/api/campaigns/00000000-0000-0000-0000-000000000000/send`,
    { method: 'POST', headers: { Authorization: 'Bearer owner-token' } });
  assert.equal(send.status, 404);
  await new Promise((resolve) => server.close(resolve)); await pool.end();
});
