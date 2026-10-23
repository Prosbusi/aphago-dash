-- Coleta agendada: pg_cron chama a função sync-shopify de hora em hora.
-- A chave que autoriza a chamada é gerada aqui e fica só no Vault (nunca no repositório).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'sync_key', 'Autoriza chamadas às funções de coleta')
where not exists (select 1 from vault.secrets where name = 'sync_key');

create or replace function public.check_sync_key(k text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'sync_key' and decrypted_secret = k);
$$;
revoke execute on function public.check_sync_key(text) from public, anon, authenticated;
grant execute on function public.check_sync_key(text) to service_role;

create or replace function public.run_sync(fn text, body jsonb default '{}'::jsonb)
returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://gajxzdfcttcocsnjdvha.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_key')
    ),
    body := body,
    timeout_milliseconds := 150000
  );
$$;
revoke execute on function public.run_sync(text, jsonb) from public, anon, authenticated;

select cron.schedule('sync-shopify-horario', '7 * * * *', $$ select public.run_sync('sync-shopify'); $$);
