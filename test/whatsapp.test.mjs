import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { planWhatsAppReply, isOpenInRiyadh, renderApprovedTopics } from '../src/whatsapp-faq.mjs';
import { WhatsAppClient, MockWhatsAppClient } from '../src/whatsapp-client.mjs';
import { WhatsAppService, extractWhatsAppEvents } from '../src/whatsapp-service.mjs';
import { ClaudeClient } from '../src/claude-client.mjs';
import { createWebhookServer, selfTestWhatsAppChallenge } from '../src/webhook-server.mjs';
import { buildCoexistenceLoginOptions, parseCoexistenceSession } from '../src/coexistence-signup.mjs';
import { MOZZARO_KNOWLEDGE, MOZZARO_AI_TOPICS } from '../src/mozzaro-knowledge.mjs';

const now = new Date('2026-09-23T19:00:00Z');
const phoneId = '816217614914860';
const sample = (text, id = 'wamid.test', at = '1790190000') => ({ object: 'whatsapp_business_account', entry: [{ changes: [
  { field: 'messages', value: { metadata: { phone_number_id: phoneId }, messages: [
    { id, from: '966500000001', timestamp: at, type: 'text', text: { body: text } },
  ] } },
] }] });

class MemoryStore {
  constructor() { this.events = new Map(); this.conversations = new Map(); }
  conversationId(phone, sender) { return createHmac('sha256', 'test-key').update(`${phone}:${sender}`).digest('hex'); }
  async recordEvent({ id, conversationId, type, at }) {
    if (this.events.has(id)) return false;
    this.events.set(id, { conversationId, type, at, outcome: 'received' }); return true;
  }
  async setOutcome(id, outcome) { this.events.get(id).outcome = outcome; }
  async getConversation(id) { return this.conversations.get(id) || null; }
  async setHuman(id, active, reason) { this.conversations.set(id, { ...(this.conversations.get(id) || {}), human_active: active, handoff_reason: reason }); }
  async claimHumanHandoff(id, reason) {
    if (this.conversations.get(id)?.human_active) return false;
    await this.setHuman(id, true, reason); return true;
  }
  async recordCustomerActivity(id, at) { this.conversations.set(id, { ...(this.conversations.get(id) || {}), latest_customer_at: at }); }
  async recordEmployeeActivity(id, at) { this.conversations.set(id, { ...(this.conversations.get(id) || {}), human_active: true, last_employee_at: at }); }
  async getAiContext() { return []; }
  async reserveAiBudget() { return true; }
  async recordAiUsage() {}
  async appendAiContext() {}
  async reserveSend(eventId, conversationId, eventAt) {
    const event = this.events.get(eventId), c = this.conversations.get(conversationId);
    if (event.outcome !== 'received' || c?.human_active || c?.last_employee_at >= eventAt || c?.latest_customer_at > eventAt) return false;
    event.outcome = 'send_reserved'; return true;
  }
  async recent() { return [...this.events.values()].map(({ type, outcome }) => ({ event_type: type, outcome })); }
}

test('approved Arabic greetings, suppliers, orders, catering, and combined questions', () => {
  assert.equal(planWhatsAppReply('السلام عليكم').reply, 'وعليكم السلام ورحمة الله وبركاته');
  assert.equal(planWhatsAppReply('أهلا').reply, 'أهلين');
  const combined = planWhatsAppReply('هلا من وين اللحم والبيبروني ومتى تفتحون؟');
  assert.match(combined.reply, /^أهلين /);
  assert.match(combined.reply, /الدجاج عندنا من ساديا، والبيبروني من أمريكانا/);
  assert.match(combined.reply, /12 ظهرًا إلى 3 صباحًا/);
  assert.equal((combined.reply.match(/أي خدمة ثانية؟/g) || []).length, 1);
  assert.doesNotMatch(planWhatsAppReply('هل الدجاج محلي؟').reply, /محلي ومن ساديا/);
  const cateringContact = planWhatsAppReply('رقم الكيترنق؟');
  assert.match(cateringContact.reply, /0565017314/);
  assert.doesNotMatch(cateringContact.reply, /0545383080/);
});

test('Riyadh opening hours continue after midnight and close at 03:00', () => {
  assert.equal(isOpenInRiyadh(new Date('2026-09-22T21:30:00Z')), true); // 00:30 local
  assert.equal(isOpenInRiyadh(new Date('2026-09-23T00:00:00Z')), false); // 03:00 local
  assert.equal(isOpenInRiyadh(new Date('2026-09-23T09:00:00Z')), true); // noon local
});

