// Telas que o admin libera por pessoa. Chave "área:tela"; a área de loja usa o id da loja.
import { LOJAS } from "./store";

export type Tela = { chave: string; area: string; nome: string; rota: string; end?: boolean };

export const TELAS_GERAL: Tela[] = [
  { chave: "geral:resumo", area: "geral", nome: "Resumo", rota: "/geral", end: true },
  { chave: "geral:links", area: "geral", nome: "Links UTM", rota: "/geral/links" },
  { chave: "geral:ajustes", area: "geral", nome: "Ajustes", rota: "/geral/ajustes" },
];

export const telasLoja = (id: string): Tela[] => [
  { chave: `${id}:visao`, area: id, nome: "Visão geral", rota: `/${id}`, end: true },
  { chave: `${id}:projecao`, area: id, nome: "Projeção", rota: `/${id}/projecao` },
  { chave: `${id}:canais`, area: id, nome: "Por canal", rota: `/${id}/canais` },
  { chave: `${id}:produtos`, area: id, nome: "Produtos", rota: `/${id}/produtos` },
  { chave: `${id}:jornada`, area: id, nome: "Jornada", rota: `/${id}/jornada` },
  { chave: `${id}:retorno`, area: id, nome: "Retorno", rota: `/${id}/retorno` },
  { chave: `${id}:cupons`, area: id, nome: "Cupons", rota: `/${id}/cupons` },
  { chave: `${id}:lancamentos`, area: id, nome: "Lançamentos", rota: `/${id}/lancamentos` },
];

export const TELAS_TIME: Tela[] = [
  { chave: "time:tarefas", area: "time", nome: "Tarefas", rota: "/time", end: true },
  { chave: "time:produtos", area: "time", nome: "Criação de produtos", rota: "/time/produtos" },
  { chave: "time:ideias", area: "time", nome: "Chuva de ideias", rota: "/time/ideias" },
  { chave: "time:grok", area: "time", nome: "Grok", rota: "/time/grok" },
];

export const AREAS: { id: string; nome: string; telas: Tela[] }[] = [
  { id: "geral", nome: "Geral", telas: TELAS_GERAL },
  ...LOJAS.map((l) => ({ id: l.id as string, nome: l.nome, telas: telasLoja(l.id) })),
  { id: "time", nome: "Time", telas: TELAS_TIME },
];

export const TODAS_AS_TELAS = AREAS.flatMap((a) => a.telas.map((t) => t.chave));

/** Tela da rota atual (a mais específica que casar). */
export function telaDaRota(pathname: string): Tela | undefined {
  const todas = AREAS.flatMap((a) => a.telas);
  const exata = todas.find((t) => t.rota === pathname);
  if (exata) return exata;
  return todas.filter((t) => !t.end && pathname.startsWith(`${t.rota}/`)).sort((a, b) => b.rota.length - a.rota.length)[0];
}
