import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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
import { planWhatsAppReply } from './whatsapp-faq.mjs';
import { WhatsAppStore } from './whatsapp-store.mjs';
import { WhatsAppService } from './whatsapp-service.mjs';
import { WhatsAppClient } from './whatsapp-client.mjs';

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
  whatsappVerifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
  whatsappAppSecret: env.WHATSAPP_WEBHOOK_APP_SECRET || '',
  whatsappEnabled: env.WHATSAPP_AUTO_REPLY_ENABLED === 'true' && env.WHATSAPP_LIVE_SEND_APPROVED === 'true',
  whatsappCoexistenceVerified: env.WHATSAPP_COEXISTENCE_VERIFIED === 'true',
  whatsappEmployeeEchoVerified: env.WHATSAPP_EMPLOYEE_ECHO_VERIFIED === 'true',
  whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '816217614914860',
  whatsappAccessToken: env.WHATSAPP_ACCESS_TOKEN || '',
  whatsappDatabaseUrl: env.WHATSAPP_DATABASE_URL || '',
  whatsappIdentityKey: env.WHATSAPP_IDENTITY_KEY || '',
  adminApiToken: env.MOZZARO_ADMIN_API_TOKEN || '',
};
const store = new StateStore(config.stateFile, config.repeatCooldownMs);
await store.load();
const client = config.accessToken ? new InstagramClient({ token: config.accessToken, accountId: config.accountId }) : null;
const inflight = new Set();
let lastWhatsAppRejectLogAt = 0;
let suppressedWhatsAppRejectLogs = 0;

function logWhatsAppReject(reason, payloadBytes) {
  const now = Date.now();
  if (now - lastWhatsAppRejectLogAt < 60_000) { suppressedWhatsAppRejectLogs += 1; return; }
  console.warn(JSON.stringify({
    service: 'whatsapp-webhook', outcome: 'rejected', reason,
    payloadBytes, suppressedSinceLastLog: suppressedWhatsAppRejectLogs,
  }));
  lastWhatsAppRejectLogAt = now;
  suppressedWhatsAppRejectLogs = 0;
}

