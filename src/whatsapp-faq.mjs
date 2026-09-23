import { normalizeArabic } from './faq.mjs';

const ANSWERS = Object.freeze({
  suppliers: 'الدجاج عندنا من ساديا، والبيبروني من أمريكانا.',
  hours: 'ساعات العمل في موزارو من 12 ظهرًا إلى 3 صباحًا، جميع أيام الأسبوع.',
  catering: 'لتفاصيل الكيترنق، تفضلوا بالتواصل على الواتساب: 0545383080',
  orders: 'للطلبات، اتصلوا على الرقم التالي ويرد عليكم الكاشير: 0565017314',
});

const includes = (text, terms) => terms.some((term) => text.includes(normalizeArabic(term)));

export function isOpenInRiyadh(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(now).find((part) => part.type === 'hour')?.value);
  return hour >= 12 || hour < 3;
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
    return { reply: 'شكرًا لتواصلك مع موزارو. بنحوّل استفسارك للفريق للمتابعة.', topics: [], requiresHuman: true, reason: 'unknown_question' };
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

export { ANSWERS as WHATSAPP_ANSWERS };
