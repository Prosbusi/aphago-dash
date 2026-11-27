-- Grupo VIP separado por grupo e link no formato da Aphago.
--  * Link com cupom: https://site/discount/CUPOM?redirect=/caminho?utm_... (o cupom já vai para o carrinho).
--  * utm_term = código do grupo (vip1, vip2…). O utm_id não chega no Pharol (a Shopify não guarda) e o cupom já aparece no pedido.
--  * No texto, {link} marca onde entra o link de cada grupo; sem {link}, o link vai no fim.

create table if not exists public.comunicacao_grupos (
  store text not null check (store in ('aphago', 'abrasso')),
  canal text not null default 'vip',
  codigo text not null check (codigo ~ '^[a-z0-9-]+$'),
  nome text not null,
  ordem int not null default 0,
  ativo boolean not null default true,
  primary key (store, canal, codigo)
);
alter table public.comunicacao_grupos enable row level security;
insert into public.comunicacao_grupos (store, canal, codigo, nome, ordem) values
  ('aphago', 'vip', 'vip1', 'Grupo VIP 1', 1), ('aphago', 'vip', 'vip2', 'Grupo VIP 2', 2), ('aphago', 'vip', 'vip3', 'Grupo VIP 3', 3)
on conflict do nothing;

alter table public.comunicacao_envios add column if not exists grupos text[];
alter table public.comunicacao_envios add column if not exists aplicar_cupom boolean not null default true;

create or replace function public.comunicacao_urlenc(p text)
returns text language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(coalesce(p, ''),
    '%', '%25'), ' ', '%20'), '/', '%2F'), '?', '%3F'), '=', '%3D'), '&', '%26'), '#', '%23'), '+', '%2B');
$$;

-- Link final de um envio para um grupo (p_grupo nulo = sem utm_term).
create or replace function public.comunicacao_link(p_store text, p_canal text, p_url text, p_campanha text, p_content text,
  p_cupom text, p_aplicar boolean, p_grupo text)
returns text language plpgsql stable set search_path = '' as $$
declare
  u text[] := public.comunicacao_utm(p_canal);
  url text := trim(coalesce(p_url, ''));
  origem text;
  caminho text;
  destino text;
begin
  if url ~* '(utm_source=|utm_source%3D)' then return url; end if;
  if url = '' and (p_cupom is null or not p_aplicar) then return ''; end if;
  origem := coalesce(substring(url from '^(https?://[^/?#]+)'), (select s.site_url from public.stores s where s.store = p_store));
  caminho := coalesce(nullif(substring(url from '^https?://[^/?#]+(.*)$'), ''), case when url ~ '^/' then url end, '/');
  destino := caminho || case when position('?' in caminho) > 0 then '&' else '?' end
    || 'utm_source=' || u[1] || '&utm_medium=' || u[2]
    || '&utm_campaign=' || coalesce(nullif(public.comunicacao_slug(p_campanha), ''), 'sem-campanha')
    || '&utm_content=' || p_content
    || coalesce('&utm_term=' || nullif(p_grupo, ''), '');
  if p_cupom is not null and p_aplicar then
    return origem || '/discount/' || p_cupom || '?redirect=' || public.comunicacao_urlenc(destino);
  end if;
  return origem || destino;
end;
$$;

create or replace function public.comunicacao_envio_link()
returns trigger language plpgsql set search_path = '' as $$
declare
  local timestamp := new.enviar_em at time zone 'America/Sao_Paulo';
