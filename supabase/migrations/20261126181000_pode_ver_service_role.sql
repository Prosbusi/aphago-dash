-- A API do Pharol (Grok) usa a chave de serviço: libera a leitura das telas por loja para ela.
create or replace function public.cupons_pode_ver(p_store text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.role()) = 'service_role'
      or (public.is_allowed() and p_store = any (coalesce(public.lojas_permitidas(), '{}')));
$$;
