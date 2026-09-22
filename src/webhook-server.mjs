import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { readFile } from 'node:fs/promises';
import { composeReply } from './faq.mjs';
import { StateStore } from './state-store.mjs';
import { InstagramClient } from './instagram-client.mjs';
import { extractStoryMentions, queueStoryMention } from './story-mentions.mjs';

// Deployment providers inject secrets through process.env. Merge the local
// .env file for development without ever requiring that file in production.
const env = {
  ...parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8').catch(() => '')),
  ...process.env,
};
const config = {
  port: Number(env.PORT || 3000),
  verifyToken: env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || '',
  appSecret: env.INSTAGRAM_WEBHOOK_APP_SECRET || '',
  accessToken: env.INSTAGRAM_ACCESS_TOKEN || '',
  accountId: env.INSTAGRAM_USER_ID || '',
  enabled: env.INSTAGRAM_AUTO_REPLY_ENABLED === 'true',
  stateFile: resolve(env.INSTAGRAM_STATE_FILE || './data/instagram-reply-state.json'),
  repeatCooldownMs: Number(env.INSTAGRAM_REPEAT_COOLDOWN_MS || 21600000),
  mentionReviewFile: env.INSTAGRAM_MENTION_REVIEW_FILE || './data/story-mention-review.jsonl',
  mentionRepostEnabled: env.INSTAGRAM_MENTION_REPOST_ENABLED === 'true',
  mentionReviewEnabled: env.INSTAGRAM_MENTION_REVIEW_ENABLED === 'true',
};
const store = new StateStore(config.stateFile, config.repeatCooldownMs);
await store.load();
const client = config.accessToken ? new InstagramClient({ token: config.accessToken, accountId: config.accountId }) : null;
const inflight = new Set();

function verifySignature(raw, signature, appSecret) {
  if (!appSecret || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', appSecret).update(raw).digest('hex');
  const actual = signature.slice(7);
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function extractEvents(payload) {
  const events = [];
  for (const entry of payload?.entry || []) {
    for (const item of entry.messaging || entry.messages || []) {
      const message = item.message || item;
      if (!message?.text && !message?.mid) continue;
      events.push({
        id: message.mid || item.message_id || item.id,
        text: message.text || '',
        senderId: item.sender?.id || message.from?.id,
        recipientId: item.recipient?.id || message.to?.id,
        timestamp: item.timestamp || message.created_time,
        isEcho: Boolean(message.is_echo || item.is_echo),
      });
    }
  }
  return events;
}

async function flagHuman(event, reason) {
  store.flagHuman({ messageId: event.id, senderId: event.senderId, reason });
  await store.save();
  await mkdir('./data', { recursive: true });
  await appendFile('./data/human-attention.jsonl', `${JSON.stringify({ messageId: event.id, senderId: event.senderId, reason, at: new Date().toISOString() })}\n`, { mode: 0o600 });
}

export function isIncoming(event, accountId) {
  return Boolean(accountId && event.id && event.senderId && !event.isEcho && event.senderId !== accountId && event.recipientId === accountId);
}

async function processEvent(event) {
  if (!isIncoming(event, config.accountId)) return { skipped: 'echo-or-invalid' };
  if (store.hasProcessed(event.id) || inflight.has(event.id)) return { skipped: 'duplicate' };
  inflight.add(event.id);
  try {
    const plan = composeReply(event.text, new Date());
    if (plan.requiresHuman) { await flagHuman(event, 'sensitive-or-complaint'); store.markProcessed(event.id); await store.save(); return { flagged: true }; }
    if (!plan.reply || !config.enabled || !client) { store.markProcessed(event.id); await store.save(); return { skipped: config.enabled ? 'no-reply' : 'disabled' }; }
    const conversationKey = `${event.senderId}:${event.recipientId || config.accountId}`;
    const allowedTopics = plan.topics.filter((topic) => store.canReply(conversationKey, topic));
    if (!allowedTopics.length && !plan.greeting) { store.markProcessed(event.id); await store.save(); return { skipped: 'repeat-suppressed' }; }
    const reply = composeReply(event.text, new Date(), allowedTopics).reply;
    await client.sendText(event.senderId, reply);
    for (const topic of allowedTopics) store.markTopicReply(conversationKey, topic);
    store.markProcessed(event.id); await store.save();
    return { replied: true };
  } finally { inflight.delete(event.id); }
}

export function createWebhookServer(overrides = {}) {
  const handlerConfig = { ...config, ...overrides };
  return createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, autoReplyEnabled: handlerConfig.enabled, mentionRepostEnabled: handlerConfig.mentionRepostEnabled })); return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/webhooks/instagram')) {
      const url = new URL(req.url, 'http://localhost');
      const valid = Boolean(handlerConfig.verifyToken) && url.searchParams.get('hub.mode') === 'subscribe' && Boolean(url.searchParams.get('hub.challenge')) && url.searchParams.get('hub.verify_token') === handlerConfig.verifyToken;
      res.writeHead(valid ? 200 : 403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(valid ? (url.searchParams.get('hub.challenge') || '') : 'Forbidden'); return;
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/webhooks/instagram')) { res.writeHead(404); res.end('Not found'); return; }
    if (!handlerConfig.appSecret) { res.writeHead(503); res.end('Webhook not configured'); return; }
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) { res.writeHead(413); res.end('Payload too large'); return; } chunks.push(chunk); }
    const raw = Buffer.concat(chunks);
    if (!verifySignature(raw, req.headers['x-hub-signature-256'], handlerConfig.appSecret)) { res.writeHead(401); res.end('Invalid signature'); return; }
    let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { res.writeHead(400); res.end('Invalid JSON'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ received: true }));
    // Review is independent of DM replies. Publishing is not implemented.
    for (const mention of handlerConfig.mentionReviewEnabled ? extractStoryMentions(payload, handlerConfig.accountId) : []) {
      queueStoryMention(mention, handlerConfig.mentionReviewFile).catch((error) => console.error(JSON.stringify({ mentionError: error.message })));
    }
    for (const event of extractEvents(payload)) processEvent(event).catch((error) => console.error(JSON.stringify({ webhookError: error.message, status: error.details?.status ?? null })));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const server = createWebhookServer();
  server.listen(config.port, () => console.log(JSON.stringify({ service: 'instagram-faq-webhook', port: config.port, autoReplyEnabled: config.enabled })));
}

export { composeReply, extractEvents, processEvent, config };
