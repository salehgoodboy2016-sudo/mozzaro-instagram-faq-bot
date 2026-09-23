import { normalizeArabic } from './faq.mjs';
import { MOZZARO_KNOWLEDGE } from './mozzaro-knowledge.mjs';

const ANSWERS = Object.freeze({
  suppliers: MOZZARO_KNOWLEDGE.suppliersText,
  hours: MOZZARO_KNOWLEDGE.hoursText,
  catering: MOZZARO_KNOWLEDGE.cateringText,
  orders: MOZZARO_KNOWLEDGE.ordersText,
});

const MENU_GROUPS = Object.freeze({
  menu_pizza: 'pizza', menu_pasta: 'pasta', menu_appetizers: 'appetizers',
  menu_sauces: 'sauces', menu_drinks: 'drinks',
});
const MENU_ALIASES = Object.freeze({
  pizza_margherita: ['مارجريتا', 'مارغريتا', 'margherita'],
  pizza_mozzaro: ['بيتزا موزارو', 'موزارو بيتزا', 'mozzaro pizza'],
  pizza_pepperoni: ['بيبروني', 'ببروني', 'pepperoni'],
  pizza_pesto: ['بيتزا بيستو', 'بيستو بيتزا', 'بيستو', 'pesto pizza', 'pesto'],
  pizza_rocotto: ['rocotto', 'روكوتو', 'ريكوتا'],
  pizza_burrata: ['بوراتا', 'burrata'],
  pizza_month: ['بيتزا الشهر', 'بيتزا الشهرية', 'pizza of the month'],
  pasta_pink_rigatoni: ['بينك ريغاتوني', 'ريغاتوني بينك', 'pink rigatoni'],
  pasta_truffle_rigatoni: ['ترافل ريغاتوني', 'ريغاتوني ترافل', 'truffle rigatoni'],
  pasta_pesto_casarecce: ['بيستو كازاريتشي', 'كازاريتشي بيستو', 'بيستو', 'pesto casarecce', 'pesto'],
  appetizer_parmesan_potato_balls: ['كرات البطاطس بالبارميزان', 'parmesan potato balls'],
  appetizer_ricotta_cheese_balls: ['كرات جبنة الريكوتا', 'كرات الريكوتا', 'ricotta cheese balls'],
  appetizer_mac_cheese_balls: ['كرات ماك اند تشيز', 'كرات ماك تشيز', 'mac and cheese balls', 'mac cheese balls'],
  sauce_hot_honey: ['عسل حار', 'hot honey'],
  sauce_spicy_olive_oil: ['زيت زيتون حار', 'spicy olive oil'],
  sauce_truffle_oil: ['زيت الترفل', 'truffle oil'],
  drink_soft_drinks: ['مشروبات غازية', 'مشروب غازي', 'soft drinks'],
});

const includes = (text, terms) => terms.some((term) => text.includes(normalizeArabic(term)));

function menuTopicsFor(text) {
  const topics = [];
  const pastaAsked = includes(text, ['باستا', 'مكرونه', 'pasta', 'rigatoni', 'casarecce']);
  const pizzaAsked = includes(text, ['بيتزا', 'pizza']);
  const itemMatches = Object.entries(MENU_ALIASES).filter(([, aliases]) => includes(text, aliases));
  for (const [id] of itemMatches) {
    if (id === 'pizza_pesto' && pastaAsked && !pizzaAsked) continue;
    if (id === 'pasta_pesto_casarecce' && pizzaAsked && !pastaAsked) continue;
    topics.push(`menu_${id}`);
  }
  if (topics.length) return [...new Set(topics)];
  if (includes(text, ['كل المنيو', 'المنيو كامل', 'القائمة كاملة', 'كل القائمة', 'menu'])) return ['menu_all'];
  const groups = [];
  if (pizzaAsked) groups.push('menu_pizza');
  if (pastaAsked) groups.push('menu_pasta');
  if (includes(text, ['مقبلات', 'اطباق جانبيه', 'appetizers', 'appetizer'])) groups.push('menu_appetizers');
  if (includes(text, ['صوص', 'صوصات', 'sauce', 'sauces'])) groups.push('menu_sauces');
  if (includes(text, ['مشروبات', 'مشروب', 'drinks', 'drink'])) groups.push('menu_drinks');
  if (groups.length) return groups;
  if (includes(text, ['المنيو', 'القائمه', 'الاسعار', 'الأسعار', 'منيو', 'menu'])) return ['menu_all'];
  return [];
}

