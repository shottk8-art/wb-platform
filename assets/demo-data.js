/* Entirely fictional. No seller data, credentials or network calls. */
(function(root){
  function build(anchor=new Date()) {
    const products=[['serum','Сыворотка для лица',1290,310,140],['cream','Крем для рук',690,155,190],['cleanser','Гель для умывания',890,210,120],['mask','Маска для лица',450,95,150],['toner','Увлажняющий тоник',990,240,90],['balm','Бальзам для губ',390,85,180]];
    const costs=new Map(products.map(([a,n,p,c])=>[a,c])),periods=[];
    for(let i=11;i>=0;i--){const d=new Date(Date.UTC(anchor.getFullYear(),anchor.getMonth()-1-i,1));periods.push({year:d.getUTCFullYear(),month:d.getUTCMonth()+1});}
    const data={wildberries:[],ozon:[]};
    for(const marketplace of Object.keys(data))periods.forEach((period,index)=>{
      const factor=(marketplace==='ozon'?.62:1)*(1+index*.035+Math.sin(index*.7)*.08);
      const skus=products.map(([article,name,price,cost,quantity],j)=>{const bought_qty=Math.round(quantity*factor*(1+Math.sin(index+j)*.07));return {article,name,bought_qty,revenue:bought_qty*price,marketplace};});
      const sales_amount=skus.reduce((a,s)=>a+s.revenue,0),commission=Math.round(sales_amount*.17),delivery_cost=Math.round(sales_amount*.067),storage_cost=Math.round(sales_amount*.012),acceptance_ops=Math.round(sales_amount*.006);
      const report={...period,marketplace,sales_amount,orders_amount:marketplace==='ozon'?null:Math.round(sales_amount*1.32),bought_qty:skus.reduce((a,s)=>a+s.bought_qty,0),transfer_goods:sales_amount-commission,transfer_total:sales_amount-commission-delivery_cost-storage_cost-acceptance_ops,delivery_cost,storage_cost,acceptance_ops,fines:0,other_fees:0,ads_spend:Math.round(sales_amount*.075),wb_media_spend:marketplace==='ozon'?0:Math.round(sales_amount*.012),ads_promo_spend:index%3===0?2000:0,operational_expenses:12000,external_promotion_expenses:5000};
      data[marketplace].push({period,report,skus});
    });
    return {periods,costs,data,taxRate:6};
  }
  if(typeof module==='object'&&module.exports)module.exports={build};else root.WBDemoData={build};
})(typeof window==='object'?window:globalThis);
