import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { planWhatsAppReply, isOpenInRiyadh } from '../src/whatsapp-faq.mjs';
import { WhatsAppClient, MockWhatsAppClient } from '../src/whatsapp-client.mjs';
import { WhatsAppService, extractWhatsAppEvents } from '../src/whatsapp-service.mjs';
import { createWebhookServer, selfTestWhatsAppChallenge } from '../src/webhook-server.mjs';
import { buildCoexistenceLoginOptions, parseCoexistenceSession } from '../src/coexistence-signup.mjs';

const now = new Date('2026-09-23T19:00:00Z');
const phoneId = '816217614914860';
const sample = (text, id = 'wamid.test', at = '1790190000') => ({ object: 'whatsapp_business_account', entry: [{ changes: [
  { field: 'messages', value: { metadata: { phone_number_id: phoneId }, messages: [
    { id, from: '966500000001', timestamp: at, type: 'text', text: { body: text } },
  ] } },
] }] });

class MemoryStore {
  constructor() { this.events = new Map(); this.conversations = new Map(); }
  conversationId(phone, sender) { return createHmac('sha256', 'test-key').update(`${phone}:${sender}`).digest('hex'); }
  async recordEvent({ id, conversationId, type, at }) {
    if (this.events.has(id)) return false;
    this.events.set(id, { conversationId, type, at, outcome: 'received' }); return true;
  }
  async setOutcome(id, outcome) { this.events.get(id).outcome = outcome; }
  async getConversation(id) { return this.conversations.get(id) || null; }
  async setHuman(id, active, reason) { this.conversations.set(id, { ...(this.conversations.get(id) || {}), human_active: active, handoff_reason: reason }); }
  async claimHumanHandoff(id, reason) {
    if (this.conversations.get(id)?.human_active) return false;
    await this.setHuman(id, true, reason); return true;
  }
  async recordCustomerActivity(id, at) { this.conversations.set(id, { ...(this.conversations.get(id) || {}), latest_customer_at: at }); }
  async recordEmployeeActivity(id, at) { this.conversations.set(id, { ...(this.conversations.get(id) || {}), human_active: true, last_employee_at: at }); }
  async reserveSend(eventId, conversationId, eventAt) {
    const event = this.events.get(eventId), c = this.conversations.get(conversationId);
    if (event.outcome !== 'received' || c?.human_active || c?.last_employee_at >= eventAt || c?.latest_customer_at > eventAt) return false;
    event.outcome = 'send_reserved'; return true;
  }
  async recent() { return [...this.events.values()].map(({ type, outcome }) => ({ event_type: type, outcome })); }
}

test('approved Arabic greetings, suppliers, orders, catering, and combined questions', () => {
  assert.equal(planWhatsAppReply('السلام عليكم').reply, 'وعليكم السلام ورحمة الله وبركاته');
  assert.equal(planWhatsAppReply('أهلا').reply, 'أهلين');
  const combined = planWhatsAppReply('هلا من وين اللحم والبيبروني ومتى تفتحون؟');
  assert.match(combined.reply, /^أهلين /);
  assert.match(combined.reply, /الدجاج عندنا من ساديا، والبيبروني من أمريكانا/);
  assert.match(combined.reply, /12 ظهرًا إلى 3 صباحًا/);
  assert.equal((combined.reply.match(/أي خدمة ثانية؟/g) || []).length, 1);
  assert.doesNotMatch(planWhatsAppReply('هل الدجاج محلي؟').reply, /محلي ومن ساديا/);
  assert.match(planWhatsAppReply('أبي كيترنق وأبغى أطلب').reply, /0545383080.*0565017314/);
});

test('Riyadh opening hours continue after midnight and close at 03:00', () => {
  assert.equal(isOpenInRiyadh(new Date('2026-09-22T21:30:00Z')), true); // 00:30 local
  assert.equal(isOpenInRiyadh(new Date('2026-09-23T00:00:00Z')), false); // 03:00 local
  assert.equal(isOpenInRiyadh(new Date('2026-09-23T09:00:00Z')), true); // noon local
});