function renderMenuTopic(topic) {
  if (topic === 'menu_pizza_month') return null;
  const items = MOZZARO_KNOWLEDGE.menuItems;
  const id = topic.startsWith('menu_') ? topic.slice('menu_'.length) : '';
  const item = items.find(({ id: itemId }) => itemId === id);
  if (item) {
    if (item.priceSar == null) return null;
    return `${item.nameAr} (${item.nameEn}): ${item.priceSar} ريال.`;
  }
  if (topic === 'menu_all') {
    const priced = items.filter(({ priceSar }) => priceSar != null).map(formatMenuItem);
    priced.push('بيتزا الشهر: السعر الحالي يحدده الموظفون.');
    return `أسعار القائمة بالريال: ${priced.join('، ')}.`;
  }
  const category = MENU_GROUPS[topic];
  if (!category) return null;
  const groupItems = items.filter((entry) => entry.category === category);
  if (!groupItems.length) return null;
  const prices = groupItems.filter(({ priceSar }) => priceSar != null).map(formatMenuItem);
  if (category === 'pizza') prices.push('بيتزا الشهر: السعر الحالي يحدده الموظفون');
  return `أسعار ${category === 'pizza' ? 'البيتزا' : category === 'pasta' ? 'الباستا' : category === 'appetizers' ? 'المقبلات' : category === 'sauces' ? 'الصوصات' : 'المشروبات'} بالريال: ${prices.join('، ')}.`;
}

function formatMenuItem(item) {
  return `${item.nameAr} (${item.nameEn}) ${item.priceSar} ريال`;
}

function isMenuAvailabilityQuestion(text, topics) {
  const explicit = includes(text, ['متوفر', 'متوفره', 'موجود', 'available', 'availability', 'مكونات', 'مكوناته', 'حساسيه', 'allergen', 'ingredients']);
  const asksWhetherStocked = includes(text, ['عندكم'])
    && topics.some((topic) => !['menu_pizza', 'menu_pasta', 'menu_appetizers', 'menu_sauces', 'menu_drinks', 'menu_all'].includes(topic));
  return explicit || asksWhetherStocked;
}

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
  const menuTopics = menuTopicsFor(text);
  if (menuTopics.length && isMenuAvailabilityQuestion(text, menuTopics)) {
    return { reply: MOZZARO_KNOWLEDGE.unknownHandoffText, topics: [], requiresHuman: true, reason: 'unknown_question' };
  }
  if (menuTopics.includes('menu_pizza_month') || menuTopics.includes('menu_pizza')) {
    if (includes(text, MENU_ALIASES.pizza_month)) {
      return { reply: 'بيتزا الشهر ما لها سعر ثابت بالقائمة. بنحوّل استفسارك للفريق لمعرفة التفاصيل الحالية.',
        topics: [], requiresHuman: true, reason: 'unknown_question' };
    }
  }
  if (menuTopics.length) topics.push(...menuTopics);
  if (includes(text, ['دجاج', 'لحم', 'لحوم', 'مصدر', 'مورد', 'chicken', 'meat'])
    || (includes(text, ['بيبروني', 'ببروني', 'pepperoni']) && includes(text, ['من وين', 'مصدر', 'مورد', 'supplier']))) topics.push('suppliers');
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
    if (topic.startsWith('menu_')) {
      const menuAnswer = renderMenuTopic(topic);
      if (menuAnswer) parts.push(menuAnswer);
      continue;
    }
    if (topic === 'hours' && includes(text, ['مفتوح', 'فاتحين', 'الحين', 'الان', 'open now'])) {
      parts.push(isOpenInRiyadh(now) ? 'نعم، مفتوح الآن.' : 'حاليًا مغلق.');
    }
    parts.push(ANSWERS[topic]);
  }
  if (topics.some((topic) => topic === 'suppliers' || topic === 'hours')) parts.push('أي خدمة ثانية؟');
  return { reply: parts.join(' '), topics, requiresHuman: false };
}

export function renderApprovedTopics(topics, now = new Date()) {
  const allowed = new Set(['suppliers', 'hours', 'catering', 'orders', 'menu_pizza', 'menu_pasta',
    'menu_appetizers', 'menu_sauces', 'menu_drinks', 'menu_all',
    ...MOZZARO_KNOWLEDGE.menuItems.map(({ id }) => `menu_${id}`)]);
  if (!Array.isArray(topics) || !topics.length || topics.some((topic) => !allowed.has(topic))) return null;
  const parts = [];
  for (const topic of [...new Set(topics)]) {
    if (topic.startsWith('menu_')) {
      const menuAnswer = renderMenuTopic(topic);
      if (!menuAnswer) return null;
      parts.push(menuAnswer);
    } else if (topic === 'hours') parts.push(ANSWERS.hours);
    else parts.push(ANSWERS[topic]);
  }
  if (topics.some((topic) => topic === 'suppliers' || topic === 'hours')) parts.push('أي خدمة ثانية؟');
  return { reply: parts.join(' '), topics: [...new Set(topics)], requiresHuman: false };
}

export { ANSWERS as WHATSAPP_ANSWERS };
