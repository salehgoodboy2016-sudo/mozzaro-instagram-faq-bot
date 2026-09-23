import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebhookServer, extractEvents, isIncoming } from '../src/webhook-server.mjs';
import { createHmac } from 'node:crypto';

test('webhook event extraction keeps sender and ignores no content', () => {
  const events = extractEvents({ entry: [{ messaging: [
    { sender: { id: 'customer-1' }, recipient: { id: 'business-1' }, timestamp: 1, message: { mid: 'mid-1', text: 'هلا' } },
    { sender: { id: 'business-1' }, recipient: { id: 'customer-1' }, message: { mid: 'mid-2', text: 'echo', is_echo: true } },
  ] }] });
  assert.deepEqual(events, [
    { id: 'mid-1', text: 'هلا', senderId: 'customer-1', recipientId: 'business-1', timestamp: 1, isEcho: false },
    { id: 'mid-2', text: 'echo', senderId: 'business-1', recipientId: 'customer-1', timestamp: undefined, isEcho: true },
  ]);
});

test('webhook verification challenge', async (t) => {
  const server = createWebhookServer({ verifyToken: 'test-token' });
  await new Promise((resolve) => server.listen(0, resolve)); t.after(() => server.close());
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-token&hub.challenge=abc123`);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'abc123');
});

test('webhook rejects wrong verification token', async (t) => {
  const server = createWebhookServer({ verifyToken: 'test-token' });
  await new Promise((resolve) => server.listen(0, resolve)); t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/webhooks/instagram?hub.verify_token=wrong&hub.challenge=abc123`);
  assert.equal(response.status, 403);
});

test('webhook acknowledges incoming messages while auto replies are disabled', async (t) => {
  const server = createWebhookServer({ verifyToken: 'test-token', enabled: false, appSecret: 'test-secret' });
  await new Promise((resolve) => server.listen(0, resolve)); t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/webhooks/instagram`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', 'test-secret').update('{"object":"instagram","entry":[]}').digest('hex') },
    body: '{"object":"instagram","entry":[]}',
  });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { received: true });
});

test('WhatsApp webhook logs receipt counts without message or sender data', async (t) => {
  const secret = 'test-whatsapp-secret';
  const server = createWebhookServer({ whatsappAppSecret: secret });
  await new Promise((resolve) => server.listen(0, resolve)); t.after(() => server.close());
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{
    field: 'messages', value: { messages: [{ from: '+966500000000', text: { body: 'private test message' } }] },
  }] }] });
  const originalLog = console.log;
  let logged = '';
  console.log = (line) => { logged += line; };
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/webhooks/whatsapp`, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex'),
      }, body: payload,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
  } finally { console.log = originalLog; }
  assert.match(logged, /"service":"whatsapp-webhook"/);
  assert.match(logged, /"messageCount":1/);
  assert.doesNotMatch(logged, /private test message|\+966500000000/);
});

test('only incoming messages addressed to the configured business are accepted', () => {
  const event = { id: 'm', senderId: 'customer', recipientId: 'business' };
  assert.equal(isIncoming(event, 'business'), true);
  assert.equal(isIncoming({ ...event, isEcho: true }, 'business'), false);
  assert.equal(isIncoming({ ...event, senderId: 'business' }, 'business'), false);
  assert.equal(isIncoming({ ...event, recipientId: 'other' }, 'business'), false);
  assert.equal(isIncoming(event, ''), false);
});

test('rejects unsigned, forged and malformed signatures; fails closed without secret', async (t) => {
  for (const secret of ['', 'test-secret']) {
    const server = createWebhookServer({ appSecret: secret });
    await new Promise(resolve => server.listen(0, resolve)); t.after(() => server.close());
    for (const signature of ['', 'sha256=' + '0'.repeat(64), 'sha256=bad']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/webhooks/instagram`, {
        method: 'POST', headers: { 'x-hub-signature-256': signature }, body: '{}',
      });
      assert.equal(response.status, secret ? 401 : 503);
    }
  }
});