test('complaints and unknown questions require human attention and safe fallback', () => {
  assert.equal(planWhatsAppReply('طلبي ناقص وتأخر').reason, 'complaint');
  const unknown = planWhatsAppReply('هل عندكم خصومات اليوم؟');
  assert.equal(unknown.requiresHuman, true);
  assert.match(unknown.reply, /بنحوّل استفسارك للفريق/);
});

test('menu names and SAR prices exactly match the supplied official PDF', () => {
  const expected = [
    ['pizza_margherita', 'pizza', 'مارجريتا', 'Margherita', 29],
    ['pizza_mozzaro', 'pizza', 'بيتزا موزارو', 'Mozzaro Pizza', 34],
    ['pizza_pepperoni', 'pizza', 'بيبروني', 'Pepperoni', 32],
    ['pizza_pesto', 'pizza', 'بيستو', 'Pesto', 33],
    ['pizza_rocotto', 'pizza', 'روكوتو', 'Rocotto', 32],
    ['pizza_burrata', 'pizza', 'بوراتا', 'Burrata', 43],
    ['pizza_month', 'pizza', 'بيتزا الشهر', 'Pizza of the Month', null],
    ['pasta_pink_rigatoni', 'pasta', 'ريغاتوني بينك', 'Pink Rigatoni', 32],
    ['pasta_truffle_rigatoni', 'pasta', 'ريغاتوني ترافل', 'Truffle Rigatoni', 34],
    ['pasta_pesto_casarecce', 'pasta', 'كازاريتشي بيستو', 'Pesto Casarecce', 36],
    ['appetizer_parmesan_potato_balls', 'appetizers', 'كرات البطاطس بالبارميزان', 'Parmesan Potato Balls', 18],
    ['appetizer_ricotta_cheese_balls', 'appetizers', 'كرات جبنة الريكوتا', 'Ricotta Cheese Balls', 18],
    ['appetizer_mac_cheese_balls', 'appetizers', 'كرات ماك آند تشيز', 'Mac & Cheese Balls', 18],
    ['sauce_hot_honey', 'sauces', 'عسل حار', 'Hot Honey', 4],
    ['sauce_spicy_olive_oil', 'sauces', 'زيت زيتون حار', 'Spicy Olive Oil', 4],
    ['sauce_truffle_oil', 'sauces', 'زيت الترفل', 'Truffle Oil', 4],
    ['drink_soft_drinks', 'drinks', 'مشروبات غازية', 'Soft Drinks', 3],
    ['focaccia_turkey_pesto', 'focaccia_sandwiches', 'تيركي بيستو', 'Turkey Pesto', 24],
    ['focaccia_crunchy_chicken', 'focaccia_sandwiches', 'كرانشي دجاج', 'Crunchy Chicken', 26],
    ['focaccia_halloumi_pesto', 'focaccia_sandwiches', 'حلومي بيستو', 'Halloumi Pesto', 24],
    ['focaccia_spicy_tuna', 'focaccia_sandwiches', 'سبايسي تونة', 'Spicy Tuna', 23],
    ['focaccia_salami_bacon', 'focaccia_sandwiches', 'سلامي وبيكن', 'Salami & Bacon', 26],
    ['focaccia_burrata', 'focaccia_sandwiches', 'بوراتا', 'Burrata', 28],
    ['focaccia_bread_garlic_butter', 'focaccia_bread', 'فوكاتشا بالثوم والزبدة', 'Garlic Butter Focaccia', 13],
    ['focaccia_bread_plain', 'focaccia_bread', 'خبزة فوكاتشا', 'Focaccia Bread', 7],
    ['focaccia_bread_vegetable', 'focaccia_bread', 'فوكاتشا بالخضار', 'Vegetable Focaccia', 12],
    ['drink_lavender_limoncello', 'drinks', 'ليمونتشيلو لافندر', 'Lavender Limoncello', 15],
    ['sauce_pesto_tomato', 'sauces', 'صلصة الطماطم بالبيستو', 'Pesto Tomato Sauce', 4],
    ['sauce_pesto', 'sauces', 'صوص البيستو', 'Pesto Sauce', 4],
    ['sauce_mustard_mayo', 'sauces', 'صوص مايو بالخردل', 'Mustard Mayo Sauce', 4],
  ];
  assert.deepEqual(MOZZARO_KNOWLEDGE.menuItems.map(({ id, category, nameAr, nameEn, priceSar }) =>
    [id, category, nameAr, nameEn, priceSar]), expected);
  assert.equal(MOZZARO_KNOWLEDGE.menuItems.length, 30);
  assert.equal(new Set(MOZZARO_KNOWLEDGE.menuItems.map(({ id }) => id)).size, 30);
  assert.equal(MOZZARO_KNOWLEDGE.menuItems.find(({ id }) => id === 'pizza_month').priceSar, null);
});

