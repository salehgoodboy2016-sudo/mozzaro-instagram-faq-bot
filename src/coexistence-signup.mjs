// Prepared for Meta's Embedded Signup v4. This module has no route or launch
// button in production. It must stay dormant until Meta approves this app as a
// Tech Provider/Solution Partner and the owner authorizes onboarding.

export function buildCoexistenceLoginOptions(configurationId) {
  if (!/^\d+$/.test(String(configurationId))) throw new Error('Meta configuration ID is required');
  return {
    config_id: String(configurationId),
    response_type: 'code',
    override_default_response_type: true,
    extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
  };
}

export function parseCoexistenceSession({ origin, data, expectedWabaId, expectedPhoneNumberId }) {
  const hostname = new URL(origin).hostname;
  if (hostname !== 'facebook.com' && !hostname.endsWith('.facebook.com')) throw new Error('Untrusted signup origin');
  const session = typeof data === 'string' ? JSON.parse(data) : data;
  if (session?.type !== 'WA_EMBEDDED_SIGNUP') throw new Error('Unexpected signup event');
  if (session.event !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') return { completed: false, event: session.event };
  const wabaId = session.data?.waba_id;
  const phoneNumberId = session.data?.phone_number_id || null;
  if (!/^\d+$/.test(String(wabaId)) || wabaId !== expectedWabaId) throw new Error('Unexpected WABA');
  if (phoneNumberId && phoneNumberId !== expectedPhoneNumberId) throw new Error('Unexpected phone number');
  return { completed: true, wabaId, phoneNumberId };
}

export async function exchangeSignupCode({ code, appId, appSecret, fetchImpl = fetch }) {
  if (!code || !/^\d+$/.test(String(appId)) || !appSecret) throw new Error('Signup token exchange is not configured');
  const url = new URL('https://graph.facebook.com/v26.0/oauth/access_token');
  url.searchParams.set('client_id', String(appId));
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('code', code);
  // Never log this URL: it includes the Meta App Secret and short-lived code.
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error('Meta signup token exchange failed');
  return body.access_token;
}
