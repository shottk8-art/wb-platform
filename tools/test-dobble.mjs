/* Сетевая партия в «Доббль» — первая игра серии без очереди.

   Главное испытание здесь не «ход дошёл», а «кто был первым»: оба игрока
   жмут одновременно, и оба телефона обязаны решить спор одинаково. Карта
   не может достаться обоим, не может достаться никому и не может уйти
   одному на одном экране и другому на втором. */
import { BASE, wait, reporter, launch, tab, lobby, until } from './netkit.mjs';

const URL = BASE + 'dobble.html';
const rep = reporter();
const ok = rep.ok;

const look = (page) => page.evaluate(() => {
  const syms = (sel) => [].map.call(document.querySelectorAll(sel + ' .sy'), (g) => g.dataset.s).sort().join(',');
  return {
    screen: document.getElementById('app').classList.contains('playing') ? 'игра' : 'меню',
    net: document.body.classList.contains('playing-net'),
    seat: window.NET ? NET.seat : 0,
    mine: syms('#cBot'), theirs: syms('#cTop'), mid: syms('#cMid'),
    /* пока идёт отсчёт 3-2-1, центральная карта лежит рубашкой вверх */
    ready: !document.getElementById('cMid').classList.contains('back'),
    me: document.getElementById('numBot').textContent,
    opp: document.getElementById('numTop').textContent,
    nameMe: document.getElementById('nameBot').textContent.trim(),
    nameOpp: document.getElementById('nameTop').textContent.trim(),
    left: document.getElementById('left').textContent.trim(),
    hint: document.getElementById('hint').textContent.trim(),
    frozen: !!document.querySelector('.zone.frozen'),
    /* забранная карта ещё летит к стопке взявшего — ему пока не до новой */
    flying: !!document.querySelector('.ghost'),
    sheet: document.getElementById('sheet').classList.contains('on'),
    sheetTitle: document.getElementById('sheetTitle').textContent,
    again: document.getElementById('again').textContent
  };
});

/* общий символ своей карты и центральной — то, что игрок и ищет глазами */
const hit = (page) => page.evaluate(() => {
  const set = (sel) => [].map.call(document.querySelectorAll(sel + ' .sy'), (g) => +g.dataset.s);
  const mid = set('#cMid');
  const mine = set('#cBot');
  for (const s of mine) if (mid.indexOf(s) > -1) return s;
  return -1;
});
/* символ, которого на центральной карте нет — заведомый промах */
const wrong = (page) => page.evaluate(() => {
  const set = (sel) => [].map.call(document.querySelectorAll(sel + ' .sy'), (g) => +g.dataset.s);
  const mid = set('#cMid');
  for (const s of set('#cBot')) if (mid.indexOf(s) < 0) return s;
  return -1;
});
/* нажать символ на своей карте ровно так, как это делает палец */
const tap = (page, s) => page.evaluate((s) => {
  const g = document.querySelector('#cBot .sy[data-s="' + s + '"]');
  if (!g) return false;
  const r = g.getBoundingClientRect();
  document.getElementById('cBot').dispatchEvent(new PointerEvent('pointerdown', {
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true
  }));
  return true;
}, s);

const browser = await launch();
const A = await tab(browser, rep, 'A');
const B = await tab(browser, rep, 'B');

rep.head('комната');
await A.goto(URL);
await B.goto(URL);
await lobby.openFrom(A, '.row[data-mode="3"]');
const code = await lobby.create(A);
ok('код получен: ' + code, /^\d{5}$/.test(code));
await lobby.openFrom(B, '.row[data-mode="3"]');
await lobby.join(B, code);
ok('второй в игре', await until(B, look, s => s.screen === 'игра' && s.net));
ok('первый в игре', await until(A, look, s => s.screen === 'игра' && s.net));
/* отсчёт 3-2-1: центральная карта открывается обоим одновременно */
ok('карты розданы обоим', await until(A, look, s => s.ready, 9000) &&
                          await until(B, look, s => s.ready, 9000));