test('menu FAQ understands Arabic and English item names, categories, and routes unknown details', () => {
  assert.equal(planWhatsAppReply('كم سعر بيتزا المارجريتا؟').reply, 'مارجريتا: 29 ريال.');
  assert.equal(planWhatsAppReply('How much is Truffle Rigatoni?').reply, 'ريغاتوني ترافل: 34 ريال.');
  assert.match(planWhatsAppReply('كم أسعار البيتزا؟').reply, /بوراتا 43 ريال/);
  assert.match(planWhatsAppReply('وش عندكم من صوصات ومشروبات؟').reply, /زيت زيتون حار 4 ريال/);
  assert.equal(planWhatsAppReply('وش أسعار المنيو كامل؟').type, 'document');
  assert.equal(planWhatsAppReply('كم سعر تيركي بيستو؟').reply, 'تيركي بيستو: 24 ريال.');
  assert.match(planWhatsAppReply('وش عندكم فوكاتشا؟').reply, /تيركي بيستو 24 ريال/);
  assert.match(planWhatsAppReply('كم أسعار خبز الفوكاتشا؟').reply, /خبزة فوكاتشا 7 ريال/);
  assert.equal(planWhatsAppReply('كم سعر بوراتا؟').requiresHuman, true);
  for (const question of ['كم سعر تيركي بيستو؟', 'وش عندكم فوكاتشا؟', 'كم أسعار خبز الفوكاتشا؟', 'كم باقة 20 شخص؟']) {
    assert.doesNotMatch(planWhatsAppReply(question).reply, /[A-Za-z]/);
  }
  const month = planWhatsAppReply('كم سعر بيتزا الشهر؟');
  assert.equal(month.requiresHuman, true);
  assert.match(month.reply, /ما لها سعر ثابت/);
  assert.equal(planWhatsAppReply('هل بيتزا المارجريتا متوفرة الآن؟').requiresHuman, true);
  assert.equal(planWhatsAppReply('هل فيها مكسرات؟').requiresHuman, true);
});

test('Claude allowlisted menu topics render only exact reviewed menu facts', () => {
  assert.equal(MOZZARO_AI_TOPICS.includes('menu_pizza_margherita'), true);
  assert.equal(renderApprovedTopics(['menu_pizza_margherita']).reply, 'مارجريتا: 29 ريال.');
  assert.match(renderApprovedTopics(['menu_sauces']).reply, /عسل حار 4 ريال.*زيت زيتون حار 4 ريال.*زيت الترفل 4 ريال/);
  assert.equal(renderApprovedTopics(['menu_all']).type, 'document');
  assert.equal(renderApprovedTopics(['menu_pizza_month']), null);
  assert.equal(renderApprovedTopics(['menu_unverified_item']), null);
});

test('Claude menu topic flows through Render approved copy without free-form generation', async () => {
  const store = new MemoryStore(), client = new MockWhatsAppClient();
  const aiClient = { enabled: true, inputUsdPerMillion: 1, outputUsdPerMillion: 5,
    estimateUsd: () => 0.001, answer: async () => ({ action: 'answer', topics: ['menu_pasta_truffle_rigatoni'], inputTokens: 8, outputTokens: 4 }) };
  const service = new WhatsAppService({ store, client, aiClient, aiMonthlyLimitUsd: 5, knowledge: MOZZARO_KNOWLEDGE,
    phoneNumberId: phoneId, enabled: true, coexistenceVerified: true, allowlist: ['966500000001'], now: () => now });
  assert.deepEqual((await service.process(sample('كم سعر ترافل ريغاتوني؟', 'ai-menu'))).outcomes, { sent: 1 });
  assert.equal(client.sent[0].text, 'ريغاتوني ترافل: 34 ريال.');
});

