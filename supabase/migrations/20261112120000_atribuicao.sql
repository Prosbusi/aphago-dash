-- Atribuição por canal e por botão (doc "Pharol · Atribuição por canal e por botão", 12/11/2026)
-- Cada pedido divide 100% do valor entre os canais do caminho, em quatro modelos:
--   linear (padrão), em_u, primeiro, ultimo.
-- O cálculo roda uma vez por pedido e grava o resultado em `atribuicao`; o site só soma.

-- =========================================================
-- NOVOS CAMPOS BRUTOS
-- =========================================================
alter table public.orders add column if not exists bio_botao text;          -- Order.customAttributes "Origem bio"
alter table public.orders add column if not exists bio_em timestamptz;      -- Order.customAttributes "Origem bio (data)"
alter table public.visits add column if not exists source_type text;        -- CustomerVisit.sourceType (minúsculo)

-- =========================================================
-- TABELA DE CANAIS (editável pelo time; a primeira regra que casar define o canal)
-- =========================================================
-- Cada linha é uma condição (campo1 E campo2). Várias linhas com a mesma ordem = "ou".
-- Campos: utm_source, utm_medium, utm_campaign, utm_content, utms (qualquer UTM), source (origem da Shopify),
--         source_type, landing_page, referrer. Tudo comparado em minúsculas e sem espaços nas pontas.
-- Operadores: igual (está na lista), comeca, contem, vazio, preenchido.
-- Canal "(ignorar)" descarta a visita do caminho. Nada casou = "Outros".
create table public.canal_regras (
  id        bigint generated always as identity primary key,
  ordem     int not null,
  canal     text not null,
  grupo     text not null check (grupo in ('Pago', 'Orgânico', 'Mensagens', 'Direto', 'Outros', '—')),
  campo1    text not null,
  op1       text not null check (op1 in ('igual', 'comeca', 'contem', 'vazio', 'preenchido')),
  valores1  text[] not null default '{}',
  campo2    text,
  op2       text check (op2 in ('igual', 'comeca', 'contem', 'vazio', 'preenchido')),
  valores2  text[] not null default '{}',
  nota      text,
  updated_at timestamptz not null default now(),
  check (campo1 in ('utm_source','utm_medium','utm_campaign','utm_content','utms','source','source_type','landing_page','referrer')),
  check (campo2 is null or campo2 in ('utm_source','utm_medium','utm_campaign','utm_content','utms','source','source_type','landing_page','referrer'))
);
comment on table public.canal_regras is 'Tabela de canais da atribuição. Editar aqui reclassifica todo o histórico (recalculado em até 10 min).';

