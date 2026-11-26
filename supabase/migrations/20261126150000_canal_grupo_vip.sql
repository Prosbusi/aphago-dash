-- Canal próprio para o Grupo VIP do WhatsApp (antes caía em "WhatsApp")
insert into public.canal_regras (ordem, canal, grupo, campo1, op1, valores1, nota)
values (7, 'Grupo VIP', 'Mensagens', 'utm_medium', 'contem', array['vip'], 'Links do Grupo VIP no WhatsApp (utm_medium=grupo-vip)');
select public.atribuir_pedido(o.order_id) from public.orders o
where exists (select 1 from public.visits v where v.order_id = o.order_id and v.medium ilike '%vip%');
