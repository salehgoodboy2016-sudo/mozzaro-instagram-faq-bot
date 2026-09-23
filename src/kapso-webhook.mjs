import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyKapsoSignature(raw, signature, secret) {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const actual = signature.toLowerCase();
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function timestamp(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

function customerIdentity(payload, direction) {
  const message = payload?.message || {};
  const conversation = payload?.conversation || {};
  if (direction === 'inbound') {
    return message.from || message.from_user_id || conversation.business_scoped_user_id
      || conversation.parent_business_scoped_user_id || conversation.phone_number || null;
  }
  return message.to || conversation.business_scoped_user_id
    || conversation.parent_business_scoped_user_id || conversation.phone_number || null;
}

export function extractKapsoEvents(eventName, body, idempotencyKey = '') {
  const payloads = body?.batch === true && Array.isArray(body.data) ? body.data : [body];
  const events = [];
  for (const [index, payload] of payloads.entries()) {
    const message = payload?.message || {};
    const phoneId = String(payload?.phone_number_id || payload?.conversation?.phone_number_id || '');
    const origin = message.kapso?.origin;
    const direction = message.kapso?.direction;
    const baseId = message.id || (idempotencyKey ? `${idempotencyKey}:${index}` : '');

    if (eventName === 'whatsapp.message.received' && direction === 'inbound') {
      const sender = customerIdentity(payload, 'inbound');
      if (!baseId || !phoneId || !sender) continue;
      events.push({
        kind: 'incoming', id: `kapso:incoming:${baseId}`, phoneId, sender,
        at: timestamp(message.timestamp),
        text: message.type === 'text' ? message.text?.body || message.kapso?.content || '' : '',
        type: message.type || 'unknown',
      });
      continue;
    }

    if (eventName === 'whatsapp.message.sent' && direction === 'outbound' && origin === 'business_app') {
      const recipient = customerIdentity(payload, 'outbound');
      if (!baseId || !phoneId || !recipient) continue;
      events.push({ kind: 'employee_echo', id: `kapso:employee:${baseId}`, phoneId, recipient,
        at: timestamp(message.timestamp) });
      continue;
    }

    if (eventName?.startsWith('whatsapp.message.') && baseId) {
      events.push({ kind: 'status', id: `kapso:status:${baseId}:${eventName}:${message.timestamp || ''}`,
        status: eventName.slice('whatsapp.message.'.length) });
    }
  }
  return events;
}