insert into public.canal_regras (ordem, canal, grupo, campo1, op1, valores1, campo2, op2, valores2, nota) values
  (1,  '(ignorar)', '—', 'landing_page', 'contem', '{/checkouts/}', null, null, '{}', 'Checkout'),
  (1,  '(ignorar)', '—', 'referrer', 'contem', '{aphago.com.br,abrasso.com.br,admin.shopify.com,appmax.com.br}', 'utms', 'vazio', '{}',
       'Tráfego interno sem UTM (visita interna com UTM de anúncio é mantida)'),
  (2,  'Meta Ads', 'Pago', 'utm_source', 'comeca', '{instagram_,facebook_,messenger_,threads_,whatsapp_status,audience_network}', null, null, '{}', 'Posicionamentos dos anúncios do Meta'),
  (2,  'Meta Ads', 'Pago', 'utm_source', 'igual', '{meta,fb,ig,facebook}', 'utm_medium', 'igual', '{paid,paid-social,cpc}', null),
  (2,  'Meta Ads', 'Pago', 'utm_source', 'igual', '{meta,facebook,"{{placement}}",igshopping,others}', null, null, '{}', 'Padrões antigos do Meta'),
  (2,  'Meta Ads', 'Pago', 'landing_page', 'contem', '{fbclid}', 'utm_campaign', 'comeca', '{"["}', 'fbclid e campanha entre colchetes'),
  (3,  'Google Ads', 'Pago', 'utm_source', 'igual', '{google}', 'utm_medium', 'igual', '{cpc,paid,ppc}', null),
  (3,  'Google Ads', 'Pago', 'landing_page', 'contem', '{gclid,gbraid,wbraid}', null, null, '{}', null),
  (4,  'Live', 'Orgânico', 'utm_medium', 'igual', '{live}', null, null, '{}', null),
  (5,  'Instagram orgânico', 'Orgânico', 'utm_source', 'igual', '{instagram,ig,linktree}', null, null, '{}', null),
  (5,  'Instagram orgânico', 'Orgânico', 'utm_campaign', 'igual', '{bio}', null, null, '{}', null),
  (6,  'E-mail', 'Mensagens', 'utm_source', 'contem', '{email}', null, null, '{}', null),
  (6,  'E-mail', 'Mensagens', 'utm_medium', 'contem', '{email}', null, null, '{}', null),
  (6,  'E-mail', 'Mensagens', 'utm_campaign', 'comeca', '{emailmarketing}', null, null, '{}', null),
  (6,  'E-mail', 'Mensagens', 'utm_source', 'igual', '{klaviyo,judgeme}', null, null, '{}', 'Ferramentas de e-mail'),
  (6,  'E-mail', 'Mensagens', 'referrer', 'contem', '{com.google.android.gm}', 'utms', 'vazio', '{}', 'App do Gmail sem UTM'),
  (7,  'Push / App', 'Mensagens', 'utm_source', 'igual', '{foxappy,app}', null, null, '{}', null),
  (7,  'Push / App', 'Mensagens', 'utm_medium', 'igual', '{push}', null, null, '{}', null),
  (8,  'WhatsApp', 'Mensagens', 'utm_source', 'contem', '{whats,grupo}', null, null, '{}', null),
  (8,  'WhatsApp', 'Mensagens', 'utm_medium', 'contem', '{whats,grupo}', null, null, '{}', null),
  (9,  'Busca orgânica', 'Orgânico', 'utms', 'vazio', '{}', 'source', 'contem', '{google,bing,yahoo}', null),
  (9,  'Busca orgânica', 'Orgânico', 'utm_source', 'igual', '{google}', 'utm_medium', 'igual', '{product_sync}', 'Google Shopping grátis (listagens orgânicas)'),
  (10, 'Instagram orgânico', 'Orgânico', 'utms', 'vazio', '{}', 'source', 'igual', '{instagram,facebook}', null),
  (10, 'Instagram orgânico', 'Orgânico', 'utms', 'vazio', '{}', 'referrer', 'contem', '{linktr.ee,instagram.com,facebook.com}', null),
  (11, 'TikTok', 'Orgânico', 'utm_source', 'contem', '{tiktok}', null, null, '{}', null),
  (11, 'TikTok', 'Orgânico', 'source', 'contem', '{tiktok}', null, null, '{}', null),
  (12, 'Direto', 'Direto', 'source_type', 'igual', '{direct}', 'utms', 'vazio', '{}', null),
  (12, 'Direto', 'Direto', 'source', 'igual', '{direct,"an unknown source"}', 'utms', 'vazio', '{}', null),
  (12, 'Direto', 'Direto', 'utms', 'vazio', '{}', 'referrer', 'vazio', '{}', 'Nada preenchido'),
  (12, 'Direto', 'Direto', 'utms', 'vazio', '{}', 'referrer', 'contem', '{accounts.google.com}', 'Login com Google');

create or replace function public.regra_casa(op text, valores text[], v text)
returns boolean language sql immutable set search_path = '' as $$
  select case op
    when 'vazio'      then v = ''
    when 'preenchido' then v <> ''
    when 'igual'      then v = any (valores)
    when 'comeca'     then exists (select 1 from unnest(valores) x where left(v, length(x)) = x)
    when 'contem'     then exists (select 1 from unnest(valores) x where x <> '' and position(x in v) > 0)
    else false
  end;
