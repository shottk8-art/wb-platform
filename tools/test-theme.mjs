/* Переключатель темы в хабе.
   Главное, что здесь проверяется: выбор игрока важнее настроек телефона,
   он держится после перезапуска, доезжает до игр — и применяется ДО первой
   отрисовки, иначе приложение будет мигать чужим фоном на каждом запуске. */
import { BASE, wait, reporter, launch, until } from './netkit.mjs';

const rep = reporter();
const ok = rep.ok;
const browser = await launch();

/* запоминаем, какая тема стояла на самом первом кадре */
const SPY = () => {
  try {
    requestAnimationFrame(function(){
      window.__first = document.documentElement.getAttribute('data-theme');
    });
  } catch(e){}
};

async function page(sys){
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, colorScheme: sys });
  const p = await ctx.newPage();
  await p.addInitScript(SPY);
  return p;
}
const look = (p) => p.evaluate(() => ({
  attr: document.documentElement.getAttribute('data-theme'),
  bg: getComputedStyle(document.body).backgroundColor,
  meta: [].map.call(document.querySelectorAll('meta[name="theme-color"]'), m => m.content).join(' '),
  saved: (JSON.parse(localStorage.getItem('dvoeplay:v1') || '{}')).theme || '',
  label: (document.getElementById('themeBtn') || {}).ariaLabel ||
         (document.getElementById('themeBtn') || {getAttribute:()=>''}).getAttribute('aria-label'),
  moon: !!document.querySelector('#themeBtn svg path[d^="M20.3"]'),
  live: (document.getElementById('live') || {}).textContent,
  first: window.__first === undefined ? 'нет' : String(window.__first)
}));
const DARK = 'rgb(28, 28, 30)', LIGHT = 'rgb(242, 242, 247)';

rep.head('телефон в светлой теме');
const A = await page('light');
await A.goto(BASE + 'index.html');
await wait(400);
let s = await look(A);
ok('своего выбора нет — атрибута тоже', s.attr === null, s.attr);
ok('фон светлый', s.bg === LIGHT, s.bg);
ok('на кнопке солнце', !s.moon);

await A.locator('#themeBtn').click();
await wait(400);
s = await look(A);
ok('нажали — стало темно', s.attr === 'dark' && s.bg === DARK, [s.attr, s.bg]);
ok('выбор сохранён', s.saved === 'dark', s.saved);
ok('на кнопке месяц', s.moon);
ok('цвет строки состояния тоже тёмный', s.meta === '#1C1C1E #1C1C1E', s.meta);
ok('сказано вслух', /Тёмная тема/.test(s.live || ''), s.live);
ok('подпись зовёт обратно в светлую', /включить светлую/i.test(s.label || ''), s.label);

rep.head('после перезапуска');
await A.reload();
await wait(400);
s = await look(A);
ok('тема на месте', s.attr === 'dark' && s.bg === DARK, [s.attr, s.bg]);
ok('и она стояла уже на первом кадре — приложение не мигает',
   s.first === 'dark', s.first);

rep.head('выбор доезжает до игр');
await A.goto(BASE + 'dvoeplay.html');
await wait(400);
s = await look(A);
ok('в игре темно', s.attr === 'dark' && s.bg === DARK, [s.attr, s.bg]);
ok('и тоже с первого кадра', s.first === 'dark', s.first);
await A.goto(BASE + 'viselica.html');
await wait(300);
ok('и в другой игре', (await look(A)).bg === DARK);

rep.head('телефон в тёмной теме');
const B = await page('dark');
await B.goto(BASE + 'index.html');
await wait(400);
s = await look(B);
ok('без выбора — темно, как в телефоне', s.attr === null && s.bg === DARK, [s.attr, s.bg]);
ok('на кнопке месяц', s.moon);
await B.locator('#themeBtn').click();
await wait(400);
s = await look(B);
ok('нажали — стало светло, хотя телефон тёмный', s.attr === 'light' && s.bg === LIGHT, [s.attr, s.bg]);
ok('выбор сохранён', s.saved === 'light', s.saved);
ok('строка состояния светлая', s.meta === '#F2F2F7 #F2F2F7', s.meta);

await B.goto(BASE + 'zahlopni-yaschik.html');
await wait(400);
s = await look(B);
ok('игра тоже светлая', s.bg === LIGHT, s.bg);
ok('с первого кадра', s.first === 'light', s.first);

rep.head('тема и остальные настройки не мешают друг другу');
await B.goto(BASE + 'index.html');
await wait(400);
await B.locator('#whoBtn').click();
await wait(300);
await B.locator('#nameMe').fill('Карл');
await B.locator('#whoClose').click();
await wait(300);
await B.locator('#sndBtn').click();
await wait(300);
const all = await B.evaluate(() => JSON.parse(localStorage.getItem('dvoeplay:v1')));
ok('в памяти рядом лежат имя, звук и тема',
   all.theme === 'light' && all.sound === false && all.names.me === 'Карл',
   [all.theme, all.sound, all.names && all.names.me]);
await B.reload();
await wait(400);
ok('после перезапуска всё на месте', (await look(B)).bg === LIGHT);

await browser.close();
process.exit(rep.done('Тема'));
