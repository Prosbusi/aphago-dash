-- Gerador de UTM: histórico dos links criados à mão (WhatsApp, e-mail, push, orgânico)
-- Anúncios (Meta, Google, TikTok, Pinterest) preenchem as UTMs sozinhos e não passam por aqui.

create table public.utm_links (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  created_by  text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  canal       text not null,                       -- nome do canal escolhido no gerador
  destino     text not null,                       -- página de destino, sem UTM
  source      text not null check (source = lower(source)),
  medium      text not null check (medium = lower(medium)),
  campaign    text not null check (campaign = lower(campaign)),
  content     text,
  term        text,
  url         text not null,                       -- link final, pronto para usar
  nota        text
);
create index on public.utm_links (created_at desc);
comment on table public.utm_links is 'Links com UTM gerados na tela Links UTM. Só histórico: a classificação continua vindo de channel_map e action_map.';

alter table public.utm_links enable row level security;
create policy "time le"    on public.utm_links for select to authenticated using ((select public.is_allowed()));
create policy "time cria"  on public.utm_links for insert to authenticated
  with check ((select public.is_allowed()) and created_by = lower(coalesce((select auth.jwt()) ->> 'email', '')));
create policy "autor ou admin remove" on public.utm_links for delete to authenticated
  using ((select public.is_allowed()) and (created_by = lower(coalesce((select auth.jwt()) ->> 'email', '')) or (select public.is_admin())));

revoke all on public.utm_links from anon;
