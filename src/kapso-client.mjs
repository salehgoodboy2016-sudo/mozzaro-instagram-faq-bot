export class KapsoClient {
  constructor({ apiKey, phoneNumberId, enabled = false, apiVersion = 'v24.0', fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.phoneNumberId = phoneNumberId;
    this.enabled = enabled;
    this.apiVersion = apiVersion;
    this.fetch = fetchImpl;
  }

  async sendText({ to, text, customerMessageAt, now = new Date() }) {
    if (!text || text.length > 4096) throw new Error('Invalid WhatsApp text');
    return this.sendPayload({ to, customerMessageAt, now,
      payload: { type: 'text', text: { preview_url: false, body: text } } });
  }

  async sendDocument({ to, link, caption, filename, customerMessageAt, now = new Date() }) {
    let url;
    try { url = new URL(link); } catch { throw new Error('Invalid WhatsApp document URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.search || url.hash) {
      throw new Error('Invalid WhatsApp document URL');
    }
    if ((caption != null && (typeof caption !== 'string' || caption.length > 1024))
      || !['منيو موزارو.pdf', 'كيترنق موزارو.pdf'].includes(filename)) {
      throw new Error('Invalid WhatsApp document');
    }
    return this.sendPayload({ to, customerMessageAt, now,
      payload: { type: 'document', document: { link: url.href, ...(caption ? { caption } : {}), filename } } });
  }

  async listApprovedMarketingTemplates({ businessAccountId }) {
    if (!this.apiKey || !/^\d{8,32}$/.test(String(businessAccountId || ''))) {
      throw new Error('Kapso template access is not configured');
    }
    const url = new URL(`https://api.kapso.ai/meta/whatsapp/${this.apiVersion}/${businessAccountId}/message_templates`);
    url.searchParams.set('status', 'APPROVED');
    url.searchParams.set('category', 'MARKETING');
    url.searchParams.set('limit', '100');
    const response = await this.fetch(url, { headers: { 'X-API-Key': this.apiKey }, signal: AbortSignal.timeout(20_000) });
    let body; try { body = await response.json(); } catch { body = {}; }
    if (!response.ok || !Array.isArray(body.data)) {
      const error = new Error('Kapso template sync failed');
      error.status = response.status; error.code = body.error?.code ?? null;
      throw error;
    }
    return body.data.filter((item) => item.status === 'APPROVED' && item.category === 'MARKETING');
  }

  async sendPayload({ to, payload, customerMessageAt, now }) {
    if (!this.enabled || !this.apiKey || !this.phoneNumberId) throw new Error('Kapso outbound disabled');
    const recipient = String(to || '');
    if (!/^\d{8,15}$/.test(recipient) && !/^[A-Za-z0-9._:-]{8,128}$/.test(recipient)) {
      throw new Error('Invalid WhatsApp recipient');
    }
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
          ...payload,
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
