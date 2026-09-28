/* Приложение, а не сайт: установка, иконки, офлайн и Telegram.
   Здесь нет игры — проверяется то, как приложение ставится на телефон,
   открывается без сети и ведёт себя внутри мини-приложения Telegram. */
import { BASE, wait, reporter, launch, until } from './netkit.mjs';
import { spawn } from 'node:child_process';

const rep = reporter();
const ok = rep.ok;
const browser = await launch();
const PAGES = ['index','dvoeplay','matreshka','magnitniy-boy','memo-duel','dots-boxes','5-bukv','viselica','zahlopni-yaschik','dobble','vzlomshik'];

/* размер PNG — из заголовка файла, без сторонних библиотек */
const pngSize = (buf) => (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG')
  ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null;

/* ───────── манифест и иконки ───────── */
rep.head('манифест и иконки');
const man = await (await fetch(BASE + 'manifest.webmanifest')).json();
ok('манифест читается', !!man && man.short_name === 'dvoeplay', man.short_name);
ok('открывается как приложение, без адресной строки', man.display === 'standalone', man.display);
ok('стартует с главного экрана', man.start_url === './index.html', man.start_url);
for (const ic of man.icons){
  const res = await fetch(BASE + ic.src);
  const size = pngSize(Buffer.from(await res.arrayBuffer()));
  const want = ic.sizes.split('x').map(Number);
  ok('иконка ' + ic.src + ' на месте и нужного размера',
     res.status === 200 && size && size[0] === want[0] && size[1] === want[1], [res.status, size, ic.sizes]);
}
ok('есть иконка для обрезки лаунчером (maskable)', man.icons.some(i => i.purpose === 'maskable'));
{
  const res = await fetch(BASE + 'apple-touch-icon.png');
  const size = pngSize(Buffer.from(await res.arrayBuffer()));
  ok('иконка для iPhone — PNG 180×180', res.status === 200 && size && size[0] === 180 && size[1] === 180, size);
}

ok('заставка и строка состояния при запуске — тёмные, в цвет иконки',
   man.background_color === '#1C1C1E' && man.theme_color === '#1C1C1E', [man.background_color, man.theme_color]);

/* Как иконка выглядит, проверяем по пикселям: картинку рисуем на холсте
   в браузере и считаем, где «рисунок» (светлое или цветное), а где фон. */
rep.head('иконки по пикселям');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  const look = (src) => p.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    const R = 0.40 * w;
    let minA = 255, out = 0, inside = 0, color = 0, white = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = (y * w + x) * 4, r = d[i], gr = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a < minA) minA = a;
      if (a < 200) continue;
      const lum = 0.2126 * r + 0.7152 * gr + 0.0722 * b, sat = Math.max(r, gr, b) - Math.min(r, gr, b);
      if (lum > 150 || sat > 70){
        if (Math.hypot(x + .5 - w / 2, y + .5 - h / 2) > R) out++; else inside++;
      }
      if (sat > 70) color++;
      if (lum > 200) white++;
    }
    const alpha = (x, y) => d[(y * w + x) * 4 + 3];
    return { w, minA, corner: alpha(0, 0), centre: alpha(w >> 1, h >> 1), out, inside, color, white };
  }, src);

  const touch = await look('apple-touch-icon.png');
  ok('iPhone: иконка без прозрачности — иначе iOS зальёт углы чёрным', touch.minA === 255, touch.minA);
  for (const n of ['icon-192.png', 'icon-512.png']){
    const s = await look(n);
    ok(n + ': углы скруглены и прозрачны, середина плотная', s.corner === 0 && s.centre === 255, [s.corner, s.centre]);
  }
  const mask = await look('icon-maskable-512.png');
  ok('maskable: на весь квадрат, без прозрачности', mask.minA === 255, mask.minA);
  ok('maskable: руки и надпись целиком в безопасном круге — лаунчер ничего не обрежет',
     mask.out === 0 && mask.inside > 20000, [mask.out, mask.inside]);
  ok('maskable: надпись «games» цветная, как на исходнике', mask.color > 2000, mask.color);

  const svg = await (await fetch(BASE + 'favicon.svg')).text();
  const m = /href="(data:image\/png;base64,[^"]+)"/.exec(svg);
  ok('значок вкладки — SVG с картинкой внутри', /^<svg/.test(svg) && !!m, svg.slice(0, 60));
  if (m){
    const fav = await look(m[1]);
    ok('значок вкладки: руки на месте', fav.white > fav.w * fav.w * 0.12, fav.white);
    ok('значок вкладки: без надписи — цветных букв нет', fav.color < 5, fav.color);
    ok('значок вкладки: углы скруглены, как у иконки', fav.corner === 0 && fav.centre === 255, [fav.corner, fav.centre]);
  }
  await ctx.close();
}

