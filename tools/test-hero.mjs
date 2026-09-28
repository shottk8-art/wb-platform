/* Большая плашка на главном экране.
   Она больше не закреплена за одной игрой: поводов три — «Новое»,
   «Продолжить» и «Любимая», и при каждом открытии показывается следующий
   по кругу из тех, что сейчас есть. Здесь проверяется и сама очередь, и
   то, что любая игра в плашке выглядит целой: название не заезжает под
   кнопку, а высота карточки не скачет от игры к игре. */
import { BASE, wait, reporter, launch } from './netkit.mjs';

const rep = reporter();
const ok = rep.ok;
const browser = await launch();

const N = Date.now(), DAY = 86400000;

async function phone(hist){
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 } });
  const p = await ctx.newPage();
  /* историю кладём один раз: иначе каждая загрузка стирала бы память о том,
     какой повод показали прошлый раз, и очередь стояла бы на месте */
  await p.addInitScript(h => {
    try {
      if (!localStorage.getItem('dvoeplay:v1'))
        localStorage.setItem('dvoeplay:v1', JSON.stringify({ v:1, games: h }));
    } catch(e){}
  }, hist || {});
  return p;
}

const look = (p) => p.evaluate(() => {
  const hero = document.querySelector('.hero');
  const h3 = document.querySelector('.hero h3');
  const play = document.querySelector('.hero .play');
  const box = (e) => { const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height, right:r.right, bottom:r.bottom }; };
  /* ширина самого текста, а не блока: блок шире надписи и до кнопки достаёт всегда */
  const inkRight = (e) => {
    if (!e) return 0;
    const r = document.createRange();
    r.selectNodeContents(e);
    return r.getBoundingClientRect().right;
  };
  return {
    badge: (document.querySelector('.hero .badge') || {}).textContent,
    kind: ((document.querySelector('.hero .badge') || {}).className || '').replace('badge ', ''),
    title: h3 ? h3.textContent : '',
    note: (document.querySelector('.hero p') || {}).textContent,
    meta: (document.querySelector('.hero .hero-meta') || {}).textContent,
    artKind: ((document.querySelector('.hero .hero-art') || {}).className || '').replace('hero-art ',''),
    cta: play ? play.textContent : '',
    href: (hero || {}).getAttribute ? hero.getAttribute('href') : '',
    card: hero ? box(hero) : null,
    h3box: h3 ? box(h3) : null,
    h3ink: inkRight(h3),
    titleCut: h3 ? h3.scrollHeight > h3.clientHeight + 1 : false,
    playbox: play ? box(play) : null,
    noteCut: (() => { const e = document.querySelector('.hero p');
      return e ? e.scrollHeight > e.clientHeight + 1 : false; })(),
    art: !!document.querySelector('.hero .hero-art, .hero .hero-generic'),
    chips: [].map.call(document.querySelectorAll('.chip b'), e => e.textContent),
    tiles: [].map.call(document.querySelectorAll('.bento .t b'), e => e.textContent)
  };
});
const open = async (p) => { await p.goto(BASE + 'index.html'); await wait(320); return look(p); };

/* ───────── у нового игрока поводов нет, кроме «Новое» ───────── */
rep.head('первый запуск');
const fresh = await phone(null);
let a = await open(fresh), b = await open(fresh), c = await open(fresh);
ok('в плашке «Новое»', a.badge === 'Новое', a.badge);
ok('и она не скачет, пока истории нет',
   a.title === b.title && b.title === c.title, [a.title, b.title, c.title]);
ok('кнопка зовёт играть', a.cta === 'Играть', a.cta);
ok('описание новинки показано целиком, без обрезки', !a.noteCut, a.note);

/* ───────── одна сыгранная игра: два повода по очереди ───────── */
rep.head('сыграна одна партия');
const one = await phone({ 'matreshka': { plays:1, w1:1, w2:0, last:N - 3600e3, note:'Счёт 1 : 0', mode:2 } });
a = await open(one); b = await open(one); c = await open(one);
ok('сначала «Новое»', a.badge === 'Новое', a.badge);
ok('потом «Продолжить» с той самой игрой', b.badge === 'Продолжить' && b.title === 'Матрёшка',
   [b.badge, b.title]);
