-- Valores sem tradução ficam no grupo "não classificado", em vez de cair em "pago"
create or replace function public.classify_channel(src text, med text, ref text)
returns table (canal text, grupo text, chave text)
language sql stable set search_path = '' as $$
  with k as (
    select case when nullif(trim(src), '') is null then public.referrer_key(ref) else lower(trim(src)) end as s,
           lower(coalesce(trim(med), '')) as m
  )
  select coalesce(cm.canal, 'Não classificado'),
         coalesce(cm.grupo, 'não classificado'),
         k.s || ' / ' || k.m
  from k
  left join lateral (
    select c.canal, c.grupo from public.channel_map c
    where c.source = k.s and (c.medium = k.m or c.medium = '*')
    order by (c.medium = '*')
    limit 1
  ) cm on true;
$$;