rep.head('колода одна на двоих');
{
  const a = await look(A), b = await look(B);
  ok('центральная карта одна и та же', a.mid === b.mid, [a.mid, b.mid]);
  ok('своя карта первого — это чужая карта второго', a.mine === b.theirs, [a.mine, b.theirs]);
  ok('и наоборот', a.theirs === b.mine, [a.theirs, b.mine]);
  ok('на карте шесть символов', a.mid.split(',').length === 6, a.mid);
  ok('в стопке 29 карт', a.left === 'В стопке 29' && b.left === 'В стопке 29', [a.left, b.left]);
  ok('счёт нулевой у обоих', a.me === '0' && a.opp === '0' && b.me === '0' && b.opp === '0');
}

rep.head('оба жмут одновременно');
/* Пять раз подряд обе стороны хватают одну и ту же карту в один и тот же
   миг. Ни одной карте не позволено достаться двоим или пропасть. */
let mineWins = 0, theirWins = 0;
for (let i = 0; i < 5; i++){
  const before = await look(A);
  const taken = (+before.me) + (+before.opp);
  const sa = await hit(A), sb = await hit(B);
  ok('раунд ' + (i + 1) + ': общий символ виден обоим', sa >= 0 && sb >= 0, [sa, sb]);
  await Promise.all([tap(A, sa), tap(B, sb)]);
  const gone = await until(A, look, s => s.mid !== before.mid, 12000) &&
               await until(B, look, s => s.mid !== before.mid, 12000);
  ok('раунд ' + (i + 1) + ': карта ушла и открылась следующая', gone);
  /* дать долететь ответу сервера обоим */
  await wait(900);
  const a = await look(A), b = await look(B);
  ok('раунд ' + (i + 1) + ': счёт сошёлся у обоих',
     a.me === b.opp && a.opp === b.me, [a.me + ':' + a.opp, b.me + ':' + b.opp]);
  ok('раунд ' + (i + 1) + ': карта досталась ровно одному, не двоим и не никому',
     (+a.me) + (+a.opp) === taken + 1, [taken, a.me, a.opp]);
  ok('раунд ' + (i + 1) + ': поле у обоих одно', a.mid === b.mid && a.mine === b.theirs, [a.mid, b.mid]);
  mineWins = +a.me; theirWins = +a.opp;
}
ok('за пять хваток разобрано пять карт', mineWins + theirWins === 5, [mineWins, theirWins]);

rep.head('промах');
{
  const before = await look(A);
  const bad = await wrong(A);
  ok('символ не с центральной карты нашёлся', bad >= 0, bad);
  await tap(A, bad);
  ok('своя карта подсвечена штрафом', await until(A, look, s => s.frozen, 4000));
  ok('счёт не изменился', (await look(A)).me === before.me);
  ok('и соперник ничего не заметил', (await look(B)).mid === before.mid);
  await until(A, look, s => !s.frozen, 4000);
}

rep.head('партия до конца');
/* дальше карты забирает кто успел: гоняем быстро, пока стопка не кончится */
for (let i = 0; i < 40; i++){
  const a = await look(A);
  if (a.sheet) break;
  const page = i % 3 === 0 ? B : A;               /* иногда пусть забирает второй */
  const s = await hit(page);
  if (s < 0){ await wait(400); continue; }
  const before = (await look(A)).mid;
  await tap(page, s);
  await until(A, look, x => x.mid !== before || x.sheet, 9000);
  await until(B, look, x => x.mid !== before || x.sheet, 9000);
  /* новая карта в центре видна сразу, а своя у взявшего ляжет, когда долетит */
  await until(A, look, x => !x.flying || x.sheet, 3000);
  await until(B, look, x => !x.flying || x.sheet, 3000);
}
await wait(1200);
{
  const a = await look(A), b = await look(B);
  ok('партия закончилась у обоих', a.sheet && b.sheet, [a.sheet, b.sheet]);
  ok('все 29 карт разобраны', (+a.me) + (+a.opp) === 29, [a.me, a.opp]);
  ok('счёт сошёлся', a.me === b.opp && a.opp === b.me, [a.me + ':' + a.opp, b.me + ':' + b.opp]);
  const winnerA = (+a.me) > (+a.opp) ? 'я' : 'соперник';
  const winnerB = (+b.me) > (+b.opp) ? 'соперник' : 'я';
  ok('победителя оба назвали одного', winnerA === winnerB, [a.sheetTitle, b.sheetTitle]);
}

