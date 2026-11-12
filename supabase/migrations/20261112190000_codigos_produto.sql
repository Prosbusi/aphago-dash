-- Códigos de produto: família AP0000 (Aphago) / AB0000 (Abrasso) + letra do modelo.
-- a Camiseta, b Algodão Peruano, c Oversized, d Suéter, e Hoodie (e Moletom), f Moletom Cropped, g Cropped, h Regata,
-- i Body, j Mini (e Infantil), k Caneca, l Quadro, m Poster, n Capa de Mala, o Camiseta Frente e Verso, p Oversized Frente e Verso.
-- Gravado na Shopify como duas tags: AP0006 (família) e AP0006-c (produto). A atribuição de gasto e vendas usa a família.

create table public.produto_letras (
  letra text primary key check (letra ~ '^[a-z]$'),
  modelo text not null
);
insert into public.produto_letras values
  ('a','Camiseta'),('b','Algodão Peruano'),('c','Oversized'),('d','Suéter'),('e','Hoodie'),('f','Moletom Cropped'),
  ('g','Cropped'),('h','Regata'),('i','Body'),('j','Mini'),('k','Caneca'),('l','Quadro'),('m','Poster'),
  ('n','Capa de Mala'),('o','Camiseta Frente e Verso'),('p','Oversized Frente e Verso');

create table public.produto_familias (
  familia    text primary key check (familia ~ '^(AP|AB)\d{4}$'),
  store      text not null,
  nome       text not null,
  origem     text not null check (origem in ('existente', 'novo')),
  criada_em  timestamptz,
  updated_at timestamptz not null default now()
);

create table public.produto_codigos (
  product_id  text primary key,
  store       text not null,
  familia     text not null references public.produto_familias(familia) on update cascade,
  letra       text not null references public.produto_letras(letra),
  codigo      text generated always as (familia || '-' || letra) stored,
  origem      text not null check (origem in ('existente', 'corrigido', 'novo')),
  revisar     text,                       -- motivo para conferir antes de gravar
  gravado_em  timestamptz,                -- quando as tags foram gravadas na Shopify
  updated_at  timestamptz not null default now()
);
create index on public.produto_codigos (familia);

-- Números já usados ou reservados no Fazeno que não podem ser dados a outra família.
create table public.produto_codigos_reservados (familia text primary key, motivo text);
insert into public.produto_codigos_reservados values
  ('AP0002','sem pasta na esteira'),('AP0003','sem pasta na esteira'),('AP0004','sem pasta na esteira'),
  ('AB0001','sem pasta na esteira'),('AB0002','sem pasta na esteira'),('AB0011','reservado e não usado'),('AB0014','sem uso (virou AB0021)');

