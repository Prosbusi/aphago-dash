// API do Pharol para o Grok (e outros robôs). POST com JSON e a chave no cabeçalho
// "Authorization: Bearer ph_…" ou "x-pharol-key: ph_…". Cada chave é de uma loja (ou das duas).
//
// Ações (campo "acao"):
//   ajuda                                   → esta lista
//   nova_ideia      { titulo, resumo, descricao?, temas?[], links?[], imagens?[] } → entra na Chuva de ideias (imagens por link são baixadas)
//   produtos        { situacao?: "andamento" | "concluido" | "todos" } → lançamentos da loja
//   ficha           { codigo }              → ficha completa (modelos, códigos, tags, imagens com link de 7 dias)
//   marcar          { codigo, itens[] }     → marca etapas do checklist (ver "itens" na ajuda)
//   produto_criado  { codigo }              → pede ao Pharol para ler a Shopify agora e conferir as tags
//   conferir        { codigo }              → o que já existe na Shopify com o código × o que falta
//   buscar_codigo   { url? | handle? | busca? } → código do produto pelo link de destino do anúncio, handle ou nome
//   lista_codigos   {}                      → todas as famílias da loja com nome e links dos produtos
//   envios_do_dia   { canal?: "vip", data? } → mensagens aprovadas para enviar hoje, com o texto pronto de cada grupo VIP
//   envio_feito     { id, grupo?, erro? }   → confirma o envio num grupo (ou em todos); erro = não conseguiu
//   grupos          {}                      → grupos VIP da loja (código e nome)
//   planejar_envios { canal?: "vip", itens[] } → manda o planejamento para o Pharol (entra como rascunho)
//   envios          { canal?: "vip", de?, ate? } → lista do período com resultado de cada envio
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
    nova_ideia: "{ titulo, resumo, descricao?, temas?: string[], links?: string[], imagens?: string[] } → cria a ideia na Chuva de ideias. titulo = nome curto; resumo = 1 ou 2 frases simples de como o produto funciona (aparece na lista); descricao = pesquisa completa (fica recolhida); imagens = links diretos de imagem (até 10)",
    produtos: "{ situacao?: 'andamento' | 'concluido' | 'todos' } → lista os lançamentos (código, nome, prazo, etapas)",
    ficha: "{ codigo: 'AP0364' } → ficha do produto: modelos com código e tags, cores, descrição, imagens de referência",
    marcar: "{ codigo, itens: ['customily.template', …] } → marca etapas; versões são marcadas sozinhas quando o produto aparece na Shopify com a tag",
    produto_criado: "{ codigo } → avise depois de criar os produtos na Shopify; o Pharol lê o catálogo e confere as tags",
    conferir: "{ codigo } → modelos planejados × produtos encontrados na Shopify",
    buscar_codigo: "{ url: 'https://www.aphago.com.br/products/meu-crush' } (ou handle, ou busca por nome) → família e código do modelo; use para nomear anúncios pelo link de destino",
    lista_codigos: "{} → todas as famílias da loja (código, nome, links dos produtos); bom para renomear muitos anúncios de uma vez",
    envios_do_dia: "{ canal?: 'vip' | 'push' | 'email', data?: 'AAAA-MM-DD' } → mensagens APROVADAS do dia (padrão: hoje, horário de Brasília). Cada mensagem traz 'envios': um item por grupo VIP que ainda não recebeu, com o texto pronto (o link do grupo já está dentro). Envie só as que têm pode_enviar = true, cada texto no seu grupo, exatamente como veio, com a imagem_url se houver.",
    envio_feito: "{ id, grupo: 'vip1' } → confirme cada grupo depois de enviar. Sem grupo = enviada em todos. Se não conseguiu: { id, grupo, erro: 'motivo' }.",
    grupos: "{} → grupos VIP da loja (código usado no utm_term e nome)",
    planejar_envios: "{ canal?: 'vip', itens: [{ enviar_em: '2026-12-01T09:00-03:00', texto, url, cupom?, campanha?, tema?, imagem_url?, titulo?, grupos?: ['vip1'] }] } → grava o planejamento no Pharol como rascunho. No texto, escreva {link} onde o link deve entrar. url = página do produto sem UTM: o Pharol monta o link de cada grupo, já aplicando o cupom (/discount/CUPOM?redirect=…). tema vira o fim do utm_content (ex.: 'meu-crush' → 0112-meu-crush). Sem grupos = todos os grupos.",
    envios: "{ canal?: 'vip', de?: 'AAAA-MM-DD', ate?: 'AAAA-MM-DD' } → envios do período (padrão: mês atual) com status e resultado: pedidos e vendas pelo link, pedidos com o cupom em 7 dias",
  },
  itens_do_checklist: ITENS,
  regras: [
    "Cada modelo é um produto na Shopify com DUAS tags: a família (ex.: AP0364) e o modelo (ex.: AP0364-c).",
    "Nunca alterar o SKU.",
    "Anúncios levam o código da família entre parênteses no nome, ex.: 'Criativo 03 (AP0364)'. Se o nome tiver a tag antiga de 3 letras entre parênteses (ex.: (EUS)), troque pela família. Anúncio que leva para coleção, home ou vários produtos usa (ALL).",
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

const CANAIS = ["vip", "push", "email"];
const canalDe = (b: Record<string, unknown>) => {
  const c = String(b.canal ?? "vip").toLowerCase();
  if (!CANAIS.includes(c)) throw new Error("canal deve ser vip, push ou email");
  return c;
};
const lojaDe = (loja: string, b: Record<string, unknown>) => {
  if (loja !== "*") return loja;
  const l = String(b.loja ?? "").toLowerCase();
  if (l !== "aphago" && l !== "abrasso") throw new Error("Esta chave vale para as duas lojas: mande loja: 'aphago' ou 'abrasso'");
  return l;
};
const hojeSP = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

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
      const titulo = String(body.titulo ?? "").trim().slice(0, 120);
      const resumo = String(body.resumo ?? "").trim().slice(0, 400);
      const partes = [body.descricao, ...(Array.isArray(body.links) ? body.links : [])].filter((x) => x && String(x).trim());
      if (!titulo) throw new Error("Mande o titulo (nome curto) e o resumo (1 ou 2 frases de como o produto funciona)");
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
        marca, titulo, resumo, descricao: partes.join("\n"), temas: Array.isArray(body.temas) ? body.temas.map(String) : [], imagens, criado_por: "grok",
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
    } else if (acao === "buscar_codigo" || acao === "lista_codigos") {
      const base = () => {
        const b = supabase.from("v_produto_codigos").select("familia,familia_nome,codigo,modelo,title,handle,status,online_url,store");
        return loja !== "*" ? b.eq("store", loja) : b;
      };
      let q = base();
      if (acao === "buscar_codigo") {
        const url = String(body.url ?? "").trim();
        const handle = String(body.handle ?? "").trim() || (url.match(/\/products\/([^/?#]+)/)?.[1] ?? "");
        const busca = String(body.busca ?? "").trim();
        if (!handle && !busca) throw new Error("Mande url (link de destino do anúncio), handle ou busca");
        q = handle ? q.eq("handle", decodeURIComponent(handle).toLowerCase()) : q.or(`title.ilike.%${busca.replace(/[%,()]/g, " ")}%,familia_nome.ilike.%${busca.replace(/[%,()]/g, " ")}%`);
        const { data, error } = await q.limit(20);
        if (error) throw new Error(error.message);
        r = {
          encontrados: (data ?? []).map((d) => ({ familia: d.familia, nome_familia: d.familia_nome, codigo: d.codigo, modelo: d.modelo, produto: d.title, link: d.online_url, status: d.status })),
          como_nomear: data?.length ? `Use a família entre parênteses no nome do anúncio: (${data[0].familia})` : "Não achei: se o link for de coleção, home ou vários produtos, use (ALL).",
        };
      } else {
        // a API devolve no máximo 1000 linhas por vez: lê em páginas
        // deno-lint-ignore no-explicit-any
        const data: any[] = [];
        for (let de = 0; de < 10000; de += 1000) {
          const { data: pg, error } = await base().order("product_id").range(de, de + 999);
          if (error) throw new Error(error.message);
          data.push(...(pg ?? []));
          if (!pg || pg.length < 1000) break;
        }
        data.sort((a, b) => a.familia.localeCompare(b.familia));
        const m = new Map<string, { familia: string; nome: string; links: string[] }>();
        for (const d of data) {
          const f = m.get(d.familia) ?? { familia: d.familia, nome: d.familia_nome, links: [] };
          if (d.online_url && d.status !== "ARCHIVED") f.links.push(d.online_url.replace(/^https?:\/\/(www\.)?/, ""));
          m.set(d.familia, f);
        }
        r = { familias: [...m.values()] };
      }
    } else if (acao === "envios_do_dia") {
      const store = lojaDe(loja, body);
      const canal = canalDe(body);
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(body.data ?? "")) ? String(body.data) : hojeSP();
      const { data, error } = await supabase.rpc("comunicacao_do_dia", { p_store: store, p_canal: canal, p_dia: dia });
      if (error) throw new Error(error.message);
      const lista = (data ?? []) as unknown[];
      r = {
        dia, canal, mensagens: lista,
        lembrete: lista.length
          ? "Para cada mensagem com pode_enviar = true: envie cada item de 'envios' no grupo indicado, com o texto exatamente como veio, e depois chame envio_feito com o id e o grupo."
          : "Nenhuma mensagem aprovada para este dia. Não envie nada e avise o time.",
      };
    } else if (acao === "envio_feito") {
      const store = lojaDe(loja, body);
      const id = String(body.id ?? "");
      if (!id) throw new Error("Mande o id do envio");
      const { data, error } = await supabase.rpc("comunicacao_marcar", {
        p_store: store, p_id: id, p_grupo: body.grupo ? String(body.grupo) : null, p_erro: body.erro ? String(body.erro) : null,
      });
      if (error) throw new Error(error.message);
      r = { ok: true, ...(data as Record<string, unknown>) };
    } else if (acao === "grupos") {
      const store = lojaDe(loja, body);
      const { data, error } = await supabase.rpc("comunicacao_grupos_lista", { p_store: store, p_canal: canalDe(body) });
      if (error) throw new Error(error.message);
      r = { grupos: data };
    } else if (acao === "planejar_envios") {
      const store = lojaDe(loja, body);
      const canal = canalDe(body);
      const itens = Array.isArray(body.itens) ? body.itens : [];
      if (!itens.length) throw new Error("Mande itens: [{ enviar_em, texto, url, cupom?, campanha?, tema? }]");
      const limpos = itens.slice(0, 200).map((i: Record<string, unknown>, n: number) => {
        const quando = new Date(String(i.enviar_em ?? ""));
        if (isNaN(quando.getTime())) throw new Error(`Item ${n + 1}: enviar_em inválido (use 2026-12-01T09:00-03:00)`);
        if (!String(i.texto ?? "").trim() && !String(i.titulo ?? "").trim()) throw new Error(`Item ${n + 1}: falta o texto`);
        return {
          enviar_em: quando.toISOString(), texto: String(i.texto ?? ""), titulo: String(i.titulo ?? ""), url: String(i.url ?? ""),
          cupom: i.cupom ? String(i.cupom) : null, campanha: String(i.campanha ?? ""), tema: String(i.tema ?? ""), imagem_url: i.imagem_url ? String(i.imagem_url) : "",
          extras: typeof i.extras === "object" && i.extras ? i.extras : {},
          ...(Array.isArray(i.grupos) ? { grupos: i.grupos.map(String) } : {}),
        };
      });
      const { data, error } = await supabase.rpc("comunicacao_importar", { p_store: store, p_canal: canal, p_itens: limpos });
      if (error) throw new Error(error.message);
      r = { ok: true, gravados: data, mensagem: "Planejamento no Pharol como rascunho. O time aprova na tela Comunicação." };
    } else if (acao === "envios") {
      const store = lojaDe(loja, body);
      const canal = canalDe(body);
      const hoje = hojeSP();
      const de = /^\d{4}-\d{2}-\d{2}$/.test(String(body.de ?? "")) ? String(body.de) : `${hoje.slice(0, 7)}-01`;
      const fimMes = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const ate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.ate ?? "")) ? String(body.ate) : fimMes;
      const { data: lista, error: e2 } = await supabase.rpc("comunicacao_lista", { p_store: store, p_canal: canal, p_inicio: de, p_fim: ate });
      if (e2) throw new Error(e2.message);
      r = { de, ate, canal, envios: lista };
    } else throw new Error(`Ação desconhecida: ${acao}. Use "ajuda".`);
    await supabase.from("sync_log").insert({ source: `api:${acao}`, rows_read: 1, status: "ok" });
    return json(r);
  } catch (e) {
    await supabase.from("sync_log").insert({ source: `api:${acao}`, rows_read: 0, status: "erro", error: String(e) });
    return json({ erro: String((e as Error).message ?? e) }, 400);
  }
});
