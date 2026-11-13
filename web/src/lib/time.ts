// Área Time (vinda do Fazeno): tarefas da equipe, criação de produtos e chuva de ideias.
import { useCallback, useEffect, useState } from "react";
import { supabase, fetchAll } from "./supabase";

export type Pessoa = { id: string; nome: string; email: string | null; discord_id: string | null; ativo: boolean };
export type Etiqueta = { id: string; nome: string; cor: string };
export type Tarefa = {
  id: string; pessoa_id: string | null; titulo: string; descricao: string; prazo: string | null; link: string | null;
  imagens: string[]; etiquetas: string[]; concluida: boolean; concluida_em: string | null; criado_por: string | null; created_at: string;
};
export type Colecao = { id: string; nome: string };
export type Modelo = { id: string; nome: string; posicao: number; letra: string | null };
export type Produto = {
  id: string; marca: "AP" | "AB"; codigo: string | null; nome: string; descricao: string; imagens: string[];
  modelos: string[]; cores: string[]; checks: string[]; colecao_id: string | null; prazo: string | null;
  cancelado: boolean; shopify_product_id: string | null; created_at: string;
};
export type Ideia = {
  id: string; marca: "AP" | "AB" | "BOTH"; titulo: string; resumo: string; descricao: string; imagens: string[]; temas: string[];
  produto_id: string | null; created_at: string;
};

export const MARCAS = { AP: "Aphago", AB: "Abrasso" } as const;
export const IDEIA_MARCAS = { AP: "Aphago", AB: "Abrasso", BOTH: "Ambas" } as const;
export const TEMAS = ["Pai", "Mãe", "Avós", "Namorado", "Quadro", "Caneca", "PET", "Body", "Natal"];

export const CORES_ETIQUETA: Record<string, { nome: string; fundo: string; texto: string }> = {
  green: { nome: "Verde", fundo: "#DCF2E5", texto: "#1F7A4D" },
  yellow: { nome: "Amarelo", fundo: "#FBEFD0", texto: "#8A5A00" },
  red: { nome: "Vermelho", fundo: "#FBE0DD", texto: "#B42318" },
  blue: { nome: "Azul", fundo: "#DDE8FB", texto: "#1D4ED8" },
  violet: { nome: "Roxo", fundo: "#ECE0FA", texto: "#6D35B5" },
};

export const CORES_PRODUTO = [
  { key: "preto", nome: "Preto", hex: "#1c1c1c" },
  { key: "branco", nome: "Branco", hex: "#f3f3f3" },
  { key: "marinho", nome: "Azul marinho", hex: "#141b2e" },
  { key: "vermelho", nome: "Vermelho", hex: "#c81e0a" },
  { key: "verde", nome: "Verde musgo", hex: "#032b17" },
  { key: "mostarda", nome: "Mostarda", hex: "#d4890a" },
  { key: "rosa", nome: "Rosa", hex: "#c27ba0" },
  { key: "bordo", nome: "Bordô", hex: "#4a1a1f" },
  { key: "cinza", nome: "Cinza", hex: "#8a8a8a" },
];

// ---------- prazos e números do time ----------

export type StatusPrazo = "atrasada" | "hoje" | "amanha" | "depois" | null;
export function statusPrazo(prazo: string | null, concluida: boolean, hoje = new Date()): StatusPrazo {
  if (!prazo || concluida) return null;
  const [y = 0, m = 1, d = 1] = prazo.split("-").map(Number);
  const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) / 864e5);
  return diff < 0 ? "atrasada" : diff === 0 ? "hoje" : diff === 1 ? "amanha" : "depois";
}

export function ordenarPorPrazo<T extends { prazo: string | null; created_at: string }>(lista: T[]) {
  return [...lista].sort((a, b) => (a.prazo ?? "9999").localeCompare(b.prazo ?? "9999") || b.created_at.localeCompare(a.created_at));
}

/** Concluídas, pendentes e tempo médio (horas) do cadastro à conclusão, por pessoa. */
export function numerosPorPessoa(pessoas: Pessoa[], tarefas: Tarefa[]) {
  return pessoas.map((p) => {
    const feitas = tarefas.filter((t) => t.pessoa_id === p.id && t.concluida);
    const comData = feitas.filter((t) => t.concluida_em);
    const horas = comData.reduce((s, t) => s + Math.max(0, (Date.parse(t.concluida_em ?? "") - Date.parse(t.created_at)) / 36e5), 0);
    return {
      ...p,
      concluidas: feitas.length,
      pendentes: tarefas.filter((t) => t.pessoa_id === p.id && !t.concluida).length,
      media: comData.length ? Math.round((horas / comData.length) * 10) / 10 : null,
    };
  });
}

