-- Anúncios ligados no Meta (status efetivo ACTIVE: anúncio, conjunto e campanha ligados), atualizados a cada coleta.
-- O catálogo mostra, por família, quantos anúncios gastaram no período e quantos estão ligados agora.
alter table public.meta_anuncios
  add column ligado     boolean not null default false,
  add column destino_em timestamptz;
update public.meta_anuncios set destino_em = atualizado_em;

-- anúncios ainda sem o link de destino: os que gastaram e os ligados que ainda não foram consultados
create or replace function public.anuncios_sem_destino(p_store text, p_limite int default 500)
returns table (ad_id text, account_id text) language sql stable set search_path = '' as $$
  select x.ad_id, x.account_id from (
    select a.ad_id, min(a.account_id) as account_id, sum(a.spend) as gasto
    from public.ad_spend a
    where a.store = p_store and a.platform = 'meta' and a.ad_id <> ''
      and not exists (select 1 from public.meta_anuncios m where m.ad_id = a.ad_id and m.destino_em is not null)
    group by a.ad_id
    union
    select m.ad_id, m.account_id, 0 from public.meta_anuncios m
    where m.store = p_store and m.destino_em is null
      and not exists (select 1 from public.ad_spend a where a.ad_id = m.ad_id)
  ) x
  order by x.gasto desc
  limit p_limite;
$$;
revoke execute on function public.anuncios_sem_destino(text, int) from public, anon, authenticated;

do $do$
declare d text;
begin
  d := pg_get_functiondef('public.catalogo_familias(text, date, date)'::regprocedure);
  d := replace(d, 'v as (
  select familia, sum(quantity)',
                  'lig as (
  select public.familia_do_anuncio(p_store, m.nome, m.ad_id) as familia, count(*) as ligados
  from public.meta_anuncios m where m.store = p_store and m.ligado group by 1
),
v as (
  select familia, sum(quantity)');
  d := replace(d, 'coalesce(v.pedidos, 0) as pedidos, coalesce(v.pedidos_novos, 0) as pedidos_novos
  from fam f left join g using (familia) left join v using (familia)
  where coalesce(g.gasto, 0) > 0 or coalesce(v.receita, 0) > 0',
                  'coalesce(v.pedidos, 0) as pedidos, coalesce(v.pedidos_novos, 0) as pedidos_novos,
         coalesce(lig.ligados, 0) as anuncios_ligados
  from fam f left join g using (familia) left join v using (familia) left join lig using (familia)
  where coalesce(g.gasto, 0) > 0 or coalesce(v.receita, 0) > 0 or coalesce(lig.ligados, 0) > 0');
  if position('anuncios_ligados' in d) = 0 or position('lig as (' in d) = 0 then raise exception 'catalogo_familias: trecho não encontrado'; end if;
  execute d;
end
$do$;
