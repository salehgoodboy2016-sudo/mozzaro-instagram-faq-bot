import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { KapsoClient } from '../src/kapso-client.mjs';
import { extractKapsoEvents, verifyKapsoSignature } from '../src/kapso-webhook.mjs';
import { createWebhookServer } from '../src/webhook-server.mjs';

const phoneId = '123456789012345';
const received = (id = 'wamid.123') => ({
  message: {
    id, timestamp: '1790190000', type: 'text', from: '966500000001', text: { body: 'متى تفتحون؟' },
    kapso: { direction: 'inbound', origin: 'cloud_api', content: 'متى تفتحون؟' },
  },
  conversation: { id: 'conv_1', phone_number: '966500000001', phone_number_id: phoneId },
  phone_number_id: phoneId,
});

test('Kapso signature verification uses the raw body and timing-safe HMAC', () => {
  const raw = Buffer.from('{"private":"message"}');
  const secret = 'kapso-test-secret';
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(verifyKapsoSignature(raw, signature, secret), true);
  assert.equal(verifyKapsoSignature(raw, '0'.repeat(64), secret), false);
  assert.equal(verifyKapsoSignature(raw, '', secret), false);
});

test('Kapso events normalize inbound, buffered, and Business App employee messages', () => {
  assert.deepEqual(extractKapsoEvents('whatsapp.message.received', received()).map((event) => event.kind), ['incoming']);
  const batch = { type: 'whatsapp.message.received', batch: true, data: [received('wamid.1'), received('wamid.2')] };
  assert.equal(extractKapsoEvents('whatsapp.message.received', batch).length, 2);
  const employee = received('wamid.employee');
  employee.message.kapso = { direction: 'outbound', origin: 'business_app' };
  employee.message.to = employee.message.from;
  delete employee.message.from;
  assert.deepEqual(extractKapsoEvents('whatsapp.message.sent', employee).map((event) => event.kind), ['employee_echo']);
  employee.message.kapso.origin = 'cloud_api';
  assert.deepEqual(extractKapsoEvents('whatsapp.message.sent', employee).map((event) => event.kind), ['status']);
});

test('Kapso webhook rejects invalid signatures and accepts signed events without exposing content', async (t) => {
  const secret = 'kapso-test-secret';
  const processed = [];
  const kapsoService = { processEvents: async (events) => { processed.push(...events); return { count: events.length, outcomes: { automation_disabled: events.length } }; } };
  const server = createWebhookServer({ kapsoWebhookSecret: secret, kapsoService, kapsoEnabled: false });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/webhooks/kapso`;
  const payload = JSON.stringify(received());
  assert.equal((await fetch(url, { method: 'POST', body: payload })).status, 401);

  const originalLog = console.log;
  let logged = '';
  console.log = (line) => { logged += line; };
  try {
    const response = await fetch(url, { method: 'POST', body: payload, headers: {
      'content-type': 'application/json',
      'x-webhook-event': 'whatsapp.message.received',
      'x-idempotency-key': 'retry-key',
      'x-webhook-signature': createHmac('sha256', secret).update(payload).digest('hex'),
    } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
  } finally { console.log = originalLog; }
  assert.equal(processed.length, 1);
  assert.match(logged, /"service":"kapso-webhook"/);
  assert.doesNotMatch(logged, /متى تفتحون|966500000001/);
});

test('Kapso outbound transport is disabled by default and uses only API-key authentication when enabled', async () => {
  const disabled = new KapsoClient({ apiKey: 'test', phoneNumberId: phoneId });
  await assert.rejects(disabled.sendText({ to: '966500000001', text: 'test', customerMessageAt: new Date() }), /disabled/);

  const calls = [];
  const now = new Date('2026-09-24T00:00:00Z');
  const client = new KapsoClient({ apiKey: 'private-test-key', phoneNumberId: phoneId, enabled: true,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200,
      headers: { get: () => null }, json: async () => ({ messages: [{ id: 'wamid.out' }] }) }; } });
  await client.sendText({ to: '966500000001', text: 'أهلين', customerMessageAt: now, now });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers['X-API-Key'], 'private-test-key');
  assert.doesNotMatch(calls[0].options.body, /private-test-key/);
});
