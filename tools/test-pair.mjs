/* «Кто кого» — общий счёт пары.

   Часть первая — сама запись, без браузера. Блок памяти DP вынимается из
   файлов игр как есть, побайтово, и запускается в песочнице с поддельными
   localStorage, часами и модулем сети. Так проверяется ровно тот код,
   который уедет на телефон, и сразу во всех одиннадцати файлах: блок
   обязан быть в них одинаковым.

   Часть вторая — карточка на главном экране, в настоящем браузере. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BASE, wait, reporter, launch } from './netkit.mjs';

process.env.TZ = 'Europe/Moscow';
const rep = reporter();
const ok = rep.ok;
const PUB = '/home/claude/net/public/';
const FILES = ['index','dvoeplay','matreshka','magnitniy-boy','memo-duel','dots-boxes','5-bukv',
               'viselica','zahlopni-yaschik','dobble','vzlomshik'];

function block(name){
  const s = readFileSync(PUB + name + '.html', 'utf8');
  const a = s.indexOf('var DP=(function(){');
  const b = s.indexOf('})();', s.indexOf('return {read:read', a)) + 5;
  return s.slice(a, b);
}

rep.head('блок памяти одинаков во всех файлах');
const src = block('dobble');
for (const f of FILES) ok(f + ': тот же блок DP', block(f) === src);

/* ---------- песочница ---------- */
let clock = 0;
class FakeDate extends Date {
  constructor(...a){ if (a.length) super(...a); else super(clock); }
  static now(){ return clock; }
}
function sandbox(){
  const store = new Map();
  const box = {
    Date: FakeDate, JSON, Math, Object, String, Array, Number,
    localStorage: {
      getItem: (k) => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    document: { documentElement: { getAttribute(){ return null; }, setAttribute(){}, removeAttribute(){} },
                querySelectorAll(){ return []; } },
    matchMedia: () => ({ matches: false }),
    window: {}
  };
  vm.createContext(box);
  vm.runInContext(src + ';this.DP=DP;', box);
  box.store = store;
  return box;
}
/* местное время: 27 сентября 2026, вечер */
const at = (d, h, m) => new Date(2026, 8, d, h, m || 0).getTime();
const P = (box) => box.DP.pair();

rep.head('что попадает в счёт пары');
{
  const box = sandbox();
  clock = at(20, 20);
  box.DP.save('dvoeplay', { win: 1, mode: 0 });                  /* против ИИ */
  box.DP.save('5-bukv', { win: 0, solved: 1, mode: 1 });         /* в одиночку */
  ok('партии против ИИ и в одиночку в счёт пары не идут', P(box) === null, P(box));

  box.DP.save('dvoeplay', { win: 1, mode: 2 });                  /* вдвоём: победили красные — это я */
  box.DP.save('matreshka', { win: 2, mode: 2 });                 /* вдвоём: жёлтые — друг */
  box.DP.save('dots-boxes', { win: 0, mode: 2 });                /* ничья */
  const p = P(box).p.duo;
  ok('вдвоём: первая сторона — это я', p.me === 1 && p.them === 1 && p.draw === 1, p);
  ok('по играм разложено верно',
     JSON.stringify(p.g) === JSON.stringify({ dvoeplay: [1,0,0], matreshka: [0,1,0], 'dots-boxes': [0,0,1] }), p.g);
  ok('в журнале три партии по порядку', p.log.map(x => x[1]).join('') === '120', p.log);
  ok('старая статистика по цветам как была',
     box.DP.read().games.dvoeplay.w1 === 2 && box.DP.read().games.dvoeplay.solo === 1, box.DP.read().games.dvoeplay);
}

rep.head('по сети «я» — это своё место, а не красные');
{
  const box = sandbox();
  clock = at(21, 20);
  box.window.NET = { on: true, seat: 2, oppName: 'Аня' };
  box.DP.save('dobble', { win: 2, mode: 2 });                    /* я на втором месте и выиграл */
  box.DP.save('dobble', { win: 1, mode: 2 });                    /* выиграла Аня */
  box.DP.save('dobble', { win: 2, mode: 2 });
  let p = P(box).p['net:аня'];
  ok('мои победы со второго места — мои', p && p.me === 2 && p.them === 1, p);
  ok('имя соперника запомнено как пришло', p && p.name === 'Аня', p && p.name);

  box.window.NET = { on: true, seat: 1, oppName: '' };
  box.DP.save('vzlomshik', { win: 1, mode: 2 });
  ok('безымянный соперник по сети — отдельная строка', P(box).p['net:'] && P(box).p['net:'].me === 1, Object.keys(P(box).p));

  box.window.NET = { on: false, seat: 2, oppName: 'Аня' };      /* комнату закрыли — снова один телефон */
  box.DP.save('dvoeplay', { win: 1, mode: 2 });
  ok('без комнаты — снова игра на одном телефоне', P(box).p.duo && P(box).p.duo.me === 1, Object.keys(P(box).p));
}

rep.head('друг на одном телефоне и он же по сети — одна пара');
{
  const box = sandbox();
  clock = at(22, 20);
  box.DP.save('dvoeplay', { win: 1, mode: 2 });
  box.DP.save('dvoeplay', { win: 2, mode: 2 });
  box.window.NET = { on: true, seat: 1, oppName: 'аня ' };
  box.DP.save('memo-duel', { win: 1, mode: 2 });
  ok('пока имя друга не вписано — счёт раздельный', Object.keys(P(box).p).sort().join() === 'duo,net:аня', Object.keys(P(box).p));
  box.DP.names({ me: 'Карл', friend: 'Аня' });
  const d = P(box);
  ok('вписали имя — сетевые партии с Аней переехали к другу', Object.keys(d.p).join() === 'duo', Object.keys(d.p));
  ok('и сложились', d.p.duo.me === 2 && d.p.duo.them === 1 && d.p.duo.g['memo-duel'][0] === 1, d.p.duo);
  ok('сводка записана — второй раз сводить нечего', JSON.parse(box.store.get('dvoeplay:v1')).duel.p['net:аня'] === undefined);
  box.DP.save('dobble', { win: 1, mode: 2 });                    /* снова по сети с Аней */
  ok('новые сетевые партии с Аней сразу идут к другу', P(box).p.duo.me === 3 && !P(box).p['net:аня'], P(box).p);
}

rep.head('вечера подряд');
{
  const box = sandbox();
  const run = () => P(box).p.duo.run;
  clock = at(24, 21); box.DP.save('dvoeplay', { win: 1, mode: 2 });
  ok('первый вечер', run().n === 1, run());
  clock = at(25, 22); box.DP.save('dvoeplay', { win: 1, mode: 2 });
  ok('на следующий вечер — второй', run().n === 2, run());
  clock = at(26, 0, 40); box.DP.save('dvoeplay', { win: 1, mode: 2 });   /* после полуночи */
  ok('партия в 00:40 — всё тот же вечер', run().n === 2, run());
  clock = at(26, 20); box.DP.save('dvoeplay', { win: 1, mode: 2 });
  ok('вечером 26-го — третий', run().n === 3, run());
  clock = at(26, 23); box.DP.save('dvoeplay', { win: 1, mode: 2 });
  ok('вторая партия за вечер серию не растит', run().n === 3, run());
  clock = at(28, 20); box.DP.save('dvoeplay', { win: 1, mode: 2 });
  ok('пропустили вечер — серия заново, без наказаний', run().n === 1, run());
}

rep.head('пределы');
{
  const box = sandbox();
  clock = at(27, 20);
  for (let i = 0; i < 55; i++){ clock += 60e3; box.DP.save('dobble', { win: i % 3 ? 1 : 2, mode: 2 }); }
  const p = P(box).p.duo;
  ok('журнал — последние 40 партий', p.log.length === 40, p.log.length);
  ok('а счёт — за все 55', p.me + p.them + p.draw === 55, [p.me, p.them, p.draw]);
  for (let i = 0; i < 14; i++){
    clock += 60e3;
    box.window.NET = { on: true, seat: 1, oppName: 'Игрок' + i };
    box.DP.save('dobble', { win: 1, mode: 2 });
  }
  const keys = Object.keys(P(box).p);
  ok('соперников — не больше дюжины', keys.length === 12, keys.length);
  ok('выпали самые давние', !keys.includes('duo') && !keys.includes('net:игрок0') && keys.includes('net:игрок13'), keys);
}

rep.head('сбросы');
{
  const box = sandbox();
  clock = at(27, 20);
  box.DP.names({ me: 'Карл', friend: 'Аня' });
  box.DP.sound(false);
  box.DP.save('dvoeplay', { win: 1, mode: 2 });
  box.window.NET = { on: true, seat: 1, oppName: 'Сергей' };
  box.DP.save('dobble', { win: 2, mode: 2 });
  box.DP.pairReset('net:сергей');
  ok('обнулить счёт с одним соперником — остальные на месте',
     Object.keys(P(box).p).join() === 'duo', Object.keys(P(box).p));
  box.DP.clear();
  const d = box.DP.read();
  ok('сброс статистики стирает партии и счёт пары', Object.keys(d.games).length === 0 && !d.duel, d);
  ok('но не имена', box.DP.names().me === 'Карл' && box.DP.names().friend === 'Аня', box.DP.names());
  ok('и не выключенный звук', box.DP.sound() === false);
}

/* ---------- часть вторая: карточка на главном ---------- */
function hist(parts){
  /* собрать историю так, как её пишет сам блок памяти */
  const box = sandbox();
  parts(box);
  return JSON.parse(box.store.get('dvoeplay:v1'));
}
const browser = await launch();
async function hub(data, opt){
  const ctx = await browser.newContext({ viewport: { width: (opt && opt.w) || 390, height: 844 },
                                         colorScheme: (opt && opt.dark) ? 'dark' : 'light',
                                         serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { rep.failed++; console.log('  ОШИБКА В СТРАНИЦЕ:', e.message); });
  await page.addInitScript(([d, now]) => {
    try { if (d) localStorage.setItem('dvoeplay:v1', JSON.stringify(d)); } catch(e){}
    const Real = Date;
    const shift = now - Real.now();
    class D extends Real { constructor(...a){ if (a.length) super(...a); else super(Real.now() + shift); }
                           static now(){ return Real.now() + shift; } }
    window.Date = D;
  }, [data, clock]);
  await page.goto(BASE + 'index.html');
  await page.waitForTimeout(500);
  return page;
}
const card = (page) => page.evaluate(() => {
  const c = document.querySelector('#pair .pair');
  if (!c) return null;
  const t = (s) => { const e = c.querySelector(s); return e ? e.textContent.trim() : ''; };
  return {
    head: t('.pr-head i'), left: t('.pr-sd.a .pr-nm'), right: t('.pr-sd.b .pr-nm'),
    a: t('.pr-sd.a .pr-sc'), b: t('.pr-sd.b .pr-sc'), lead: t('.pr-foot .pr-lead'),
    form: [].map.call(c.querySelectorAll('.pr-form u'), (u) => u.className || '·').join(' '),
    pill: getComputedStyle(c.querySelector('.pr-sl')).opacity,
    label: c.getAttribute('aria-label'),
    /* порядок на экране: спрятанное (например, карточка турнира, пока его нет) не в счёт */
    order: [].filter.call(document.querySelectorAll('.app > *'), (e) => getComputedStyle(e).display !== 'none')
      .map((e) => e.id || e.className).slice(0, 3).join(' | ')
  };
});

rep.head('карточка: нового игрока не отвлекаем');
{
  clock = at(27, 21);
  const page = await hub(hist((box) => { box.DP.save('dvoeplay', { win: 1, mode: 0 }); }));
  ok('партии только против ИИ — карточки нет', await card(page) === null);
  await page.context().close();
}

rep.head('карточка: пара на одном телефоне');
{
  clock = at(25, 21);
  const data = hist((box) => {
    box.DP.names({ me: 'Карл', friend: 'Аня' });
    for (const [d, h, w] of [[25,21,1],[25,21,2],[26,20,2],[26,21,2],[27,20,1],[27,20,2],[27,21,2],[27,21,0]]){
      clock = at(d, h, 5); box.DP.save(w === 0 ? 'dots-boxes' : 'dobble', { win: w, mode: 2 });
    }
  });
  clock = at(27, 22);
  const page = await hub(data);
  const c = await card(page);
  ok('карточка появилась', !!c, c);
  ok('стоит сразу под шапкой, над большой плашкой', c && /^top \| pair \| hero/.test(c.order), c && c.order);
  ok('имена — из настроек', c && c.left === 'Карл' && c.right === 'Аня', c && [c.left, c.right]);
  ok('общий счёт 2 : 5', c && c.a === '2' && c.b === '5', c && [c.a, c.b]);
  ok('кто ведёт — с верным глаголом', c && c.lead === 'Аня ведёт на 3', c && c.lead);
  ok('сегодняшний счёт и серия вечеров', c && c.head === 'сегодня 1 : 2 · 3-й вечер подряд', c && c.head);
  ok('последние партии точками: красная — моя, жёлтая — её, серая — ничья',
     c && c.form === 'a b b b a b b ·', c && c.form);
  ok('подложка — под тем, кто ведёт', c && c.pill === '1', c && c.pill);
  ok('для скринридера всё словами', c && /Карл 2, Аня 5/.test(c.label || ''), c && c.label);

  rep.head('шторка «кто кого»');
  await page.locator('#pair .pair').click();
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({
    on: document.getElementById('pairSheet').classList.contains('on'),
    title: document.getElementById('pairTitle').textContent,
    sub: document.getElementById('pairSub').textContent,
    rows: [].map.call(document.querySelectorAll('#pairBody .srow'), (r) => r.textContent.replace(/\s+/g, ' ').trim()),
    /* не атрибут, а то, что на экране: display у класса перебивал hidden */
    names: document.getElementById('pairNames').getBoundingClientRect().height > 0
  }));
  ok('открылась', s.on);
  ok('заголовок — пара', s.title === 'Карл и Аня', s.title);
  ok('с какого числа и сколько партий', /с 25 сентября/.test(s.sub) && /8 партий/.test(s.sub), s.sub);
  ok('счёт по играм: чаще всего в Доббль', s.rows.length >= 2 && /Доббль/.test(s.rows[0]) && /2 : 5/.test(s.rows[0]), s.rows);
  ok('ничья видна в своей игре', s.rows.some((r) => /Точки/.test(r) && /ничья/.test(r)), s.rows);
  ok('имена вписаны — кнопки «подписать» нет', !s.names);

  await page.locator('#pairReset').click();
  const armed = await page.locator('#pairReset').textContent();
  ok('обнуление — в два нажатия', /Точно/.test(armed), armed);
  await page.locator('#pairReset').click();
  await page.waitForTimeout(500);
  ok('после обнуления карточки нет', await card(page) === null);
  ok('шторка закрылась', !(await page.evaluate(() => document.getElementById('pairSheet').classList.contains('on'))));
  await page.context().close();
}

rep.head('спрятанные кнопки действительно спрятаны');
{
  const page = await hub(null);
  await page.locator('#statBtn').click();
  await page.waitForTimeout(450);
  const h = await page.evaluate(() => document.getElementById('statReset').getBoundingClientRect().height);
  ok('пустая история — кнопки «Сбросить статистику» не видно', h === 0, h);
  await page.context().close();
}

rep.head('карточка: имён нет');
{
  clock = at(27, 20);
  const data = hist((box) => { box.DP.save('dvoeplay', { win: 1, mode: 2 }); box.DP.save('dvoeplay', { win: 1, mode: 2 }); });
  const page = await hub(data);
  const c = await card(page);
  ok('без имён — цвета, как в самих играх', c && c.left === 'Красные' && c.right === 'Жёлтые', c && [c.left, c.right]);
  ok('глагол во множественном', c && c.lead === 'Красные ведут на 2', c && c.lead);
  ok('одна партия за вечер — серии ещё нет', c && c.head === 'сегодня 2 : 0', c && c.head);
  await page.locator('#pair .pair').click();
  await page.waitForTimeout(450);
  ok('в шторке предложено подписать имена', !(await page.locator('#pairNames').isHidden()));
  await page.locator('#pairNames').click();
  await page.waitForTimeout(450);
  ok('кнопка открывает шторку имён', await page.evaluate(() => document.getElementById('whoSheet').classList.contains('on')));
  await page.locator('#nameMe').fill('Карл');
  await page.locator('#nameFriend').fill('Аня');
  await page.locator('#whoClose').click();
  await page.waitForTimeout(450);
  const c2 = await card(page);
  ok('вписали имена — карточка сразу с именами, счёт тот же',
     c2 && c2.left === 'Карл' && c2.right === 'Аня' && c2.a === '2', c2);
  await page.context().close();
}

rep.head('карточка: соперник по сети и поровну');
{
  clock = at(26, 20);
  const data = hist((box) => {
    box.DP.names({ me: 'Карл', friend: '' });
    box.window.NET = { on: true, seat: 2, oppName: 'Сергей' };
    box.DP.save('vzlomshik', { win: 2, mode: 2 });
    box.DP.save('vzlomshik', { win: 1, mode: 2 });
  });
  clock = at(27, 19);
  const page = await hub(data);
  const c = await card(page);
  ok('соперник — по имени из сети', c && c.left === 'Карл' && c.right === 'Сергей', c && [c.left, c.right]);
  ok('поровну — так и сказано', c && c.lead === 'Поровну', c && c.lead);
  ok('подложки нет, когда никто не ведёт', c && c.pill === '0', c && c.pill);
  ok('вчерашний вечер — одна партия за вечер серии не даёт; видно, когда играли', c && c.head === 'вчера', c && c.head);
  await page.context().close();
}

rep.head('карточка: главный соперник — с кем чаще играют сейчас');
{
  clock = at(27, 18);
  const data = hist((box) => {
    box.DP.names({ me: 'Карл', friend: 'Аня' });
    for (let i = 0; i < 6; i++){ clock = at(27, 18, i); box.DP.save('dobble', { win: 1, mode: 2 }); }
    clock = at(27, 19);
    box.window.NET = { on: true, seat: 1, oppName: 'Сергей' };
    box.DP.save('dobble', { win: 2, mode: 2 });                  /* разовая партия с другим — позже */
  });
  clock = at(27, 20);
  const page = await hub(data);
  const c = await card(page);
  ok('разовая партия с другим не вытесняет пару', c && c.right === 'Аня', c && c.right);
  await page.locator('#pair .pair').click();
  await page.waitForTimeout(450);
  const other = await page.evaluate(() => [].map.call(document.querySelectorAll('#pairOthers .srow'), (r) => r.textContent.replace(/\s+/g, ' ').trim()));
  ok('другой соперник — в шторке', other.length === 1 && /Сергей/.test(other[0]) && /0 : 1/.test(other[0]), other);
  await page.locator('#pairOthers .srow').first().click();
  await page.waitForTimeout(350);
  ok('по нажатию шторка показывает счёт с ним', (await page.locator('#pairTitle').textContent()) === 'Карл и Сергей');
  await page.context().close();
}

rep.head('узкий экран и тёмная тема');
{
  clock = at(27, 20);
  const data = hist((box) => {
    box.DP.names({ me: 'Константин', friend: 'Александра' });
    /* три вечера подряд — чтобы было что уступать на узком экране */
    clock = at(25, 20); box.DP.save('dobble', { win: 1, mode: 2 });
    clock = at(26, 20); box.DP.save('dobble', { win: 2, mode: 2 });
    for (let i = 0; i < 9; i++){ clock = at(27, 20, i); box.DP.save('dobble', { win: i % 2 + 1, mode: 2 }); }
  });
  for (const opt of [{ w: 320 }, { dark: true }]){
    const page = await hub(data, opt);
    const fit = await page.evaluate(() => {
      const c = document.querySelector('#pair .pair'), r = c.getBoundingClientRect();
      const over = [].filter.call(c.querySelectorAll('*'), (e) => e.getBoundingClientRect().right > r.right + 0.5).length;
      return { over, page: document.documentElement.scrollWidth <= innerWidth };
    });
    ok((opt.w ? 'на 320px' : 'на тёмной теме') + ': ничего не вылезает за карточку', fit.over === 0 && fit.page, fit);
    if (!opt.w){
      const full = await page.evaluate(() => document.querySelector('#pair .pr-head i').textContent);
      ok('на обычной ширине — и счёт за сегодня, и серия', full === 'сегодня 5 : 4 · 3-й вечер подряд', full);
    }
    if (opt.w){
      const h = await page.evaluate(() => { const i = document.querySelector('#pair .pr-head i');
        return { text: i.textContent, cut: i.scrollWidth > i.clientWidth + 1 }; });
      ok('на 320px серия уступает место: сегодняшний счёт целиком, без многоточия',
         h.text === 'сегодня 5 : 4' && !h.cut, h);
    }
    await page.context().close();
  }
}

await browser.close();
process.exit(rep.done('Кто кого'));
