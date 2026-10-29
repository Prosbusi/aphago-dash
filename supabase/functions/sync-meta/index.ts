// Coleta do investimento do Meta Ads -> ad_spend (platform = 'meta').
// Corpo: { "store": "aphago" | "abrasso", "mode": "incremental" | "backfill" | "contas", "since"?: "2026-08-01", "restart"?: true }
// incremental (padrão): reenvia os últimos 3 dias. backfill: desde `since`, em janelas de 7 dias, guardando o cursor.
// contas: lista as contas de anúncio que o token enxerga (diagnóstico).
// Segredos: META_ACCESS_TOKEN_APHAGO, META_ACCESS_TOKEN_ABRASSO (token de usuário do sistema, permissão ads_read).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const GRAPH = "https://graph.facebook.com/v24.0";
const TIME_BUDGET_MS = 110_000;
const JANELA_DIAS = 7;

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
  const token = Deno.env.get(`META_ACCESS_TOKEN_${store.toUpperCase()}`);
  const fonte = `meta${mode === "backfill" ? "_backfill" : ""}:${store}`;
  if (!token) return Response.json({ store, error: `segredo META_ACCESS_TOKEN_${store.toUpperCase()} não configurado` }, { status: 500 });

  try {
    const lista = await contas(token);
    if (mode === "contas") return Response.json({ store, contas: lista });
    const ativas = lista.filter((c) => c.account_status === 1);

    const hoje = isoSP(new Date());
    let desde: string;
    let ate = hoje;
    let cursor: string | null = null;
    if (mode === "backfill") {
      const { data: st } = await supabase.from("sync_state").select("cursor").eq("source", fonte).maybeSingle();
      cursor = body.restart || !st?.cursor ? (body.since ?? "2026-08-01") : st.cursor;
      if (cursor === "fim") return Response.json({ store, mode, done: true });
      desde = cursor!;
    } else {
      desde = addDays(hoje, -2);
    }

    let total = 0;
    let done = false;
    while (Date.now() - started < TIME_BUDGET_MS) {
      const fimJanela = mode === "backfill" ? [addDays(desde, JANELA_DIAS - 1), hoje].sort()[0] : ate;
      for (const c of ativas) {
        const rows = await insights(store, token, c.id, desde, fimJanela);
        await gravar(store, c.id, desde, fimJanela, rows);
        total += rows.length;
      }
      if (mode !== "backfill" || fimJanela >= hoje) { done = true; break; }
      desde = addDays(fimJanela, 1);
    }
    if (mode === "backfill") {
      await supabase.from("sync_state").upsert({ source: fonte, cursor: done ? "fim" : desde, last_run_at: new Date().toISOString() });
    }
    await supabase.from("sync_log").insert({ source: fonte, rows_read: total, status: done ? "ok" : "parcial" });
    return Response.json({ store, mode, contas: ativas.map((c) => `${c.name} (${c.id})`), linhas: total, done });
  } catch (e) {
    await supabase.from("sync_log").insert({ source: fonte, rows_read: 0, status: "erro", error: String(e) });
    return Response.json({ store, mode, error: String(e) }, { status: 500 });
  }
});
