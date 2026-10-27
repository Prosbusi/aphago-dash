// Coleta do Shopify para as lojas do dashboard.
// Corpo da chamada: { "store": "aphago" | "abrasso", "mode": "incremental" | "backfill" | "products", "since"?: "2026-08-01", "restart"?: true }
// incremental (padrão): pedidos atualizados desde a última execução, com 2h de folga.
// backfill: pedidos criados desde `since`, em lotes, guardando o cursor entre chamadas.
// products: catálogo (para o gerador de UTM) e domínio público da loja.
// Segredos por loja: Aphago = SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / SHOPIFY_SHOP;
//                    Abrasso = ABRASSO_SHOPIFY_CLIENT_ID / ABRASSO_SHOPIFY_CLIENT_SECRET / ABRASSO_SHOPIFY_SHOP.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const API_VERSION = "2026-07";
const PAGE_SIZE = 10;
const TIME_BUDGET_MS = 110_000;

const STORES: Record<string, { prefix: string; shop: string }> = {
  aphago: { prefix: "", shop: "usematerne.myshopify.com" },
  abrasso: { prefix: "ABRASSO_", shop: "abrasso.myshopify.com" },
};

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const ORDERS_QUERY = `
query ($first: Int!, $after: String, $q: String!) {
  orders(first: $first, after: $after, sortKey: UPDATED_AT, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt updatedAt cancelledAt displayFinancialStatus email phone
      customer { id }
      shippingAddress { phone }
      currentTotalPriceSet { shopMoney { amount } }
      currentSubtotalPriceSet { shopMoney { amount } }
      currentShippingPriceSet { shopMoney { amount } }
      currentTotalDiscountsSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      discountCodes
      lineItems(first: 30) {
        nodes { id title variantTitle sku quantity product { id } discountedTotalSet { shopMoney { amount } } }
      }
      customerJourneySummary {
        ready customerOrderIndex daysToConversion momentsCount { count }
        firstVisit { ...V }
        lastVisit { ...V }
        moments(first: 30) { nodes { ... on CustomerVisit { ...V } } }
      }
    }
  }
}
fragment V on CustomerVisit {
  id occurredAt source referrerUrl landingPage
  utmParameters { source medium campaign content term }
}`;

const PRODUCTS_QUERY = `
query ($first: Int!, $after: String) {
  shop { primaryDomain { url } }
  products(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id title handle status onlineStoreUrl featuredMedia { preview { image { url } } } }
  }
}`;

