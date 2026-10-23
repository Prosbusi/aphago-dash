-- Dash Aphago: estrutura inicial
-- Camadas: dados brutos (escritos só pelas funções de coleta) -> tradução (editada pelo time) -> views (lidas pelo site)

-- =========================================================
-- ACESSO
-- =========================================================
create table public.allowed_users (
  email       text primary key check (email = lower(email)),
  nome        text,
  papel       text not null default 'time' check (papel in ('admin', 'time')),
  created_at  timestamptz not null default now()
);
comment on table public.allowed_users is 'Quem pode entrar no dashboard. admin vê margem e gerencia acessos.';

create or replace function public.is_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.allowed_users
    where email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.allowed_users
    where email = lower(coalesce((select auth.jwt()) ->> 'email', '')) and papel = 'admin'
  );
$$;

-- =========================================================
-- DADOS BRUTOS (nunca alterados à mão; corrigidos só via tradução)
-- =========================================================
create table public.orders (
  order_id              text primary key,            -- GID do Shopify
  order_number          text not null,
  created_at            timestamptz not null,
  customer_id           text,
  phone                 text,                         -- só dígitos, com 55 e DDD
  email                 text,                         -- minúsculo
  total                 numeric(12,2) not null,       -- pago pelo cliente: com frete, já sem desconto
  subtotal              numeric(12,2),
  shipping              numeric(12,2),
  discounts             numeric(12,2),
  refunded              numeric(12,2) default 0,
  discount_codes        text[],
  financial_status      text,
  cancelled_at          timestamptz,
  customer_order_index  int,                          -- 1 = primeira compra
  days_to_conversion    int,
  visits_count          int,
  first_source text, first_medium text, first_campaign text, first_content text, first_term text,
  first_utm_id text, first_landing_page text, first_referrer text, first_source_label text,
  last_source  text, last_medium  text, last_campaign  text, last_content  text, last_term  text,
  last_utm_id  text, last_landing_page  text, last_referrer  text, last_source_label  text,
  raw                   jsonb,
  synced_at             timestamptz not null default now()
);
create index on public.orders (created_at);
create index on public.orders (phone);
create index on public.orders (email);

create table public.order_items (
  line_id        text primary key,
  order_id       text not null references public.orders(order_id) on delete cascade,
  product_id     text,
  product_title  text,
  variant_title  text,
  sku            text,
  quantity       int not null,
  amount         numeric(12,2) not null              -- valor da linha já com desconto
);
create index on public.order_items (order_id);
create index on public.order_items (product_id);

create table public.visits (
  visit_id      text primary key,
  order_id      text not null references public.orders(order_id) on delete cascade,
  occurred_at   timestamptz not null,
  position      int not null,                         -- 1 = primeira visita da jornada
  source text, medium text, campaign text, content text, term text, utm_id text,
  landing_page  text,
  referrer      text,
  source_label  text
);
create index on public.visits (order_id);

create table public.ad_spend (                        -- fase 2
  day             date not null,
  platform        text not null,                      -- meta, google, tiktok, pinterest, chatgpt
  account_id      text not null default '',
  campaign_id     text not null default '',
  campaign_name   text,
  adset_id        text not null default '',
  adset_name      text,
  ad_id           text not null default '',
  ad_name         text,
  placement       text not null default '',
  spend           numeric(12,2) not null default 0,
  impressions     bigint default 0,
  clicks          bigint default 0,
  platform_purchases numeric(12,2) default 0,
  platform_revenue   numeric(12,2) default 0,
  synced_at       timestamptz not null default now(),
  primary key (day, platform, account_id, campaign_id, adset_id, ad_id, placement)
);

create table public.message_sends (                   -- fase 3 (Helena, e-mail)
  send_id     text primary key,
  sent_at     timestamptz not null,
  channel     text not null,                          -- whatsapp, email, push
  phone       text,
  email       text,
  campaign    text,
  template    text,
  raw         jsonb
);
create index on public.message_sends (phone);
create index on public.message_sends (email);

