-- Catálogo travava (statement timeout) com 7 dias ou mais: a família era calculada linha a linha do ad_spend
-- (anúncio × dia × posicionamento) e o gráfico diário somava o gasto com subconsultas por dia × família.
-- Agora a família é calculada uma vez por anúncio e o diário usa somas prontas.
create or replace function public.catalogo_familias(p_store text, p_inicio date, p_fim date)
returns jsonb language sql stable set search_path = '' as $function$
with bruto as materialized (
  select a.ad_id, a.ad_name, a.day, a.spend, a.clicks, a.impressions, a.platform_purchases, a.platform_revenue
  from public.ad_spend a
  where a.store = p_store and a.platform = 'meta' and a.day between p_inicio and p_fim
),
anuncio as materialized (
  select x.ad_id, x.ad_name, public.familia_do_anuncio(p_store, x.ad_name, x.ad_id) as familia
  from (select distinct ad_id, ad_name from bruto) x
),
gasto as materialized (
  select n.familia, b.day as dia, b.ad_id, b.spend, b.clicks, b.impressions, b.platform_purchases, b.platform_revenue
  from bruto b join anuncio n on n.ad_id = b.ad_id and n.ad_name is not distinct from b.ad_name
),
venda as materialized (
  select c.familia, c.letra, i.product_id, (o.created_at at time zone 'America/Sao_Paulo')::date as dia, i.order_id, i.quantity, i.amount,
         o.customer_order_index = 1 as novo
  from public.order_items i
  join public.orders o using (order_id)
  join public.produto_codigos c on c.product_id = i.product_id
  where o.store = p_store and o.cancelled_at is null
    and (o.created_at at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
),
fam as (
  select f.familia, f.nome,
         (select p.image_url from public.produto_codigos c join public.products p using (product_id)
          where c.familia = f.familia and p.image_url is not null order by (p.status = 'ACTIVE') desc, c.letra limit 1) as imagem,
         (select string_agg(distinct c.letra, '' order by c.letra) from public.produto_codigos c where c.familia = f.familia) as modelos
  from public.produto_familias f where f.store = p_store
),
g as (
  select familia, count(distinct ad_id) filter (where spend > 0) as anuncios, sum(spend) as gasto, sum(clicks) as cliques,
         sum(impressions) as impressoes, sum(platform_purchases) as compras_meta, sum(platform_revenue) as receita_meta
  from gasto where familia is not null and familia <> 'ALL' group by familia
),
v as (
  select familia, sum(quantity) as unidades, sum(amount) as receita, count(distinct order_id) as pedidos,
         count(distinct order_id) filter (where novo) as pedidos_novos
  from venda group by familia
),
linhas as materialized (
  select f.familia, f.nome, f.imagem, f.modelos, coalesce(g.anuncios, 0) as anuncios, coalesce(g.gasto, 0) as gasto,
         coalesce(g.cliques, 0) as cliques, coalesce(g.impressoes, 0) as impressoes, coalesce(g.compras_meta, 0) as compras_meta,
         coalesce(g.receita_meta, 0) as receita_meta, coalesce(v.unidades, 0) as unidades, coalesce(v.receita, 0) as receita,
         coalesce(v.pedidos, 0) as pedidos, coalesce(v.pedidos_novos, 0) as pedidos_novos
  from fam f left join g using (familia) left join v using (familia)
  where coalesce(g.gasto, 0) > 0 or coalesce(v.receita, 0) > 0
),
top as (select familia from linhas order by receita + gasto desc limit 8),
vd as (select familia, dia, sum(amount) as receita from venda group by familia, dia),
gd as (select familia, dia, sum(spend) as gasto from gasto group by familia, dia)
select jsonb_build_object(
  'totais', jsonb_build_object(
    'gasto_meta', (select coalesce(sum(spend), 0) from gasto),
    'gasto_familia', (select coalesce(sum(spend), 0) from gasto where familia is not null and familia <> 'ALL'),
    'gasto_all', (select coalesce(sum(spend), 0) from gasto where familia = 'ALL'),
    'gasto_sem_familia', (select coalesce(sum(spend), 0) from gasto where familia is null),
    'receita', (select coalesce(sum(amount), 0) from venda),
    'unidades', (select coalesce(sum(quantity), 0) from venda),
    'pedidos', (select count(distinct order_id) from venda),
    'gasto_google', (select coalesce(sum(spend), 0) from public.ad_spend where store = p_store and platform = 'google' and day between p_inicio and p_fim)
  ),
  'familias', coalesce((select jsonb_agg(l order by l.receita desc) from linhas l), '[]'::jsonb),
  'modelos', coalesce((
    select jsonb_agg(x order by x.receita desc) from (
      select v.letra, pl.modelo, sum(v.quantity) as unidades, sum(v.amount) as receita
      from venda v join public.produto_letras pl using (letra) group by v.letra, pl.modelo
    ) x), '[]'::jsonb),
  'produtos', coalesce((
    select jsonb_agg(x order by x.familia, x.unidades desc, x.receita desc) from (
      select v.familia, v.product_id, p.title, p.online_url, p.image_url, sum(v.quantity) as unidades, sum(v.amount) as receita,
             count(distinct v.order_id) as pedidos
      from venda v join public.products p using (product_id) group by v.familia, v.product_id, p.title, p.online_url, p.image_url
    ) x), '[]'::jsonb),
  'familia_modelos', coalesce((
    select jsonb_agg(x) from (
      select familia, letra, sum(quantity) as unidades, sum(amount) as receita from venda group by familia, letra
    ) x), '[]'::jsonb),
  'dias', coalesce((
    select jsonb_agg(x order by x.dia) from (
      select d::date as dia, t.familia, coalesce(vd.receita, 0) as receita, coalesce(gd.gasto, 0) as gasto
      from generate_series(p_inicio, p_fim, interval '1 day') d
      cross join top t
      left join vd on vd.familia = t.familia and vd.dia = d::date
      left join gd on gd.familia = t.familia and gd.dia = d::date
    ) x), '[]'::jsonb),
  'canais', coalesce((
    select jsonb_agg(x) from (
      select v.familia, a.canal, a.grupo, sum(v.amount * a.peso) as valor
      from venda v join public.atribuicao a on a.order_id = v.order_id and a.modelo = 'linear'
      group by v.familia, a.canal, a.grupo
    ) x), '[]'::jsonb)
);
$function$;