alter table public.produto_letras enable row level security;
alter table public.produto_familias enable row level security;
alter table public.produto_codigos enable row level security;
alter table public.produto_codigos_reservados enable row level security;
create policy "time le" on public.produto_letras for select to authenticated using ((select public.is_allowed()));
create policy "time le" on public.produto_familias for select to authenticated using ((select public.is_allowed()));
create policy "time le" on public.produto_codigos for select to authenticated using ((select public.is_allowed()));
create policy "time le" on public.produto_codigos_reservados for select to authenticated using ((select public.is_allowed()));
create policy "admin edita" on public.produto_familias for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin edita" on public.produto_codigos for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Letra do modelo pelo tipo do produto na Shopify e pelo título.
create or replace function public.letra_do_produto(p_tipo text, p_titulo text)
returns text language sql immutable set search_path = '' as $$
  with x as (
    select translate(lower(coalesce(p_tipo, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') pt,
           translate(lower(coalesce(p_titulo, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') t
  )
  select case
    when t ~ 'frente e (verso|costas?)' and (t ~ 'oversiz' or pt ~ 'oversiz') then 'p'
    when t ~ 'frente e (verso|costas?)' then 'o'
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
    when pt ~ 'camiseta' or t ~ 'camiseta|t-?shirt|babylook' then 'a'
  end
  from x;
$$;

-- Chave da estampa: título sem modelo, tecido, cor e palavras curtas (mesma ideia da tag de 3 letras do dash antigo).
create or replace function public.chave_estampa(p_titulo text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(string_agg(distinct w, ' ' order by w), '')
  from regexp_split_to_table(
    regexp_replace(regexp_replace(translate(lower(coalesce(p_titulo, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
      '\([^)]*\)', ' ', 'g'), '[^a-z0-9 ]', ' ', 'g'), '\s+') w
  where w <> '' and w not in (
    'de','da','do','das','dos','e','a','o','as','os','em','no','na','nos','nas','um','uma','para','por','com','que','ao','aos','ate',
    'camiseta','camisetas','camisa','tshirt','t','shirt','blusa','oversized','oversize','over','babylook','cropped','crop','regata',
    'moletom','casaco','unissex','feminina','feminino','masculina','masculino','infantil','kids','adulto','manga','longa','curta',
    'algodao','peruano','peruana','premium','basica','classica','classico','tradicional','modelo','body','mini','frente','costas',
    'costa','verso','kit','edicao','versao','novo','nova','exclusivo','exclusiva','especial','quadro','quadros','caneca','canecas',
    'poster','sueter','hoodie','capuz','capa','mala','branca','branco','preta','preto','colorida','colorido','bordada','bordado',
    'cores','claras','claro','personalizada','personalizado','personalizadas','personalizados','yd','dtf');
$$;

-- Monta a proposta para os produtos (não arquivados) que ainda não têm linha em produto_codigos.
create or replace function public.propor_codigos()
returns int language plpgsql security definer set search_path = '' as $$
declare
  r record; n int := 0; prox int; pref text;
begin
  create temp table _p on commit drop as
  select p.product_id, p.store, p.title, p.created_at,
         public.letra_do_produto(p.product_type, p.title) as letra,
         public.chave_estampa(p.title) as chave,
         (select max(x) from unnest(p.tags) x where x ~ '^(AP|AB)\d{4}$') as fam_tag,
         (select max(right(x, 1)) from unnest(p.tags) x where x ~ '^(AP|AB)\d{4}-[a-z]$') as letra_tag
  from public.products p
  where p.status <> 'ARCHIVED'
    and not exists (select 1 from public.produto_codigos c where c.product_id = p.product_id);

  -- família de cada estampa: a que já aparece nas tags (a mais comum) ou a já registrada para a mesma estampa
  create temp table _fam on commit drop as
  select store, chave,
         coalesce(
           (select fam_tag from _p q where q.store = g.store and q.chave = g.chave and fam_tag is not null
            group by fam_tag order by count(*) desc, fam_tag limit 1),
           (select c.familia from public.produto_codigos c join public.products pp using (product_id)
            where c.store = g.store and public.chave_estampa(pp.title) = g.chave
            group by c.familia order by count(*) desc limit 1)
         ) as familia,
         min(created_at) as criada_em,
         (select regexp_replace(split_part(split_part(q.title, ' - ', 1), ' – ', 1), '\s+', ' ', 'g') from _p q
          where q.store = g.store and q.chave = g.chave order by length(q.title), q.title limit 1) as nome
  from _p g group by store, chave;

  -- famílias que já existem nas tags
  insert into public.produto_familias (familia, store, nome, origem, criada_em)
  select f.familia, f.store, max(f.nome), 'existente', min(f.criada_em)
  from _fam f where f.familia is not null
  group by f.familia, f.store
  on conflict (familia) do nothing;

  -- numera as estampas sem família, da mais antiga para a mais nova, pulando números usados ou reservados
  for r in select * from _fam where familia is null order by store, criada_em nulls last, nome loop
    pref := case r.store when 'aphago' then 'AP' else 'AB' end;
    select coalesce(max(substring(familia from 3)::int), 0) + 1 into prox from (
      select familia from public.produto_familias where familia like pref || '%'
      union all select familia from public.produto_codigos_reservados where familia like pref || '%'
    ) u;
    insert into public.produto_familias (familia, store, nome, origem, criada_em)
    values (pref || lpad(prox::text, 4, '0'), r.store, r.nome, 'novo', r.criada_em);
    update _fam set familia = pref || lpad(prox::text, 4, '0') where store = r.store and chave = r.chave;
  end loop;

  insert into public.produto_codigos (product_id, store, familia, letra, origem, revisar)
  select p.product_id, p.store, coalesce(p.fam_tag, f.familia), coalesce(p.letra, 'a'),
         case when p.fam_tag is null then 'novo'
              when p.letra_tag is not null and p.letra_tag = coalesce(p.letra, 'a') then 'existente'
              else 'corrigido' end,
         nullif(concat_ws('; ',
           case when p.letra is null then 'modelo não identificado (ficou a)' end,
           case when lower(p.title) ~ 'cropped e regata' then 'produto com dois modelos (cropped e regata)' end,
           case when p.fam_tag is not null and f.familia is not null and p.fam_tag <> f.familia then 'estampa igual a ' || f.familia end
         ), '')
  from _p p join _fam f on f.store = p.store and f.chave = p.chave;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.propor_codigos() from public, anon, authenticated;

select public.propor_codigos();
