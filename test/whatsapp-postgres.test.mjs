import assert from 'node:assert/strict';
import test from 'node:test';
import { newDb } from 'pg-mem';
import { runMigrations } from '../src/db-migrations.mjs';
import { WhatsAppStore } from '../src/whatsapp-store.mjs';

test('PostgreSQL migrations are repeatable and persist deduplication and handoff state', async () => {
  const database = newDb({ noAstCoverageCheck: true });
  const adapter = database.adapters.createPg();
  const pool = new adapter.Pool();

  assert.deepEqual(await runMigrations(pool, { advisoryLock: false }), ['001_whatsapp_state.sql', '002_whatsapp_ai.sql']);
  assert.deepEqual(await runMigrations(pool, { advisoryLock: false }), []);

  const store = new WhatsAppStore({ pool, identityKey: 'integration-test-key' });
  const conversationId = store.conversationId('816217614914860', '966500000000');
  const event = {
    id: 'incoming:wamid.integration-test',
    conversationId,
    type: 'incoming',
    at: new Date('2026-09-23T12:00:00Z'),
  };

  assert.equal(await store.recordEvent(event), true);
  assert.equal(await store.recordEvent(event), false);
  await store.setHuman(conversationId, true, 'employee_takeover');

  const secondStore = new WhatsAppStore({ pool, identityKey: 'integration-test-key' });
  const persisted = await secondStore.getConversation(conversationId);
  assert.equal(persisted.human_active, true);
  assert.equal(persisted.handoff_reason, 'employee_takeover');
  assert.equal((await secondStore.recent(10))[0].outcome, 'received');
  assert.deepEqual(await secondStore.verifyPersistence(), { deduplication: true, humanHandoff: true });
  assert.equal((await secondStore.getConversation(
    secondStore.conversationId('system', 'storage-self-test-v1'),
  )).human_active, false);

  const resumableId = secondStore.conversationId('816217614914860', '966545383080');
  await secondStore.setHuman(resumableId, true, 'employee_activity');
  const resumeRequestId = 'c474d9d9-3d92-4d2f-b459-cde576d7f111';
  assert.deepEqual(await secondStore.resumeConversationOnce('816217614914860', '966545383080', resumeRequestId),
    { outcome: 'resumed', wasHumanActive: true });
  assert.equal((await secondStore.getConversation(resumableId)).human_active, false);
  assert.equal((await secondStore.recent(10)).some((row) => row.event_type === 'operator_resume'
    && row.outcome === 'applied' && row.conversation_id === resumableId), true);
  await secondStore.setHuman(resumableId, true, 'employee_takeover');
  assert.deepEqual(await secondStore.resumeConversationOnce('816217614914860', '966545383080', resumeRequestId),
    { outcome: 'already_consumed' });
  assert.equal((await secondStore.getConversation(resumableId)).human_active, true);

  assert.equal(await secondStore.reserveAiBudget(event.id, 0.01, 1), true);
  assert.equal(await secondStore.reserveAiBudget('incoming:over-limit', 2, 1), false);
  await secondStore.appendAiContext(conversationId, 'هلا', 'أهلين');
  assert.deepEqual(await secondStore.getAiContext(conversationId), [
    { role: 'user', content: 'هلا' }, { role: 'assistant', content: 'أهلين' },
  ]);

  await pool.end();
});