begin
  new.cupom := nullif(upper(trim(coalesce(new.cupom, ''))), '');
  new.url := trim(new.url);
  if tg_op = 'UPDATE' and new.enviar_em is distinct from old.enviar_em and new.utm_content = old.utm_content then
    new.utm_content := regexp_replace(new.utm_content, '^[0-9]{4}-([0-9]{1,2}h$)?', '');
  end if;
  if new.url ~* '[?&]utm_content=' then
    new.utm_content := substring(new.url from '(?i)[?&]utm_content=([^&#]*)');
  elsif new.url ~* 'utm_content%3D' then
    new.utm_content := substring(new.url from '(?i)utm_content%3D([^%&#]*)');
  elsif coalesce(new.utm_content, '') = '' then
    new.utm_content := to_char(local, 'DDMM') || '-' || extract(hour from local)::int || 'h';
  else
    new.utm_content := public.comunicacao_slug(new.utm_content);
    if new.utm_content !~ '^[0-9]{4}-' then new.utm_content := to_char(local, 'DDMM') || '-' || new.utm_content; end if;
  end if;
  new.link := public.comunicacao_link(new.store, new.canal, new.url, new.campanha, new.utm_content, new.cupom, new.aplicar_cupom, null);
  new.atualizado_em := now();
  return new;
end;
$$;

-- Grupos que recebem um envio (VIP), com o link e o texto pronto de cada um.
create or replace function public.comunicacao_pecas(e public.comunicacao_envios)
returns jsonb language sql stable set search_path = '' as $$
  with g as (
    select g.codigo, g.nome, g.ordem from public.comunicacao_grupos g
    where e.canal = 'vip' and g.store = e.store and g.canal = 'vip' and g.ativo and (e.grupos is null or g.codigo = any (e.grupos))
    union all
    select null, null, 0 where e.canal <> 'vip'
  ),
  l as (
    select g.*, public.comunicacao_link(e.store, e.canal, e.url, e.campanha, e.utm_content, e.cupom, e.aplicar_cupom, g.codigo) as link from g
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'grupo', l.codigo, 'nome', l.nome, 'link', l.link,
    'enviado', l.codigo is not null and coalesce(e.extras -> 'enviados', '[]'::jsonb) ? l.codigo,
    'texto', case when position('{link}' in e.texto) > 0 then replace(e.texto, '{link}', l.link)
                  when l.link <> '' then e.texto || E'\n' || l.link else e.texto end
  ) order by l.ordem), '[]'::jsonb) from l;
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
      and o.created_at >= (select coalesce(min(enviar_em), now()) from e) - interval '1 day'
  ),
  x as (
    select distinct e.id, e.utm_content, v.term, p.order_id, p.subtotal, p.last_medium, p.last_content, p.customer_order_index
    from e
    join public.visits v on v.store = p_store and v.medium = u[2] and v.content = e.utm_content and v.occurred_at >= e.enviar_em - interval '1 hour'
    join ped p on p.order_id = v.order_id
  ),
  link as (
    select y.id, count(*) as pedidos, coalesce(sum(y.subtotal), 0) as vendas,
           count(*) filter (where y.last_medium = u[2] and y.last_content = y.utm_content) as ultimo_clique,
           count(*) filter (where y.customer_order_index = 1) as novos
    from (select distinct id, utm_content, order_id, subtotal, last_medium, last_content, customer_order_index from x) y
    group by y.id
  ),
  grp as (
    select z.id, jsonb_agg(jsonb_build_object('grupo', z.term, 'pedidos', z.pedidos, 'vendas', z.vendas) order by z.term) as por_grupo
    from (
      select x.id, x.term, count(distinct x.order_id) as pedidos, coalesce(sum(x.subtotal), 0) as vendas
      from x join public.comunicacao_grupos g on g.store = p_store and g.canal = p_canal and g.codigo = x.term
      group by x.id, x.term
    ) z group by z.id
  ),
  cup as (
    select e.id, count(*) as pedidos, coalesce(sum(p.subtotal), 0) as vendas
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

-- Grupos da loja (tela e API).
create or replace function public.comunicacao_grupos_lista(p_store text, p_canal text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.cupons_pode_ver(p_store) then coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome, 'ativo', ativo) order by ordem, codigo), '[]'::jsonb) end
  from public.comunicacao_grupos where store = p_store and canal = p_canal;
$$;

