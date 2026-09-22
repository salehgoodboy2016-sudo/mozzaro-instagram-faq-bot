import { mkdir, appendFile, readFile } from 'node:fs/promises';

/**
 * Normalise the different mention webhook shapes used by Meta's Instagram
 * integrations. Story mentions may arrive as a `mentions` change or as a
 * messaging event containing a story attachment.
 */
export function extractStoryMentions(payload, accountId = '') {
  const found = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'mentions' || change.value?.media_type !== 'STORY') continue;
      const value = change.value || {};
      found.push({
        id: value.id || value.media_id || value.story_id || `${entry.id || 'instagram'}:${value.timestamp || Date.now()}`,
        senderId: value.from?.id || value.sender?.id || value.user_id || null,
        username: value.from?.username || value.sender?.username || value.username || null,
        mediaId: value.media_id || value.id || null,
        mediaUrl: value.media_url || value.thumbnail_url || null,
        mediaType: value.media_type || value.type || 'STORY',
        accountId: accountId || entry.id || null,
        source: 'mentions',
        raw: value,
      });
    }
    for (const item of entry.messaging || entry.messages || []) {
      const message = item.message || item;
      const attachment = (message.attachments || []).find((a) => a.type === 'story_mention');
      if (!attachment || message.is_echo || !accountId || item.sender?.id === accountId || item.recipient?.id !== accountId) continue;
      const payloadValue = attachment.payload || {};
      found.push({
        id: message.mid || item.message_id || item.id,
        senderId: item.sender?.id || message.from?.id || null,
        username: item.sender?.username || null,
        mediaId: payloadValue.story?.id || payloadValue.id || null,
        mediaUrl: payloadValue.url || payloadValue.story?.url || null,
        mediaType: 'STORY',
        accountId: accountId || item.recipient?.id || null,
        source: 'messaging-story-attachment',
        raw: payloadValue,
      });
    }
  }
  return found.filter((item) => item.id);
}

/**
 * Queue a mention for a human review workflow. Meta does not expose a general
 * endpoint to download another user's Story media for reposting, so this is
 * deliberately review-only and never publishes automatically.
 */
export async function queueStoryMention(mention, file = './data/story-mention-review.jsonl') {
  await mkdir('./data', { recursive: true });
  const existing = await readFile(file, 'utf8').catch(() => '');
  if (existing.split('\n').some((line) => line.includes(`"id":${JSON.stringify(mention.id)}`))) {
    return { id: mention.id, status: 'duplicate', autoRepostSupported: false };
  }
  const record = {
    id: mention.id,
    senderId: mention.senderId,
    username: mention.username,
    mediaId: mention.mediaId,
    mediaUrl: mention.mediaUrl,
    mediaType: mention.mediaType,
    source: mention.source,
    status: 'manual_review_required',
    autoRepostSupported: null,
    reason: 'Media availability and publishing support require verification; review only.',
    at: new Date().toISOString(),
  };
  await appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return record;
}