rep.head('реванш');
await A.locator('#again').click();
ok('первый ждёт соперника', await until(A, look, s => /Ждём/.test(s.again), 6000), (await look(A)).again);
await B.locator('#again').click();
ok('новая раздача у первого', await until(A, look, s => !s.sheet && s.left === 'В стопке 29', 12000));
ok('и у второго', await until(B, look, s => !s.sheet && s.left === 'В стопке 29', 12000));
{
  const a = await look(A), b = await look(B);
  ok('карты нового раунда снова одни и те же', a.mid === b.mid && a.mine === b.theirs, [a.mid, b.mid]);
  ok('счёт обнулился', a.me === '0' && a.opp === '0' && b.me === '0' && b.opp === '0');
}

rep.head('обрыв связи');
await B.locator('#toMenuTop').click();
ok('первого предупредили', await until(A, lobby.warned, w => w.shown && /вышел/.test(w.text), 12000));

/* ───────── вдвоём на одном телефоне ─────────
   Верхняя половина стола повёрнута на 180°. На iPhone символы на карте
   верхнего игрока не нажимались: игра переводила касание в координаты карты
   через getScreenCTM(), а Safari не учитывает в нём CSS-повороты предков.
   Здесь браузер подменён так, чтобы getScreenCTM вёл себя как в Safari, —
   на старом коде эта часть падает. Касания — настоящим пальцем по
   экранным координатам, как на телефоне. */