create or replace function public.comunicacao_grupo_salvar(p_store text, p_canal text, p_codigo text, p_nome text, p_ativo boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cupons_pode_ver(p_store) then raise exception 'sem acesso a esta loja'; end if;
  insert into public.comunicacao_grupos (store, canal, codigo, nome, ativo, ordem)
  values (p_store, p_canal, public.comunicacao_slug(p_codigo), trim(p_nome), p_ativo,
          coalesce((select max(ordem) + 1 from public.comunicacao_grupos where store = p_store and canal = p_canal), 1))
  on conflict (store, canal, codigo) do update set nome = excluded.nome, ativo = excluded.ativo;
end;
$$;

create or replace function public.comunicacao_salvar(p_store text, p_canal text, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_grupos text[] := case when jsonb_typeof(p -> 'grupos') = 'array' then array(select jsonb_array_elements_text(p -> 'grupos')) end;
begin
  if not public.cupons_pode_ver(p_store) then raise exception 'sem acesso a esta loja'; end if;
  if v_id is null then
    insert into public.comunicacao_envios (store, canal, campanha, enviar_em, titulo, texto, url, utm_content, cupom, imagem_url, extras, status,
                                           grupos, aplicar_cupom, criado_por, atualizado_por)
    values (p_store, p_canal, coalesce(p ->> 'campanha', ''), (p ->> 'enviar_em')::timestamptz, coalesce(p ->> 'titulo', ''), coalesce(p ->> 'texto', ''),
            coalesce(p ->> 'url', ''), coalesce(p ->> 'utm_content', ''), p ->> 'cupom', nullif(p ->> 'imagem_url', ''),
            coalesce(p -> 'extras', '{}'::jsonb), coalesce(p ->> 'status', 'rascunho'),
            v_grupos, coalesce((p ->> 'aplicar_cupom')::boolean, p_canal = 'vip'), v_email, v_email)
    returning id into v_id;
  else
    update public.comunicacao_envios set
      campanha = coalesce(p ->> 'campanha', campanha),
      enviar_em = coalesce((p ->> 'enviar_em')::timestamptz, enviar_em),
      titulo = coalesce(p ->> 'titulo', titulo),
      texto = coalesce(p ->> 'texto', texto),
      url = coalesce(p ->> 'url', url),
      utm_content = case when p ? 'utm_content' then coalesce(p ->> 'utm_content', '') else utm_content end,
      cupom = case when p ? 'cupom' then p ->> 'cupom' else cupom end,
      imagem_url = case when p ? 'imagem_url' then nullif(p ->> 'imagem_url', '') else imagem_url end,
      extras = coalesce(p -> 'extras', extras),
      grupos = case when p ? 'grupos' then v_grupos else grupos end,
      aplicar_cupom = coalesce((p ->> 'aplicar_cupom')::boolean, aplicar_cupom),
      status = coalesce(p ->> 'status', status),
      enviado_em = case when p ->> 'status' in ('rascunho', 'aprovado') then null when p ->> 'status' = 'enviado' then coalesce(enviado_em, now()) else enviado_em end,
      atualizado_por = v_email
    where id = v_id and store = p_store and canal = p_canal;
    if not found then raise exception 'envio não encontrado'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.comunicacao_importar(p_store text, p_canal text, p_itens jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', 'grok'));
  n int;
begin
  if not public.cupons_pode_ver(p_store) then raise exception 'sem acesso a esta loja'; end if;
  insert into public.comunicacao_envios (store, canal, campanha, enviar_em, titulo, texto, url, utm_content, cupom, imagem_url, extras, status,
                                         grupos, aplicar_cupom, enviado_em, criado_por, atualizado_por)
  select p_store, p_canal, coalesce(i ->> 'campanha', ''), (i ->> 'enviar_em')::timestamptz, coalesce(i ->> 'titulo', ''), coalesce(i ->> 'texto', ''),
         coalesce(i ->> 'url', ''), coalesce(i ->> 'utm_content', i ->> 'tema', ''), i ->> 'cupom', nullif(i ->> 'imagem_url', ''),
         coalesce(i -> 'extras', '{}'::jsonb), coalesce(nullif(i ->> 'status', ''), 'rascunho'),
         case when jsonb_typeof(i -> 'grupos') = 'array' then array(select jsonb_array_elements_text(i -> 'grupos')) end,
         coalesce((i ->> 'aplicar_cupom')::boolean, p_canal = 'vip'),
         case when i ->> 'status' = 'enviado' then (i ->> 'enviar_em')::timestamptz end,
         v_email, v_email
  from jsonb_array_elements(p_itens) i;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- API: mensagens aprovadas do dia, com o texto pronto de cada grupo que ainda não recebeu.
create or replace function public.comunicacao_do_dia(p_store text, p_canal text, p_dia date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'enviar_em', e.enviar_em, 'campanha', e.campanha, 'cupom', e.cupom, 'imagem_url', e.imagem_url, 'titulo', e.titulo,
    'pode_enviar', e.enviar_em <= now() + interval '15 minutes',
    'envios', (select coalesce(jsonb_agg(pc), '[]'::jsonb) from jsonb_array_elements(public.comunicacao_pecas(e)) pc where not (pc ->> 'enviado')::boolean)
  ) order by e.enviar_em), '[]'::jsonb)
  from public.comunicacao_envios e
  where public.cupons_pode_ver(p_store) and e.store = p_store and e.canal = p_canal and e.status in ('aprovado', 'erro')
    and (e.enviar_em at time zone 'America/Sao_Paulo')::date = p_dia;
$$;

-- API: confirma o envio (de um grupo ou de todos). Fica "enviada" quando todos os grupos receberam.
create or replace function public.comunicacao_marcar(p_store text, p_id uuid, p_grupo text, p_erro text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.comunicacao_envios;
  alvo text[];
  feitos text[];
begin
  if not public.cupons_pode_ver(p_store) then raise exception 'sem acesso a esta loja'; end if;
  select * into e from public.comunicacao_envios where id = p_id and store = p_store for update;
  if not found then raise exception 'envio não encontrado ou de outra loja'; end if;
  if e.status not in ('aprovado', 'erro') then raise exception 'esta mensagem não está aprovada (status: %)', e.status; end if;
  if nullif(p_erro, '') is not null then
    update public.comunicacao_envios set status = 'erro', envio_obs = coalesce(p_grupo || ': ', '') || left(p_erro, 500), atualizado_por = 'grok' where id = e.id;
    return jsonb_build_object('status', 'erro');
  end if;
  alvo := array(select g.codigo from public.comunicacao_grupos g
                where e.canal = 'vip' and g.store = e.store and g.canal = 'vip' and g.ativo and (e.grupos is null or g.codigo = any (e.grupos)));
  feitos := array(select distinct x from unnest(array(select jsonb_array_elements_text(coalesce(e.extras -> 'enviados', '[]'::jsonb)))
                                              || case when nullif(p_grupo, '') is not null then array[p_grupo] else '{}'::text[] end) x);
  if nullif(p_grupo, '') is null or cardinality(alvo) = 0 or alvo <@ feitos then
    update public.comunicacao_envios set status = 'enviado', enviado_em = now(), envio_obs = null, atualizado_por = 'grok',
      extras = jsonb_set(extras, '{enviados}', to_jsonb(case when nullif(p_grupo, '') is null then alvo else feitos end)) where id = e.id;
    return jsonb_build_object('status', 'enviado', 'faltam', '[]'::jsonb);
  end if;
  update public.comunicacao_envios set extras = jsonb_set(extras, '{enviados}', to_jsonb(feitos)), atualizado_por = 'grok' where id = e.id;
  return jsonb_build_object('status', 'parcial', 'enviados', to_jsonb(feitos), 'faltam', to_jsonb(array(select unnest(alvo) except select unnest(feitos))));
end;
$$;

revoke execute on function public.comunicacao_grupos_lista(text, text), public.comunicacao_grupo_salvar(text, text, text, text, boolean),
  public.comunicacao_do_dia(text, text, date), public.comunicacao_marcar(text, uuid, text, text) from public, anon;
grant execute on function public.comunicacao_grupos_lista(text, text), public.comunicacao_grupo_salvar(text, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.comunicacao_do_dia(text, text, date), public.comunicacao_marcar(text, uuid, text, text) to service_role;

