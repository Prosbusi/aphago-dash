-- Área "Time": tarefas da equipe, criação de produtos e chuva de ideias (vindas do Fazeno).
-- Os ids são uuid para receber os dados do Fazeno com os mesmos ids.
-- Código dos produtos (AP0001, AB0001…): só existe o que veio do Fazeno.
-- Produto novo cadastrado aqui fica SEM código até a nomenclatura ser definida.

-- =========================================================
-- Equipe e etiquetas
-- =========================================================
create table public.equipe (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text unique,            -- liga a pessoa ao login (allowed_users.email)
  discord_id text,              -- para marcar a pessoa nos avisos do Discord
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.equipe is 'Pessoas do time. Tarefas são atribuídas a uma pessoa, com ou sem login.';

create table public.etiquetas (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  cor text not null default 'green' check (cor in ('green', 'yellow', 'red', 'blue', 'violet')),
  created_at timestamptz not null default now()
);

-- =========================================================
-- Tarefas
-- =========================================================
create table public.tarefas (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid references public.equipe(id) on delete set null,
  titulo text not null default '',
  descricao text not null default '',
  prazo date,
  link text,
  imagens text[] not null default '{}',
  etiquetas text[] not null default '{}',
  concluida boolean not null default false,
  concluida_em timestamptz,
  criado_por text,              -- e-mail de quem criou
  created_at timestamptz not null default now()
);
create index tarefas_pessoa_prazo_idx on public.tarefas (pessoa_id, prazo);

create or replace function public.tarefa_conclusao() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- importação pode trazer a data original; cadastro novo marca agora
    if new.concluida then new.concluida_em := coalesce(new.concluida_em, now()); else new.concluida_em := null; end if;
  elsif new.concluida and not old.concluida then new.concluida_em := now();
  elsif not new.concluida then new.concluida_em := null;
  else new.concluida_em := old.concluida_em;
  end if;
  return new;
end $$;
create trigger tarefa_conclusao before insert or update on public.tarefas
  for each row execute function public.tarefa_conclusao();

-- =========================================================
-- Criação de produtos
-- =========================================================
create table public.colecoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_por text,
  created_at timestamptz not null default now()
);

create table public.modelos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  posicao int not null default 100,
  created_at timestamptz not null default now()
);

create table public.produtos_criacao (
  id uuid primary key default gen_random_uuid(),
  marca text not null check (marca in ('AP', 'AB')),
  codigo text unique,           -- só os códigos que vieram do Fazeno; novos ficam vazios
  nome text not null,
  descricao text not null default '',
  imagens text[] not null default '{}',
  modelos uuid[] not null default '{}',
  cores text[] not null default '{}',
  checks text[] not null default '{}',
  colecao_id uuid references public.colecoes(id) on delete set null,
  prazo date,
  cancelado boolean not null default false,
  shopify_product_id text,      -- para ligar ao catálogo (products) e medir vendas depois
  criado_por text,
  created_at timestamptz not null default now()
);
comment on column public.produtos_criacao.codigo is 'Código do Fazeno (AP0001…). O site não cria nem altera códigos.';

-- O site nunca cria nem muda código; marca não muda depois do cadastro.
create or replace function public.produto_criacao_protege() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.codigo := null;
      new.created_at := now();
    else
      new.codigo := old.codigo;
      new.marca := old.marca;
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end $$;
create trigger produto_criacao_protege before insert or update on public.produtos_criacao
  for each row execute function public.produto_criacao_protege();

create table public.ideias (
  id uuid primary key default gen_random_uuid(),
  marca text not null default 'AP' check (marca in ('AP', 'AB', 'BOTH')),
  descricao text not null default '',
  imagens text[] not null default '{}',
  temas text[] not null default '{}',
  produto_id uuid references public.produtos_criacao(id) on delete set null,
  criado_por text,
  created_at timestamptz not null default now()
);

-- Transforma a ideia em produto uma vez só (repetir devolve o mesmo produto).
create or replace function public.converter_ideia(p_ideia uuid, p_campos jsonb)
returns public.produtos_criacao
language plpgsql security invoker set search_path = '' as $$
declare
  ideia public.ideias;
  novo public.produtos_criacao;
begin
  if not public.is_allowed() then raise exception 'Sem acesso'; end if;
  select * into ideia from public.ideias where id = p_ideia for update;
  if not found then raise exception 'Ideia não encontrada'; end if;
  if ideia.produto_id is not null then
    select * into novo from public.produtos_criacao where id = ideia.produto_id;
    return novo;
  end if;
  if coalesce(p_campos ->> 'marca', '') not in ('AP', 'AB') or coalesce(length(trim(p_campos ->> 'nome')), 0) = 0 then
    raise exception 'Informe marca e nome do produto';
  end if;
  insert into public.produtos_criacao (marca, nome, descricao, imagens, modelos, cores, colecao_id, prazo, criado_por)
  values (
    p_campos ->> 'marca',
    trim(p_campos ->> 'nome'),
    coalesce(p_campos ->> 'descricao', ''),
    array(select jsonb_array_elements_text(coalesce(p_campos -> 'imagens', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(p_campos -> 'modelos', '[]'::jsonb))::uuid),
    array(select jsonb_array_elements_text(coalesce(p_campos -> 'cores', '[]'::jsonb))),
    nullif(p_campos ->> 'colecao_id', '')::uuid,
    nullif(p_campos ->> 'prazo', '')::date,
    lower(coalesce((select auth.jwt()) ->> 'email', ''))
  ) returning * into novo;
  update public.ideias set produto_id = novo.id where id = ideia.id;
  return novo;
end $$;
revoke all on function public.converter_ideia(uuid, jsonb) from public;
grant execute on function public.converter_ideia(uuid, jsonb) to authenticated;

-- =========================================================
-- Acesso: todo o time (allowed_users) lê e edita; equipe só admin edita
-- =========================================================
grant select, insert, update, delete on public.etiquetas, public.tarefas, public.colecoes,
  public.modelos, public.produtos_criacao, public.ideias to authenticated;
grant select, insert, update on public.equipe to authenticated;

alter table public.equipe enable row level security;
alter table public.etiquetas enable row level security;
alter table public.tarefas enable row level security;
alter table public.colecoes enable row level security;
alter table public.modelos enable row level security;
alter table public.produtos_criacao enable row level security;
alter table public.ideias enable row level security;

create policy "time le" on public.equipe for select to authenticated using ((select public.is_allowed()));
create policy "admin edita" on public.equipe for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "time edita" on public.etiquetas        for all to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "time edita" on public.tarefas          for all to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "time edita" on public.colecoes         for all to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "time edita" on public.modelos          for all to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "time edita" on public.produtos_criacao for all to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "time edita" on public.ideias           for all to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));

-- =========================================================
-- Imagens (privadas; o site mostra por link temporário)
-- =========================================================
insert into storage.buckets (id, name, public) values ('time', 'time', false) on conflict (id) do nothing;
create policy "time le imagens" on storage.objects for select to authenticated
  using (bucket_id = 'time' and (select public.is_allowed()));
create policy "time envia imagens" on storage.objects for insert to authenticated
  with check (bucket_id = 'time' and (select public.is_allowed()));
create policy "time apaga imagens" on storage.objects for delete to authenticated
  using (bucket_id = 'time' and (select public.is_allowed()));
