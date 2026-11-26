-- Comunicação: envios planejados do Grupo VIP, push e e-mail, com link de UTM automático e resultado por envio.
-- Padrão de UTM: VIP = whatsapp / grupo-vip, Push = app / push, E-mail = email / email.
-- utm_content = DDMM-tema (ex.: 2611-meu-crush). Sem tema: DDMM-9h.

create table if not exists public.comunicacao_envios (
  id uuid primary key default gen_random_uuid(),
  store text not null check (store in ('aphago', 'abrasso')),
  canal text not null check (canal in ('vip', 'push', 'email')),
  campanha text not null default '',
  enviar_em timestamptz not null,
  titulo text not null default '',
  texto text not null default '',
  url text not null default '',
  utm_content text not null default '',
  link text not null default '',
  cupom text,
  imagem_url text,
  extras jsonb not null default '{}'::jsonb,
  status text not null default 'rascunho' check (status in ('rascunho', 'aprovado', 'enviado', 'erro', 'cancelado')),
  enviado_em timestamptz,
  envio_obs text,
  criado_por text,
  criado_em timestamptz not null default now(),
  atualizado_por text,
  atualizado_em timestamptz not null default now()
);
create index if not exists comunicacao_envios_busca on public.comunicacao_envios (store, canal, enviar_em);
alter table public.comunicacao_envios enable row level security;

