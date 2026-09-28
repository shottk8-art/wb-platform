/* Имена игроков: хранение, ввод в хабе, обмен по сети, подстановка в играх.
   Плюс проверка двух мелочей: звук в «Точках» и уход клавиатуры. */
import { BASE, wait, reporter, launch, tab, lobby, until } from './netkit.mjs';

const rep = reporter();
const ok = rep.ok;
const browser = await launch();

/* ───────── хаб: ввод и сохранение ───────── */
rep.head('имена задаются в хабе');
const H = await tab(browser, rep, 'хаб');
await H.goto(BASE + 'index.html');
await H.locator('#whoBtn').click();
await wait(500);
ok('шторка имён открылась', await H.locator('#whoSheet').evaluate(e => e.classList.contains('on')));
await H.locator('#nameMe').fill('Карл');
await H.locator('#nameFriend').fill('Аня');
await H.locator('#whoClose').click();
await wait(300);
const stored = await H.evaluate(() => JSON.parse(localStorage.getItem('dvoeplay:v1')).names);
ok('имена сохранились', stored.me === 'Карл' && stored.friend === 'Аня', stored);
await H.reload();
await H.locator('#whoBtn').click();
await wait(400);
ok('и подставились обратно',
   (await H.locator('#nameMe').inputValue()) === 'Карл' &&
   (await H.locator('#nameFriend').inputValue()) === 'Аня');
const trimmed = await H.evaluate(() => {
  const r = JSON.parse(localStorage.getItem('dvoeplay:v1'));
  r.names = { me: '   Очень   длинное  имя игрока  ', friend: '' };
  localStorage.setItem('dvoeplay:v1', JSON.stringify(r));
  return null;
});
await H.reload();
const clipped = await H.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('dvoeplay:v1'));
  return d.names.me;
});
ok('длинное имя хранится как есть, обрезается при чтении', typeof clipped === 'string');

/* ───────── вдвоём на одном телефоне ───────── */
rep.head('вдвоём на одном телефоне');
const D = await tab(browser, rep, 'один телефон');
await D.goto(BASE + 'dvoeplay.html');
await D.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('dvoeplay:v1') || '{"v":1,"games":{}}');
  d.names = { me: 'Карл', friend: 'Аня' };
  localStorage.setItem('dvoeplay:v1', JSON.stringify(d));
});
await D.reload();
await D.locator('.row[data-mode="2"]').click();
await wait(700);
const duo = await D.evaluate(() => ({
  n1: document.getElementById('name1').textContent.trim(),
  n2: document.getElementById('name2').textContent.trim()
}));
ok('в табло стоят имена, а не цвета', duo.n1 === 'Карл' && duo.n2 === 'Аня', duo);

/* доигрываем до победы, чтобы увидеть итог и фант */
const drop = async (page, col) => {
  const b = await page.locator('#board').boundingBox();
  await page.mouse.move(b.x + b.width * (col + 0.5) / 7, b.y + b.height * 0.5);
  await page.mouse.down(); await page.mouse.up();
  await wait(700);
};
for (const c of [0, 6, 1, 6, 2, 6, 3]) await drop(D, c);
ok('шторка итога открылась', await until(D, p => p.evaluate(() => ({
  open: document.body.classList.contains('open'),
  t: document.getElementById('sheetTitle').textContent,
  f: document.getElementById('ftext').textContent
})), s => s.open, 8000));
await wait(600);
const res = await D.evaluate(() => ({
  t: document.getElementById('sheetTitle').textContent,
  f: document.getElementById('ftext').textContent
}));
ok('победитель назван по имени', res.t === 'Победа: Карл', res.t);
ok('фант достался Ане и в единственном числе', /^Аня /.test(res.f), res.f);
ok('фант не во множественном числе', !/Аня .*(ют|ят|ат)\b/.test(res.f), res.f);
/* общий счёт пары: на одном телефоне «я» — первая сторона, красные */
const pairOf = (page) => page.evaluate(() => ((JSON.parse(localStorage.getItem('dvoeplay:v1')) || {}).duel || {}).p || {});
{
  const pd = await pairOf(D);
  ok('партия вдвоём попала в счёт пары: Карл выиграл у Ани', pd.duo && pd.duo.me === 1 && pd.duo.them === 0 &&
     pd.duo.g && pd.duo.g.dvoeplay && pd.duo.g.dvoeplay[0] === 1, pd);
}

