document.addEventListener('DOMContentLoaded',()=>{
  'use strict';
  const $=id=>document.getElementById(id),sample=WBDemoData.build();let scope='wildberries',metric='sales';
  const derived={};for(const name of ['wildberries','ozon'])derived[name]=sample.data[name].map(r=>WBDashboard.computeDerived(r.report,r.skus,sample.costs,sample.taxRate));
  const key=p=>`${p.year}-${p.month}`;
  const period=$('periodSelect');period.innerHTML=sample.periods.map(p=>`<option value="${key(p)}">${WBDashboard.formatPeriod(p.year,p.month)}</option>`).reverse().join('');period.value=key(sample.periods[11]);
  function value(index){if(index<0)return null;const names=scope==='all'?['wildberries','ozon']:[scope];return WBRange.aggregate(names.map(marketplace=>({marketplace,derived:derived[marketplace][index]})));}
  function render(){
    document.querySelectorAll('[data-chart-style]').forEach(b=>{const active=b.dataset.chartStyle===WBShell.chartStyle;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    const index=sample.periods.findIndex(p=>key(p)===period.value),d=value(index),previous=value(index-1);
    const trend=sample.periods.map((p,i)=>WBRange.trendPoint(p,value(i)));
    document.querySelectorAll('[data-demo-scope]').forEach(b=>{b.classList.toggle('active',b.dataset.demoScope===scope);b.setAttribute('aria-pressed',String(b.dataset.demoScope===scope));});
    WBDashboard.renderKPI($('kpiRow'),d,previous,scope,{activeMetric:metric,onSelect:selected=>{metric=selected;render();$('secTrend').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}});
    WBDashboard.renderTrend($('trendChart'),trend,metric,scope);
    WBDashboard.renderExpenses($('expList'),$('expTotal'),$('expChart'),d,scope,previous);
    WBDashboard.renderSkuTable($('skuBody'),$('skuFoot'),$('skuHint'),$('skuChart'),d,previous);
    WBDashboard.renderProfitability?.(d,previous);
  }
  period.addEventListener('change',render);
  document.querySelectorAll('[data-demo-scope]').forEach(b=>b.onclick=()=>{scope=b.dataset.demoScope;render();});
  document.querySelectorAll('[data-chart-style]').forEach(b=>b.addEventListener('click',()=>{WBShell.chartStyle=b.dataset.chartStyle;document.querySelectorAll('[data-chart-style]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});render();}));
  render();
});
