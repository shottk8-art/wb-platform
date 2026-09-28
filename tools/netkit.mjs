/* Общая оснастка для сетевых тестов: два окна браузера, живой сервер.
   Пользуются ею тесты всех игр серии. */
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pw;

export const BASE = 'http://localhost:8787/';
export const wait = (ms) => new Promise(r => setTimeout(r, ms));

export function reporter(){
  const st = { failed: 0 };
  st.ok = (name, cond, extra) => {
    if (cond) console.log('  ok  ', name);
    else { st.failed++; console.log('  ПЛОХО', name, extra === undefined ? '' : JSON.stringify(extra)); }
    return !!cond;
  };
  st.head = (t) => console.log(t);
  st.done = (title) => {
    console.log(st.failed ? '\n' + title + ': ПРОВАЛЕНО ' + st.failed : '\n' + title + ': чисто');
    return st.failed;
  };
  return st;
}

export async function launch(){
  /* Два окна в одном браузере: невидимому Chromium придерживает таймеры, и
     игра там отстаёт. У живых игроков по телефону на каждого, так что это
     артефакт стенда — отключаем, иначе тесты врут. */
  return await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--disable-background-timer-throttling',
           '--disable-backgrounding-occluded-windows',
           '--disable-renderer-backgrounding']
  });
}

export async function tab(browser, rep, label){
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => {
    rep.failed++;
    console.log('  ОШИБКА В СТРАНИЦЕ ' + label + ':', e.message);
  });
  page.on('console', m => {
    if (m.text().indexOf('[net]') === 0) console.log('     ' + label + ' ' + m.text());
  });
  return page;
}

/* ---------- лобби: те же элементы во всех играх, они из net.js ---------- */
export const lobby = {
  async openFrom(page, rowSelector){
    await page.locator(rowSelector).click();
    await page.waitForSelector('.np-sheet', { state: 'attached' });
  },
  async create(page, prev){
    await page.locator('#npNew').click();
    await page.waitForFunction(old => {
      const t = document.getElementById('npCode').textContent;
      return /^\d{5}$/.test(t) && t !== old;
    }, prev || null, { timeout: 8000 });
    return (await page.locator('#npCode').textContent()).trim();
  },
  async join(page, code){
    if (!(await lobby.open(page))) throw new Error('лобби не открыто — сначала lobby.openFrom');
    await page.locator('#npHas').click();
    await page.locator('#npInput').fill(code);       /* fill шлёт input — вход по пятой цифре */
  },
  msg(page){ return page.locator('#npMsg').textContent(); },
  warned(page){
    return page.evaluate(() => {
      const w = document.querySelector('.np-warn');
      return w ? { shown: w.classList.contains('np-show'), text: w.textContent } : null;
    });
  },
  open(page){ return page.evaluate(() => document.body.classList.contains('np-open')); }
};

/* ждём, пока функция от состояния страницы станет истинной */
export async function until(page, look, fn, ms = 9000){
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms){
    last = await look(page);
    if (fn(last)) return true;
    await wait(150);
  }
  console.log('     … так и не дождались, последнее состояние:', JSON.stringify(last));
  return false;
}

/* клик по центру элемента с долей смещения (для полей-сеток) */
export async function tapAt(page, selector, fx, fy){
  const b = await page.locator(selector).boundingBox();
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy);
  await page.mouse.down();
  await page.mouse.up();
}
