import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// Keep credentials outside the static website. Never log the token or raw errors.
async function main() {
  let env;
  try {
    env = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'));
  } catch {
    throw new Error('Cannot read the project .env file.');
  }
  const token = env.INSTAGRAM_ACCESS_TOKEN?.trim();
  const expected = env.INSTAGRAM_EXPECTED_USERNAME?.trim().replace(/^@/, '');
  if (!token || !expected) {
    throw new Error('Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_EXPECTED_USERNAME in .env.');
  }

  let response;
  try {
    response = await fetch('https://graph.instagram.com/me?fields=user_id,username', {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('Instagram connection failed: network, TLS, redirect, or timeout error.');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Instagram returned a non-JSON response (HTTP ${response.status}).`);
  }
  if (!response.ok || body.error) {
    const code = Number.isInteger(body.error?.code) ? body.error.code : 'unknown';
    const subcode = Number.isInteger(body.error?.error_subcode) ? body.error.error_subcode : 'none';
    throw new Error(`Instagram rejected the request: HTTP ${response.status}, code ${code}, subcode ${subcode}.`);
  }
  const profile = Array.isArray(body.data) ? body.data[0] : body;
  if (!profile || typeof profile.username !== 'string' || !/^\d+$/.test(String(profile.user_id ?? ''))) {
    throw new Error('Instagram response did not include a valid user_id and username.');
  }
  if (profile.username.toLowerCase() !== expected.toLowerCase()) {
    throw new Error('The token belongs to a different Instagram account than INSTAGRAM_EXPECTED_USERNAME.');
  }
  console.log(JSON.stringify({
    connected: true,
    username: profile.username,
    instagram_user_id: String(profile.user_id),
    api_version: response.headers.get('instagram-api-version'),
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
