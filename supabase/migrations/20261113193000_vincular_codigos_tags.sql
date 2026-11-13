-- Depois de cada leitura do catálogo: produto novo que já veio com a tag de código (ex.: criado pelo Grok)
-- entra na lista de códigos. Produto sem tag não ganha número sozinho (isso fica no botão "Incluir produtos novos").
create or replace function public.vincular_codigos_tags()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.produto_codigos (product_id, store, familia, letra, origem)
  select p.product_id, p.store, f.familia,
         coalesce((select right(t, 1) from unnest(p.tags) t where t ~ ('^' || f.familia || '-[a-p]$') limit 1),
                  public.letra_do_produto(p.product_type, p.title), 'a'),
         'existente'
  from public.products p
  join public.produto_familias f on f.store = p.store and p.tags @> array[f.familia]
  where p.status <> 'ARCHIVED'
    and not exists (select 1 from public.produto_codigos c where c.product_id = p.product_id)
  on conflict (product_id) do nothing;
  get diagnostics n = row_count;
  perform public.conferir_lancamentos();
  return n;
end $$;
revoke execute on function public.vincular_codigos_tags() from public, anon, authenticated;
grant execute on function public.vincular_codigos_tags() to service_role;
