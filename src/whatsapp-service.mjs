import { planWhatsAppReply, renderApprovedTopics } from './whatsapp-faq.mjs';

export function extractWhatsAppEvents(payload) {
  const events = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneId = value.metadata?.phone_number_id;
      if (change.field === 'messages') {
        for (const message of value.messages || []) {
          if (!message.id || !message.from || !phoneId) continue;
          const timestamp = Number(message.timestamp);
          events.push({ kind: 'incoming', id: `incoming:${message.id}`, phoneId, sender: message.from,
            at: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : null,
            text: message.type === 'text' ? message.text?.body || '' : '', type: message.type });
        }
        for (const status of value.statuses || []) {
          if (status.id) events.push({ kind: 'status', id: `status:${status.id}:${status.status}:${status.timestamp || ''}`,
            status: status.status });
        }
      } else if (change.field === 'smb_message_echoes') {
        for (const echo of value.message_echoes || []) {
          const timestamp = Number(echo.timestamp);
          if (!echo.id || !echo.to || !phoneId) continue;
          events.push({ kind: 'employee_echo', id: `employee_echo:${echo.id}`, phoneId, recipient: echo.to,
            at: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : null });
        }
      } else if (['history', 'smb_app_state_sync'].includes(change.field)) {
        // Acknowledged without logging or importing private chat history and
        // contacts. Their synchronization is a separate opt-in integration.
        events.push({ kind: 'coexistence_pending', field: change.field });
      }
    }
  }
  return events;
}

function normalizeIdentity(value) {
  const text = String(value || '').trim().replace(/[()\s-]/g, '');
  return /^\+?\d+$/.test(text) ? text.replace(/^\+/, '') : text;
}

export class WhatsAppService {
  constructor({ store = null, client = null, aiClient = null, aiMonthlyLimitUsd = 0,
    knowledge = null, enabled = false, phoneNumberId, coexistenceVerified = false, allowlist = [], now = () => new Date() }) {
    this.store = store;
    this.client = client;
    this.aiClient = aiClient;
    this.aiMonthlyLimitUsd = aiMonthlyLimitUsd;
    this.knowledge = knowledge;
    this.enabled = enabled;
    this.phoneNumberId = phoneNumberId;
    this.coexistenceVerified = coexistenceVerified;
    this.allowlist = new Set(allowlist.map(normalizeIdentity).filter(Boolean));
    this.now = now;
    if (enabled && (!store || !client || !coexistenceVerified || !phoneNumberId || !this.allowlist.size)) {
      throw new Error('WhatsApp automation requires a persistent store, outbound transport, verified Coexistence, phone ID, and a non-empty test allowlist');
    }
  }

  async process(payload) {
    return this.processEvents(extractWhatsAppEvents(payload));
  }

  async processEvents(events) {
    const outcomes = {};
    for (const event of events) {
      const outcome = await this.processEvent(event);
      outcomes[outcome] = (outcomes[outcome] || 0) + 1;
    }
    return { count: events.length, outcomes };
  }

