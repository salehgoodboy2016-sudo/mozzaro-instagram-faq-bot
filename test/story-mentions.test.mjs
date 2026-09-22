import test from 'node:test';
import assert from 'node:assert/strict';
import { extractStoryMentions } from '../src/story-mentions.mjs';

test('extracts mentions webhook changes without exposing message content', () => {
  const result = extractStoryMentions({ entry: [{ id: '1784', changes: [{ field: 'mentions', value: { id: 'story-1', from: { id: 'sender-1', username: 'customer' }, media_id: 'media-1', media_type: 'STORY' } }] }] }, '1784');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { id: 'story-1', senderId: 'sender-1', username: 'customer', mediaId: 'media-1', mediaUrl: null, mediaType: 'STORY', accountId: '1784', source: 'mentions', raw: { id: 'story-1', from: { id: 'sender-1', username: 'customer' }, media_id: 'media-1', media_type: 'STORY' } });
});

test('extracts story attachments from messaging payloads', () => {
  const result = extractStoryMentions({ entry: [{ messaging: [{ sender: { id: 'sender-2' }, recipient: { id: '1784' }, message: { mid: 'mid-1', attachments: [{ type: 'story_mention', payload: { story: { id: 'story-2', url: 'https://example.invalid/story' } } }] } }] }] }, '1784');
  assert.equal(result[0].mediaId, 'story-2');
  assert.equal(result[0].source, 'messaging-story-attachment');
});
