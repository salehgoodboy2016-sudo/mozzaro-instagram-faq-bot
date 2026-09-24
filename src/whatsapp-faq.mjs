import { normalizeArabic } from './faq.mjs';
import { MOZZARO_KNOWLEDGE } from './mozzaro-knowledge.mjs';

const ANSWERS = Object.freeze({
  suppliers: MOZZARO_KNOWLEDGE.suppliersText,
  hours: MOZZARO_KNOWLEDGE.hoursText,
  catering: MOZZARO_KNOWLEDGE.cateringText,
  orders: MOZZARO_KNOWLEDGE.ordersText,
});

const CATERING_INCLUSION_TEXT = Object.freeze({
  service_booth: 'بوث تقديم', boxes: 'بوكسات', plates: 'صحون', serving_sauces: 'صوصات تقديم',
  soft_drinks: 'مشروبات غازية', city_booth_transport: 'نقل البوث داخل المدينة',
  pre_event_setup: 'تجهيز وترتيب قبل الموعد', tiramisu_coffee_hospitality: 'ضيافة تيراميسو وقهوة',
});
const CATERING_PACKAGE_ALIASES = Object.freeze({
  basic: ['basic', 'بيسك', 'باقة بيسك'],
  standard: ['standard', 'ستاندرد', 'باقة ستاندرد'],
  premium: ['premium', 'بريميوم', 'باقة بريميوم'],
  signature: ['signature', 'سيغنتشر', 'سيجنشر', 'باقة سيغنتشر'],
  event: ['event', 'ايفنت', 'إيفنت', 'باقة ايفنت'],
});
const CATERING_PACKAGE_NAMES_AR = Object.freeze({
  basic: 'بيسك', standard: 'ستاندرد', premium: 'بريميوم', signature: 'سيغنتشر', event: 'إيفنت',
});

const MENU_GROUPS = Object.freeze({
  menu_pizza: 'pizza', menu_pasta: 'pasta', menu_appetizers: 'appetizers',
  menu_sauces: 'sauces', menu_drinks: 'drinks',
  menu_focaccia_sandwiches: 'focaccia_sandwiches', menu_focaccia_bread: 'focaccia_bread',
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
  focaccia_turkey_pesto: ['تيركي بيستو', 'تركي بيستو', 'turkey pesto'],
  focaccia_crunchy_chicken: ['كرانشي دجاج', 'كرانشي تشيكن', 'crunchy chicken'],
  focaccia_halloumi_pesto: ['حلومي بيستو', 'halloumi pesto'],
  focaccia_spicy_tuna: ['سبايسي تونة', 'سبايسي تونا', 'spicy tuna'],
  focaccia_salami_bacon: ['سلامي وبيكن', 'سلامي بيكن', 'salami bacon'],
  focaccia_burrata: ['فوكاتشا بوراتا', 'ساندويتش بوراتا', 'focaccia burrata'],
  focaccia_bread_garlic_butter: ['فوكاتشا بالثوم والزبدة', 'فوكاتشا ثوم وزبدة', 'garlic butter focaccia'],
  focaccia_bread_plain: ['خبزة فوكاتشا', 'خبز فوكاتشا', 'focaccia bread'],
  focaccia_bread_vegetable: ['فوكاتشا بالخضار', 'فوكاتشا خضار', 'vegetable focaccia'],
  drink_lavender_limoncello: ['ليمونتشيلو لافندر', 'لافندر ليمونتشيلو', 'lavender limoncello'],
  sauce_pesto_tomato: ['صلصة الطماطم بالبيستو', 'صوص طماطم بيستو', 'pesto tomato sauce'],
  sauce_pesto: ['صوص البيستو', 'صوص بيستو', 'pesto sauce'],
  sauce_mustard_mayo: ['صوص مايو بالخردل', 'مايو خردل', 'mustard mayo sauce'],
});

const includes = (text, terms) => terms.some((term) => text.includes(normalizeArabic(term)));

