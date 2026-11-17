-- Cupons: análise de todos os cupons da loja, cadastro das creators e comissão.
-- Base: pedidos pagos (pago, parcialmente reembolsado, reembolsado), sem cancelados.
-- Vendas do cupom = subtotal atual do pedido (produtos depois do desconto e dos estornos, sem frete),
-- o mesmo "Net Sales" que o painel antigo de creators usava para a comissão.

create table public.cupons (
  store          text not null references public.stores(store),
  codigo         text not null check (codigo = upper(codigo)),
  tipo           text not null check (tipo in ('creator', 'promocao', 'pos_venda', 'interno')),
  nome           text,
  instagram      text,
  tiktok         text,
  email          text,
  pix            text,
  comissao_pct   numeric(5, 2) not null default 10,
  comissao_desde date not null default date '2026-11-01',
  saldo_inicial  numeric(12, 2) not null default 0,
  ativo          boolean not null default true,
  obs            text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text,
  primary key (store, codigo)
);

create table public.comissoes_pagas (
  id       bigserial primary key,
  store    text not null references public.stores(store),
  codigo   text not null,
  mes      date not null check (mes = date_trunc('month', mes)::date),
  valor    numeric(12, 2) not null,
  pago_em  timestamptz not null default now(),
  pago_por text,
  unique (store, codigo, mes)
);

-- leitura e escrita só pelas funções abaixo (a chave Pix não pode vazar para quem não é admin)
alter table public.cupons enable row level security;
alter table public.comissoes_pagas enable row level security;

-- Tipo sugerido quando o cupom ainda não foi classificado.
-- Creator: só letras (pode terminar com um número) e desconto típico de 5%.
create or replace function public.cupom_tipo_sugerido(p_codigo text, p_mediana numeric)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_codigo ~ '[^A-Z0-9_-]' or p_codigo like 'PITELLI%' or coalesce(p_mediana, 0) >= 0.95 then 'interno'
    when p_codigo ~ '^(TKS-|AB-|VOLTA[0-9]|BEMVINDO)' then 'pos_venda'
    when p_codigo ~ '(FRETE|PROMO|BLACK|VIP|DESCONTO|CUPOM|GOOG|PRIMEIRA|FEEDBACK|VOLTEI|ESQUENTA|ATACADO|SITENOVO|TITULO|INFLU|NATAL|QUERO|^ART[0-9])' then 'promocao'
    when p_codigo ~ '^[A-Z]{3,}[0-9]?$' and p_mediana between 0.04 and 0.06 then 'creator'
    else 'promocao'
  end;
$$;

-- Uso de cupons pedido a pedido (um pedido com dois cupons aparece nos dois).
create or replace function public.cupons_uso(p_store text)
returns table (order_id text, codigo text, dia date, vendas numeric, desconto numeric, estorno numeric, novo boolean, canal text)
language sql stable set search_path = '' as $$
  select distinct on (o.order_id, upper(trim(c)))
    o.order_id, upper(trim(c)), (o.created_at at time zone 'America/Sao_Paulo')::date,
    coalesce(o.subtotal, 0), coalesce(o.discounts, 0), coalesce(o.refunded, 0),
    o.customer_order_index = 1, coalesce(nullif(o.last_source_label, ''), 'Sem dados')
  from public.orders o, unnest(o.discount_codes) c
  where o.store = p_store
    and o.financial_status in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
    and o.cancelled_at is null
    and trim(c) <> '';
$$;

-- Tipo de cada cupom (cadastro ou sugestão pelo histórico inteiro).
create or replace function public.cupons_tipos(p_store text)
returns table (codigo text, tipo text, sugerido boolean, mediana numeric, primeiro date, ultimo date, pedidos_total bigint)
language sql stable set search_path = '' as $$
  with h as (
    select u.codigo,
           percentile_cont(0.5) within group (order by u.desconto / nullif(u.vendas + u.desconto, 0))::numeric as mediana,
           min(u.dia) as primeiro, max(u.dia) as ultimo, count(*) as pedidos_total
    from public.cupons_uso(p_store) u group by u.codigo
  )
  select coalesce(h.codigo, c.codigo),
         coalesce(c.tipo, public.cupom_tipo_sugerido(h.codigo, h.mediana)),
         c.tipo is null,
         h.mediana, h.primeiro, h.ultimo, coalesce(h.pedidos_total, 0)
  from h full join (select * from public.cupons where store = p_store) c on c.codigo = h.codigo;
