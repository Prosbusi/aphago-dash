-- Acesso por pessoa: qualquer conta Google entra e pede acesso; só vê dados depois que um admin aprova
-- e escolhe as telas. As telas são chaves "área:tela" (ex.: aphago:retorno, geral:links, time:ideias).
-- O banco garante o acesso por loja (pedidos, gastos, vendas); a escolha de telas dentro da loja vale no site.

alter table public.allowed_users
  add column status       text not null default 'pendente' check (status in ('pendente', 'aprovado', 'bloqueado')),
  add column telas        text[] not null default '{}',
  add column foto         text,
  add column pedido_em    timestamptz not null default now(),
  add column aprovado_em  timestamptz,
  add column aprovado_por text;

-- quem já estava na lista continua com o mesmo acesso de hoje (todas as telas)
update public.allowed_users set status = 'aprovado', aprovado_em = now(),
  telas = array[
    'geral:resumo', 'geral:links', 'geral:ajustes',
    'aphago:visao', 'aphago:projecao', 'aphago:canais', 'aphago:produtos', 'aphago:jornada', 'aphago:retorno', 'aphago:lancamentos',
    'abrasso:visao', 'abrasso:projecao', 'abrasso:canais', 'abrasso:produtos', 'abrasso:jornada', 'abrasso:retorno', 'abrasso:lancamentos',
    'time:tarefas', 'time:produtos', 'time:ideias', 'time:grok'
  ];

create or replace function public.is_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.allowed_users
    where email = lower(coalesce((select auth.jwt()) ->> 'email', '')) and status = 'aprovado'
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.allowed_users
    where email = lower(coalesce((select auth.jwt()) ->> 'email', '')) and papel = 'admin' and status = 'aprovado'
  );
$$;

-- lojas cujos dados a pessoa pode ler: admin vê todas; os demais, as lojas com alguma tela liberada
create or replace function public.lojas_permitidas()
returns text[] language sql stable security definer set search_path = '' as $$
  select case
    when u.papel = 'admin' then (select array_agg(s.store) from public.stores s)
    else coalesce((select array_agg(distinct split_part(t, ':', 1)) from unnest(u.telas) t
                   where split_part(t, ':', 1) in (select s.store from public.stores s)), '{}')
  end
  from public.allowed_users u
  where u.email = lower(coalesce((select auth.jwt()) ->> 'email', '')) and u.status = 'aprovado';
$$;
grant execute on function public.lojas_permitidas() to authenticated;

-- primeiro login: registra o pedido de acesso (nome e foto vêm da conta Google)
create or replace function public.pedir_acesso()
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_meta jsonb := coalesce((select auth.jwt()) -> 'user_metadata', '{}'::jsonb);
  v_status text;
begin
  if v_email = '' then raise exception 'sem e-mail na sessão'; end if;
  select status into v_status from public.allowed_users where email = v_email;
  if v_status is not null then return v_status; end if;
  insert into public.allowed_users (email, nome, papel, status, foto, pedido_em)
  values (v_email, coalesce(v_meta ->> 'full_name', v_meta ->> 'name', split_part(v_email, '@', 1)), 'time', 'pendente', v_meta ->> 'avatar_url', now());
  return 'pendente';
end;
$$;
grant execute on function public.pedir_acesso() to authenticated;

-- leitura por loja nas tabelas de dados de venda e investimento
do $do$
declare t text;
begin
  foreach t in array array['orders', 'order_items', 'visits', 'ad_spend', 'atribuicao', 'atribuicao_pedido', 'meta_anuncios',
                           'message_sends', 'vendas_diarias', 'gasto_historico', 'custos_marketing'] loop
    execute format('drop policy if exists "time le" on public.%I', t);
    execute format($p$create policy "time le" on public.%I for select to authenticated
                     using ((select public.is_allowed()) and store = any ((select public.lojas_permitidas())::text[]))$p$, t);
  end loop;
end
$do$;
