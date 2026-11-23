// sync-gemini — custo e requisições diárias do Gemini (projeto do Customily no Google Cloud), em ia_custos_diarios.
// Custo: exportação de faturamento do Google Cloud para o BigQuery (custo + créditos, por dia de São Paulo).
// Requisições: Cloud Monitoring (serviceruntime request_count do generativelanguage.googleapis.com, só 2xx).
// Credencial: secret GOOGLE_BILLING_SA (JSON da conta de serviço, só leitura).
// Corpo: { desde?: "AAAA-MM-DD" } — padrão: últimos 35 dias (a fatura do Google chega com atraso e é corrigida depois).
import { createClient } from "jsr:@supabase/supabase-js@2";

const PROJETO = Deno.env.get("GEMINI_GCP_PROJECT") ?? "gen-lang-client-0455499176";
const DATASET = Deno.env.get("GEMINI_BILLING_DATASET") ?? "faturamento";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const diaSP = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const inicioDiaSP = (iso: string) => new Date(`${iso}T03:00:00Z`); // São Paulo é UTC-3 o ano todo

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function tokenGoogle() {
  const raw = Deno.env.get("GOOGLE_BILLING_SA");
  if (!raw) throw new Error("secret GOOGLE_BILLING_SA não configurado");
  const sa = JSON.parse(raw);
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const agora = Math.floor(Date.now() / 1000);
  const corpo = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/bigquery https://www.googleapis.com/auth/monitoring.read",
    aud: "https://oauth2.googleapis.com/token",
    iat: agora,
    exp: agora + 3600,
  }))}`;
  const assinatura = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(corpo));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${corpo}.${b64url(assinatura)}` }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(`token Google ${r.status}: ${JSON.stringify(b)}`);
  return b.access_token as string;
}

async function google(token: string, url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const b = await r.json();
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}: ${b?.error?.message ?? JSON.stringify(b)}`);
  return b;
}

type Dia = { custo?: number; moeda?: string; requisicoes?: number };

async function custos(token: string, desde: string, dias: Map<string, Dia>) {
  const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJETO}`;
  const lista = await google(token, `${base}/datasets/${DATASET}/tables?maxResults=100`);
  // deno-lint-ignore no-explicit-any
  const tabela = (lista.tables ?? []).map((t: any) => t.tableReference.tableId).find((t: string) => t.startsWith("gcp_billing_export_v1_"));
  if (!tabela) return { tabela: null };
  const q = await google(token, `${base}/queries`, {
    method: "POST",
    body: JSON.stringify({
      useLegacySql: false,
      timeoutMs: 60000,
      parameterMode: "NAMED",
      query: `
        SELECT FORMAT_DATE('%F', DATE(usage_start_time, 'America/Sao_Paulo')) AS dia, currency,
               SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS custo
        FROM \`${PROJETO}.${DATASET}.${tabela}\`
        WHERE project.id = @proj AND DATE(usage_start_time, 'America/Sao_Paulo') >= @desde
        GROUP BY 1, 2 ORDER BY 1`,
      queryParameters: [
        { name: "proj", parameterType: { type: "STRING" }, parameterValue: { value: PROJETO } },
        { name: "desde", parameterType: { type: "DATE" }, parameterValue: { value: desde } },
      ],
    }),
  });
  if (!q.jobComplete) throw new Error("BigQuery: consulta não terminou a tempo");
  // deno-lint-ignore no-explicit-any
  for (const row of (q.rows ?? []) as any[]) {
    const [dia, moeda, custo] = row.f.map((c: { v: string }) => c.v);
    const d = dias.get(dia) ?? {};
    d.custo = (d.custo ?? 0) + Number(custo);
    d.moeda = moeda;
    dias.set(dia, d);
  }
  return { tabela };
}

