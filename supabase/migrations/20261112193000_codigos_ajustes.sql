-- Ajustes na proposta de códigos (ainda não gravada na Shopify):
-- * fora do código: produtos de pedido avulso (título = número do pedido ou AB0000), testes e a taxa "Sua arte será ajustada";
-- * "Costas" sozinho conta como Frente e Verso (o / p);
-- * "Cropped e Regata" é um produto só, com letra g (Cropped), sem alerta.
create or replace function public.produto_sem_codigo(p_titulo text)
returns boolean language sql immutable set search_path = '' as $$
  select lower(coalesce(p_titulo, '')) ~ '^\s*(\d{6,}|ab\d{4})(\s|$)|\mteste?\M|^produto |sua arte ser|^info teste';
$$;

create or replace function public.letra_do_produto(p_tipo text, p_titulo text)
returns text language sql immutable set search_path = '' as $$
  with x as (
    select translate(lower(coalesce(p_tipo, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') pt,
           translate(lower(coalesce(p_titulo, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') t
  )
  select case
    when t ~ 'frente e (verso|costas?)|\mcostas?\M|\mfv\M' and (t ~ 'oversiz|\mov\M' or pt ~ 'oversiz') then 'p'
    when t ~ 'frente e (verso|costas?)|\mcostas?\M|\mfv\M' then 'o'
    when pt ~ 'peruano' or t ~ 'algodao peruano' then 'b'
    when pt ~ 'cropped moletom|moletom cropped' or t ~ 'moletom cropped|cropped moletom' then 'f'
    when pt ~ 'oversiz' or t ~ 'oversiz' then 'c'
    when pt ~ 'sueter' or t ~ 'sueter' then 'd'
    when pt ~ 'hoodie|moletom' or t ~ 'hoodie|moletom' then 'e'
    when pt ~ 'cropped' or t ~ 'cropped' then 'g'
    when pt ~ 'regata' or t ~ 'regata' then 'h'
    when pt ~ 'body' or t ~ '\mbody' then 'i'
    when pt ~ 'mini|infantil|inafntil' or t ~ '\mmini\M|infantil' then 'j'
    when pt ~ 'caneca' or t ~ 'caneca' then 'k'
    when pt ~ 'quadro' or t ~ 'quadro' then 'l'
    when pt ~ 'poster' or t ~ 'poster' then 'm'
    when pt ~ 'capa de mala' or t ~ 'capa de mala' then 'n'
    when pt ~ 'camiseta' or t ~ 'camiseta|t-?shirt|babylook|classica' then 'a'
  end
  from x;
$$;

-- refaz a proposta do zero
delete from public.produto_codigos;
delete from public.produto_familias;

do $do$
declare d text;
begin
  d := pg_get_functiondef('public.propor_codigos()'::regprocedure);
  d := replace(d, $a$  where p.status <> 'ARCHIVED'
    and not exists$a$, $b$  where p.status <> 'ARCHIVED' and not public.produto_sem_codigo(p.title)
    and not exists$b$);
  d := replace(d, $a$           case when lower(p.title) ~ 'cropped e regata' then 'produto com dois modelos (cropped e regata)' end,
$a$, '');
  if position('produto_sem_codigo' in d) = 0 or position('cropped e regata' in d) > 0 then
    raise exception 'propor_codigos: trecho esperado não encontrado';
  end if;
  execute d;
end
$do$;

select public.propor_codigos();