create or replace function public.comunicacao_slug(p text)
returns text language sql immutable set search_path = '' as $$
  select trim(both '-' from regexp_replace(
    translate(lower(coalesce(p, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.comunicacao_utm(p_canal text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_canal when 'vip' then array['whatsapp', 'grupo-vip'] when 'push' then array['app', 'push'] else array['email', 'email'] end;
$$;

-- Preenche utm_content e o link final. Link que já vem com utm_ fica como está.
create or replace function public.comunicacao_envio_link()
returns trigger language plpgsql set search_path = '' as $$
declare
  u text[] := public.comunicacao_utm(new.canal);
  local timestamp := new.enviar_em at time zone 'America/Sao_Paulo';
begin
  new.cupom := nullif(upper(trim(coalesce(new.cupom, ''))), '');
  new.url := trim(new.url);
  -- mudou o dia/hora de um envio: refaz o começo do utm_content com a data nova
  if tg_op = 'UPDATE' and new.enviar_em is distinct from old.enviar_em and new.utm_content = old.utm_content then
    new.utm_content := regexp_replace(new.utm_content, '^[0-9]{4}-([0-9]{1,2}h$)?', '');
  end if;
  if new.url ~* '[?&]utm_content=' then
    new.utm_content := substring(new.url from '(?i)[?&]utm_content=([^&#]*)');
  elsif coalesce(new.utm_content, '') = '' then
    new.utm_content := to_char(local, 'DDMM') || '-' || extract(hour from local)::int || 'h';
  else
    new.utm_content := public.comunicacao_slug(new.utm_content);
    if new.utm_content !~ '^[0-9]{4}-' then new.utm_content := to_char(local, 'DDMM') || '-' || new.utm_content; end if;
  end if;
  if new.url = '' then
    new.link := '';
  elsif new.url ~* '[?&]utm_source=' then
    new.link := new.url;
  else
    new.link := new.url || case when position('?' in new.url) > 0 then '&' else '?' end
      || 'utm_source=' || u[1] || '&utm_medium=' || u[2]
      || '&utm_campaign=' || coalesce(nullif(public.comunicacao_slug(new.campanha), ''), 'sem-campanha')
      || '&utm_content=' || new.utm_content;
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists comunicacao_envio_link on public.comunicacao_envios;
create trigger comunicacao_envio_link before insert or update on public.comunicacao_envios
for each row execute function public.comunicacao_envio_link();

-- Lista do período com resultado de cada envio:
--   pedidos/vendas pelo link = pedidos que passaram pelo link do envio em alguma visita da jornada
--   último clique = o link do envio foi a última visita antes da compra
--   cupom = pedidos com o cupom do envio nos 7 dias seguintes
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
  link as (
    select x.id, count(*) as pedidos, coalesce(sum(x.subtotal), 0) as vendas,
           count(*) filter (where x.last_medium = u[2] and x.last_content = x.utm_content) as ultimo_clique,
           count(*) filter (where x.customer_order_index = 1) as novos
    from (
      select distinct e.id, e.utm_content, p.order_id, p.subtotal, p.last_medium, p.last_content, p.customer_order_index
      from e
      join public.visits v on v.store = p_store and v.medium = u[2] and v.content = e.utm_content and v.occurred_at >= e.enviar_em - interval '1 hour'
      join ped p on p.order_id = v.order_id
    ) x
    group by x.id
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
    'status', e.status, 'enviado_em', e.enviado_em, 'envio_obs', e.envio_obs,
    'criado_por', e.criado_por, 'atualizado_por', e.atualizado_por,
    'pedidos', coalesce(l.pedidos, 0), 'vendas', coalesce(l.vendas, 0), 'ultimo_clique', coalesce(l.ultimo_clique, 0), 'novos', coalesce(l.novos, 0),
    'cupom_pedidos', coalesce(c.pedidos, 0), 'cupom_vendas', coalesce(c.vendas, 0)
  ) order by e.enviar_em), '[]'::jsonb) into r
  from e left join link l on l.id = e.id left join cup c on c.id = e.id;
  return r;
end;
$$;

-- Criar ou editar um envio (p.id vazio = novo).
create or replace function public.comunicacao_salvar(p_store text, p_canal text, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  if not public.cupons_pode_ver(p_store) then raise exception 'sem acesso a esta loja'; end if;
  if v_id is null then
    insert into public.comunicacao_envios (store, canal, campanha, enviar_em, titulo, texto, url, utm_content, cupom, imagem_url, extras, status, criado_por, atualizado_por)
    values (p_store, p_canal, coalesce(p ->> 'campanha', ''), (p ->> 'enviar_em')::timestamptz, coalesce(p ->> 'titulo', ''), coalesce(p ->> 'texto', ''),
            coalesce(p ->> 'url', ''), coalesce(p ->> 'utm_content', ''), p ->> 'cupom', nullif(p ->> 'imagem_url', ''),
            coalesce(p -> 'extras', '{}'::jsonb), coalesce(p ->> 'status', 'rascunho'), v_email, v_email)
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
      status = coalesce(p ->> 'status', status),
      enviado_em = case when p ->> 'status' in ('rascunho', 'aprovado') then null else enviado_em end,
      atualizado_por = v_email
    where id = v_id and store = p_store and canal = p_canal;
    if not found then raise exception 'envio não encontrado'; end if;
  end if;
  return v_id;
end;
$$;

-- Vários envios de uma vez (importação do planejamento). Entram como rascunho, salvo se vier status.
create or replace function public.comunicacao_importar(p_store text, p_canal text, p_itens jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', 'grok'));
  n int;
begin
  if not public.cupons_pode_ver(p_store) then raise exception 'sem acesso a esta loja'; end if;
  insert into public.comunicacao_envios (store, canal, campanha, enviar_em, titulo, texto, url, utm_content, cupom, imagem_url, extras, status, criado_por, atualizado_por)
  select p_store, p_canal, coalesce(i ->> 'campanha', ''), (i ->> 'enviar_em')::timestamptz, coalesce(i ->> 'titulo', ''), coalesce(i ->> 'texto', ''),
         coalesce(i ->> 'url', ''), coalesce(i ->> 'utm_content', i ->> 'tema', ''), i ->> 'cupom', nullif(i ->> 'imagem_url', ''),
         coalesce(i -> 'extras', '{}'::jsonb), coalesce(nullif(i ->> 'status', ''), 'rascunho'), v_email, v_email
  from jsonb_array_elements(p_itens) i;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.comunicacao_apagar(p_store text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cupons_pode_ver(p_store) then raise exception 'sem acesso a esta loja'; end if;
  delete from public.comunicacao_envios where id = p_id and store = p_store and status <> 'enviado';
  if not found then raise exception 'envio já enviado ou não encontrado'; end if;
end;
$$;

revoke execute on function public.comunicacao_lista(text, text, date, date), public.comunicacao_salvar(text, text, jsonb),
  public.comunicacao_importar(text, text, jsonb), public.comunicacao_apagar(text, uuid) from public, anon;
grant execute on function public.comunicacao_lista(text, text, date, date), public.comunicacao_salvar(text, text, jsonb),
  public.comunicacao_importar(text, text, jsonb), public.comunicacao_apagar(text, uuid) to authenticated, service_role;
