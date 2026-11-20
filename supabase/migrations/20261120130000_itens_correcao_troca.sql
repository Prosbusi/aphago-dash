-- Itens criados só para um pedido (título = número do pedido, ex.: "26126240 6"):
--   • correção: o número é o do próprio pedido → conta como o produto original do pedido
--     (a família mais frequente entre os itens com código do mesmo pedido, inclusive os que foram trocados na edição);
--   • troca: o número é de outro pedido (venda antiga) → não conta para nenhum produto.
-- Itens removidos na edição do pedido (quantidade atual 0) deixam de contar, para não somar duas vezes.
alter table public.order_items add column current_quantity int;

create or replace view public.v_itens_familia with (security_invoker = true) as
with base as (
  select i.line_id, i.order_id, i.store, i.product_id, i.quantity, i.current_quantity, i.amount,
         regexp_replace(o.order_number, '\D', '', 'g') as num_pedido,
         substring(i.product_title from '^\s*#?(\d{7,9})(?:\s|$)') as num_item,
         c.familia, c.letra
  from public.order_items i
  join public.orders o using (order_id)
  left join public.produto_codigos c on c.product_id = i.product_id
),
origem as (
  select distinct on (x.order_id) x.order_id, x.product_id, x.familia, x.letra
  from (select b.order_id, b.product_id, b.familia, b.letra, count(*) over (partition by b.order_id, b.familia) as n
        from base b where b.familia is not null) x
  order by x.order_id, x.n desc, x.familia
)
select b.line_id, b.order_id, b.store,
  case when b.familia is not null then b.product_id when b.num_item = b.num_pedido then og.product_id end as product_id,
  coalesce(b.familia, case when b.num_item = b.num_pedido then og.familia end) as familia,
  coalesce(b.letra, case when b.num_item = b.num_pedido then og.letra end) as letra,
  coalesce(b.current_quantity, b.quantity) as quantidade,
  case when coalesce(b.current_quantity, b.quantity) = 0 then 0
       when b.quantity > 0 then round(b.amount * coalesce(b.current_quantity, b.quantity) / b.quantity, 2)
       else b.amount end as valor,
  case when b.num_item is null then 'normal' when b.num_item = b.num_pedido then 'correcao' else 'troca' end as tipo
from base b
left join origem og on og.order_id = b.order_id;

grant select on public.v_itens_familia to authenticated;

-- catálogo passa a usar os itens com a família corrigida
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.catalogo_familias(text, date, date)'::regprocedure);
  d := replace(d, 'select c.familia, c.letra, i.product_id, (o.created_at at time zone ''America/Sao_Paulo'')::date as dia, i.order_id, i.quantity, i.amount,
         o.customer_order_index = 1 as novo
  from public.order_items i
  join public.orders o using (order_id)
  join public.produto_codigos c on c.product_id = i.product_id',
                  'select i.familia, i.letra, i.product_id, (o.created_at at time zone ''America/Sao_Paulo'')::date as dia, i.order_id, i.quantidade as quantity, i.valor as amount,
         o.customer_order_index = 1 as novo
  from public.v_itens_familia i
  join public.orders o using (order_id)');
  d := replace(d, 'and (o.created_at at time zone ''America/Sao_Paulo'')::date between p_inicio and p_fim
),',
                  'and (o.created_at at time zone ''America/Sao_Paulo'')::date between p_inicio and p_fim
    and i.familia is not null and i.quantidade > 0
),');
  if position('v_itens_familia' in d) = 0 or position('i.quantidade > 0' in d) = 0 then raise exception 'catalogo_familias: trecho não encontrado'; end if;
  execute d;
end
$do$;