$$;

create or replace function public.cupons_pode_ver(p_store text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_allowed() and p_store = any (coalesce(public.lojas_permitidas(), '{}'));
$$;

-- Painel da tela Cupons.
create or replace function public.cupons_painel(p_store text, p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_admin boolean := public.is_admin();
  r jsonb;
begin
  if not public.cupons_pode_ver(p_store) then raise exception 'sem acesso a esta loja'; end if;

  with tipos as (select * from public.cupons_tipos(p_store)),
  uso as (
    select u.*, t.tipo from public.cupons_uso(p_store) u join tipos t on t.codigo = u.codigo
    where u.dia between p_inicio and p_fim
  ),
  agg as (
    select u.codigo, count(*) as pedidos, sum(u.vendas) as vendas, sum(u.desconto) as desconto, sum(u.estorno) as estornos,
           count(*) filter (where u.novo) as novos, mode() within group (order by u.canal) as canal
    from uso u group by u.codigo
  ),
  lista as (
    select t.codigo, t.tipo, t.sugerido, t.mediana, t.primeiro, t.ultimo, t.pedidos_total,
           c.nome, c.instagram, c.tiktok, c.email, case when v_admin then c.pix end as pix,
           coalesce(c.comissao_pct, 10) as comissao_pct, coalesce(c.ativo, true) as ativo, c.obs,
           coalesce(a.pedidos, 0) as pedidos, coalesce(a.vendas, 0) as vendas, coalesce(a.desconto, 0) as desconto,
           coalesce(a.estornos, 0) as estornos, coalesce(a.novos, 0) as novos, a.canal
    from tipos t
    left join agg a on a.codigo = t.codigo
    left join public.cupons c on c.store = p_store and c.codigo = t.codigo
    where a.codigo is not null or (t.tipo = 'creator' and coalesce(c.ativo, true))
  ),
  ped as (
    select o.order_id, (o.created_at at time zone 'America/Sao_Paulo')::date as dia, coalesce(o.subtotal, 0) as vendas,
           coalesce(o.discounts, 0) as desconto, o.customer_order_index = 1 as novo
    from public.orders o
    where o.store = p_store and o.financial_status in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') and o.cancelled_at is null
      and (o.created_at at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  ),
  marca as (
    select p.*, bool_or(u.order_id is not null) as com_cupom, coalesce(bool_or(u.tipo = 'creator'), false) as creator
    from ped p left join uso u on u.order_id = p.order_id
    group by p.order_id, p.dia, p.vendas, p.desconto, p.novo
  )
  select jsonb_build_object(
    'admin', v_admin,
    'resumo', (
      select jsonb_build_object(
        'pedidos', count(*), 'vendas', coalesce(sum(m.vendas), 0),
        'pedidos_cupom', count(*) filter (where m.com_cupom), 'vendas_cupom', coalesce(sum(m.vendas) filter (where m.com_cupom), 0),
        'desconto_cupom', coalesce(sum(m.desconto) filter (where m.com_cupom), 0),
        'novos_cupom', count(*) filter (where m.com_cupom and m.novo),
        'pedidos_creator', count(*) filter (where m.creator), 'vendas_creator', coalesce(sum(m.vendas) filter (where m.creator), 0),
        'ticket_sem_cupom', coalesce(avg(m.vendas) filter (where not m.com_cupom), 0)
      ) from marca m
    ),
    'cupons', coalesce((select jsonb_agg(to_jsonb(l) order by l.vendas desc, l.codigo) from lista l), '[]'::jsonb),
    'dias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dia', d.dia::date,
        'creator', coalesce((select sum(m.vendas) from marca m where m.dia = d.dia::date and m.creator), 0),
        'outros', coalesce((select sum(m.vendas) from marca m where m.dia = d.dia::date and m.com_cupom and not m.creator), 0),
        'sem', coalesce((select sum(m.vendas) from marca m where m.dia = d.dia::date and not m.com_cupom), 0)
      ) order by d.dia)
      from generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day') d(dia)
    ), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

-- Comissões das creators no mês: comissão do mês + saldo que veio dos meses anteriores (não pago).
-- Saldo abaixo de R$ 100 acumula para o mês seguinte; o pagamento quita tudo até aquele mês.
create or replace function public.cupons_comissoes(p_store text, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ini date := date_trunc('month', p_mes)::date;
  v_fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  r jsonb;
begin
  if not public.is_admin() then raise exception 'só administradores'; end if;

  with criadores as (
    select t.codigo, t.sugerido, c.nome, c.instagram, c.pix, c.email,
           coalesce(c.comissao_pct, 10) as pct, coalesce(c.comissao_desde, date '2026-11-01') as desde,
           coalesce(c.saldo_inicial, 0) as saldo_inicial
    from public.cupons_tipos(p_store) t
    left join public.cupons c on c.store = p_store and c.codigo = t.codigo
    where t.tipo = 'creator'
  ),
  uso as (select * from public.cupons_uso(p_store)),
  conta as (
    select k.*,
      coalesce((select sum(u.vendas) from uso u where u.codigo = k.codigo and u.dia between greatest(v_ini, k.desde) and v_fim), 0) as vendas_mes,
      coalesce((select count(*) from uso u where u.codigo = k.codigo and u.dia between greatest(v_ini, k.desde) and v_fim), 0) as pedidos_mes,
      coalesce((select sum(u.vendas) from uso u where u.codigo = k.codigo and u.dia >= k.desde and u.dia < v_ini), 0) as vendas_antes,
      coalesce((select sum(p.valor) from public.comissoes_pagas p where p.store = p_store and p.codigo = k.codigo and p.mes < v_ini), 0) as pago_antes,
      (select jsonb_build_object('valor', p.valor, 'pago_em', p.pago_em, 'pago_por', p.pago_por)
         from public.comissoes_pagas p where p.store = p_store and p.codigo = k.codigo and p.mes = v_ini) as pagamento
    from criadores k
  ),
  linhas as (
    select c.codigo, c.sugerido, c.nome, c.instagram, c.pix, c.email, c.pct, c.desde, c.pedidos_mes,
      round(c.vendas_mes, 2) as vendas_mes,
      round(c.vendas_mes * c.pct / 100, 2) as comissao_mes,
      round(case when v_ini >= date_trunc('month', c.desde) then c.saldo_inicial else 0 end
            + c.vendas_antes * c.pct / 100 - c.pago_antes, 2) as acumulado,
      c.pagamento
    from conta c
  )
  select jsonb_build_object(
    'mes', v_ini,
    'linhas', coalesce((
      select jsonb_agg(to_jsonb(l) || jsonb_build_object('total', l.acumulado + l.comissao_mes) order by l.acumulado + l.comissao_mes desc, l.codigo)
      from linhas l where l.comissao_mes <> 0 or l.acumulado <> 0 or l.pagamento is not null
    ), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

create or replace function public.comissao_pagar(p_store text, p_codigo text, p_mes date, p_valor numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
begin
  if not public.is_admin() then raise exception 'só administradores'; end if;
  -- pagar confirma o cupom como creator
  insert into public.cupons (store, codigo, tipo, atualizado_por) values (p_store, upper(p_codigo), 'creator', v_email)
  on conflict (store, codigo) do update set tipo = 'creator', atualizado_em = now(), atualizado_por = v_email;
  insert into public.comissoes_pagas (store, codigo, mes, valor, pago_por)
  values (p_store, upper(p_codigo), date_trunc('month', p_mes)::date, p_valor, v_email)
  on conflict (store, codigo, mes) do update set valor = excluded.valor, pago_em = now(), pago_por = excluded.pago_por;
end;
$$;

create or replace function public.comissao_desfazer(p_store text, p_codigo text, p_mes date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'só administradores'; end if;
  delete from public.comissoes_pagas where store = p_store and codigo = upper(p_codigo) and mes = date_trunc('month', p_mes)::date;
end;
$$;

-- Salvar o cadastro de um cupom. Time: tipo, nome, redes, e-mail, observação, ativo.
-- Só admin: Pix, % de comissão, início da comissão e saldo trazido do sistema antigo.
create or replace function public.cupom_salvar(p_store text, p_codigo text, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := public.is_admin();
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_cod text := upper(trim(p_codigo));
  v_tipo text;
begin
  if not public.cupons_pode_ver(p_store) then raise exception 'sem acesso a esta loja'; end if;
  if not v_admin and (p ? 'pix' or p ? 'comissao_pct' or p ? 'comissao_desde' or p ? 'saldo_inicial') then
    raise exception 'só administradores mudam Pix e comissão';
  end if;
  v_tipo := coalesce(p ->> 'tipo',
    (select t.tipo from public.cupons_tipos(p_store) t where t.codigo = v_cod), 'promocao');

  insert into public.cupons (store, codigo, tipo, atualizado_por) values (p_store, v_cod, v_tipo, v_email)
  on conflict (store, codigo) do nothing;

  update public.cupons c set
    tipo           = v_tipo,
    nome           = case when p ? 'nome' then nullif(trim(p ->> 'nome'), '') else c.nome end,
    instagram      = case when p ? 'instagram' then nullif(trim(p ->> 'instagram'), '') else c.instagram end,
    tiktok         = case when p ? 'tiktok' then nullif(trim(p ->> 'tiktok'), '') else c.tiktok end,
    email          = case when p ? 'email' then nullif(lower(trim(p ->> 'email')), '') else c.email end,
    obs            = case when p ? 'obs' then nullif(trim(p ->> 'obs'), '') else c.obs end,
    ativo          = coalesce((p ->> 'ativo')::boolean, c.ativo),
    pix            = case when p ? 'pix' then nullif(trim(p ->> 'pix'), '') else c.pix end,
    comissao_pct   = coalesce((p ->> 'comissao_pct')::numeric, c.comissao_pct),
    comissao_desde = coalesce((p ->> 'comissao_desde')::date, c.comissao_desde),
    saldo_inicial  = coalesce((p ->> 'saldo_inicial')::numeric, c.saldo_inicial),
    atualizado_em  = now(),
    atualizado_por = v_email
  where c.store = p_store and c.codigo = v_cod;
end;
$$;

revoke execute on function public.cupons_uso(text) from anon, public, authenticated;
revoke execute on function public.cupons_tipos(text) from anon, public, authenticated;
revoke execute on function public.cupom_tipo_sugerido(text, numeric) from anon, public;
revoke execute on function public.cupons_pode_ver(text) from anon, public;
revoke execute on function public.cupons_painel(text, date, date) from anon, public;
revoke execute on function public.cupons_comissoes(text, date) from anon, public;
revoke execute on function public.comissao_pagar(text, text, date, numeric) from anon, public;
revoke execute on function public.comissao_desfazer(text, text, date) from anon, public;
revoke execute on function public.cupom_salvar(text, text, jsonb) from anon, public;
grant execute on function public.cupons_painel(text, date, date) to authenticated;
grant execute on function public.cupons_comissoes(text, date) to authenticated;
grant execute on function public.comissao_pagar(text, text, date, numeric) to authenticated;
grant execute on function public.comissao_desfazer(text, text, date) to authenticated;
grant execute on function public.cupom_salvar(text, text, jsonb) to authenticated;

-- Cupons que o painel antigo já tirava da lista de creators.
insert into public.cupons (store, codigo, tipo, obs, atualizado_por) values
  ('aphago', 'FRETEHOJE', 'promocao', 'desvinculado no painel antigo de creators', 'migração'),
  ('aphago', 'PROMO10', 'promocao', 'desvinculado no painel antigo de creators', 'migração'),
  ('aphago', 'TITULO', 'promocao', 'desvinculado no painel antigo de creators', 'migração')
on conflict do nothing;
