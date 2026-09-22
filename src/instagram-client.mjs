const DEFAULT_VERSION = 'v26.0';

export class InstagramClient {
  constructor({ token, apiVersion = DEFAULT_VERSION, fetchImpl = fetch, accountId }) {
    this.token = token;
    this.base = `https://graph.instagram.com/${apiVersion}`;
    this.fetch = fetchImpl;
    this.accountId = accountId;
  }

  async sendText(recipientId, text) {
    const response = await this.fetch(`${this.base}/me/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
      signal: AbortSignal.timeout(20_000),
    });
    let body = {};
    try { body = await response.json(); } catch { /* handled below */ }
    if (!response.ok || body.error) {
      const error = new Error(body.error?.message || `Instagram send failed (HTTP ${response.status}).`);
      error.details = { status: response.status, code: body.error?.code ?? null, subcode: body.error?.error_subcode ?? null };
      throw error;
    }
    return body;
  }
}
