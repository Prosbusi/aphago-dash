-- Vendas por UTM com o mesmo crédito do Por canal.
-- O crédito de cada pedido em cada canal/campanha (tabela atribuicao, por modelo) é repartido entre as UTMs
-- que o pedido usou naquele canal e campanha: partes iguais (linear e inteligente), a primeira visita (primeiro clique)
-- ou a última UTM do pedido (último clique). Assim a soma por canal bate com o Por canal.
-- "passaram" = pedidos que tiveram ao menos uma visita com aquela UTM (crédito cheio, não soma com as outras linhas).

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
  vis as (
    select v.order_id, v.occurred_at, c.canal, coalesce(nullif(trim(v.campaign), ''), '') as campanha,
           lower(nullif(trim(v.source), '')) as src, lower(nullif(trim(v.medium), '')) as med,
           nullif(trim(v.content), '') as cont, nullif(trim(v.term), '') as term
    from public.visits v
    join o on o.order_id = v.order_id
    cross join lateral public.canal_visita(v.source, v.medium, v.campaign, v.content, v.source_label, v.source_type, v.landing_page, v.referrer) c
    where v.occurred_at >= o.created_at - interval '30 days' and v.occurred_at <= o.created_at
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
    select canal, src, med, campanha, cont, term, count(distinct order_id) as pedidos
    from vis group by 1, 2, 3, 4, 5, 6
  ),
  agg as (
    select l.canal, max(l.grupo) as grupo, l.src, l.med, l.campanha, l.cont, l.term,
           sum(l.v) as valor, sum(l.p) as pedidos, sum(l.p) filter (where l.novo_cliente) as novos
    from linhas l group by l.canal, l.src, l.med, l.campanha, l.cont, l.term
  ),
  msg as (
    select distinct on (lower(utm_content), canal) lower(utm_content) as cont, canal, titulo, enviar_em, id
    from public.comunicacao_envios where store = p_store
    order by lower(utm_content), canal, enviar_em
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'canal', g.canal, 'grupo', g.grupo, 'source', g.src, 'medium', g.med, 'campanha', g.campanha, 'conteudo', g.cont, 'termo', g.term,
    'valor', round(g.valor, 2), 'pedidos', round(g.pedidos, 3), 'novos', round(coalesce(g.novos, 0), 3),
    'passaram', coalesce(pa.pedidos, 0),
    'mensagem', case when m.id is not null then jsonb_build_object('titulo', m.titulo, 'enviar_em', m.enviar_em,
                 'canal', case m.canal when 'vip' then 'Grupo VIP' when 'push' then 'Push' else 'E-mail' end) end
  ) order by g.valor desc), '[]'::jsonb) into r
  from agg g
  left join passaram pa on pa.canal = g.canal and pa.src is not distinct from g.src and pa.med is not distinct from g.med
    and pa.campanha = g.campanha and pa.cont is not distinct from g.cont and pa.term is not distinct from g.term
  left join msg m on m.cont = lower(g.cont) and m.canal = case when g.med = 'grupo-vip' then 'vip' when g.med = 'push' then 'push' when g.med = 'email' then 'email' end;
  return r;
end;
$$;

-- Resumo do mês de um canal de Comunicação, por data do pedido (igual ao Por canal), sem contar pedido duas vezes.
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
    'cupom_pedidos', (select count(*) from cup),
    'cupom_vendas', (select coalesce(sum(total), 0) from cup)
  ) into r;
  return r;
end;
$$;

-- vendas de cada mensagem com o total do pedido (o mesmo valor que o Por canal usa)
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
    'por_grupo', coalesce(gr.por_grupo, '[]'::jsonb),
    'cupom_pedidos', coalesce(c.pedidos, 0), 'cupom_vendas', coalesce(c.vendas, 0)
  ) order by e.enviar_em), '[]'::jsonb) into r
  from e left join link l on l.id = e.id left join cup c on c.id = e.id left join grp gr on gr.id = e.id;
  return r;
end;
$$;

revoke execute on function public.utm_painel(text, date, date, text), public.comunicacao_resumo(text, text, date, date) from public, anon;
grant execute on function public.utm_painel(text, date, date, text), public.comunicacao_resumo(text, text, date, date) to authenticated;
