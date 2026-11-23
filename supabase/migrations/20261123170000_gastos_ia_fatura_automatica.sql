-- Fatura automática do Gemini: sync-gemini grava custo (BigQuery, exportação de faturamento) e requisições
-- (Cloud Monitoring) por dia em ia_custos_diarios. O custo de cada geração passa a ser o do dia:
-- custo ÷ requisições dos 7 dias até aquele dia (suaviza o atraso da fatura do Google).
-- Sem dados automáticos, volta para a fatura mensal lançada à mão (ia_custos).
create table if not exists public.ia_custos_diarios (
  dia date primary key,
  custo numeric,
  moeda text,
  cambio numeric,
  custo_brl numeric,
  requisicoes bigint,
  atualizado_em timestamptz not null default now()
);
alter table public.ia_custos_diarios enable row level security;

create or replace function public.ia_custo_unitario_dia(p_dia date)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select sum(c.custo_brl) / nullif(sum(c.requisicoes), 0)
       from public.ia_custos_diarios c
      where c.dia between p_dia - 6 and p_dia and c.custo_brl is not null and c.requisicoes > 0
     having count(*) > 0),
    public.ia_custo_unitario(p_dia));
$$;
revoke all on function public.ia_custo_unitario_dia(date) from public, anon, authenticated;

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
  unit as (
    select d::date as dia, public.ia_custo_unitario_dia(d::date) as unit
    from generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day') d
  ),
  ev2 as (
    select ev.*, case when ev.evento = 'geracao' and ev.ok then u.unit else 0 end as custo,
           coalesce(pc.familia, ev.product_id, ev.handle, '?') as chave
    from ev
    left join unit u on u.dia = ev.dia
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
    'custo_unitario', case when v_admin then (select unit from unit order by dia desc limit 1) end,
    'auto', case when v_admin then (
      select jsonb_build_object(
        'atualizado_em', max(c.atualizado_em),
        'ultimo_dia_custo', max(c.dia) filter (where c.custo_brl is not null),
        'moeda', max(c.moeda),
        'custo_periodo', sum(c.custo_brl) filter (where c.dia between p_inicio and p_fim),
        'requisicoes_periodo', sum(c.requisicoes) filter (where c.dia between p_inicio and p_fim))
      from public.ia_custos_diarios c) end,
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

-- de hora em hora (a fatura do Google chega com algumas horas de atraso)
select cron.schedule('sync-gemini', '23 * * * *', $c$ select public.run_sync('sync-gemini', '{}'::jsonb); $c$);
