const TOPICS = Object.freeze({
  suppliers: 'suppliers',
  localChicken: 'localChicken',
  hours: 'hours',
  catering: 'catering',
  orders: 'orders',
});

const ANSWERS = Object.freeze({
  suppliers: 'الدجاج عندنا من ساديا، والبيبروني من أمريكانا. أي خدمة ثانية؟',
  localChicken: 'الدجاج عندنا محلي ومن ساديا، والبيبروني من أمريكانا. أي خدمة ثانية؟',
  hours: 'ساعات العمل في موزارو من 12 ظهرًا إلى 3 صباحًا، جميع أيام الأسبوع. أي خدمة ثانية؟',
  catering: 'لتفاصيل الكيترنق، تفضلوا بالتواصل على الواتساب: 0545383080',
  orders: 'للطلبات، اتصلوا على الرقم التالي ويرد عليكم الكاشير: 0565017314',
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
    timeZone: 'Asia/Riyadh', hour: 'numeric', hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  return hour >= 12 || hour < 3;
}

export function composeReply(rawText, now = new Date(), topicFilter = null) {
  const result = classifyFaq(rawText);
  if (result.sensitive || result.topics.length === 0 && !result.greeting) {
    return { ...result, reply: null, requiresHuman: result.sensitive };
  }

  const selectedTopics = topicFilter ? result.topics.filter((topic) => topicFilter.includes(topic)) : result.topics;
  const parts = [];
  if (result.greeting === 'islamic') parts.push('وعليكم السلام ورحمة الله وبركاته');
  if (result.greeting === 'casual') parts.push('أهلين');

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