function verifySignature(raw, signature, appSecret) {
  if (!appSecret || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', appSecret).update(raw).digest('hex');
  const actual = signature.slice(7);
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function safeTokenEqual(candidate, expected) {
  if (!candidate || !expected) return false;
  const actual = createHmac('sha256', 'mozzaro-admin').update(candidate).digest();
  const known = createHmac('sha256', 'mozzaro-admin').update(expected).digest();
  return timingSafeEqual(actual, known);
}

export async function selfTestWhatsAppChallenge(port, verifyToken, fetchImpl = fetch) {
  if (!verifyToken) return false;
  const challenge = randomBytes(16).toString('hex');
  const url = new URL(`http://127.0.0.1:${port}/webhooks/whatsapp`);
  url.searchParams.set('hub.mode', 'subscribe');
  url.searchParams.set('hub.verify_token', verifyToken);
  url.searchParams.set('hub.challenge', challenge);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
  return response.status === 200 && await response.text() === challenge;
}

async function readLimitedBody(req, maxBytes = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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
  const whatsappService = overrides.whatsappService || null;
  return createServer(async (req, res) => {
    try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        autoReplyEnabled: handlerConfig.enabled,
        mentionRepostEnabled: handlerConfig.mentionRepostEnabled,
        whatsappWebhookConfigured: Boolean(handlerConfig.whatsappVerifyToken && handlerConfig.whatsappAppSecret),
        whatsappAutoReplyEnabled: handlerConfig.whatsappEnabled,
      })); return;
    }
    if (new URL(req.url || '/', 'http://localhost').pathname.startsWith('/admin/whatsapp/')) {
      const authorized = safeTokenEqual((req.headers.authorization || '').replace(/^Bearer /i, ''), handlerConfig.adminApiToken);
      if (!authorized) { res.writeHead(401); res.end('Unauthorized'); return; }
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/admin/whatsapp/status') {
        const recent = whatsappService?.store ? await whatsappService.store.recent() : [];
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ whatsappAutoReplyEnabled: handlerConfig.whatsappEnabled,
          instagramAutoReplyEnabled: handlerConfig.enabled,
          coexistenceVerified: handlerConfig.whatsappCoexistenceVerified,
          persistentStoreReady: Boolean(whatsappService?.store), recent })); return;
      }
      if (req.method === 'POST' && ['preview', 'handoff'].includes(pathname.split('/').pop())) {
        const raw = await readLimitedBody(req);
        if (!raw) { res.writeHead(413); res.end('Payload too large'); return; }
        let body; try { body = JSON.parse(raw.toString('utf8')); } catch { res.writeHead(400); res.end('Invalid JSON'); return; }
        if (pathname.endsWith('/preview')) {
          if (typeof body.text !== 'string' || body.text.length > 4096) { res.writeHead(400); res.end('Invalid text'); return; }
          const plan = planWhatsAppReply(body.text);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ reply: plan.reply, requiresHuman: plan.requiresHuman, topics: plan.topics })); return;
        }
        if (!whatsappService?.store || !/^[a-f0-9]{64}$/.test(body.conversationId) || typeof body.active !== 'boolean') {
          res.writeHead(400); res.end('Invalid handoff'); return;
        }
        await whatsappService.handoff(body.conversationId, body.active);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ updated: true })); return;
      }
      res.writeHead(404); res.end('Not found'); return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/webhooks/instagram')) {
      const url = new URL(req.url, 'http://localhost');
      const valid = Boolean(handlerConfig.verifyToken) && url.searchParams.get('hub.mode') === 'subscribe' && Boolean(url.searchParams.get('hub.challenge')) && url.searchParams.get('hub.verify_token') === handlerConfig.verifyToken;
      res.writeHead(valid ? 200 : 403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(valid ? (url.searchParams.get('hub.challenge') || '') : 'Forbidden'); return;
    }
    if (req.method === 'GET' && new URL(req.url || '/', 'http://localhost').pathname === '/webhooks/whatsapp') {
      const url = new URL(req.url, 'http://localhost');
      const valid = Boolean(handlerConfig.whatsappVerifyToken)
        && url.searchParams.get('hub.mode') === 'subscribe'
        && Boolean(url.searchParams.get('hub.challenge'))
        && safeTokenEqual(url.searchParams.get('hub.verify_token'), handlerConfig.whatsappVerifyToken);
      res.writeHead(valid ? 200 : 403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(valid ? (url.searchParams.get('hub.challenge') || '') : 'Forbidden'); return;
    }
    const isInstagramPost = req.method === 'POST' && req.url?.startsWith('/webhooks/instagram');
    const isWhatsAppPost = req.method === 'POST' && new URL(req.url || '/', 'http://localhost').pathname === '/webhooks/whatsapp';
    if (!isInstagramPost && !isWhatsAppPost) { res.writeHead(404); res.end('Not found'); return; }
    if (isWhatsAppPost) {
      if (!handlerConfig.whatsappAppSecret) { res.writeHead(503); res.end('Webhook not configured'); return; }
      const raw = await readLimitedBody(req, 16 * 1024 * 1024);
      if (!raw) { res.writeHead(413); res.end('Payload too large'); return; }
      if (!verifySignature(raw, req.headers['x-hub-signature-256'], handlerConfig.whatsappAppSecret)) {
        logWhatsAppReject('invalid_signature', raw.length);
        res.writeHead(401); res.end('Invalid signature'); return;
      }
      let payload;
      try { payload = JSON.parse(raw.toString('utf8')); } catch {
        logWhatsAppReject('invalid_json', raw.length);
        res.writeHead(400); res.end('Invalid JSON'); return;
      }
      if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
        logWhatsAppReject('invalid_event_shape', raw.length);
        res.writeHead(400); res.end('Invalid WhatsApp event'); return;
      }
      const messageCount = payload.entry.reduce((total, entry) => total + (entry.changes || [])
        .filter((change) => change.field === 'messages')
        .reduce((count, change) => count + (Array.isArray(change.value?.messages) ? change.value.messages.length : 0), 0), 0);
      // Log only aggregate receipt metadata. Never write message text, sender IDs,
      // phone numbers, or the webhook payload to application logs.
      console.log(JSON.stringify({ service: 'whatsapp-webhook', received: true, entryCount: payload.entry.length, messageCount }));
      if (whatsappService) {
        try {
          const result = await whatsappService.process(payload);
          console.log(JSON.stringify({ service: 'whatsapp-automation', eventCount: result.count, outcomes: result.outcomes }));
        } catch {
          console.error(JSON.stringify({ service: 'whatsapp-automation', outcome: 'processing_failed' }));
          res.writeHead(503); res.end('Processing unavailable'); return;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true })); return;
    }
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
    } catch {
      console.error(JSON.stringify({ service: 'webhook', outcome: 'unexpected_error' }));
      if (!res.headersSent) { res.writeHead(503); res.end('Service unavailable'); }
      else if (!res.writableEnded) res.end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (config.whatsappEnabled && (!config.whatsappCoexistenceVerified || !config.whatsappEmployeeEchoVerified || !config.whatsappDatabaseUrl || !config.whatsappIdentityKey || !config.whatsappAccessToken)) {
    throw new Error('WhatsApp automation prerequisites are incomplete');
  }
  const whatsappStore = config.whatsappDatabaseUrl && config.whatsappIdentityKey
    ? new WhatsAppStore({ databaseUrl: config.whatsappDatabaseUrl, identityKey: config.whatsappIdentityKey }) : null;
  if (whatsappStore) await whatsappStore.initialize();
  const whatsappClient = new WhatsAppClient({ token: config.whatsappAccessToken,
    phoneNumberId: config.whatsappPhoneNumberId, enabled: config.whatsappEnabled && config.whatsappCoexistenceVerified });
  const whatsappService = new WhatsAppService({ store: whatsappStore, client: whatsappClient,
    enabled: config.whatsappEnabled, coexistenceVerified: config.whatsappCoexistenceVerified,
    phoneNumberId: config.whatsappPhoneNumberId });
  const server = createWebhookServer({ whatsappService });
  server.listen(config.port, () => {
    console.log(JSON.stringify({ service: 'mozzaro-webhook', port: config.port,
      instagramAutoReplyEnabled: config.enabled, whatsappAutoReplyEnabled: config.whatsappEnabled }));
    selfTestWhatsAppChallenge(config.port, config.whatsappVerifyToken)
      .then((accepted) => console.log(JSON.stringify({ service: 'whatsapp-webhook', challengeSelfTest: accepted ? 'passed' : 'failed' })))
      .catch(() => console.error(JSON.stringify({ service: 'whatsapp-webhook', challengeSelfTest: 'error' })));
  });
}

export { composeReply, extractEvents, processEvent, config };
