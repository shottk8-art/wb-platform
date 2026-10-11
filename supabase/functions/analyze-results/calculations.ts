import {articleKey} from '../wb-api/articles.ts';
export const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

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
    ad_share_of_sales: salesAmount ? ads / salesAmount * 100 : 0,
  };
}

export function combine(items: ReturnType<typeof calculate>[]) {
  const result: Record<string, number> = {};
  for (const item of items) for (const [key, value] of Object.entries(item)) {
    if (key !== 'margin_percent' && key !== 'ad_share_of_sales') result[key] = (result[key] || 0) + value;
  }
  result.margin_percent = result.sales ? result.net_profit / result.sales * 100 : 0;
  result.ad_share_of_sales = result.sales ? result.ads / result.sales * 100 : 0;
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
