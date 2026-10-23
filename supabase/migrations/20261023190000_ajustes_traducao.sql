-- Ajustes após a primeira carga real

-- origens como android-app://... não eram reconhecidas
create or replace function public.referrer_key(ref text)
returns text language sql immutable set search_path = '' as $$
  select case
    when ref is null or ref = '' then 'ref:direto'
    else 'ref:' || coalesce(
      regexp_replace(lower(substring(ref from '^[A-Za-z][A-Za-z0-9+.-]*://([^/:?#]+)')), '^(www\.|m\.|l\.|lm\.)', ''),
      'outro')
  end;
$$;

insert into public.channel_map (source, medium, canal, grupo) values
  -- posicionamentos do Meta ainda não vistos
  ('whatsapp_status',            '*', 'Meta Ads', 'pago'),
  ('facebook_right_column',      '*', 'Meta Ads', 'pago'),
  ('facebook_marketplace',       '*', 'Meta Ads', 'pago'),
  ('facebook_search',            '*', 'Meta Ads', 'pago'),
  ('facebook_profile_feed',      '*', 'Meta Ads', 'pago'),
  ('facebook_notification',      '*', 'Meta Ads', 'pago'),
  ('instagram_profile_feed',     '*', 'Meta Ads', 'pago'),
  ('instagram_search',           '*', 'Meta Ads', 'pago'),
  ('instagram_explore_grid_home','*', 'Meta Ads', 'pago'),
  ('instagram_profile_reels',    '*', 'Meta Ads', 'pago'),
  ('messenger_inbox',            '*', 'Meta Ads', 'pago'),
  ('messenger_stories',          '*', 'Meta Ads', 'pago'),
  ('audience_network',           '*', 'Meta Ads', 'pago'),
  ('threads_feed',               '*', 'Meta Ads', 'pago'),
  -- e-mails de outras ferramentas
  ('judgeme',   '*', 'E-mail (avaliações)', 'mensagem'),
  ('klaviyo',   '*', 'E-mail',              'mensagem'),
  -- retornos de login e pagamento contam como direto
  ('ref:accounts.google.com',          '*', 'Direto', 'direto'),
  ('ref:boleto-on-site.appmax.com.br', '*', 'Direto', 'direto'),
  ('ref:pix-on-site.appmax.com.br',    '*', 'Direto', 'direto'),
  ('ref:minha.aphago.com.br',          '*', 'Direto', 'direto'),
  -- apps Android do Google
  ('ref:com.google.android.googlequicksearchbox', '*', 'Google orgânico', 'sem utm'),
  ('ref:com.google.android.gm',                   '*', 'E-mail sem UTM',  'sem utm')
on conflict (source, medium) do nothing;