  async processEvent(event) {
    if (event.kind === 'coexistence_pending') return 'coexistence_pending';
    if (!this.store) return 'observed_no_store';
    if (event.kind === 'status') {
      const inserted = await this.store.recordEvent({ id: event.id, conversationId: null, type: 'status', at: null });
      if (inserted) await this.store.setOutcome(event.id, event.status || 'status');
      return inserted ? 'status_recorded' : 'duplicate';
    }
    if (event.kind === 'employee_echo') {
      if (event.phoneId !== this.phoneNumberId || !event.at) return 'invalid_echo';
      const conversationId = this.store.conversationId(event.phoneId, event.recipient);
      const inserted = await this.store.recordEvent({ id: event.id, conversationId, type: 'employee_echo', at: event.at });
      if (!inserted) return 'duplicate';
      await this.store.recordEmployeeActivity(conversationId, event.at);
      await this.store.setOutcome(event.id, 'human_active');
      return 'employee_activity';
    }
    if (event.phoneId !== this.phoneNumberId) return 'other_phone';
    if (!event.at || event.at > new Date(this.now().getTime() + 5 * 60_000)) return 'invalid_timestamp';
    const conversationId = this.store.conversationId(event.phoneId, event.sender);
    const inserted = await this.store.recordEvent({ id: event.id, conversationId, type: 'incoming', at: event.at });
    if (!inserted) return 'duplicate';
    if (this.enabled && !this.allowlist.has(normalizeIdentity(event.sender))) {
      await this.store.setOutcome(event.id, 'allowlist_blocked');
      return 'allowlist_blocked';
    }
    const conversation = await this.store.getConversation(conversationId);
    if (conversation?.last_employee_at && event.at <= new Date(conversation.last_employee_at)) {
      await this.store.setOutcome(event.id, 'before_employee_activity');
      return 'before_employee_activity';
    }
    if (conversation?.latest_customer_at && event.at < new Date(conversation.latest_customer_at)) {
      await this.store.setOutcome(event.id, 'out_of_order');
      return 'out_of_order';
    }
    await this.store.recordCustomerActivity(conversationId, event.at);
    if (conversation?.human_active) {
      await this.store.setOutcome(event.id, 'human_active');
      return 'human_active';
    }
    let plan = planWhatsAppReply(event.text, this.now());
    let aiContext = [];
    if (this.enabled && this.aiClient?.enabled && (!plan.requiresHuman || plan.reason === 'unknown_question') && this.knowledge) {
      aiContext = await this.store.getAiContext?.(conversationId) || [];
      if (event.text.length > 2500) {
        await this.store.claimHumanHandoff(conversationId, 'message_too_long');
        await this.store.setOutcome(event.id, 'human_required');
        return 'human_required';
      }
      const estimateUsd = this.aiClient.estimateUsd([...aiContext, { role: 'user', content: event.text }], 220, this.knowledge);
      const reserved = await this.store.reserveAiBudget?.(event.id, estimateUsd, this.aiMonthlyLimitUsd);
      if (!reserved) {
        await this.store.claimHumanHandoff(conversationId, 'ai_budget_exceeded');
        await this.store.setOutcome(event.id, 'ai_budget_exceeded');
        return 'ai_budget_exceeded';
      }
      try {
        const ai = await this.aiClient.answer({ userText: event.text, context: aiContext, knowledge: this.knowledge });
        const actualUsd = ai.inputTokens * this.aiClient.inputUsdPerMillion / 1_000_000
          + ai.outputTokens * this.aiClient.outputUsdPerMillion / 1_000_000;
        await this.store.recordAiUsage?.(event.id, actualUsd);
        console.log(JSON.stringify({ service: 'claude-assistant', outcome: 'completed', inputTokens: ai.inputTokens,
          outputTokens: ai.outputTokens, estimatedCostUsd: Number(actualUsd.toFixed(6)) }));
        if (ai.action === 'handoff') {
          await this.store.claimHumanHandoff(conversationId, 'ai_handoff');
          await this.store.setOutcome(event.id, 'human_required');
          return 'human_required';
        }
        const approvedPlan = renderApprovedTopics(ai.topics, this.now());
        if (!approvedPlan) {
          await this.store.claimHumanHandoff(conversationId, 'ai_no_verified_answer');
          await this.store.setOutcome(event.id, 'human_required');
          return 'human_required';
        }
        plan = approvedPlan;
      } catch (error) {
        await this.store.setOutcome(event.id, 'ai_unavailable');
        console.error(JSON.stringify({ service: 'claude-assistant', outcome: 'unavailable', status: error.status ?? null, code: error.code ?? null }));
      }
    }
    if (plan.requiresHuman) {
      const firstHandoff = await this.store.claimHumanHandoff(conversationId, plan.reason);
      if (plan.reason !== 'unknown_question' || !firstHandoff || !this.enabled ||
        this.now().getTime() - event.at.getTime() >= 24 * 60 * 60_000) {
        await this.store.setOutcome(event.id, 'human_required');
        return 'human_required';
      }
      await this.store.setOutcome(event.id, 'handoff_reply_reserved');
      try {
        await this.client.sendText({ to: event.sender, text: plan.reply, customerMessageAt: event.at, now: this.now() });
        await this.store.setOutcome(event.id, 'handoff_reply_sent');
        return 'handoff_reply_sent';
      } catch (error) {
        await this.store.setOutcome(event.id, 'handoff_reply_uncertain');
        console.error(JSON.stringify({ service: 'whatsapp-automation', outcome: 'handoff_reply_uncertain', status: error.status ?? null, code: error.code ?? null }));
        return 'handoff_reply_uncertain';
      }
    }
    if (!this.enabled) {
      await this.store.setOutcome(event.id, 'automation_disabled');
      return 'automation_disabled';
    }
    if (this.now().getTime() - event.at.getTime() >= 24 * 60 * 60_000) {
      await this.store.setOutcome(event.id, 'outside_service_window');
      return 'outside_service_window';
    }
    if (!await this.store.reserveSend(event.id, conversationId, event.at)) {
      await this.store.setOutcome(event.id, 'send_suppressed');
      return 'send_suppressed';
    }
    try {
      // A reserved send is never automatically retried. A timeout after Meta
      // accepts the request is ambiguous and retrying could duplicate a reply.
      await this.client.sendText({ to: event.sender, text: plan.reply, customerMessageAt: event.at, now: this.now() });
      if (this.aiClient?.enabled) await this.store.appendAiContext?.(conversationId, event.text, plan.reply);
      await this.store.setOutcome(event.id, 'sent');
      return 'sent';
    } catch (error) {
      await this.store.setOutcome(event.id, 'send_uncertain');
      console.error(JSON.stringify({ service: 'whatsapp-automation', outcome: 'send_uncertain', status: error.status ?? null, code: error.code ?? null }));
      return 'send_uncertain';
    }
  }

  async handoff(conversationId, active) {
    if (!this.store || !/^[a-f0-9]{64}$/.test(conversationId)) throw new Error('Invalid conversation');
    await this.store.setHuman(conversationId, active, active ? 'employee_takeover' : null);
  }
}
