-- Recover the Media subtotal from compact financial summaries, not raw rows.
-- Every shop/user is covered; no file totals or manually supplied amounts.
with media as (
  select j.id, coalesce(sum((d.value->>'amount')::numeric),0) as amount,
    coalesce(sum((d.value->>'count')::integer),0) as operations
  from public.wb_api_preview_jobs j
  left join lateral jsonb_array_elements(coalesce(j.summary->'deductions','[]'::jsonb)) d(value)
    on d.value->>'label' ~* '(вб|wb)[.[:space:]]*(медиа|media)([^[:alnum:]_]|$)'
  where j.finance_model->>'version'='1'
  group by j.id
)
update public.wb_api_preview_jobs j
set finance_model=jsonb_set(jsonb_set(j.finance_model,'{totals,wbMediaDeductions}',to_jsonb(to_char(m.amount,'FM999999999999999999990.00'))),
  '{media_deduction_count}',to_jsonb(m.operations))
from media m where j.id=m.id
  and j.finance_model->'totals'->>'wbMediaDeductions' is null;