test('official menu PDF is served unchanged over HTTPS-ready route', async (t) => {
  const server = createWebhookServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/menu/mozzaro.pdf`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8/);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    'c74535c6138fea6abf33a8355704984a49f74251b6e7a26efd61cdb6d8dc7e4d');
});

test('menu PDF stays gated, then sends once only to the approved pilot number', async () => {
  const event = sample('أرسل المنيو', 'menu-pilot');
  event.entry[0].changes[0].value.messages[0].from = '966545383080';
  const store = new MemoryStore();
  const sent = [];
  const client = { sendDocument: async (message) => { sent.push(message); }, sendText: async () => { throw new Error('unexpected text send'); } };
  const base = { store, client, phoneNumberId: phoneId, enabled: true, coexistenceVerified: true,
    allowlist: ['966545383080'], menuDocumentUrl: 'https://mozzaro-instagram-faq-bot.onrender.com/menu/mozzaro.pdf', now: () => now };
  const gated = new WhatsAppService(base);
  assert.deepEqual((await gated.process(event)).outcomes, { menu_document_pending_approval: 1 });
  assert.equal(sent.length, 0);
  const liveEvent = sample('أرسل المنيو', 'menu-pilot-approved');
  liveEvent.entry[0].changes[0].value.messages[0].from = '966545383080';
  const allowed = new WhatsAppService({ ...base, menuDocumentEnabled: true });
  assert.deepEqual((await allowed.process(liveEvent)).outcomes, { sent: 1 });
  assert.deepEqual((await allowed.process(liveEvent)).outcomes, { duplicate: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].filename, 'منيو موزارو.pdf');
  assert.equal(sent[0].caption, 'حياك الله، تفضل منيو موزارو، فيه جميع الأصناف والأسعار.');
  assert.deepEqual((await allowed.process(sample('أرسل المنيو', 'menu-other'))).outcomes, { allowlist_blocked: 1 });
  assert.equal(sent.length, 1);
});

test('document rejection sends one short Arabic fallback and activates handoff', async () => {
  const event = sample('المنيو', 'menu-failed');
  event.entry[0].changes[0].value.messages[0].from = '966545383080';
  const store = new MemoryStore(), fallback = [];
  const client = { sendDocument: async () => { const error = new Error('failed'); error.status = 400; error.code = 131009; throw error; },
    sendText: async (message) => { fallback.push(message); } };
  const service = new WhatsAppService({ store, client, phoneNumberId: phoneId, enabled: true,
    coexistenceVerified: true, allowlist: ['966545383080'], menuDocumentEnabled: true,
    menuDocumentUrl: 'https://mozzaro-instagram-faq-bot.onrender.com/menu/mozzaro.pdf', now: () => now });
  assert.deepEqual((await service.process(event)).outcomes, { menu_document_fallback_sent: 1 });
  assert.deepEqual((await service.process(event)).outcomes, { duplicate: 1 });
  assert.equal(fallback.length, 1);
  assert.match(fallback[0].text, /تعذّر إرسال المنيو/);
  assert.equal((await store.getConversation(store.conversationId(phoneId, '966545383080'))).human_active, true);
});

test('catering PDF and owner updates define every final package capacity, total, Burrata cap, duration, staff, and price', () => {
  const expected = [
    ['basic', 7, 15, 15, 4, 999, 3, 2, ['service_booth', 'boxes', 'serving_sauces', 'soft_drinks', 'city_booth_transport', 'pre_event_setup']],
    ['standard', 20, 25, 30, 6, 1499, 4, 2, ['service_booth', 'boxes', 'serving_sauces', 'soft_drinks', 'city_booth_transport', 'pre_event_setup']],
    ['premium', 40, 50, 60, 12, 2799, 4, 3, ['service_booth', 'boxes', 'plates', 'serving_sauces', 'soft_drinks', 'city_booth_transport', 'pre_event_setup']],
    ['signature', 70, 80, 80, 20, 3699, 6, 3, ['service_booth', 'boxes', 'plates', 'serving_sauces', 'soft_drinks', 'tiramisu_coffee_hospitality', 'city_booth_transport', 'pre_event_setup']],
    ['event', null, 100, 120, 20, 5399, 8, 3, ['service_booth', 'boxes', 'plates', 'serving_sauces', 'soft_drinks', 'tiramisu_coffee_hospitality', 'city_booth_transport', 'pre_event_setup']],
  ];
  assert.deepEqual(MOZZARO_KNOWLEDGE.cateringPackages.map(({ id, guestMin, guestMax, totalItems, burrataMax,
    startingPriceSar, serviceHoursMax, staffCount, inclusions }) =>
    [id, guestMin, guestMax, totalItems, burrataMax, startingPriceSar, serviceHoursMax, staffCount, inclusions]), expected);
  assert.deepEqual(MOZZARO_KNOWLEDGE.cateringPackages.map(({ totalItems, burrataMax }) => totalItems - burrataMax), [11, 24, 48, 60, 100]);
  assert.equal(MOZZARO_KNOWLEDGE.cateringRules.startingPricesOnly, true);
  assert.equal(MOZZARO_KNOWLEDGE.cateringRules.pizzaAndPastaUseSamePackagesAndStartingPrices, true);
  assert.equal(MOZZARO_KNOWLEDGE.cateringRules.pastaHasSeparatePackagePrice, false);
  assert.equal(MOZZARO_KNOWLEDGE.cateringRules.burrataIsOptional, true);
  assert.equal(MOZZARO_KNOWLEDGE.cateringRules.burrataCountsWithinTotalItems, true);
  assert.deepEqual(MOZZARO_KNOWLEDGE.cateringRules.burrataCanBeReplacedBy, ['regular_pizza', 'pasta']);
  assert.equal(MOZZARO_KNOWLEDGE.cateringRules.packageTotalItemsRemainFixed, true);
});

test('catering addon prices match the PDF and by-request/distance charges have no invented prices', () => {
  assert.deepEqual(MOZZARO_KNOWLEDGE.cateringAddons.map(({ id, priceSar, priceRule }) => [id, priceSar, priceRule]), [
    ['tiramisu_cart', 300, undefined], ['extra_pizza', 45, undefined], ['burrata_pizza', 55, undefined],
    ['birthday_organization', 250, undefined], ['occasion_customization', null, 'by_request'],
    ['additional_service_hour', 200, undefined], ['additional_staff_member', 150, undefined],
    ['outside_city_service', null, 'based_on_distance'],
  ]);
});

test('catering FAQ handles guest counts, same-price pasta choices, optional Burrata, staffing, add-ons, and contact safely', () => {
  const standard = planWhatsAppReply('كم باقة 20 شخص؟');
  assert.match(standard.reply, /ستاندرد/); assert.match(standard.reply, /30 صنف إجمالي/);
  assert.match(standard.reply, /تبدأ من 1499 ريال/); assert.doesNotMatch(standard.reply, /0545383080/);
  const premium = planWhatsAppReply('عندي 50 شخص وش يناسبني؟');
  assert.match(premium.reply, /بريميوم/); assert.match(premium.reply, /60 صنف إجمالي/);
  assert.match(premium.reply, /تبدأ من 2799 ريال/);
  assert.match(planWhatsAppReply('كم باقة ٢٠ شخص؟').reply, /ستاندرد/);
  assert.match(planWhatsAppReply('عندكم كيترنق باستا؟').reply, /نفس باقات البيتزا وأسعارها الابتدائية/);
  assert.match(planWhatsAppReply('أقدر أخليها كلها باستا؟').reply, /ما لها تسعيرة باقات منفصلة/);
  assert.match(planWhatsAppReply('أقدر أخلط بيتزا وباستا؟').reply, /ضمن إجمالي عدد أصناف الباقة/);
  assert.match(planWhatsAppReply('البوراتا إجبارية؟').reply, /اختيارية وليست إجبارية/);
  assert.match(planWhatsAppReply('أقدر أشيل البوراتا؟').reply, /تستبدل أي أو كل الكمية/);
  assert.match(planWhatsAppReply('الـ15 بيتزا غير الأربع بوراتا؟').reply, /ضمن إجمالي عدد أصناف الباقة وليست زيادة عليه/);
  const women = planWhatsAppReply('عندكم عاملات؟');
  assert.match(women.reply, /رجال فقط/); assert.match(women.reply, /لا تتوفر عاملات/);
  assert.match(planWhatsAppReply('كم ساعة إضافية؟').reply, /200 ريال/);
  assert.match(planWhatsAppReply('كم سعر تنظيم يوم ميلاد؟').reply, /250 ريال/);
  const contact = planWhatsAppReply('وش رقم الكيترنق؟');
  assert.match(contact.reply, /0565017314/); assert.match(contact.reply, /\+966565017314/);
  assert.doesNotMatch(contact.reply, /0545383080/);
});

test('custom booking, final quote, outside-city service, and unknown catering requests activate handoff', () => {
  for (const text of ['أبي أحجز كيترنق', 'أبي كيترنق عيد ميلاد', 'كم السعر النهائي لباقة Basic؟',
    'تجون خارج الأحساء؟', 'أبغى نكهات معينة وكمية مختلفة', 'هل عندكم خيار غير موجود بالقائمة؟']) {
    assert.equal(planWhatsAppReply(text).requiresHuman, true, text);
  }
  assert.equal(planWhatsAppReply('عندي 60 شخص وش يناسبني؟').requiresHuman, true);
});

test('customer suggestions trigger immediate handoff without an automated answer', () => {
  for (const text of ['عندي اقتراح', 'عندي فكرة', 'عندي شكوى']) {
    const plan = planWhatsAppReply(text);
    assert.equal(plan.requiresHuman, true);
    assert.equal(plan.reply, null);
  }
});

test('Instagram catering answer uses the owner-approved number without changing Instagram reply routing', () => {
  const answer = planWhatsAppReply('رقم الكيترنق؟').reply;
  assert.match(answer, /0565017314/);
  assert.doesNotMatch(answer, /0545383080/);
  assert.match(MOZZARO_KNOWLEDGE.cateringText, /0565017314/);
  assert.doesNotMatch(MOZZARO_KNOWLEDGE.cateringText, /0545383080/);
  assert.match(renderApprovedTopics(['catering_basic']).reply, /15 صنف إجمالي/);
  assert.equal(MOZZARO_AI_TOPICS.includes('catering_burrata'), true);
});

test('Claude adapter uses official Messages API shape and validates safe JSON output', async () => {
  let request;
  const client = new ClaudeClient({ apiKey: 'secret', model: 'test-model', enabled: true,
    inputUsdPerMillion: 1, outputUsdPerMillion: 2,
    fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({
      content: [{ type: 'text', text: '{"action":"answer","topics":["hours"]}' }], usage: { input_tokens: 10, output_tokens: 5 },
    }) }; } });
  const result = await client.answer({ userText: 'هلا', context: [], knowledge: { hoursText: '12 ظهرًا' } });
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.options.headers['anthropic-version'], '2023-06-01');
  assert.equal(JSON.parse(request.options.body).messages[0].content, 'هلا');
  assert.deepEqual(result.topics, ['hours']);
  assert.equal(client.estimateUsd([{ role: 'user', content: 'هلا' }], 220, {}) > 0, true);
});

test('Claude errors are surfaced without leaking provider content', async () => {
  const client = new ClaudeClient({ apiKey: 'secret', model: 'test', enabled: true,
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { type: 'rate_limit_error' } }) }) });
  await assert.rejects(client.answer({ userText: 'test', knowledge: {} }), (error) => error.status === 429 && error.code === 'rate_limit_error');
});

test('Claude handoff activates conversation handoff and sends no reply', async () => {
  const store = new MemoryStore(), client = new MockWhatsAppClient();
  const aiClient = { enabled: true, inputUsdPerMillion: 1, outputUsdPerMillion: 2,
    estimateUsd: () => 0.001, answer: async () => ({ action: 'handoff', topics: [], inputTokens: 2, outputTokens: 2 }) };
  const service = new WhatsAppService({ store, client, aiClient, aiMonthlyLimitUsd: 2, knowledge: { hoursText: '12-3' },
    phoneNumberId: phoneId, enabled: true, coexistenceVerified: true, allowlist: ['966500000001'], now: () => now });
  assert.deepEqual((await service.process(sample('هل عندكم خيارات نباتية؟', 'ai-handoff'))).outcomes, { human_required: 1 });
  assert.equal(store.conversations.get(store.conversationId(phoneId, '966500000001')).human_active, true);
  assert.equal(client.sent.length, 0);
});

test('Claude chooses a verified fact topic while Render supplies the approved Arabic copy', async () => {
  const store = new MemoryStore(), client = new MockWhatsAppClient();
  const aiClient = { enabled: true, inputUsdPerMillion: 1, outputUsdPerMillion: 1,
    estimateUsd: () => 0.001, answer: async () => ({ action: 'answer', topics: ['hours'], inputTokens: 4, outputTokens: 3 }) };
  const service = new WhatsAppService({ store, client, aiClient, aiMonthlyLimitUsd: 2, knowledge: { hoursText: 'verified' },
    phoneNumberId: phoneId, enabled: true, coexistenceVerified: true, allowlist: ['966500000001'], now: () => now });
  assert.deepEqual((await service.process(sample('دوامكم كيف؟', 'ai-hours'))).outcomes, { sent: 1 });
  assert.equal(client.sent[0].text, 'ساعات العمل في موزارو من 12 ظهرًا إلى 3 صباحًا، جميع أيام الأسبوع. أي خدمة ثانية؟');
});

test('Claude is never called for a non-allowlisted customer or complaint', async () => {
  const store = new MemoryStore(), client = new MockWhatsAppClient(); let calls = 0;
  const aiClient = { enabled: true, estimateUsd: () => 0.001, answer: async () => { calls++; return { action: 'answer', topics: ['hours'], inputTokens: 3, outputTokens: 4 }; } };
  const service = new WhatsAppService({ store, client, aiClient, aiMonthlyLimitUsd: 2, knowledge: {}, phoneNumberId: phoneId,
    enabled: true, coexistenceVerified: true, allowlist: ['966500000001'], now: () => now });
  const external = sample('هلا', 'ai-blocked'); external.entry[0].changes[0].value.messages[0].from = '966500000002';
  await service.process(external);
  await service.process(sample('طلبي ناقص', 'ai-complaint'));
  assert.equal(calls, 0);
});

test('monthly Claude budget exhaustion pauses and hands off without sending', async () => {
  const store = new MemoryStore(); store.reserveAiBudget = async () => false;
  const client = new MockWhatsAppClient(); let calls = 0;
  const aiClient = { enabled: true, estimateUsd: () => 0.001, answer: async () => { calls++; } };
  const service = new WhatsAppService({ store, client, aiClient, aiMonthlyLimitUsd: 0.01, knowledge: {}, phoneNumberId: phoneId,
    enabled: true, coexistenceVerified: true, allowlist: ['966500000001'], now: () => now });
  assert.deepEqual((await service.process(sample('وش عندكم؟', 'ai-budget'))).outcomes, { ai_budget_exceeded: 1 });
  assert.equal(calls, 0);
  assert.equal(client.sent.length, 0);
  assert.equal(store.conversations.get(store.conversationId(phoneId, '966500000001')).human_active, true);
});

test('status events are not incoming messages', () => {
  const events = extractWhatsAppEvents({ entry: [{ changes: [{ field: 'messages', value: {
    statuses: [{ id: 'wamid.out', status: 'delivered', timestamp: '123' }],
  } }] }] });
  assert.deepEqual(events.map((event) => event.kind), ['status']);
});

test('persistent event IDs suppress retries and automation defaults off', async () => {
  const store = new MemoryStore();
  const client = new MockWhatsAppClient();
  const service = new WhatsAppService({ store, client, phoneNumberId: phoneId, now: () => now });
  assert.deepEqual((await service.process(sample('متى تفتحون؟', 'first', '1790190000'))).outcomes, { automation_disabled: 1 });
  assert.deepEqual((await service.process(sample('متى تفتحون؟', 'first', '1790190000'))).outcomes, { duplicate: 1 });
  assert.equal(client.sent.length, 0);
});

test('enabled automation requires and enforces a strict test allowlist', async () => {
  const store = new MemoryStore(), client = new MockWhatsAppClient();
  assert.throws(() => new WhatsAppService({ store, client, phoneNumberId: phoneId,
    enabled: true, coexistenceVerified: true }), /non-empty test allowlist/);
  const service = new WhatsAppService({ store, client, phoneNumberId: phoneId, enabled: true,
    coexistenceVerified: true, allowlist: ['+966500000001'], now: () => now });
  assert.deepEqual((await service.process(sample('متى تفتحون؟', 'blocked', '1790190000'))).outcomes, { sent: 1 });
  const blocked = sample('متى تفتحون؟', 'non-allowlisted', '1790190000');
  blocked.entry[0].changes[0].value.messages[0].from = '966500000002';
  assert.deepEqual((await service.process(blocked)).outcomes, { allowlist_blocked: 1 });
  assert.equal(client.sent.length, 1);
});

test('human takeover suppresses replies and can be resumed', async () => {
  const store = new MemoryStore(), client = new MockWhatsAppClient();
  const service = new WhatsAppService({ store, client, phoneNumberId: phoneId, enabled: true,
    coexistenceVerified: true, allowlist: ['966500000001'], now: () => now });
  const id = store.conversationId(phoneId, '966500000001');
  await service.handoff(id, true);
  assert.deepEqual((await service.process(sample('متى تفتحون؟', 'human-1'))).outcomes, { human_active: 1 });
  await service.handoff(id, false);
  assert.deepEqual((await service.process(sample('متى تفتحون؟', 'human-2'))).outcomes, { sent: 1 });
  assert.equal(client.sent.length, 1);
});

test('unknown question gets one safe fallback and persistent handoff', async () => {
  const store = new MemoryStore(), client = new MockWhatsAppClient();
  const service = new WhatsAppService({ store, client, phoneNumberId: phoneId, enabled: true,
    coexistenceVerified: true, allowlist: ['966500000001'], now: () => now });
  assert.deepEqual((await service.process(sample('هل عندكم خصومات اليوم؟', 'unknown-1'))).outcomes, { handoff_reply_sent: 1 });
  assert.deepEqual((await service.process(sample('وش أسعاركم؟', 'unknown-2'))).outcomes, { human_active: 1 });
  assert.equal(client.sent.length, 1);
});

test('late customer event after employee activity does not receive a reply', async () => {
  const store = new MemoryStore(), client = new MockWhatsAppClient();
  const service = new WhatsAppService({ store, client, phoneNumberId: phoneId, enabled: true,
    coexistenceVerified: true, allowlist: ['966500000001'], now: () => now });
  await store.recordEmployeeActivity(store.conversationId(phoneId, '966500000001'), new Date('2026-09-23T18:00:00Z'));
  assert.deepEqual((await service.process(sample('متى تفتحون؟', 'late', '1790180000'))).outcomes, { before_employee_activity: 1 });
  assert.equal(client.sent.length, 0);
});

test('official Coexistence message echo activates human handoff without replying', async () => {
  const store = new MemoryStore(), client = new MockWhatsAppClient();
  const service = new WhatsAppService({ store, client, phoneNumberId: phoneId, enabled: true,
    coexistenceVerified: true, allowlist: ['966500000001'], now: () => now });
  const echo = { entry: [{ changes: [{ field: 'smb_message_echoes', value: {
    metadata: { phone_number_id: phoneId }, message_echoes: [{
      id: 'wamid.employee', to: '966500000001', from: '966565017314', timestamp: '1790190000',
      type: 'text', text: { body: 'private employee reply' },
    }],
  } }] }] };
  assert.deepEqual((await service.process(echo)).outcomes, { employee_activity: 1 });
  assert.deepEqual((await service.process(sample('متى تفتحون؟', 'after-employee', '1790190001'))).outcomes, { human_active: 1 });
  assert.equal(client.sent.length, 0);
});

test('outbound transport enforces disabled state, service window, and API errors', async () => {
  const disabled = new WhatsAppClient({ token: 'test', phoneNumberId: phoneId });
  await assert.rejects(disabled.sendText({ to: '966500000001', text: 'hello', customerMessageAt: now }), /disabled/);
  const calls = [];
  const client = new WhatsAppClient({ token: 'test', phoneNumberId: phoneId, enabled: true,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: false, status: 429,
      headers: { get: () => '10' }, json: async () => ({ error: { code: 4 } }) }; } });
  await assert.rejects(client.sendText({ to: '966500000001', text: 'hello', customerMessageAt: new Date(now - 25 * 3600000), now }), /window/);
  assert.equal(calls.length, 0);
  await assert.rejects(client.sendText({ to: '966500000001', text: 'hello', customerMessageAt: now, now }), (error) => error.status === 429 && error.code === 4);
  assert.equal(calls.length, 1);
});

test('WhatsApp webhook rejects missing signature and malformed signed JSON without exposing content', async (t) => {
  const secret = 'test-secret';
  const server = createWebhookServer({ whatsappAppSecret: secret });
  await new Promise((resolve) => server.listen(0, resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/webhooks/whatsapp`;
  const unsigned = await fetch(url, { method: 'POST', body: '{}' });
  assert.equal(unsigned.status, 401);
  const body = 'not-json';
  const malformed = await fetch(url, { method: 'POST', body, headers: {
    'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
  } });
  assert.equal(malformed.status, 400);
});

