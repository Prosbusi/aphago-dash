-- Tela Produtos › Códigos: lista pesquisável, revisão (admin) e gravação das tags na Shopify.

create or replace view public.v_produto_codigos with (security_invoker = true) as
select c.product_id, c.store, c.familia, f.nome as familia_nome, f.origem as familia_origem, c.letra, l.modelo, c.codigo,
       c.origem, c.revisar, c.gravado_em, p.title, p.handle, p.status, p.image_url, p.online_url, p.product_type, p.created_at,
       coalesce((select array_agg(t order by t) from unnest(p.tags) t where t ~ '^(AP|AB)\d{4}(-[a-z])?$'), '{}') as tags_codigo,
       coalesce((select array_agg(t order by t) from unnest(p.tags) t where t ~ '^(AP|AB)\d{4}(-[a-z])?$'), '{}')
         is distinct from array[c.familia, c.codigo] as pendente
from public.produto_codigos c
join public.produto_familias f using (familia)
join public.produto_letras l using (letra)
join public.products p using (product_id);

-- Famílias com nomes parecidos (todas as palavras de uma estão na outra): sugestão para juntar.
create or replace function public.familias_parecidas(p_store text)
returns table (familia text, nome text, parecida text, parecida_nome text)
language sql stable set search_path = '' as $$
  with fk as (
    select c.familia, f.nome, string_to_array(min(public.chave_estampa(p.title)), ' ') ws
    from public.produto_codigos c join public.produto_familias f using (familia) join public.products p using (product_id)
    where c.store = p_store group by c.familia, f.nome
  )
  select a.familia, a.nome, b.familia, b.nome
  from fk a join fk b on a.familia <> b.familia and a.ws <@ b.ws and array_length(a.ws, 1) >= 2
  order by a.familia, b.familia;
$$;
grant execute on function public.familias_parecidas(text) to authenticated;

create or replace function public._exige_admin() returns void language plpgsql stable set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admin pode alterar códigos'; end if;
end;
$$;

-- Muda família e/ou letra de um produto. p_familia = 'nova' cria uma família nova para ele.
create or replace function public.codigo_alterar(p_product text, p_familia text, p_letra text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_store text; v_fam text := upper(trim(p_familia)); v_nome text; prox int; pref text;
begin
  perform public._exige_admin();
  select c.store, split_part(split_part(p.title, ' - ', 1), ' – ', 1) into v_store, v_nome
  from public.produto_codigos c join public.products p using (product_id) where c.product_id = p_product;
  if v_store is null then raise exception 'Produto sem código'; end if;
  pref := case v_store when 'aphago' then 'AP' else 'AB' end;
  if v_fam = 'NOVA' then
    select coalesce(max(substring(familia from 3)::int), 0) + 1 into prox from (
      select familia from public.produto_familias where familia like pref || '%'
      union all select familia from public.produto_codigos_reservados where familia like pref || '%') u;
    v_fam := pref || lpad(prox::text, 4, '0');
    insert into public.produto_familias (familia, store, nome, origem, criada_em) values (v_fam, v_store, v_nome, 'novo', now());
  elsif not exists (select 1 from public.produto_familias where familia = v_fam and store = v_store) then
    raise exception 'Família % não existe nesta loja', v_fam;
  end if;
  update public.produto_codigos set familia = v_fam, letra = lower(p_letra), origem = case when origem = 'existente' then 'corrigido' else origem end,
         revisar = null, updated_at = now()
  where product_id = p_product;
  delete from public.produto_familias f where f.origem = 'novo' and not exists (select 1 from public.produto_codigos c where c.familia = f.familia);
  return v_fam;
end;
$$;

create or replace function public.familia_renomear(p_familia text, p_nome text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._exige_admin();
  update public.produto_familias set nome = trim(p_nome), updated_at = now() where familia = p_familia;
end;
$$;

-- Junta a família p_de dentro de p_para (o número de p_de fica livre se ela era nova).
create or replace function public.familia_juntar(p_de text, p_para text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._exige_admin();
  if p_de = p_para then return; end if;
  if (select store from public.produto_familias where familia = p_de) is distinct from (select store from public.produto_familias where familia = p_para) then
    raise exception 'As duas famílias precisam ser da mesma loja';
  end if;
  update public.produto_codigos set familia = p_para, origem = case when origem = 'existente' then 'corrigido' else origem end, updated_at = now()
  where familia = p_de;
  delete from public.produto_familias where familia = p_de;
end;
$$;

-- Produtos novos (ou sem código) entram na proposta.
create or replace function public.codigos_atualizar()
returns int language plpgsql security definer set search_path = '' as $$
begin
  perform public._exige_admin();
  return public.propor_codigos();
end;
$$;

-- Grava as tags pendentes na Shopify (função codigos-shopify). A tela chama de novo enquanto houver pendentes.
create or replace function public.codigos_gravar(p_store text)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  perform public._exige_admin();
  return public.run_sync('codigos-shopify', jsonb_build_object('store', p_store));
end;
$$;

revoke execute on function public._exige_admin() from public, anon;
revoke execute on function public.codigo_alterar(text, text, text) from public, anon;
revoke execute on function public.familia_renomear(text, text) from public, anon;
revoke execute on function public.familia_juntar(text, text) from public, anon;
revoke execute on function public.codigos_atualizar() from public, anon;
revoke execute on function public.codigos_gravar(text) from public, anon;
grant execute on function public.codigo_alterar(text, text, text) to authenticated;
grant execute on function public.familia_renomear(text, text) to authenticated;
grant execute on function public.familia_juntar(text, text) to authenticated;
grant execute on function public.codigos_atualizar() to authenticated;
grant execute on function public.codigos_gravar(text) to authenticated;
grant execute on function public._exige_admin() to authenticated;
