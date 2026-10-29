-- Tela Retorno: resumo do investimento x vendas, calculado no banco.
-- Liga cada pedido a uma campanha de anúncio:
--   1. utm_id (campanha, padrão novo do Meta e do Google)
--   2. utm_campaign só com número (Google: {campaignid})
--   3. utm_term = id do anúncio (padrão antigo do Meta) -> campanha do anúncio
--   4. utm_campaign = nome exato da campanha
create index if not exists ad_spend_loja_dia on public.ad_spend (store, day);
create index if not exists ad_spend_anuncio on public.ad_spend (store, ad_id);

create or replace function public.retorno(p_store text, p_inicio date, p_fim date)
returns jsonb language sql stable set search_path = '' as $$
with gasto as (
  select a.*, a.day as dia,
    case a.platform when 'google' then 'Google Ads' when 'meta' then 'Meta Ads' when 'tiktok' then 'TikTok Ads'
                    when 'pinterest' then 'Pinterest Ads' when 'chatgpt' then 'ChatGPT Ads' else a.platform end as canal
  from public.ad_spend a where a.store = p_store and a.day between p_inicio and p_fim
),
campanhas as (   -- dimensão: campanhas e anúncios conhecidos da loja (qualquer data)
  select distinct platform, campaign_id, campaign_name from public.ad_spend where store = p_store
),
anuncios as (
  select distinct on (ad_id) ad_id, platform, campaign_id from public.ad_spend where store = p_store and ad_id <> '' order by ad_id, day desc
),
pedidos as (
  select o.order_id, o.dia, o.total, o.canal_ultimo, o.cliente_novo, r.last_utm_id, r.last_campaign, r.last_term
  from public.v_orders o join public.orders r using (order_id)
  where o.store = p_store and o.dia between p_inicio and p_fim
),
pedidos_campanha as (
  select p.*,
    coalesce(
      (select c.campaign_id from campanhas c where c.campaign_id = nullif(trim(p.last_utm_id), '') limit 1),
      (select c.campaign_id from campanhas c where p.last_campaign ~ '^\s*\d+\s*$' and c.campaign_id = trim(p.last_campaign) limit 1),
      (select a.campaign_id from anuncios a where p.last_term ~ '^\s*\d+\s*$' and a.ad_id = trim(p.last_term) limit 1),
      (select c.campaign_id from campanhas c where c.campaign_name = p.last_campaign limit 1)
    ) as campaign_id
  from pedidos p
  where p.canal_ultimo in ('Meta Ads', 'Google Ads')
),
vendas_campanha as (
  select campaign_id, count(*) as pedidos, sum(total) as vendas from pedidos_campanha where campaign_id is not null group by 1
)
select jsonb_build_object(
  'loja', (select jsonb_build_object('faturamento', coalesce(sum(total), 0), 'pedidos', count(*)) from pedidos),
  'investimento', (select coalesce(sum(spend), 0) from gasto),
  'canais', coalesce((
    select jsonb_agg(x order by x.gasto desc) from (
      select g.canal, g.platform, sum(g.spend) as gasto, sum(g.impressions) as impressoes, sum(g.clicks) as cliques,
             sum(g.platform_purchases) as compras_plataforma, sum(g.platform_revenue) as receita_plataforma,
             (select count(*) from pedidos p where p.canal_ultimo = g.canal) as pedidos_shopify,
             (select coalesce(sum(total), 0) from pedidos p where p.canal_ultimo = g.canal) as vendas_shopify
      from gasto g group by g.canal, g.platform
    ) x), '[]'::jsonb),
  'campanhas', coalesce((
    select jsonb_agg(x order by x.gasto desc) from (
      select g.platform, g.canal, g.campaign_id, max(g.campaign_name) as campanha, public.action_of(p_store, max(g.campaign_name)) as acao,
             sum(g.spend) as gasto, sum(g.clicks) as cliques, sum(g.platform_purchases) as compras_plataforma,
             sum(g.platform_revenue) as receita_plataforma,
             coalesce(max(v.pedidos), 0) as pedidos_shopify, coalesce(max(v.vendas), 0) as vendas_shopify
      from gasto g left join vendas_campanha v using (campaign_id)
      group by g.platform, g.canal, g.campaign_id
      having sum(g.spend) > 0
    ) x), '[]'::jsonb),
  'posicionamentos', coalesce((
    select jsonb_agg(x order by x.gasto desc) from (
      select g.placement, sum(g.spend) as gasto, sum(g.impressions) as impressoes, sum(g.clicks) as cliques,
             sum(g.platform_purchases) as compras_plataforma, sum(g.platform_revenue) as receita_plataforma
      from gasto g where g.platform = 'meta' group by g.placement having sum(g.spend) > 0
    ) x), '[]'::jsonb),
  'anuncios', coalesce((
    select jsonb_agg(x order by x.gasto desc) from (
      select g.ad_id, max(g.ad_name) as anuncio, max(g.campaign_name) as campanha, sum(g.spend) as gasto,
             sum(g.clicks) as cliques, sum(g.platform_purchases) as compras_plataforma, sum(g.platform_revenue) as receita_plataforma
      from gasto g where g.platform = 'meta' and g.ad_id <> '' group by g.ad_id
      order by sum(g.spend) desc limit 40
    ) x), '[]'::jsonb),
  'dias', coalesce((
    select jsonb_agg(x order by x.dia) from (
      select d::date as dia, coalesce(g.meta, 0) as meta, coalesce(g.google, 0) as google, coalesce(g.outros, 0) as outros,
             coalesce(f.faturamento, 0) as faturamento
      from generate_series(p_inicio, p_fim, interval '1 day') d
      left join (
        select dia,
               sum(spend) filter (where platform = 'meta') as meta,
               sum(spend) filter (where platform = 'google') as google,
               sum(spend) filter (where platform not in ('meta', 'google')) as outros
        from gasto group by dia
      ) g on g.dia = d::date
      left join (select dia, sum(total) as faturamento from pedidos group by dia) f on f.dia = d::date
    ) x), '[]'::jsonb)
);
$$;
revoke execute on function public.retorno(text, date, date) from public, anon;
grant execute on function public.retorno(text, date, date) to authenticated;
