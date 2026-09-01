-- =====================================================================
-- Панель продавца WB — схема Supabase
-- Выполните этот файл целиком в Supabase → SQL Editor → New query → Run
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. МАГАЗИНЫ
-- Один пользователь может владеть несколькими магазинами.
-- slug — человекочитаемый идентификатор для публичной ссылки
-- (например, https://ваш-сайт.netlify.app/s/green-flow)
-- ---------------------------------------------------------------------
create table if not exists shops (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  slug          text not null unique,
  share_enabled boolean not null default true,
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
  ads_spend       numeric not null default 0,   -- Расход на рекламу (вводится вручную)
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

-- =====================================================================
-- ROW LEVEL SECURITY
-- Владелец магазина видит и редактирует свои данные.
-- Любой человек по ссылке вида /s/<slug> видит данные ТОЛЬКО на чтение,
-- и только если у магазина share_enabled = true.
-- =====================================================================

alter table shops           enable row level security;
alter table monthly_reports enable row level security;
alter table sku_sales       enable row level security;
alter table sku_costs       enable row level security;

-- ---- shops ----
create policy "owner full access to own shops"
  on shops for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "anyone can read shared shops"
  on shops for select
  using (share_enabled = true);

-- ---- monthly_reports ----
create policy "owner full access to own monthly_reports"
  on monthly_reports for all
  using (exists (select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()));

create policy "anyone can read monthly_reports of shared shops"
  on monthly_reports for select
  using (exists (select 1 from shops s where s.id = shop_id and s.share_enabled = true));

-- ---- sku_sales ----
create policy "owner full access to own sku_sales"
  on sku_sales for all
  using (exists (select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()));

create policy "anyone can read sku_sales of shared shops"
  on sku_sales for select
  using (exists (select 1 from shops s where s.id = shop_id and s.share_enabled = true));

-- ---- sku_costs ----
create policy "owner full access to own sku_costs"
  on sku_costs for all
  using (exists (select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()));

create policy "anyone can read sku_costs of shared shops"
  on sku_costs for select
  using (exists (select 1 from shops s where s.id = shop_id and s.share_enabled = true));

-- =====================================================================
-- Готово. После выполнения этого файла:
--  1. Supabase → Authentication → Providers → включите Email (Magic Link).
--  2. Supabase → Authentication → URL Configuration → добавьте адрес
--     вашего Netlify-сайта в Site URL и Redirect URLs.
--  3. Supabase → Project settings → API → скопируйте Project URL и anon key
--     в assets/config.js фронтенда.
-- =====================================================================