function menuTopicsFor(text) {
  const topics = [];
  const pastaAsked = includes(text, ['باستا', 'مكرونه', 'pasta', 'rigatoni', 'casarecce']);
  const pizzaAsked = includes(text, ['بيتزا', 'pizza']);
  const focacciaAsked = includes(text, ['فوكاتشا', 'فوكاشا', 'focaccia']);
  const sauceAsked = includes(text, ['صوص', 'صلصة', 'sauce']);
  const itemMatches = Object.entries(MENU_ALIASES).filter(([, aliases]) => includes(text, aliases));
  const specificFocaccia = itemMatches.some(([id]) => id.startsWith('focaccia_'));
  for (const [id] of itemMatches) {
    if (id === 'pizza_pesto' && pastaAsked && !pizzaAsked) continue;
    if (id === 'pasta_pesto_casarecce' && pizzaAsked && !pastaAsked) continue;
    if (['pizza_pesto', 'pasta_pesto_casarecce'].includes(id) && (focacciaAsked || specificFocaccia || sauceAsked)) continue;
    if (id === 'pizza_burrata' && focacciaAsked && !pizzaAsked) continue;
    topics.push(`menu_${id}`);
  }
  if (topics.length) return [...new Set(topics)];
  if (includes(text, ['كل المنيو', 'المنيو كامل', 'القائمة كاملة', 'كل القائمة', 'menu'])) return ['menu_all'];
  const groups = [];
  if (pizzaAsked) groups.push('menu_pizza');
  if (pastaAsked) groups.push('menu_pasta');
  if (focacciaAsked) groups.push(includes(text, ['خبز', 'خبزة', 'bread']) ? 'menu_focaccia_bread' : 'menu_focaccia_sandwiches');
  if (includes(text, ['مقبلات', 'اطباق جانبيه', 'appetizers', 'appetizer'])) groups.push('menu_appetizers');
  if (includes(text, ['صوص', 'صوصات', 'sauce', 'sauces'])) groups.push('menu_sauces');
  if (includes(text, ['مشروبات', 'مشروب', 'عصير', 'drinks', 'drink'])) groups.push('menu_drinks');
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
    return `${item.nameAr}: ${item.priceSar} ريال.`;
  }
  if (topic === 'menu_all') {
    return null;
  }
  const category = MENU_GROUPS[topic];
  if (!category) return null;
  const groupItems = items.filter((entry) => entry.category === category);
  if (!groupItems.length) return null;
  const prices = groupItems.filter(({ priceSar }) => priceSar != null).map(formatMenuItem);
  if (category === 'pizza') prices.push('بيتزا الشهر: السعر الحالي يحدده الموظفون');
  const title = { pizza: 'البيتزا', pasta: 'الباستا', appetizers: 'المقبلات', sauces: 'الصوصات',
    drinks: 'المشروبات', focaccia_sandwiches: 'ساندويتشات الفوكاتشا', focaccia_bread: 'خبز الفوكاتشا' }[category];
  return `أسعار ${title}: ${prices.join('، ')}.`;
}

function formatMenuItem(item) {
  return `${item.nameAr} ${item.priceSar} ريال`;
}

function isMenuAvailabilityQuestion(text, topics) {
  const explicit = includes(text, ['متوفر', 'متوفره', 'موجود', 'available', 'availability', 'مكونات', 'مكوناته', 'حساسيه', 'allergen', 'ingredients']);
  const asksWhetherStocked = includes(text, ['عندكم'])
    && topics.some((topic) => !Object.hasOwn(MENU_GROUPS, topic) && topic !== 'menu_all');
  return explicit || asksWhetherStocked;
}

