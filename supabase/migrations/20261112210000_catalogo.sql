-- Catálogo por família de produto: gasto em anúncios × vendas reais da Shopify.
-- Gasto do anúncio vai para a família pelo nome do anúncio:
--   1. código entre parênteses, ex.: "Criativo 03 (AP0091)" ou "(AP0091-c)";
--   2. tag antiga de 3 letras do dash anterior, ex.: "(EUS)", pela tabela anuncio_tag_familia;
--   3. "(ALL)" = anúncio genérico (home/coleções); o resto fica "sem família".
-- Vendas: valor das linhas dos pedidos (com desconto), por família do produto, sem cancelados.

create table public.anuncio_tag_familia (
  store   text not null,
  tag     text not null check (tag ~ '^[A-Z]{3}$'),
  familia text not null references public.produto_familias(familia) on update cascade,
  primary key (store, tag)
);
alter table public.anuncio_tag_familia enable row level security;
create policy "time le" on public.anuncio_tag_familia for select to authenticated using ((select public.is_allowed()));
create policy "admin edita" on public.anuncio_tag_familia for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Ligação feita pelos pedidos que vieram de anúncios com cada tag (família mais comprada) e pelo nome do produto.
insert into public.anuncio_tag_familia values
  ('abrasso','VSG','AB0072'),('abrasso','VVA','AB0086'),
  ('aphago','DMD','AP0117'),('aphago','EUS','AP0151'),('aphago','MCU','AP0090'),('aphago','MPN','AP0276'),
  ('aphago','OAA','AP0329'),('aphago','OYU','AP0210'),('aphago','NEM','AP0343'),('aphago','EVP','AP0227'),
  ('aphago','MPS','AP0107'),('aphago','MPQ','AP0086'),('aphago','PEA','AP0289'),('aphago','SPB','AP0317'),
  ('aphago','SUP','AP0049'),('aphago','BTL','AP0172')
on conflict do nothing;

create or replace function public.familia_do_anuncio(p_store text, p_nome text)
returns text language sql stable set search_path = '' as $$
  select coalesce(
    (select f.familia from public.produto_familias f
     where f.store = p_store and f.familia = substring(upper(coalesce(p_nome, '')) from '\(((?:AP|AB)\d{4})(?:-[A-Z])?\)')),
    (select t.familia from public.anuncio_tag_familia t
     where t.store = p_store and t.tag = substring(upper(coalesce(p_nome, '')) from '\(([A-Z]{3})\)')),
    case when upper(coalesce(p_nome, '')) ~ '\(ALL\)' then 'ALL' end
  );
$$;

create or replace function public.catalogo_familias(p_store text, p_inicio date, p_fim date)
returns jsonb language sql stable set search_path = '' as $$
with gasto as (
  select public.familia_do_anuncio(a.store, a.ad_name) as familia, a.day as dia, a.ad_id,
         a.spend, a.clicks, a.impressions, a.platform_purchases, a.platform_revenue
  from public.ad_spend a
  where a.store = p_store and a.platform = 'meta' and a.day between p_inicio and p_fim
),
venda as (
  select c.familia, c.letra, (o.created_at at time zone 'America/Sao_Paulo')::date as dia, i.order_id, i.quantity, i.amount,
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
linhas as (
  select f.familia, f.nome, f.imagem, f.modelos, coalesce(g.anuncios, 0) as anuncios, coalesce(g.gasto, 0) as gasto,
         coalesce(g.cliques, 0) as cliques, coalesce(g.impressoes, 0) as impressoes, coalesce(g.compras_meta, 0) as compras_meta,
         coalesce(g.receita_meta, 0) as receita_meta, coalesce(v.unidades, 0) as unidades, coalesce(v.receita, 0) as receita,
         coalesce(v.pedidos, 0) as pedidos, coalesce(v.pedidos_novos, 0) as pedidos_novos
  from fam f left join g using (familia) left join v using (familia)
  where coalesce(g.gasto, 0) > 0 or coalesce(v.receita, 0) > 0
),
top as (select familia from linhas order by receita + gasto desc limit 8)
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
  'familia_modelos', coalesce((
    select jsonb_agg(x) from (
      select familia, letra, sum(quantity) as unidades, sum(amount) as receita from venda group by familia, letra
    ) x), '[]'::jsonb),
  'dias', coalesce((
    select jsonb_agg(x order by x.dia) from (
      select d::date as dia, t.familia,
             coalesce((select sum(amount) from venda v where v.familia = t.familia and v.dia = d::date), 0) as receita,
             coalesce((select sum(spend) from gasto g2 where g2.familia = t.familia and g2.dia = d::date), 0) as gasto
      from generate_series(p_inicio, p_fim, interval '1 day') d cross join top t
    ) x), '[]'::jsonb),
  'canais', coalesce((
    select jsonb_agg(x) from (
      select v.familia, a.canal, a.grupo, sum(v.amount * a.peso) as valor
      from venda v join public.atribuicao a on a.order_id = v.order_id and a.modelo = 'linear'
      group by v.familia, a.canal, a.grupo
    ) x), '[]'::jsonb)
);
$$;
grant execute on function public.familia_do_anuncio(text, text) to authenticated;
grant execute on function public.catalogo_familias(text, date, date) to authenticated;
