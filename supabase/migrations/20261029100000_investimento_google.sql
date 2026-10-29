-- Investimento em anúncios: chave do recebedor do Google Ads e view para o site

-- chave que o script do Google Ads envia; fica só no Vault
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'ads_ingest_key', 'Autoriza o script do Google Ads a enviar o investimento')
where not exists (select 1 from vault.secrets where name = 'ads_ingest_key');

create or replace function public.check_ads_key(k text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'ads_ingest_key' and decrypted_secret = k);
$$;
revoke execute on function public.check_ads_key(text) from public, anon, authenticated;
grant execute on function public.check_ads_key(text) to service_role;

-- investimento com ação e canal traduzidos, como os pedidos
create or replace view public.v_ad_spend with (security_invoker = true) as
select
  a.store, a.day as dia, a.platform,
  case a.platform when 'google' then 'Google Ads' when 'meta' then 'Meta Ads' when 'tiktok' then 'TikTok Ads'
                  when 'pinterest' then 'Pinterest Ads' when 'chatgpt' then 'ChatGPT Ads' else a.platform end as canal,
  public.action_of(a.store, a.campaign_name) as acao,
  a.account_id, a.campaign_id, a.campaign_name, a.adset_id, a.adset_name, a.ad_id, a.ad_name, a.placement,
  a.spend, a.impressions, a.clicks, a.platform_purchases, a.platform_revenue
from public.ad_spend a;
revoke all on public.v_ad_spend from anon;