test('complaints and unknown questions require human attention and safe fallback', () => {
  assert.equal(planWhatsAppReply('طلبي ناقص وتأخر').reason, 'complaint');
  const unknown = planWhatsAppReply('هل عندكم خصومات اليوم؟');
  assert.equal(unknown.requiresHuman, true);
  assert.match(unknown.reply, /بنحوّل استفسارك للفريق/);
});

test('status events are not incoming messages', () => {
  const events = extractWhatsAppEvents({ entry: [{ changes: [{ field: 'messages', value: {
    statuses: [{ id: 'wamid.out', status: 'delivered', timestamp: '123' }],
  } }] }] });
  assert.deepEqual(events.map((event) => event.kind), ['status']);
});

test('persistent event IDs suppress retries and automation defaults off', async () => {
  const store = new MemoryStore();
  const client = new MockWhatsAppClient();
  const service = new WhatsAppService({ store, client, phoneNumberId: phoneId, now: () => now });
  assert.deepEqual((await service.process(sample('متى تفتحون؟', 'first', '1790190000'))).outcomes, { automation_disabled: 1 });
  assert.deepEqual((await service.process(sample('متى تفتحون؟', 'first', '1790190000'))).outcomes, { duplicate: 1 });
  assert.equal(client.sent.length, 0);
});

test('human takeover suppresses replies and can be resumed', async () => {
  const store = new MemoryStore(), client = new MockWhatsAppClient();
  const service = new WhatsAppService({ store, client, phoneNumberId: phoneId, enabled: true,
    coexistenceVerified: true, now: () => now });
  const id = store.conversationId(phoneId, '966500000001');
  await service.handoff(id, true);
  assert.deepEqual((await service.process(sample('متى تفتحون؟', 'human-1'))).outcomes, { human_active: 1 });
  await service.handoff(id, false);
  assert.deepEqual((await service.process(sample('متى تفتحون؟', 'human-2'))).outcomes, { sent: 1 });
  assert.equal(client.sent.length, 1);
});

test('unknown question gets one safe fallback and persistent handoff', async () => {
  const store = new MemoryStore(), client = new MockWhatsAppClient();
  const service = new WhatsAppService({ store, client, phoneNumberId: phoneId, enabled: true,
    coexistenceVerified: true, now: () => now });
  assert.deepEqual((await service.process(sample('هل عندكم خصومات اليوم؟', 'unknown-1'))).outcomes, { handoff_reply_sent: 1 });
  assert.deepEqual((await service.process(sample('وش أسعاركم؟', 'unknown-2'))).outcomes, { human_active: 1 });
  assert.equal(client.sent.length, 1);
});

test('late customer event after employee activity does not receive a reply', async () => {
  const store = new MemoryStore(), client = new MockWhatsAppClient();
  const service = new WhatsAppService({ store, client, phoneNumberId: phoneId, enabled: true,
    coexistenceVerified: true, now: () => now });
  await store.recordEmployeeActivity(store.conversationId(phoneId, '966500000001'), new Date('2026-09-23T18:00:00Z'));
  assert.deepEqual((await service.process(sample('متى تفتحون؟', 'late', '1790180000'))).outcomes, { before_employee_activity: 1 });
  assert.equal(client.sent.length, 0);
});

test('official Coexistence message echo activates human handoff without replying', async () => {
  const store = new MemoryStore(), client = new MockWhatsAppClient();
  const service = new WhatsAppService({ store, client, phoneNumberId: phoneId, enabled: true,
    coexistenceVerified: true, now: () => now });
  const echo = { entry: [{ changes: [{ field: 'smb_message_echoes', value: {
    metadata: { phone_number_id: phoneId }, message_echoes: [{
      id: 'wamid.employee', to: '966500000001', from: '966565017314', timestamp: '1790190000',
      type: 'text', text: { body: 'private employee reply' },
    }],
  } }] }] };
  assert.deepEqual((await service.process(echo)).outcomes, { employee_activity: 1 });
  assert.deepEqual((await service.process(sample('متى تفتحون؟', 'after-employee', '1790190001'))).outcomes, { human_active: 1 });
  assert.equal(client.sent.length, 0);
});