create table public.product_costs (                   -- fase 4, só admin
  product_id   text primary key,
  product_title text,
  unit_cost    numeric(12,2) not null,
  updated_at   timestamptz not null default now()
);

create table public.sync_state (
  source      text primary key,
  cursor      text,
  last_run_at timestamptz
);

create table public.sync_log (
  id          bigint generated always as identity primary key,
  ran_at      timestamptz not null default now(),
  source      text not null,
  rows_read   int,
  status      text not null,
  error       text
);

-- =========================================================
-- TRADUÇÃO (editada pelo time na tela Ajustes)
-- =========================================================
create table public.channel_map (
  source      text not null check (source = lower(source)),
  medium      text not null default '*' check (medium = lower(medium)),  -- '*' = qualquer medium
  canal       text not null,
  grupo       text not null check (grupo in ('pago', 'organico', 'mensagem', 'direto', 'sem utm')),
  updated_at  timestamptz not null default now(),
  primary key (source, medium)
);
comment on table public.channel_map is
  'source + medium -> canal. Sem UTM, source vira ref:<site de origem> (ex.: ref:google.com) ou ref:direto.';

create table public.action_map (
  acao             text primary key check (acao = lower(acao)),
  nome             text not null,
  tipo             text check (tipo in ('lancamento', 'promo', 'perpetuo', 'remarketing', 'relacionamento')),
  colecao          text,
  dono             text,
  data_lancamento  date,
  updated_at       timestamptz not null default now()
);

create table public.campaign_alias (                  -- nomes antigos/fora do padrão -> ação
  campanha    text primary key,                       -- valor normalizado (ver normalize_campaign)
  acao        text not null references public.action_map(acao) on update cascade,
  updated_at  timestamptz not null default now()
);

-- =========================================================
-- FUNÇÕES DE TRADUÇÃO
-- =========================================================
create or replace function public.normalize_campaign(c text)
returns text language sql immutable set search_path = '' as $$
  -- minúsculo, '+' e espaços repetidos viram um espaço (o '+' chega como espaço em parte dos links)
  select nullif(trim(regexp_replace(lower(coalesce(c, '')), '[\s+]+', ' ', 'g')), '');
$$;

create or replace function public.referrer_key(ref text)
returns text language sql immutable set search_path = '' as $$
  select case
    when ref is null or ref = '' then 'ref:direto'
    else 'ref:' || regexp_replace(lower(substring(ref from '^[a-z]+://([^/:?#]+)')), '^(www\.|m\.|l\.|lm\.)', '')
  end;
$$;

create or replace function public.classify_channel(src text, med text, ref text)
returns table (canal text, grupo text, chave text)
language sql stable set search_path = '' as $$
  with k as (
    select case when nullif(trim(src), '') is null then public.referrer_key(ref) else lower(trim(src)) end as s,
           lower(coalesce(trim(med), '')) as m
  )
  select coalesce(cm.canal, 'Não classificado'),
         coalesce(cm.grupo, case when k.s like 'ref:%' then 'sem utm' else 'pago' end),
         k.s || ' / ' || k.m
  from k
  left join lateral (
    select c.canal, c.grupo from public.channel_map c
    where c.source = k.s and (c.medium = k.m or c.medium = '*')
    order by (c.medium = '*')
    limit 1
  ) cm on true;
$$;

create or replace function public.action_of(campaign text)
returns text language sql stable set search_path = '' as $$
  select coalesce(
    (select a.acao from public.campaign_alias a where a.campanha = public.normalize_campaign(campaign)),
    nullif(split_part(public.normalize_campaign(campaign), '_', 1), '')
  );
$$;

