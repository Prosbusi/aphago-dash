// API do Pharol para o Grok (e outros robôs). POST com JSON e a chave no cabeçalho
// "Authorization: Bearer ph_…" ou "x-pharol-key: ph_…". Cada chave é de uma loja (ou das duas).
//
// Ações (campo "acao"):
//   ajuda                                   → esta lista
//   nova_ideia      { titulo?, descricao, temas?[], links?[], imagens?[] } → entra na Chuva de ideias (imagens por link são baixadas)
//   produtos        { situacao?: "andamento" | "concluido" | "todos" } → lançamentos da loja
//   ficha           { codigo }              → ficha completa (modelos, códigos, tags, imagens com link de 7 dias)
//   marcar          { codigo, itens[] }     → marca etapas do checklist (ver "itens" na ajuda)
//   produto_criado  { codigo }              → pede ao Pharol para ler a Shopify agora e conferir as tags
//   conferir        { codigo }              → o que já existe na Shopify com o código × o que falta
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const ITENS = {
  "customily.template": "Customily: Template",
  "customily.options": "Customily: Options Set",
  "customily.test": "Customily: Teste Mobile e Desktop",
  "shopify.product": "Shopify: Criação do produto",
  "shopify.mockups": "Shopify: Criação de pelo menos 6 mockups",
  "ads.images": "Criativos: 10 criativos de imagem",
  "ads.videos": "Criativos: 3 criativos de vídeo",
  "ads.created": "Criativos: Anúncios criados",
};
const AJUDA = {
  como_usar: "POST com JSON {\"acao\": \"...\"} e o cabeçalho Authorization: Bearer <chave>.",
  acoes: {
    nova_ideia: "{ titulo?, descricao, temas?: string[], links?: string[], imagens?: string[] (links de imagem, até 10) } → cria a ideia na Chuva de ideias da loja da chave",
    produtos: "{ situacao?: 'andamento' | 'concluido' | 'todos' } → lista os lançamentos (código, nome, prazo, etapas)",
    ficha: "{ codigo: 'AP0364' } → ficha do produto: modelos com código e tags, cores, descrição, imagens de referência",
    marcar: "{ codigo, itens: ['customily.template', …] } → marca etapas; versões são marcadas sozinhas quando o produto aparece na Shopify com a tag",
    produto_criado: "{ codigo } → avise depois de criar os produtos na Shopify; o Pharol lê o catálogo e confere as tags",
    conferir: "{ codigo } → modelos planejados × produtos encontrados na Shopify",
  },
  itens_do_checklist: ITENS,
  regras: [
    "Cada modelo é um produto na Shopify com DUAS tags: a família (ex.: AP0364) e o modelo (ex.: AP0364-c).",
    "Nunca alterar o SKU.",
    "Anúncios levam o código da família entre parênteses no nome, ex.: 'Criativo 03 (AP0364)'.",
  ],
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

const marcaDaLoja = (l: string) => (l === "aphago" ? "AP" : "AB");

async function lancamento(codigo: string, loja: string) {
  const { data } = await supabase.from("produtos_criacao").select("*").eq("codigo", String(codigo ?? "").trim().toUpperCase()).maybeSingle();
  if (!data) throw new Error(`Lançamento ${codigo} não encontrado`);
  if (loja !== "*" && data.marca !== marcaDaLoja(loja)) throw new Error(`O código ${codigo} é de outra loja`);
  return data as { id: string; codigo: string; marca: string; nome: string; checks: string[]; imagens: string[]; cancelado: boolean; prazo: string | null; created_at: string };
}

async function ficha(id: string, imagens: string[]) {
  const { data: f } = await supabase.rpc("lancamento_ficha", { p_id: id });
  let links: string[] = [];
  if (imagens?.length) {
    const { data } = await supabase.storage.from("time").createSignedUrls(imagens, 60 * 60 * 24 * 7);
    links = (data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[];
  }
  return { ...(f as Record<string, unknown>), imagens: links };
}

async function conferir(codigo: string) {
  const { data } = await supabase.rpc("lancamento_shopify", { p_codigo: codigo });
  return data ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "GET") return json(AJUDA);
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);
  const chave = (req.headers.get("x-pharol-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "").trim();
  const { data: loja } = await supabase.rpc("api_chave_valida", { p_chave: chave });
  if (!loja) return json({ erro: "Chave inválida" }, 401);

  const body = await req.json().catch(() => ({}));
  const acao = String(body.acao ?? "ajuda");
  try {
    let r: unknown;
    if (acao === "ajuda") r = AJUDA;
    else if (acao === "nova_ideia") {
      const marca = loja === "*" ? String(body.loja ?? "").toLowerCase() === "abrasso" ? "AB" : "AP" : marcaDaLoja(loja);
      const partes = [body.titulo, body.descricao, ...(Array.isArray(body.links) ? body.links : [])].filter((x) => x && String(x).trim());
      if (!partes.length) throw new Error("Mande pelo menos a descrição da ideia");
      // imagens por link: o Pharol baixa e guarda (o link original pode expirar)
      const imagens: string[] = [];
      for (const u of (Array.isArray(body.imagens) ? body.imagens : []).slice(0, 10)) {
        try {
          const r = await fetch(String(u));
          const tipo = r.headers.get("content-type") ?? "";
          if (!r.ok || !tipo.startsWith("image/")) continue;
          const caminho = `${crypto.randomUUID()}.${tipo.split("/")[1].split(";")[0] || "png"}`;
          const { error: up } = await supabase.storage.from("time").upload(caminho, await r.arrayBuffer(), { contentType: tipo });
          if (!up) imagens.push(caminho);
        } catch { /* imagem que não abriu fica de fora */ }
      }
      const { data, error } = await supabase.from("ideias").insert({
        marca, descricao: partes.join("\n"), temas: Array.isArray(body.temas) ? body.temas.map(String) : [], imagens, criado_por: "grok",
      }).select("id").single();
      if (error) throw new Error(error.message);
      r = { ok: true, ideia: data.id, imagens_guardadas: imagens.length, mensagem: "Ideia na Chuva de ideias do Pharol, esperando aprovação." };
    } else if (acao === "produtos") {
      let q = supabase.from("produtos_criacao").select("id,codigo,marca,nome,prazo,checks,cancelado,created_at").order("created_at", { ascending: false }).limit(50);
      if (loja !== "*") q = q.eq("marca", marcaDaLoja(loja));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const sit = String(body.situacao ?? "andamento");
      const lista = (data ?? []).filter((p) => !p.cancelado).map((p) => ({
        codigo: p.codigo, nome: p.nome, prazo: p.prazo, criado_em: p.created_at, etapas_feitas: p.checks.filter((c: string) => c in ITENS),
        concluido: Object.keys(ITENS).every((k) => p.checks.includes(k)),
      }));
      r = sit === "todos" ? lista : lista.filter((p) => (sit === "concluido" ? p.concluido : !p.concluido));
    } else if (acao === "ficha") {
      const l = await lancamento(body.codigo, loja);
      r = await ficha(l.id, l.imagens);
    } else if (acao === "marcar") {
      const l = await lancamento(body.codigo, loja);
      const itens = (Array.isArray(body.itens) ? body.itens : [body.itens]).map(String).filter((i) => i in ITENS);
      if (!itens.length) throw new Error(`Itens válidos: ${Object.keys(ITENS).join(", ")}`);
      const checks = [...new Set([...(l.checks ?? []), ...itens])];
      const { error } = await supabase.from("produtos_criacao").update({ checks }).eq("id", l.id);
      if (error) throw new Error(error.message);
      r = { ok: true, codigo: l.codigo, marcados: itens };
    } else if (acao === "produto_criado") {
      const l = await lancamento(body.codigo, loja);
      const store = l.marca === "AP" ? "aphago" : "abrasso";
      await supabase.rpc("run_sync", { fn: "sync-shopify", body: { store, mode: "products" } });
      r = { ok: true, mensagem: "O Pharol está lendo a Shopify. Em 1 a 2 minutos use a ação 'conferir' com este código.", codigo: l.codigo };
    } else if (acao === "conferir") {
      const l = await lancamento(body.codigo, loja);
      const f = (await ficha(l.id, [])) as { modelos?: { modelo: string; codigo: string | null }[] };
      const achados = (await conferir(l.codigo)) as { codigo: string | null; title: string; status: string; online_url: string | null }[];
      const modelos = (f.modelos ?? []).map((m) => ({
        modelo: m.modelo, codigo: m.codigo,
        na_shopify: achados.filter((a) => a.codigo === m.codigo).map((a) => ({ titulo: a.title, status: a.status, link: a.online_url })),
      }));
      r = {
        codigo: l.codigo, modelos,
        faltam: modelos.filter((m) => !m.na_shopify.length).map((m) => m.codigo),
        sem_tag_de_modelo: achados.filter((a) => !a.codigo).map((a) => a.title),
      };
    } else throw new Error(`Ação desconhecida: ${acao}. Use "ajuda".`);
    await supabase.from("sync_log").insert({ source: `api:${acao}`, rows_read: 1, status: "ok" });
    return json(r);
  } catch (e) {
    await supabase.from("sync_log").insert({ source: `api:${acao}`, rows_read: 0, status: "erro", error: String(e) });
    return json({ erro: String((e as Error).message ?? e) }, 400);
  }
});
