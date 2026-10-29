-- Contas de anúncio e a loja de cada uma. Uma conta só entra na coleta se estiver aqui e ativa.
-- (Um mesmo BM/token pode enxergar contas das duas lojas.)
create table public.ad_accounts (
  platform    text not null,
  account_id  text not null,              -- sem o prefixo act_
  store       text not null references public.stores(store),
  nome        text,
  ativo       boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (platform, account_id)
);
alter table public.ad_accounts enable row level security;
create policy "time le" on public.ad_accounts for select to authenticated using ((select public.is_allowed()));
create policy "admin edita" on public.ad_accounts for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.ad_accounts from anon;

insert into public.ad_accounts (platform, account_id, store, nome) values
  ('meta',   '370931097758628',  'aphago',  'APHAGO'),
  ('meta',   '994356726032081',  'aphago',  'Aphago - Testes (Youngers)'),
  ('meta',   '2741898472679855', 'aphago',  'Aphago — Quadros'),
  ('meta',   '877249551193812',  'abrasso', 'Abrasso'),
  ('google', '2884191854',       'aphago',  'Google Ads Aphago'),
  ('google', '1652032486',       'abrasso', 'Google Ads Abrasso');