type Visit = {
  id: string; occurredAt: string; source: string | null; referrerUrl: string | null; landingPage: string | null;
  utmParameters: { source?: string; medium?: string; campaign?: string; content?: string; term?: string } | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (s?: { shopMoney?: { amount?: string } }) => (s?.shopMoney?.amount != null ? Number(s.shopMoney.amount) : null);

function creds(store: string) {
  const cfg = STORES[store];
  if (!cfg) throw new Error(`loja desconhecida: ${store}`);
  const id = Deno.env.get(`${cfg.prefix}SHOPIFY_CLIENT_ID`);
  const secret = Deno.env.get(`${cfg.prefix}SHOPIFY_CLIENT_SECRET`);
  const shop = Deno.env.get(`${cfg.prefix}SHOPIFY_SHOP`) ?? cfg.shop;
  if (!id || !secret) throw new Error(`segredos ${cfg.prefix}SHOPIFY_CLIENT_ID/SECRET não configurados`);
  return { id, secret, shop };
}

async function getToken(c: { id: string; secret: string; shop: string }): Promise<string> {
  const res = await fetch(`https://${c.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: c.id, client_secret: c.secret, grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`token Shopify ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function gql(shop: string, token: string, query: string, variables: Record<string, unknown>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json();
    const throttled = body.errors?.some((e: { extensions?: { code?: string } }) => e.extensions?.code === "THROTTLED");
    if (res.status === 429 || throttled) { await sleep(2000 * (attempt + 1)); continue; }
    if (body.errors) throw new Error(JSON.stringify(body.errors));
    const t = body.extensions?.cost?.throttleStatus;
    if (t && t.currentlyAvailable < 600) await sleep(((600 - t.currentlyAvailable) / t.restoreRate) * 1000);
    return body.data;
  }
  throw new Error("Shopify: limite de requisições excedido");
}

function phoneDigits(p?: string | null): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d;
}

function utmId(url?: string | null): string | null {
  if (!url) return null;
  try { return new URL(url, "https://x").searchParams.get("utm_id"); } catch { return null; }
}

function visitCols(prefix: "first" | "last", v: Visit | null) {
  const u = v?.utmParameters ?? {};
  return {
    [`${prefix}_source`]: u.source ?? null,
    [`${prefix}_medium`]: u.medium ?? null,
    [`${prefix}_campaign`]: u.campaign ?? null,
    [`${prefix}_content`]: u.content ?? null,
    [`${prefix}_term`]: u.term ?? null,
    [`${prefix}_utm_id`]: utmId(v?.landingPage),
    [`${prefix}_landing_page`]: v?.landingPage ?? null,
    [`${prefix}_referrer`]: v?.referrerUrl ?? null,
    [`${prefix}_source_label`]: v?.source ?? null,
  };
}

// deno-lint-ignore no-explicit-any
function mapOrder(store: string, o: any) {
  const j = o.customerJourneySummary;
  const order = {
    store,
    order_id: o.id,
    order_number: o.name,
    created_at: o.createdAt,
    customer_id: o.customer?.id ?? null,
    phone: phoneDigits(o.phone ?? o.shippingAddress?.phone),
    email: o.email ? String(o.email).trim().toLowerCase() : null,
    total: num(o.currentTotalPriceSet) ?? 0,
    subtotal: num(o.currentSubtotalPriceSet),
    shipping: num(o.currentShippingPriceSet),
    discounts: num(o.currentTotalDiscountsSet),
    refunded: num(o.totalRefundedSet) ?? 0,
    discount_codes: o.discountCodes ?? [],
    financial_status: o.displayFinancialStatus,
    cancelled_at: o.cancelledAt,
    customer_order_index: j?.customerOrderIndex ?? null,
    days_to_conversion: j?.daysToConversion ?? null,
    visits_count: j?.momentsCount?.count ?? null,
    ...visitCols("first", j?.firstVisit ?? null),
    ...visitCols("last", j?.lastVisit ?? null),
    raw: { updatedAt: o.updatedAt, journeyReady: j?.ready ?? null },
    synced_at: new Date().toISOString(),
  };
  // deno-lint-ignore no-explicit-any
  const items = (o.lineItems?.nodes ?? []).map((li: any) => ({
    store,
    line_id: li.id,
    order_id: o.id,
    product_id: li.product?.id ?? null,
    product_title: li.title,
    variant_title: li.variantTitle,
    sku: li.sku,
    quantity: li.quantity,
    amount: num(li.discountedTotalSet) ?? 0,
  }));
  const moments: Visit[] = (j?.moments?.nodes ?? []).filter((m: Visit) => m?.id);
  moments.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const visits = moments.map((v, i) => ({
    store,
    visit_id: v.id,
    order_id: o.id,
    occurred_at: v.occurredAt,
    position: i + 1,
    source: v.utmParameters?.source ?? null,
    medium: v.utmParameters?.medium ?? null,
    campaign: v.utmParameters?.campaign ?? null,
    content: v.utmParameters?.content ?? null,
    term: v.utmParameters?.term ?? null,
    utm_id: utmId(v.landingPage),
    landing_page: v.landingPage,
    referrer: v.referrerUrl,
    source_label: v.source,
  }));
  return { order, items, visits };
}

async function upsert(table: string, data: unknown[], key: string) {
  if (!data.length) return;
  const { error } = await supabase.from(table).upsert(data, { onConflict: key });
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function saveOrders(rows: ReturnType<typeof mapOrder>[]) {
  await upsert("orders", rows.map((r) => r.order), "order_id");
  await upsert("order_items", rows.flatMap((r) => r.items), "line_id");
  await upsert("visits", rows.flatMap((r) => r.visits), "visit_id");
}

async function authorized(req: Request): Promise<boolean> {
  const key = req.headers.get("x-sync-key");
  if (!key) return false;
  const { data, error } = await supabase.rpc("check_sync_key", { k: key });
  return !error && data === true;
}

async function log(source: string, rows: number, status: string, error?: string) {
  await supabase.from("sync_log").insert({ source, rows_read: rows, status, error: error ?? null });
}

async function syncProducts(store: string, started: number) {
  const c = creds(store);
  const token = await getToken(c);
  let after: string | null = null;
  let total = 0;
  let siteUrl: string | null = null;
  while (Date.now() - started < TIME_BUDGET_MS) {
    const data = await gql(c.shop, token, PRODUCTS_QUERY, { first: 50, after });
    siteUrl = data.shop?.primaryDomain?.url ?? siteUrl;
    // deno-lint-ignore no-explicit-any
    const rows = data.products.nodes.map((p: any) => ({
      product_id: p.id,
      store,
      title: p.title,
      handle: p.handle,
      status: p.status,
      online_url: p.onlineStoreUrl,
      image_url: p.featuredMedia?.preview?.image?.url ?? null,
      updated_at: new Date().toISOString(),
    }));
    await upsert("products", rows, "product_id");
    total += rows.length;
    after = data.products.pageInfo.endCursor;
    if (!data.products.pageInfo.hasNextPage) break;
  }
  if (siteUrl) await supabase.from("stores").update({ site_url: siteUrl.replace(/\/$/, ""), updated_at: new Date().toISOString() }).eq("store", store);
  return total;
}

Deno.serve(async (req) => {
  const started = Date.now();
  if (!(await authorized(req))) return new Response("unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const store: string = body.store ?? "aphago";
  const mode: string = body.mode ?? "incremental";
  const stateKey = `${mode === "backfill" ? "shopify_backfill" : mode === "products" ? "shopify_products" : "shopify"}:${store}`;

  if (mode === "scopes") {
    // diagnóstico: permissões que a loja concedeu ao app
    try {
      const c = creds(store);
      const token = await getToken(c);
      const res = await fetch(`https://${c.shop}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query: "{ shop { name myshopifyDomain } currentAppInstallation { accessScopes { handle } } }" }),
      });
      return Response.json({ store, ...(await res.json()) });
    } catch (e) {
      return Response.json({ store, error: String(e) }, { status: 500 });
    }
  }

  if (mode === "products") {
    try {
      const n = await syncProducts(store, started);
      await log(stateKey, n, "ok");
      return Response.json({ store, mode, rows: n });
    } catch (e) {
      await log(stateKey, 0, "erro", String(e));
      return Response.json({ store, mode, error: String(e) }, { status: 500 });
    }
  }

  const { data: state } = await supabase.from("sync_state").select("*").eq("source", stateKey).maybeSingle();
  let saved: { q?: string; after?: string | null; done?: boolean } = {};
  try { saved = state?.cursor ? JSON.parse(state.cursor) : {}; } catch { saved = {}; }

  let q: string;
  let after: string | null = null;
  if (mode === "backfill") {
    if (body.restart || !saved.q) {
      q = `created_at:>='${body.since ?? "2026-08-01"}T00:00:00-03:00'`;
    } else {
      if (saved.done) return Response.json({ store, mode, done: true, message: "backfill já concluído" });
      q = saved.q;
      after = saved.after ?? null;
    }
  } else {
    const last = state?.last_run_at ? new Date(state.last_run_at) : new Date(Date.now() - 3 * 864e5);
    q = `updated_at:>='${new Date(last.getTime() - 2 * 3600e3).toISOString()}'`;
  }

  let total = 0;
  let done = false;
  try {
    const c = creds(store);
    const token = await getToken(c);
    while (Date.now() - started < TIME_BUDGET_MS) {
      const data = await gql(c.shop, token, ORDERS_QUERY, { first: PAGE_SIZE, after, q });
      const rows = data.orders.nodes.map((o: unknown) => mapOrder(store, o));
      await saveOrders(rows);
      total += rows.length;
      after = data.orders.pageInfo.endCursor;
      if (!data.orders.pageInfo.hasNextPage) { done = true; break; }
    }
    await supabase.from("sync_state").upsert({
      source: stateKey,
      cursor: mode === "backfill" ? JSON.stringify({ q, after, done }) : null,
      last_run_at: mode === "backfill" || done ? new Date(started).toISOString() : state?.last_run_at ?? null,
    });
    await log(stateKey, total, done ? "ok" : "parcial");
    return Response.json({ store, mode, rows: total, done });
  } catch (e) {
    await log(stateKey, total, "erro", String(e));
    return Response.json({ store, mode, rows: total, error: String(e) }, { status: 500 });
  }
});
