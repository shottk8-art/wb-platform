-- Восстанавливает названия товаров Ozon, потерянные старой версией XLSX-парсера.
with product_names(article, name) as (
  values
    ('top-102', 'Сыворотка для роста ресниц и бровей TOPLASH, укрепляющая, 6 мл'),
    ('top-101', 'Сыворотка для роста ресниц и бровей TOPLASH, укрепляющая, 3 мл'),
    ('tweezers', 'Пинцет для бровей профессиональный TOPLASH.'),
    ('top-112', 'Сыворотка для роста ресниц и бровей TOPLASH, укрепляющая, 2 мл'),
    ('Top-113', 'Керлер для ресниц TOPLASH.'),
    ('top-103', 'Тушь для ресниц TOPLASH 6 мл. С эффектом объема и удлинения, черная.'),
    ('Top-114', 'Сыворотка для роста ресниц и бровей TOPLASH, укрепляющая, 3+3 мл'),
    ('top-105', 'Подводка для глаз TOPLASH. Водостойкая, черная.'),
    ('top-106', 'Косметичка TOPLASH.'),
    ('top-104', 'Гель для бровей TOPLASH 6 мл. Прозрачный, фиксирующий.'),
    ('top-109', 'Сыворотка для роста ресниц, гель для бровей и косметичка TOPLASH.'),
    ('Top-111', 'Сыворотка для роста ресниц, гель для бровей и тушь для ресниц TOPLASH.'),
    ('top-108', 'Сыворотка для роста ресниц, тушь для ресниц и косметичка TOPLASH.'),
    ('top-116/черный', 'Toplash Подводка для глаз черная водостойкая, фломастер, 3 мл')
)
update public.sku_sales as sales
set name = product_names.name
from product_names
where sales.shop_id = '853b81a0-e0e2-4195-bc80-1cdc362af946'
  and sales.marketplace = 'ozon'
  and lower(sales.article) = lower(product_names.article)
  and (sales.name is null or btrim(sales.name) = '' or lower(btrim(sales.name)) = lower(sales.article));

with product_names(article, name) as (
  values
    ('top-102', 'Сыворотка для роста ресниц и бровей TOPLASH, укрепляющая, 6 мл'),
    ('top-101', 'Сыворотка для роста ресниц и бровей TOPLASH, укрепляющая, 3 мл'),
    ('tweezers', 'Пинцет для бровей профессиональный TOPLASH.'),
    ('top-112', 'Сыворотка для роста ресниц и бровей TOPLASH, укрепляющая, 2 мл'),
    ('Top-113', 'Керлер для ресниц TOPLASH.'),
    ('top-103', 'Тушь для ресниц TOPLASH 6 мл. С эффектом объема и удлинения, черная.'),
    ('Top-114', 'Сыворотка для роста ресниц и бровей TOPLASH, укрепляющая, 3+3 мл'),
    ('top-105', 'Подводка для глаз TOPLASH. Водостойкая, черная.'),
    ('top-106', 'Косметичка TOPLASH.'),
    ('top-104', 'Гель для бровей TOPLASH 6 мл. Прозрачный, фиксирующий.'),
    ('top-109', 'Сыворотка для роста ресниц, гель для бровей и косметичка TOPLASH.'),
    ('Top-111', 'Сыворотка для роста ресниц, гель для бровей и тушь для ресниц TOPLASH.'),
    ('top-108', 'Сыворотка для роста ресниц, тушь для ресниц и косметичка TOPLASH.'),
    ('top-116/черный', 'Toplash Подводка для глаз черная водостойкая, фломастер, 3 мл')
)
update public.sku_costs as costs
set name = product_names.name
from product_names
where costs.shop_id = '853b81a0-e0e2-4195-bc80-1cdc362af946'
  and lower(costs.article) = lower(product_names.article)
  and (costs.name is null or btrim(costs.name) = '' or lower(btrim(costs.name)) = lower(costs.article));
