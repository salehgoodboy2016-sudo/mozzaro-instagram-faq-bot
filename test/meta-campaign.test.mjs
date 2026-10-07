import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { newDb } from 'pg-mem';
import { MetaCampaignClient, buildMetaTemplatePayload } from '../src/meta-campaign-client.mjs';
import { MarketingStore } from '../src/marketing-store.mjs';
import { runMigrations } from '../src/db-migrations.mjs';
import { createWebhookServer } from '../src/webhook-server.mjs';

const IMAGE = 'https://mozzaro-instagram-faq-bot.onrender.com/marketing/mozzaro-focaccia-launch.png';

async function setup() {
  const database = newDb({ noAstCoverageCheck: true });
  const adapter = database.adapters.createPg(); const pool = new adapter.Pool();
  await runMigrations(pool, { advisoryLock: false });
  return { pool, store: new MarketingStore({ pool, rateUsd: 0.0107 }) };
}

async function createMetaDraft(store, pool, count = 2) {
  const consent = { consentStatus: 'yes', consentSource: 'Owner-confirmed existing customer marketing consent',
    consentAt: '2026-10-01T10:00:00Z', consentEvidence: 'owner-record' };
  await store.importRows({ rows: Array.from({ length: count }, (_, index) => ({
    phone: `05${String(index).padStart(8, '0')}`, visits: count - index,
    campaignSelectionRank: index + 1, bonatRowOrder: index + 1, ...consent,
  })), filename: 'ranked.xlsx', fileSha256: 'f'.repeat(64) });
  await store.syncTemplates([{ id: '1602094334735787', name: 'mozzaro_focaccia_launch_ar', language: 'ar',
    category: 'MARKETING', status: 'APPROVED' }]);
  const draft = await store.createCampaign({ name: 'فوكاتشا مباشر', templateId: '1602094334735787',
    provider: 'meta_direct' });
  const approved = await store.approveCampaign(draft.campaign_id);
  const contacts = await pool.query(`SELECT contact_id FROM marketing_campaign_recipients
    WHERE campaign_id=$1 ORDER BY selection_rank`, [draft.campaign_id]);
  return { campaign: approved, contacts: contacts.rows };
}

test('Meta Direct builds the approved Arabic image-template payload', () => {
  assert.deepEqual(buildMetaTemplatePayload({ to: '+966 54 538 3080',
    templateName: 'mozzaro_focaccia_launch_ar', language: 'ar', image: { link: IMAGE } }), {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '966545383080', type: 'template',
    template: { name: 'mozzaro_focaccia_launch_ar', language: { code: 'ar' }, components: [{
      type: 'header', parameters: [{ type: 'image', image: { link: IMAGE } }],
    }] },
  });
});

test('Meta Direct sending fails closed until its separate gate is enabled', async () => {
  let called = false;
  const client = new MetaCampaignClient({ token: 'secret-token', phoneNumberId: '816217614914860',
    businessAccountId: '4133548783569339', enabled: false, fetchImpl: async () => { called = true; } });
  await assert.rejects(client.sendTemplate({ to: '966545383080', templateName: 'mozzaro_focaccia_launch_ar',
    image: { link: IMAGE } }), /sending disabled/);
  assert.equal(called, false);
});

