// Coleta do investimento do Meta Ads -> ad_spend (platform = 'meta').
// Corpo: { "store": "aphago" | "abrasso", "mode": "incremental" | "backfill" | "contas" | "permissoes", "since"?: "2026-08-01", "restart"?: true }
// incremental (padrão): reenvia os últimos 3 dias. backfill: desde `since`, um dia por vez, guardando o cursor.
// criativos: busca o link de destino dos anúncios sem destino (meta_anuncios); o incremental faz isso para os novos.
// contas: lista as contas de anúncio que os tokens enxergam e a loja de cada uma (diagnóstico).
// Segredos: META_ACCESS_TOKEN_APHAGO, META_ACCESS_TOKEN_ABRASSO (token de usuário do sistema, permissão ads_read).
// A loja de cada conta vem da tabela ad_accounts: um token pode enxergar contas das duas lojas,
// e uma conta só é coletada se estiver lá, ativa, com a loja certa.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const GRAPH = "https://graph.facebook.com/v24.0";
const TIME_BUDGET_MS = 90_000;
const JANELA_DIAS = 1; // avança um dia por vez e salva o progresso a cada dia

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoSP = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function graph(url: string) {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const res = await fetch(url);
    const body = await res.json();
    const code = body?.error?.code;
    // 4, 17, 32, 613, 80004: limites de chamadas do Meta
    if ([4, 17, 32, 613, 80004].includes(code)) { await sleep(5000 * (tentativa + 1)); continue; }
    if (body.error) throw new Error(`Meta: ${body.error.message}`);
    return body;
  }
  throw new Error("Meta: limite de chamadas excedido");
}

async function contas(token: string): Promise<{ id: string; name: string; account_status: number; currency: string }[]> {
  const out = [];
  let url: string | null = `${GRAPH}/me/adaccounts?fields=id,name,account_status,currency&limit=100&access_token=${token}`;
  while (url) {
    const b = await graph(url);
    out.push(...b.data);
    url = b.paging?.next ?? null;
  }
  return out;
}

// deno-lint-ignore no-explicit-any
const soma = (lista: any[] | undefined, tipos: string[]) => {
  if (!lista) return 0;
  for (const t of tipos) {
    const a = lista.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
};
const COMPRA = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

async function insights(store: string, token: string, conta: string, desde: string, ate: string) {
  const params = new URLSearchParams({
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since: desde, until: ate }),
    breakdowns: "publisher_platform,platform_position",
    fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,actions,action_values",
    limit: "500",
    access_token: token,
  });
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];
  let url: string | null = `${GRAPH}/${conta}/insights?${params}`;
  while (url) {
    const b = await graph(url);
    for (const r of b.data) {
      rows.push({
        store,
        day: r.date_start,
        platform: "meta",
        account_id: conta.replace(/^act_/, ""),
        campaign_id: r.campaign_id ?? "",
        campaign_name: r.campaign_name ?? null,
        adset_id: r.adset_id ?? "",
        adset_name: r.adset_name ?? null,
        ad_id: r.ad_id ?? "",
        ad_name: r.ad_name ?? null,
        placement: `${r.publisher_platform ?? ""}/${r.platform_position ?? ""}`,
        spend: Number(r.spend) || 0,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.clicks) || 0,
        platform_purchases: soma(r.actions, COMPRA),
        platform_revenue: soma(r.action_values, COMPRA),
        synced_at: new Date().toISOString(),
      });
    }
    url = b.paging?.next ?? null;
  }
  return rows;
}

async function gravar(store: string, conta: string, desde: string, ate: string, rows: unknown[]) {
  const del = await supabase.from("ad_spend").delete()
    .eq("store", store).eq("platform", "meta").eq("account_id", conta.replace(/^act_/, ""))
    .gte("day", desde).lte("day", ate);
  if (del.error) throw new Error(`ad_spend: ${del.error.message}`);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("ad_spend").upsert(rows.slice(i, i + 500), {
      onConflict: "store,day,platform,account_id,campaign_id,adset_id,ad_id,placement",
    });
    if (error) throw new Error(`ad_spend: ${error.message}`);
  }
}

