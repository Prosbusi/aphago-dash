-- Vendas do dia para a projeção: a cada 10 minutos (hoje e os 2 dias anteriores) e no botão Atualizar.
-- Histórico desde 2025-01-01, mês a mês, a cada 2 minutos até terminar.
select cron.schedule('vendas-diarias-recente', '*/10 * * * *', $c$
  select public.run_sync('vendas-diarias', '{"store":"aphago"}'::jsonb);
  select public.run_sync('vendas-diarias', '{"store":"abrasso"}'::jsonb);
$c$);

select cron.schedule('vendas-diarias-historico', '*/2 * * * *', $c$
  select public.run_sync('vendas-diarias', jsonb_build_object('store', s.store, 'mode', 'historico'))
  from public.stores s
  where coalesce((select st.cursor::jsonb ->> 'mes' from public.sync_state st where st.source = 'vendas_diarias_hist:' || s.store), '')
        <= coalesce((select st.cursor::jsonb ->> 'ultimo' from public.sync_state st where st.source = 'vendas_diarias_hist:' || s.store), '9999');
$c$);

create or replace function public.request_sync()
returns jsonb language plpgsql security definer set search_path = '' as $function$
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
  perform public.run_sync('vendas-diarias', jsonb_build_object('store', s.store)) from public.stores s;
  return jsonb_build_object('status', 'iniciado', 'pedido_em', now());
end;
$function$;