$$;

-- Canal de uma visita, pela tabela de canais.
create or replace function public.canal_visita(
  src text, med text, camp text, cont text, label text, stype text, lp text, ref text
) returns table (canal text, grupo text)
language sql stable set search_path = '' as $$
  with f as (
    select jsonb_build_object(
      'utm_source',   lower(trim(coalesce(src, ''))),
      'utm_medium',   lower(trim(coalesce(med, ''))),
      'utm_campaign', lower(trim(coalesce(camp, ''))),
      'utm_content',  lower(trim(coalesce(cont, ''))),
      'utms',         lower(trim(coalesce(src, '') || coalesce(med, '') || coalesce(camp, ''))),
      'source',       lower(trim(coalesce(label, ''))),
      'source_type',  lower(trim(coalesce(stype, ''))),
      'landing_page', lower(trim(coalesce(lp, ''))),
      'referrer',     lower(trim(coalesce(ref, '')))
    ) as j
  )
  select coalesce(r.canal, 'Outros'), coalesce(r.grupo, 'Outros')
  from f
  left join lateral (
    select c.canal, c.grupo from public.canal_regras c
    where public.regra_casa(c.op1, c.valores1, f.j ->> c.campo1)
      and (c.campo2 is null or public.regra_casa(c.op2, c.valores2, f.j ->> c.campo2))
    order by c.ordem, c.id
    limit 1
  ) r on true;
$$;

-- =========================================================
-- RESULTADO GRAVADO
-- =========================================================
create table public.atribuicao (                      -- uma linha por pedido × modelo × canal × campanha (× botão)
  store              text not null,
  order_id           text not null,
  order_number       text not null,
  data_pedido        date not null,                  -- data de Brasília
  hora               int not null,                   -- hora de Brasília (0 a 23)
  modelo             text not null check (modelo in ('linear', 'em_u', 'primeiro', 'ultimo')),
  canal              text not null,
  grupo              text not null,
  campanha           text not null default '',
  botao              text,                           -- Instagram orgânico: botão da bio; Live: utm_content
  peso               numeric(12,8) not null,
  valor_atribuido    numeric(14,4) not null,
  pedidos_atribuidos numeric(12,8) not null,
  novo_cliente       boolean,
  toques             int not null
);
create index on public.atribuicao (store, modelo, data_pedido);
create index on public.atribuicao (order_id);

create table public.atribuicao_pedido (               -- uma linha por pedido: caminho e controle do recálculo
  order_id      text primary key,
  store         text not null,
  data_pedido   date not null,
  hora          int not null,
  valor         numeric(12,2) not null,
  novo_cliente  boolean,
  caminho       text[] not null default '{}',        -- canais distintos, na ordem da primeira aparição
  toques        int not null default 0,
  bio_botao     text,                                -- Origem bio válido (até 24h antes do pedido)
  sem_dados     boolean not null default false,
  cancelado     boolean not null default false,
  atribuido_em  timestamptz not null default now()
);
create index on public.atribuicao_pedido (store, data_pedido);

create table public.botao_apelidos (                  -- nome bonito de cada botão da bio / live
  botao  text primary key check (botao = lower(botao)),
  nome   text not null
);
insert into public.botao_apelidos values
  ('destaque-natal', 'Destaque Natal'),
  ('acesse-o-site', 'Acesse o site'),
  ('mais-vendidos', 'Mais vendidos'),
  ('colecao-de-natal', 'Coleção de Natal'),
  ('quadros', 'Quadros');

alter table public.canal_regras enable row level security;
alter table public.atribuicao enable row level security;
alter table public.atribuicao_pedido enable row level security;
alter table public.botao_apelidos enable row level security;
create policy "time le" on public.canal_regras for select to authenticated using ((select public.is_allowed()));
create policy "time edita" on public.canal_regras for all to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "time le" on public.atribuicao for select to authenticated using ((select public.is_allowed()));
create policy "time le" on public.atribuicao_pedido for select to authenticated using ((select public.is_allowed()));
create policy "time le" on public.botao_apelidos for select to authenticated using ((select public.is_allowed()));
create policy "time edita" on public.botao_apelidos for all to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));

