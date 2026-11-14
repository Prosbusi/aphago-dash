-- Gasto do anúncio vai para a família por esta ordem:
--   1. código no nome, ex.: "Criativo 03 (AP0090)";  2. tag antiga de 3 letras no nome, ex.: "(MCU)";  3. "(ALL)" no nome;
--   4. link de destino do anúncio: /products/<handle> → família do produto;  5. destino na home ou em coleção → Genérico (ALL).
-- O link de destino vem do criativo do anúncio (coleta do Meta, permissão ads_read).

create table public.meta_anuncios (
  ad_id         text primary key,
  store         text,
  account_id    text,
  nome          text,
  link          text,                -- link de destino do criativo
  handle        text generated always as (lower(substring(link from '/products/([^/?#]+)'))) stored,
  atualizado_em timestamptz not null default now()
);
alter table public.meta_anuncios enable row level security;
create policy "time le" on public.meta_anuncios for select to authenticated using ((select public.is_allowed()));

create or replace function public.familia_do_anuncio(p_store text, p_nome text, p_ad_id text)
returns text language sql stable set search_path = '' as $$
  select coalesce(
    public.familia_do_anuncio(p_store, p_nome),
    (select c.familia from public.meta_anuncios m
       join public.products p on p.store = p_store and p.handle = m.handle
       join public.produto_codigos c using (product_id)
     where m.ad_id = p_ad_id and m.handle is not null limit 1),
    (select 'ALL' from public.meta_anuncios m
     where m.ad_id = p_ad_id and m.link is not null and m.handle is null
       and m.link ~* '^https?://[^/]+(/(pages/[^/]+|collections(/[^/?#]*)?)?)?/?([?#].*)?$')
  );
$$;
grant execute on function public.familia_do_anuncio(text, text, text) to authenticated;

-- Anúncios com gasto que ainda não têm o destino coletado (a coleta usa esta lista)
create or replace function public.anuncios_sem_destino(p_store text, p_limite int default 500)
returns table (ad_id text, account_id text) language sql stable set search_path = '' as $$
  select a.ad_id, min(a.account_id)
  from public.ad_spend a
  where a.store = p_store and a.platform = 'meta' and a.ad_id <> ''
    and not exists (select 1 from public.meta_anuncios m where m.ad_id = a.ad_id)
  group by a.ad_id
  order by sum(a.spend) desc
  limit p_limite;
$$;
revoke execute on function public.anuncios_sem_destino(text, int) from public, anon, authenticated;

-- Catálogo passa a usar nome + link de destino
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.catalogo_familias(text, date, date)'::regprocedure);
  d := replace(d, 'public.familia_do_anuncio(a.store, a.ad_name) as familia', 'public.familia_do_anuncio(a.store, a.ad_name, a.ad_id) as familia');
  if position('a.ad_name, a.ad_id' in d) = 0 then raise exception 'catalogo_familias: trecho não encontrado'; end if;
  execute d;
end
$do$;