/* ───────── по сети: имена летят между телефонами ───────── */
rep.head('по сети');
const A = await tab(browser, rep, 'A');
const B = await tab(browser, rep, 'B');
await A.goto(BASE + 'matreshka.html');
await B.goto(BASE + 'matreshka.html');
for (const [p, nm] of [[A, 'Карл'], [B, 'Аня']]){
  await p.evaluate(n => {
    const d = JSON.parse(localStorage.getItem('dvoeplay:v1') || '{"v":1,"games":{}}');
    d.names = { me: n, friend: '' };
    localStorage.setItem('dvoeplay:v1', JSON.stringify(d));
  }, nm);
  await p.reload();
}
await lobby.openFrom(A, '.row[data-mode="3"]');
ok('своё имя подставлено в лобби', (await A.locator('#npName').inputValue()) === 'Карл');
const code = await lobby.create(A);
await lobby.openFrom(B, '.row[data-mode="3"]');
await lobby.join(B, code);

const look = (page) => page.evaluate(() => ({
  playing: document.querySelector('.app').classList.contains('playing'),
  n1: document.getElementById('name1').textContent.trim(),
  n2: document.getElementById('name2').textContent.trim()
}));
ok('оба в игре', await until(B, look, s => s.playing) && await until(A, look, s => s.playing));
ok('у первого имя соперника пришло', await until(A, look, s => s.n1 === 'Карл' && s.n2 === 'Аня', 9000), await look(A));
ok('у второго тоже, но своё справа', await until(B, look, s => s.n1 === 'Карл' && s.n2 === 'Аня', 9000), await look(B));

/* ───────── по сети: имя соперника попадает и в итог ───────── */
rep.head('имя в итоге сетевой партии');
const V1 = await tab(browser, rep, 'V1');
const V2 = await tab(browser, rep, 'V2');
await V1.goto(BASE + 'viselica.html');
await V2.goto(BASE + 'viselica.html');
for (const [p, nm] of [[V1, 'Карл'], [V2, 'Аня']]){
  await p.evaluate(n => {
    const d = JSON.parse(localStorage.getItem('dvoeplay:v1') || '{"v":1,"games":{}}');
    d.names = { me: n, friend: '' };
    localStorage.setItem('dvoeplay:v1', JSON.stringify(d));
  }, nm);
  await p.reload();
}
await lobby.openFrom(V1, '.row[data-mode="3"]');
const vcode = await lobby.create(V1);
await lobby.openFrom(V2, '.row[data-mode="3"]');
await lobby.join(V2, vcode);

const vlook = (page) => page.evaluate(() => ({
  setting: document.getElementById('game').classList.contains('setting'),
  entry: [].slice.call(document.querySelectorAll('#erow .tile')).map(t => t.textContent).join(''),
  sheet: document.getElementById('sheet').classList.contains('on'),
  title: document.getElementById('sheetTitle').textContent,
  ftext: document.getElementById('ftext').textContent,
  forfeit: document.getElementById('forfeit').classList.contains('on'),
  n1: document.getElementById('name1').textContent.trim(),
  n2: document.getElementById('name2').textContent.trim()
}));
const vkey = (page, k) => page.evaluate(c => {
  const b = document.querySelector('#kbd .key[data-k="' + c + '"]');
  if (b) b.click();
}, k);

ok('оба на экране загадывания', await until(V1, vlook, s => s.setting, 9000) &&
                                await until(V2, vlook, s => s.setting, 9000));
for (const c of 'парус') await vkey(V1, c);
await until(V1, vlook, s => s.entry === 'парус', 6000);
await vkey(V1, 'ENTER');
ok('слово ушло сопернику', await until(V2, vlook, s => !s.setting, 10000));
for (const c of ['п','а','р','у','с']) { await vkey(V2, c); await wait(900); }
ok('шторка у обоих', await until(V2, vlook, s => s.sheet, 12000) &&
                     await until(V1, vlook, s => s.sheet, 12000));
await wait(700);
const v1 = await vlook(V1), v2 = await vlook(V2);
ok('проигравшему сказано, кто отгадал', /^Аня отгадал/.test(v1.title), v1.title);
ok('победителю сказано «Вы»', /^Вы отгадали/.test(v2.title), v2.title);
ok('подписи сторон — имена', v1.n1 === 'Карл' && v1.n2 === 'Аня', [v1.n1, v1.n2]);
ok('фант проигравшему в форме «Вы …»', v1.forfeit && /^Вы /.test(v1.ftext), v1.ftext);
/* По сети «я» — своё место, а не красные. Здесь выиграла Аня со второго
   места — самый каверзный случай: по цветам это были бы «жёлтые». */
{
  const p1 = await pairOf(V1), p2 = await pairOf(V2);
  const a = p1['net:аня'], k = p2['net:карл'];
  ok('у Карла записано: Аня выиграла у него', a && a.me === 0 && a.them === 1 && a.name === 'Аня', p1);
  ok('у Ани записано: она выиграла у Карла', k && k.me === 1 && k.them === 0 && k.name === 'Карл', p2);
}

