/* Мини-турнир.

   Часть первая — счёт и очередь турнира без браузера: модуль tour.js
   запускается в песочнице с поддельным хранилищем, как он есть в файле.

   Часть вторая — настоящий турнир через интерфейс: на главном экране
   собираем турнир из двух игр, вписываем фанты по очереди, играем «4 в ряд»
   (выигрывают красные) и «Доббль» (выигрывают жёлтые). Выходит 1 : 1 —
   значит, модуль обязан дописать решающую игру. Её исход подаём тем же
   событием, что бросает общий блок памяти, и смотрим финал: победитель,
   счёт, раскрытие фанта проигравшему.

   Дальше — «Виселица» по-настоящему: в турнире она идёт в два раунда со
   сменой ролей, и «Начать заново» между раундами снимает сыгранный раунд.
   И наконец все десять игр по ссылке турнира: сразу вдвоём, с именами,
   с панелью турнира в шторке итога. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BASE, wait, reporter, launch, until } from './netkit.mjs';

const rep = reporter();
const ok = rep.ok;
const SRC = readFileSync('/home/claude/net/public/tour.js', 'utf8');

function sandbox(){
  const store = new Map();
  const box = {
    JSON, Math, Object, String, Array, Number, Date,
    localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null,
                    setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: { readyState: 'complete', querySelector(){ return null; }, getElementById(){ return null; },
                addEventListener(){}, documentElement: { classList: { add(){} } } },
    location: { pathname: '/index.html', search: '' },
    setTimeout: (f) => f(), window: {}
  };
  vm.createContext(box);
  vm.runInContext(SRC + ';this.TOUR=TOUR;', box);
  box.store = store;
  return box;
}
const POOL = ['dvoeplay','matreshka','magnitniy-boy','memo-duel','dots-boxes','5-bukv','viselica','zahlopni-yaschik','dobble','vzlomshik'];

rep.head('счёт и очередь');
{
  const { TOUR } = sandbox();
  const t = TOUR.start({ games: ['dvoeplay','dobble','memo-duel'], pool: POOL, f: ['А', 'Б'] });
  ok('новый турнир: первая игра — первая в списке', TOUR.current(t) === 'dvoeplay' && TOUR.played(t) === 0);
  ok('ссылка ведёт в игру с номером турнира', TOUR.link(t) === 'dvoeplay.html?tour=' + t.id, TOUR.link(t));
  TOUR.record(t, 1);
  ok('после первой — 1 : 0, дальше вторая', TOUR.score(t).join() === '1,0' && TOUR.current(t) === 'dobble');
  ok('победителя ещё нет', TOUR.winner(t) === 0 && !TOUR.over(t));
  TOUR.record(t, 0);
  ok('ничья в игре очков не даёт', TOUR.score(t).join() === '1,0');
  TOUR.record(t, 1);
  ok('все сыграны, не поровну — турнир окончен, победил первый', TOUR.over(t) && TOUR.winner(t) === 1);
  ok('решающей не понадобилось', t.games.length === 3 && !t.tb);
  ok('после конца ссылка ведёт на главный экран', TOUR.link(t) === 'index.html?tour=' + t.id);
}
{
  const { TOUR } = sandbox();
  const t = TOUR.start({ games: ['dvoeplay','dobble'], pool: POOL, f: ['А', 'Б'] });
  TOUR.record(t, 1); TOUR.record(t, 2);
  ok('1 : 1 — дописана решающая игра', t.games.length === 3 && t.tb === 1 && !TOUR.over(t), t.games);
  ok('решающая — из тех, что в турнире не было', !['dvoeplay','dobble'].includes(t.games[2]) && POOL.includes(t.games[2]), t.games[2]);
  ok('«из N» считает только задуманные', TOUR.planned(t) === 2);
  TOUR.record(t, 0);
  ok('решающая вничью — ещё одна решающая', t.games.length === 4 && t.tb === 2 && t.games[3] !== t.games[2], t.games);
  TOUR.record(t, 2);
  ok('вторая решающая решила: победил второй', TOUR.over(t) && TOUR.winner(t) === 2);
}
{
  const { TOUR } = sandbox();
  const t = TOUR.start({ games: POOL.slice(), pool: POOL, f: ['А', 'Б'] });
  POOL.forEach((g, i) => TOUR.record(t, i % 2 ? 2 : 1));
  ok('сыграны все десять и поровну — решающая из любых, кроме последней',
     t.games.length === 11 && POOL.includes(t.games[10]) && t.games[10] !== t.games[9], t.games[10]);
}

rep.head('игры в несколько раундов');
{
  const { TOUR } = sandbox();
  ok('«Виселица» в турнире — два раунда, остальные — по одному',
     TOUR.rounds('viselica') === 2 && POOL.filter((g) => g !== 'viselica').every((g) => TOUR.rounds(g) === 1));
  const t = TOUR.start({ games: ['viselica','dobble','dvoeplay'], pool: POOL, f: ['А', 'Б'] });
  TOUR.step(t, 2);
  ok('после первого раунда игра ещё не записана', TOUR.played(t) === 0 && TOUR.current(t) === 'viselica' && t.part.join() === '2', t);
  TOUR.step(t, 2);
  ok('2 : 0 по раундам — игра за вторым', t.res.join() === '2' && !t.part && TOUR.current(t) === 'dobble', t);
  TOUR.step(t, 1);
  ok('в игре в один раунд шаг — сразу итог', t.res.join() === '2,1' && !t.part, t);
}
{
  const { TOUR } = sandbox();
  const t = TOUR.start({ games: ['viselica','dobble'], pool: POOL, f: ['А', 'Б'] });
  TOUR.step(t, 2); TOUR.step(t, 1);
  ok('1 : 1 по раундам — в игре ничья', t.res.join() === '0' && TOUR.score(t).join() === '0,0', t);
}
{
  const box = sandbox();
  ok('без имён стороны зовутся по цветам', box.TOUR.names().join() === 'Красные,Жёлтые', box.TOUR.names());
  box.store.set('dvoeplay:v1', JSON.stringify({ v: 1, games: {}, names: { me: '  Карл ', friend: 'Аня' } }));
  ok('имена берутся из общей памяти — те же, что в играх', box.TOUR.names().join() === 'Карл,Аня', box.TOUR.names());
  box.store.set('dvoeplay:v1', JSON.stringify({ v: 1, games: {}, names: { me: '', friend: 'Аня' } }));
  ok('имя только у одного — второй по цвету', box.TOUR.names().join() === 'Красные,Аня', box.TOUR.names());
  box.store.delete('dvoeplay:v1');
}
{
  const box = sandbox();
  const t = box.TOUR.start({ games: ['dvoeplay','dobble'], pool: POOL, f: ['А', 'Б'] });
  const d = JSON.parse(box.store.get('dvoeplay:v1'));
  ok('турнир лежит в общей памяти рядом с остальным', d.tour && d.tour.id === t.id && d.games && typeof d.games === 'object');
  box.TOUR.write(null);
  ok('прервать — значит убрать турнир, остальная память на месте',
     !JSON.parse(box.store.get('dvoeplay:v1')).tour && box.TOUR.read() === null);
}

/* ---------- часть вторая: настоящий турнир ---------- */
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
const P = await ctx.newPage();
P.on('pageerror', (e) => { rep.failed++; console.log('  ОШИБКА В СТРАНИЦЕ:', e.message); });
const tour = () => P.evaluate(() => (JSON.parse(localStorage.getItem('dvoeplay:v1')) || {}).tour || null);
/* адрес страницы; пока идёт переход, страницы нет — тогда пусто */
const where = () => P.evaluate(() => location.pathname + location.search).catch(() => '');
/* дождаться перехода по ссылке и загрузки новой страницы */
const went = async (re) => {
  try { await P.waitForURL(re, { timeout: 6000 }); await P.waitForLoadState('load'); return true; }
  catch (e) { console.log('     … перехода не было, адрес:', await where()); return false; }
};
/* видно ли элемент на экране — не по атрибуту, а по размеру */
const seen = (sel) => P.evaluate((sel) => { const e = document.querySelector(sel); return !!e && e.getBoundingClientRect().height > 0; }, sel);

