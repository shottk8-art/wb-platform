/* Поле ввода в шторке и клавиатура телефона.

   Шторки прижаты к низу экрана, а клавиатура телефона ложится поверх низа:
   поле фанта в мини-турнире уходило под неё. Первая починка поднимала шторку
   на высоту клавиатуры по visualViewport — на телефоне пользователя это
   уносило всё за край экрана: iPhone, Telegram и Android сообщают высоту
   клавиатуры по-разному. Теперь, пока в шторке набирают текст, она стоит у
   верхнего края экрана, куда клавиатура не достаёт, — и от её высоты не
   зависит вовсе.

   Открыть настоящую клавиатуру без телефона нельзя, поэтому проверяется то,
   что от неё не зависит: где шторка и поле, пока в поле пишут, и что шторка
   никуда не уезжает, когда страница узнаёт о клавиатуре (visualViewport здесь
   подменён — меняется так же, как на iPhone, вместе со сдвигом экрана). */
import { BASE, wait, reporter, launch } from './netkit.mjs';

const rep = reporter();
const ok = rep.ok;
const browser = await launch();
/* верхняя часть экрана, куда не достаёт клавиатура ни одного телефона */
const SAFE = 844 * 0.45;

async function page(){
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    const vv = new EventTarget();
    Object.assign(vv, { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    window.__kb = (h, top) => {
      vv.height = innerHeight - h; vv.offsetTop = top || 0;
      vv.dispatchEvent(new Event('resize')); vv.dispatchEvent(new Event('scroll'));
    };
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { rep.failed++; console.log('  ОШИБКА В СТРАНИЦЕ:', e.message); });
  return P;
}
const box = (P, sel) => P.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
}, sel);
/* нажать пальцем в середину элемента — как на телефоне */
const tap = async (P, sel) => {
  const r = await P.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  await P.touchscreen.tap(r.x, r.y);
};
const has = (P, sel, cls) => P.evaluate(([sel, cls]) => document.querySelector(sel).classList.contains(cls), [sel, cls]);

rep.head('мини-турнир: фант');
{
  const P = await page();
  await P.goto(BASE + 'index.html');
  await P.evaluate(() => { const d = JSON.parse(localStorage.getItem('dvoeplay:v1') || '{"v":1,"games":{}}'); d.names = { me: 'Карл', friend: 'Аня' }; localStorage.setItem('dvoeplay:v1', JSON.stringify(d)); });
  await P.reload();
  await wait(600);
  await P.locator('#tzInv').click();
  await wait(500);
  await P.locator('#tzToF').click();
  await wait(500);
  ok('пока не пишут, шторка у нижнего края', (await box(P, '#tourSheet')).bottom === 844);
  await tap(P, '#tzF');
  await wait(300);
  let s = await box(P, '#tourSheet'), f = await box(P, '#tzF');
  ok('нажали в поле — шторка встала к верхнему краю', await has(P, '#tourSheet', 'typing') && s.top <= 12, s);
  ok('поле — в верхней части экрана, куда клавиатура не достаёт', f.bottom < SAFE, f);
  ok('заголовок и пояснение на время набора убраны', await P.evaluate(() =>
    getComputedStyle(document.getElementById('tzTitle')).display === 'none' && getComputedStyle(document.getElementById('tzSub')).display === 'none'));
  /* клавиатура выехала, iPhone ещё и сдвинул видимую часть — шторке всё равно */
  await P.evaluate(() => window.__kb(336, 0));
  await wait(200);
  await P.evaluate(() => window.__kb(336, 140));
  await wait(200);
  ok('клавиатура и сдвиг экрана шторку не двигают', (await box(P, '#tourSheet')).top === s.top, await box(P, '#tourSheet'));
  await P.keyboard.type('поёт куплет любимой песни стоя на табуретке, рассказывает стихотворение и моет посуду всю неделю');
  const f2 = await box(P, '#tzF');
  ok('длинный фант — поле выросло и осталось в верхней части', f2.h > f.h && f2.bottom < SAFE, [f, f2]);
  await P.keyboard.press('Enter');
  await wait(350);
  ok('«Готово» на клавиатуре заканчивает набор, а не переносит строку', await P.evaluate(() =>
    document.activeElement !== document.getElementById('tzF') && !/\n/.test(document.getElementById('tzF').value)));
  ok('набор закончен — шторка снова у нижнего края', !(await has(P, '#tourSheet', 'typing')) && (await box(P, '#tourSheet')).bottom === 844);
  await P.evaluate(() => window.__kb(0, 0));
  /* нажатие на кнопку прямо во время набора попадает в неё */
  await tap(P, '#tzF');
  await wait(300);
  await tap(P, '#tzHide');
  await wait(400);
  ok('«Спрятать» во время набора сработало: пишет второй', /Пишет\s*Аня/.test(await P.evaluate(() => document.querySelector('.tz-who').textContent)));
  ok('и шторка вернулась вниз', !(await has(P, '#tourSheet', 'typing')) && (await box(P, '#tourSheet')).bottom === 844);
  /* закрыли шторку посреди набора */
  await tap(P, '#tzF');
  await wait(300);
  await P.evaluate(() => document.getElementById('backdrop').click());
  await wait(500);
  ok('шторку закрыли посреди набора — поле отпущено, шторка ушла вниз', await P.evaluate(() => {
    const sh = document.getElementById('tourSheet');
    return !sh.classList.contains('typing') && !sh.classList.contains('on') && document.activeElement !== document.getElementById('tzF') &&
           sh.getBoundingClientRect().top >= 844 - 1;
  }));
  ok('страница не сдвинута', await P.evaluate(() => window.scrollY === 0));
}

