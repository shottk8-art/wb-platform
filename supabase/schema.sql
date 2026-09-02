-- =====================================================================
-- Панель продавца WB — схема Supabase
-- Выполните этот файл целиком в Supabase → SQL Editor → New query → Run
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. МАГАЗИНЫ
-- Один пользователь может владеть несколькими магазинами.
-- slug — человекочитаемый идентификатор для публичной ссылки
-- (например, https://ваш-сайт.netlify.app/s/green-flow).
-- share_enabled по умолчанию false — магазин приватный, пока владелец
-- сам не включит витрину переключателем в кабинете.
-- ---------------------------------------------------------------------
create table if not exists shops (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  slug          text not null unique,
  share_enabled boolean not null default false,
  tax_rate      numeric not null default 0, -- % от суммы продаж, не привязан к месяцу
  created_at    timestamptz not null default now()
);

create index if not exists shops_owner_idx on shops(owner_id);

-- ---------------------------------------------------------------------
-- 2. СВОДНЫЙ ОТЧЁТ ПО МЕСЯЦАМ (из «Сводного отчёта по продавцу» WB)
-- Одна строка = один месяц одного магазина. Повторная загрузка того же
-- месяца перезаписывает строку (upsert по shop_id+year+month).
-- ---------------------------------------------------------------------
create table if not exists monthly_reports (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references shops(id) on delete cascade,
  year            int not null,
  month           int not null check (month between 1 and 12),
  sales_amount    numeric not null default 0,   -- Сумма продаж по розничным ценам
  orders_amount   numeric not null default 0,   -- Сумма заказов по розничным ценам (для ДРР(з))
  bought_qty      int     not null default 0,   -- Выкупили, шт.
  transfer_total  numeric not null default 0,   -- Итого к перечислению
  transfer_goods  numeric not null default 0,   -- К перечислению за товар (нужно для расчёта комиссии)
  delivery_cost   numeric not null default 0,   -- Стоимость доставки
  storage_cost    numeric not null default 0,   -- Стоимость хранения
  fines           numeric not null default 0,   -- Штрафы
  acceptance_ops  numeric not null default 0,   -- Операции при приёмке
  damage_comp     numeric not null default 0,   -- Компенсация ущерба
  return_comp     numeric not null default 0,   -- Добровольная компенсация при возврате
  other_fees      numeric not null default 0,   -- Доплаты (прочее)
  ads_spend       numeric not null default 0,   -- Расход на рекламу с баланса — уменьшает прибыль
  ads_promo_spend numeric not null default 0,   -- Расход промобонусами — справочно, прибыль не уменьшает
  updated_at      timestamptz not null default now(),
  unique (shop_id, year, month)
);

create index if not exists monthly_reports_shop_idx on monthly_reports(shop_id, year, month);

-- ---------------------------------------------------------------------
-- 3. ПРОДАЖИ ПО АРТИКУЛАМ (из отчёта «Продажи» WB, за конкретный месяц)
-- ---------------------------------------------------------------------
create table if not exists sku_sales (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references shops(id) on delete cascade,
  year        int not null,
  month       int not null check (month between 1 and 12),
  article     text not null,   -- Артикул продавца
  name        text not null default '',
  bought_qty  int  not null default 0,
  revenue     numeric not null default 0,  -- К перечислению за товар (по артикулу)
  updated_at  timestamptz not null default now(),
  unique (shop_id, year, month, article)
);

create index if not exists sku_sales_shop_idx on sku_sales(shop_id, year, month);

-- ---------------------------------------------------------------------
-- 4. СЕБЕСТОИМОСТЬ ПО АРТИКУЛАМ (вводится вручную, действует до изменения)
-- ---------------------------------------------------------------------
create table if not exists sku_costs (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references shops(id) on delete cascade,
  article     text not null,
  name        text not null default '',
  cost_price  numeric not null default 0,
  updated_at  timestamptz not null default now(),
  unique (shop_id, article)
);

create index if not exists sku_costs_shop_idx on sku_costs(shop_id);

-- ---------------------------------------------------------------------
-- 5. ЖУРНАЛ ЗАГРУЗОК (для отмены случайно загруженного файла)
-- periods  — для kind='summary': [{"year":2026,"month":9}, ...] все месяцы из файла
-- year/month — для kind='sales': единственный период отчёта
-- articles — для kind='costs': список артикулов, себестоимость которых поменял файл
-- ---------------------------------------------------------------------
create table if not exists uploads (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references shops(id) on delete cascade,
  kind       text not null check (kind in ('summary','sales','costs','ads')),
  filename   text not null,
  periods    jsonb,
  year       int,
  month      int,
  articles   jsonb,
  row_count  int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists uploads_shop_idx on uploads(shop_id, created_at desc);

-- ---------------------------------------------------------------------
-- 6. УЧАСТНИКИ МАГАЗИНА (доступ по нику в Telegram)
-- Владелец добавляет ник (без @, в нижнем регистре) — user_id остаётся
-- пустым, пока этот человек не войдёт в приложение хотя бы раз: тогда
-- Edge Function telegram-auth сама проставит user_id по совпадению ника.
-- ---------------------------------------------------------------------
create table if not exists shop_members (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references shops(id) on delete cascade,
  telegram_username text not null,
  user_id           uuid references auth.users(id) on delete cascade,
  invited_at        timestamptz not null default now(),
  unique (shop_id, telegram_username)
);

create index if not exists shop_members_shop_idx on shop_members(shop_id);
create index if not exists shop_members_username_idx on shop_members(telegram_username);
create index if not exists shop_members_user_idx on shop_members(user_id);

-- =====================================================================
-- ROW LEVEL SECURITY
-- Владелец магазина видит и редактирует свои данные; участники (по
-- приглашению в shop_members) получают такой же полный доступ к данным
-- магазина, но не к самому магазину (переименование/удаление/шаринг/
-- налог/список участников — только владелец).
-- Любой человек по ссылке вида /s/<slug> видит данные ТОЛЬКО на чтение,
-- и только если у магазина share_enabled = true.
-- =====================================================================

alter table shops           enable row level security;
alter table monthly_reports enable row level security;
alter table sku_sales       enable row level security;
alter table sku_costs       enable row level security;
alter table uploads         enable row level security;
alter table shop_members    enable row level security;

-- shops-политика читает shop_members, а shop_members-политика читает
-- shops — прямая взаимная ссылка. Postgres обходит RLS-политику каждый раз,
-- когда подзапрос обращается к защищённой таблице, поэтому такая пара
-- зацикливается (infinite recursion detected in policy for relation
-- "shops") при первом же обращении. Разрываем цикл через security definer
-- функции: они выполняются от имени владельца таблиц (роль, создавшая
-- таблицы) и поэтому НЕ проходят через RLS повторно внутри себя.
create or replace function public.user_is_shop_owner(p_shop_id uuid, p_user_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from shops s where s.id = p_shop_id and s.owner_id = p_user_id);
$$;

create or replace function public.user_is_shop_member(p_shop_id uuid, p_user_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from shop_members m where m.shop_id = p_shop_id and m.user_id = p_user_id);
$$;

grant execute on function public.user_is_shop_owner(uuid, uuid) to authenticated;
grant execute on function public.user_is_shop_member(uuid, uuid) to authenticated;

-- ---- shops ----
create policy "owner full access to own shops"
  on shops for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "members can read shops they belong to"
  on shops for select
  using (public.user_is_shop_member(id, auth.uid()));

create policy "anyone can read shared shops"
  on shops for select
  using (share_enabled = true);

-- ---- monthly_reports ----
create policy "owner or member full access to monthly_reports"
  on monthly_reports for all
  using (public.user_is_shop_owner(shop_id, auth.uid()) or public.user_is_shop_member(shop_id, auth.uid()))
  with check (public.user_is_shop_owner(shop_id, auth.uid()) or public.user_is_shop_member(shop_id, auth.uid()));

create policy "anyone can read monthly_reports of shared shops"
  on monthly_reports for select
  using (exists (select 1 from shops s where s.id = shop_id and s.share_enabled = true));

-- ---- sku_sales ----
create policy "owner or member full access to sku_sales"
  on sku_sales for all
  using (public.user_is_shop_owner(shop_id, auth.uid()) or public.user_is_shop_member(shop_id, auth.uid()))
  with check (public.user_is_shop_owner(shop_id, auth.uid()) or public.user_is_shop_member(shop_id, auth.uid()));

create policy "anyone can read sku_sales of shared shops"
  on sku_sales for select
  using (exists (select 1 from shops s where s.id = shop_id and s.share_enabled = true));

-- ---- sku_costs ----
create policy "owner or member full access to sku_costs"
  on sku_costs for all
  using (public.user_is_shop_owner(shop_id, auth.uid()) or public.user_is_shop_member(shop_id, auth.uid()))
  with check (public.user_is_shop_owner(shop_id, auth.uid()) or public.user_is_shop_member(shop_id, auth.uid()));

create policy "anyone can read sku_costs of shared shops"
  on sku_costs for select
  using (exists (select 1 from shops s where s.id = shop_id and s.share_enabled = true));

-- ---- uploads (журнал приватный — на публичной витрине не нужен) ----
create policy "owner or member full access to uploads"
  on uploads for all
  using (public.user_is_shop_owner(shop_id, auth.uid()) or public.user_is_shop_member(shop_id, auth.uid()))
  with check (public.user_is_shop_owner(shop_id, auth.uid()) or public.user_is_shop_member(shop_id, auth.uid()));

-- ---- shop_members ----
-- Видит список: владелец магазина или любой уже привязанный участник
-- этого же магазина (чтобы видеть, кто ещё имеет доступ).
create policy "shop team can view members list"
  on shop_members for select
  using (public.user_is_shop_owner(shop_id, auth.uid()) or public.user_is_shop_member(shop_id, auth.uid()));

-- Добавлять/удалять участников может только владелец. user_id при
-- приглашении проставляет только Edge Function (service role, минуя RLS).
create policy "owner adds shop_members"
  on shop_members for insert
  with check (public.user_is_shop_owner(shop_id, auth.uid()));

create policy "owner removes shop_members"
  on shop_members for delete
  using (public.user_is_shop_owner(shop_id, auth.uid()));

-- =====================================================================
-- Готово. После выполнения этого файла:
--  1. Supabase → Authentication → Providers → включите Email (Magic Link).
--  2. Supabase → Authentication → URL Configuration → добавьте адрес
--     вашего Netlify-сайта в Site URL и Redirect URLs.
--  3. Supabase → Project settings → API → скопируйте Project URL и anon key
--     в assets/config.js фронтенда.
-- =====================================================================
