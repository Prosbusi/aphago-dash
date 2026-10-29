// Recebe o investimento enviado pelo script do Google Ads (scripts/google-ads.js) e grava em ad_spend.
// Cabeçalho x-ingest-key = segredo 'ads_ingest_key' do Vault.
// Corpo: { store, customer_id, desde, ate, rows: [{ day, campaign_id, campaign_name, channel, cost, impressions, clicks, conversions, conversion_value }] }
// Os dias de `desde` a `ate` são substituídos por inteiro, para campanhas removidas não ficarem para trás.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const DIA = /^\d{4}-\d{2}-\d{2}$/;

type Row = {
  day: string; campaign_id: string; campaign_name: string; channel?: string;
  cost: number; impressions?: number; clicks?: number; conversions?: number; conversion_value?: number;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("use POST", { status: 405 });
  const key = req.headers.get("x-ingest-key") ?? "";
  const { data: ok } = await supabase.rpc("check_ads_key", { k: key });
  if (ok !== true) return new Response("unauthorized", { status: 401 });

  let body: { store?: string; customer_id?: string; desde?: string; ate?: string; rows?: Row[] };
  try { body = await req.json(); } catch { return new Response("json inválido", { status: 400 }); }

  const store = String(body.store ?? "").toLowerCase();
  const account = String(body.customer_id ?? "").replace(/\D/g, "");
  const { data: loja } = await supabase.from("stores").select("store").eq("store", store).maybeSingle();
  if (!loja) return new Response(`loja desconhecida: ${store}`, { status: 400 });
  if (!account) return new Response("customer_id ausente", { status: 400 });
  if (!DIA.test(body.desde ?? "") || !DIA.test(body.ate ?? "")) return new Response("desde/ate inválidos", { status: 400 });

  const rows = (body.rows ?? [])
    .filter((r) => DIA.test(r.day) && r.campaign_id)
    .map((r) => ({
      store,
      day: r.day,
      platform: "google",
      account_id: account,
      campaign_id: String(r.campaign_id),
      campaign_name: r.campaign_name ?? null,
      adset_id: "",
      adset_name: null,
      ad_id: "",
      ad_name: null,
      placement: (r.channel ?? "").toLowerCase(),
      spend: Number(r.cost) || 0,
      impressions: Math.round(Number(r.impressions) || 0),
      clicks: Math.round(Number(r.clicks) || 0),
      platform_purchases: Number(r.conversions) || 0,
      platform_revenue: Number(r.conversion_value) || 0,
      synced_at: new Date().toISOString(),
    }));

  const del = await supabase.from("ad_spend").delete()
    .eq("store", store).eq("platform", "google").eq("account_id", account)
    .gte("day", body.desde!).lte("day", body.ate!);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500 });

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("ad_spend").insert(rows.slice(i, i + 500));
    if (error) {
      await supabase.from("sync_log").insert({ source: `google_ads:${store}`, rows_read: i, status: "erro", error: error.message });
      return Response.json({ error: error.message }, { status: 500 });
    }
  }
  const gasto = rows.reduce((s, r) => s + r.spend, 0);
  await supabase.from("sync_log").insert({ source: `google_ads:${store}`, rows_read: rows.length, status: "ok" });
  return Response.json({ ok: true, store, linhas: rows.length, gasto: Math.round(gasto * 100) / 100 });
});
