-- Cliques (sessões registradas pelo Pharol desde 18/11) e conversão nas UTMs e nas mensagens.
-- Pedidos de valor zero (pedidos de teste com cupom 100%) ficam fora dos resultados das mensagens.

create or replace function public.utm_painel(p_store text, p_inicio date, p_fim date, p_modelo text default 'linear')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if not public.cupons_pode_ver(p_store) then raise exception 'sem acesso a esta loja'; end if;
  with a as (
    select order_id, canal, grupo, campanha, valor_atribuido as v, pedidos_atribuidos as p, novo_cliente
    from public.atribuicao
    where store = p_store and data_pedido between p_inicio and p_fim and modelo = p_modelo
  ),
  ped as (select distinct order_id from a),
  o as (select o.* from public.orders o where o.order_id in (select order_id from ped)),
  -- cada combinação de origem é classificada uma vez só (a regra de canal é a parte cara)
  vraw as (
    select v.*, md5(concat_ws('|', coalesce(v.source, ''), coalesce(v.medium, ''), coalesce(v.campaign, ''), coalesce(v.content, ''),
                coalesce(v.source_label, ''), coalesce(v.source_type, ''), coalesce(v.landing_page, ''), coalesce(v.referrer, ''))) as k
    from public.visits v
    join o on o.order_id = v.order_id
    where v.occurred_at >= o.created_at - interval '30 days' and v.occurred_at <= o.created_at
  ),
  mapa as materialized (
    select d.k, c.canal
    from (select distinct on (k) k, source, medium, campaign, content, source_label, source_type, landing_page, referrer from vraw) d
    cross join lateral public.canal_visita(d.source, d.medium, d.campaign, d.content, d.source_label, d.source_type, d.landing_page, d.referrer) c
  ),
  vis as (
    select v.order_id, v.occurred_at, m.canal, coalesce(nullif(trim(v.campaign), ''), '') as campanha,
           lower(nullif(trim(v.source), '')) as src, lower(nullif(trim(v.medium), '')) as med,
           nullif(trim(v.content), '') as cont, nullif(trim(v.term), '') as term
    from vraw v join mapa m on m.k = v.k
  ),
  combos as (
    -- linear e inteligente: todas as UTMs distintas do canal/campanha no pedido
    select distinct order_id, canal, campanha, src, med, cont, term from vis where p_modelo in ('linear', 'em_u')
    union all
    -- primeiro clique: a primeira visita do canal/campanha
    (select distinct on (order_id, canal, campanha) order_id, canal, campanha, src, med, cont, term
     from vis where p_modelo = 'primeiro' order by order_id, canal, campanha, occurred_at)
    union all
    -- último clique: a última UTM do pedido
    select o.order_id, a.canal, a.campanha, lower(nullif(trim(o.last_source), '')), lower(nullif(trim(o.last_medium), '')),
           nullif(trim(o.last_content), ''), nullif(trim(o.last_term), '')
    from o join a on a.order_id = o.order_id
    where p_modelo = 'ultimo'
  ),
  n as (select order_id, canal, campanha, count(*) as n from combos group by 1, 2, 3),
  linhas as (
    select a.order_id, a.canal, a.grupo, a.campanha, c.src, c.med, c.cont, c.term, a.novo_cliente,
           a.v / coalesce(n.n, 1) as v, a.p / coalesce(n.n, 1) as p
    from a
    left join combos c on c.order_id = a.order_id and c.canal = a.canal and c.campanha = a.campanha
    left join n on n.order_id = a.order_id and n.canal = a.canal and n.campanha = a.campanha
  ),
  passaram as (
    select concat_ws('|', canal, coalesce(src, '∅'), coalesce(med, '∅'), campanha, coalesce(cont, '∅'), coalesce(term, '∅')) as chave, count(distinct order_id) as pedidos
    from vis group by 1
  ),
  agg as (
    select l.canal, max(l.grupo) as grupo, l.src, l.med, l.campanha, l.cont, l.term,
           sum(l.v) as valor, sum(l.p) as pedidos, sum(l.p) filter (where l.novo_cliente) as novos,
           concat_ws('|', l.canal, coalesce(l.src, '∅'), coalesce(l.med, '∅'), l.campanha, coalesce(l.cont, '∅'), coalesce(l.term, '∅')) as chave
    from linhas l group by l.canal, l.src, l.med, l.campanha, l.cont, l.term
  ),
  clk0 as (
    select lower(nullif(trim(s.source), '')) as src, lower(nullif(trim(s.medium), '')) as med, coalesce(nullif(trim(s.campaign), ''), '') as campanha,
           nullif(trim(s.content), '') as cont, nullif(trim(s.term), '') as term, count(*) as cliques,
           max(s.source) as s0, max(s.medium) as m0, max(s.campaign) as c0, max(s.content) as t0
    from public.costura_sessoes s
    where s.store = p_store and (s.ocorreu_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
      and (nullif(trim(s.source), '') is not null or nullif(trim(s.medium), '') is not null)
    group by 1, 2, 3, 4, 5
  ),
  clk as materialized (
    select k.*, c.canal, c.grupo,
           concat_ws('|', c.canal, coalesce(k.src, '∅'), coalesce(k.med, '∅'), k.campanha, coalesce(k.cont, '∅'), coalesce(k.term, '∅')) as chave
    from clk0 k
    cross join lateral public.canal_visita(k.s0, k.m0, k.c0, k.t0, null, null, null, null) c
    where c.canal <> '(ignorar)'
  ),
  tudo as (
    select coalesce(g.canal, k.canal) as canal, coalesce(g.grupo, k.grupo) as grupo, coalesce(g.src, k.src) as src, coalesce(g.med, k.med) as med,
           coalesce(g.campanha, k.campanha) as campanha, coalesce(g.cont, k.cont) as cont, coalesce(g.term, k.term) as term,
           coalesce(g.valor, 0) as valor, coalesce(g.pedidos, 0) as pedidos, coalesce(g.novos, 0) as novos, coalesce(k.cliques, 0) as cliques,
           coalesce(g.chave, k.chave) as chave
    from agg g
    full join clk k on k.chave = g.chave
  ),
  msg as (
    select distinct on (lower(utm_content), canal) lower(utm_content) as cont, canal, titulo, enviar_em, id
    from public.comunicacao_envios where store = p_store
    order by lower(utm_content), canal, enviar_em
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'canal', g.canal, 'grupo', g.grupo, 'source', g.src, 'medium', g.med, 'campanha', g.campanha, 'conteudo', g.cont, 'termo', g.term,
    'valor', round(g.valor, 2), 'pedidos', round(g.pedidos, 3), 'novos', round(coalesce(g.novos, 0), 3),
    'passaram', coalesce(pa.pedidos, 0), 'cliques', g.cliques,
    'mensagem', case when m.id is not null then jsonb_build_object('titulo', m.titulo, 'enviar_em', m.enviar_em,
                 'canal', case m.canal when 'vip' then 'Grupo VIP' when 'push' then 'Push' else 'E-mail' end) end
  ) order by g.valor desc, g.cliques desc), '[]'::jsonb) into r
  from tudo g
  left join passaram pa on pa.chave = g.chave
  left join msg m on m.cont = lower(g.cont) and m.canal = case when g.med = 'grupo-vip' then 'vip' when g.med = 'push' then 'push' when g.med = 'email' then 'email' end;
  return r;
