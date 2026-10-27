// Regras do padrão de UTM da Aphago (as mesmas que o banco usa para classificar):
// - tudo minúsculo, sem acento, sem espaço
// - utm_campaign = <ação>_<detalhe>; a ação é o texto antes do primeiro "_"
// - por isso "_" só aparece uma vez: como separador entre ação e detalhe

export type CanalManual = {
  id: string;
  nome: string;
  source: string;
  medium: string;
  dica: string;        // o que colocar em utm_content nesse canal
  exemplo: string;     // exemplo de detalhe da campanha
};

/** Canais em que a UTM é colocada à mão. Anúncios preenchem sozinhos pelo modelo de URL da plataforma. */
export const CANAIS: CanalManual[] = [
  { id: "wa-grupo", nome: "WhatsApp grupo VIP", source: "whatsapp", medium: "grupo", dica: "a mensagem do disparo, ex.: chamada-1, lembrete, ultimas-horas", exemplo: "disparo-26out" },
  { id: "wa-individual", nome: "WhatsApp individual", source: "whatsapp", medium: "individual", dica: "o template ou a mensagem, ex.: carrinho-abandonado, pos-venda", exemplo: "disparo-26out" },
  { id: "email", nome: "E-mail", source: "email", medium: "email", dica: "onde está o link no e-mail, ex.: botao-topo, banner, produto-1", exemplo: "envio-26out" },
  { id: "push", nome: "Push do app", source: "app", medium: "push", dica: "a notificação, ex.: push-1, push-lembrete", exemplo: "push-26out" },
  { id: "ig", nome: "Instagram orgânico", source: "instagram", medium: "social", dica: "onde está o link, ex.: bio, stories, dm, post", exemplo: "stories-26out" },
  { id: "tiktok", nome: "TikTok orgânico", source: "tiktok", medium: "social", dica: "onde está o link, ex.: bio, video", exemplo: "video-26out" },
  { id: "pinterest", nome: "Pinterest orgânico", source: "pinterest", medium: "social", dica: "o pin ou a pasta, ex.: pin-quadro-amor", exemplo: "pins-out" },
];

/** minúsculo, sem acento, só letras, números e hífen */
export function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function montarCampanha(acao: string, detalhe: string): string {
  const a = slug(acao);
  const d = slug(detalhe);
  return d ? `${a}_${d}` : a;
}

export type ParamsUtm = { source: string; medium: string; campaign: string; content?: string; term?: string };

/** Página de destino normalizada (com https://) ou null se não for um endereço válido. */
export function normalizarDestino(raw: string): URL | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u;
  } catch {
    return null;
  }
}

/** Destino sem UTMs antigas (outros parâmetros, como variant, são mantidos). */
export function destinoLimpo(u: URL): string {
  const c = new URL(u.toString());
  [...c.searchParams.keys()].filter((k) => k.toLowerCase().startsWith("utm_")).forEach((k) => c.searchParams.delete(k));
  return c.toString();
}

export function montarLink(destino: URL, p: ParamsUtm): string {
  const u = new URL(destinoLimpo(destino));
  u.searchParams.set("utm_source", p.source);
  u.searchParams.set("utm_medium", p.medium);
  u.searchParams.set("utm_campaign", p.campaign);
  if (p.content) u.searchParams.set("utm_content", p.content);
  if (p.term) u.searchParams.set("utm_term", p.term);
  return u.toString();
}