// Link de destino do criativo: produto (/products/<handle>), coleção ou home.
// deno-lint-ignore no-explicit-any
function linkDoCriativo(c: any): string | null {
  const s = c?.object_story_spec;
  const f = c?.asset_feed_spec;
  const candidatos = [
    s?.link_data?.link,
    s?.link_data?.call_to_action?.value?.link,
    s?.video_data?.call_to_action?.value?.link,
    s?.template_data?.link,
    f?.link_urls?.[0]?.website_url,
    c?.link_url,
    c?.object_url,
  ];
  for (const l of candidatos) if (typeof l === "string" && /^https?:\/\//i.test(l) && !/facebook\.com|instagram\.com|fb\.me/i.test(l)) return l;
  return null;
}

// Busca o destino de anúncios (até 50 por chamada) e grava em meta_anuncios.
async function criativos(store: string, lista: { ad_id: string; account_id: string }[], tokenDaConta: (conta: string) => string | undefined) {
  let gravados = 0, comLink = 0;
  for (let i = 0; i < lista.length; i += 50) {
    const lote = lista.slice(i, i + 50);
    const porToken = new Map<string, typeof lote>();
    const semToken = [];
    for (const a of lote) {
      const t = tokenDaConta(`act_${a.account_id}`);
      if (!t) { semToken.push({ ad_id: a.ad_id, store, account_id: a.account_id, nome: null, link: null }); continue; }
      porToken.set(t, [...(porToken.get(t) ?? []), a]);
    }
    // conta que o token não enxerga mais: registra sem link para não tentar de novo a cada rodada
    if (semToken.length) {
      const { error } = await supabase.from("meta_anuncios").upsert(semToken, { onConflict: "ad_id" });
      if (error) throw new Error(`meta_anuncios: ${error.message}`);
      gravados += semToken.length;
    }
    for (const [t, ads] of porToken) {
      const fields = "name,creative{object_story_spec,asset_feed_spec,link_url,object_url}";
      // deno-lint-ignore no-explicit-any
      let b: any = {};
      try {
        b = await graph(`${GRAPH}/?ids=${ads.map((a) => a.ad_id).join(",")}&fields=${encodeURIComponent(fields)}&access_token=${t}`);
      } catch (_) {
        // um anúncio apagado derruba o lote: tenta um a um
        for (const a of ads) {
          try { b[a.ad_id] = await graph(`${GRAPH}/${a.ad_id}?fields=${encodeURIComponent(fields)}&access_token=${t}`); }
          catch (_) { b[a.ad_id] = null; }
        }
      }
      const rows = ads.map((a) => {
        const ad = b[a.ad_id];
        const link = ad ? linkDoCriativo(ad.creative) : null;
        if (link) comLink++;
        return { ad_id: a.ad_id, store, account_id: a.account_id, nome: ad?.name ?? null, link, atualizado_em: new Date().toISOString() };
      });
      const { error } = await supabase.from("meta_anuncios").upsert(rows, { onConflict: "ad_id" });
      if (error) throw new Error(`meta_anuncios: ${error.message}`);
      gravados += rows.length;
    }
  }
  return { gravados, comLink };
}

async function authorized(req: Request): Promise<boolean> {
  const key = req.headers.get("x-sync-key");
  if (!key) return false;
  const { data, error } = await supabase.rpc("check_sync_key", { k: key });
  return !error && data === true;
}

Deno.serve(async (req) => {
  const started = Date.now();
  if (!(await authorized(req))) return new Response("unauthorized", { status: 401 });
  const body = await req.json().catch(() => ({}));
  const store: string = body.store ?? "aphago";
  const mode: string = body.mode ?? "incremental";
  const fonte = `meta${mode === "backfill" ? "_backfill" : ""}:${store}`;
  const tokens = Object.entries(Deno.env.toObject())
    .filter(([k, v]) => k.startsWith("META_ACCESS_TOKEN_") && v)
    .map(([, v]) => v);
  if (!tokens.length) return Response.json({ store, error: "nenhum segredo META_ACCESS_TOKEN_* configurado" }, { status: 500 });

  if (mode === "permissoes") {
    // o que cada token pode fazer (ads_read = só leitura; ads_management = pode editar anúncios)
    const out = [];
    for (const t of tokens) {
      try {
        const me = await graph(`${GRAPH}/me?fields=id,name&access_token=${t}`);
        const p = await graph(`${GRAPH}/me/permissions?access_token=${t}`);
        out.push({ conta: me.name ?? me.id, permissoes: (p.data ?? []).filter((x: { status: string }) => x.status === "granted").map((x: { permission: string }) => x.permission) });
      } catch (e) { out.push({ erro: String(e) }); }
    }
    return Response.json({ tokens: out });
  }

  try {
    const vistas = new Map<string, { id: string; name: string; account_status: number; token: string }>();
    for (const t of tokens) for (const c of await contas(t)) if (!vistas.has(c.id)) vistas.set(c.id, { ...c, token: t });
    const { data: mapa } = await supabase.from("ad_accounts").select("account_id,store,ativo").eq("platform", "meta");
    const lojaDe = new Map((mapa ?? []).map((m) => [`act_${m.account_id}`, m]));
    if (mode === "contas") {
      return Response.json({
        contas: [...vistas.values()].map((c) => ({ id: c.id, nome: c.name, ativa: c.account_status === 1, loja: lojaDe.get(c.id)?.store ?? "sem loja (não coletada)" })),
      });
    }
    const ativas = [...vistas.values()].filter((c) => c.account_status === 1 && lojaDe.get(c.id)?.store === store && lojaDe.get(c.id)?.ativo);
    const tokenDaConta = (conta: string) => vistas.get(conta)?.token;
    const destinos = async (limite: number) => {
      const { data, error } = await supabase.rpc("anuncios_sem_destino", { p_store: store, p_limite: limite });
      if (error) throw new Error(`anuncios_sem_destino: ${error.message}`);
      return await criativos(store, data ?? [], tokenDaConta);
    };

    if (mode === "criativos") {
      // destino dos anúncios que ainda não têm: roda em lotes até acabar o tempo
      let gravados = 0, comLink = 0;
      while (Date.now() - started < TIME_BUDGET_MS) {
        const r = await destinos(200);
        gravados += r.gravados; comLink += r.comLink;
        if (r.gravados === 0) break;
      }
      const { data: falta } = await supabase.rpc("anuncios_sem_destino", { p_store: store, p_limite: 100000 });
      return Response.json({ store, mode, gravados, comLink, faltam: falta?.length ?? 0 });
    }

    const hoje = isoSP(new Date());
    let desde: string;
    const ate = hoje;
    if (mode === "backfill") {
      const { data: st } = await supabase.from("sync_state").select("cursor").eq("source", fonte).maybeSingle();
      const cursor = body.restart || !st?.cursor ? (body.since ?? "2026-08-01") : st.cursor;
      if (cursor === "fim") return Response.json({ store, mode, done: true });
      desde = cursor;
    } else {
      desde = addDays(hoje, -2);
    }

    let total = 0;
    let done = false;
    while (Date.now() - started < TIME_BUDGET_MS) {
      const fimJanela = [addDays(desde, JANELA_DIAS - 1), ate].sort()[0];
      for (const c of ativas) {
        const rows = await insights(store, c.token, c.id, desde, fimJanela);
        await gravar(store, c.id, desde, fimJanela, rows);
        total += rows.length;
      }
      done = fimJanela >= ate;
      desde = addDays(fimJanela, 1);
      if (mode === "backfill") {
        await supabase.from("sync_state").upsert({ source: fonte, cursor: done ? "fim" : desde, last_run_at: new Date().toISOString() });
      }
      if (done) break;
    }
    // anúncios novos: guarda o link de destino (usado quando o nome não tem código)
    if (mode === "incremental" && Date.now() - started < TIME_BUDGET_MS + 20_000) {
      try { await destinos(100); } catch (e) { console.error(e); }
    }
    await supabase.from("sync_log").insert({ source: fonte, rows_read: total, status: done ? "ok" : "parcial" });
    return Response.json({ store, mode, contas: ativas.map((c) => `${c.name} (${c.id})`), linhas: total, done });
  } catch (e) {
    await supabase.from("sync_log").insert({ source: fonte, rows_read: 0, status: "erro", error: String(e) });
    return Response.json({ store, mode, error: String(e) }, { status: 500 });
  }
});
