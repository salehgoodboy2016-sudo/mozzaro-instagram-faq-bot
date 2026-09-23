import assert from 'node:assert/strict';
import test from 'node:test';
import { newDb } from 'pg-mem';
import { runMigrations } from '../src/db-migrations.mjs';
import { WhatsAppStore } from '../src/whatsapp-store.mjs';

test('PostgreSQL migrations are repeatable and persist deduplication and handoff state', async () => {
  const database = newDb({ noAstCoverageCheck: true });
  const adapter = database.adapters.createPg();
  const pool = new adapter.Pool();

  assert.deepEqual(await runMigrations(pool, { advisoryLock: false }), ['001_whatsapp_state.sql']);
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

  await pool.end();
});
