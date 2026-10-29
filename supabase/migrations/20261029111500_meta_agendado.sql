-- Meta Ads de hora em hora e no botão Atualizar
select cron.schedule('sync-meta-horario', '17 * * * *', $$
  select public.run_sync('sync-meta', '{"store":"aphago"}'::jsonb);
  select public.run_sync('sync-meta', '{"store":"abrasso"}'::jsonb);
$$);

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
  perform public.run_sync('sync-meta', jsonb_build_object('store', s.store)) from public.stores s;
  return jsonb_build_object('status', 'iniciado', 'pedido_em', now());
end;
$$;
