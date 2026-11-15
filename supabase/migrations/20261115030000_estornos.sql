-- Estornos (reembolsos) no dia em que aconteceram, como no relatório de vendas da Shopify.
-- vendas_diarias.vendas passa a ser o valor original dos pedidos pagos no dia do pedido
-- (pagos, parcialmente reembolsados ou reembolsados); o estorno sai no dia em que foi feito.
-- Vendas líquidas do dia = vendas − estornos do dia.

create table public.estornos (
  refund_id     text primary key,
  store         text not null,
  order_id      text not null,
  pedido        text,
  pedido_dia    date not null,
  dia           date not null,
  valor         numeric(12, 2) not null default 0,
  cancelado     boolean not null default false,
  atualizado_em timestamptz not null default now()
);
create index estornos_store_dia on public.estornos (store, dia);
alter table public.estornos enable row level security;
create policy "time le" on public.estornos for select to authenticated
  using ((select public.is_allowed()) and store = any ((select public.lojas_permitidas())::text[]));

-- estornos de um período, com os pedidos (para a bandeira da projeção e o indicador da visão geral)
create or replace function public.estornos_periodo(p_store text, p_inicio date, p_fim date)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'total', coalesce(sum(e.valor), 0),
    'pedidos', count(distinct e.order_id),
    'dias', coalesce((
      select jsonb_agg(x order by x.dia) from (
        select e2.dia, sum(e2.valor) as valor,
               jsonb_agg(jsonb_build_object('pedido', e2.pedido, 'pedido_dia', e2.pedido_dia, 'valor', e2.valor, 'cancelado', e2.cancelado) order by e2.valor desc) as itens
        from public.estornos e2 where e2.store = p_store and e2.dia between p_inicio and p_fim group by e2.dia
      ) x), '[]'::jsonb)
  )
  from public.estornos e where e.store = p_store and e.dia between p_inicio and p_fim;
$$;
grant execute on function public.estornos_periodo(text, date, date) to authenticated;

