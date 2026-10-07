import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { WhatsAppStore } from '../src/whatsapp-store.mjs';
import { WhatsAppService, processingDiagnostic } from '../src/whatsapp-service.mjs';
import { KapsoClient } from '../src/kapso-client.mjs';

const url = process.env.WHATSAPP_TEST_DATABASE_URL;
const phoneId = '816217614914860';
test('real PostgreSQL processing, retry and outbound reservation regressions', { skip: !url }, async (t) => {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, '127.0.0.1', 'Only a local test database may be used');
  assert.equal(parsed.pathname, '/mozzaro_retry_test');
  const setup = new pg.Pool({ connectionString: url });
  await setup.query('CREATE SCHEMA retry_regressions');
  const pool = new pg.Pool({ connectionString: url, options: '-c search_path=retry_regressions', max: 10 });
  t.after(async () => { await pool.end(); await setup.query('DROP SCHEMA retry_regressions CASCADE'); await setup.end(); });
  const store = new WhatsAppStore({ pool, identityKey: 'local-regression-key' });
  await store.initialize();
  const calls = [];
  const client = new KapsoClient({ apiKey: 'mock-only', phoneNumberId: phoneId, enabled: true,
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: `mock-${calls.length}` }] }) };
    } });
  const service = new WhatsAppService({ store, client, enabled: true, phoneNumberId: phoneId,
    coexistenceVerified: true, allowAll: true, menuDocumentEnabled: true,
    menuDocumentUrl: 'https://example.test/official-menu.pdf' });
  let sequence = 0;
  const event = () => ({ kind: 'incoming', id: `incoming:wamid.regression-${++sequence}`,
    phoneId, sender: `966500000${String(sequence).padStart(3, '0')}`, at: new Date(), text: 'ممكن المنيو', type: 'text' });
  const outcome = async (id) => (await pool.query('SELECT outcome FROM whatsapp_events WHERE event_id=$1', [id])).rows[0].outcome;

  await t.test('normal menu request creates exactly one actual Kapso document payload', async () => {
    const e = event(), before = calls.length;
    assert.deepEqual((await service.processEvents([e])).outcomes, { sent: 1 });
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1).type, 'document');
    assert.equal(calls.at(-1).document.filename, 'منيو موزارو.pdf');
    assert.equal(calls.at(-1).document.link, 'https://example.test/official-menu.pdf');
  });
  await t.test('failure after pending persistence can be retried and resumed without losing the inquiry', async () => {
    const e = event(), c = store.conversationId(phoneId, e.sender), before = calls.length;
    await store.recordEmployeeActivity(c, new Date(Date.now() - 16 * 60_000));
    await pool.query("UPDATE whatsapp_conversations SET handoff_expires_at=now()-interval '1 second' WHERE conversation_id=$1", [c]);
    const original = store.claimExpiredHandoffs.bind(store);
    store.claimExpiredHandoffs = async () => { throw Object.assign(new Error('secret must never be logged'), { code: '42P10' }); };
    await assert.rejects(service.processEvents([e]), { code: '42P10' });
    store.claimExpiredHandoffs = original;
    assert.equal(await outcome(e.id), 'processing_failed');
    assert.equal(calls.length, before);
    assert.deepEqual((await service.processEvents([{ ...e }])).outcomes, { sent: 1 });
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1).type, 'document');
    assert.equal((await store.getConversation(c)).human_active, false);
    assert.equal((await pool.query('SELECT count(*)::int n FROM whatsapp_processing_audit WHERE event_id=$1', [e.id])).rows[0].n, 2);
    assert.equal((await pool.query('SELECT count(*)::int n FROM whatsapp_pending_messages WHERE event_id=$1', [e.id])).rows[0].n, 0);
  });
  await t.test('pre-send failure is reclaimed atomically by exactly one concurrent retry', async () => {
    const e = event(), before = calls.length;
    const original = store.reserveSend.bind(store); let fail = true;
    store.reserveSend = async (...args) => { if (fail) { fail = false; throw new Error('injected pre-send failure'); } return original(...args); };
    await assert.rejects(service.processEvents([e]));
    store.reserveSend = original;
    const results = await Promise.all([service.processEvents([{ ...e }]), service.processEvents([{ ...e }])]);
    assert.equal(results.filter((r) => r.outcomes.sent).length, 1);
    assert.equal(results.filter((r) => r.outcomes.duplicate).length, 1);
    assert.equal(calls.length, before + 1);
  });
  await t.test('completed response stays deduplicated on repeated provider deliveries', async () => {
    const e = event(); await service.processEvents([e]); const before = calls.length;
    assert.deepEqual((await service.processEvents([{ ...e }])).outcomes, { duplicate: 1 });
    assert.equal(await store.markProcessingFailed(e.id), false);
    assert.equal(calls.length, before);
  });
  await t.test('successful outbound with failed completion write never sends again', async () => {
    const e = event(), before = calls.length, original = store.setOutcome.bind(store);
    store.setOutcome = async (id, value) => { if (id === e.id && ['sent','send_uncertain'].includes(value)) throw new Error('injected DB outage after provider acceptance'); return original(id, value); };
    await assert.rejects(service.processEvents([e])); store.setOutcome = original;
    assert.equal(await outcome(e.id), 'send_reserved');
    assert.deepEqual((await service.processEvents([{ ...e }])).outcomes, { duplicate: 1 });
    assert.equal(calls.length, before + 1);
  });
  await t.test('two simultaneous first deliveries send at most one response', async () => {
    const e = event(), before = calls.length;
    const results = await Promise.all([service.processEvents([{ ...e }]), service.processEvents([{ ...e }])]);
    assert.equal(results.filter((r) => r.outcomes.sent).length, 1);
    assert.equal(calls.length, before + 1);
  });
  await t.test('ordinary 15-minute expiry keeps ordering and survives store restart', async () => {
    const first = event(), second = event();
    const ids = [first, second].map((e) => store.conversationId(phoneId, e.sender));
    for (const c of ids) await store.recordEmployeeActivity(c, new Date(Date.now() - 16 * 60_000));
    await pool.query("UPDATE whatsapp_conversations SET handoff_expires_at=now()-interval '2 seconds' WHERE conversation_id=$1", [ids[0]]);
    await pool.query("UPDATE whatsapp_conversations SET handoff_expires_at=now()-interval '1 second' WHERE conversation_id=$1", [ids[1]]);
    const restarted = new WhatsAppStore({ pool, identityKey: 'local-regression-key' });
    assert.equal((await restarted.claimExpiredHandoffs({ limit: 1 }))[0].conversationId, ids[0]);
    assert.equal((await restarted.getConversation(ids[0])).human_active, false);
    assert.equal((await restarted.getConversation(ids[1])).human_active, true);
  });
  await t.test('protected complaint is not auto-resumed', async () => {
    const e = event(), c = store.conversationId(phoneId, e.sender), before = calls.length;
    await store.claimHumanHandoff(c, 'complaint'); await store.recordEmployeeActivity(c, new Date(Date.now() - 30 * 60_000));
    assert.deepEqual((await service.processEvents([e])).outcomes, { human_active_pending: 1 });
    assert.deepEqual(await store.claimExpiredHandoffs({ conversationId: c }), []);
    assert.equal((await store.getConversation(c)).handoff_protected, true);
    assert.equal(calls.length, before);
  });
  await t.test('PostgreSQL reproduces old 42P10 and accepts corrected expiry query', async () => {
    await assert.rejects(pool.query('SELECT DISTINCT conversation_id FROM whatsapp_conversations ORDER BY handoff_expires_at'), { code: '42P10' });
    await assert.doesNotReject(store.claimExpiredHandoffs());
  });
  await t.test('stale pending claim cannot reopen a reserved outbound', async () => {
    const e = event(), c = store.conversationId(phoneId, e.sender);
    await store.recordEmployeeActivity(c, new Date(Date.now() - 16 * 60_000));
    await store.recordEvent({ id: e.id, conversationId: c, type: 'incoming', at: e.at });
    await store.queuePendingMessage({ ...e, conversationId: c }, {});
    await pool.query("UPDATE whatsapp_conversations SET human_active=false WHERE conversation_id=$1", [c]);
    await pool.query("UPDATE whatsapp_pending_messages SET status='processing',claimed_at=now()-interval '6 minutes' WHERE event_id=$1", [e.id]);
    await store.setOutcome(e.id, 'send_reserved');
    assert.deepEqual(await store.claimExpiredHandoffs({ conversationId: c }), []);
    assert.equal(await outcome(e.id), 'send_reserved');
    assert.equal(await store.markProcessingFailed(e.id), false);
  });
});

test('processing diagnostics retain safe identifiers and exclude raw error content', () => {
  const diagnostic = processingDiagnostic(Object.assign(new Error('token=SECRET customer text'), { code: '42P10' }),
    { id: 'incoming:wamid.mock', processingStage: 'handoff_expiry' }, 'abc123');
  assert.equal(diagnostic.eventId, 'incoming:wamid.mock');
  assert.equal(diagnostic.code, '42P10'); assert.equal(diagnostic.stage, 'handoff_expiry');
  assert.doesNotMatch(JSON.stringify(diagnostic), /SECRET|customer text/);
});
