-- O Google Ads só coloca o número da campanha na UTM ({campaignid}).
-- Quando utm_campaign é só número, a ação sai do nome da campanha enviado pelo script do Google Ads.
create or replace function public.action_of(p_store text, campaign text)
returns text language sql stable set search_path = '' as $$
  with nome as (
    select case
      when campaign ~ '^\s*\d+\s*$' then coalesce(
        (select s.campaign_name from public.ad_spend s
          where s.store = p_store and s.campaign_id = trim(campaign)
          order by s.day desc limit 1),
        campaign)
      else campaign
    end as c
  )
  select coalesce(
    (select a.acao from public.campaign_alias a, nome where a.store = p_store and a.campanha = public.normalize_campaign(nome.c)),
    (select nullif(split_part(public.normalize_campaign(nome.c), '_', 1), '') from nome)
  );
$$;
create index if not exists ad_spend_campanha on public.ad_spend (store, campaign_id, day desc);
