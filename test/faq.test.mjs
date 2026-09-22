import test from 'node:test';
import assert from 'node:assert/strict';
import { composeReply, classifyFaq } from '../src/faq.mjs';

test('Islamic greeting', () => assert.equal(composeReply('السلام عليكم').reply, 'وعليكم السلام ورحمة الله وبركاته'));
test('casual greeting with spelling variation', () => assert.equal(composeReply('اهلاا').reply, 'أهلين'));
test('supplier question in Saudi Arabic', () => assert.match(composeReply('من وين الدجاج والبيبروني؟').reply, /ساديا.*أمريكانا/));
test('local chicken question gets the local supplier answer', () => {
  const result = composeReply('هل الدجاج محلي ولا مستورد؟');
  assert.match(result.reply, /الدجاج عندنا محلي ومن ساديا/);
  assert.deepEqual(result.topics, ['localChicken']);
});
test('hours question', () => assert.match(composeReply('متى تقفلون؟').reply, /12 ظهرًا إلى 3 صباحًا/));
test('opening hours phrasing used by customer', () => assert.match(composeReply('متى أوقات الافتتاح؟').reply, /12 ظهرًا إلى 3 صباحًا/));
test('open now uses Riyadh time', () => {
  const open = composeReply('هل أنتم مفتوحين الآن؟', new Date('2026-09-22T22:00:00Z'));
  const closed = composeReply('هل أنتم مفتوحين الآن؟', new Date('2026-09-22T04:00:00Z'));
  assert.match(open.reply, /^نعم، مفتوح الآن/); assert.match(closed.reply, /^حاليًا مغلق/);
});
test('catering and orders can be combined', () => {
  const result = composeReply('هلا ابغى كيترنق وكيف اطلب؟');
  assert.match(result.reply, /^أهلين/); assert.match(result.reply, /0545383080/); assert.match(result.reply, /0565017314/);
});
test('complaints are flagged without a reply', () => assert.equal(composeReply('عندي شكوى عن تأخير الطلب').reply, null));
test('unrelated text has no reply', () => assert.deepEqual(classifyFaq('وش أخبارك؟').topics, []));
