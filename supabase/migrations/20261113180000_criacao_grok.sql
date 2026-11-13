-- Criação de produtos no Pharol + Grok.
-- 1. O código nasce no Pharol quando o produto é cadastrado (mesma sequência da aba Códigos; nunca repete).
-- 2. Cada modelo tem a letra da tabela (a Camiseta … p Oversized Frente e Verso).
-- 3. Ficha do produto para o Grok, conferência com a Shopify pela tag e checklist marcado sozinho.
-- 4. Chaves da API do Pharol (Grok → Pharol) e webhook da rotina do Grok (Pharol → Grok), um por loja.

-- ---------------------------------------------------------------
-- Modelos com letra
-- ---------------------------------------------------------------
alter table public.modelos add column if not exists letra text unique references public.produto_letras(letra);
insert into public.modelos (nome, posicao, letra)
select case l.letra when 'a' then 'Clássica' else l.modelo end, ascii(l.letra) - 96, l.letra from public.produto_letras l
on conflict (nome) do update set letra = excluded.letra, posicao = excluded.posicao;

-- ---------------------------------------------------------------
-- Código automático
-- ---------------------------------------------------------------
create or replace function public.proxima_familia(p_store text)
returns text language sql stable set search_path = '' as $$
  with x as (select case p_store when 'aphago' then 'AP' else 'AB' end as pref)
  select x.pref || lpad((coalesce(max(substring(u.familia from 3)::int), 0) + 1)::text, 4, '0')
  from x left join lateral (
    select familia from public.produto_familias where familia like x.pref || '%'
    union all select familia from public.produto_codigos_reservados where familia like x.pref || '%'
    union all select codigo from public.produtos_criacao where codigo like x.pref || '%'
  ) u on true
  group by x.pref;
$$;

create or replace function public.produto_criacao_protege() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_store text;
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then new.created_at := now(); new.codigo := null; end if;
    if new.codigo is null then
      v_store := case new.marca when 'AP' then 'aphago' else 'abrasso' end;
      perform pg_advisory_xact_lock(hashtext('codigo:' || new.marca));
      new.codigo := public.proxima_familia(v_store);
      insert into public.produto_familias (familia, store, nome, origem, criada_em)
      values (new.codigo, v_store, new.nome, 'novo', now()) on conflict (familia) do nothing;
    end if;
  elsif current_user in ('authenticated', 'anon') then
    new.codigo := old.codigo;
    new.marca := old.marca;
    new.created_at := old.created_at;
  end if;
  if tg_op = 'UPDATE' and new.nome is distinct from old.nome then
    -- enquanto a família não tem produto na Shopify, o nome dela acompanha o do lançamento
    update public.produto_familias f set nome = new.nome, updated_at = now()
    where f.familia = new.codigo and not exists (select 1 from public.produto_codigos c where c.familia = f.familia);
  end if;
  return new;
end $$;
comment on column public.produtos_criacao.codigo is 'Família AP0000/AB0000, aberta pelo Pharol no cadastro. Ninguém muda pelo site.';

-- ---------------------------------------------------------------
-- Ficha para o Grok e conferência com a Shopify
-- ---------------------------------------------------------------
create or replace function public.lancamento_ficha(p_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'codigo', pc.codigo,
    'loja', case pc.marca when 'AP' then 'Aphago' else 'Abrasso' end,
    'nome', pc.nome,
    'descricao', pc.descricao,
    'cores', to_jsonb(pc.cores),
    'prazo', pc.prazo,
    'colecao', (select c.nome from public.colecoes c where c.id = pc.colecao_id),
    'cancelado', pc.cancelado,
    'modelos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'modelo', m.nome, 'letra', m.letra,
        'codigo', case when m.letra is not null then pc.codigo || '-' || m.letra end,
        'tags_shopify', case when m.letra is not null then jsonb_build_array(pc.codigo, pc.codigo || '-' || m.letra) end,
        'na_shopify', exists (select 1 from public.products p where p.tags @> array[pc.codigo || '-' || m.letra])
      ) order by m.posicao)
      from public.modelos m where m.id = any (pc.modelos)), '[]'::jsonb),
    'checklist', to_jsonb(pc.checks),
    'imagens', jsonb_array_length(to_jsonb(pc.imagens)),
    'regras', 'Cada modelo é um produto na Shopify com as duas tags (família e modelo). Não alterar o SKU. '
              || 'Anúncios com o código da família entre parênteses no nome, ex.: Criativo 03 (' || pc.codigo || ').'
  )
  from public.produtos_criacao pc where pc.id = p_id;
$$;
grant execute on function public.lancamento_ficha(uuid) to authenticated;

create or replace function public.lancamento_shopify(p_codigo text)
returns table (product_id text, title text, status text, online_url text, image_url text, letra text, codigo text)
language sql stable set search_path = '' as $$
  select p.product_id, p.title, p.status, p.online_url, p.image_url,
         (select right(t, 1) from unnest(p.tags) t where t ~ ('^' || p_codigo || '-[a-z]$') limit 1),
         (select t from unnest(p.tags) t where t ~ ('^' || p_codigo || '-[a-z]$') limit 1)
  from public.products p
  where p.tags @> array[p_codigo]
     or exists (select 1 from unnest(p.tags) t where t ~ ('^' || p_codigo || '-[a-z]$'))
  order by 6, p.title;
$$;
grant execute on function public.lancamento_shopify(text) to authenticated;

