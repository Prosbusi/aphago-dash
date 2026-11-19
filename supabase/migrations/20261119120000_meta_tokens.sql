-- Token do Meta salvo pelo próprio Pharol (Geral → Ajustes), sem precisar mexer nos segredos do Supabase.
-- O token nunca volta para o site: só o admin grava, e a tela mostra apenas o final, as permissões e as contas que ele enxerga.
create table public.meta_tokens (
  store       text primary key references public.stores (store),
  token       text not null,
  permissoes  text[] not null default '{}',
  contas      jsonb not null default '[]'::jsonb,
  erro        text,
  verificado_em timestamptz,
  salvo_em    timestamptz not null default now(),
  salvo_por   text
);
alter table public.meta_tokens enable row level security;  -- sem políticas: só o servidor lê

create or replace function public.meta_token_salvar(p_store text, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'só administradores'; end if;
  if coalesce(length(trim(p_token)), 0) < 50 then raise exception 'token inválido: cole o token inteiro gerado no Meta'; end if;
  insert into public.meta_tokens (store, token, salvo_em, salvo_por, permissoes, contas, erro, verificado_em)
  values (p_store, trim(p_token), now(), lower(coalesce((select auth.jwt()) ->> 'email', '')), '{}', '[]', null, null)
  on conflict (store) do update set token = excluded.token, salvo_em = now(), salvo_por = excluded.salvo_por,
    permissoes = '{}', contas = '[]', erro = null, verificado_em = null;
  perform public.run_sync('sync-meta', jsonb_build_object('store', p_store, 'mode', 'verificar'));
  return jsonb_build_object('status', 'salvo');
end;
$$;
grant execute on function public.meta_token_salvar(text, text) to authenticated;

create or replace function public.meta_tokens_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not public.is_admin() then null else coalesce((
    select jsonb_agg(jsonb_build_object(
      'store', t.store, 'final', right(t.token, 4), 'permissoes', t.permissoes, 'contas', t.contas, 'erro', t.erro,
      'verificado_em', t.verificado_em, 'salvo_em', t.salvo_em, 'salvo_por', t.salvo_por) order by t.store)
    from public.meta_tokens t), '[]'::jsonb) end;
$$;
grant execute on function public.meta_tokens_status() to authenticated;