async function requisicoes(token: string, desde: string, dias: Map<string, Dia>) {
  const hoje = diaSP(new Date());
  const filtro = [
    'metric.type="serviceruntime.googleapis.com/api/request_count"',
    'resource.type="consumed_api"',
    'resource.labels.service="generativelanguage.googleapis.com"',
    'metric.labels.response_code_class="2xx"',
  ].join(" AND ");
  const inicio = [desde, addDays(hoje, -40)].sort().reverse()[0]; // o Monitoring guarda ~6 semanas
  const janelas: [Date, Date, number][] = [];
  if (inicio < hoje) janelas.push([inicioDiaSP(inicio), inicioDiaSP(hoje), 86400]);
  const agora = new Date();
  const parcial = Math.floor((agora.getTime() - inicioDiaSP(hoje).getTime()) / 1000);
  if (parcial >= 60) janelas.push([inicioDiaSP(hoje), new Date(inicioDiaSP(hoje).getTime() + parcial * 1000), parcial]);
  for (const [ini, fim, periodo] of janelas) {
    const p = new URLSearchParams({
      filter: filtro,
      "interval.startTime": ini.toISOString(),
      "interval.endTime": fim.toISOString(),
      "aggregation.alignmentPeriod": `${periodo}s`,
      "aggregation.perSeriesAligner": "ALIGN_DELTA",
      "aggregation.crossSeriesReducer": "REDUCE_SUM",
    });
    const b = await google(token, `https://monitoring.googleapis.com/v3/projects/${PROJETO}/timeSeries?${p}`);
    // deno-lint-ignore no-explicit-any
    for (const serie of (b.timeSeries ?? []) as any[]) {
      for (const pt of serie.points ?? []) {
        const dia = diaSP(new Date(new Date(pt.interval.endTime).getTime() - 1000));
        const d = dias.get(dia) ?? {};
        d.requisicoes = (d.requisicoes ?? 0) + Number(pt.value.int64Value ?? pt.value.doubleValue ?? 0);
        dias.set(dia, d);
      }
    }
  }
}

async function cambio(moeda: string) {
  if (moeda === "BRL") return 1;
  const r = await fetch(`https://economia.awesomeapi.com.br/json/last/${moeda}-BRL`);
  const b = await r.json();
  const v = Number(b?.[`${moeda}BRL`]?.bid);
  if (!v) throw new Error(`câmbio ${moeda}-BRL indisponível`);
  return v;
}

async function authorized(req: Request): Promise<boolean> {
  const key = req.headers.get("x-sync-key");
  if (!key) return false;
  const { data, error } = await sb.rpc("check_sync_key", { k: key });
  return !error && data === true;
}

Deno.serve(async (req) => {
  if (!(await authorized(req))) return new Response("unauthorized", { status: 401 });
  const body = await req.json().catch(() => ({}));
  const hoje = diaSP(new Date());
  const desde: string = /^\d{4}-\d{2}-\d{2}$/.test(body.desde ?? "") ? body.desde : addDays(hoje, -35);
  try {
    const token = await tokenGoogle();
    const dias = new Map<string, Dia>();
    const { tabela } = await custos(token, desde, dias);
    let aviso: string | null = null;
    try {
      await requisicoes(token, desde, dias);
    } catch (e) {
      aviso = `requisições não lidas: ${String(e)}`;
    }
    const taxas = new Map<string, number>();
    const rows = [];
    for (const [dia, d] of [...dias.entries()].sort()) {
      let custo_brl: number | null = null;
      let taxa: number | null = null;
      if (d.custo != null && d.moeda) {
        if (!taxas.has(d.moeda)) taxas.set(d.moeda, await cambio(d.moeda));
        taxa = taxas.get(d.moeda)!;
        custo_brl = Math.round(d.custo * taxa * 100) / 100;
      }
      rows.push({
        dia,
        custo: d.custo != null ? Math.round(d.custo * 1e6) / 1e6 : null,
        moeda: d.moeda ?? null,
        cambio: taxa,
        custo_brl,
        requisicoes: d.requisicoes ?? null,
        atualizado_em: new Date().toISOString(),
      });
    }
    // não apaga custo já gravado quando o BigQuery ainda não tem o dia (só atualiza o que veio)
    for (const r of rows) {
      const campos = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null));
      const { error } = await sb.from("ia_custos_diarios").upsert(campos, { onConflict: "dia" });
      if (error) throw new Error(`ia_custos_diarios: ${error.message}`);
    }
    await sb.from("sync_log").insert({ source: "gemini", rows_read: rows.length, status: aviso ? "parcial" : "ok", error: aviso });
    return Response.json({ desde, tabela_faturamento: tabela ?? "ainda não criada pelo Google", aviso, dias: rows.length, ultimos: rows.slice(-5) });
  } catch (e) {
    await sb.from("sync_log").insert({ source: "gemini", rows_read: 0, status: "erro", error: String(e) });
    return Response.json({ desde, error: String(e) }, { status: 500 });
  }
});
