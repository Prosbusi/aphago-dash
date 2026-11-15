-- O link de destino do anúncio passa a valer antes da tag antiga de 3 letras.
-- Ordem: 1. código no nome (AP0090); 2. link /products/<handle>; 3. tag antiga (MCU) ou (ALL) no nome; 4. home ou coleção = ALL.
-- Motivo: tags antigas apontavam para a família errada (ex.: MPS ia para "Exclusivo Para o Melhor Professor",
-- mas os anúncios levam para "Meu Primeiro Mestre").
create or replace function public.familia_do_anuncio(p_store text, p_nome text, p_ad_id text)
returns text language sql stable set search_path = '' as $$
  select coalesce(
    (select f.familia from public.produto_familias f
     where f.store = p_store and f.familia = substring(upper(coalesce(p_nome, '')) from '\(((?:AP|AB)\d{4})(?:-[A-Z])?\)')),
    (select c.familia from public.meta_anuncios m
       join public.products p on p.store = p_store and p.handle = m.handle
       join public.produto_codigos c using (product_id)
     where m.ad_id = p_ad_id and m.handle is not null limit 1),
    public.familia_do_anuncio(p_store, p_nome),
    (select 'ALL' from public.meta_anuncios m
     where m.ad_id = p_ad_id and m.link is not null and m.handle is null
       and m.link ~* '^https?://[^/]+(/(pages/[^/]+|collections(/[^/?#]*)?)?)?/?([?#].*)?$')
  );
$$;

-- tags corrigidas pelo destino dos anúncios
update public.anuncio_tag_familia set familia = 'AP0316' where store = 'aphago' and tag in ('MPS', 'MPQ');
