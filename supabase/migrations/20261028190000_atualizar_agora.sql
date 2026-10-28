-- Botão "Atualizar agora": qualquer pessoa da lista de acesso pode pedir uma coleta imediata.
-- Limite de uma chamada a cada 2 minutos para não sobrecarregar a API do Shopify.
create or replace function public.request_sync()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ultimo timestamptz;
begin
  if not public.is_allowed() then
    raise exception 'sem acesso';
  end if;
  select last_run_at into ultimo from public.sync_state where source = 'manual';
  if ultimo is not null and ultimo > now() - interval '2 minutes' then
    return jsonb_build_object('status', 'recente', 'pedido_em', ultimo);
  end if;
  insert into public.sync_state (source, last_run_at) values ('manual', now())
    on conflict (source) do update set last_run_at = excluded.last_run_at;
  perform public.run_sync('sync-shopify', jsonb_build_object('store', s.store)) from public.stores s;
  return jsonb_build_object('status', 'iniciado', 'pedido_em', now());
end;
$$;
revoke execute on function public.request_sync() from public, anon;
grant execute on function public.request_sync() to authenticated;
