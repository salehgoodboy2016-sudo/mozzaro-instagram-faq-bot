import { config, CLAUDE_KNOWLEDGE } from '../src/webhook-server.mjs';
import { WhatsAppStore } from '../src/whatsapp-store.mjs';
import { WhatsAppService } from '../src/whatsapp-service.mjs';
import { KapsoClient } from '../src/kapso-client.mjs';
import { ClaudeClient } from '../src/claude-client.mjs';

if (!config.whatsappDatabaseUrl || !config.whatsappIdentityKey) {
  throw new Error('WhatsApp handoff sweep requires the configured database and identity key');
}
if (!config.kapsoEnabled || !config.kapsoCoexistenceVerified || !config.kapsoEmployeeEchoVerified
  || !config.kapsoApiKey || !config.kapsoPhoneNumberId) {
  throw new Error('WhatsApp handoff sweep requires the existing approved Kapso send configuration');
}

const store = new WhatsAppStore({ databaseUrl: config.whatsappDatabaseUrl, identityKey: config.whatsappIdentityKey });
try {
  await store.initialize();
  const due = await store.claimExpiredHandoffs();
  const audits = due.filter((item) => item.kind === 'audit');
  const pending = due.filter((item) => item.kind === 'incoming')
    .map((event) => ({ ...event, phoneId: config.kapsoPhoneNumberId, pending: true }));
  for (const item of audits) {
    console.log(JSON.stringify({ service: 'whatsapp-handoff', event: 'timeout', resumed: true,
      pendingInquiry: item.hadPending }));
    console.log(JSON.stringify({ service: 'whatsapp-handoff', event: 'ai_resumed',
      pendingInquiry: item.hadPending }));
  }
  for (const item of due.filter((event) => event.kind === 'recovered')) console.log(JSON.stringify({
    service: 'whatsapp-handoff', event: 'pending_recovered_after_restart' }));
  if (pending.length) {
    const client = new KapsoClient({ apiKey: config.kapsoApiKey, phoneNumberId: config.kapsoPhoneNumberId,
      apiVersion: config.kapsoApiVersion, enabled: config.kapsoEnabled && config.kapsoCoexistenceVerified });
    const aiClient = new ClaudeClient({ apiKey: config.claudeApiKey, model: config.claudeModel,
      enabled: config.claudeAiEnabled && Boolean(config.claudeApiKey && config.claudeModel && config.claudeMonthlyLimitUsd > 0
        && config.claudeInputUsdPerMillion > 0 && config.claudeOutputUsdPerMillion > 0) });
    const service = new WhatsAppService({ store, client, aiClient, aiMonthlyLimitUsd: config.claudeMonthlyLimitUsd,
      knowledge: CLAUDE_KNOWLEDGE, enabled: config.kapsoEnabled, coexistenceVerified: config.kapsoCoexistenceVerified,
      phoneNumberId: config.kapsoPhoneNumberId, allowlist: config.whatsappAutomationAllowlist,
      allowAll: config.whatsappAutomationAllowAll, menuDocumentEnabled: config.kapsoMenuDocumentEnabled,
      menuDocumentUrl: config.kapsoMenuDocumentUrl, cateringDocumentEnabled: config.kapsoCateringDocumentEnabled,
      cateringDocumentUrl: config.kapsoCateringDocumentUrl });
    const result = await service.processEvents(pending);
    console.log(JSON.stringify({ service: 'whatsapp-handoff', event: 'pending_resumed', count: pending.length,
      outcomes: result.outcomes }));
  }
} catch (error) {
  console.error(JSON.stringify({ service: 'whatsapp-handoff', outcome: 'sweep_failed',
    status: error.status ?? null, code: error.code ?? null }));
  process.exitCode = 1;
} finally {
  await store.close();
}
