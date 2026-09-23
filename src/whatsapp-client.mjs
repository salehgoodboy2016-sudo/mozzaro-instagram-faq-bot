export class WhatsAppClient {
  constructor({ token, phoneNumberId, enabled = false, apiVersion = 'v26.0', fetchImpl = fetch }) {
    this.token = token;
    this.phoneNumberId = phoneNumberId;
    this.enabled = enabled;
    this.apiVersion = apiVersion;
    this.fetch = fetchImpl;
  }

  async sendText({ to, text, customerMessageAt, now = new Date() }) {
    if (!this.enabled || !this.token || !this.phoneNumberId) throw new Error('WhatsApp outbound disabled');
    if (!/^\d{8,15}$/.test(String(to))) throw new Error('Invalid WhatsApp recipient');
    if (!text || text.length > 4096) throw new Error('Invalid WhatsApp text');
    const age = now.getTime() - new Date(customerMessageAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age >= 24 * 60 * 60 * 1000) throw new Error('Outside customer service window');

    const response = await this.fetch(`https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: text } }),
      signal: AbortSignal.timeout(20_000),
    });
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok || body.error || !body.messages?.[0]?.id) {
      const error = new Error('WhatsApp send failed');
      error.status = response.status;
      error.code = body.error?.code ?? null;
      error.retryAfter = response.headers.get('retry-after');
      throw error;
    }
    return { messageId: body.messages[0].id };
  }
}

export class MockWhatsAppClient {
  constructor() { this.sent = []; }
  async sendText(message) {
    this.sent.push(message);
    return { messageId: `mock-${this.sent.length}` };
  }
}