rep.head('главный экран: приглашение и настройка');
await P.goto(BASE + 'index.html');
await wait(600);
/* имена одни на всё приложение — их вписывают в шторке «Имена игроков»;
   турнир их не спрашивает */
await P.locator('#whoBtn').click();
await wait(400);
await P.locator('#nameMe').fill('Карл');
await P.locator('#nameFriend').fill('Аня');
await P.locator('#whoClose').click();
await wait(500);
ok('приглашение в турнир на главном', await seen('#tzInv'));
ok('карточки идущего турнира нет', !(await seen('#tourNow .tz-now')));
await P.locator('#tzInv').click();
await wait(500);
ok('открылась настройка', await P.evaluate(() => document.getElementById('tourSheet').classList.contains('on')));
ok('кто играет — не спрашивается: ни полей для имён, ни строки «Кто играет»', await P.evaluate(() =>
  !document.querySelector('#tzBody input') && !/Кто играет/.test(document.getElementById('tourSheet').textContent)));
ok('случайно — три игры, все разные', await P.evaluate(() => {
  const r = [].map.call(document.querySelectorAll('#tzDraw .srow b'), (b) => b.textContent);
  return r.length === 3 && new Set(r).size === 3;
}));
await P.locator('#tzCount button[data-n="5"]').click();
ok('пять игр — тоже разные', await P.evaluate(() => {
  const r = [].map.call(document.querySelectorAll('#tzDraw .srow b'), (b) => b.textContent);
  return r.length === 5 && new Set(r).size === 5;
}));
ok('случайные игры — можно сразу дальше', await P.evaluate(() => !document.getElementById('tzToF').disabled));