ok('кнопка там тоже «Продолжить»', b.cta === 'Продолжить', b.cta);
ok('в строке повода счёт и когда играли', /Счёт 1 : 0 · /.test(b.meta || ''), b.meta);
ok('а в подписи — описание игры', b.note === 'Большая фишка накрывает меньшую', b.note);
ok('дальше по кругу снова «Новое»', c.badge === 'Новое', c.badge);
ok('одной партии для «Любимой» мало', b.kind !== 'b-fav' && a.kind !== 'b-fav');

/* ───────── три повода ───────── */
rep.head('три повода по кругу');
const many = await phone({
  'matreshka':  { plays:2, w1:1, w2:1, last:N - 3600e3,   note:'Счёт 1 : 1', mode:2 },
  'dots-boxes': { plays:7, w1:4, w2:3, last:N - 3*DAY,    note:'Счёт 4 : 3', mode:2 },
  '5-bukv':     { plays:3, w1:2, w2:1, last:N - 6*DAY,    note:'Счёт 2 : 1', mode:2 }
});
const seen = [];
for (let i = 0; i < 6; i++) seen.push(await open(many));
ok('очередь идёт: новое → продолжить → любимая',
   seen.map(s => s.badge).join(',') === 'Новое,Продолжить,Любимая,Новое,Продолжить,Любимая',
   seen.map(s => s.badge).join(','));
ok('«Продолжить» — последняя сыгранная', seen[1].title === 'Матрёшка', seen[1].title);
ok('«Любимая» — та, где партий больше всего', seen[2].title === 'Точки и квадраты', seen[2].title);
ok('у любимой в строке повода число партий', /Сыграно 7 партий/.test(seen[2].meta || ''), seen[2].meta);
ok('и тоже с описанием игры', seen[2].note === 'Замкнули квадрат — ходите ещё раз', seen[2].note);
ok('ярлыки разного цвета', seen[0].kind === 'b-new' && seen[1].kind === 'b-cont' && seen[2].kind === 'b-fav',
   [seen[0].kind, seen[1].kind, seen[2].kind]);

rep.head('плашка и остальной экран не повторяют друг друга');
for (const s of seen.slice(0, 3)){
  ok('игры из плашки нет в строке «Продолжить» (' + s.title + ')',
     s.chips.indexOf(s.title) < 0, s.chips);
  ok('и нет в сетке (' + s.title + ')', s.tiles.indexOf(s.title) < 0, s.tiles);
}

/* ───────── любая игра в плашке выглядит целой ───────── */
rep.head('в плашке может быть любая игра');
const ALL = [
  ['dvoeplay','4 в ряд'], ['magnitniy-boy','Магнитный бой'], ['memo-duel','Мемо-дуэль'],
  ['matreshka','Матрёшка'], ['dots-boxes','Точки и квадраты'], ['5-bukv','5 букв'],
  ['viselica','Быстрая виселица'], ['zahlopni-yaschik','Захлопни ящик'], ['dobble','Доббль'], ['vzlomshik','Взломщик кода']
];
let heights = [];
for (const [id, title] of ALL){
  const one = {};
  one[id] = { plays:1, w1:1, w2:0, last:N - 600e3, note:'Счёт 1 : 0', mode:2 };
  const p = await phone(one);
  await open(p);                      /* первый заход — «Новое» */
  const s = await open(p);            /* второй — «Продолжить» с нашей игрой */
  ok(title + ': название не заезжает под кнопку',
     s.h3box && s.playbox && s.h3box.right <= s.playbox.x + 1,
     s.h3box && [Math.round(s.h3box.right), Math.round(s.playbox.x)]);
  ok(title + ': название целиком, без обрезки', !s.titleCut);
  ok(title + ': подпись целиком', !s.noteCut);
  ok(title + ': своя живая картинка, а не запасная', s.art && !!s.artKind, s.artKind);
  ok(title + ': ссылка ведёт в игру', (s.href || '').indexOf(id) === 0, s.href);
  heights.push(Math.round(s.card.h));
  await p.context().close();
}
ok('высота плашки одна и та же для всех игр',
   Math.max.apply(null, heights) - Math.min.apply(null, heights) <= 1, heights);

await browser.close();
process.exit(rep.done('Большая плашка'));