test('Meta Direct sends one approved template and never includes the access token in the body', async () => {
  let request;
  const client = new MetaCampaignClient({ token: 'secret-token', phoneNumberId: '816217614914860',
    businessAccountId: '4133548783569339', enabled: true, fetchImpl: async (url, options) => {
      request = { url, options }; return new Response(JSON.stringify({ messages: [{ id: 'wamid.test12345678' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    } });
  const result = await client.sendTemplate({ to: '966545383080', templateName: 'mozzaro_focaccia_launch_ar',
    language: 'ar', image: { link: IMAGE } });
  assert.equal(result.messageId, 'wamid.test12345678');
  assert.match(request.url, /816217614914860\/messages$/);
  assert.equal(request.options.headers.Authorization, 'Bearer secret-token');
  assert.doesNotMatch(request.options.body, /secret-token/);
  assert.equal(JSON.parse(request.options.body).type, 'template');
});

test('Meta Direct verifies the exact production phone and returns live quality and capacity tier', async () => {
  const client = new MetaCampaignClient({ token: 'secret-token', phoneNumberId: '816217614914860',
    businessAccountId: '4133548783569339', fetchImpl: async () => new Response(JSON.stringify({
      id: '816217614914860', display_phone_number: '+966 56 501 7314', verified_name: 'Mozzaro',
      quality_rating: 'GREEN', messaging_limit_tier: 'TIER_250',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }) });
  const status = await client.getPhoneNumberStatus();
  assert.equal(status.id, '816217614914860');
  assert.equal(status.quality_rating, 'GREEN');
  assert.equal(status.messaging_limit_tier, 'TIER_250');
});

test('one-time Meta test is recipient-locked and the request id cannot be reused', async () => {
  const { pool, store } = await setup(); const requestId = 'focaccia-direct-test-20261007';
  const first = await store.reserveMetaOneTimeTest({ requestId, recipient: '966545383080',
    templateName: 'mozzaro_focaccia_launch_ar', preflight: { templateApproved: true } });
  const second = await store.reserveMetaOneTimeTest({ requestId, recipient: '966545383080',
    templateName: 'mozzaro_focaccia_launch_ar', preflight: { templateApproved: true } });
  assert.equal(first.reserved, true); assert.equal(second.reserved, false);
  await assert.rejects(store.reserveMetaOneTimeTest({ requestId: 'wrong-recipient-test',
    recipient: '966500000000', templateName: 'mozzaro_focaccia_launch_ar', preflight: {} }), /Invalid/);
  const accepted = await store.finishMetaOneTimeTest({ requestId, status: 'accepted',
    messageId: 'wamid.once12345678' });
  assert.equal(accepted.status, 'accepted');
  assert.equal((await store.finishMetaOneTimeTest({ requestId, status: 'accepted',
    messageId: 'wamid.duplicate12345678' })), null);
  await pool.end();
});

test('Meta batch reservation preserves rank and rejects stale or excessive capacity', async () => {
  const { pool, store } = await setup();
  const { campaign } = await createMetaDraft(store, pool, 3);
  const now = new Date('2026-10-06T20:00:00Z');
  await assert.rejects(store.reserveMetaBatch({ campaignId: campaign.campaign_id, requestedCount: 2,
    limitUnique: 250, usedUnique: 249, observedAt: now, capacitySource: 'meta_live',
    ownerAuthorizationId: randomUUID(), now }), /capacity exceeded/);
  await assert.rejects(store.reserveMetaBatch({ campaignId: campaign.campaign_id, requestedCount: 1,
    limitUnique: 250, usedUnique: 0, observedAt: new Date(now - 600_000), capacitySource: 'meta_live',
    ownerAuthorizationId: randomUUID(), now }), /Invalid Meta capacity/);
  const batch = await store.reserveMetaBatch({ campaignId: campaign.campaign_id, requestedCount: 2,
    limitUnique: 250, usedUnique: 5, observedAt: now, capacitySource: 'meta_live',
    ownerAuthorizationId: randomUUID(), now });
  assert.equal(batch.status, 'reserved_disabled'); assert.equal(batch.reserved_count, 2);
  const ranks = await pool.query(`SELECT r.selection_rank FROM marketing_campaign_batch_recipients br
    JOIN marketing_campaign_recipients r USING (campaign_id,contact_id)
    WHERE br.batch_id=$1 ORDER BY br.selection_order`, [batch.batch_id]);
  assert.deepEqual(ranks.rows.map((row) => row.selection_rank), [1, 2]);
  await pool.end();
});

test('Meta statuses update only Meta Direct recipients and duplicate callbacks are idempotent', async () => {
  const { pool, store } = await setup(); const { campaign, contacts } = await createMetaDraft(store, pool, 1);
  await store.markMetaAccepted({ campaignId: campaign.campaign_id, contactId: contacts[0].contact_id,
    messageId: 'wamid.status12345678', at: new Date('2026-10-06T20:00:00Z') });
  const event = { kind: 'status', id: 'meta:status:1', providerMessageId: 'wamid.status12345678',
    status: 'delivered', at: new Date('2026-10-06T20:01:00Z') };
  await store.recordMetaEvents([event]); await store.recordMetaEvents([event]);
  const recipient = (await pool.query(`SELECT status,provider FROM marketing_campaign_recipients
    WHERE campaign_id=$1`, [campaign.campaign_id])).rows[0];
  assert.deepEqual(recipient, { status: 'delivered', provider: 'meta_direct' });
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM marketing_campaign_events
    WHERE provider_event_id='meta:status:1'`)).rows[0].count, 1);
  await pool.end();
});

test('direct Meta webhook is status-only while Kapso remains customer-service transport', async (t) => {
  const secret = 'whatsapp-app-secret'; let directAutomationCalls = 0; let kapsoCalls = 0; let captured = [];
  const server = createWebhookServer({ whatsappAppSecret: secret,
    whatsappService: { process: async () => { directAutomationCalls += 1; } },
    kapsoService: { processEvents: async () => { kapsoCalls += 1; } },
    marketingStore: { recordMetaEvents: async (events) => { captured = events; } } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages',
    value: { metadata: { phone_number_id: '816217614914860' }, messages: [{ id: 'wamid.inbound123',
      from: '966500000001', timestamp: '1791316800', type: 'text', text: { body: 'private' } }],
    statuses: [{ id: 'wamid.status12345678', status: 'delivered', timestamp: '1791316801' }] } }] }] });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/webhooks/whatsapp`, { method: 'POST',
    headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` }, body });
  assert.equal(response.status, 200); assert.equal(directAutomationCalls, 0); assert.equal(kapsoCalls, 0);
  assert.equal(captured.filter((event) => event.kind === 'status').length, 1);
  assert.equal(captured.filter((event) => event.kind === 'incoming').length, 1);
});
