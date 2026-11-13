-- Ideia curta: título + como o produto funciona (1 ou 2 frases). A pesquisa completa fica na descrição, recolhida.
alter table public.ideias add column if not exists titulo text not null default '';
alter table public.ideias add column if not exists resumo text not null default '';
update public.ideias set
  titulo = left(trim(split_part(descricao, E'\n', 1)), 120),
  resumo = left(trim(split_part(descricao, E'\n', 2)), 400)
where titulo = '';