await P.locator('#tzMode button[data-m="pick"]').click();
/* выбор игры внизу списка не должен отбрасывать шторку наверх:
   её пролистали — она там и остаётся */
{
  const y0 = await P.evaluate(() => { const s = document.getElementById('tourSheet'); s.scrollTop = s.scrollHeight; return s.scrollTop; });
  const last = await P.evaluate(() => document.querySelector('#tzPick .tz-pick:last-child').getAttribute('data-g'));
  const tapLast = async () => {
    const b = await P.evaluate(() => { const r = document.querySelector('#tzPick .tz-pick:last-child').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await P.touchscreen.tap(b.x, b.y);
    await wait(250);
  };
  await tapLast();
  const y1 = await P.evaluate(() => document.getElementById('tourSheet').scrollTop);
  const num = await P.evaluate((g) => document.querySelector('#tzPick [data-g="' + g + '"] .tz-num').textContent, last);
  ok('выбрали игру внизу — шторка осталась на месте', y0 > 40 && Math.abs(y1 - y0) < 2, [y0, y1]);
  ok('и у игры появился номер', num === '1', num);
  await tapLast();
  const y2 = await P.evaluate(() => document.getElementById('tourSheet').scrollTop);
  ok('сняли выбор — номер пропал, шторка всё там же', Math.abs(y2 - y0) < 2 &&
     await P.evaluate((g) => document.querySelector('#tzPick [data-g="' + g + '"] .tz-num').textContent === '', last), [y0, y2]);
  await P.evaluate(() => { document.getElementById('tourSheet').scrollTop = 0; });
}
await P.locator('#tzPick [data-g="dobble"]').click();
ok('выбрана одна игра — мало, дальше нельзя', await P.evaluate(() => document.getElementById('tzToF').disabled));
await P.locator('#tzPick [data-g="dobble"]').click();                 /* сняли */
await P.locator('#tzPick [data-g="dvoeplay"]').click();
await P.locator('#tzPick [data-g="dobble"]').click();
ok('порядок — как нажимали: 4 в ряд первой, Доббль второй', await P.evaluate(() =>
  document.querySelector('#tzPick [data-g="dvoeplay"] .tz-num').textContent === '1' &&
  document.querySelector('#tzPick [data-g="dobble"] .tz-num').textContent === '2'));
await P.locator('#tzToF').click();

rep.head('фанты — по очереди и втайне');
ok('пишет первый — по имени из настроек', /^Пишет\s*Карл$/.test((await P.locator('.tz-who').textContent()).trim()));
ok('пустой фант не спрятать', await P.evaluate(() => document.getElementById('tzHide').disabled));
await P.locator('#tzIdea').click();
ok('«Подсказать» вписывает фант из списка серии', (await P.locator('#tzF').inputValue()).length > 3);
await P.locator('#tzF').fill('поёт куплет любимой песни');
await P.locator('#tzHide').click();
ok('теперь пишет второй', /Аня/.test(await P.locator('.tz-who').textContent()));
ok('фант первого на экране не виден', (await P.locator('#tzF').inputValue()) === '' &&
   !(await P.evaluate(() => document.getElementById('tourSheet').textContent.includes('поёт куплет'))));
ok('назад ко второму шагу дороги нет — фант первого не подсмотреть', !(await seen('#tzBack')));
await P.locator('#tzF').fill('моет посуду всю неделю');
await P.locator('#tzHide').click();
ok('оба фанта спрятаны', /Оба фанта спрятаны/.test(await P.locator('#tzBody').textContent()));
ok('и их текста на экране нет', !(await P.evaluate(() => /поёт куплет|моет посуду/.test(document.getElementById('tourSheet').textContent))));
await P.locator('#tzStart').click();

rep.head('первая игра: 4 в ряд');
ok('ушли в первую игру турнира', await went(/dvoeplay\.html\?tour=\d+/));
await wait(900);
{
  const t = await tour();
  ok('турнир записан: игры и фанты — кому какой; имён в нём нет', t && t.games.join() === 'dvoeplay,dobble' &&
     !('names' in t) && t.f[0] === 'моет посуду всю неделю' && t.f[1] === 'поёт куплет любимой песни', t);
  const n = await P.evaluate(() => [document.getElementById('name1').textContent.trim(), document.getElementById('name2').textContent.trim()]);
  ok('игра сразу вдвоём и с именами турнира — без меню', n.join() === 'Карл,Аня', n);
}
const drop = async (col) => {
  const b = await P.locator('#board').boundingBox();
  await P.mouse.move(b.x + b.width * (col + 0.5) / 7, b.y + b.height * 0.5);
  await P.mouse.down(); await P.mouse.up();
  await wait(650);
};
for (const c of [0, 6, 1, 6, 2, 6, 3]) await drop(c);
ok('партия кончилась — шторка итога', await until(P, () => P.evaluate(() => document.body.classList.contains('open')), (x) => x, 8000));
await wait(700);
{
  const pn = await P.evaluate(() => {
    const p = document.getElementById('trPanel');
    return p ? { text: p.textContent.replace(/\s+/g, ' ').trim(), href: document.getElementById('trNext').getAttribute('href') } : null;
  });
  ok('в шторке панель турнира', !!pn, pn);
  ok('в ней игра и счёт: 1 из 2, Карл 1 : 0 Аня', pn && /игра 1 из 2/i.test(pn.text) && /Карл\s*1 : 0\s*Аня/.test(pn.text), pn && pn.text);
  ok('кнопка — к следующей игре', pn && /Дальше: Доббль/.test(pn.text) && /^dobble\.html\?tour=\d+$/.test(pn.href), pn);
  ok('«Играть снова» в турнире спрятана', !(await seen('#again')));
  ok('обычный фант после игры в турнире не показан', !(await seen('#sheet .forfeit')));
}

rep.head('главный экран посреди турнира');
await P.goto(BASE + 'index.html');
await wait(600);
{
  const c = await P.evaluate(() => {
    const n = document.querySelector('#tourNow .tz-now');
    return n ? { text: n.textContent.replace(/\s+/g, ' '), href: (document.getElementById('tzGo') || {}).getAttribute && document.getElementById('tzGo').getAttribute('href'),
                 top: document.querySelector('.app').children[1].id } : null;
  });
  ok('карточка турнира наверху', c && c.top === 'tourNow', c);
  ok('в ней ход турнира и счёт', c && /игра 2 из 2/.test(c.text) && /Карл/.test(c.text) && /Аня/.test(c.text), c && c.text);
  ok('и кнопка продолжить', c && /Продолжить: Доббль/.test(c.text) && /^dobble\.html\?tour=/.test(c.href), c);
  ok('приглашения, пока турнир идёт, нет', !(await seen('#tzInv')));
  ok('партия турнира попала и в «Кто кого»', await seen('#pair .pair'));
}
{
  /* игра из сетки, не из турнира, — обычное меню, турнир её не трогает */
  await P.goto(BASE + 'dobble.html');
  await wait(700);
  ok('игра, открытая не из турнира, начинается с меню', await P.evaluate(() => !document.getElementById('app').classList.contains('playing')));
  await P.goto(BASE + 'dobble.html?tour=1');
  await wait(700);
  ok('чужой номер турнира — тоже меню', await P.evaluate(() => !document.getElementById('app').classList.contains('playing')));
}

rep.head('вторая игра: Доббль, выигрывают жёлтые');
await P.goto(BASE + 'index.html');
await wait(400);
await P.locator('#tzGo').click();
ok('ушли во вторую игру', await went(/dobble\.html\?tour=\d+/));
const dstate = () => P.evaluate(() => ({
  playing: document.getElementById('app').classList.contains('playing'),
  ready: !document.getElementById('cMid').classList.contains('back'),
  sheet: document.getElementById('sheet').classList.contains('on'),
  top: document.getElementById('numTop').textContent
}));
ok('Доббль сразу вдвоём', await until(P, dstate, (s) => s.playing && s.ready, 9000));
/* забирает верхний — второй игрок, жёлтые */
for (let i = 0; i < 60; i++){
  const s = await dstate();
  if (s.sheet) break;
  if (!s.ready){ await wait(300); continue; }
  const pt = await P.evaluate(() => {
    const set = (q) => [].map.call(document.querySelectorAll(q + ' .sy'), (g) => +g.dataset.s);
    const mid = set('#cMid'), m = set('#cTop').find((x) => mid.includes(x));
    if (m === undefined) return null;
    const r = document.querySelector('#cTop .sy[data-s="' + m + '"] .hit').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!pt){ await wait(300); continue; }
  const before = s.top;
  await P.touchscreen.tap(pt.x, pt.y);
  await until(P, dstate, (x) => x.top !== before || x.sheet, 4000);
  /* после взятки карта улетает и сдаётся новая: без паузы следующий тап
     попадал бы по старой раскладке и приносил штраф */
  await wait(800);
}
ok('партия кончилась', await until(P, dstate, (s) => s.sheet, 12000));
await wait(600);
let tb = '';
{
  const t = await tour();
  tb = t.games[2] || '';
  const pn = await P.evaluate(() => { const p = document.getElementById('trPanel'); return p ? p.textContent.replace(/\s+/g, ' ').trim() : ''; });
  ok('1 : 1 — модуль дописал решающую игру', t.games.length === 3 && t.tb === 1 && !['dvoeplay','dobble'].includes(tb), t.games);
  ok('панель говорит, что всё решит ещё одна игра', /Поровну/.test(pn) && /Решающая:/.test(pn), pn);
  ok('счёт в панели 1 : 1', /Карл\s*1 : 1\s*Аня/.test(pn), pn);
}

rep.head('решающая игра');
let fin = '';
await P.locator('#trNext').click();
ok('ушли в решающую', await went(new RegExp(tb + '\\.html\\?tour=\\d+')));
await wait(1200);
ok('решающая игра открылась по ссылке турнира: ' + tb, await P.evaluate(() => /\?tour=\d+/.test(location.search)));
/* исход решающей подаём тем же событием, что бросает общий блок памяти после
   записи партии: как устроена сама игра, турниру всё равно. Решающая —
   случайная, и если выпала «Виселица», в ней два раунда: событий столько же */
await P.evaluate((id) => {
  for (let i = 0; i < TOUR.rounds(id); i++) document.dispatchEvent(new CustomEvent('dp:save', { detail: { id, win: 2, mode: 2 } }));
}, tb);
await wait(300);
{
  const t = await tour();
  ok('решающую выиграли жёлтые — турнир окончен', t.res.join() === '1,2,2' && t.games.length === 3, t);
  const pn = await P.evaluate(() => { const p = document.getElementById('trPanel'); return p ? p.textContent.replace(/\s+/g, ' ').trim() : ''; });
  ok('панель: турнир окончен, кнопка — к итогам', /Турнир окончен/.test(pn) && /Итоги и фант/.test(pn), pn);
  fin = await P.evaluate(() => document.getElementById('trNext').getAttribute('href'));
  ok('кнопка ведёт на главный экран', /^index\.html\?tour=\d+$/.test(fin), fin);
  /* против ИИ (и по сети) в турнир ничего не пишется, а шторка такой
     партии — обычная: без панели турнира */
  await P.evaluate((id) => document.dispatchEvent(new CustomEvent('dp:save', { detail: { id, win: 1, mode: 0 } })), tb);
  ok('лишняя запись после конца турнир не трогает', (await tour()).res.join() === '1,2,2');
  ok('и её шторка без панели турнира', !(await seen('#trPanel')) && await P.evaluate(() => !document.documentElement.classList.contains('in-tour')));
}

rep.head('финал на главном экране');
await P.goto(BASE + fin);
ok('открылся итог турнира', await until(P, () => P.evaluate(() => document.getElementById('tourEnd').classList.contains('on')), (x) => x, 6000));
{
  const e = await P.evaluate(() => ({
    title: document.getElementById('teTitle').textContent, sub: document.getElementById('teSub').textContent,
    rows: [].map.call(document.querySelectorAll('#teBody .srow'), (r) => r.textContent.replace(/\s+/g, ' ').trim()),
    cover: document.getElementById('teReveal').textContent
  }));
  ok('победитель назван', e.title === 'Победа: Аня', e.title);
  ok('счёт и решающая', /1 : 2/.test(e.sub) && /решающей/.test(e.sub), e.sub);
  ok('по играм: кто где выиграл', e.rows.length === 3 && /4 в ряд.*Карл/.test(e.rows[0]) && /Доббль.*Аня/.test(e.rows[1]) && /решающая.*Аня/.test(e.rows[2]), e.rows);
  ok('фант закрыт, пока не нажали', !/моет посуду/.test(e.cover) && /Открыть фант/.test(e.cover) && !(await seen('.tz-open')), e.cover);
}
await P.locator('#teReveal').click();
await wait(500);
{
  const txt = await P.evaluate(() => document.querySelector('#teReveal .tz-open').textContent.replace(/\s+/g, ' ').trim());
  ok('проигравший — Карл, и фант его: тот, что вписала Аня', /Карл выполняет фант/.test(txt) && /моет посуду всю неделю/.test(txt), txt);
  await P.locator('#teSecond').click();
  const sec = await P.locator('#teSecond').textContent();
  ok('второй фант — по желанию, «не пригодился»', /поёт куплет любимой песни/.test(sec), sec);
}
await P.locator('#teDone').click();
await wait(400);
ok('«Готово» — турнир убран, снова приглашение', !(await tour()) && await seen('#tzInv'));

rep.head('«Виселица» в турнире: два раунда, роли меняются');
/* турнир подкладываем прямо в память; старый раунд в part — как будто
   прошлый раз ушли посреди игры: при открытии он обязан сброситься */
await P.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('dvoeplay:v1'));
  d.tour = { id: 77, games: ['viselica','dvoeplay'], res: [], names: ['Карл','Аня'],
             titles: { viselica: 'Виселица', dvoeplay: '4 в ряд' }, pool: ['viselica','dvoeplay','dobble'], f: ['а','б'], tb: 0, part: [1] };
  localStorage.setItem('dvoeplay:v1', JSON.stringify(d));
});
await P.goto(BASE + 'viselica.html?tour=77');
const vl = () => P.evaluate(() => ({
  playing: document.getElementById('app').classList.contains('playing'),
  setting: document.getElementById('game').classList.contains('setting'),
  setter: document.getElementById('setup').classList.contains('p2') ? 2 : 1,
  sheet: document.getElementById('sheet').classList.contains('on'),
  title: document.getElementById('sheetTitle').textContent
}));
const key = (k) => P.evaluate((c) => { const b = document.querySelector('#kbd .key[data-k="' + c + '"]'); if (b) b.click(); return !!b; }, k);
/* загадать слово и тут же отгадать его без ошибок: раунд за отгадывающим */
const vround = async (w) => {
  await until(P, vl, (s) => s.setting, 6000);
  await wait(700);
  for (const c of w) { await key(c); await wait(60); }
  await key('ENTER');
  await until(P, vl, (s) => !s.setting, 6000);
  await wait(700);
  for (const c of new Set(w)) { await key(c); await wait(380); }
  return until(P, vl, (s) => s.sheet, 9000);
};
const vpanel = () => P.evaluate(() => { const p = document.getElementById('trPanel'); return p ? p.textContent.replace(/\s+/g, ' ').trim() : ''; });
ok('сразу загадывание вдвоём', await until(P, vl, (s) => s.playing && s.setting, 8000));
ok('старый раунд при открытии сброшен', !(await tour()).part);
ok('первым загадывает Карл', (await vl()).setter === 1);
ok('раунд 1: Аня отгадала', await vround('парус'));
await wait(400);
{
  const t = await tour(), pn = await vpanel();
  ok('игра ещё не записана, раунд — за Аней', t.res.length === 0 && (t.part || []).join() === '2', t);
  ok('панель: раунд 1 из 2 и кнопка второго раунда', /игра 1 из 2/.test(pn) && /Раунд 1 из 2/.test(pn) && /Второй раунд/.test(pn), pn);
  ok('«Играть снова» и фант спрятаны и тут', !(await seen('#again')) && !(await seen('#forfeit')));
}
/* «Начать заново» между раундами — это переигровка того же раунда теми же
   ролями: сыгранный раунд снимается */