function isCateringQuestion(text) {
  return includes(text, ['كيترنق', 'كيترينج', 'كترنق', 'كاترينج', 'catering', 'بوفيه', 'باقة', 'باقات',
    'عندكم عاملات', 'الطاقم نسائي', 'موظفات للكيترنق', 'كم عامل', 'عدد العمال', 'الطاقم', 'staff count', 'how many staff',
    'كم تجلسون', 'مدة الخدمة', 'مدة الباقة', 'service duration', 'how long', 'مقبلات للكيترنق', 'بيتزا وباستا', 'بيتزا او باستا',
    'بيتزا أو باستا', 'بوراتا اجبارية', 'البوراتا اجباريه', 'اشيل البوراتا', 'استبدل البوراتا', 'بدل البوراتا'])
    || Object.values(CATERING_PACKAGE_ALIASES).some((aliases) => includes(text, aliases))
    || (/[0-9٠-٩۰-۹]/.test(text) && includes(text, ['شخص', 'اشخاص', 'ضيف', 'ضيوف', 'guest', 'people', 'person']))
    || (includes(text, ['بوراتا']) && includes(text, ['العدد', 'الإجمالي', 'الاجمالي', 'ضمن الباقة', 'اجبارية', 'اشيل', 'استبدل', 'بدل', 'غير الاربع']))
    || (includes(text, ['بيتزا', 'باستا', 'pasta', 'pizza']) && includes(text, ['اخلط', 'اخلطها', 'كلها باستا', 'بدلها', 'مكس', 'mix']));
}

function renderCateringPackage(packageId) {
  const pack = MOZZARO_KNOWLEDGE.cateringPackages.find(({ id }) => id === packageId);
  if (!pack) return null;
  const guests = pack.guestMin == null ? `حتى ${pack.guestMax} ضيف` : `${pack.guestMin}–${pack.guestMax} ضيف`;
  const workers = pack.staffCount === 2 ? 'رجلين من الطاقم' : 'ثلاثة رجال من الطاقم';
  const inclusions = pack.inclusions.map((item) => CATERING_INCLUSION_TEXT[item]).filter(Boolean).join('، ');
  return `باقة ${CATERING_PACKAGE_NAMES_AR[pack.id]} مناسبة لـ${guests}: ${pack.totalItems} صنف إجمالي، وحتى ${pack.burrataMax} بيتزا بوراتا اختيارية ضمن الإجمالي (تقدر تستبدلها ببيتزا عادية أو باستا). تبدأ من ${pack.startingPriceSar} ريال، والخدمة حتى ${pack.serviceHoursMax} ساعات، ويجي معها ${workers}. تشمل ${inclusions}.`;
}

function renderCateringTopic(topic) {
  if (topic.startsWith('catering_addon_')) {
    const addonId = topic.slice('catering_addon_'.length);
    const addon = MOZZARO_KNOWLEDGE.cateringAddons.find(({ id }) => id === addonId);
    return addon?.priceSar == null ? null : `${addon.nameAr} سعرها ${addon.priceSar} ريال.`;
  }
  if (topic.startsWith('catering_') && MOZZARO_KNOWLEDGE.cateringPackages.some(({ id }) => topic === `catering_${id}`)) {
    return renderCateringPackage(topic.slice('catering_'.length));
  }
  if (topic === 'catering_packages') {
    const lines = MOZZARO_KNOWLEDGE.cateringPackages.map((pack) =>
      `${CATERING_PACKAGE_NAMES_AR[pack.id]}: ${pack.guestMin == null ? `حتى ${pack.guestMax}` : `${pack.guestMin}–${pack.guestMax}`} ضيف، ${pack.totalItems} صنف إجمالي (حتى ${pack.burrataMax} بوراتا اختيارية ضمنها)، تبدأ من ${pack.startingPriceSar} ريال`);
    return `باقات الكيترنق وأسعارها الابتدائية: ${lines.join('؛ ')}. السعر النهائي والتوفر يؤكدهما الفريق.`;
  }
  if (topic === 'catering_types') return 'تقدر تختار بيتزا فقط، أو باستا فقط، أو تخلط بيتزا وباستا ضمن إجمالي عدد أصناف الباقة. الباستا لها نفس باقات البيتزا وأسعارها الابتدائية، وما لها تسعيرة باقات منفصلة.';
  if (topic === 'catering_burrata') return 'البوراتا اختيارية وليست إجبارية، وكمّيتها ضمن إجمالي عدد أصناف الباقة وليست زيادة عليه. تقدر تستبدل أي أو كل الكمية المخصصة ببيتزا عادية أو باستا، ويبقى إجمالي العدد ثابتًا.';
  if (topic === 'catering_staff') return `${MOZZARO_KNOWLEDGE.cateringStaffGenderText} عدد الطاقم حسب الباقة: بيسك وستاندرد رجلان، وبريميوم وسيغنتشر وإيفنت ثلاثة رجال.`;
  if (topic === 'catering_hours') return 'مدة الخدمة القصوى حسب الباقة: بيسك حتى 3 ساعات، وستاندرد وبريميوم حتى 4 ساعات، وسيغنتشر حتى 6 ساعات، وإيفنت حتى 8 ساعات.';
  if (topic === 'catering_inclusions') return 'تشمل الباقات بوث التقديم، وتجهيزًا قبل الموعد، ونقل البوث داخل المدينة، وصوصات تقديم ومشروبات غازية. بيسك وستاندرد تشملان بوكسات؛ وبريميوم وسيغنتشر وإيفنت تشمل بوكسات وصحون؛ وسيغنتشر وإيفنت تشملان أيضًا ضيافة تيراميسو وقهوة.';
  if (topic === 'catering_addons') {
    const listed = MOZZARO_KNOWLEDGE.cateringAddons.map((addon) => addon.priceSar == null
      ? `${addon.nameAr}: ${addon.priceRule === 'based_on_distance' ? 'حسب المسافة' : 'حسب الطلب'}`
      : `${addon.nameAr}: ${addon.priceSar} ريال`);
    return `الإضافات: ${listed.join('؛ ')}. أي طلب مخصص أو عرض نهائي يحتاج تأكيد الفريق.`;
  }
  if (topic === 'catering_contact' || topic === 'catering') {
    return `لتفاصيل وحجوزات الكيترنق تواصلوا على ${MOZZARO_KNOWLEDGE.cateringContact} (${MOZZARO_KNOWLEDGE.cateringContactInternational}).`;
  }
  return null;
}

