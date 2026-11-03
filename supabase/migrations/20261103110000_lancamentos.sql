-- Tela Lançamentos: placar de cada lançamento (coleção, data comemorativa, produto novo) desde o dia 0.
-- Um lançamento é definido por:
--   termos_campanha: pedaços do nome das campanhas de anúncio / utm_campaign (ex.: "lugares do meu gato", "natal 2026")
--   termos_produto:  pedaços do nome dos produtos (ex.: "lugares do meu gato")
-- A comparação ignora maiúsculas, acentos, espaços e pontuação: "Natal 2026", "natal2026" e "NATAL-2026" são iguais.

-- Sem "set search_path" para o Postgres poder embutir a função na consulta (com ele, cada chamada custa caro).
-- Só usa funções do pg_catalog, sempre qualificadas.
create or replace function public.norm_txt(t text) returns text
language sql immutable parallel safe as $$
  select pg_catalog.regexp_replace(
    pg_catalog.translate(pg_catalog.lower(coalesce(t, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
    '[^a-z0-9]', '', 'g')
$$;

create or replace function public.casa_termo(t text, termos text[]) returns boolean
language sql immutable parallel safe as $$
  select public.norm_txt(t) operator(pg_catalog.~~) any (
    select '%' operator(pg_catalog.||) public.norm_txt(x) operator(pg_catalog.||) '%'
    from pg_catalog.unnest(coalesce(termos, '{}'::text[])) x
    where public.norm_txt(x) operator(pg_catalog.<>) ''
  )
$$;

create table if not exists public.lancamentos (
  id bigint generated always as identity primary key,
  store text not null references public.stores(store),
  nome text not null,
  inicio date not null,
  termos_campanha text[] not null default '{}',
  termos_produto text[] not null default '{}',
  custo_extra numeric not null default 0,
  nota text,
  created_by text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lancamentos_loja on public.lancamentos (store, inicio desc);

alter table public.lancamentos enable row level security;
revoke all on public.lancamentos from anon;
grant select, insert, update, delete on public.lancamentos to authenticated;
drop policy if exists "time le" on public.lancamentos;
drop policy if exists "time edita" on public.lancamentos;
create policy "time le" on public.lancamentos for select to authenticated using ((select public.is_allowed()));
create policy "time edita" on public.lancamentos for all to authenticated
  using ((select public.is_allowed())) with check ((select public.is_allowed()));

-- Placar de um lançamento, dia a dia, do dia 0 até hoje (no máximo 90 dias).
-- Pedido -> campanha de anúncio: utm_id, utm_campaign numérico (Google), utm_term = id do anúncio (Meta antigo)
-- ou nome da campanha (ignorando maiúsculas, espaços e pontuação).
create or replace function public.lancamento_placar(p_id bigint, p_detalhe boolean default true)
returns jsonb language sql stable set search_path = '' as $$
with l as (
  select x.*, least((now() at time zone 'America/Sao_Paulo')::date, x.inicio + 89) as fim
  from public.lancamentos x where x.id = p_id
),
ids as materialized (
  select distinct on (a.campaign_id) a.campaign_id, a.campaign_name
  from public.ad_spend a, l where a.store = l.store order by a.campaign_id, a.day desc
),
ads as (
  select distinct on (a.ad_id) a.ad_id, a.campaign_id
  from public.ad_spend a, l where a.store = l.store and a.ad_id <> '' order by a.ad_id, a.day desc
),
nomes as (
  select distinct on (public.norm_txt(campaign_name)) public.norm_txt(campaign_name) as n, campaign_id from ids
),
nomes_todos as materialized (
  select distinct a.campaign_id, a.campaign_name from public.ad_spend a, l where a.store = l.store
),
camp as (       -- campanhas do lançamento (compara os nomes distintos, não linha a linha)
  select distinct n.campaign_id from nomes_todos n, l where public.casa_termo(n.campaign_name, l.termos_campanha)
),
gasto as (
  select a.* from public.ad_spend a join l on a.store = l.store and a.day between l.inicio and l.fim
  where a.campaign_id in (select campaign_id from camp)
),
pedidos as (
  select o.order_id, o.dia, o.total, o.canal_ultimo, o.cliente_novo, o.last_campaign,
    coalesce(i1.campaign_id, i2.campaign_id, ad.campaign_id, nm.campaign_id) as campaign_id
  from public.v_orders o
  join l on o.store = l.store and o.dia between l.inicio and l.fim
  left join ids i1 on i1.campaign_id = nullif(trim(o.last_utm_id), '')
  left join ids i2 on o.last_campaign ~ '^\s*\d+\s*$' and i2.campaign_id = trim(o.last_campaign)
  left join ads ad on o.last_term ~ '^\s*\d+\s*$' and ad.ad_id = trim(o.last_term)
  left join nomes nm on nm.n = public.norm_txt(o.last_campaign)
),
ped_camp as (   -- pedidos cujo último clique veio de uma campanha do lançamento (anúncio ou UTM manual)
  select p.*, ids.campaign_name as campanha_anuncio
  from pedidos p cross join l left join ids using (campaign_id)
  where p.campaign_id in (select campaign_id from camp) or public.casa_termo(p.last_campaign, l.termos_campanha)
),
itens as (      -- itens vendidos dos produtos do lançamento, qualquer canal
  select i.order_id, i.product_title, i.quantity, i.amount, p.dia, p.canal_ultimo, p.cliente_novo
  from public.order_items i join pedidos p using (order_id), l
  where i.store = l.store and public.casa_termo(i.product_title, l.termos_produto)
),
g as (
  select day as dia,
    sum(spend) filter (where platform = 'meta') as meta,
    sum(spend) filter (where platform = 'google') as google,
    sum(spend) filter (where platform not in ('meta', 'google')) as outros,
    sum(platform_revenue) as receita_plataforma
  from gasto group by 1
),
c as (select dia, sum(total) as vendas, count(*) as pedidos from ped_camp group by 1),
i as (select dia, sum(amount) as vendas, sum(quantity) as unidades, count(distinct order_id) as pedidos from itens group by 1),
dias as (
  select d::date as dia,
    coalesce(g.meta, 0) as meta, coalesce(g.google, 0) as google, coalesce(g.outros, 0) as outros,
    coalesce(g.receita_plataforma, 0) as receita_plataforma,
    coalesce(c.vendas, 0) as vendas_campanha, coalesce(c.pedidos, 0) as pedidos_campanha,
    coalesce(i.vendas, 0) as vendas_produto, coalesce(i.unidades, 0) as unidades, coalesce(i.pedidos, 0) as pedidos_produto
  from l cross join generate_series(l.inicio, l.fim, interval '1 day') d
  left join g on g.dia = d::date
  left join c on c.dia = d::date
  left join i on i.dia = d::date
)
select jsonb_build_object(
  'lancamento', (select to_jsonb(l) - 'fim' from l),
  'fim', (select fim from l),
  'dias', coalesce((select jsonb_agg(dias order by dia) from dias), '[]'::jsonb),
  'clientes_novos_produto', (select count(distinct order_id) filter (where cliente_novo) from itens),
  'clientes_novos_campanha', (select count(*) filter (where cliente_novo) from ped_camp),
  'campanhas', case when p_detalhe then coalesce((
    select jsonb_agg(x order by x.gasto desc) from (
      select gs.platform, gs.campaign_id, max(gs.campaign_name) as campanha, min(gs.day) as primeiro_dia,
             sum(gs.spend) as gasto, sum(gs.platform_revenue) as receita_plataforma, sum(gs.platform_purchases) as compras_plataforma,
             (select count(*) from ped_camp pc where pc.campaign_id = gs.campaign_id) as pedidos_shopify,
             (select coalesce(sum(total), 0) from ped_camp pc where pc.campaign_id = gs.campaign_id) as vendas_shopify
      from gasto gs group by gs.platform, gs.campaign_id
    ) x), '[]'::jsonb) end,
  'outras_campanhas', case when p_detalhe then coalesce((   -- UTM que casou mas não é campanha paga (WhatsApp, e-mail…)
    select jsonb_agg(x order by x.vendas desc) from (
      select pc.canal_ultimo as canal, pc.last_campaign as campanha, count(*) as pedidos, sum(pc.total) as vendas
      from ped_camp pc where pc.campanha_anuncio is null group by 1, 2
    ) x), '[]'::jsonb) end,
  'produtos', case when p_detalhe then coalesce((
    select jsonb_agg(x order by x.vendas desc) from (
      select product_title as produto, sum(quantity) as unidades, sum(amount) as vendas, count(distinct order_id) as pedidos
      from itens group by 1
    ) x), '[]'::jsonb) end,
  'canais', case when p_detalhe then coalesce((
    select jsonb_agg(x order by x.vendas desc) from (
      select canal_ultimo as canal, count(distinct order_id) as pedidos, sum(amount) as vendas from itens group by 1
    ) x), '[]'::jsonb) end
)
$$;

-- Todos os lançamentos da loja, com a série diária (sem detalhe), para a lista.
create or replace function public.lancamentos_lista(p_store text)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(public.lancamento_placar(id, false) order by inicio desc, id desc), '[]'::jsonb)
  from public.lancamentos where store = p_store
$$;

-- Prévia do que os termos pegam, para o formulário.
create or replace function public.lancamento_previa(p_store text, p_termos_campanha text[], p_termos_produto text[])
returns jsonb language sql stable set search_path = '' as $$
with n as materialized (select distinct campaign_id, campaign_name from public.ad_spend where store = p_store),
camp as (select distinct campaign_id from n where public.casa_termo(campaign_name, p_termos_campanha))
select jsonb_build_object(
  'campanhas', coalesce((
    select jsonb_agg(x order by x.primeiro_dia desc) from (
      select platform, max(campaign_name) as campanha, min(day) as primeiro_dia, sum(spend) as gasto
      from public.ad_spend where store = p_store and campaign_id in (select campaign_id from camp)
      group by platform, campaign_id limit 30
    ) x), '[]'::jsonb),
  'utms', coalesce((
    select jsonb_agg(x order by x.pedidos desc) from (
      select campanha, pedidos, primeiro_dia from (
        select last_campaign as campanha, count(*) as pedidos, min((created_at at time zone 'America/Sao_Paulo')::date) as primeiro_dia
        from public.orders where store = p_store and last_campaign is not null group by 1
      ) n where public.casa_termo(campanha, p_termos_campanha) limit 30
    ) x), '[]'::jsonb),
  'produtos', coalesce((
    select jsonb_agg(x order by x.produto) from (
      select title as produto, status from public.products where store = p_store and public.casa_termo(title, p_termos_produto)
      union
      select t, 'vendido' from (select distinct product_title as t from public.order_items where store = p_store) v
      where public.casa_termo(t, p_termos_produto)
        and not exists (select 1 from public.products pr where pr.store = p_store and pr.title = v.t)
      limit 60
    ) x), '[]'::jsonb)
)
$$;

-- Sugestões: campanhas no padrão da esteira ("APH | códigos | NOME | data") que ainda não viraram lançamento.
create or replace function public.lancamento_sugestoes(p_store text)
returns jsonb language sql stable set search_path = '' as $$
with n as (
  select campaign_name, min(day) as inicio, sum(spend) as gasto
  from public.ad_spend where store = p_store and campaign_name like '%|%|%|%' group by 1
),
c as (
  select trim(m[1]) as termo, min(n.inicio) as inicio, sum(n.gasto) as gasto
  from n, lateral regexp_match(n.campaign_name, '^[^|]+\|[^|]+\|([^|]+)\|\s*\d{4}-\d{2}-\d{2}\s*$') m
  where m is not null
  group by 1
)
select coalesce(jsonb_agg(jsonb_build_object(
    'termo', termo,
    'nome', upper(left(replace(lower(termo), '-', ' '), 1)) || substr(replace(lower(termo), '-', ' '), 2),
    'inicio', inicio, 'gasto', gasto) order by inicio desc), '[]'::jsonb)
from c
where public.norm_txt(termo) not like 'teste%'
  and not exists (
    select 1 from public.lancamentos l
    where l.store = p_store and (public.casa_termo(c.termo, l.termos_campanha) or public.norm_txt(l.nome) = public.norm_txt(c.termo))
  )
$$;

revoke execute on function public.lancamento_placar(bigint, boolean) from public, anon;
revoke execute on function public.lancamentos_lista(text) from public, anon;
revoke execute on function public.lancamento_previa(text, text[], text[]) from public, anon;
revoke execute on function public.lancamento_sugestoes(text) from public, anon;
grant execute on function public.lancamento_placar(bigint, boolean) to authenticated;
grant execute on function public.lancamentos_lista(text) to authenticated;
grant execute on function public.lancamento_previa(text, text[], text[]) to authenticated;
grant execute on function public.lancamento_sugestoes(text) to authenticated;