await P.evaluate(() => document.getElementById('look').click());
await wait(300);
await P.evaluate(() => document.getElementById('reset').click());
await wait(500);
ok('«Начать заново» между раундами снимает раунд', !(await tour()).part);
ok('загадывает снова Карл', (await vl()).setter === 1);
ok('раунд 1 заново: Аня отгадала', await vround('лодка'));
await wait(400);
ok('раунд снова записан', ((await tour()).part || []).join() === '2');
await P.evaluate(() => document.getElementById('trNext').click());
ok('второй раунд — загадывает Аня', await until(P, vl, (s) => s.setting && s.setter === 2 && !s.sheet, 6000));
ok('раунд 2: Карл отгадал', await vround('нора'));
await wait(400);
{
  const t = await tour(), pn = await vpanel();
  ok('1 : 1 по раундам — в турнире ничья', t.res.join() === '0' && !t.part, t);
  ok('панель: счёт 0 : 0, дальше 4 в ряд', /Карл\s*0 : 0\s*Аня/.test(pn) && /Дальше: 4 в ряд/.test(pn) && !/Раунд/.test(pn), pn);
  ok('кнопка — ссылка в следующую игру', await P.evaluate(() => /dvoeplay\.html\?tour=77/.test(document.getElementById('trNext').getAttribute('href'))));
}
/* та же игра ещё раз — уже не турнирная: обычная шторка */
await P.evaluate(() => document.dispatchEvent(new CustomEvent('dp:save', { detail: { id: 'viselica', win: 1, mode: 2 } })));
await wait(200);
ok('партия вне очереди турнира — панель убрана, шторка обычная',
   !(await seen('#trPanel')) && await P.evaluate(() => !document.documentElement.classList.contains('in-tour')) && (await tour()).res.join() === '0');