function cateringTopicsFor(text) {
  const femaleStaff = includes(text, ['عاملات', 'الطاقم نسائي', 'موظفات للكيترنق', 'فيه موظفات']);
  if (femaleStaff) return ['catering_staff'];

  const latinDigits = text.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
  const number = Number(latinDigits.match(/(?:^|\s)(\d{1,3})(?:\s|$)/)?.[1]);
  if (Number.isFinite(number) && includes(text, ['شخص', 'اشخاص', 'ضيف', 'ضيوف', 'guest', 'people', 'person'])) {
    const exact = MOZZARO_KNOWLEDGE.cateringPackages.find((pack) => pack.guestMin != null
      && number >= pack.guestMin && number <= pack.guestMax);
    if (exact) return [`catering_${exact.id}`];
    if (number > 80 && number <= 100) return ['catering_event'];
    return [];
  }

  for (const [id, aliases] of Object.entries(CATERING_PACKAGE_ALIASES)) {
    if (includes(text, aliases)) return [`catering_${id}`];
  }
  if (includes(text, ['ساعة إضافية', 'ساعه اضافيه', 'تمديد ساعة', 'additional hour', 'extra hour'])) return ['catering_addon_additional_service_hour'];
  if (includes(text, ['كم ساعة', 'كم ساعه', 'مدة الخدمة', 'مدة الباقة', 'كم تجلسون', 'service duration', 'how long'])) return ['catering_hours'];
  if (includes(text, ['كم عامل', 'كم عاملين', 'عدد العمال', 'الطاقم', 'staff count', 'how many staff'])) return ['catering_staff'];
  if (includes(text, ['ضيافة تيراميسو وقهوة', 'تيراميسو وقهوة', 'التيراميسو مشمول', 'تيراميسو مشمول'])) return ['catering_inclusions'];
  if (includes(text, ['عربة تيراميسو', 'tiramisu cart'])) return ['catering_addon_tiramisu_cart'];
  if (includes(text, ['عامل إضافي', 'عامل اضافي', 'additional worker', 'extra staff'])) return ['catering_addon_additional_staff_member'];
  if (includes(text, ['تنظيم يوم ميلاد', 'تنظيم عيد ميلاد', 'birthday organization'])) return ['catering_addon_birthday_organization'];
  if (includes(text, ['بيتزا بوراتا', 'بوراتا بيتزا', 'burrata pizza', 'بيتزا اضافيه', 'بيتزا إضافية', 'additional pizza'])) {
    if (includes(text, ['بوراتا', 'burrata'])) return ['catering_addon_burrata_pizza'];
    return ['catering_addon_extra_pizza'];
  }
  if (includes(text, ['إضافات', 'اضافات', 'الاضافات', 'الإضافات', 'add ons', 'add-ons'])) return ['catering_addons'];
  if (includes(text, ['مشمول', 'تشمل', 'المحتويات', 'بوكسات', 'صحون', 'تيراميسو وقهوة', 'inclusions'])) return ['catering_inclusions'];
  if (includes(text, ['كيترنق باستا', 'باستا كيترنق', 'catering pasta', 'كيترنق بيتزا', 'catering pizza', 'بيتزا فقط', 'باستا فقط'])) return ['catering_types'];
  if (includes(text, ['البوراتا', 'بوراتا']) && includes(text, ['اجباري', 'اجباريه', 'إجباري', 'أشيل', 'اشيل', 'استبدل', 'بدل', 'اختياري', 'غير', 'زيادة', 'فوق', 'ضمن'])) return ['catering_burrata'];
  if (includes(text, ['باستا فقط', 'كلها باستا', 'اخلط', 'بيتزا وباستا', 'pasta only', 'mix pizza and pasta'])) return ['catering_types'];
  if (includes(text, ['رقم الكيترنق', 'رقم التواصل', 'كيف اتواصل', 'للتواصل', 'contact number'])) return ['catering_contact'];
  if (includes(text, ['خارج المدينة', 'برا المدينة', 'خارج الاحساء', 'خارج الأحساء', 'حسب المسافة', 'outside city'])) return ['catering_custom'];
  if (includes(text, ['حجز', 'احجز', 'احجزوا', 'تأكيد الحجز', 'تاريخ الحفل', 'booking', 'confirm booking'])) return ['catering_custom'];
  if (includes(text, ['نكهات معينة', 'طلب خاص', 'تخصيص المناسبة', 'تغيير عدد الأصناف', 'تغيير عدد الاصناف', 'زيادة عدد الأصناف', 'زيادة عدد الاصناف', 'سعر نهائي', 'عرض سعر', 'quote', 'custom order'])) return ['catering_custom'];
  if (includes(text, ['قائمة الباقات', 'كل الباقات', 'اسعار الباقات', 'اسعار الباقة', 'باقات الكيترنق', 'catering packages', 'package prices'])) return ['catering_packages'];
  if (isCateringQuestion(text) && includes(text, ['مناسب', 'اسعار', 'الاسعار', 'price', 'كم باقة', 'باقة'])) return ['catering_packages'];
  return [];
}

