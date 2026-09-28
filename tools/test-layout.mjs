/* Раскладка на любом экране — то, что нашла проверка перед релизом 28.09.2026.

   1. Меню игры на низком экране. На iPhone SE в Safari видно 375×548: меню
      не помещалось, и заставка над логотипом сплющивалась в полоску или
      пропадала совсем, а подпись под логотипом наезжала на заголовок списка.
      Теперь ничто не сжимается, меню прокручивается — проверяем, что
      заставка целая, подпись не наезжает и низ списка досягаем.
   2. Планшет и компьютер: колонка шириной с телефон по центру окна, шторка
      итога не шире её. Раньше в девяти играх список, табло и кнопки
      растягивались на всё окно — только «4 в ряд» стояла колонкой.
   3. «Уменьшить движение»: точки ожидания не мерцают. Бесконечная анимация,
      сжатая до миллисекунды, не замирала, а меняла прозрачность каждый кадр. */
import { BASE, wait, reporter, launch } from './netkit.mjs';

const rep = reporter();
const ok = rep.ok;
const browser = await launch();
const GAMES = ['dvoeplay','matreshka','magnitniy-boy','memo-duel','dots-boxes','5-bukv','viselica','zahlopni-yaschik','dobble','vzlomshik'];

async function page(w, h, extra){
  const ctx = await browser.newContext(Object.assign({ viewport: { width: w, height: h }, serviceWorkers: 'block' }, extra || {}));
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { rep.failed++; console.log('  ОШИБКА В СТРАНИЦЕ:', e.message); });
  return P;
}
const menu = (P) => P.evaluate(() => {
  const m = document.getElementById('menu'), mini = m.querySelector('.mini');
  const r = mini.getBoundingClientRect(), ar = getComputedStyle(mini).aspectRatio.split('/').map(parseFloat);
  const fn = m.querySelector('.footnote'), sec = m.querySelector('.section');
  const rows = m.querySelectorAll('.row'), last = rows[rows.length - 1];
  m.scrollTop = m.scrollHeight;
  const reach = last.getBoundingClientRect().bottom <= innerHeight + 1;
  m.scrollTop = 0;
  return { h: Math.round(r.height), want: Math.round(r.width / (ar[0] / (ar[1] || 1))),
           over: fn && sec ? Math.round(fn.getBoundingClientRect().bottom - sec.getBoundingClientRect().top) : 0, reach };
});

for (const [w, h] of [[375, 548], [320, 480]]){
  rep.head('меню на низком экране ' + w + '×' + h);
  const P = await page(w, h, { hasTouch: true, isMobile: true });
  for (const g of GAMES){
    await P.goto(BASE + g + '.html');
    await wait(250);
    const s = await menu(P);
    ok(g + ': заставка целая, подпись не наезжает, низ списка досягаем', s.h >= s.want - 1 && s.over <= 0 && s.reach, s);
  }
  await P.context().close();
}

rep.head('планшет и компьютер');
for (const [w, h] of [[1280, 800], [768, 1024]]){
  const P = await page(w, h);
  for (const g of GAMES){
    await P.goto(BASE + g + '.html');
    await wait(250);
    const list = await P.evaluate(() => Math.round(document.querySelector('#menu .list').getBoundingClientRect().width));
    await P.locator('.row[data-mode="2"]').click();
    await wait(700);
    const sheet = await P.evaluate(() => {
      const s = document.getElementById('sheet');
      s.classList.add('on');
      const r = s.getBoundingClientRect();
      return { w: Math.round(r.width), mid: Math.round(r.left + r.width / 2 - innerWidth / 2) };
    });
    ok(g + ' ' + w + '×' + h + ': колонка не шире 520, шторка по центру', list <= 520 && sheet.w <= 520 && Math.abs(sheet.mid) <= 1, { list, sheet });
  }
  await P.context().close();
}

rep.head('низкий альбомный телефон: раскладку «руки по бокам» не зажали');
{
  const P = await page(844, 390, { hasTouch: true, isMobile: true });
  for (const g of ['matreshka', 'dots-boxes', 'zahlopni-yaschik']){
    await P.goto(BASE + g + '.html');
    await wait(250);
    const pad = await P.evaluate(() => parseFloat(getComputedStyle(document.getElementById('menu')).paddingLeft));
    ok(g + ': поля по бокам обычные', pad <= 60, pad);
  }
  await P.context().close();
}

rep.head('закрытые шторки не оставляют тень по низу экрана');
{
  /* Шторка, сдвинутая ровно на свою высоту, прячется за край, а её тень
     (0 -10px 40px) — нет: по низу каждого экрана лежала серая полоса, на
     главном — от пяти шторок сразу. */
  const P = await page(390, 844);
  for (const g of ['index'].concat(GAMES)){
    await P.goto(BASE + g + '.html');
    await wait(500);
    const peek = await P.evaluate(() => {
      const out = [];
      document.querySelectorAll('body *').forEach((e) => {
        const s = getComputedStyle(e);
        if (s.display === 'none' || s.visibility === 'hidden' || s.boxShadow === 'none') return;
        /* тень вверх: отрицательный сдвиг по вертикали и размытие */
        const m = /(-\d+)px (\d+)px/.exec(s.boxShadow.replace(/rgba?\([^)]*\)/g, '').replace(/0px (-?\d+)px (\d+)px/, '$1px $2px'));
        const r = e.getBoundingClientRect();
        if (r.top < innerHeight - 1 || !m) return;
        const reach = -parseInt(m[1], 10) + parseInt(m[2], 10);
        if (r.top - reach < innerHeight) out.push((e.id || e.className) + ' ' + Math.round(r.top - innerHeight) + '/' + reach);
      });
      return out;
    });
    ok(g + ': тени спрятанных шторок за краем', peek.length === 0, peek);
  }
  await P.context().close();
}

rep.head('«Уменьшить движение»: точки ожидания не мерцают');
{
  const P = await page(390, 844, { reducedMotion: 'reduce' });
  for (const g of ['dvoeplay', 'matreshka', 'dots-boxes', 'zahlopni-yaschik']){
    await P.goto(BASE + g + '.html');
    await wait(250);
    const seen = await P.evaluate(async () => {
      const s = document.createElement('span');
      s.className = 'dots'; s.innerHTML = '<i></i><i></i><i></i>';
      document.body.appendChild(s);
      await new Promise((r) => setTimeout(r, 400));
      const i = s.querySelector('i'), out = [];
      for (let k = 0; k < 10; k++){ await new Promise((r) => requestAnimationFrame(r)); out.push(getComputedStyle(i).opacity); }
      return [...new Set(out)];
    });
    ok(g + ': прозрачность точек не скачет', seen.length === 1, seen);
  }
  await P.context().close();
}

await browser.close();
process.exit(rep.done('Раскладка'));