rep.head('имена игроков');
{
  const P = await page();
  await P.goto(BASE + 'index.html');
  await wait(500);
  await P.locator('#whoBtn').click();
  await wait(400);
  await tap(P, '#nameFriend');
  await wait(300);
  const s = await box(P, '#whoSheet'), f = await box(P, '#nameFriend');
  ok('поле имени — у верхнего края, над клавиатурой', await has(P, '#whoSheet', 'typing') && s.top <= 12 && f.bottom < SAFE, [s, f]);
  await tap(P, '#nameMe');
  await wait(350);
  ok('переход к соседнему полю шторку не дёргает', await has(P, '#whoSheet', 'typing') && (await box(P, '#whoSheet')).top === s.top);
  await P.keyboard.press('Enter');
  await wait(350);
  ok('«Готово» — шторка снова внизу', !(await has(P, '#whoSheet', 'typing')) && (await box(P, '#whoSheet')).bottom === 844);
}

rep.head('лобби игры по сети');
{
  const P = await page();
  await P.goto(BASE + 'dvoeplay.html');
  await wait(500);
  await P.locator('.row[data-mode="3"]').click();
  await wait(600);
  await tap(P, '#npName');
  await wait(300);
  let s = await box(P, '#npSheet'), f = await box(P, '#npName');
  ok('имя: лобби у верхнего края, поле над клавиатурой', await has(P, '#npSheet', 'np-typing') && s.top <= 12 && f.bottom < SAFE, [s, f]);
  await P.keyboard.press('Enter');
  await wait(350);
  ok('«Готово» — лобби снова внизу', !(await has(P, '#npSheet', 'np-typing')) && (await box(P, '#npSheet')).bottom === 844);
  await P.locator('#npHas').click();
  await wait(300);
  await tap(P, '#npInput');
  await wait(300);
  s = await box(P, '#npSheet'); f = await box(P, '#npInput');
  ok('код комнаты: поле над клавиатурой', await has(P, '#npSheet', 'np-typing') && f.bottom < SAFE, [s, f]);
  await P.evaluate(() => document.getElementById('npInput').blur());
  await wait(350);
  ok('поле отпустили — лобби снова внизу', (await box(P, '#npSheet')).bottom === 844);
}

await browser.close();
process.exit(rep.done('Клавиатура'));
