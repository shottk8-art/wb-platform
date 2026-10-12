import {articleKey} from '../wb-api/articles.ts';
export const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const known = (value: unknown) => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;

// Reuse the cabinet's authoritative, kopeck-rounded economy. Never recalculate
// API profit from file reports or subtract financial advertising a second time.
export function apiMetrics(cabinet: any) {
  const f=cabinet.finance, e=cabinet.economy, s=cabinet.sources;
  const sales=known(f.retailAmount), profit=known(cabinet.net_profit);
  const ads=s.ads?.status==='downloaded' && s.media?.amount!=null ? num(e.internal_ads)+num(s.media.amount) : null;
  return {
    sales, orders:s.orders?.status==='downloaded' ? known(s.orders.amount) : null, bought_qty:known(f.bought_qty),
    transfer:known(e.payout), commission:sales==null ? null : sales-num(f.forPay),
    delivery:known(f.deliveryService),storage:known(f.paidStorage),fines:known(f.penalty),acceptance:known(f.paidAcceptance),
    other_fees:known(f.deduction),ads,internal_ads:s.ads?.status==='downloaded' ? known(e.internal_ads) : null,media_ads:known(s.media?.amount),
    promo_bonuses:s.ads?.status==='downloaded' ? known(e.promo) : null,
    operational_expenses:num(cabinet.settings.operational_expenses),external_promotion:num(cabinet.settings.external_promotion_expenses),
    cogs:known(cabinet.cogs),tax:known(e.tax),net_profit:profit,
    margin_percent:profit==null ? null : sales ? profit/sales*100 : 0,
    ad_share_of_sales:known(e.drr_sales),ad_share_of_orders:known(e.drr_orders),
    additional_payment:known(f.additionalPayment),loyalty_points:known(f.cashbackAmount),loyalty_commission:known(f.cashbackCommissionChange),
    loyalty_discount:known(f.cashbackDiscount),advertising_already_withheld:known(e.advertising_already_withheld),
  };
}

export function apiProducts(cabinet: any) {
  return (cabinet.products || []).map((p:any)=>{
    const revenue=known(p.revenue), cost=known(p.cost_price), units=num(p.bought_qty);
    return {marketplace:'wildberries',article:p.article,name:p.name || p.article,units,revenue,
      gross_profit:revenue==null || (units!==0 && !(cost!=null && cost>0)) ? null : Math.round((revenue-units*num(cost))*100)/100};
  });
}

export function calculate(report: Record<string, unknown>, sales: Record<string, unknown>[], costs: Map<string, number>, taxRate: number) {
  const cogs = sales.reduce((sum, row) => sum + num(costs.get(articleKey(row.article))) * num(row.bought_qty), 0);
  const salesAmount = num(report.sales_amount);
  const ads = num(report.ads_spend) + num(report.wb_media_spend);
  const tax = salesAmount * taxRate / 100;
  const manual = num(report.operational_expenses) + num(report.external_promotion_expenses);
  const netProfit = num(report.transfer_total) - ads - cogs - tax - manual;
  return {
    sales: salesAmount, orders: num(report.orders_amount), bought_qty: num(report.bought_qty),
    transfer: num(report.transfer_total), commission: salesAmount - num(report.transfer_goods),
    delivery: num(report.delivery_cost), storage: num(report.storage_cost), fines: num(report.fines),
    acceptance: num(report.acceptance_ops), other_fees: num(report.other_fees), ads,
    promo_bonuses: num(report.ads_promo_spend), operational_expenses: num(report.operational_expenses),
    external_promotion: num(report.external_promotion_expenses), cogs, tax, net_profit: netProfit,
    margin_percent: salesAmount ? netProfit / salesAmount * 100 : 0,
    ad_share_of_sales: salesAmount ? (ads+num(report.external_promotion_expenses)) / salesAmount * 100 : 0,
    ad_share_of_orders:report.marketplace==='ozon' || !(num(report.orders_amount)>0) ? null : (ads+num(report.external_promotion_expenses))/num(report.orders_amount)*100,
  };
}

export function combine(items: Record<string, number | null>[]) {
  const result: Record<string, number | null> = {};
  for (const item of items) for (const [key, value] of Object.entries(item)) {
    if (!['margin_percent','ad_share_of_sales','ad_share_of_orders'].includes(key)) result[key] = value==null || result[key]===null ? null : (result[key] || 0) + value;
  }
  result.margin_percent = result.sales==null || result.net_profit==null ? null : result.sales ? result.net_profit / result.sales * 100 : 0;
  const advertising=result.ads==null ? null : result.ads+(result.external_promotion || 0);
  result.ad_share_of_sales = items.some(item=>item.ad_share_of_sales==null) || result.sales==null || advertising==null ? null : result.sales ? advertising / result.sales * 100 : 0;
  result.ad_share_of_orders = items.some(item=>item.ad_share_of_orders==null) || result.orders==null || advertising==null || !(result.orders>0) ? null : advertising/result.orders*100;
  return result;
}

export async function readPages(makeQuery: () => any) {
  const rows: any[]=[];
  for(let offset=0;;offset+=1000) {
    const {data,error}=await makeQuery().range(offset,offset+999);
    if(error) throw error;
    rows.push(...(data || []));
    if(!data || data.length<1000) return rows;
  }
}