function isCustomCateringRequest(text) {
  return includes(text, ['تأكيد الحجز', 'حجز', 'احجز', 'تاريخ الحفل', 'موعد الحفل', 'متاح للحجز', 'booking', 'confirm booking',
    'خارج المدينة', 'برا المدينة', 'خارج الاحساء', 'خارج الأحساء', 'حسب المسافة', 'نكهات معينة', 'طلب خاص',
    'تخصيص المناسبة', 'تغيير عدد الأصناف', 'تغيير عدد الاصناف', 'زيادة عدد الأصناف', 'زيادة عدد الاصناف',
      'السعر النهائي', 'سعر نهائي', 'التسعيرة النهائية', 'عرض سعر', 'quote', 'custom order'])
    || (includes(text, ['عيد ميلاد', 'يوم ميلاد', 'birthday']) && includes(text, ['ابي', 'أبي', 'ابغى', 'أبغى', 'نبي', 'احجز']));
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
    'ناقص', 'مفقود', 'ما وصل', 'ماجاني', 'طلب غلط', 'استرجاع', 'تعويض', 'اقتراح', 'أقترح', 'اقترح', 'مقترح', 'فكرة', 'ملاحظة', 'refund', 'suggestion', 'feedback',
    'complaint', 'wrong order', 'missing item', 'late delivery', 'حساسيه', 'حساس',
  ]);
  if (complaint) return { reply: null, topics: [], requiresHuman: true, reason: 'complaint' };
  if (includes(text, ['موظف', 'موظفه', 'اكلم احد', 'اكلم شخص', 'ابي اكلم', 'ابغى اكلم', 'كلموني', 'طلب معقد', 'تعديل على الطلب'])) {
    return { reply: null, topics: [], requiresHuman: true, reason: 'human_request' };
  }

  const cateringContext = isCateringQuestion(text);
  if (cateringContext && isCustomCateringRequest(text)) {
    return { reply: null, topics: [], requiresHuman: true, reason: 'human_request' };
  }

  const topics = [];
  const cateringTopics = cateringTopicsFor(text);
  if (cateringTopics.length) topics.push(...cateringTopics);
  else if (cateringContext) return { reply: MOZZARO_KNOWLEDGE.unknownHandoffText, topics: [], requiresHuman: true, reason: 'unknown_question' };
  const menuTopics = cateringContext ? [] : menuTopicsFor(text);
  if (menuTopics.includes('menu_pizza_burrata') && !includes(text,
    ['بيتزا', 'فوكاتشا', 'ساندويتش', 'ساندوتش', 'pizza', 'focaccia', 'sandwich'])) {
    return { reply: 'تقصد بيتزا البوراتا أو ساندويتش الفوكاتشا بالبوراتا؟ بنحوّل استفسارك للفريق يساعدك.',
      topics: [], requiresHuman: true, reason: 'unknown_question', ambiguity: true };
  }
  if (menuTopics.length && isMenuAvailabilityQuestion(text, menuTopics)) {
    return { reply: MOZZARO_KNOWLEDGE.unknownHandoffText, topics: [], requiresHuman: true, reason: 'unknown_question' };
  }
  if (menuTopics.includes('menu_pizza_month') || menuTopics.includes('menu_pizza')) {
    if (includes(text, MENU_ALIASES.pizza_month)) {
      return { reply: 'بيتزا الشهر ما لها سعر ثابت بالقائمة. بنحوّل استفسارك للفريق لمعرفة التفاصيل الحالية.',
        topics: [], requiresHuman: true, reason: 'unknown_question' };
    }
  }
  if (menuTopics.includes('menu_all')) {
    return { reply: 'حياك الله، تفضل منيو موزارو، فيه جميع الأصناف والأسعار.',
      type: 'document', topics: ['menu_all'], requiresHuman: false };
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
    if (topic.startsWith('catering_')) {
      const cateringAnswer = renderCateringTopic(topic);
      if (cateringAnswer) parts.push(cateringAnswer);
      else return { reply: MOZZARO_KNOWLEDGE.unknownHandoffText, topics: [], requiresHuman: true, reason: 'unknown_question' };
      continue;
    }
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
    'menu_appetizers', 'menu_sauces', 'menu_drinks', 'menu_focaccia_sandwiches', 'menu_focaccia_bread', 'menu_all',
    'catering_packages', 'catering_types', 'catering_burrata', 'catering_staff', 'catering_addons',
    'catering_hours', 'catering_inclusions', 'catering_contact',
    ...MOZZARO_KNOWLEDGE.menuItems.map(({ id }) => `menu_${id}`)]);
  for (const pack of MOZZARO_KNOWLEDGE.cateringPackages) allowed.add(`catering_${pack.id}`);
  for (const addon of MOZZARO_KNOWLEDGE.cateringAddons) allowed.add(`catering_addon_${addon.id}`);
  if (!Array.isArray(topics) || !topics.length || topics.some((topic) => !allowed.has(topic))) return null;
  if (topics.includes('menu_all')) {
    return { reply: 'حياك الله، تفضل منيو موزارو، فيه جميع الأصناف والأسعار.',
      type: 'document', topics: ['menu_all'], requiresHuman: false };
  }
  const parts = [];
  for (const topic of [...new Set(topics)]) {
    if (topic.startsWith('catering_')) {
      const cateringAnswer = renderCateringTopic(topic);
      if (!cateringAnswer) return null;
      parts.push(cateringAnswer);
    } else if (topic === 'catering') {
      parts.push(renderCateringTopic('catering_contact'));
    } else if (topic.startsWith('menu_')) {
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
