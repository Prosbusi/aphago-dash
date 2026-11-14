-- Marketing do dia (anúncios + e-mail + push + outros custos fixos) e projeção diária comparada ao ano anterior.

-- 1. Custos de marketing que não vêm de plataforma de anúncio: e-mail (fatura da Shopify), push (mensalidade), outros.
--    O valor mensal é dividido pelos dias do mês. Para a fatura de e-mail de um mês, use desde = dia 1 e ate = último dia.
create table public.custos_marketing (
  id           bigint generated always as identity primary key,
  store        text not null references public.stores (store),
  tipo         text not null check (tipo in ('email', 'push', 'outro')),
  descricao    text,
  valor_mensal numeric(12, 2) not null check (valor_mensal >= 0),
  desde        date not null,
  ate          date,
  criado_em    timestamptz not null default now(),
  check (ate is null or ate >= desde)
);
alter table public.custos_marketing enable row level security;
create policy "time le" on public.custos_marketing for select to authenticated using ((select public.is_allowed()));
create policy "admin edita" on public.custos_marketing for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.custos_marketing (store, tipo, descricao, valor_mensal, desde)
values ('aphago', 'push', 'Mensalidade do push', 297, '2026-01-01');

-- 2. Gasto diário por plataforma antes da coleta detalhada (histórico do ano anterior, nível de conta).
--    Só é usado nos dias em que o ad_spend não tem nada daquela plataforma.
create table public.gasto_historico (
  store         text not null,
  dia           date not null,
  platform      text not null,
  gasto         numeric(12, 2) not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (store, dia, platform)
);
alter table public.gasto_historico enable row level security;
create policy "time le" on public.gasto_historico for select to authenticated using ((select public.is_allowed()));

-- 3. Vendas e custo de produto por dia, direto da Shopify (pedidos pagos), para os dois anos com a mesma regra.
--    custo_linhas = custo das linhas cujo produto ainda tem custo cadastrado; as linhas sem custo (variante apagada
--    ou sem custo) recebem a mesma proporção custo/venda do dia.
create table public.vendas_diarias (
  store              text not null,
  dia                date not null,
  vendas             numeric(12, 2) not null default 0,
  pedidos            int not null default 0,
  unidades           int not null default 0,
  custo_linhas       numeric(12, 2) not null default 0,
  receita_com_custo  numeric(12, 2) not null default 0,
  receita_sem_custo  numeric(12, 2) not null default 0,
  atualizado_em      timestamptz not null default now(),
  primary key (store, dia)
);
alter table public.vendas_diarias enable row level security;
create policy "time le" on public.vendas_diarias for select to authenticated using ((select public.is_allowed()));

create or replace function public.custo_produto_dia(v public.vendas_diarias)
returns numeric language sql immutable set search_path = '' as $$
  select v.custo_linhas + case when v.receita_com_custo > 0 then v.receita_sem_custo * v.custo_linhas / v.receita_com_custo else 0 end;
$$;

-- 4. Marketing por dia: Meta, Google e outras plataformas + e-mail, push e outros custos fixos.
create or replace function public.marketing_diario(p_store text, p_inicio date, p_fim date)
returns table (dia date, meta numeric, google numeric, outras_plataformas numeric, email numeric, push numeric, outros numeric, total numeric)
language sql stable set search_path = '' as $$
  with d as (select g::date as dia from generate_series(p_inicio, p_fim, interval '1 day') g),
  ads as (
    select a.day as dia, a.platform, sum(a.spend) as v
    from public.ad_spend a where a.store = p_store and a.day between p_inicio and p_fim group by 1, 2
  ),
  hist as (
    select h.dia, h.platform, h.gasto as v
    from public.gasto_historico h
    where h.store = p_store and h.dia between p_inicio and p_fim
      and not exists (select 1 from ads where ads.dia = h.dia and ads.platform = h.platform)
  ),
  plat as (select * from ads union all select * from hist),
  fixos as (
    select d.dia, c.tipo, sum(c.valor_mensal / extract(day from (date_trunc('month', d.dia) + interval '1 month - 1 day'))) as v
    from d join public.custos_marketing c on c.store = p_store and d.dia >= c.desde and (c.ate is null or d.dia <= c.ate)
    group by 1, 2
  ),
  x as (
    select d.dia,
      coalesce((select sum(v) from plat where plat.dia = d.dia and plat.platform = 'meta'), 0) as meta,
      coalesce((select sum(v) from plat where plat.dia = d.dia and plat.platform = 'google'), 0) as google,
      coalesce((select sum(v) from plat where plat.dia = d.dia and plat.platform not in ('meta', 'google')), 0) as outras_plataformas,
      coalesce((select sum(v) from fixos f where f.dia = d.dia and f.tipo = 'email'), 0) as email,
      coalesce((select sum(v) from fixos f where f.dia = d.dia and f.tipo = 'push'), 0) as push,
      coalesce((select sum(v) from fixos f where f.dia = d.dia and f.tipo = 'outro'), 0) as outros
    from d
  )
  select x.dia, round(x.meta, 2), round(x.google, 2), round(x.outras_plataformas, 2), round(x.email, 2), round(x.push, 2), round(x.outros, 2),
         round(x.meta + x.google + x.outras_plataformas + x.email + x.push + x.outros, 2)
  from x order by x.dia;
$$;
grant execute on function public.marketing_diario(text, date, date) to authenticated;

