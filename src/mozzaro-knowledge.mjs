// Reviewed business facts live here so Instagram, WhatsApp, and future AI
// adapters do not invent or silently diverge on operational information.
export const MOZZARO_KNOWLEDGE = Object.freeze({
  timezone: 'Asia/Riyadh',
  opensAtHour: 12,
  closesAtHour: 3,
  hoursText: 'ساعات العمل في موزارو من 12 ظهرًا إلى 3 صباحًا، جميع أيام الأسبوع.',
  suppliersText: 'الدجاج عندنا من ساديا، والبيبروني من أمريكانا.',
  localChickenText: 'الدجاج عندنا محلي ومن ساديا، والبيبروني من أمريكانا.',
  cateringText: 'لتفاصيل الكيترنق، تفضلوا بالتواصل على الواتساب: 0545383080',
  ordersText: 'للطلبات، اتصلوا على الرقم التالي ويرد عليكم الكاشير: 0565017314',
  // Transcribed from the official Mozzaro menu PDF supplied on 2026-09-24.
  // Null means the PDF lists no fixed price; never present it as free or guess.
  menuSource: 'البيتزا (9) (1).pdf',
  menuItems: [
    { id: 'pizza_margherita', category: 'pizza', nameAr: 'مارجريتا', nameEn: 'Margherita', priceSar: 29 },
    { id: 'pizza_mozzaro', category: 'pizza', nameAr: 'بيتزا موزارو', nameEn: 'Mozzaro Pizza', priceSar: 34 },
    { id: 'pizza_pepperoni', category: 'pizza', nameAr: 'بيبروني', nameEn: 'Pepperoni', priceSar: 32 },
    { id: 'pizza_pesto', category: 'pizza', nameAr: 'بيستو', nameEn: 'Pesto', priceSar: 33 },
    { id: 'pizza_rocotto', category: 'pizza', nameAr: 'ريكوتا', nameEn: 'Rocotto', priceSar: 32 },
    { id: 'pizza_burrata', category: 'pizza', nameAr: 'بوراتا', nameEn: 'Burrata', priceSar: 43 },
    { id: 'pizza_month', category: 'pizza', nameAr: 'بيتزا الشهر', nameEn: 'Pizza of the Month', priceSar: null },
    { id: 'pasta_pink_rigatoni', category: 'pasta', nameAr: 'بينك ريغاتوني', nameEn: 'Pink Rigatoni', priceSar: 32 },
    { id: 'pasta_truffle_rigatoni', category: 'pasta', nameAr: 'ترافل ريغاتوني', nameEn: 'Truffle Rigatoni', priceSar: 34 },
    { id: 'pasta_pesto_casarecce', category: 'pasta', nameAr: 'بيستو كازاريتشي', nameEn: 'Pesto Casarecce', priceSar: 36 },
    { id: 'appetizer_parmesan_potato_balls', category: 'appetizers', nameAr: 'كرات البطاطس بالبارميزان', nameEn: 'Parmesan Potato Balls', priceSar: 18 },
    { id: 'appetizer_ricotta_cheese_balls', category: 'appetizers', nameAr: 'كرات جبنة الريكوتا', nameEn: 'Ricotta Cheese Balls', priceSar: 18 },
    { id: 'appetizer_mac_cheese_balls', category: 'appetizers', nameAr: 'كرات ماك آند تشيز', nameEn: 'Mac & Cheese Balls', priceSar: 18 },
    { id: 'sauce_hot_honey', category: 'sauces', nameAr: 'عسل حار', nameEn: 'Hot Honey', priceSar: 4 },
    { id: 'sauce_spicy_olive_oil', category: 'sauces', nameAr: 'زيت زيتون حار', nameEn: 'Spicy Olive Oil', priceSar: 4 },
    { id: 'sauce_truffle_oil', category: 'sauces', nameAr: 'زيت الترفل', nameEn: 'Truffle Oil', priceSar: 4 },
    { id: 'drink_soft_drinks', category: 'drinks', nameAr: 'مشروبات غازية', nameEn: 'Soft Drinks', priceSar: 3 },
  ],
  ingredientsAndAllergens: [], // No ingredient/allergen claim is approved yet.
  policies: [], // Add only policies confirmed by Mozzaro management.
  orderContact: '0565017314',
  cateringContact: '0545383080',
  unknownHandoffText: 'شكرًا لتواصلك مع موزارو. بنحوّل استفسارك للفريق للمتابعة.',
});

export const MOZZARO_AI_TOPICS = Object.freeze([
  'suppliers', 'hours', 'catering', 'orders',
  'menu_pizza', 'menu_pasta', 'menu_appetizers', 'menu_sauces', 'menu_drinks', 'menu_all',
  ...MOZZARO_KNOWLEDGE.menuItems.map(({ id }) => `menu_${id}`),
]);
