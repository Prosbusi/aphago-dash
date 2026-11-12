// Grava os códigos de produto como tags na Shopify: AP0006 (família) e AP0006-c (produto).
// Corpo: { "store": "aphago" | "abrasso" }. Remove tags de código antigas que não batem com a proposta.
// Lê public.v_produto_codigos (pendente = tags de código diferentes do código definido no Pharol).
// Precisa da permissão write_products no app de cada loja.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const API_VERSION = "2026-07";
const TIME_BUDGET_MS = 100_000;
const LOTE = 8; // produtos por chamada GraphQL (2 mutações cada)

const STORES: Record<string, { prefix: string; shop: string }> = {
  aphago: { prefix: "", shop: "usematerne.myshopify.com" },
  abrasso: { prefix: "ABRASSO_", shop: "abrasso.myshopify.com" },
};

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    if (t && t.currentlyAvailable < 300) await sleep(((300 - t.currentlyAvailable) / t.restoreRate) * 1000);
    return body.data;
  }
  throw new Error("Shopify: limite de requisições excedido");
}

async function authorized(req: Request): Promise<boolean> {
  const key = req.headers.get("x-sync-key");
  if (!key) return false;
  const { data, error } = await supabase.rpc("check_sync_key", { k: key });
  return !error && data === true;
}

type Linha = { product_id: string; familia: string; codigo: string; tags_codigo: string[] };

Deno.serve(async (req) => {
  const started = Date.now();
  if (!(await authorized(req))) return new Response("unauthorized", { status: 401 });
  const body = await req.json().catch(() => ({}));
  const store: string = body.store ?? "aphago";
  const fonte = `codigos:${store}`;
  let gravados = 0;
  const erros: string[] = [];
  try {
    const c = creds(store);
    const token = await getToken(c);
    while (Date.now() - started < TIME_BUDGET_MS) {
      const { data, error } = await supabase
        .from("v_produto_codigos")
        .select("product_id,familia,codigo,tags_codigo")
        .eq("store", store)
        .eq("pendente", true)
        .order("product_id")
        .limit(LOTE * 10);
      if (error) throw new Error(error.message);
      const pend = (data ?? []) as Linha[];
      if (!pend.length) break;
      let avancou = false;
      for (let i = 0; i < pend.length && Date.now() - started < TIME_BUDGET_MS; i += LOTE) {
        const lote = pend.slice(i, i + LOTE);
        const partes: string[] = [];
        const vars: Record<string, unknown> = {};
        const decl: string[] = [];
        lote.forEach((l, k) => {
          const novas = [l.familia, l.codigo];
          const tirar = l.tags_codigo.filter((t) => !novas.includes(t));
          decl.push(`$id${k}: ID!`, `$add${k}: [String!]!`);
          vars[`id${k}`] = l.product_id;
          vars[`add${k}`] = novas;
          if (tirar.length) {
            decl.push(`$rm${k}: [String!]!`);
            vars[`rm${k}`] = tirar;
            partes.push(`r${k}: tagsRemove(id: $id${k}, tags: $rm${k}) { userErrors { message } }`);
          }
          partes.push(`a${k}: tagsAdd(id: $id${k}, tags: $add${k}) { userErrors { message } }`);
        });
        const res = await gql(c.shop, token, `mutation (${decl.join(", ")}) { ${partes.join("\n")} }`, vars);
        for (let k = 0; k < lote.length; k++) {
          const l = lote[k];
          const errs = [...(res[`r${k}`]?.userErrors ?? []), ...(res[`a${k}`]?.userErrors ?? [])];
          if (errs.length) { erros.push(`${l.codigo}: ${errs.map((e: { message: string }) => e.message).join("; ")}`); continue; }
          // espelha no Pharol: tira as tags de código antigas e põe as novas
          const { data: p } = await supabase.from("products").select("tags").eq("product_id", l.product_id).single();
          const tags = ((p?.tags ?? []) as string[]).filter((t) => !/^(AP|AB)\d{4}(-[a-z])?$/.test(t)).concat([l.familia, l.codigo]);
          await supabase.from("products").update({ tags }).eq("product_id", l.product_id);
          await supabase.from("produto_codigos").update({ gravado_em: new Date().toISOString() }).eq("product_id", l.product_id);
          gravados++;
          avancou = true;
        }
      }
      if (!avancou) break; // só erros neste lote: para, para não repetir
    }
    const { count } = await supabase.from("v_produto_codigos").select("product_id", { count: "exact", head: true })
      .eq("store", store).eq("pendente", true);
    await supabase.from("sync_log").insert({ source: fonte, rows_read: gravados, status: erros.length ? "parcial" : "ok", error: erros.slice(0, 20).join(" | ") || null });
    return Response.json({ store, gravados, restantes: count ?? 0, erros: erros.slice(0, 20) });
  } catch (e) {
    await supabase.from("sync_log").insert({ source: fonte, rows_read: gravados, status: "erro", error: String(e) });
    return Response.json({ store, gravados, error: String(e) }, { status: 500 });
  }
});
