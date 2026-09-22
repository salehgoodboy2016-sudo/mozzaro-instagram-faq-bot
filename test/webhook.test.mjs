import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebhookServer, extractEvents } from '../src/webhook-server.mjs';

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
  const server = createWebhookServer({ verifyToken: 'test-token', enabled: false, appSecret: '' });
  await new Promise((resolve) => server.listen(0, resolve)); t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/webhooks/instagram`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ object: 'instagram', entry: [{ messaging: [{ sender: { id: 'customer-1' }, recipient: { id: 'business-1' }, message: { mid: `test-${Date.now()}`, text: 'هلا' } }] }] }),
  });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { received: true });
});
