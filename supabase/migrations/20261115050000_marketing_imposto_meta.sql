-- Marketing passa a incluir o imposto sobre o Meta (13,82% do gasto no Meta), como na conta da loja:
-- Meta + imposto do Meta + Google + outras plataformas + e-mail + push + outros.
-- O lucro não muda: o imposto do Meta, que antes saía à parte, agora está dentro do marketing.
drop function public.marketing_diario(text, date, date);
create function public.marketing_diario(p_store text, p_inicio date, p_fim date)
returns table (dia date, meta numeric, imposto_meta numeric, google numeric, outras_plataformas numeric, email numeric, push numeric, outros numeric, total numeric)
language sql stable set search_path = '' as $$
  with d as (select g::date as dia from generate_series(p_inicio, p_fim, interval '1 day') g),
  ads as (
    select a.day as dia, a.platform, sum(a.spend) as v
    from public.ad_spend a where a.store = p_store and a.day between p_inicio and p_fim group by 1, 2
  ),
  hist as (
    select h.dia, h.platform, h.gasto as v
    from public.gasto_historico h
    where h.store = p_store and h.dia between p_inicio and p_fim
      and not exists (select 1 from ads where ads.dia = h.dia and ads.platform = h.platform)
  ),
  plat as (select * from ads union all select * from hist),
  fixos as (
    select d.dia, c.tipo, sum(c.valor_mensal / extract(day from (date_trunc('month', d.dia) + interval '1 month - 1 day'))) as v
    from d join public.custos_marketing c on c.store = p_store and d.dia >= c.desde and (c.ate is null or d.dia <= c.ate)
    group by 1, 2
  ),
  x as (
    select d.dia,
      coalesce((select sum(v) from plat where plat.dia = d.dia and plat.platform = 'meta'), 0) as meta,
      coalesce((select sum(v) from plat where plat.dia = d.dia and plat.platform = 'google'), 0) as google,
      coalesce((select sum(v) from plat where plat.dia = d.dia and plat.platform not in ('meta', 'google')), 0) as outras_plataformas,
      coalesce((select sum(v) from fixos f where f.dia = d.dia and f.tipo = 'email'), 0) as email,
      coalesce((select sum(v) from fixos f where f.dia = d.dia and f.tipo = 'push'), 0) as push,
      coalesce((select sum(v) from fixos f where f.dia = d.dia and f.tipo = 'outro'), 0) as outros
    from d
  )
  select x.dia, round(x.meta, 2), round(x.meta * 0.1382, 2), round(x.google, 2), round(x.outras_plataformas, 2), round(x.email, 2), round(x.push, 2), round(x.outros, 2),
         round(x.meta * 1.1382 + x.google + x.outras_plataformas + x.email + x.push + x.outros, 2)
  from x order by x.dia;
$$;
grant execute on function public.marketing_diario(text, date, date) to authenticated;

-- lucro: o imposto do Meta já está no marketing; o imposto de 14% continua sobre o lucro bruto antes dele
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.projecao_diaria(text, date)'::regprocedure);
  d := replace(d, 'l.vendas - l.custo - l.marketing - l.meta * 0.1382 - l.vendas * 0.035 - l.vendas * 0.05
        - 0.14 * (l.vendas - l.custo - l.marketing) as lucro',
                  'l.vendas - l.custo - l.marketing - l.vendas * 0.035 - l.vendas * 0.05
        - 0.14 * (l.vendas - l.custo - (l.marketing - l.meta * 0.1382)) as lucro');
  d := replace(d, 'l.vendas_ant - l.custo_ant - l.marketing_ant - l.meta_ant * 0.1382 - l.vendas_ant * 0.035 - l.vendas_ant * 0.05
        - 0.14 * (l.vendas_ant - l.custo_ant - l.marketing_ant) as lucro_ant',
                  'l.vendas_ant - l.custo_ant - l.marketing_ant - l.vendas_ant * 0.035 - l.vendas_ant * 0.05
        - 0.14 * (l.vendas_ant - l.custo_ant - (l.marketing_ant - l.meta_ant * 0.1382)) as lucro_ant');
  if position('(l.marketing - l.meta * 0.1382)' in d) = 0 or position('(l.marketing_ant - l.meta_ant * 0.1382)' in d) = 0 then
    raise exception 'projecao_diaria: trecho não encontrado';
  end if;
  execute d;

  d := pg_get_functiondef('public.painel_inicio(date, date, date, date)'::regprocedure);
  d := replace(d, 't.vendas - t.custo - t.marketing - t.meta * 0.1382 - t.vendas * 0.035 - t.vendas * 0.05
                         - 0.14 * (t.vendas - t.custo - t.marketing)',
                  't.vendas - t.custo - t.marketing - t.vendas * 0.035 - t.vendas * 0.05
                         - 0.14 * (t.vendas - t.custo - (t.marketing - t.meta * 0.1382))');
  d := replace(d, $a$'custo', round(t.custo, 2), 'marketing', round(t.marketing, 2),$a$,
                  $a$'custo', round(t.custo, 2), 'marketing', round(t.marketing, 2), 'meta', round(t.meta, 2), 'imposto_meta', round(t.meta * 0.1382, 2), 'google', round(t.google, 2), 'email', round(t.email, 2), 'push', round(t.push, 2),$a$);
  d := replace(d, 'select coalesce(sum(m.total), 0) as total, coalesce(sum(m.meta), 0) as meta from public.marketing_diario',
                  'select coalesce(sum(m.total), 0) as total, coalesce(sum(m.meta), 0) as meta, coalesce(sum(m.google), 0) as google, coalesce(sum(m.email), 0) as email, coalesce(sum(m.push + m.outros + m.outras_plataformas), 0) as push from public.marketing_diario');
  d := replace(d, 't as (select vd.bruto - es.estornos as vendas, vd.*, es.estornos, mk.total as marketing, mk.meta from vd, es, mk)',
                  't as (select vd.bruto - es.estornos as vendas, vd.*, es.estornos, mk.total as marketing, mk.meta, mk.google, mk.email, mk.push from vd, es, mk)');
  if position('(t.marketing - t.meta * 0.1382)' in d) = 0 or position('mk.google, mk.email, mk.push' in d) = 0 then
    raise exception 'painel_inicio: trecho não encontrado';
  end if;
  execute d;

  d := pg_get_functiondef('public.retorno(text, date, date)'::regprocedure);
  d := replace(d, $a$'total', coalesce(sum(m.total), 0), 'meta', coalesce(sum(m.meta), 0),$a$,
                  $a$'total', coalesce(sum(m.total), 0), 'meta', coalesce(sum(m.meta), 0), 'imposto_meta', coalesce(sum(m.imposto_meta), 0),$a$);
  d := replace(d, 'select m.email + m.push + m.outros from public.marketing_diario',
                  'select m.imposto_meta + m.email + m.push + m.outros from public.marketing_diario');
  if position('imposto_meta' in d) = 0 then raise exception 'retorno: trecho não encontrado'; end if;
  execute d;
end
$do$;

-- histórico de vendas do mês atual para trás (os meses recentes ficam prontos primeiro)
select cron.unschedule('vendas-diarias-historico');
select cron.schedule('vendas-diarias-historico', '*/2 * * * *', $c$
  select public.run_sync('vendas-diarias', jsonb_build_object('store', s.store, 'mode', 'historico'))
  from public.stores s
  where coalesce((select st.cursor::jsonb ->> 'concluido' from public.sync_state st where st.source = 'vendas_diarias_hist:' || s.store), '') <> 'sim';
$c$);
delete from public.sync_state where source like 'vendas_diarias_hist:%';
