/* Сетевая партия в «5 букв». Здесь по сети идёт строка, а не число,
   и загаданное слово должно совпасть у обоих. */
import { BASE, wait, reporter, launch, tab, lobby, until } from './netkit.mjs';

const URL = BASE + '5-bukv.html';
const rep = reporter();
const ok = rep.ok;

const look = (page) => page.evaluate(() => ({
  screen: document.getElementById('app').classList.contains('playing') ? 'игра' : 'меню',
  net: document.body.classList.contains('playing-net'),
  duo: document.getElementById('game').classList.contains('duo'),
  hint: document.getElementById('hint').textContent.trim(),
  n1: document.getElementById('name1').textContent,
  n2: document.getElementById('name2').textContent,
  s1: document.getElementById('score1').textContent,
  s2: document.getElementById('score2').textContent,
  rows: document.querySelectorAll('.wrow').length,
  done: document.querySelectorAll('.wrow').length
        ? [].slice.call(document.querySelectorAll('.wrow'))
            .filter(r => r.querySelector('.tile.correct,.tile.present,.tile.absent')).length : 0,
  sheet: document.getElementById('sheet').classList.contains('on'),
  sheetTitle: document.getElementById('sheetTitle').textContent,
  sheetSub: document.getElementById('sheetSub').textContent,
  forfeit: document.getElementById('forfeit').classList.contains('on'),
  again: document.getElementById('again').textContent,
  againOff: document.getElementById('again').disabled
}));

/* загаданное слово — видно только изнутри страницы, для проверки совпадения */
const secretOf = (page) => page.evaluate(() => {
  /* слово лежит в замыкании; достаём через подсказку в шторке после игры,
     а пока сверяем косвенно — по ответу на одну и ту же попытку */
  return null;
});

/* набрать слово и отправить */
async function guess(page, word){
  for (const ch of word) await page.evaluate(c => document.dispatchEvent(new KeyboardEvent('keydown', { key: c })), ch);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
}
/* раскраска строки — по ней сверяем, что слово у обоих одно и то же */
const colorsOf = (page, row) => page.evaluate(r => {
  const rows = document.querySelectorAll('.wrow');
  if (!rows[r]) return null;
  return [].slice.call(rows[r].querySelectorAll('.tile'))
           .map(t => t.classList.contains('correct') ? 'c' : t.classList.contains('present') ? 'p'
                   : t.classList.contains('absent') ? 'a' : '.').join('');
}, row);
const lettersOf = (page, row) => page.evaluate(r => {
  const rows = document.querySelectorAll('.wrow');
  if (!rows[r]) return null;
  return [].slice.call(rows[r].querySelectorAll('.tile')).map(t => t.textContent).join('');
}, row);

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

const a0 = await look(A), b0 = await look(B);
ok('поле в режиме «вдвоём»', a0.duo && b0.duo, [a0.duo, b0.duo]);
ok('шесть попыток', a0.rows === 6, a0.rows);
ok('подписи сторон личные у первого', a0.n1 === 'Вы' && a0.n2 === 'Соперник', [a0.n1, a0.n2]);
ok('подписи сторон личные у второго', b0.n1 === 'Соперник' && b0.n2 === 'Вы', [b0.n1, b0.n2]);
ok('первый ходит', /Ваш ход/.test(a0.hint), a0.hint);
ok('второй ждёт', /Ход соперника/.test(b0.hint), b0.hint);

rep.head('блокировка');
await guess(B, 'народ');
await wait(900);
ok('чужая попытка не проходит', (await lettersOf(B, 0)) === '');

rep.head('попытка летит как слово');
await guess(A, 'народ');
ok('буквы появились у первого', await until(A, () => lettersOf(A, 0), t => t === 'народ', 8000), await lettersOf(A, 0));
ok('буквы долетели до второго', await until(B, () => lettersOf(B, 0), t => t === 'народ', 9000), await lettersOf(B, 0));
await wait(2200);
const ca = await colorsOf(A, 0), cb = await colorsOf(B, 0);
ok('раскраска совпала — слово у обоих одно', ca === cb && /^[cpa]{5}$/.test(ca), [ca, cb]);
ok('ход перешёл ко второму', await until(B, look, s => /Ваш ход/.test(s.hint), 9000), (await look(B)).hint);
ok('первый теперь ждёт', /Ход соперника/.test((await look(A)).hint), (await look(A)).hint);

rep.head('ответная попытка');
await guess(B, 'слово');
ok('буквы долетели до первого', await until(A, () => lettersOf(A, 1), t => t === 'слово', 9000), await lettersOf(A, 1));
await wait(2200);
const ca2 = await colorsOf(A, 1), cb2 = await colorsOf(B, 1);
ok('и вторая строка совпала', ca2 === cb2 && /^[cpa]{5}$/.test(ca2), [ca2, cb2]);
const a1 = await look(A), b1 = await look(B);
ok('счёт попыток сошёлся', a1.s1 === b1.s1 && a1.s2 === b1.s2, [a1.s1, a1.s2, b1.s1, b1.s2]);
ok('по одной попытке у каждого', a1.s1 === '1' && a1.s2 === '1', [a1.s1, a1.s2]);
ok('ход вернулся к первому', await until(A, look, s => /Ваш ход/.test(s.hint), 9000), (await look(A)).hint);

rep.head('обрыв связи');
await B.locator('#toMenu').click();
ok('первого предупредили', await until(A, lobby.warned, w => w.shown && /вышел/.test(w.text), 12000));

await browser.close();
process.exit(rep.done('5 букв'));
