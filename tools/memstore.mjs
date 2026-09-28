/* Хранилище комнат в памяти — для локального сервера и тестов.
   Повторяет поведение Netlify Blobs в том, что важно логике комнат:
   чтение отдаёт etag, запись проходит только если с тех пор ничего не
   менялось. Задержку можно включить (lag) — тогда тест воспроизводит
   настоящую гонку двух игроков, которой в мгновенной памяти не бывает. */

export function memStore(opt){
  const lag = (opt && opt.lag) | 0;
  const mem = new Map();
  let n = 0;
  const wait = () => lag ? new Promise(r => setTimeout(r, lag)) : null;

  return {
    async read(k){
      await wait();
      const r = mem.get(k);
      return r ? { value: JSON.parse(r.json), etag: r.etag } : null;
    },
    async write(k, v, etag){
      await wait();
      const cur = mem.get(k);
      if (etag === null && cur) return false;            /* просили «только если нет» */
      if (etag && (!cur || cur.etag !== etag)) return false;
      mem.set(k, { json: JSON.stringify(v), etag: 'v' + (++n) });
      return true;
    },
    async del(k){
      await wait();
      mem.delete(k);
    },
    /* для тестов: заглянуть внутрь, ничего не меняя */
    peek(k){
      const r = mem.get(k);
      return r ? JSON.parse(r.json) : null;
    },
    size(){ return mem.size; }
  };
}
