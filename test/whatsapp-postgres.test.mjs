import assert from 'node:assert/strict';
import test from 'node:test';
import { newDb } from 'pg-mem';
import { runMigrations } from '../src/db-migrations.mjs';
import { WhatsAppStore } from '../src/whatsapp-store.mjs';

test('PostgreSQL migrations are repeatable and persist deduplication and handoff state', async () => {
  const database = newDb({ noAstCoverageCheck: true });
  const adapter = database.adapters.createPg();
  const pool = new adapter.Pool();

  assert.deepEqual(await runMigrations(pool, { advisoryLock: false }), ['001_whatsapp_state.sql', '002_whatsapp_ai.sql', '003_handoff_timeout.sql']);
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

  const timeoutId = secondStore.conversationId('816217614914860', '966500000099');
  const employeeAt = new Date();
  await secondStore.recordEmployeeActivity(timeoutId, employeeAt);
  const expiryStored = await secondStore.getConversation(timeoutId);
  assert.equal(expiryStored.handoff_reason, 'employee_activity');
  assert.equal(expiryStored.handoff_protected, false);
  assert.ok(new Date(expiryStored.handoff_expires_at) > new Date());
  const pending = { id: 'incoming:pending-after-employee', conversationId: timeoutId,
    type: 'incoming', at: new Date(Date.now() + 1000) };
  assert.equal(await secondStore.recordEvent(pending), true);
  await secondStore.recordCustomerActivity(timeoutId, pending.at);
  assert.equal(await secondStore.queuePendingMessage({ ...pending, sender: '966500000099', text: 'متى تفتحون؟', type: 'text' },
    { requiresHuman: false }), true);
  const restartedStore = new WhatsAppStore({ pool, identityKey: 'integration-test-key' });
  assert.equal((await restartedStore.getConversation(timeoutId)).human_active, true);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM whatsapp_pending_messages WHERE conversation_id=$1',
    [timeoutId])).rows[0].count, 1);
  await pool.query(`UPDATE whatsapp_conversations SET handoff_expires_at=now()-interval '1 second' WHERE conversation_id=$1`, [timeoutId]);
  const resumed = await restartedStore.claimExpiredHandoffs({ conversationId: timeoutId });
  assert.equal(resumed.some((item) => item.kind === 'audit' && item.hadPending), true);
  const resumedMessage = resumed.find((item) => item.kind === 'incoming');
  assert.equal(resumedMessage?.id, pending.id);
  assert.equal((await restartedStore.getConversation(timeoutId)).human_active, false);
  await pool.query(`UPDATE whatsapp_pending_messages SET claimed_at=now()-interval '6 minutes' WHERE event_id=$1`, [pending.id]);
  const recoveredAfterRestart = await restartedStore.claimExpiredHandoffs({ conversationId: timeoutId });
  assert.equal(recoveredAfterRestart.find((item) => item.kind === 'incoming')?.id, pending.id);
  assert.equal(recoveredAfterRestart.some((item) => item.kind === 'audit'), false);
  await restartedStore.completePendingMessage(pending.id, 'sent');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM whatsapp_pending_messages WHERE conversation_id=$1',
    [timeoutId])).rows[0].count, 0);

  const protectedId = secondStore.conversationId('816217614914860', '966500000098');
  await secondStore.claimHumanHandoff(protectedId, 'complaint');
  await secondStore.recordEmployeeActivity(protectedId, employeeAt);
  const protectedConversation = await secondStore.getConversation(protectedId);
  assert.equal(protectedConversation.handoff_protected, true);
  assert.equal(protectedConversation.handoff_expires_at, null);
  assert.deepEqual(await secondStore.claimExpiredHandoffs({ conversationId: protectedId }), []);

  const raceId = secondStore.conversationId('816217614914860', '966500000097');
  const raceAt = new Date();
  const raceEvent = { id: 'incoming:employee-race', conversationId: raceId, type: 'incoming', at: raceAt };
  await secondStore.recordEvent(raceEvent);
  await secondStore.recordCustomerActivity(raceId, raceAt);
  await secondStore.recordEvent({ id: 'employee_echo:during-ai', conversationId: raceId, type: 'employee_echo',
    at: new Date(raceAt.getTime() + 1) });
  await secondStore.recordEmployeeActivity(raceId, new Date(raceAt.getTime() + 1));
  assert.equal(await secondStore.reserveSend(raceEvent.id, raceId, raceAt), false);

  assert.equal(await secondStore.reserveAiBudget(event.id, 0.01, 1), true);
  assert.equal(await secondStore.reserveAiBudget('incoming:over-limit', 2, 1), false);
  await secondStore.appendAiContext(conversationId, 'هلا', 'أهلين');
  assert.deepEqual(await secondStore.getAiContext(conversationId), [
    { role: 'user', content: 'هلا' }, { role: 'assistant', content: 'أهلين' },
  ]);

  await pool.end();
});