-- Marca "Criação do produto" e cada modelo de "Outras versões" que já existe na Shopify com a tag certa.
create or replace function public.conferir_lancamentos()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with achados as (
    select pc.id, array_agg(distinct k) as novos, min(p.product_id) as um_produto
    from public.produtos_criacao pc
    join public.products p on p.tags @> array[pc.codigo]
    cross join lateral (
      select 'shopify.product' as k
      union all
      select 'model.' || m.id::text from public.modelos m
      where m.id = any (pc.modelos) and m.letra is not null and p.tags @> array[pc.codigo || '-' || m.letra]
    ) z
    where pc.codigo is not null and not pc.cancelado
    group by pc.id
  )
  update public.produtos_criacao pc
  set checks = array(select distinct unnest(pc.checks || a.novos)),
      shopify_product_id = coalesce(pc.shopify_product_id, a.um_produto)
  from achados a
  where a.id = pc.id and not (pc.checks @> a.novos and pc.shopify_product_id is not null);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------
-- Integração com o Grok
-- ---------------------------------------------------------------
create table public.api_chaves (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  loja text check (loja in ('aphago', 'abrasso')),        -- null = as duas
  hash text not null unique,
  final text not null,                                    -- 4 últimos caracteres, para reconhecer na tela
  ativa boolean not null default true,
  ultimo_uso timestamptz,
  criada_em timestamptz not null default now()
);
create table public.integracoes (
  chave text primary key check (chave in ('grok_aphago', 'grok_abrasso')),
  url text not null,
  token text,
  updated_at timestamptz not null default now()
);
alter table public.api_chaves enable row level security;
alter table public.integracoes enable row level security;
create policy "admin le" on public.api_chaves for select to authenticated using ((select public.is_admin()));
create policy "admin desativa" on public.api_chaves for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin edita" on public.integracoes for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, update on public.api_chaves to authenticated;
grant select, insert, update, delete on public.integracoes to authenticated;

-- Gera uma chave nova; ela só aparece nesta resposta (o banco guarda só o hash).
create or replace function public.api_chave_gerar(p_nome text, p_loja text)
returns text language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if not public.is_admin() then raise exception 'Só admin gera chave'; end if;
  k := 'ph_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.api_chaves (nome, loja, hash, final)
  values (coalesce(nullif(trim(p_nome), ''), 'Grok'), nullif(p_loja, ''), encode(extensions.digest(k, 'sha256'), 'hex'), right(k, 4));
  return k;
end $$;
revoke execute on function public.api_chave_gerar(text, text) from public, anon;
grant execute on function public.api_chave_gerar(text, text) to authenticated;

-- Usada pela função pharol-api: devolve a loja da chave (ou '*' para as duas); null = chave inválida.
create or replace function public.api_chave_valida(p_chave text)
returns text language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  update public.api_chaves set ultimo_uso = now()
  where hash = encode(extensions.digest(coalesce(p_chave, ''), 'sha256'), 'hex') and ativa
  returning * into v;
  if v.id is null then return null; end if;
  return coalesce(v.loja, '*');
end $$;
revoke execute on function public.api_chave_valida(text) from public, anon, authenticated;
grant execute on function public.api_chave_valida(text) to service_role;

-- Botão "Enviar para o Grok": POST da ficha na rotina do Grok da loja.
create or replace function public.lancamento_enviar_grok(p_id uuid, p_mensagem text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare pc public.produtos_criacao; i public.integracoes; req bigint; corpo jsonb;
begin
  if not public.is_allowed() then raise exception 'Sem acesso'; end if;
  select * into pc from public.produtos_criacao where id = p_id;
  if not found then raise exception 'Produto não encontrado'; end if;
  select * into i from public.integracoes where chave = case pc.marca when 'AP' then 'grok_aphago' else 'grok_abrasso' end;
  if i.url is null then raise exception 'Webhook do Grok desta loja não configurado (Time › Grok)'; end if;
  corpo := jsonb_build_object(
    'comando', coalesce(nullif(trim(p_mensagem), ''),
      'Produto aprovado no Pharol. Crie tudo conforme a ficha: Customily, Shopify (um produto por modelo, com as tags indicadas), mockups e criativos. '
      || 'Para ver as imagens de referência e marcar as etapas, use a API do Pharol com o código ' || pc.codigo || '.'),
    'origem', 'pharol',
    'ficha', public.lancamento_ficha(p_id)
  );
  select net.http_post(
    url := i.url,
    body := corpo,
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', case when i.token is not null then 'Bearer ' || i.token end,
      'x-api-key', i.token)),
    timeout_milliseconds := 15000
  ) into req;
  update public.produtos_criacao set checks = array(select distinct unnest(checks || array['grok.enviado'])) where id = p_id;
  return req;
end $$;
revoke execute on function public.lancamento_enviar_grok(uuid, text) from public, anon;
grant execute on function public.lancamento_enviar_grok(uuid, text) to authenticated;

-- Resposta do último envio (para mostrar erro do webhook na tela)
create or replace function public.grok_resposta(p_req bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', status_code, 'corpo', left(content, 500), 'erro', error_msg)
  from net._http_response where id = p_req;
$$;
revoke execute on function public.grok_resposta(bigint) from public, anon;
grant execute on function public.grok_resposta(bigint) to authenticated;

-- Catálogo de hora em hora (o Grok cria produto a qualquer momento) e conferência logo depois.
grant execute on function public.propor_codigos() to service_role;
grant execute on function public.conferir_lancamentos() to service_role;
select cron.schedule('catalogo-hora', '41 * * * *', $$
  select public.run_sync('sync-shopify', '{"store":"aphago","mode":"products"}'::jsonb);
  select public.run_sync('sync-shopify', '{"store":"abrasso","mode":"products"}'::jsonb);
$$);
select cron.unschedule('sync-produtos');