await P.goto(BASE + 'index.html');
await wait(300);
await P.evaluate(() => { const d = JSON.parse(localStorage.getItem('dvoeplay:v1')); delete d.tour; localStorage.setItem('dvoeplay:v1', JSON.stringify(d)); });

rep.head('все десять игр по ссылке турнира');
/* каждая игра: сразу партия вдвоём с именами турнира; итог партии —
   в турнир, панель — в её шторку, перед спрятанной «Играть снова» */
for (const [i, g] of POOL.entries()){
  const id = 500 + i;
  await P.evaluate(([g, id]) => {
    const d = JSON.parse(localStorage.getItem('dvoeplay:v1'));
    d.tour = { id, games: [g, g === 'dobble' ? 'dvoeplay' : 'dobble'], res: [], titles: {}, pool: [], f: ['а','б'], tb: 0 };
    localStorage.setItem('dvoeplay:v1', JSON.stringify(d));
  }, [g, id]);
  await P.goto(BASE + g + '.html?tour=' + id);
  const on = await until(P, () => P.evaluate(() => {
    const app = document.getElementById('app');
    return document.body.classList.contains('playing') || (!!app && app.classList.contains('playing'));
  }), (x) => x, 6000);
  await wait(500);
  const names = await P.evaluate(() => /Карл/.test(document.body.innerText) && /Аня/.test(document.body.innerText));
  const n = await P.evaluate(() => TOUR.rounds(TOUR.read().games[0]));
  for (let k = 0; k < n; k++) await P.evaluate((g) => document.dispatchEvent(new CustomEvent('dp:save', { detail: { id: g, win: 1, mode: 2 } })), g);
  const r = await P.evaluate(() => {
    const p = document.getElementById('trPanel'), a = document.getElementById('again');
    return { res: TOUR.read().res.join(), inSheet: !!p && !!p.closest('#sheet') && p.nextElementSibling === a,
             hid: document.documentElement.classList.contains('in-tour') && getComputedStyle(a).display === 'none' };
  });
  ok(g + ': вдвоём с именами, итог в турнире, панель в шторке', on && names && r.res === '1' && r.inSheet && r.hid, [on, names, r]);
}
await P.goto(BASE + 'index.html');
await wait(300);
await P.evaluate(() => { const d = JSON.parse(localStorage.getItem('dvoeplay:v1')); delete d.tour; localStorage.setItem('dvoeplay:v1', JSON.stringify(d)); });