test('admin preview requires its token and cannot activate automation', async (t) => {
  const server = createWebhookServer({ adminApiToken: 'admin-test', whatsappEnabled: false });
  await new Promise((resolve) => server.listen(0, resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/admin/whatsapp/status`)).status, 401);
  const response = await fetch(`${base}/admin/whatsapp/preview`, { method: 'POST',
    headers: { Authorization: 'Bearer admin-test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'متى تفتحون؟' }) });
  assert.equal(response.status, 200);
  assert.match((await response.json()).reply, /12 ظهرًا/);
  const status = await fetch(`${base}/admin/whatsapp/status`, { headers: { Authorization: 'Bearer admin-test' } });
  assert.equal((await status.json()).whatsappAutoReplyEnabled, false);
});

test('deployment challenge self-test checks configured token without logging it', async (t) => {
  const server = createWebhookServer({ whatsappVerifyToken: 'private-test-token' });
  await new Promise((resolve) => server.listen(0, resolve)); t.after(() => server.close());
  assert.equal(await selfTestWhatsAppChallenge(server.address().port, 'private-test-token'), true);
  assert.equal(await selfTestWhatsAppChallenge(server.address().port, 'wrong-token'), false);
});

test('prepared signup requests only Coexistence and validates Meta session origin and WABA', () => {
  assert.equal(buildCoexistenceLoginOptions('123').extras.featureType, 'whatsapp_business_app_onboarding');
  const data = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    data: { waba_id: '4133548783569339', phone_number_id: phoneId } };
  assert.equal(parseCoexistenceSession({ origin: 'https://www.facebook.com', data,
    expectedWabaId: '4133548783569339', expectedPhoneNumberId: phoneId }).completed, true);
  assert.throws(() => parseCoexistenceSession({ origin: 'https://evilfacebook.com', data,
    expectedWabaId: '4133548783569339', expectedPhoneNumberId: phoneId }), /Untrusted/);
  assert.throws(() => parseCoexistenceSession({ origin: 'https://www.facebook.com', data,
    expectedWabaId: 'different', expectedPhoneNumberId: phoneId }), /Unexpected WABA/);
});
