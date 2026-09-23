// Native Anthropic Messages API adapter. Disabled unless explicitly configured;
// this code never calls Claude Code or any local agent runtime.
import { MOZZARO_AI_TOPICS } from './mozzaro-knowledge.mjs';

export class ClaudeClient {
  constructor({ apiKey, model, enabled = false, monthlyLimitUsd = 0,
    inputUsdPerMillion = 0, outputUsdPerMillion = 0, fetchImpl = fetch, timeoutMs = 8000 }) {
    this.apiKey = apiKey;
    this.model = model;
    this.enabled = enabled;
    this.monthlyLimitUsd = monthlyLimitUsd;
    this.inputUsdPerMillion = inputUsdPerMillion;
    this.outputUsdPerMillion = outputUsdPerMillion;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  estimateUsd(messages, maxTokens = 220, knowledge = {}) {
    const bytes = messages.reduce((sum, item) => sum + Buffer.byteLength(String(item.content || '')), 0)
      + Buffer.byteLength(JSON.stringify(knowledge)) + 4000;
    const inputTokens = Math.ceil(bytes * 1.25); // byte upper bound plus safety margin for Arabic/system instructions
    return inputTokens * this.inputUsdPerMillion / 1_000_000 + maxTokens * this.outputUsdPerMillion / 1_000_000;
  }

  async answer({ userText, context = [], knowledge }) {
    if (!this.enabled || !this.apiKey || !this.model) throw new Error('Claude disabled');
    const system = [
      'أنت مساعد موزارو لخدمة العملاء عبر واتساب. أجب بلهجة سعودية ودودة ومختصرة.',
      'استخدم الحقائق الموجودة فقط داخل قاعدة المعرفة. لا تستنتج أو تخترع أسعاراً أو أصنافاً أو مكونات أو توفرًا أو سياسات.',
      `اختر فقط معرفات الموضوعات المعتمدة التالية: ${MOZZARO_AI_TOPICS.join(', ')}. استخدم معرف الصنف المطابق لسؤال عن اسمه أو سعره، أو معرف الفئة إذا سأل عن أسعار الفئة.`,
      'في الكيترنق، إجمالي الأصناف ثابت ويشمل أي بوراتا؛ البوراتا اختيارية ويمكن استبدالها ببيتزا عادية أو باستا ضمن نفس الإجمالي. البيتزا والباستا لهما بنية باقات وسعر ابتدائي واحد. الأسعار ابتدائية. الطاقم الحالي رجال فقط. استخدم رقم الكيترنق الحالي الموجود في المعرفة.',
      'لسؤال العاملات أو الطاقم النسائي اختر catering_staff ليظهر أن الفريق الحالي رجال فقط ولا تتوفر عاملات حاليًا. لا تؤكد حجزًا أو توفر موعد. أحِل الحجز والتاريخ والتوفر والطلبات المخصصة والسعر النهائي والطلبات خارج المدينة والكمية غير القياسية للموظف. لا تجب عن التوفر الحالي أو المكونات أو مسببات الحساسية أو أي معلومة غير موجودة صراحة في قاعدة المعرفة. بيتزا الشهر بلا سعر ثابت؛ اختر handoff لطلب تفاصيلها الحالية. إذا كان السؤال غير مغطى بالكامل، أو كان شكوى أو استرجاعاً أو طلباً معقداً أو طلب موظف، اختر handoff.',
      'لا تنشئ نص إجابة ولا تضف موضوعات. أعد JSON فقط: {"action":"answer"|"handoff","topics":["hours"]}. لا تذكر أنك نموذج ذكاء اصطناعي.',
      `قاعدة المعرفة المعتمدة: ${JSON.stringify(knowledge)}`,
    ].join('\n');
    const messages = [...context.slice(-6), { role: 'user', content: userText }];
    const response = await this.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(this.timeoutMs),
      headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, max_tokens: 220, system, messages }),
    });
    let body; try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) {
      const error = new Error('Anthropic request failed');
      error.status = response.status;
      error.code = body.error?.type || null;
      throw error;
    }
    const text = (body.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('').trim();
    let result; try { result = JSON.parse(text); } catch { throw new Error('Claude returned invalid structured response'); }
    const allowedTopics = new Set(MOZZARO_AI_TOPICS);
    if (!['answer', 'handoff'].includes(result.action) || !Array.isArray(result.topics)
      || result.topics.some((topic) => !allowedTopics.has(topic)) || result.topics.length > 4
      || (result.action === 'answer' && result.topics.length === 0)) {
      throw new Error('Claude returned invalid structured response');
    }
    return { action: result.action, topics: result.topics, inputTokens: Number(body.usage?.input_tokens || 0),
      outputTokens: Number(body.usage?.output_tokens || 0) };
  }
}
