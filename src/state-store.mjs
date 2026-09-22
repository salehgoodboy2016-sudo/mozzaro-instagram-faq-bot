import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class StateStore {
  constructor(file, repeatCooldownMs = 6 * 60 * 60 * 1000) {
    this.file = file;
    this.repeatCooldownMs = repeatCooldownMs;
    this.state = { processedMessageIds: {}, lastTopicReplies: {}, humanAttention: [] };
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      this.state = { ...this.state, ...parsed };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  hasProcessed(id) { return Boolean(id && this.state.processedMessageIds[id]); }

  markProcessed(id) {
    if (id) this.state.processedMessageIds[id] = Date.now();
  }

  canReply(conversationKey, topic, now = Date.now()) {
    const last = this.state.lastTopicReplies[`${conversationKey}:${topic}`] ?? 0;
    return now - last >= this.repeatCooldownMs;
  }

  markTopicReply(conversationKey, topic, now = Date.now()) {
    this.state.lastTopicReplies[`${conversationKey}:${topic}`] = now;
  }

  flagHuman(event) { this.state.humanAttention.push({ ...event, at: new Date().toISOString() }); }

  async save() {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await rename(temp, this.file);
  }
}
