-- Cupons por canal de divulgação: VIP... = disparado no Grupo VIP (WhatsApp); APP... = disparado no app (push).
-- O prefixo é regra fixa: vale para todo o histórico e não precisa de conferência.

alter table public.cupons drop constraint cupons_tipo_check;
alter table public.cupons add constraint cupons_tipo_check
  check (tipo in ('vip', 'app', 'creator', 'promocao', 'pos_venda', 'interno'));

create or replace function public.cupom_tipo_prefixo(p_codigo text)
returns text language sql immutable set search_path = '' as $$
  select case when p_codigo like 'VIP%' then 'vip' when p_codigo like 'APP%' then 'app' end;
$$;

create or replace function public.cupom_tipo_sugerido(p_codigo text, p_mediana numeric)
returns text language sql immutable set search_path = '' as $$
  select case
    when public.cupom_tipo_prefixo(p_codigo) is not null then public.cupom_tipo_prefixo(p_codigo)
    when p_codigo ~ '[^A-Z0-9_-]' or p_codigo like 'PITELLI%' or coalesce(p_mediana, 0) >= 0.95 then 'interno'
    when p_codigo ~ '^(TKS-|AB-|VOLTA[0-9]|BEMVINDO)' then 'pos_venda'
    when p_codigo ~ '(FRETE|PROMO|BLACK|DESCONTO|CUPOM|GOOG|PRIMEIRA|FEEDBACK|VOLTEI|ESQUENTA|ATACADO|SITENOVO|TITULO|INFLU|NATAL|QUERO|^ART[0-9])' then 'promocao'
    when p_codigo ~ '^[A-Z]{3,}[0-9]?$' and p_mediana between 0.04 and 0.06 then 'creator'
    else 'promocao'
  end;
$$;

create or replace function public.cupons_tipos(p_store text)
returns table (codigo text, tipo text, sugerido boolean, mediana numeric, primeiro date, ultimo date, pedidos_total bigint)
language sql stable set search_path = '' as $$
  with h as (
    select u.codigo,
           percentile_cont(0.5) within group (order by u.desconto / nullif(u.vendas + u.desconto, 0))::numeric as mediana,
           min(u.dia) as primeiro, max(u.dia) as ultimo, count(*) as pedidos_total
    from public.cupons_uso(p_store) u group by u.codigo
  ),
  j as (
    select coalesce(h.codigo, c.codigo) as codigo, c.tipo as cadastrado, h.mediana, h.primeiro, h.ultimo, coalesce(h.pedidos_total, 0) as pedidos_total
    from h full join (select * from public.cupons where store = p_store) c on c.codigo = h.codigo
  )
  select j.codigo,
         coalesce(public.cupom_tipo_prefixo(j.codigo), j.cadastrado, public.cupom_tipo_sugerido(j.codigo, j.mediana)),
         public.cupom_tipo_prefixo(j.codigo) is null and j.cadastrado is null,
         j.mediana, j.primeiro, j.ultimo, j.pedidos_total
  from j;
$$;

revoke execute on function public.cupom_tipo_prefixo(text) from anon, public;
revoke execute on function public.cupons_tipos(text) from anon, public, authenticated;

-- Vendas por dia separadas pelo tipo principal do pedido (VIP > App > Creator > Promoção > Pós-venda > Interno).
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
    select p.*, bool_or(u.order_id is not null) as com_cupom, coalesce(bool_or(u.tipo = 'creator'), false) as creator,
           (array_agg(u.tipo order by array_position(array['vip', 'app', 'creator', 'promocao', 'pos_venda', 'interno'], u.tipo)))[1] as tipo
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
        'sem', coalesce((select sum(m.vendas) from marca m where m.dia = d.dia::date and not m.com_cupom), 0),
        'tipos', coalesce((select jsonb_object_agg(x.tipo, x.vendas) from (
                   select m.tipo, sum(m.vendas) as vendas from marca m where m.dia = d.dia::date and m.com_cupom group by m.tipo) x), '{}'::jsonb)
      ) order by d.dia)
      from generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day') d(dia)
    ), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