rep.head('каждая страница знает, что она приложение');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  for (const n of PAGES){
    await p.goto(BASE + n + '.html');
    const m = await p.evaluate(() => ({
      manifest: (document.querySelector('link[rel="manifest"]') || {}).getAttribute
        ? document.querySelector('link[rel="manifest"]').getAttribute('href') : '',
      touch: (document.querySelector('link[rel="apple-touch-icon"]') || { getAttribute: () => '' }).getAttribute('href'),
      title: (document.querySelector('meta[name="apple-mobile-web-app-title"]') || { content: '' }).content,
      bar: (document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]') || { content: '' }).content,
      fav: (document.querySelector('link[rel="icon"][type="image/svg+xml"]') || { getAttribute: () => '' }).getAttribute('href')
    }));
    ok(n + ': манифест, PNG-иконка, одно название и одна строка состояния',
       m.manifest === 'manifest.webmanifest' && m.touch === 'apple-touch-icon.png' &&
       m.title === 'dvoeplay' && m.bar === 'default', m);
    ok(n + ': значок вкладки — знак приложения', m.fav === 'favicon.svg', m.fav);
  }
  await ctx.close();
}

/* ───────── офлайн ───────── */
/* Отключить сеть «понарошку» тут нельзя: эмуляция офлайна в браузере не
   действует на запросы самого сервис-воркера, и он честно сходил бы на
   сервер. Поэтому поднимаем отдельный сервер и по-настоящему гасим его. */
rep.head('без сети');
const OFF = 'http://localhost:8788/';
const srv = spawn('node', ['tools/dev-server.mjs'], { cwd: '/home/claude/net', env: { ...process.env, PORT: '8788' },
                                                     stdio: 'ignore' });
for (let i = 0; i < 40; i++){
  try { if ((await fetch(OFF + 'index.html')).ok) break; } catch(e){}
  await wait(150);
}
const off = await browser.newContext({ viewport: { width: 390, height: 844 } });
const O = await off.newPage();
await O.goto(OFF + 'index.html');
const ready = await O.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return !!(reg && reg.active);
});
ok('офлайн-режим установился', ready);
/* ждём, пока в кеш лягут все файлы — установка идёт в фоне */
const cached = await until(O, p => p.evaluate(async () => {
  const keys = await caches.keys();
  if (!keys.length) return 0;
  const c = await caches.open(keys[0]);
  return (await c.keys()).length;
}), n => n >= 13, 15000);
ok('в кеше всё нужное для запуска', cached);
/* иконки просит система, а не страница, — они идут мимо кеша, всегда с сайта */
const pngCached = await O.evaluate(async () => {
  await fetch('icon-192.png'); await fetch('apple-touch-icon.png');
  await new Promise(r => setTimeout(r, 400));
  const keys = await caches.keys(); const c = await caches.open(keys[0]);
  return (await c.keys()).filter(r => /\.png$/.test(r.url)).map(r => r.url);
});
ok('PNG-иконки в офлайн-кеш не попадают', pngCached.length === 0, pngCached);

rep.head('обновление приходит само');
/* удаляем файл из кеша — после открытия со связью он должен вернуться */
await O.evaluate(async () => {
  const keys = await caches.keys(); const c = await caches.open(keys[0]);
  await c.delete(location.origin + '/matreshka.html');
});
await O.goto(OFF + 'matreshka.html');
ok('свежая версия легла в кеш на следующий раз', await until(O, p => p.evaluate(async () => {
  const keys = await caches.keys(); const c = await caches.open(keys[0]);
  return !!(await c.match(location.origin + '/matreshka.html'));
}), v => v, 8000));

rep.head('сервер погашен — сети нет совсем');
srv.kill('SIGKILL');
await wait(500);
let down = false;
try { await fetch(OFF + 'index.html'); } catch(e){ down = true; }
ok('сервер действительно недоступен', down);
await O.goto(OFF + 'index.html');
ok('главный экран открылся без сети',
   await O.evaluate(() => !!document.querySelector('.hero') && document.title.indexOf('dvoeplay') >= 0));
for (const n of ['dvoeplay', 'matreshka', '5-bukv', 'zahlopni-yaschik']){
  await O.goto(OFF + n + '.html');
  ok(n + ' открылась без сети', await O.evaluate(() => !!document.querySelector('.row, .list')));
}
await O.goto(OFF + 'dvoeplay.html?room=12345');
ok('ссылка-приглашение без сети тоже открывает игру',
   await O.evaluate(() => !!document.querySelector('.row, .list')));
await O.goto(OFF + 'nichego-takogo.html');
ok('неизвестная страница без сети — главный экран, а не ошибка',
   await O.evaluate(() => !!document.querySelector('.hero')));
const apiCached = await O.evaluate(async () => {
  const keys = await caches.keys(); const c = await caches.open(keys[0]);
  return (await c.keys()).some(r => r.url.indexOf('/api/') >= 0);
});
ok('запросы сетевой игры в кеш не попадают', !apiCached);
await off.close();

/* ───────── Telegram ───────── */
/* Настоящий скрипт Telegram подменяем записывающим: он отмечает, какие
   методы вызвала страница. Так проверяется наша сторона — что и когда мы просим. */
