/* Гонка двух игроков за одну комнату — то, из-за чего партии разъезжались.
   Комната лежит в хранилище одним объектом, и оба телефона пишут в неё
   одновременно: один ходит, второй в этот же миг опрашивает сервер.
   Пока запись была безусловной, опрос успевал затереть чужой ход.
   Здесь хранилище с задержкой — без неё гонки в памяти просто не бывает. */
import { handle } from '../netlify/functions/lib/rooms.mjs';
import { memStore } from './memstore.mjs';

let failed = 0;
function ok(name, cond, extra){
  if (cond) console.log('  ok  ', name);
  else { failed++; console.log('  ПЛОХО', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const store = memStore({ lag: 10 });
let writes = 0;
const counted = {
  read: (k) => store.read(k),
  write: (k, v, e) => { writes++; return store.write(k, v, e); },
  del: (k) => store.del(k)
};
const call = (a, d) => handle(counted, a, d);

console.log('комната');
const made = await call('create', { game: 'dvoeplay', name: 'Карл' });
const code = made.body.code, t1 = made.body.token;
const joined = await call('join', { code, game: 'dvoeplay', name: 'Аня' });
const t2 = joined.body.token;
ok('оба на местах', made.status === 200 && joined.status === 200);

console.log('ход и опрос одновременно');
/* Ходим сорок раз подряд, и каждый ход отправляется ВМЕСТЕ с опросом
   соперника — то есть ровно в тот момент, когда его запись может нас
   затереть. Ни один ход не имеет права пропасть. */
let lostAt = 0;
for (let i = 1; i <= 40; i++){
  const mover = i % 2 === 1 ? 1 : 2;
  const token = mover === 1 ? t1 : t2;
  const other = mover === 1 ? t2 : t1;
  const [moved] = await Promise.all([
    /* since — сколько ходов раунда знает клиент вместе со своим новым:
       сервер не принимает ход от того, кто ещё не видел чужой */
    call('move', { code, token, move: i, round: 0, next: 3 - mover, mid: 'm' + i, since: i }),
    call('state', { code, token: other, since: 0 }),
    call('state', { code, token: other, since: 0 })
  ]);
  if (moved.status !== 200){ lostAt = i; break; }
  const seen = await call('state', { code, token: other, since: 0 });
  if (seen.body.total !== i){ lostAt = i; break; }
}
ok('сорок ходов под перекрёстным опросом — ни один не пропал', lostAt === 0,
   lostAt ? 'потерялся ход ' + lostAt : '');

const after = await call('state', { code, token: t1, since: 0 });
ok('список ходов ровно тот, что посылали',
   after.body.moves.length === 40 && after.body.moves[0] === 1 && after.body.moves[39] === 40,
   after.body.moves.length);

console.log('опрос не переписывает комнату');
const before = writes;
for (let i = 0; i < 12; i++) await call('state', { code, token: t1, since: 0 });
ok('двенадцать опросов подряд почти не пишут в хранилище', writes - before <= 2, writes - before);

console.log('повтор хода');
/* связь оборвалась, ответ не дошёл, клиент шлёт тот же ход снова */
const at = (await call('state', { code, token: t1, since: 0 })).body.total + 1;
const again1 = await call('move', { code, token: t1, move: 41, round: 0, next: 2, mid: 'x-1', since: at });
const again2 = await call('move', { code, token: t1, move: 41, round: 0, next: 2, mid: 'x-1', since: at });
ok('первый раз принят', again1.status === 200 && again1.body.total === 41, again1.body.total);
ok('повтор с той же меткой не удвоил ход', again2.status === 200 && again2.body.total === 41,
   [again2.status, again2.body.total]);

console.log('двое ходят разом');
/* очередь у второго; первый пытается влезть ровно в тот же миг */
const both = (await call('state', { code, token: t1, since: 0 })).body.total + 1;
const [mine, theirs] = await Promise.all([
  call('move', { code, token: t1, move: 98, round: 0, next: 1, mid: 'a-1', since: both }),
  call('move', { code, token: t2, move: 99, round: 0, next: 1, mid: 'b-1', since: both })
]);
ok('прошёл ровно один ход', (mine.status === 200) !== (theirs.status === 200),
   [mine.status, theirs.status]);
const end = await call('state', { code, token: t1, since: 0 });
ok('в комнате он один и есть', end.body.total === 42, end.body.total);

console.log(failed ? '\nГонка: ПРОВАЛЕНО ' + failed : '\nГонка: чисто');
process.exit(failed ? 1 : 0);