end;
$$;

create or replace function public.comunicacao_resumo(p_store text, p_canal text, p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  u text[] := public.comunicacao_utm(p_canal);
  v_canal text := case p_canal when 'vip' then 'Grupo VIP' when 'push' then 'Push / App' else 'E-mail' end;
  r jsonb;
begin
  if not public.cupons_pode_ver(p_store) then raise exception 'sem acesso a esta loja'; end if;
  with ped as (
    select o.* from public.orders o
    where o.store = p_store and o.cancelled_at is null and o.financial_status in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
      and o.total > 0
      and (o.created_at at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  ),
  link as (
    select distinct p.order_id, p.total from ped p
    where exists (select 1 from public.visits v where v.order_id = p.order_id and v.medium = u[2])
  ),
  cupons as (
    select distinct cupom from public.comunicacao_envios
    where store = p_store and canal = p_canal and cupom is not null
      and (enviar_em at time zone 'America/Sao_Paulo')::date between p_inicio - 7 and p_fim
  ),
  cup as (
    select distinct p.order_id, p.total from ped p
    where exists (select 1 from unnest(p.discount_codes) x where upper(x) in (select cupom from cupons))
  )
  select jsonb_build_object(
    'canal', v_canal,
    'pedidos', (select count(*) from link),
    'vendas', (select coalesce(sum(total), 0) from link),
    'atribuido', (select coalesce(sum(valor_atribuido), 0) from public.atribuicao
                  where store = p_store and modelo = 'linear' and canal = v_canal and data_pedido between p_inicio and p_fim),
    'atribuido_pedidos', (select coalesce(sum(pedidos_atribuidos), 0) from public.atribuicao
                  where store = p_store and modelo = 'linear' and canal = v_canal and data_pedido between p_inicio and p_fim),
    'cliques', (select count(*) from public.costura_sessoes s where s.store = p_store and lower(s.medium) = u[2]
                and (s.ocorreu_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim),
    'cliques_desde', (select min(ocorreu_em) from public.costura_sessoes where store = p_store),
    'cupom_pedidos', (select count(*) from cup),
    'cupom_vendas', (select coalesce(sum(total), 0) from cup)
  ) into r;
  return r;
end;
$$;

create or replace function public.comunicacao_lista(p_store text, p_canal text, p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  u text[] := public.comunicacao_utm(p_canal);
  r jsonb;
begin
  if not public.cupons_pode_ver(p_store) then raise exception 'sem acesso a esta loja'; end if;
  with e as (
    select * from public.comunicacao_envios
    where store = p_store and canal = p_canal
      and (enviar_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  ),
  ped as (
    select o.* from public.orders o
    where o.store = p_store and o.cancelled_at is null and o.financial_status in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
      and o.total > 0
      and o.created_at >= (select coalesce(min(enviar_em), now()) from e) - interval '1 day'
  ),
  x as (
    select distinct e.id, e.utm_content, v.term, p.order_id, p.total, p.last_medium, p.last_content, p.customer_order_index
    from e
    join public.visits v on v.store = p_store and v.medium = u[2] and v.content = e.utm_content and v.occurred_at >= e.enviar_em - interval '1 hour'
    join ped p on p.order_id = v.order_id
  ),
  link as (
    select y.id, count(*) as pedidos, coalesce(sum(y.total), 0) as vendas,
           count(*) filter (where y.last_medium = u[2] and y.last_content = y.utm_content) as ultimo_clique,
           count(*) filter (where y.customer_order_index = 1) as novos
    from (select distinct id, utm_content, order_id, total, last_medium, last_content, customer_order_index from x) y
    group by y.id
  ),
  grp as (
    select z.id, jsonb_agg(jsonb_build_object('grupo', z.term, 'pedidos', z.pedidos, 'vendas', z.vendas) order by z.term) as por_grupo
    from (
      select x.id, x.term, count(distinct x.order_id) as pedidos, coalesce(sum(x.total), 0) as vendas
      from x join public.comunicacao_grupos g on g.store = p_store and g.canal = p_canal and g.codigo = x.term
      group by x.id, x.term
    ) z group by z.id
  ),
  clk as (
    select e.id, count(*) as cliques
    from e join public.costura_sessoes s on s.store = p_store and lower(s.medium) = u[2] and s.content = e.utm_content
      and s.ocorreu_em >= e.enviar_em - interval '1 hour'
    group by e.id
  ),
  cup as (
    select e.id, count(*) as pedidos, coalesce(sum(p.total), 0) as vendas
    from e join ped p on e.cupom is not null and e.cupom = any (array(select upper(x) from unnest(p.discount_codes) x))
      and p.created_at >= e.enviar_em and p.created_at < e.enviar_em + interval '7 days'
    group by e.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'campanha', e.campanha, 'enviar_em', e.enviar_em, 'titulo', e.titulo, 'texto', e.texto, 'url', e.url,
    'utm_content', e.utm_content, 'link', e.link, 'cupom', e.cupom, 'imagem_url', e.imagem_url, 'extras', e.extras,
    'grupos', e.grupos, 'aplicar_cupom', e.aplicar_cupom, 'pecas', (select public.comunicacao_pecas(t) from public.comunicacao_envios t where t.id = e.id),
    'status', e.status, 'enviado_em', e.enviado_em, 'envio_obs', e.envio_obs,
    'criado_por', e.criado_por, 'atualizado_por', e.atualizado_por,
    'pedidos', coalesce(l.pedidos, 0), 'vendas', coalesce(l.vendas, 0), 'ultimo_clique', coalesce(l.ultimo_clique, 0), 'novos', coalesce(l.novos, 0),
    'por_grupo', coalesce(gr.por_grupo, '[]'::jsonb), 'cliques', coalesce(k.cliques, 0),
    'cupom_pedidos', coalesce(c.pedidos, 0), 'cupom_vendas', coalesce(c.vendas, 0)
  ) order by e.enviar_em), '[]'::jsonb) into r
  from e left join link l on l.id = e.id left join cup c on c.id = e.id left join grp gr on gr.id = e.id left join clk k on k.id = e.id;
  return r;
end;
$$;