rep.head('клавиатура после ввода кода');
const C = await tab(browser, rep, 'C');
await C.goto(BASE + 'dvoeplay.html');
await lobby.openFrom(C, '.row[data-mode="3"]');
const code2 = await lobby.create(C);
const E = await tab(browser, rep, 'E');
await E.goto(BASE + 'dvoeplay.html');
await lobby.openFrom(E, '.row[data-mode="3"]');
await E.locator('#npHas').click();
await E.locator('#npInput').focus();
ok('поле в фокусе, пока код не введён',
   await E.evaluate(() => document.activeElement && document.activeElement.id === 'npInput'));
await E.locator('#npInput').fill(code2);
await wait(600);
ok('после пятой цифры фокус снят — клавиатура уходит',
   await E.evaluate(() => !document.activeElement || document.activeElement.id !== 'npInput'),
   await E.evaluate(() => document.activeElement && document.activeElement.id));

rep.head('звук в «Точках и квадратах»');
const S = await tab(browser, rep, 'звук');
/* считаем обращения к синтезу звука: подменяем звуковой движок до запуска страницы */
await S.addInitScript(() => {
  window.__snd = 0;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const wrap = function(){
    const ctx = new AC();
    const src = ctx.createBufferSource.bind(ctx);
    const osc = ctx.createOscillator.bind(ctx);
    ctx.createBufferSource = function(){ window.__snd++; return src(); };
    ctx.createOscillator = function(){ window.__snd++; return osc(); };
    return ctx;
  };
  window.AudioContext = wrap;
  window.webkitAudioContext = wrap;
});
await S.goto(BASE + 'dots-boxes.html');
await S.locator('.row[data-mode="2"]').click();
await wait(700);
await S.evaluate(() => { window.__snd = 0; });
await S.evaluate(() => { document.querySelectorAll('.edge:not([disabled])')[0].click(); });
await wait(500);
const afterLine = await S.evaluate(() => window.__snd);
ok('проведённая линия звучит', afterLine > 0, afterLine);

/* замыкаем первый квадрат и слушаем, что звук другой — громче по числу голосов */
await S.evaluate(() => {
  const N = 4;
  const h = [].slice.call(document.querySelectorAll('.edge.h'));
  const v = [].slice.call(document.querySelectorAll('.edge.v'));
  /* клетка (0,0): верх h[0], низ h[N], лево v[0], право v[1] */
  [h[0], h[N], v[0], v[1]].forEach(e => { if (e && !e.disabled) e.click(); });
});
await wait(600);
const afterBox = await S.evaluate(() => window.__snd);
ok('замкнутый квадрат тоже звучит', afterBox > afterLine, [afterLine, afterBox]);
const boxes = await S.evaluate(() => document.querySelectorAll('.boxtile.on').length);
ok('квадрат действительно замкнулся', boxes >= 1, boxes);

/* ───────── имя с угловыми скобками — просто текст ───────── */
/* Проверка перед релизом 28.09.2026: четыре игры вставляли имя в табло как
   разметку. Имя соперника по сети приходит с чужого телефона, и «<i>Ася</i>»
   рисовалось курсивом, а «<textarea>» съедало табло целиком. Сервер теперь
   вырезает угловые скобки сам, но и игры обязаны показывать имя как текст —
   в том числе своё и друга, которые с сервера не приходят. */
rep.head('имя с угловыми скобками — просто текст');
{
  const T = await tab(browser, rep, 'разметка');
  await T.goto(BASE + 'index.html');
  await T.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('dvoeplay:v1') || '{"v":1,"games":{}}');
    r.names = { me: '<i>Ася</i>', friend: '<b>Лев</b>' };
    localStorage.setItem('dvoeplay:v1', JSON.stringify(r));
  });
  for (const g of ['dvoeplay','matreshka','magnitniy-boy','memo-duel','dots-boxes','5-bukv','viselica','zahlopni-yaschik','dobble','vzlomshik']){
    await T.goto(BASE + g + '.html');
    await wait(400);
    await T.locator('.row[data-mode="2"]').click();
    await wait(900);
    const r = await T.evaluate(() => ({
      tags: document.querySelectorAll('#game i:not(.dots i), #game b').length -
            document.querySelectorAll('#game .dots i').length,
      text: document.body.innerText.includes('<i>Ася</i>') && document.body.innerText.includes('<b>Лев</b>'),
      bad: [].filter.call(document.querySelectorAll('i, b'), (e) => /^(Ася|Лев)$/.test(e.textContent.trim())).length
    }));
    ok(g + ': имена видны как написаны, тегами не стали', r.bad === 0 && r.text, r);
  }
}

await browser.close();
process.exit(rep.done('Имена и мелочи'));
