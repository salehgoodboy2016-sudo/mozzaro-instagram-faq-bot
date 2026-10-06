const DEFAULT_GRAPH_VERSION = 'v26.0';

export function normalizeWhatsAppRecipient(value) {
  const digits = String(value ?? '').replace(/[^0-9]/g, '').replace(/^00/, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function buildMetaTemplatePayload({ to, templateName, language = 'ar', image }) {
  const recipient = normalizeWhatsAppRecipient(to);
  if (!recipient) throw new Error('Invalid Meta campaign recipient');
  if (!/^[a-z0-9_]{1,512}$/.test(String(templateName || ''))) throw new Error('Invalid Meta template name');
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(String(language || ''))) throw new Error('Invalid Meta template language');
  const imageParameter = image?.id ? { id: String(image.id) } : image?.link ? { link: String(image.link) } : null;
  if (!imageParameter) throw new Error('Meta template image is required');
  if (imageParameter.link) {
    let url;
    try { url = new URL(imageParameter.link); } catch { throw new Error('Invalid Meta template image URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
      throw new Error('Invalid Meta template image URL');
    }
  }
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'template',
    template: { name: templateName, language: { code: language }, components: [{
      type: 'header', parameters: [{ type: 'image', image: imageParameter }],
    }] },
  };
}

export class MetaCampaignClient {
  constructor({ token, phoneNumberId, businessAccountId, enabled = false,
    apiVersion = DEFAULT_GRAPH_VERSION, fetchImpl = fetch }) {
    this.token = token;
    this.phoneNumberId = String(phoneNumberId || '');
    this.businessAccountId = String(businessAccountId || '');
    this.enabled = enabled === true;
    this.apiVersion = apiVersion;
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.token && /^\d{8,32}$/.test(this.phoneNumberId) && /^\d{8,32}$/.test(this.businessAccountId));
  }

  async listApprovedMarketingTemplates() {
    if (!this.configured) throw new Error('Meta campaign access is not configured');
    const url = new URL(`https://graph.facebook.com/${this.apiVersion}/${this.businessAccountId}/message_templates`);
    url.searchParams.set('fields', 'id,name,language,category,status,quality_score,components');
    url.searchParams.set('status', 'APPROVED');
    url.searchParams.set('limit', '100');
    const response = await this.fetch(url, { headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(20_000) });
    let body; try { body = await response.json(); } catch { body = {}; }
    if (!response.ok || body.error || !Array.isArray(body.data)) {
      const error = new Error('Meta template sync failed');
      error.status = response.status; error.code = body.error?.code ?? null; throw error;
    }
    return body.data.filter((item) => item.status === 'APPROVED' && item.category === 'MARKETING');
  }

  async sendTemplate({ to, templateName, language = 'ar', image }) {
    if (!this.enabled || !this.configured) throw new Error('Meta campaign sending disabled');
    const payload = buildMetaTemplatePayload({ to, templateName, language, image });
    const response = await this.fetch(`https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000),
    });
    let body; try { body = await response.json(); } catch { body = {}; }
    if (!response.ok || body.error || !body.messages?.[0]?.id) {
      const error = new Error('Meta campaign send failed');
      error.status = response.status; error.code = body.error?.code ?? null;
      error.subcode = body.error?.error_subcode ?? null; error.retryAfter = response.headers.get('retry-after');
      throw error;
    }
    return { messageId: String(body.messages[0].id) };
  }
}