rep.head('вдвоём на одном телефоне (getScreenCTM как в Safari)');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const D = await ctx.newPage();
  D.on('pageerror', (e) => { rep.failed++; console.log('  ОШИБКА В СТРАНИЦЕ:', e.message); });
  await D.addInitScript({ path: '/home/claude/net/tools/webkit-like.js' });
  await D.goto(URL);
  await D.locator('.row[data-mode="2"]').click();
  const duo = (page) => page.evaluate(() => ({
    ready: !document.getElementById('cMid').classList.contains('back'),
    top: document.getElementById('numTop').textContent, bot: document.getElementById('numBot').textContent,
    topFrozen: document.getElementById('zTop').classList.contains('frozen'),
    botFrozen: document.getElementById('zBot').classList.contains('frozen'),
    mid: [].map.call(document.querySelectorAll('#cMid .sy'), (g) => g.dataset.s).sort().join(',')
  }));
  /* экранный центр и радиус круга-мишени символа; common — общий с центральной */
  const spot = (page, card, which) => page.evaluate(([card, which]) => {
    const set = (q) => [].map.call(document.querySelectorAll(q + ' .sy'), (g) => +g.dataset.s);
    const mid = set('#cMid');
    const cr = document.querySelector(card).getBoundingClientRect();
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    /* Центр круга-мишени — середина его рамки. А радиус из рамки брать
       нельзя: у повёрнутого символа getBoundingClientRect даёт рамку
       повёрнутого квадрата вокруг круга — до 1.4 раза шире. Радиус на
       экране — 12 единиц символа × его масштаб × масштаб карты. */
    const pts = set(card).map((s) => {
      const g = document.querySelector(card + ' .sy[data-s="' + s + '"]');
      const r = g.querySelector('.hit').getBoundingClientRect();
      const k = +/scale\(([\d.]+)\)/.exec(g.parentNode.getAttribute('transform'))[1];
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      return { s, x, y, rad: 12 * k * cr.width / 200, off: Math.hypot(x - cx, y - cy), ux: (x - cx), uy: (y - cy) };
    });
    if (which === 'common') return pts.find((p) => mid.includes(p.s));
    /* не общий символ с краю карты — чтобы коснуться рядом с ним снаружи круга */
    const outer = pts.filter((p) => !mid.includes(p.s) && p.off > p.rad).sort((a, b) => b.off - a.off)[0];
    const k = outer.off, gap = outer.rad * 1.08;          /* чуть дальше края круга, но в пределах запаса ×1.17 */
    return Object.assign({}, outer, { x: outer.x + outer.ux / k * gap, y: outer.y + outer.uy / k * gap });
  }, [card, which]);

  ok('карты розданы', await until(D, duo, (s) => s.ready, 9000));
  let before = await duo(D);
  const t = await spot(D, '#cTop', 'common');
  await D.touchscreen.tap(t.x, t.y);
  ok('верхний игрок забрал карту, коснувшись символа на своей повёрнутой карте',
     await until(D, duo, (s) => s.top === '1' && s.mid !== before.mid, 4000), await duo(D));

  await until(D, duo, (s) => s.ready, 4000);
  before = await duo(D);
  const b = await spot(D, '#cBot', 'common');
  await D.touchscreen.tap(b.x, b.y);
  ok('нижний тоже', await until(D, duo, (s) => s.bot === '1' && s.mid !== before.mid, 4000), await duo(D));

  /* Касание рядом с символом, но мимо его круга: браузер тут символа не
     назовёт, и точку карты игра считает сама. Символ не общий — значит,
     если точка посчитана верно, это промах, и штраф получает верхний. */
  await until(D, duo, (s) => s.ready, 4000);
  const n = await spot(D, '#cTop', 'near');
  await D.touchscreen.tap(n.x, n.y);
  ok('касание рядом с символом на повёрнутой карте узнаётся: промах — штраф верхнему',
     await until(D, duo, (s) => s.topFrozen, 2500), await duo(D));
  ok('нижнего штраф не задел', !(await duo(D)).botFrozen);
  await ctx.close();
}

/* Анимации взятки. Раньше символ в момент взятки съезжал с места и вылезал
   за край карты (CSS-анимация заменяла атрибут transform его группы), а
   новая карта в центре «возвращалась» от игрока бумерангом. Теперь забранная
   карта летит отдельной копией, а центр сразу показывает следующую. */
