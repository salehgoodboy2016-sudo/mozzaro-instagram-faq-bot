export class KapsoClient {
  constructor({ apiKey, phoneNumberId, enabled = false, apiVersion = 'v24.0', fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.phoneNumberId = phoneNumberId;
    this.enabled = enabled;
    this.apiVersion = apiVersion;
    this.fetch = fetchImpl;
  }

  async sendText({ to, text, customerMessageAt, now = new Date() }) {
    if (!this.enabled || !this.apiKey || !this.phoneNumberId) throw new Error('Kapso outbound disabled');
    const recipient = String(to || '');
    if (!/^\d{8,15}$/.test(recipient) && !/^[A-Za-z0-9._:-]{8,128}$/.test(recipient)) {
      throw new Error('Invalid WhatsApp recipient');
    }
    if (!text || text.length > 4096) throw new Error('Invalid WhatsApp text');
    const age = now.getTime() - new Date(customerMessageAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age >= 24 * 60 * 60 * 1000) {
      throw new Error('Outside customer service window');
    }

    const target = /^\d{8,15}$/.test(recipient) ? { to: recipient } : { recipient };
    const response = await this.fetch(
      `https://api.kapso.ai/meta/whatsapp/${this.apiVersion}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { 'X-API-Key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', recipient_type: 'individual', ...target,
          type: 'text', text: { preview_url: false, body: text },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok || body.error || !body.messages?.[0]?.id) {
      const error = new Error('Kapso send failed');
      error.status = response.status;
      error.code = body.error?.code ?? null;
      error.retryAfter = response.headers.get('retry-after');
      throw error;
    }
    return { messageId: body.messages[0].id };
  }
}
