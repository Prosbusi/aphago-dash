-- Modelo "Inteligente" (antes "Em U"): pesos por etapa da jornada, editáveis pelo time.
-- primeiro canal / canais do meio (divididos igualmente) / último canal. Somam 100.
-- Com 2 canais, o peso do meio é repartido na proporção primeiro:último (40/40 -> 50/50). Com 1 canal, 100%.
-- Também: no último clique, uma última visita de checkout ou interna é classificada pelas UTMs dela
-- (antes virava Direto), para bater com a tela antiga.

create table public.atribuicao_config (
  id            boolean primary key default true check (id),
  peso_primeiro numeric(5,2) not null default 40 check (peso_primeiro >= 0),
  peso_meio     numeric(5,2) not null default 20 check (peso_meio >= 0),
  peso_ultimo   numeric(5,2) not null default 40 check (peso_ultimo >= 0),
  updated_at    timestamptz not null default now(),
  check (peso_primeiro + peso_meio + peso_ultimo = 100)
);
insert into public.atribuicao_config default values;
alter table public.atribuicao_config enable row level security;
create policy "time le" on public.atribuicao_config for select to authenticated using ((select public.is_allowed()));
create policy "time edita" on public.atribuicao_config for update to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));
create trigger atribuicao_config_recalcula after update on public.atribuicao_config
  for each statement execute function public.marcar_recalculo();

do $do$
declare d text;
begin
  d := pg_get_functiondef('public.atribuir_pedido(text)'::regprocedure);
  -- pesos do modelo inteligente (em_u)
  d := replace(d,
    $a$when 'em_u' then case when v_n = 1 then 1.0 when v_n = 2 then 0.5
                                    when c.idx in (1, v_n) then 0.4 else 0.2 / (v_n - 2) end$a$,
    $b$when 'em_u' then case when v_n = 1 then 1.0
                                    when v_n = 2 then case when c.idx = 1 then cfg.pp else cfg.pu end / nullif(cfg.pp + cfg.pu, 0)
                                    when c.idx = 1 then cfg.pp / 100 when c.idx = v_n then cfg.pu / 100
                                    else cfg.pm / 100 / (v_n - 2) end$b$);
  d := replace(d,
    $a$cross join (values ('linear'), ('em_u'), ('primeiro')) m(modelo)$a$,
    $b$cross join (values ('linear'), ('em_u'), ('primeiro')) m(modelo)
    cross join (select peso_primeiro as pp, peso_meio as pm, peso_ultimo as pu from public.atribuicao_config limit 1) cfg$b$);
  -- último clique: visita de checkout/interna classificada só pelas UTMs
  d := replace(d,
    $a$from public.canal_visita(o.last_source, o.last_medium, o.last_campaign, o.last_content, o.last_source_label, null, o.last_landing_page, o.last_referrer) c;$a$,
    $b$from public.canal_visita(o.last_source, o.last_medium, o.last_campaign, o.last_content, o.last_source_label, null, o.last_landing_page, o.last_referrer) c0
  cross join lateral public.canal_visita(o.last_source, o.last_medium, o.last_campaign, o.last_content, o.last_source_label, null,
    case when c0.canal = '(ignorar)' then null else o.last_landing_page end,
    case when c0.canal = '(ignorar)' then null else o.last_referrer end) c;$b$);
  if position('cfg.pp' in d) = 0 or position('c0.canal' in d) = 0 then
    raise exception 'atribuir_pedido: trecho esperado não encontrado';
  end if;
  execute d;
end
$do$;

-- a tela mostra os pesos atuais
create or replace function public.atribuicao_pesos()
returns jsonb language sql stable set search_path = '' as $$
  select to_jsonb(c) - 'id' from public.atribuicao_config c limit 1;
$$;
grant execute on function public.atribuicao_pesos() to authenticated;

update public.atribuicao_pedido set atribuido_em = '-infinity';
