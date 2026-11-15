-- Tela inicial do administrador: vendas, pedidos (itens), marketing e lucro por loja e no total,
-- no período escolhido e no período anterior. Mesmas regras da projeção diária:
-- vendas = pedidos pagos no dia do pedido − estornos no dia do estorno; lucro = conta da planilha de lucro.
create or replace function public.painel_inicio(p_inicio date, p_fim date, p_ant_inicio date, p_ant_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb := '[]'::jsonb;
  s record;
  periodo record;
  v jsonb;
begin
  if not public.is_admin() then raise exception 'só administradores'; end if;
  for s in select store, nome from public.stores order by store desc loop
    v := jsonb_build_object('store', s.store, 'nome', s.nome);
    for periodo in select 'atual' as k, p_inicio as i, p_fim as f union all select 'anterior', p_ant_inicio, p_ant_fim loop
      v := v || jsonb_build_object(periodo.k, (
        with vd as (
          select coalesce(sum(x.vendas), 0) as bruto, coalesce(sum(x.pedidos), 0) as pedidos, coalesce(sum(x.unidades), 0) as itens,
                 coalesce(sum(public.custo_produto_dia(x)), 0) as custo
          from public.vendas_diarias x where x.store = s.store and x.dia between periodo.i and periodo.f
        ),
        es as (select coalesce(sum(e.valor), 0) as estornos from public.estornos e where e.store = s.store and e.dia between periodo.i and periodo.f),
        mk as (select coalesce(sum(m.total), 0) as total, coalesce(sum(m.meta), 0) as meta from public.marketing_diario(s.store, periodo.i, periodo.f) m),
        t as (select vd.bruto - es.estornos as vendas, vd.*, es.estornos, mk.total as marketing, mk.meta from vd, es, mk)
        select jsonb_build_object(
          'vendas', round(t.vendas, 2), 'estornos', round(t.estornos, 2), 'pedidos', t.pedidos, 'itens', t.itens,
          'custo', round(t.custo, 2), 'marketing', round(t.marketing, 2),
          'lucro', round(t.vendas - t.custo - t.marketing - t.meta * 0.1382 - t.vendas * 0.035 - t.vendas * 0.05
                         - 0.14 * (t.vendas - t.custo - t.marketing), 2)
        ) from t
      ));
    end loop;
    r := r || jsonb_build_array(v);
  end loop;
  return jsonb_build_object('lojas', r, 'atualizado_em', (select max(atualizado_em) from public.vendas_diarias));
end;
$$;
grant execute on function public.painel_inicio(date, date, date, date) to authenticated;

-- lpitelli@gmail.com passa a ser o administrador principal; os demais ficam como time (telas escolhidas em Acessos)
update public.allowed_users set papel = 'admin', status = 'aprovado', aprovado_em = now(), aprovado_por = 'lpitelli@gmail.com'
where email = 'lpitelli@gmail.com';
update public.allowed_users set papel = 'time' where email in ('usefamillia@gmail.com', 'workpietrofurquim@gmail.com');
