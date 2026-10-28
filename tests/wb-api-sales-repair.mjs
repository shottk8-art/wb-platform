import assert from 'node:assert/strict';
import {aggregateFinanceRows} from '../supabase/functions/wb-api/cabinet.ts';
import {enrichSalesModel,withoutSalesFields} from '../supabase/functions/wb-api/sales-repair.ts';
import {economy} from '../supabase/functions/wb-api/economy.ts';

const recovered = aggregateFinanceRows([{vendorCode:'Sku',title:'New name',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:2,
  retailPriceWithDisc:'250.00',retailAmount:'320.00',forPay:'300.00',deliveryService:'10.00'}],'123');
const old = structuredClone(recovered);
delete old.sales_covered_rows; delete old.totals.salesAmount; delete old.products[0].sales_revenue;
old.products[0].name = 'Keep saved name'; old.metadata = {untouched:true};
const before = structuredClone(old), next = enrichSalesModel(old,recovered);
assert.deepEqual(old,before,'repair must not mutate the source');
assert.equal(next.totals.salesAmount,'500.00');
assert.equal(next.products[0].sales_revenue,'500.00');
assert.equal(next.products[0].name,'Keep saved name');
const strip = withoutSalesFields;
assert.deepEqual(strip(next),old,'only additive seller-price fields may change');
assert.deepEqual(enrichSalesModel(next,recovered),next,'repair is idempotent');
const settings={operational_expenses:0,external_promotion_expenses:0},ads={paid:'0.00',bonus:'0.00',unknown:[]};
assert.equal(economy(old.totals,'20',settings,'0',ads,0,0,true).payout,economy(next.totals,'20',settings,'0',ads,0,0,true).payout);
for(const change of [
  m=>m.cursor_id='124', m=>m.row_count++, m=>m.sales_covered_rows--,
  m=>m.totals.salesAmount=null,m=>m.totals.forPay='301.00',
  m=>m.totals.deliveryService='11.00',m=>m.bought_qty++,
  m=>m.products[0].for_pay='301.00',m=>m.products[0].revenue='319.00',
  m=>m.products[0].bought_qty++,m=>m.products[0].article='sku',
  m=>m.products[0].sales_revenue=null,m=>m.products.push({...m.products[0]}),
]) {
  const changed=structuredClone(recovered);change(changed);
  assert.throws(()=>enrichSalesModel(old,changed),/refused/,'changed or incomplete financial data must not overwrite a saved month');
}
const changed=structuredClone(recovered);changed.totals.salesAmount='501.00';
assert.throws(()=>enrichSalesModel(next,changed),/refused/,'known sales cannot silently change');
const empty=aggregateFinanceRows([]);
assert.deepEqual(enrichSalesModel(strip(empty),empty),empty,'complete empty months recover without a WB request');
console.log('WB sales repair: additive-only, original payout and metadata preserved, idempotent, stale/incomplete/mismatched data rejected PASS.');