-- projeção: vendas líquidas de estornos, com os estornos de cada dia
create or replace function public.projecao_diaria(p_store text, p_hoje date default null)
returns jsonb language sql stable set search_path = '' as $$
  with base as (select coalesce(p_hoje, (now() at time zone 'America/Sao_Paulo')::date) as hoje),
  dias as (
    select (b.hoje + i) as dia, (b.hoje + i - interval '1 year')::date as dia_ant, i
    from base b, generate_series(-7, 7) i
  ),
  mk as (
    select * from public.marketing_diario(p_store, (select hoje - 7 from base), (select hoje + 7 from base))
    union all
    select * from public.marketing_diario(p_store, (select (hoje - 7 - interval '1 year')::date from base), (select (hoje + 7 - interval '1 year')::date from base))
  ),
  est as (
    select e.dia, sum(e.valor) as valor,
           jsonb_agg(jsonb_build_object('pedido', e.pedido, 'pedido_dia', e.pedido_dia, 'valor', e.valor, 'cancelado', e.cancelado) order by e.valor desc) as itens
    from public.estornos e
    where e.store = p_store
      and (e.dia between (select hoje - 7 from base) and (select hoje + 7 from base)
        or e.dia between (select (hoje - 7 - interval '1 year')::date from base) and (select (hoje + 7 - interval '1 year')::date from base))
    group by e.dia
  ),
  v as (
    select vd.dia, vd.vendas, vd.pedidos, public.custo_produto_dia(vd) as custo
    from public.vendas_diarias vd
    where vd.store = p_store
      and (vd.dia between (select hoje - 7 from base) and (select hoje + 7 from base)
        or vd.dia between (select (hoje - 7 - interval '1 year')::date from base) and (select (hoje + 7 - interval '1 year')::date from base))
  ),
  linha as (
    select d.dia, d.dia_ant, d.i,
      coalesce(va.vendas, 0) as bruto, coalesce(ea.valor, 0) as estornos, ea.itens as estornos_itens,
      coalesce(va.vendas, 0) - coalesce(ea.valor, 0) as vendas,
      coalesce(va.pedidos, 0) as pedidos, coalesce(va.custo, 0) as custo,
      coalesce(ma.total, 0) as marketing, coalesce(ma.meta, 0) as meta,
      coalesce(vb.vendas, 0) - coalesce(eb.valor, 0) as vendas_ant, coalesce(eb.valor, 0) as estornos_ant, eb.itens as estornos_ant_itens,
      coalesce(vb.pedidos, 0) as pedidos_ant, coalesce(vb.custo, 0) as custo_ant,
      coalesce(mb.total, 0) as marketing_ant, coalesce(mb.meta, 0) as meta_ant,
      vb.dia is not null as tem_vendas_ant
    from dias d
    left join v va on va.dia = d.dia
    left join v vb on vb.dia = d.dia_ant
    left join est ea on ea.dia = d.dia
    left join est eb on eb.dia = d.dia_ant
    left join mk ma on ma.dia = d.dia
    left join mk mb on mb.dia = d.dia_ant
  ),
  calc as (
    select l.*,
      l.vendas - l.custo - l.marketing - l.meta * 0.1382 - l.vendas * 0.035 - l.vendas * 0.05
        - 0.14 * (l.vendas - l.custo - l.marketing) as lucro,
      l.vendas_ant - l.custo_ant - l.marketing_ant - l.meta_ant * 0.1382 - l.vendas_ant * 0.035 - l.vendas_ant * 0.05
        - 0.14 * (l.vendas_ant - l.custo_ant - l.marketing_ant) as lucro_ant
    from linha l
  )
  select jsonb_build_object(
    'hoje', (select hoje from base),
    'atualizado_em', (select max(atualizado_em) from public.vendas_diarias where store = p_store),
    'historico_desde', (select min(dia) from public.vendas_diarias where store = p_store),
    'dias', coalesce((select jsonb_agg(jsonb_build_object(
        'dia', c.dia, 'dia_ant', c.dia_ant, 'offset', c.i,
        'bruto', round(c.bruto, 2), 'estornos', round(c.estornos, 2), 'estornos_itens', c.estornos_itens,
        'vendas', round(c.vendas, 2), 'pedidos', c.pedidos, 'custo', round(c.custo, 2), 'marketing', round(c.marketing, 2), 'lucro', round(c.lucro, 2),
        'vendas_ant', round(c.vendas_ant, 2), 'estornos_ant', round(c.estornos_ant, 2), 'estornos_ant_itens', c.estornos_ant_itens,
        'pedidos_ant', c.pedidos_ant, 'custo_ant', round(c.custo_ant, 2), 'marketing_ant', round(c.marketing_ant, 2),
        'lucro_ant', round(c.lucro_ant, 2), 'tem_vendas_ant', c.tem_vendas_ant
      ) order by c.dia) from calc c), '[]'::jsonb)
  );
$$;

-- recarrega o histórico com a nova regra (vendas originais + estornos no dia do estorno)
delete from public.sync_state where source like 'vendas_diarias_hist:%';

-- Pedido não pago (Pix aguardando ou expirado, boleto, autorizado) fica fora de todas as telas.
do $do$
declare d text;
begin
  d := pg_get_viewdef('public.v_orders'::regclass);
  d := replace(d, 'WHERE (o.cancelled_at IS NULL);', $w$WHERE ((o.cancelled_at IS NULL) AND (o.financial_status = ANY (ARRAY['PAID'::text, 'PARTIALLY_REFUNDED'::text])));$w$);
  if position('PARTIALLY_REFUNDED' in d) = 0 then raise exception 'v_orders: trecho não encontrado'; end if;
  execute 'create or replace view public.v_orders with (security_invoker = true) as ' || d;
end
$do$;

do $do$
declare d text;
begin
  d := pg_get_functiondef('public.catalogo_familias(text, date, date)'::regprocedure);
  d := replace(d, 'where o.store = p_store and o.cancelled_at is null',
                  $w$where o.store = p_store and o.cancelled_at is null and o.financial_status in ('PAID', 'PARTIALLY_REFUNDED')$w$);
  if position($w$'PARTIALLY_REFUNDED')$w$ in d) = 0 then raise exception 'catalogo_familias: trecho não encontrado'; end if;
  execute d;
end
$do$;