test('outbound transport enforces disabled state, service window, and API errors', async () => {
  const disabled = new WhatsAppClient({ token: 'test', phoneNumberId: phoneId });
  await assert.rejects(disabled.sendText({ to: '966500000001', text: 'hello', customerMessageAt: now }), /disabled/);
  const calls = [];
  const client = new WhatsAppClient({ token: 'test', phoneNumberId: phoneId, enabled: true,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: false, status: 429,
      headers: { get: () => '10' }, json: async () => ({ error: { code: 4 } }) }; } });
  await assert.rejects(client.sendText({ to: '966500000001', text: 'hello', customerMessageAt: new Date(now - 25 * 3600000), now }), /window/);
  assert.equal(calls.length, 0);
  await assert.rejects(client.sendText({ to: '966500000001', text: 'hello', customerMessageAt: now, now }), (error) => error.status === 429 && error.code === 4);
  assert.equal(calls.length, 1);
});

test('WhatsApp webhook rejects missing signature and malformed signed JSON without exposing content', async (t) => {
  const secret = 'test-secret';
  const server = createWebhookServer({ whatsappAppSecret: secret });
  await new Promise((resolve) => server.listen(0, resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/webhooks/whatsapp`;
  const unsigned = await fetch(url, { method: 'POST', body: '{}' });
  assert.equal(unsigned.status, 401);
  const body = 'not-json';
  const malformed = await fetch(url, { method: 'POST', body, headers: {
    'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
  } });
  assert.equal(malformed.status, 400);
});

test('admin preview requires its token and cannot activate automation', async (t) => {
  const server = createWebhookServer({ adminApiToken: 'admin-test', whatsappEnabled: false });
  await new Promise((resolve) => server.listen(0, resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/admin/whatsapp/status`)).status, 401);
  const response = await fetch(`${base}/admin/whatsapp/preview`, { method: 'POST',
    headers: { Authorization: 'Bearer admin-test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'متى تفتحون؟' }) });
  assert.equal(response.status, 200);
  assert.match((await response.json()).reply, /12 ظهرًا/);
  const status = await fetch(`${base}/admin/whatsapp/status`, { headers: { Authorization: 'Bearer admin-test' } });
  assert.equal((await status.json()).whatsappAutoReplyEnabled, false);
});

test('deployment challenge self-test checks configured token without logging it', async (t) => {
  const server = createWebhookServer({ whatsappVerifyToken: 'private-test-token' });
  await new Promise((resolve) => server.listen(0, resolve)); t.after(() => server.close());
  assert.equal(await selfTestWhatsAppChallenge(server.address().port, 'private-test-token'), true);
  assert.equal(await selfTestWhatsAppChallenge(server.address().port, 'wrong-token'), false);
});

test('prepared signup requests only Coexistence and validates Meta session origin and WABA', () => {
  assert.equal(buildCoexistenceLoginOptions('123').extras.featureType, 'whatsapp_business_app_onboarding');
  const data = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    data: { waba_id: '4133548783569339', phone_number_id: phoneId } };
  assert.equal(parseCoexistenceSession({ origin: 'https://www.facebook.com', data,
    expectedWabaId: '4133548783569339', expectedPhoneNumberId: phoneId }).completed, true);
  assert.throws(() => parseCoexistenceSession({ origin: 'https://evilfacebook.com', data,
    expectedWabaId: '4133548783569339', expectedPhoneNumberId: phoneId }), /Untrusted/);
  assert.throws(() => parseCoexistenceSession({ origin: 'https://www.facebook.com', data,
    expectedWabaId: 'different', expectedPhoneNumberId: phoneId }), /Unexpected WABA/);
});