rep.head('анимации: взятка, полёт, отмена');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const D = await ctx.newPage();
  D.on('pageerror', (e) => { rep.failed++; console.log('  ОШИБКА В СТРАНИЦЕ:', e.message); });
  await D.goto(URL);
  await D.locator('.row[data-mode="2"]').click();
  const st = () => D.evaluate(() => {
    const set = (q) => [].map.call(document.querySelectorAll(q + ' .sy'), (g) => +g.dataset.s).sort((a, b) => a - b).join(',');
    return { ready: !document.getElementById('cMid').classList.contains('back'), ghosts: document.querySelectorAll('.ghost').length,
             mid: set('#cMid'), bot: set('#cBot'), top: set('#cTop'),
             nb: document.getElementById('numBot').textContent, nt: document.getElementById('numTop').textContent };
  });
  /* центр круга-мишени символа на экране; m — общий символ карты who с центральной */
  const aim = (who) => D.evaluate((who) => {
    const set = (q) => [].map.call(document.querySelectorAll(q + ' .sy'), (g) => +g.dataset.s);
    const mid = set('#cMid'), m = set(who).find((x) => mid.includes(x));
    const c = (q) => { const r = document.querySelector(q + ' .sy[data-s="' + m + '"] .hit').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    return { m, me: c(who), mid: c('#cMid') };
  }, who);
  ok('у групп символов нет атрибута transform — анимация его не сотрёт', await D.evaluate(() =>
    document.querySelectorAll('.sy').length > 0 && !document.querySelector('.sy[transform]')));
  ok('раздача и отсчёт', await until(D, st, (s) => s.ready, 9000));
  await wait(300);
  let before = await st();
  let a = await aim('#cBot');
  await D.touchscreen.tap(a.me.x, a.me.y);
  await wait(150);
  const moved = await D.evaluate((m) => { const r = document.querySelector('#cMid .sy[data-s="' + m + '"] .hit').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, a.m);
  ok('общий символ вспыхивает на месте, не съезжая', Math.hypot(moved.x - a.mid.x, moved.y - a.mid.y) < 3, [a.mid, moved]);
  await wait(250);
  let s = await st();
  ok('карта летит копией, а в центре уже следующая', s.ghosts === 1 && s.mid !== before.mid, s);
  await until(D, st, (x) => x.ghosts === 0, 3000);
  s = await st();
  ok('долетела: у нижнего забранная карта, счёт 1', s.bot === before.mid && s.nb === '1', [before.mid, s]);
  /* вдвоём второй берёт, пока летит карта первого: обе ложатся на свои места */
  await wait(200);
  before = await st();
  /* сколько копий летело разом — считает сама страница, каждый кадр */
  await D.evaluate(() => { window.__maxG = 0; (function f(){ window.__maxG = Math.max(window.__maxG, document.querySelectorAll('.ghost').length); if (!window.__stopG) requestAnimationFrame(f); })(); });
  a = await aim('#cBot');
  await D.touchscreen.tap(a.me.x, a.me.y);
  await wait(330);
  const mid2 = (await st()).mid;
  const t = await aim('#cTop');
  await D.touchscreen.tap(t.me.x, t.me.y);
  await until(D, st, (x) => x.ghosts === 0 && x.nt === '1', 3000);
  const two = await D.evaluate(() => { window.__stopG = true; return window.__maxG; });
  s = await st();
  ok('две карты в полёте разом — обе долетели к своим', two === 2 && s.bot === before.mid && s.top === mid2 && s.nb === '2' && s.nt === '1', [two, s]);
  /* «Заново» посреди полёта — копия не остаётся висеть над новой раздачей */
  await wait(200);
  a = await aim('#cBot');
  await D.touchscreen.tap(a.me.x, a.me.y);
  await wait(420);
  await D.locator('#restart').click();
  await wait(200);
  s = await st();
  ok('«Заново» посреди полёта: копия убрана, счёт с нуля', s.ghosts === 0 && s.nb === '0' && !s.ready, s);
  await ctx.close();

  /* кто попросил телефон двигать поменьше — карты встают на место сразу */
  const cx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const R = await cx2.newPage();
  R.on('pageerror', (e) => { rep.failed++; console.log('  ОШИБКА В СТРАНИЦЕ:', e.message); });
  await R.goto(URL);
  await R.locator('.row[data-mode="2"]').click();
  await until(R, () => R.evaluate(() => !document.getElementById('cMid').classList.contains('back')), (x) => x, 6000);
  for (let i = 0; i < 2; i++){
    const p = await R.evaluate((who) => {
      const set = (q) => [].map.call(document.querySelectorAll(q + ' .sy'), (g) => +g.dataset.s);
      const mid = set('#cMid'), m = set(who).find((x) => mid.includes(x));
      const r = document.querySelector(who + ' .sy[data-s="' + m + '"] .hit').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, i ? '#cTop' : '#cBot');
    await R.touchscreen.tap(p.x, p.y);
    await wait(500);
  }
  ok('«меньше движения»: взятки засчитаны без полётов', await R.evaluate(() =>
    document.getElementById('numBot').textContent === '1' && document.getElementById('numTop').textContent === '1' &&
    !document.querySelector('.ghost')));
  await cx2.close();
}

await browser.close();
process.exit(rep.done('Доббль'));
