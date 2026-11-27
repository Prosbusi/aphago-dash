// Estrutura do menu lateral. As rotas continuam as mesmas; o menu só organiza por grupo.
import type { NomeIcone } from "../components/Icone";
import type { StoreId } from "./data";

export type ItemMenu = {
  label: string;
  icone: NomeIcone;
  to?: string;
  end?: boolean;
  /** Chave de acesso (tela Acessos). Sem chave = todos veem. */
  chave?: string;
  admin?: boolean;
  emBreve?: boolean;
  contador?: number;
  filhos?: ItemMenu[];
};

export type GrupoMenu = { titulo?: string; itens: ItemMenu[] };

export function montarMenu(loja: StoreId, pendentes: number): { principal: GrupoMenu[]; rodape: GrupoMenu } {
  const L = `/${loja}`;
  return {
    principal: [
      {
        itens: [
          { label: "Início", icone: "inicio", to: "/geral/inicio", admin: true },
          { label: "Resumo das lojas", icone: "resumo", to: "/geral", end: true, chave: "geral:resumo" },
          { label: "Assistente IA", icone: "ia", emBreve: true },
        ],
      },
      {
        titulo: "Análise",
        itens: [
          { label: "Visão geral", icone: "painel", to: L, end: true, chave: `${loja}:visao` },
          {
            label: "Vendas",
            icone: "vendas",
            filhos: [
              { label: "Projeção", icone: "vendas", to: `${L}/projecao`, chave: `${loja}:projecao` },
              { label: "Por canal", icone: "vendas", to: `${L}/canais`, chave: `${loja}:canais` },
              { label: "UTMs", icone: "vendas", to: `${L}/utms`, chave: `${loja}:utms` },
              { label: "Jornada", icone: "vendas", to: `${L}/jornada`, chave: `${loja}:jornada` },
              { label: "Retorno", icone: "vendas", to: `${L}/retorno`, chave: `${loja}:retorno` },
            ],
          },
          { label: "Produtos", icone: "produtos", to: `${L}/produtos`, chave: `${loja}:produtos` },
          { label: "Cupons", icone: "cupom", to: `${L}/cupons`, chave: `${loja}:cupons` },
          { label: "Gastos com IA", icone: "gastos", to: `${L}/ia`, chave: `${loja}:ia` },
        ],
      },
      {
        titulo: "Comunicação",
        itens: [
          { label: "Calendário", icone: "calendario", to: `${L}/comunicacao/calendario`, chave: `${loja}:calendario` },
          { label: "Grupo VIP", icone: "vip", to: `${L}/comunicacao/vip`, chave: `${loja}:vip` },
          { label: "Push", icone: "push", to: `${L}/comunicacao/push`, chave: `${loja}:push` },
          { label: "E-mail", icone: "email", to: `${L}/comunicacao/email`, chave: `${loja}:email` },
        ],
      },
      {
        titulo: "Social",
        itens: [
          { label: "Instagram", icone: "instagram", emBreve: true },
          { label: "TikTok", icone: "tiktok", emBreve: true },
        ],
      },
      {
        titulo: "Relacionamento",
        itens: [
          { label: "Atendimento", icone: "atendimento", emBreve: true },
          { label: "Influenciadoras", icone: "influencer", emBreve: true },
        ],
      },
      {
        titulo: "Operação",
        itens: [
          { label: "Tarefas", icone: "tarefas", to: "/time", end: true, chave: "time:tarefas" },
          { label: "Criação de produtos", icone: "criacao", to: "/time/produtos", chave: "time:produtos" },
          { label: "Lançamentos", icone: "lancamentos", to: `${L}/lancamentos`, chave: `${loja}:lancamentos` },
          { label: "Chuva de ideias", icone: "ideias", to: "/time/ideias", chave: "time:ideias" },
        ],
      },
    ],
    rodape: {
      itens: [
        { label: "Links UTM", icone: "links", to: "/geral/links", chave: "geral:links" },
        { label: "Integrações", icone: "integracoes", to: "/time/grok", chave: "time:grok" },
        {
          label: "Configurações",
          icone: "config",
          filhos: [
            { label: "Ajustes", icone: "config", to: "/geral/ajustes", chave: "geral:ajustes" },
            { label: "Acessos", icone: "config", to: "/geral/acessos", admin: true, contador: pendentes || undefined },
          ],
        },
      ],
    },
  };
}
