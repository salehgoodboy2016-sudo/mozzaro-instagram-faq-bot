import assert from 'node:assert/strict';
import test from 'node:test';
import { newDb } from 'pg-mem';
import { runMigrations } from '../src/db-migrations.mjs';
import { MarketingStore, normalizeSaudiPhone } from '../src/marketing-store.mjs';
import { createWebhookServer } from '../src/webhook-server.mjs';
import { campaignDashboardHtml, parseCustomerImport } from '../src/campaign-dashboard.mjs';
import { KapsoClient } from '../src/kapso-client.mjs';

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

test('Kapso template sync is read-only and keeps approved marketing templates only', async () => {
  let request;
  const client = new KapsoClient({ apiKey: 'secret-test-key', phoneNumberId: '816217614914860',
    fetchImpl: async (url, options) => { request = { url: String(url), options }; return new Response(JSON.stringify({ data: [
      { id: '1', name: 'approved', status: 'APPROVED', category: 'MARKETING' },
      { id: '2', name: 'pending', status: 'PENDING', category: 'MARKETING' },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } });
  const templates = await client.listApprovedMarketingTemplates({ businessAccountId: '4133548783569339' });
  assert.equal(templates.length, 1); assert.equal(request.options.method, undefined);
  assert.match(request.url, /4133548783569339\/message_templates/);
  assert.match(request.url, /status=APPROVED/); assert.match(request.url, /category=MARKETING/);
  assert.equal(request.options.body, undefined);
});

test('imports preserve pending contacts, require evidence for eligibility, deduplicate, and preserve suppression', async () => {
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
  assert.deepEqual({ eligible: first.eligibleRows, pending: first.pendingRows, optedOut: first.optedOutRows,
    rejected: first.rejectedRows, duplicates: first.duplicateRows },
  { eligible: 1, pending: 0, optedOut: 1, rejected: 1, duplicates: 1 });
  await store.suppress({ phone: '0506252549', reason: 'طلب إيقاف الرسائل', source: 'whatsapp' });
  const second = await store.importRows({ rows: [rows[0]], filename: 'retry.csv', fileSha256: 'b'.repeat(64) });
  assert.equal(second.eligibleRows, 0); assert.equal(second.suppressedRows, 1);
  assert.equal((await store.dashboard()).eligibleContacts, 0);
  await pool.end();
});

test('Bonat customer headers import profiles as pending without inventing marketing consent', async () => {
  const csv = 'Name,Phone Number,Registered Since,Visits,Points Balance,Segment\nعميل,0500000001,2026-01-02T10:00:00Z,7,12.5,عميل وفي\n';
  const parsed = await parseCustomerImport({ filename: 'bonat.csv', base64: Buffer.from(csv).toString('base64') });
  const { pool, store } = await setup();
  const preview = store.prepareRows(parsed.rows);
  assert.equal(preview.accepted.length, 0); assert.equal(preview.pending.length, 1);
  const result = await store.importRows({ ...parsed });
  assert.deepEqual({ imported: result.importedRows, pending: result.pendingRows, eligible: result.eligibleRows },
    { imported: 1, pending: 1, eligible: 0 });
  const profile = (await pool.query(`SELECT p.visits,p.loyalty_points,c.consent_status
    FROM marketing_contact_profiles p JOIN marketing_contacts c USING (contact_id)`)).rows[0];
  assert.equal(profile.visits, 7); assert.equal(Number(profile.loyalty_points), 12.5);
  assert.equal(profile.consent_status, 'unknown');
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

test('campaign dashboard inline script is syntactically valid', () => {
  const script = campaignDashboardHtml().match(/<script>([\s\S]*)<\/script>/)?.[1] ?? '';
  assert.doesNotThrow(() => new Function(script));
});
