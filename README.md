# aphago-dash

Dashboard de vendas, canais e jornada do cliente das lojas Aphago e Abrasso.

## Arquitetura

| Camada | Onde | O que faz |
| --- | --- | --- |
| Coleta | Supabase Edge Functions (agendadas de hora em hora) | Busca Shopify, Meta Ads, Google Ads e Helena e grava o dado bruto |
| Banco | Supabase (Postgres, região São Paulo) | Dados brutos, tabelas de tradução e views para o site |
| Site | GitHub Pages (React + Vite + Tailwind) | Lê as views depois do login Google; nada de dado fica no site |

## Banco de dados

Migrações em `supabase/migrations`, aplicadas em ordem.

- **Dados brutos** (`orders`, `order_items`, `visits`, `ad_spend`, `message_sends`): escritos só pelas funções de coleta, nunca à mão.
- **Tradução** (`channel_map`, `action_map`, `campaign_alias`): editada pelo time. Corrigir aqui reclassifica todo o histórico.
- **Views** (`v_orders`, `v_visits`, `v_order_items`): o que o site lê, já com canal e ação traduzidos.
- **Acesso** (`allowed_users`): só quem está na lista vê dados. `admin` vê custos e margem.

### Regras de tradução

- Canal = `utm_source` + `utm_medium` em `channel_map` (`medium = '*'` vale para qualquer medium).
- Sem UTM, o source vira `ref:<site de origem>` (ex.: `ref:google.com`) ou `ref:direto`.
- Ação = texto antes do primeiro `_` do `utm_campaign`, normalizado (minúsculo, `+` e espaços repetidos viram um espaço). Nomes fora do padrão são mapeados em `campaign_alias`.
- O que não casa aparece como **Não classificado**.

## Links UTM (tela Links UTM)

Para canais em que a UTM é colocada à mão: WhatsApp, e-mail, push e posts orgânicos. Anúncios preenchem as UTMs pelo modelo de URL da plataforma.

- `utm_source` / `utm_medium` vêm do canal escolhido (mesmos valores de `channel_map`).
- `utm_campaign` = `<ação>_<detalhe>`, minúsculo, sem acento, `-` no lugar de espaço. A ação nova entra em `action_map` ao salvar.
- `utm_content` = a peça ou a posição do link; `utm_term` = o público (opcional).
- Os links salvos ficam em `utm_links` para o time reaproveitar.

## Lojas

- `stores` lista as lojas. Todas as tabelas brutas, ações e links têm a coluna `store`.
- A coleta roda uma vez por hora para cada loja (`{"store":"aphago"}`, `{"store":"abrasso"}`) e o catálogo a cada 6 horas (`"mode":"products"`).
- O site tem a área **Geral** (resumo das duas lojas, Links UTM, Ajustes) e uma área por loja com as análises completas.
- A tradução de canais (`channel_map`) é compartilhada; ações (`action_map`) e apelidos (`campaign_alias`) são por loja.

## Segredos

Nenhuma chave fica neste repositório. Tokens das plataformas ficam nos segredos das Edge Functions do Supabase:
`SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` / `SHOPIFY_SHOP` (Aphago) e os mesmos com prefixo `ABRASSO_` (Abrasso).

## Atribuição por canal (tela Por canal)

Cada pedido divide 100% do valor entre os canais do caminho, em quatro modelos: **linear** (padrão), **inteligente** (`em_u`: pesos por etapa, editáveis na tela, padrão 40/20/40), **primeiro clique** e **último clique**.

- `canal_regras`: tabela de canais em ordem (a primeira regra que casar define o canal; `(ignorar)` tira a visita do caminho). Editar reclassifica o histórico.
- `atribuicao` (pedido × modelo × canal × campanha) e `atribuicao_pedido` (caminho do pedido): gravadas por `atribuir_pedido`, rodando a cada 10 min (`atribuir_pendentes`) e depois de cada coleta.
- Regras: janela de 30 dias, checkout e tráfego interno sem UTM fora, Direto só quando é o único canal, canal repetido conta uma vez, fatia do canal dividida entre as campanhas, pedido sem jornada = "Sem dados". O último clique usa a última visita da Shopify (bate com o relatório da Shopify).
- Botões da bio: campo `Origem bio` do pedido (blocos 27 Aphago / 18 Abrasso) detalha a fatia do Instagram orgânico; nomes em `botao_apelidos`.
- A tela lê `atribuicao_painel(loja, início, fim, modelo, hora_de, hora_até)`.
## Área Time (vinda do Fazeno)

Tarefas do time, criação de produtos (4 etapas com checklist) e chuva de ideias. Telas em `web/src/pages/time`, regras em `web/src/lib/time.ts`.

- Tabelas: `equipe`, `etiquetas`, `tarefas`, `colecoes`, `modelos`, `produtos_criacao`, `ideias`; imagens no bucket privado `time`.
- **Código dos produtos** (`AP0001`, `AB0001`…): só os que vieram do Fazeno. O banco não deixa o site criar nem mudar código; produto novo fica "Sem código" até a nomenclatura nova ser definida.
- Avisos no Discord pela Edge Function `avisar-discord` (nova tarefa, @menção em produto, botão Lançar). Segredo: `DISCORD_BOT_TOKEN`. Quem é marcado vem de `equipe.discord_id`.
