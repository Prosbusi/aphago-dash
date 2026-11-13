-- "Enviar para o Grok" passa pela função enviar-grok, que manda também os links das imagens (7 dias).
create or replace function public.lancamento_enviar_grok(p_id uuid, p_mensagem text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare pc public.produtos_criacao;
begin
  if not public.is_allowed() then raise exception 'Sem acesso'; end if;
  select * into pc from public.produtos_criacao where id = p_id;
  if not found then raise exception 'Produto não encontrado'; end if;
  if not exists (select 1 from public.integracoes where chave = case pc.marca when 'AP' then 'grok_aphago' else 'grok_abrasso' end) then
    raise exception 'Webhook do Grok desta loja não configurado (Time › Grok)';
  end if;
  return public.run_sync('enviar-grok', jsonb_build_object('id', p_id, 'mensagem', p_mensagem));
end $$;
