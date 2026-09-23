import { MOZZARO_KNOWLEDGE } from './mozzaro-knowledge.mjs';

const TOPICS = Object.freeze({
  suppliers: 'suppliers',
  localChicken: 'localChicken',
  hours: 'hours',
  catering: 'catering',
  orders: 'orders',
});

const ANSWERS = Object.freeze({
  suppliers: `${MOZZARO_KNOWLEDGE.suppliersText} أي خدمة ثانية؟`,
  localChicken: `${MOZZARO_KNOWLEDGE.localChickenText} أي خدمة ثانية؟`,
  hours: `${MOZZARO_KNOWLEDGE.hoursText} أي خدمة ثانية؟`,
  catering: MOZZARO_KNOWLEDGE.cateringText,
  orders: MOZZARO_KNOWLEDGE.ordersText,
});

function normalizeArabic(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[إ]/g, 'ا')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(text, words) {
  return words.some((word) => text.includes(normalizeArabic(word)));
}

export function classifyFaq(rawText) {
  const text = normalizeArabic(rawText);
  if (!text) return { greeting: null, topics: [], sensitive: false, normalized: text };

  const greeting = hasAny(text, [
    'السلام عليكم', 'سلام عليكم', 'وعليكم السلام', 'salam alaykum', 'assalamu alaikum',
  ]) ? 'islamic' : hasAny(text, ['هلا', 'يا هلا', 'اهلا', 'اهلين', 'مرحبا', 'صباح الخير', 'مساء الخير', 'hello', 'hi', 'hey']) ? 'casual' : null;

  const sensitive = hasAny(text, [
    'شكوى', 'مشكله', 'سيئ', 'سيء', 'زعلان', 'تأخير', 'تاخير', 'استرجاع', 'تعويض',
    'حساسيه', 'حساسية', 'حساس', 'refund', 'complaint', 'allergy', 'تهديد', 'قانوني',
  ]);

  const topics = [];
  const asksAboutLocalChicken = hasAny(text, ['دجاج', 'chicken'])
    && hasAny(text, ['محلي', 'بلدي', 'مستورد', 'من داخل السعودية', 'سعودي']);
  if (asksAboutLocalChicken) topics.push(TOPICS.localChicken);
  else if (hasAny(text, ['دجاج', 'لحم', 'لحوم', 'بيبروني', 'بيبرون', 'ببروني', 'pepperoni', 'مصدر الدجاج', 'المورد', 'مورّد', 'من وين الدجاج'])) topics.push(TOPICS.suppliers);
  if (hasAny(text, ['ساعات العمل', 'مواعيد العمل', 'اوقات الافتتاح', 'وقت الافتتاح', 'مواعيد الفتح', 'اوقات الفتح', 'متى الدوام', 'دوام', 'تفتح', 'يفتح', 'فاتحين', 'مفتوح', 'مفتوحه', 'تقفل', 'يغلق', 'تسكر', 'متى تفتح', 'متى تقفل', 'متى تسكر', 'الان مفتوح', 'الحين مفتوح'])) topics.push(TOPICS.hours);
  if (hasAny(text, ['كيترنق', 'كيترينج', 'كاترينج', 'كيتيرنق', 'كتيرنق', 'catering', 'بوفيه', 'ضيافه', 'ضيافة', 'حجز مناسبه', 'حجز مناسبة'])) topics.push(TOPICS.catering);
  if (hasAny(text, ['طلب', 'اطلب', 'اوردر', 'order', 'ابي اطلب', 'أبي أطلب', 'ابغى اطلب', 'اقدم طلب', 'جهزوا لي', 'تجهيز الطلب', 'طلب مسبق', 'مسبق', 'كيف اطلب', 'توصيل'])) topics.push(TOPICS.orders);

  return { greeting, topics: [...new Set(topics)], sensitive, normalized: text };
}

function isOpenNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MOZZARO_KNOWLEDGE.timezone, hour: 'numeric', hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  return hour >= MOZZARO_KNOWLEDGE.opensAtHour || hour < MOZZARO_KNOWLEDGE.closesAtHour;
}

export function composeReply(rawText, now = new Date(), topicFilter = null) {
  const result = classifyFaq(rawText);
  if (result.sensitive) {
    return { ...result, reply: null, requiresHuman: result.sensitive };
  }

  const selectedTopics = topicFilter ? result.topics.filter((topic) => topicFilter.includes(topic)) : result.topics;
  if (selectedTopics.length === 0) {
    return { ...result, reply: null, requiresHuman: false };
  }

  const parts = [];
  if (result.greeting === 'islamic') parts.push('وعليكم السلام،');
  if (result.greeting === 'casual') parts.push('أهلين،');

  for (const topic of selectedTopics) {
    if (topic === TOPICS.hours && /مفتوح|فاتحين|الان|الحين|open|now/.test(result.normalized)) {
      parts.push(`${isOpenNow(now) ? 'نعم، مفتوح الآن.' : 'حاليًا مغلق.'} ${ANSWERS.hours}`);
    } else {
      parts.push(ANSWERS[topic]);
    }
  }
  return { ...result, reply: parts.join(' '), requiresHuman: false };
}

export { ANSWERS, TOPICS, normalizeArabic };
