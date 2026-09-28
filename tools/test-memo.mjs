/* Сетевая партия в «Мемо-дуэль». Здесь два новых испытания:
   колода должна совпасть у обоих (раздаётся от общего зерна),
   и нашедший пару ходит снова. */
import { BASE, wait, reporter, launch, tab, lobby, until } from './netkit.mjs';

const URL = BASE + 'memo-duel.html';
const rep = reporter();
const ok = rep.ok;

const look = (page) => page.evaluate(() => ({
  screen: document.getElementById('app').classList.contains('playing') ? 'игра' : 'меню',
  net: document.body.classList.contains('playing-net'),
  nameA: document.getElementById('nameA').textContent.trim(),
  nameB: document.getElementById('nameB').textContent.trim(),
  a: document.getElementById('numA').textContent,
  b: document.getElementById('numB').textContent,
  hint: document.getElementById('hint').textContent.trim(),
  up: document.querySelectorAll('#board .cell.up').length,
  won: document.querySelectorAll('#board .cell.won').length,
  cards: document.querySelectorAll('#board .cell').length,
  sheet: document.getElementById('sheet').classList.contains('on'),
  sheetTitle: document.getElementById('sheetTitle').textContent,
  forfeit: document.getElementById('forfeit').classList.contains('on'),
  again: document.getElementById('again').textContent,
  againOff: document.getElementById('again').disabled
}));

/* колода глазами страницы — по значку на лицевой стороне каждой карточки */
const deckOf = (page) => page.evaluate(() =>
  [].slice.call(document.querySelectorAll('#board .cell .face.a svg')).map(s => s.innerHTML).join('|'));

/* открыть карточку по номеру */
const tapCard = (page, i) => page.evaluate(n => {
  const c = document.querySelectorAll('#board .cell .card')[n];
  if (!c) return false;
  c.click();
  return true;
}, i);

/* найти пару: два номера с одинаковым значком среди ещё не забранных */
const findPair = (page) => page.evaluate(() => {
  const cells = [].slice.call(document.querySelectorAll('#board .cell'));
  const seen = {};
  for (let i = 0; i < cells.length; i++){
    if (cells[i].classList.contains('won')) continue;
    const k = cells[i].querySelector('.face.a svg').innerHTML;
    if (seen[k] !== undefined) return [seen[k], i];
    seen[k] = i;
  }
  return null;
});
/* две заведомо разные карточки */
const findMiss = (page) => page.evaluate(() => {
  const cells = [].slice.call(document.querySelectorAll('#board .cell'));
  const free = [];
  for (let i = 0; i < cells.length; i++) if (!cells[i].classList.contains('won')) free.push(i);
  for (let x = 0; x < free.length; x++)
    for (let y = x + 1; y < free.length; y++){
      const a = cells[free[x]].querySelector('.face.a svg').innerHTML;
      const b = cells[free[y]].querySelector('.face.a svg').innerHTML;
      if (a !== b) return [free[x], free[y]];
    }
  return null;
});

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

rep.head('колода');
const dA = await deckOf(A), dB = await deckOf(B);
ok('карточек двадцать', (await look(A)).cards === 20, (await look(A)).cards);
ok('колода совпала у обоих', dA === dB && dA.length > 0);
ok('колода не по порядку', dA !== [...new Set(dA.split('|'))].sort().join('|'));

const a0 = await look(A), b0 = await look(B);
ok('у первого «Вы» слева', a0.nameA === 'Вы' && a0.nameB === 'Соперник', [a0.nameA, a0.nameB]);
ok('у второго «Вы» справа', b0.nameA === 'Соперник' && b0.nameB === 'Вы', [b0.nameA, b0.nameB]);
ok('первый ходит', /Ваш/.test(a0.hint), a0.hint);
ok('второй ждёт', /Соперник/.test(b0.hint), b0.hint);

rep.head('блокировка');
await tapCard(B, 0);
await wait(900);
ok('чужая карточка не переворачивается', (await look(B)).up === 0);

rep.head('пара — ход остаётся');
let pair = await findPair(A);
ok('пара на поле нашлась', !!pair, pair);
await tapCard(A, pair[0]);
ok('первая карточка видна сопернику', await until(B, look, s => s.up === 1, 8000));
await tapCard(A, pair[1]);
ok('обе забраны у первого', await until(A, look, s => s.won === 2, 8000));
ok('обе забраны у второго', await until(B, look, s => s.won === 2, 8000));
const a1 = await look(A), b1 = await look(B);
ok('счёт сошёлся', a1.a === b1.a && a1.b === b1.b, [a1.a, a1.b, b1.a, b1.b]);
ok('очко у первого', a1.a === '1', a1.a);
ok('ход остался у первого', /Ваш|Ходите снова/.test(a1.hint), a1.hint);
ok('второй всё ещё ждёт', !/Ваш ход/.test(b1.hint), b1.hint);

rep.head('промах — ход уходит');
const miss = await findMiss(A);
ok('разные карточки нашлись', !!miss, miss);
await tapCard(A, miss[0]);
await wait(500);
await tapCard(A, miss[1]);
ok('ход перешёл ко второму', await until(B, look, s => /Ваш/.test(s.hint), 10000), (await look(B)).hint);
ok('первый теперь ждёт', await until(A, look, s => !/Ваш/.test(s.hint), 6000), (await look(A)).hint);
ok('карточки закрылись у обоих', (await look(A)).up === 0 && (await look(B)).up === 0);

rep.head('второй забирает пару');
pair = await findPair(B);
await tapCard(B, pair[0]);
await wait(600);
await tapCard(B, pair[1]);
ok('у второго стало очко', await until(B, look, s => s.b === '1', 9000), (await look(B)).b);
ok('и первый это видит', await until(A, look, s => s.b === '1', 9000), (await look(A)).b);
const a2 = await look(A), b2 = await look(B);
ok('забрано по четыре карточки', a2.won === 4 && b2.won === 4, [a2.won, b2.won]);

rep.head('обрыв связи');
await B.locator('#toMenuTop').click();
ok('первого предупредили', await until(A, lobby.warned, w => w.shown && /вышел/.test(w.text), 12000));

await browser.close();
process.exit(rep.done('Мемо-дуэль'));