export function dataCurta(iso: string) {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

// ---------- etapas do produto ----------

export type Item = { key: string; label: string };
export type Etapa = { key: string; titulo: string; itens: Item[] };

export function etapas(modelosDoProduto: string[], modelos: Modelo[]): Etapa[] {
  return [
    { key: "customily", titulo: "1 · Criação Customily", itens: [
      { key: "customily.template", label: "Template" },
      { key: "customily.options", label: "Options Set" },
      { key: "customily.test", label: "Teste Mobile e Desktop" },
    ] },
    { key: "shopify", titulo: "2 · Criação Shopify", itens: [
      { key: "shopify.product", label: "Criação do produto" },
      { key: "shopify.mockups", label: "Criação de pelo menos 6 mockups" },
    ] },
    { key: "versions", titulo: "3 · Outras versões", itens: modelos.filter((m) => modelosDoProduto.includes(m.id)).map((m) => ({ key: `model.${m.id}`, label: m.nome })) },
    { key: "ads", titulo: "4 · Criativos e Anúncios", itens: [
      { key: "ads.images", label: "10 criativos de imagem" },
      { key: "ads.videos", label: "3 criativos de vídeo" },
      { key: "ads.created", label: "Anúncios Criados" },
    ] },
  ];
}

/** Etapa sem itens (nenhuma versão extra) conta como feita. */
export const etapaFeita = (e: Etapa, checks: string[]) => e.itens.every((i) => checks.includes(i.key));

export function podeLancar(p: Pick<Produto, "cancelado" | "modelos" | "checks">, modelos: Modelo[]) {
  const v = etapas(p.modelos, modelos).find((e) => e.key === "versions");
  return !p.cancelado && !!v && etapaFeita(v, p.checks);
}

/** Pessoas citadas com @Nome no texto. */
export function citados<T extends { id: string; nome: string }>(texto: string, pessoas: T[]): T[] {
  const t = texto.toLocaleLowerCase("pt-BR");
  return pessoas.filter((p) => p.nome.trim() && t.includes(`@${p.nome.trim().toLocaleLowerCase("pt-BR")}`));
}

// ---------- dados ----------

/** Lê uma tabela inteira; `recarregar` busca de novo depois de salvar. */
export function useTabela<T>(tabela: string, ordem: string, asc = true) {
  const [estado, setEstado] = useState<{ data?: T[]; error?: string }>({});
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let vivo = true;
    fetchAll<T>((de, ate) => supabase.from(tabela).select("*").order(ordem, { ascending: asc }).order("id").range(de, ate))
      .then((data) => vivo && setEstado({ data }))
      .catch((e: Error) => vivo && setEstado({ error: e.message }));
    return () => { vivo = false; };
  }, [tabela, ordem, asc, versao]);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  /** Troca uma linha na lista sem esperar o banco (o banco confirma depois). */
  const trocar = useCallback((id: string, patch: Partial<T>) =>
    setEstado((s) => ({ ...s, data: s.data?.map((r) => ((r as { id: string }).id === id ? { ...r, ...patch } : r)) })), []);
  return { ...estado, recarregar, trocar };
}

export const BUCKET = "time";

export async function enviarImagem(arquivo: File): Promise<string> {
  const ext = (arquivo.name.split(".").pop() || arquivo.type.split("/")[1] || "png").toLowerCase();
  const caminho = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(caminho, arquivo, { contentType: arquivo.type });
  if (error) throw new Error(error.message);
  return caminho;
}

const cacheLinks = new Map<string, { url: string; expira: number }>();
/** Links temporários das imagens privadas (válidos por 6 h). */
export function useImagens(caminhos: string[]) {
  const chave = caminhos.join("|");
  const [links, setLinks] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!caminhos.length) return;
    const agora = Date.now();
    const faltam = caminhos.filter((c) => (cacheLinks.get(c)?.expira ?? 0) <= agora);
    const montar = () => setLinks(Object.fromEntries(caminhos.map((c) => [c, cacheLinks.get(c)?.url ?? ""])));
    if (!faltam.length) { montar(); return; }
    let vivo = true;
    supabase.storage.from(BUCKET).createSignedUrls(faltam, 60 * 60 * 6).then(({ data }) => {
      data?.forEach((d) => { if (d.signedUrl && d.path) cacheLinks.set(d.path, { url: d.signedUrl, expira: agora + 5 * 36e5 }); });
      if (vivo) montar();
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return links;
}

export function emailAtual(email: string | undefined) {
  return (email ?? "").trim().toLowerCase() || null;
}

/** Aviso no Discord. Nunca desfaz o que já foi salvo: devolve o erro para mostrar na tela. */
export async function avisar(tipo: "tarefa" | "mencao" | "lancamento", id: string, pessoas: string[] = []): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke("avisar-discord", { body: { tipo, id, pessoas } });
  if (error) {
    let msg = error.message;
    try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) msg = b.error; } catch { /* corpo sem json */ }
    return msg;
  }
  return (data as { error?: string } | null)?.error ?? null;
}