-- =========================================================
-- CÁLCULO DE UM PEDIDO
-- =========================================================
-- Regras (valem para linear, em U e primeiro clique):
--   1. só visitas até 30 dias antes do pedido;  2. checkout e tráfego interno ficam fora;
--   3. Direto só fica se for o único canal;     4. canal repetido conta uma vez (ordem da primeira aparição);
--   5. a fatia do canal é dividida igualmente entre as campanhas dele;  6. sem jornada = "Sem dados".
-- Bio: "Origem bio" com até 24h antes do pedido vai para a fatia do Instagram orgânico; se o caminho não tem
--   Instagram orgânico, ele entra como mais um canal (na hora gravada no campo).
-- Último clique: a última visita da Shopify, sem as regras 2 e 3, para bater com o relatório da Shopify e a tela atual.
create or replace function public.atribuir_pedido(p_order text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o        public.orders%rowtype;
  v_dia    date;
  v_hora   int;
  v_novo   boolean;
  v_bio    text;
  v_sem    boolean;
  v_cam    text[];
  v_n      int;
  v_live   text;
  u        record;
begin
  delete from public.atribuicao where order_id = p_order;
  select * into o from public.orders where order_id = p_order;
  if not found then
    delete from public.atribuicao_pedido where order_id = p_order;
    return;
  end if;

  v_dia  := (o.created_at at time zone 'America/Sao_Paulo')::date;
  v_hora := extract(hour from o.created_at at time zone 'America/Sao_Paulo')::int;
  v_novo := o.customer_order_index = 1;
  v_bio  := case when nullif(trim(o.bio_botao), '') is not null
                  and (o.bio_em is null or o.bio_em >= o.created_at - interval '24 hours')
                 then lower(trim(o.bio_botao)) end;
  v_sem  := coalesce(o.visits_count, 0) = 0 and not exists (select 1 from public.visits where order_id = p_order);

  if o.cancelled_at is not null then
    insert into public.atribuicao_pedido (order_id, store, data_pedido, hora, valor, novo_cliente, cancelado, atribuido_em)
    values (p_order, o.store, v_dia, v_hora, o.total, v_novo, true, now())
    on conflict (order_id) do update set cancelado = true, valor = excluded.valor, caminho = '{}', toques = 0, atribuido_em = now();
    return;
  end if;

  -- caminho: visitas classificadas, na janela, sem ignoradas
  create temp table if not exists _vis (t timestamptz, canal text, grupo text, campanha text, conteudo text) on commit drop;
  truncate _vis;
  insert into _vis
  select v.occurred_at, c.canal, c.grupo, coalesce(nullif(trim(v.campaign), ''), ''), nullif(lower(trim(v.content)), '')
  from public.visits v
  cross join lateral public.canal_visita(v.source, v.medium, v.campaign, v.content, v.source_label, v.source_type, v.landing_page, v.referrer) c
  where v.order_id = p_order
    and v.occurred_at >= o.created_at - interval '30 days'
    and v.occurred_at <= o.created_at
    and c.canal <> '(ignorar)';

  if v_bio is not null and not exists (select 1 from _vis where canal = 'Instagram orgânico') then
    insert into _vis values (least(coalesce(o.bio_em, o.created_at), o.created_at), 'Instagram orgânico', 'Orgânico', 'bio', null);
  end if;
  if exists (select 1 from _vis where canal <> 'Direto') then
    delete from _vis where canal = 'Direto';
  end if;
  if not v_sem and not exists (select 1 from _vis) then
    insert into _vis values (o.created_at, 'Direto', 'Direto', '', null);
  end if;

  create temp table if not exists _can (idx int, canal text, grupo text, primeira text, n_camp int) on commit drop;
  truncate _can;
  insert into _can
  select row_number() over (order by min(t), canal)::int, canal, max(grupo),
         (array_agg(campanha order by t))[1], count(distinct campanha)::int
  from _vis group by canal;
  select count(*)::int, coalesce(array_agg(canal order by idx), '{}') into v_n, v_cam from _can;
  select conteudo into v_live from _vis where canal = 'Live' and conteudo is not null order by t desc limit 1;

  insert into public.atribuicao_pedido (order_id, store, data_pedido, hora, valor, novo_cliente, caminho, toques, bio_botao, sem_dados, cancelado, atribuido_em)
  values (p_order, o.store, v_dia, v_hora, o.total, v_novo, case when v_sem then '{Sem dados}' else v_cam end,
          case when v_sem then 0 else v_n end, v_bio, v_sem, false, now())
  on conflict (order_id) do update set store = excluded.store, data_pedido = excluded.data_pedido, hora = excluded.hora,
    valor = excluded.valor, novo_cliente = excluded.novo_cliente, caminho = excluded.caminho, toques = excluded.toques,
    bio_botao = excluded.bio_botao, sem_dados = excluded.sem_dados, cancelado = false, atribuido_em = now();

  if v_sem then
    insert into public.atribuicao (store, order_id, order_number, data_pedido, hora, modelo, canal, grupo, campanha, botao, peso, valor_atribuido, pedidos_atribuidos, novo_cliente, toques)
    select o.store, p_order, o.order_number, v_dia, v_hora, m, 'Sem dados', 'Sem dados', '', null, 1, o.total, 1, v_novo, 0
    from unnest(array['linear', 'em_u', 'primeiro', 'ultimo']) m;
    return;
  end if;

  -- linear, em U e primeiro clique
  insert into public.atribuicao (store, order_id, order_number, data_pedido, hora, modelo, canal, grupo, campanha, botao, peso, valor_atribuido, pedidos_atribuidos, novo_cliente, toques)
  select o.store, p_order, o.order_number, v_dia, v_hora, x.modelo, x.canal, x.grupo, x.campanha,
         case x.canal when 'Instagram orgânico' then coalesce(v_bio, 'Bio (sem botão)') when 'Live' then coalesce(v_live, '(sem detalhe)') end,
         x.peso, o.total * x.peso, x.peso, v_novo, v_n
  from (
    select m.modelo, c.canal, c.grupo, k.campanha,
           (case m.modelo
              when 'linear' then 1.0 / v_n
              when 'em_u' then case when v_n = 1 then 1.0 when v_n = 2 then 0.5
                                    when c.idx in (1, v_n) then 0.4 else 0.2 / (v_n - 2) end
              when 'primeiro' then case when c.idx = 1 then 1.0 else 0 end
            end) / case when m.modelo = 'primeiro' then 1 else c.n_camp end as peso
    from _can c
    cross join (values ('linear'), ('em_u'), ('primeiro')) m(modelo)
    cross join lateral (
      select distinct campanha from _vis where _vis.canal = c.canal and m.modelo <> 'primeiro'
      union all
      select c.primeira where m.modelo = 'primeiro'
    ) k
  ) x
  where x.peso > 0;

  -- último clique: a última visita da Shopify, classificada (interna/checkout = Direto)
  select coalesce(nullif(c.canal, '(ignorar)'), 'Direto') as canal,
         case when c.canal = '(ignorar)' then 'Direto' else c.grupo end as grupo,
         coalesce(nullif(trim(o.last_campaign), ''), '') as campanha,
         nullif(lower(trim(o.last_content)), '') as conteudo
  into u
  from public.canal_visita(o.last_source, o.last_medium, o.last_campaign, o.last_content, o.last_source_label, null, o.last_landing_page, o.last_referrer) c;

  insert into public.atribuicao (store, order_id, order_number, data_pedido, hora, modelo, canal, grupo, campanha, botao, peso, valor_atribuido, pedidos_atribuidos, novo_cliente, toques)
  values (o.store, p_order, o.order_number, v_dia, v_hora, 'ultimo', u.canal, u.grupo,
          case when u.canal = 'Direto' then '' else u.campanha end,
          case u.canal when 'Instagram orgânico' then coalesce(v_bio, 'Bio (sem botão)') when 'Live' then coalesce(u.conteudo, '(sem detalhe)') end,
          1, o.total, 1, v_novo, v_n);
end;
$$;

-- Recalcula pedidos novos, alterados (sincronizados depois do último cálculo) ou marcados para recálculo.
create or replace function public.atribuir_pendentes(p_limite int default 5000)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in
    select o.order_id from public.orders o
    left join public.atribuicao_pedido a using (order_id)
    where a.order_id is null or a.atribuido_em < o.synced_at
    order by o.created_at desc
    limit p_limite
  loop
    perform public.atribuir_pedido(r.order_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Mudou a tabela de canais: todo o histórico é recalculado na próxima rodada.
create or replace function public.marcar_recalculo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.atribuicao_pedido set atribuido_em = '-infinity' where atribuido_em > '-infinity';
  return null;
end;
$$;
create trigger canal_regras_recalcula after insert or update or delete on public.canal_regras
  for each statement execute function public.marcar_recalculo();

revoke execute on function public.atribuir_pedido(text) from public, anon, authenticated;
revoke execute on function public.atribuir_pendentes(int) from public, anon, authenticated;
grant execute on function public.atribuir_pendentes(int) to service_role;
revoke execute on function public.marcar_recalculo() from public, anon, authenticated;

select cron.schedule('atribuicao-pendentes', '*/10 * * * *', $$ select public.atribuir_pendentes(); $$);

-- =========================================================
-- LEITURA PARA A TELA "POR CANAL"
-- =========================================================
-- p_store null = as duas lojas. Horas em Brasília. Pedidos cancelados ficam fora (não têm linhas em atribuicao).
create or replace function public.atribuicao_painel(
  p_store text, p_inicio date, p_fim date, p_modelo text default 'linear', p_hora_de int default 0, p_hora_ate int default 23
) returns jsonb language sql stable set search_path = '' as $$
with a as (
  select * from public.atribuicao
  where (p_store is null or store = p_store) and data_pedido between p_inicio and p_fim
    and hora between p_hora_de and p_hora_ate
),
m as (select * from a where modelo = p_modelo),
u as (select * from a where modelo = 'ultimo'),
gasto as (
  select case platform when 'meta' then 'Meta Ads' when 'google' then 'Google Ads' when 'tiktok' then 'TikTok Ads'
                       when 'pinterest' then 'Pinterest Ads' when 'chatgpt' then 'ChatGPT Ads' else platform end as canal,
         campaign_id, max(campaign_name) as campanha, sum(spend) as gasto
  from public.ad_spend
  where (p_store is null or store = p_store) and day between p_inicio and p_fim
  group by 1, 2
),
camp_venda as (
  select canal, campanha, sum(valor_atribuido) as valor, sum(pedidos_atribuidos) as pedidos,
         sum(pedidos_atribuidos) filter (where novo_cliente) as novos
  from m group by 1, 2
),
-- liga a campanha da UTM à campanha da plataforma: nome exato ou id (Google usa o id na UTM)
camp_ligada as (
  select v.*, g.campaign_id
  from camp_venda v
  left join lateral (
    select g.campaign_id from gasto g
    where g.canal = v.canal and v.campanha <> '' and (g.campanha = v.campanha or g.campaign_id = trim(v.campanha))
    order by (g.campanha = v.campanha) desc limit 1
  ) g on true
),
campanhas as (
  select l.canal, l.campanha, l.valor, l.pedidos, l.novos, g.gasto, (l.campaign_id is not null) as ligada
  from camp_ligada l left join gasto g on g.canal = l.canal and g.campaign_id = l.campaign_id
  union all
  select g.canal, coalesce(g.campanha, g.campaign_id), 0, 0, 0, g.gasto, true
  from gasto g
  where g.gasto > 0 and not exists (select 1 from camp_ligada l where l.canal = g.canal and l.campaign_id = g.campaign_id)
),
total as (select coalesce(sum(valor_atribuido), 0) as valor, count(distinct order_id) as pedidos from m)
select jsonb_build_object(
  'modelo', p_modelo,
  'total', (select to_jsonb(t) from total t),
  'grupos', coalesce((
    select jsonb_agg(x order by x.valor desc) from (
      select grupo, sum(valor_atribuido) as valor, sum(pedidos_atribuidos) as pedidos from m group by grupo
    ) x), '[]'::jsonb),
  'canais', coalesce((
    select jsonb_agg(x order by x.valor desc) from (
      select c.canal, c.grupo, c.valor, c.pedidos, c.novos,
             (select sum(g.gasto) from gasto g where g.canal = c.canal) as gasto,
             coalesce((select sum(valor_atribuido) from u where u.canal = c.canal), 0) as valor_ultimo
      from (
        select canal, max(grupo) as grupo, sum(valor_atribuido) as valor, sum(pedidos_atribuidos) as pedidos,
               coalesce(sum(pedidos_atribuidos) filter (where novo_cliente), 0) as novos
        from m group by canal
      ) c
      union all   -- canal que só aparece no último clique
      select u.canal, max(u.grupo), 0, 0, 0, (select sum(g.gasto) from gasto g where g.canal = u.canal), sum(u.valor_atribuido)
      from u where not exists (select 1 from m where m.canal = u.canal) group by u.canal
    ) x), '[]'::jsonb),
  'campanhas', coalesce((select jsonb_agg(c order by c.valor desc, c.gasto desc nulls last) from campanhas c), '[]'::jsonb),
  'botoes', coalesce((
    select jsonb_agg(x order by x.valor desc) from (
      select m.canal, m.botao, coalesce(b.nome, '') as nome, sum(m.valor_atribuido) as valor, sum(m.pedidos_atribuidos) as pedidos,
             count(distinct m.order_id) as pedidos_com_clique
      from m left join public.botao_apelidos b on b.botao = m.botao
      where m.botao is not null group by m.canal, m.botao, b.nome
    ) x), '[]'::jsonb),
  'botoes_desde', (
    select min(p.data_pedido) from public.atribuicao_pedido p
    where p.bio_botao is not null and (p_store is null or p.store = p_store)),
  'caminhos', coalesce((
    select jsonb_agg(x order by x.pedidos desc, x.valor desc) from (
      select p.caminho, count(*) as pedidos, sum(p.valor) as valor
      from public.atribuicao_pedido p
      where (p_store is null or p.store = p_store) and p.data_pedido between p_inicio and p_fim
        and p.hora between p_hora_de and p_hora_ate and not p.cancelado
      group by p.caminho order by count(*) desc, sum(p.valor) desc limit 10
    ) x), '[]'::jsonb),
  'dias', coalesce((
    select jsonb_agg(x order by x.dia, x.grupo) from (
      select data_pedido as dia, grupo, sum(valor_atribuido) as valor from m group by 1, 2
    ) x), '[]'::jsonb),
  'horas', coalesce((
    select jsonb_agg(x order by x.hora) from (
      select p.hora, count(*) as pedidos, sum(p.valor) as valor
      from public.atribuicao_pedido p
      where (p_store is null or p.store = p_store) and p.data_pedido between p_inicio and p_fim and not p.cancelado
      group by p.hora
    ) x), '[]'::jsonb)
);
$$;
revoke execute on function public.atribuicao_painel(text, date, date, text, int, int) from public, anon;
grant execute on function public.atribuicao_painel(text, date, date, text, int, int) to authenticated;
