-- Один магазин может содержать данные нескольких маркетплейсов.
-- Площадка относится к финансовой записи, а не к магазину целиком.

alter table monthly_reports add column if not exists marketplace text;
alter table sku_sales add column if not exists marketplace text;
alter table sku_costs add column if not exists marketplace text;
alter table uploads add column if not exists marketplace text;

update monthly_reports r set marketplace = coalesce(s.marketplace, 'wildberries')
from shops s where s.id = r.shop_id and r.marketplace is null;
update sku_sales r set marketplace = coalesce(s.marketplace, 'wildberries')
from shops s where s.id = r.shop_id and r.marketplace is null;
update sku_costs r set marketplace = coalesce(s.marketplace, 'wildberries')
from shops s where s.id = r.shop_id and r.marketplace is null;
update uploads r set marketplace = coalesce(s.marketplace, 'wildberries')
from shops s where s.id = r.shop_id and r.marketplace is null;

alter table monthly_reports alter column marketplace set default 'wildberries';
alter table monthly_reports alter column marketplace set not null;
alter table sku_sales alter column marketplace set default 'wildberries';
alter table sku_sales alter column marketplace set not null;
alter table sku_costs alter column marketplace set default 'wildberries';
alter table sku_costs alter column marketplace set not null;
alter table uploads alter column marketplace set default 'wildberries';
alter table uploads alter column marketplace set not null;

alter table monthly_reports drop constraint if exists monthly_reports_marketplace_check;
alter table monthly_reports add constraint monthly_reports_marketplace_check check (marketplace in ('wildberries','ozon'));
alter table sku_sales drop constraint if exists sku_sales_marketplace_check;
alter table sku_sales add constraint sku_sales_marketplace_check check (marketplace in ('wildberries','ozon'));
alter table sku_costs drop constraint if exists sku_costs_marketplace_check;
alter table sku_costs add constraint sku_costs_marketplace_check check (marketplace in ('wildberries','ozon'));
alter table uploads drop constraint if exists uploads_marketplace_check;
alter table uploads add constraint uploads_marketplace_check check (marketplace in ('wildberries','ozon'));

alter table monthly_reports drop constraint if exists monthly_reports_shop_id_year_month_key;
alter table monthly_reports drop constraint if exists monthly_reports_shop_market_period_key;
alter table monthly_reports add constraint monthly_reports_shop_market_period_key unique (shop_id, marketplace, year, month);
alter table sku_sales drop constraint if exists sku_sales_shop_id_year_month_article_key;
alter table sku_sales drop constraint if exists sku_sales_shop_market_period_article_key;
alter table sku_sales add constraint sku_sales_shop_market_period_article_key unique (shop_id, marketplace, year, month, article);
alter table sku_costs drop constraint if exists sku_costs_shop_id_article_key;
alter table sku_costs drop constraint if exists sku_costs_shop_market_article_key;
alter table sku_costs add constraint sku_costs_shop_market_article_key unique (shop_id, marketplace, article);

create index if not exists monthly_reports_shop_market_idx on monthly_reports(shop_id, marketplace, year, month);
create index if not exists sku_sales_shop_market_idx on sku_sales(shop_id, marketplace, year, month);
create index if not exists sku_costs_shop_market_idx on sku_costs(shop_id, marketplace);
create index if not exists uploads_shop_market_idx on uploads(shop_id, marketplace, created_at desc);

alter table uploads drop constraint if exists uploads_kind_check;
alter table uploads add constraint uploads_kind_check check (kind in ('summary','sales','costs','ads','ozon_accruals'));
