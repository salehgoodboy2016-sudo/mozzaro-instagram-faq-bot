import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const API_VERSION = 'v26.0';
const API_HOST = `https://graph.instagram.com/${API_VERSION}`;

async function loadConfig() {
  const env = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'));
  const token = env.INSTAGRAM_ACCESS_TOKEN?.trim();
  const expectedUsername = env.INSTAGRAM_EXPECTED_USERNAME?.trim().replace(/^@/, '');
  if (!token || !expectedUsername) {
    throw new Error('Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_EXPECTED_USERNAME in .env.');
  }
  return { token, expectedUsername };
}

async function request(path, token, params = {}) {
  const url = new URL(`${API_HOST}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  let body = {};
  try { body = await response.json(); } catch { /* handled below */ }
  return { response, body };
}

async function profile(config) {
  const { response, body } = await request('/me', config.token, { fields: 'id,user_id,username' });
  if (!response.ok || body.error) throw apiError(response.status, body.error);
  if (body.username?.toLowerCase() !== config.expectedUsername.toLowerCase()) {
    throw new Error('The token belongs to a different Instagram account.');
  }
  return { username: body.username, id: body.id, user_id: body.user_id, httpStatus: response.status };
}

async function conversations(config, accountId) {
  const { response, body } = await request('/me/conversations', config.token, {
    platform: 'instagram', fields: 'id,updated_time,participants', limit: 5,
  });
  if (!response.ok || body.error) throw apiError(response.status, body.error);
  return {
    httpStatus: response.status,
    count: Array.isArray(body.data) ? body.data.length : 0,
    hasNextPage: Boolean(body.paging?.next),
    conversations: Array.isArray(body.data)
      ? body.data.map(({ id, updated_time: updatedTime, participants }) => ({
          id,
          updatedTime,
          participants: Array.isArray(participants?.data)
            ? participants.data.map(({ id: participantId, username }) => ({ id: participantId, username }))
            : [],
        }))
      : [],
    accountId,
  };
}

function apiError(status, error) {
  const result = new Error(error?.message || `Instagram API request failed (HTTP ${status}).`);
  result.details = { httpStatus: status, code: error?.code ?? null, subcode: error?.error_subcode ?? null };
  return result;
}

const config = await loadConfig();
const account = await profile(config);
const result = await conversations(config, account.user_id ?? account.id);
console.log(JSON.stringify({ apiVersion: API_VERSION, account, ...result }, null, 2));
