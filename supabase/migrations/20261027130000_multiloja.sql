-- Duas lojas (Aphago e Abrasso), catálogo de produtos e histórico do gerador de UTM

alter default privileges in schema public revoke all on tables from anon;

create table public.stores (
  store       text primary key check (store ~ '^[a-z0-9-]+$'),
  nome        text not null,
  shop_domain text not null,
  site_url    text,                       -- domínio público da loja (preenchido pela coleta)
  updated_at  timestamptz not null default now()
);
insert into public.stores (store, nome, shop_domain, site_url) values
  ('aphago',  'Aphago',  'usematerne.myshopify.com', 'https://www.aphago.com.br'),
  ('abrasso', 'Abrasso', 'abrasso.myshopify.com',    null);

-- coluna de loja nos dados brutos (o que já existe é da Aphago)
alter table public.orders        add column store text not null default 'aphago' references public.stores(store);
alter table public.order_items   add column store text not null default 'aphago' references public.stores(store);
alter table public.visits        add column store text not null default 'aphago' references public.stores(store);
alter table public.message_sends add column store text not null default 'aphago' references public.stores(store);
alter table public.orders        alter column store drop default;
alter table public.order_items   alter column store drop default;
alter table public.visits        alter column store drop default;
alter table public.message_sends alter column store drop default;
create index on public.orders (store, created_at);

alter table public.ad_spend add column store text not null default 'aphago' references public.stores(store);
alter table public.ad_spend alter column store drop default;
alter table public.ad_spend drop constraint ad_spend_pkey;
alter table public.ad_spend add primary key (store, day, platform, account_id, campaign_id, adset_id, ad_id, placement);

-- ações e apelidos passam a ser por loja
alter table public.campaign_alias drop constraint campaign_alias_acao_fkey;
alter table public.campaign_alias drop constraint campaign_alias_pkey;
alter table public.action_map drop constraint action_map_pkey;
alter table public.action_map add column store text not null default 'aphago' references public.stores(store);
alter table public.action_map alter column store drop default;
alter table public.action_map add primary key (store, acao);
alter table public.campaign_alias add column store text not null default 'aphago' references public.stores(store);
alter table public.campaign_alias alter column store drop default;
alter table public.campaign_alias add primary key (store, campanha);
alter table public.campaign_alias add foreign key (store, acao) references public.action_map(store, acao) on update cascade;

create table public.products (
  product_id  text primary key,
  store       text not null references public.stores(store),
  title       text not null,
  handle      text,
  status      text,
  online_url  text,
  image_url   text,
  updated_at  timestamptz not null default now()
);
create index on public.products (store, title);

-- histórico do gerador de UTM (tabela criada em 20261026220000) passa a ter loja
alter table public.utm_links add column store text not null default 'aphago' references public.stores(store);
alter table public.utm_links alter column store drop default;

-- tradução de ação com loja
drop view if exists public.v_order_items;
drop view if exists public.v_orders;
drop view if exists public.v_visits;
drop function if exists public.action_of(text);
create or replace function public.action_of(p_store text, campaign text)
returns text language sql stable set search_path = '' as $$
  select coalesce(
    (select a.acao from public.campaign_alias a where a.store = p_store and a.campanha = public.normalize_campaign(campaign)),
    nullif(split_part(public.normalize_campaign(campaign), '_', 1), '')
  );
$$;
revoke execute on function public.action_of(text, text) from anon, public;
grant execute on function public.action_of(text, text) to authenticated;


create view public.v_orders with (security_invoker = true) as
select
  o.store, o.order_id, o.order_number, o.created_at,
  (o.created_at at time zone 'America/Sao_Paulo')::date as dia,
  o.customer_id, o.total, o.subtotal, o.shipping, o.discounts, o.refunded,
  o.total - coalesce(o.refunded, 0) as total_liquido,
  o.discount_codes, o.financial_status, o.cancelled_at,
  (o.customer_order_index = 1) as cliente_novo,
  o.customer_order_index, o.days_to_conversion, o.visits_count,
  lc.canal as canal_ultimo, lc.grupo as grupo_ultimo, lc.chave as chave_ultimo,
  public.action_of(o.store, o.last_campaign) as acao_ultima,
  o.last_campaign, o.last_content, o.last_term, o.last_utm_id,
  fc.canal as canal_primeiro, fc.grupo as grupo_primeiro, fc.chave as chave_primeiro,
  public.action_of(o.store, o.first_campaign) as acao_primeira,
  o.first_campaign
from public.orders o
cross join lateral public.classify_channel(o.last_source,  o.last_medium,  o.last_referrer)  lc
cross join lateral public.classify_channel(o.first_source, o.first_medium, o.first_referrer) fc
where o.cancelled_at is null;

create view public.v_visits with (security_invoker = true) as
select
  v.store, v.visit_id, v.order_id, v.occurred_at, v.position,
  c.canal, c.grupo, c.chave,
  public.action_of(v.store, v.campaign) as acao,
  v.campaign, v.content, v.term, v.landing_page
from public.visits v
cross join lateral public.classify_channel(v.source, v.medium, v.referrer) c;

create view public.v_order_items with (security_invoker = true) as
select i.line_id, i.store, i.order_id, i.product_id, i.product_title, i.variant_title, i.sku, i.quantity, i.amount,
       o.dia, o.canal_ultimo, o.acao_ultima
from public.order_items i
join public.v_orders o using (order_id);

-- acesso
alter table public.stores    enable row level security;
alter table public.products  enable row level security;
create policy "time le"     on public.stores    for select to authenticated using ((select public.is_allowed()));
create policy "admin edita" on public.stores    for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "time le"     on public.products  for select to authenticated using ((select public.is_allowed()));
revoke all on public.stores, public.products from anon;
revoke all on public.v_orders, public.v_visits, public.v_order_items from anon;

-- estado da coleta passa a ser por loja
update public.sync_state set source = 'shopify:aphago' where source = 'shopify';
update public.sync_state set source = 'shopify_backfill:aphago' where source = 'shopify_backfill';

-- coleta: uma chamada por loja, de hora em hora
select cron.unschedule('sync-shopify-horario');
select cron.schedule('sync-shopify-aphago',  '7 * * * *',  $$ select public.run_sync('sync-shopify', '{"store":"aphago"}'::jsonb); $$);
select cron.schedule('sync-shopify-abrasso', '12 * * * *', $$ select public.run_sync('sync-shopify', '{"store":"abrasso"}'::jsonb); $$);
select cron.schedule('sync-produtos', '23 */6 * * *', $$
  select public.run_sync('sync-shopify', '{"store":"aphago","mode":"products"}'::jsonb);
  select public.run_sync('sync-shopify', '{"store":"abrasso","mode":"products"}'::jsonb);
$$);