-- 5. Projeção diária: 7 dias atrás, hoje e 7 dias à frente, comparados à mesma data do ano anterior.
--    Lucro segue a mesma conta da planilha de lucro (Fazeno): vendas − produto − marketing − imposto sobre o Meta (13,82%)
--    − gateway (3,5% das vendas) − apps (5% das vendas) − imposto (14% do lucro bruto).
create or replace function public.projecao_diaria(p_store text, p_hoje date default null)
returns jsonb language sql stable set search_path = '' as $$
  with base as (select coalesce(p_hoje, (now() at time zone 'America/Sao_Paulo')::date) as hoje),
  dias as (
    select (b.hoje + i) as dia, (b.hoje + i - interval '1 year')::date as dia_ant, i
    from base b, generate_series(-7, 7) i
  ),
  mk as (
    select * from public.marketing_diario(p_store, (select hoje - 7 from base), (select hoje + 7 from base))
    union all
    select * from public.marketing_diario(p_store, (select (hoje - 7 - interval '1 year')::date from base), (select (hoje + 7 - interval '1 year')::date from base))
  ),
  v as (
    select vd.dia, vd.vendas, vd.pedidos, public.custo_produto_dia(vd) as custo
    from public.vendas_diarias vd
    where vd.store = p_store
      and (vd.dia between (select hoje - 7 from base) and (select hoje + 7 from base)
        or vd.dia between (select (hoje - 7 - interval '1 year')::date from base) and (select (hoje + 7 - interval '1 year')::date from base))
  ),
  linha as (
    select d.dia, d.dia_ant, d.i,
      coalesce(va.vendas, 0) as vendas, coalesce(va.pedidos, 0) as pedidos, coalesce(va.custo, 0) as custo,
      coalesce(ma.total, 0) as marketing, coalesce(ma.meta, 0) as meta,
      coalesce(vb.vendas, 0) as vendas_ant, coalesce(vb.pedidos, 0) as pedidos_ant, coalesce(vb.custo, 0) as custo_ant,
      coalesce(mb.total, 0) as marketing_ant, coalesce(mb.meta, 0) as meta_ant,
      va.dia is not null as tem_vendas, vb.dia is not null as tem_vendas_ant
    from dias d
    left join v va on va.dia = d.dia
    left join v vb on vb.dia = d.dia_ant
    left join mk ma on ma.dia = d.dia
    left join mk mb on mb.dia = d.dia_ant
  ),
  calc as (
    select l.*,
      l.vendas - l.custo - l.marketing - l.meta * 0.1382 - l.vendas * 0.035 - l.vendas * 0.05
        - 0.14 * (l.vendas - l.custo - l.marketing) as lucro,
      l.vendas_ant - l.custo_ant - l.marketing_ant - l.meta_ant * 0.1382 - l.vendas_ant * 0.035 - l.vendas_ant * 0.05
        - 0.14 * (l.vendas_ant - l.custo_ant - l.marketing_ant) as lucro_ant
    from linha l
  )
  select jsonb_build_object(
    'hoje', (select hoje from base),
    'atualizado_em', (select max(atualizado_em) from public.vendas_diarias where store = p_store),
    'historico_desde', (select min(dia) from public.vendas_diarias where store = p_store),
    'dias', coalesce((select jsonb_agg(jsonb_build_object(
        'dia', c.dia, 'dia_ant', c.dia_ant, 'offset', c.i,
        'vendas', round(c.vendas, 2), 'pedidos', c.pedidos, 'custo', round(c.custo, 2), 'marketing', round(c.marketing, 2), 'lucro', round(c.lucro, 2),
        'vendas_ant', round(c.vendas_ant, 2), 'pedidos_ant', c.pedidos_ant, 'custo_ant', round(c.custo_ant, 2), 'marketing_ant', round(c.marketing_ant, 2),
        'lucro_ant', round(c.lucro_ant, 2), 'tem_vendas_ant', c.tem_vendas_ant
      ) order by c.dia) from calc c), '[]'::jsonb)
  );
$$;
grant execute on function public.projecao_diaria(text, date) to authenticated;

-- 6. Retorno passa a somar todo o marketing (e-mail, push e custos fixos entram em "outros").
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.retorno(text, date, date)'::regprocedure);
  d := replace(d,
    $a$'investimento', (select coalesce(sum(spend), 0) from gasto),$a$,
    $a$'investimento', (select coalesce(sum(spend), 0) from gasto),
  'marketing', (select jsonb_build_object('total', coalesce(sum(m.total), 0), 'meta', coalesce(sum(m.meta), 0), 'google', coalesce(sum(m.google), 0),
                 'outras_plataformas', coalesce(sum(m.outras_plataformas), 0), 'email', coalesce(sum(m.email), 0), 'push', coalesce(sum(m.push), 0),
                 'outros', coalesce(sum(m.outros), 0)) from public.marketing_diario(p_store, p_inicio, p_fim) m),$a$);
  d := replace(d,
    $a$select d::date as dia, coalesce(g.meta, 0) as meta, coalesce(g.google, 0) as google, coalesce(g.outros, 0) as outros,$a$,
    $a$select d::date as dia, coalesce(g.meta, 0) as meta, coalesce(g.google, 0) as google,
             coalesce(g.outros, 0) + coalesce((select m.email + m.push + m.outros from public.marketing_diario(p_store, d::date, d::date) m), 0) as outros,$a$);
  if position('marketing_diario(p_store, d::date' in d) = 0 or position($a$'marketing', (select$a$ in d) = 0 then
    raise exception 'retorno: trecho não encontrado';
  end if;
  execute d;
end
$do$;
