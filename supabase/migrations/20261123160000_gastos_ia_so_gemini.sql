-- Gastos com IA: só conta a chamada ao Customily que pede um efeito do Gemini (imageEffects.N.type=gemini-…).
-- Tools gratuitas do Customily (face cut out, remove background, filtros) ficam de fora.
-- Eventos antigos sem o campo efeito contam só em produto que já teve chamada ao Gemini.
-- Upload só conta em produto que já teve chamada ao Gemini.
create or replace view public.v_ia_eventos as
with gemini as (
  select distinct e.store, coalesce(e.product_id, e.handle) as p
  from public.ia_eventos e
  where e.evento = 'geracao' and e.efeito ~* 'type=gemini'
)
select e.id, e.store, e.ts, e.evento, coalesce(e.ok, true) as ok, e.product_id, e.handle, e.efeito,
       (g.p is not null) as produto_com_ia,
       case
         when e.evento = 'upload' then g.p is not null
         when e.efeito is not null then e.efeito ~* 'type=gemini'
         else g.p is not null
       end as conta
from public.ia_eventos e
left join gemini g on g.store = e.store and g.p = coalesce(e.product_id, e.handle);

revoke all on public.v_ia_eventos from public, anon, authenticated;

create or replace function public.ia_custo_unitario(p_mes date)
returns numeric language sql stable security definer set search_path = '' as $$
  with base as (
    select c.mes, c.valor,
           coalesce(c.requisicoes, (select count(*) from public.v_ia_eventos e
             where e.evento = 'geracao' and e.conta and e.ok
               and date_trunc('month', e.ts at time zone 'America/Sao_Paulo')::date = c.mes)) as geracoes
    from public.ia_custos c
    where c.mes <= date_trunc('month', p_mes)::date
  )
  select b.valor / b.geracoes from base b
  where b.geracoes > 0
  order by b.mes desc limit 1;
$$;
revoke all on function public.ia_custo_unitario(date) from public, anon, authenticated;

create or replace function public.ia_painel(p_store text, p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_admin boolean := public.is_admin();
  r jsonb;
begin
  if not (public.is_allowed() and p_store = any (coalesce(public.lojas_permitidas(), '{}'))) then
    raise exception 'sem acesso a esta loja';
  end if;

  with ev as (
    select (e.ts at time zone 'America/Sao_Paulo')::date as dia, e.evento, e.ok, e.product_id, e.handle
    from public.v_ia_eventos e
    where e.store = p_store and e.conta
      and e.ts >= (p_inicio::timestamp at time zone 'America/Sao_Paulo')
      and e.ts < ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
  ),
  meses as (
    select m::date as mes, public.ia_custo_unitario(m::date) as unit
    from generate_series(date_trunc('month', p_inicio), date_trunc('month', p_fim), interval '1 month') m
  ),
  ev2 as (
    select ev.*, case when ev.evento = 'geracao' and ev.ok then mm.unit else 0 end as custo,
           coalesce(pc.familia, ev.product_id, ev.handle, '?') as chave
    from ev
    left join meses mm on mm.mes = date_trunc('month', ev.dia)::date
    left join public.v_produto_codigos pc on pc.store = p_store and pc.product_id = ev.product_id
  ),
  vendas as (
    select coalesce(pc.familia, i.product_id) as chave, count(distinct o.order_id) as pedidos,
           sum(i.quantity) as unidades, sum(i.amount) as receita
    from public.orders o
    join public.order_items i on i.order_id = o.order_id and i.store = o.store
    left join public.v_produto_codigos pc on pc.store = p_store and pc.product_id = i.product_id
    where o.store = p_store and o.financial_status in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') and o.cancelled_at is null
      and (o.created_at at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
    group by 1
  ),
  prod as (
    select e.chave,
           count(*) filter (where e.evento = 'geracao' and e.ok) as geracoes,
           count(*) filter (where e.evento = 'geracao' and not e.ok) as falhas,
           count(*) filter (where e.evento = 'upload') as uploads,
           sum(e.custo) as custo
    from ev2 e group by e.chave
  ),
  nomes as (
    select distinct on (x.chave) x.chave, x.nome, x.link from (
      select pc.familia as chave, coalesce(pc.familia_nome, pc.title) as nome, pc.online_url as link, 0 as ord
      from public.v_produto_codigos pc where pc.store = p_store
      union all
      select p.product_id, p.title, p.online_url, 1 from public.products p where p.store = p_store
    ) x order by x.chave, x.ord
  ),
  lista as (
    select p.chave, coalesce(n.nome, p.chave) as nome, n.link,
           p.geracoes, p.falhas, p.uploads,
           case when v_admin then p.custo end as custo,
           coalesce(v.pedidos, 0) as pedidos, coalesce(v.unidades, 0) as unidades, coalesce(v.receita, 0) as receita
    from prod p
    left join vendas v on v.chave = p.chave
    left join nomes n on n.chave = p.chave
  )
  select jsonb_build_object(
    'admin', v_admin,
    'custo_unitario', case when v_admin then (select unit from meses order by mes desc limit 1) end,
    'faturas', case when v_admin then coalesce((
      select jsonb_agg(jsonb_build_object('mes', c.mes, 'valor', c.valor, 'requisicoes', c.requisicoes, 'obs', c.obs,
        'geracoes', (select count(*) from public.v_ia_eventos e where e.evento = 'geracao' and e.conta and e.ok
                     and date_trunc('month', e.ts at time zone 'America/Sao_Paulo')::date = c.mes)) order by c.mes desc)
      from public.ia_custos c), '[]'::jsonb) end,
    'primeiro_evento', (select min(e.ts) from public.ia_eventos e where e.store = p_store),
    'resumo', jsonb_build_object(
      'geracoes', (select count(*) from ev2 where evento = 'geracao' and ok),
      'falhas', (select count(*) from ev2 where evento = 'geracao' and not ok),
      'uploads', (select count(*) from ev2 where evento = 'upload'),
      'custo', case when v_admin then (select coalesce(sum(custo), 0) from ev2) end,
      'receita', (select coalesce(sum(receita), 0) from vendas),
      'pedidos', (select count(distinct o.order_id) from public.orders o
                  where o.store = p_store and o.financial_status in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') and o.cancelled_at is null
                    and (o.created_at at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim),
      'receita_com_ia', (select coalesce(sum(receita), 0) from lista),
      'pedidos_com_ia', (select coalesce(sum(pedidos), 0) from lista)
    ),
    'dias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dia', d.dia::date,
        'geracoes', (select count(*) from ev2 where ev2.dia = d.dia::date and evento = 'geracao' and ok),
        'falhas', (select count(*) from ev2 where ev2.dia = d.dia::date and evento = 'geracao' and not ok),
        'uploads', (select count(*) from ev2 where ev2.dia = d.dia::date and evento = 'upload'),
        'custo', case when v_admin then (select coalesce(sum(custo), 0) from ev2 where ev2.dia = d.dia::date) end
      ) order by d.dia)
      from generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day') d(dia)
    ), '[]'::jsonb),
    'produtos', coalesce((select jsonb_agg(to_jsonb(l) order by l.geracoes desc, l.uploads desc) from lista l), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;
