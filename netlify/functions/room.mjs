/* Единственная серверная функция приложения: комнаты для игры по сети.
   Адрес /api/<действие> ведёт сюда (см. netlify.toml).
   Хранилище — Netlify Blobs, отдельное хранилище «rooms». */

import { getStore } from '@netlify/blobs';
import { handle } from './lib/rooms.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

/* Blobs за тем же интерфейсом, что и локальное хранилище в тестах.
   Запись условная: etag, полученный при чтении, — пропуск на запись.
   Если комнату успели изменить, Blobs вернёт modified:false, и логика
   комнат перечитает её и повторит действие. Без этого ходы теряются. */
function blobStore(){
  const store = getStore({ name: 'rooms', consistency: 'strong' });
  return {
    async read(k){
      const r = await store.getWithMetadata(k, { type: 'json', consistency: 'strong' });
      if (!r || r.data == null) return null;
      return { value: r.data, etag: r.etag };
    },
    async write(k, v, etag){
      const how = etag === null ? { onlyIfNew: true }
                : etag ? { onlyIfMatch: etag }
                : {};
      let res;
      try {
        res = await store.setJSON(k, v, how);
      } catch (e){
        /* Условия записи не поддержаны хранилищем — пишем без них. Это хуже
           (возвращается старая беда с потерянными ходами), но игра работает,
           а не падает. Если это когда-нибудь случится, будет видно в логах. */
        console.warn('условная запись не прошла, пишем как есть:', e && e.message);
        res = await store.setJSON(k, v);
      }
      return !!(res && res.modified);
    },
    async del(k){ await store.delete(k); }
  };
}

export default async (request) => {
  const url = new URL(request.url);
  const action = url.pathname.split('/').filter(Boolean).pop();

  let data = {};
  if (request.method === 'POST'){
    try { data = await request.json(); } catch { data = {}; }
  } else {
    url.searchParams.forEach((v, k) => { data[k] = v; });
  }

  try {
    const res = await handle(blobStore(), action, data);
    return json(res.status, res.body);
  } catch (e){
    /* в логах функции на Netlify видно, что именно сломалось */
    console.error('[room] ' + action + ':', e && (e.stack || e.message || e));
    return json(500, { error: 'Сервер комнат недоступен' });
  }
};

export const config = { path: '/api/*' };