rep.head('без имён — стороны по цветам, как в играх');
await P.goto(BASE + 'index.html');
await wait(300);
await P.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('dvoeplay:v1'));
  d.names = { me: '', friend: '' }; delete d.tour;
  localStorage.setItem('dvoeplay:v1', JSON.stringify(d));
});
await P.reload();
await wait(600);
await P.locator('#tzInv').click();
await wait(500);
await P.locator('#tzToF').click();
await wait(300);
const txt = (sel) => P.evaluate((sel) => document.querySelector(sel).textContent.replace(/\s+/g, ' ').trim(), sel);
ok('пишут красные — глагол во множественном', /^Пишут ?Красные$/.test(await txt('.tz-who')), await txt('.tz-who'));
ok('«выполнят жёлтые, если проиграют… не подглядывайте»',
   /выполнят жёлтые, если проиграют турнир\. Жёлтые, не подглядывайте!/.test(await txt('#tzBody .tz-hint')), await txt('#tzBody .tz-hint'));
await P.locator('#tzF').fill('танцует');
await P.locator('#tzHide').click();
await wait(300);
ok('потом пишут жёлтые', /^Пишут ?Жёлтые$/.test(await txt('.tz-who')), await txt('.tz-who'));
await P.evaluate(() => document.getElementById('backdrop').click());
await wait(300);
/* финал без имён */
await P.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('dvoeplay:v1'));
  d.tour = { id: 88, games: ['dvoeplay','dobble','memo-duel'], res: [1,2,2], titles: { dvoeplay: '4 в ряд', dobble: 'Доббль', 'memo-duel': 'Мемо-дуэль' },
             pool: [], f: ['поёт', 'танцует'], tb: 0 };
  localStorage.setItem('dvoeplay:v1', JSON.stringify(d));
});
await P.goto(BASE + 'index.html?tour=88');
ok('итог открылся', await until(P, () => P.evaluate(() => document.getElementById('tourEnd').classList.contains('on')), (x) => x, 6000));
ok('«Победили жёлтые»', (await txt('#teTitle')) === 'Победили жёлтые', await txt('#teTitle'));
ok('по играм — «Красные» и «Жёлтые»', await P.evaluate(() => {
  const r = [].map.call(document.querySelectorAll('#teBody .tz-res'), (e) => e.textContent);
  return r.join() === 'Красные,Жёлтые,Жёлтые';
}));
ok('«Красные, готовьтесь»', /Красные, готовьтесь/.test(await txt('#teReveal')), await txt('#teReveal'));
await P.locator('#teReveal').click();
await wait(400);
ok('«Красные выполняют фант» — тот, что вписали жёлтые', /Красные выполняют фант/.test(await txt('#teReveal .tz-open')) &&
   /поёт/.test(await txt('#teReveal .tz-open')), await txt('#teReveal .tz-open'));
