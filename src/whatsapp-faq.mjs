import { normalizeArabic } from './faq.mjs';
import { MOZZARO_KNOWLEDGE } from './mozzaro-knowledge.mjs';

const ANSWERS = Object.freeze({
  suppliers: MOZZARO_KNOWLEDGE.suppliersText,
  hours: MOZZARO_KNOWLEDGE.hoursText,
  catering: MOZZARO_KNOWLEDGE.cateringText,
  orders: MOZZARO_KNOWLEDGE.ordersText,
});

const includes = (text, terms) => terms.some((term) => text.includes(normalizeArabic(term)));

export function isOpenInRiyadh(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: MOZZARO_KNOWLEDGE.timezone, hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(now).find((part) => part.type === 'hour')?.value);
  return hour >= MOZZARO_KNOWLEDGE.opensAtHour || hour < MOZZARO_KNOWLEDGE.closesAtHour;
}

export function planWhatsAppReply(rawText, now = new Date()) {
  const text = normalizeArabic(rawText);
  if (!text) return { reply: null, topics: [], requiresHuman: true, reason: 'unsupported_content' };

  const islamicGreeting = includes(text, ['السلام عليكم', 'سلام عليكم']);
  const casualGreeting = !islamicGreeting && includes(text, ['هلا', 'اهلا', 'أهلا', 'مرحبا', 'يا هلا']);
  const complaint = includes(text, [
    'شكوى', 'اشتك', 'زعلان', 'سيء', 'سيئ', 'غلط', 'خطا', 'تأخر', 'تاخير', 'متاخر',
    'ناقص', 'مفقود', 'ما وصل', 'ماجاني', 'طلب غلط', 'استرجاع', 'تعويض', 'refund',
    'complaint', 'wrong order', 'missing item', 'late delivery', 'حساسيه', 'حساس',
  ]);
  if (complaint) return { reply: null, topics: [], requiresHuman: true, reason: 'complaint' };
  if (includes(text, ['موظف', 'موظفه', 'اكلم احد', 'اكلم شخص', 'ابي اكلم', 'ابغى اكلم', 'كلموني', 'طلب معقد', 'تعديل على الطلب'])) {
    return { reply: null, topics: [], requiresHuman: true, reason: 'human_request' };
  }

  const topics = [];
  if (includes(text, ['دجاج', 'لحم', 'لحوم', 'مصدر', 'مورد', 'بيبروني', 'ببروني', 'pepperoni', 'chicken', 'meat'])) topics.push('suppliers');
  if (includes(text, ['ساعات', 'اوقات', 'دوام', 'تفتح', 'يفتح', 'فاتحين', 'مفتوح', 'تقفل', 'تسكر', 'متى تفتح', 'متى تقفل', 'hours', 'open'])) topics.push('hours');
  if (includes(text, ['كيترنق', 'كيترينج', 'كترنق', 'كاترينج', 'بوفيه', 'ضيافه', 'catering'])) topics.push('catering');
  if (includes(text, ['اطلب', 'طلب', 'اوردر', 'توصيل', 'order', 'الكاشير'])) topics.push('orders');

  const greeting = islamicGreeting ? 'وعليكم السلام ورحمة الله وبركاته' : casualGreeting ? 'أهلين' : null;
  if (!topics.length) {
    if (greeting && includes(text, ['السلام عليكم', 'سلام عليكم', 'هلا', 'اهلا', 'مرحبا', 'يا هلا']) && text.split(' ').length <= 3) {
      return { reply: greeting, topics: ['greeting'], requiresHuman: false };
    }
    return { reply: MOZZARO_KNOWLEDGE.unknownHandoffText, topics: [], requiresHuman: true, reason: 'unknown_question' };
  }

  const parts = greeting ? [greeting] : [];
  for (const topic of topics) {
    if (topic === 'hours' && includes(text, ['مفتوح', 'فاتحين', 'الحين', 'الان', 'open now'])) {
      parts.push(isOpenInRiyadh(now) ? 'نعم، مفتوح الآن.' : 'حاليًا مغلق.');
    }
    parts.push(ANSWERS[topic]);
  }
  if (topics.some((topic) => topic === 'suppliers' || topic === 'hours')) parts.push('أي خدمة ثانية؟');
  return { reply: parts.join(' '), topics, requiresHuman: false };
}

export function renderApprovedTopics(topics, now = new Date()) {
  const allowed = new Set(['suppliers', 'hours', 'catering', 'orders']);
  if (!Array.isArray(topics) || !topics.length || topics.some((topic) => !allowed.has(topic))) return null;
  const parts = [];
  for (const topic of [...new Set(topics)]) {
    if (topic === 'hours') parts.push(ANSWERS.hours);
    else parts.push(ANSWERS[topic]);
  }
  if (topics.some((topic) => topic === 'suppliers' || topic === 'hours')) parts.push('أي خدمة ثانية؟');
  return { reply: parts.join(' '), topics: [...new Set(topics)], requiresHuman: false };
}

export { ANSWERS as WHATSAPP_ANSWERS };
