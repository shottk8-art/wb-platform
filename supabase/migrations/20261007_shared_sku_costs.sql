begin;

-- Себестоимость относится к товару магазина, а не к маркетплейсу.
-- Перед удалением marketplace оставляем одну запись на артикул:
-- сначала ненулевую цену, затем наиболее свежую запись.
create temporary table sku_costs_merged on commit drop as
select distinct on (shop_id, article)
  id, shop_id, article, name, cost_price, updated_at
from sku_costs
order by shop_id, article, (cost_price > 0) desc, updated_at desc, id;

truncate table sku_costs;

alter table sku_costs drop constraint if exists sku_costs_shop_id_marketplace_article_key;
alter table sku_costs drop constraint if exists sku_costs_marketplace_check;
alter table sku_costs drop column if exists marketplace;
alter table sku_costs add constraint sku_costs_shop_id_article_key unique (shop_id, article);

insert into sku_costs (id, shop_id, article, name, cost_price, updated_at)
select id, shop_id, article, name, cost_price, updated_at
from sku_costs_merged;

commit;