-- =========================================================
-- VIEWS PARA O SITE (respeitam as regras de acesso de quem consulta)
-- =========================================================
create view public.v_orders with (security_invoker = true) as
select
  o.order_id, o.order_number, o.created_at,
  (o.created_at at time zone 'America/Sao_Paulo')::date as dia,
  o.customer_id, o.total, o.subtotal, o.shipping, o.discounts, o.refunded,
  o.total - coalesce(o.refunded, 0) as total_liquido,
  o.discount_codes, o.financial_status, o.cancelled_at,
  (o.customer_order_index = 1) as cliente_novo,
  o.customer_order_index, o.days_to_conversion, o.visits_count,
  lc.canal as canal_ultimo, lc.grupo as grupo_ultimo, lc.chave as chave_ultimo,
  public.action_of(o.last_campaign) as acao_ultima,
  o.last_campaign, o.last_content, o.last_term, o.last_utm_id,
  fc.canal as canal_primeiro, fc.grupo as grupo_primeiro, fc.chave as chave_primeiro,
  public.action_of(o.first_campaign) as acao_primeira,
  o.first_campaign
from public.orders o
cross join lateral public.classify_channel(o.last_source,  o.last_medium,  o.last_referrer)  lc
cross join lateral public.classify_channel(o.first_source, o.first_medium, o.first_referrer) fc
where o.cancelled_at is null;

create view public.v_visits with (security_invoker = true) as
select
  v.visit_id, v.order_id, v.occurred_at, v.position,
  c.canal, c.grupo, c.chave,
  public.action_of(v.campaign) as acao,
  v.campaign, v.content, v.term, v.landing_page
from public.visits v
cross join lateral public.classify_channel(v.source, v.medium, v.referrer) c;

create view public.v_order_items with (security_invoker = true) as
select i.*, o.dia, o.canal_ultimo, o.acao_ultima
from public.order_items i
join public.v_orders o using (order_id);

-- =========================================================
-- REGRAS DE ACESSO (RLS)
-- =========================================================
alter table public.allowed_users  enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.visits         enable row level security;
alter table public.ad_spend       enable row level security;
alter table public.message_sends  enable row level security;
alter table public.product_costs  enable row level security;
alter table public.sync_state     enable row level security;
alter table public.sync_log       enable row level security;
alter table public.channel_map    enable row level security;
alter table public.action_map     enable row level security;
alter table public.campaign_alias enable row level security;

-- leitura para o time (dados brutos são escritos só pelas funções de coleta, com a chave de serviço)
create policy "time le" on public.orders        for select to authenticated using ((select public.is_allowed()));
create policy "time le" on public.order_items   for select to authenticated using ((select public.is_allowed()));
create policy "time le" on public.visits        for select to authenticated using ((select public.is_allowed()));
create policy "time le" on public.ad_spend      for select to authenticated using ((select public.is_allowed()));
create policy "time le" on public.message_sends for select to authenticated using ((select public.is_allowed()));
create policy "time le" on public.sync_log      for select to authenticated using ((select public.is_allowed()));

-- tradução: o time lê e edita
create policy "time le"     on public.channel_map    for select to authenticated using ((select public.is_allowed()));
create policy "time edita"  on public.channel_map    for all    to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "time le"     on public.action_map     for select to authenticated using ((select public.is_allowed()));
create policy "time edita"  on public.action_map     for all    to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "time le"     on public.campaign_alias for select to authenticated using ((select public.is_allowed()));
create policy "time edita"  on public.campaign_alias for all    to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));

-- só admin: custos e gestão de acessos
create policy "admin" on public.product_costs for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "ve a si mesmo" on public.allowed_users for select to authenticated
  using (email = lower(coalesce((select auth.jwt()) ->> 'email', '')) or (select public.is_admin()));
create policy "admin gerencia" on public.allowed_users for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- visitantes sem login não acessam nada
revoke all on all tables in schema public from anon;
revoke execute on function public.is_allowed(), public.is_admin(), public.classify_channel(text, text, text),
  public.action_of(text), public.normalize_campaign(text), public.referrer_key(text) from anon, public;
grant execute on function public.is_allowed(), public.is_admin(), public.classify_channel(text, text, text),
  public.action_of(text), public.normalize_campaign(text), public.referrer_key(text) to authenticated;