ok('табло карточки турнира — по цветам', await P.evaluate(() => {
  const n = [].map.call(document.querySelectorAll('#tourNow .pr-nm'), (e) => e.textContent);
  return n.join() === 'Красные,Жёлтые';
}));
/* переименовали посреди турнира — карточка сразу с новым именем */
await P.evaluate(() => document.getElementById('teDone').click());
await wait(300);
await P.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('dvoeplay:v1'));
  d.tour = { id: 89, games: ['dvoeplay','dobble'], res: [], titles: {}, pool: [], f: ['а', 'б'], tb: 0 };
  localStorage.setItem('dvoeplay:v1', JSON.stringify(d));
});
await P.reload();
await wait(500);
await P.locator('#whoBtn').click();
await wait(300);
await P.locator('#nameFriend').fill('Оля');
await P.locator('#whoClose').click();
await wait(400);
ok('переименовали посреди турнира — в карточке новое имя', await P.evaluate(() =>
  [].map.call(document.querySelectorAll('#tourNow .pr-nm'), (e) => e.textContent).join() === 'Красные,Оля'));
/* и в игре панель турнира зовёт стороны так же */
await P.goto(BASE + 'dvoeplay.html?tour=89');
await wait(900);
await P.evaluate(() => document.dispatchEvent(new CustomEvent('dp:save', { detail: { id: 'dvoeplay', win: 1, mode: 2 } })));
await wait(200);
ok('панель в игре: «Красные 1 : 0 Оля»', /Красные\s*1 : 0\s*Оля/.test(await txt('#trPanel')), await txt('#trPanel'));
await P.goto(BASE + 'index.html');
await wait(300);
await P.evaluate(() => { const d = JSON.parse(localStorage.getItem('dvoeplay:v1')); delete d.tour; localStorage.setItem('dvoeplay:v1', JSON.stringify(d)); });

rep.head('прервать турнир');
await P.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('dvoeplay:v1'));
  d.tour = { id: 42, games: ['dvoeplay','dobble'], res: [1], titles: { dvoeplay: '4 в ряд', dobble: 'Доббль' }, pool: [], f: ['а','б'], tb: 0 };
  localStorage.setItem('dvoeplay:v1', JSON.stringify(d));
});
await P.reload();
await wait(500);
await P.locator('#tzStop').click();
ok('прервать — в два нажатия', /Точно/.test(await P.locator('#tzStop').textContent()) && !!(await tour()));
await P.locator('#tzStop').click();
await wait(300);
ok('прерван: турнира нет, приглашение вернулось', !(await tour()) && await seen('#tzInv'));

await browser.close();
process.exit(rep.done('Мини-турнир'));