const FAKE = (scheme) => `
window.__tg = [];
(function(){
  function rec(n){ return function(){ window.__tg.push([n].concat([].slice.call(arguments))); }; }
  window.Telegram = { WebApp: {
    colorScheme: '${scheme}',
    ready: rec('ready'), expand: rec('expand'), disableVerticalSwipes: rec('disableVerticalSwipes'),
    setHeaderColor: rec('setHeaderColor'), setBackgroundColor: rec('setBackgroundColor'),
    onEvent: function(n, f){ window.__tg.push(['onEvent', n]); },
    BackButton: { show: rec('back.show'), hide: rec('back.hide'),
                  onClick: function(f){ window.__tgBack = f; window.__tg.push(['back.onClick']); } },
    HapticFeedback: { impactOccurred: rec('impact'), notificationOccurred: rec('notify') }
  }};
})();`;

async function telegram(scheme, stored){
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let loads = 0;
  await ctx.route('https://telegram.org/js/telegram-web-app.js', r => {
    loads++;
    r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE(scheme) });
  });
  if (stored) await ctx.addInitScript(t => {
    try { if (!localStorage.getItem('dvoeplay:v1'))
      localStorage.setItem('dvoeplay:v1', JSON.stringify({ v:1, theme:t, games:{} })); } catch(e){}
  }, stored);
  const p = await ctx.newPage();
  return { ctx, p, loads: () => loads };
}
const calls = (p) => p.evaluate(() => (window.__tg || []).map(c => c.join(':')));
const tgReady = (p) => until(p, calls, c => c.indexOf('ready') >= 0, 6000);

rep.head('снаружи Telegram');
{
  const t = await telegram('light');
  await t.p.goto(BASE + 'index.html');
  await wait(600);
  ok('скрипт Telegram не грузится — он там не нужен', t.loads() === 0, t.loads());
  await t.ctx.close();
}

rep.head('внутри Telegram');
{
  const t = await telegram('light');
  await t.p.goto(BASE + 'index.html#tgWebAppData=query_id%3D1&tgWebAppVersion=8.0&tgWebAppPlatform=ios');
  ok('скрипт Telegram подгрузился', await tgReady(t.p));
  const c = await calls(t.p);
  ok('сказали Telegram, что готовы', c.indexOf('ready') >= 0, c);
  ok('развернулись на всю высоту', c.indexOf('expand') >= 0, c);
  ok('свайп вниз больше не сворачивает приложение', c.indexOf('disableVerticalSwipes') >= 0, c);
  ok('шапка Telegram в цвет светлой темы', c.indexOf('setHeaderColor:#F2F2F7') >= 0, c);
  ok('на главном экране кнопки «Назад» нет', c.indexOf('back.hide') >= 0, c);

  /* переход в игру: хвоста #tgWebAppData в адресе уже нет */
  await t.p.goto(BASE + 'dvoeplay.html');
  ok('в игре Telegram узнаётся и без хвоста в адресе', await tgReady(t.p));
  const g = await calls(t.p);
  ok('в игре показана кнопка «Назад»', g.indexOf('back.show') >= 0 && g.indexOf('back.onClick') >= 0, g);
  await t.p.locator('.row').first().dispatchEvent('pointerdown');
  await wait(200);
  ok('нажатие отзывается настоящей вибрацией Telegram',
     (await calls(t.p)).some(x => x.indexOf('impact') === 0), await calls(t.p));
  await t.p.evaluate(() => window.__tgBack && window.__tgBack());
  await t.p.waitForURL(/index\.html$/, { timeout: 5000 }).catch(() => {});
  ok('«Назад» ведёт на главный экран', /index\.html$/.test(t.p.url()), t.p.url());
  await t.ctx.close();
}

rep.head('тема внутри Telegram');
{
  const t = await telegram('dark');
  await t.p.goto(BASE + 'index.html#tgWebAppData=x&tgWebAppVersion=8.0');
  await tgReady(t.p);
  await wait(300);
  const s = await t.p.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-theme'),
    bg: getComputedStyle(document.body).backgroundColor,
    moon: !!document.querySelector('#themeBtn svg path[d^="M20.3"]')
  }));
  ok('своей темы нет — берём тёмную тему Telegram', s.attr === 'dark' && s.bg === 'rgb(28, 28, 30)', s);
  ok('и кнопка темы это показывает', s.moon);
  ok('шапка Telegram в цвет тёмной темы', (await calls(t.p)).indexOf('setHeaderColor:#1C1C1E') >= 0);
  await t.p.locator('#themeBtn').click();
  await wait(300);
  ok('переключили тему — шапка Telegram перекрасилась',
     (await calls(t.p)).indexOf('setHeaderColor:#F2F2F7') >= 0, await calls(t.p));
  await t.ctx.close();
}
{
  const t = await telegram('dark', 'light');
  await t.p.goto(BASE + 'index.html#tgWebAppData=x&tgWebAppVersion=8.0');
  await tgReady(t.p);
  await wait(300);
  const attr = await t.p.evaluate(() => document.documentElement.getAttribute('data-theme'));
  ok('свой выбор важнее темы Telegram', attr === 'light', attr);
  await t.ctx.close();
}

await browser.close();
process.exit(rep.done('Приложение'));
