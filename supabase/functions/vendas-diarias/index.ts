// Vendas e custo de produto por dia (tabela vendas_diarias), direto da Shopify, para a projeção diária.
// Venda = valor original do pedido pago (pago, parcialmente reembolsado ou reembolsado), no dia do pedido (São Paulo).
// Estorno = cada reembolso, no dia em que foi feito (tabela estornos), como no relatório de vendas da Shopify.
// Custo = custo atual da variante na Shopify (inventoryItem.unitCost) × quantidade atual da linha.
// Corpo: { store, mode }
//   mode "recente" (padrão): hoje e os 2 dias anteriores, por consulta paginada.
//   mode "historico": { desde, ate, restart? } — operações em massa (bulk) mês a mês, do mais recente para trás; chame de novo até "concluido".
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const API_VERSION = "2026-07";
const STORES: Record<string, { prefix: string; shop: string }> = {
  aphago: { prefix: "", shop: "usematerne.myshopify.com" },
  abrasso: { prefix: "ABRASSO_", shop: "abrasso.myshopify.com" },
};
const PAGO = new Set(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const diaSP = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const money = (s?: { shopMoney?: { amount?: string } } | null) => Number(s?.shopMoney?.amount ?? 0) || 0;

async function conexao(store: string) {
  const cfg = STORES[store];
  if (!cfg) throw new Error(`loja desconhecida: ${store}`);
  const shop = Deno.env.get(`${cfg.prefix}SHOPIFY_SHOP`) ?? cfg.shop;
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get(`${cfg.prefix}SHOPIFY_CLIENT_ID`),
      client_secret: Deno.env.get(`${cfg.prefix}SHOPIFY_CLIENT_SECRET`),
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`token Shopify ${res.status}`);
  const token = (await res.json()).access_token as string;
  const gql = async (query: string, variables: Record<string, unknown> = {}) => {
    for (let t = 0; t < 5; t++) {
      const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query, variables }),
      });
      const b = await r.json();
      if (r.status === 429 || b.errors?.some((e: { extensions?: { code?: string } }) => e.extensions?.code === "THROTTLED")) { await sleep(2000 * (t + 1)); continue; }
      if (b.errors) throw new Error(JSON.stringify(b.errors));
      const th = b.extensions?.cost?.throttleStatus;
      if (th && th.currentlyAvailable < 500) await sleep(((500 - th.currentlyAvailable) / th.restoreRate) * 1000);
      return b.data;
    }
    throw new Error("Shopify: limite de requisições");
  };
  return gql;
}

type Dia = { vendas: number; pedidos: number; unidades: number; custo_linhas: number; receita_com_custo: number; receita_sem_custo: number };
const vazio = (): Dia => ({ vendas: 0, pedidos: 0, unidades: 0, custo_linhas: 0, receita_com_custo: 0, receita_sem_custo: 0 });

function somarLinha(d: Dia, qtd: number, receita: number, custoUnit: number | null) {
  d.unidades += qtd;
  if (custoUnit != null && custoUnit > 0) { d.custo_linhas += custoUnit * qtd; d.receita_com_custo += receita; }
  else d.receita_sem_custo += receita;
}

async function gravar(store: string, desde: string, ate: string, dias: Map<string, Dia>) {
  const rows = [];
  for (let d = desde; d <= ate; d = addDays(d, 1)) {
    const v = dias.get(d) ?? vazio();
    const r2 = (n: number) => Math.round(n * 100) / 100;
    rows.push({
      store, dia: d, vendas: r2(v.vendas), pedidos: v.pedidos, unidades: v.unidades, custo_linhas: r2(v.custo_linhas),
      receita_com_custo: r2(v.receita_com_custo), receita_sem_custo: r2(v.receita_sem_custo), atualizado_em: new Date().toISOString(),
    });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("vendas_diarias").upsert(rows.slice(i, i + 500), { onConflict: "store,dia" });
    if (error) throw new Error(`vendas_diarias: ${error.message}`);
  }
  return rows.length;
}

type Estorno = { refund_id: string; store: string; order_id: string; pedido: string | null; pedido_dia: string; dia: string; valor: number; cancelado: boolean; atualizado_em: string };
// deno-lint-ignore no-explicit-any
function estornosDoPedido(store: string, o: any): Estorno[] {
  return (o.refunds ?? [])
    // deno-lint-ignore no-explicit-any
    .map((r: any) => ({
      refund_id: r.id, store, order_id: o.id, pedido: o.name ?? null, pedido_dia: diaSP(o.createdAt), dia: diaSP(r.createdAt),
      valor: Math.round(money(r.totalRefundedSet) * 100) / 100, cancelado: !!o.cancelledAt, atualizado_em: new Date().toISOString(),
    }))
    .filter((e: Estorno) => e.valor > 0);
}
async function gravarEstornos(lista: Estorno[]) {
  for (let i = 0; i < lista.length; i += 500) {
    const { error } = await supabase.from("estornos").upsert(lista.slice(i, i + 500), { onConflict: "refund_id" });
    if (error) throw new Error(`estornos: ${error.message}`);
  }
}

const filtro = (desde: string, ate: string) => `created_at:>='${desde}T00:00:00-03:00' AND created_at:<'${addDays(ate, 1)}T00:00:00-03:00'`;

const PAGINADA = `
query ($after: String, $q: String!) {
  orders(first: 10, after: $after, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt displayFinancialStatus
      totalPriceSet { shopMoney { amount } }
      refunds(first: 10) { id createdAt totalRefundedSet { shopMoney { amount } } }
      lineItems(first: 25) { nodes { currentQuantity discountedTotalSet { shopMoney { amount } } variant { inventoryItem { unitCost { amount } } } } }
    }
  }
}`;

const ESTORNOS = `
query ($after: String, $q: String!) {
  orders(first: 50, after: $after, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes { id name createdAt cancelledAt refunds(first: 10) { id createdAt totalRefundedSet { shopMoney { amount } } } }
  }
}`;

async function recente(store: string) {
  const gql = await conexao(store);
  const ate = diaSP(new Date().toISOString());
  const desde = addDays(ate, -2);
  const dias = new Map<string, Dia>();
  const estornos: Estorno[] = [];
  let after: string | null = null;
  do {
    const data = await gql(PAGINADA, { after, q: filtro(desde, ate) });
    // deno-lint-ignore no-explicit-any
    for (const o of data.orders.nodes as any[]) {
      estornos.push(...estornosDoPedido(store, o));
      if (!PAGO.has(o.displayFinancialStatus)) continue;
      const dia = diaSP(o.createdAt);
      const d = dias.get(dia) ?? vazio();
      d.vendas += money(o.totalPriceSet);
      d.pedidos += 1;
      for (const li of o.lineItems.nodes) {
        const custo = li.variant?.inventoryItem?.unitCost?.amount;
        somarLinha(d, li.currentQuantity ?? 0, money(li.discountedTotalSet), custo != null ? Number(custo) : null);
      }
      dias.set(dia, d);
    }
    after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
  } while (after);
  // reembolsos feitos nestes dias em pedidos mais antigos (o pedido é atualizado quando recebe o reembolso)
  after = null;
  do {
    const data = await gql(ESTORNOS, { after, q: `updated_at:>='${desde}T00:00:00-03:00' AND (financial_status:refunded OR financial_status:partially_refunded)` });
    // deno-lint-ignore no-explicit-any
    for (const o of data.orders.nodes as any[]) estornos.push(...estornosDoPedido(store, o));
    after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
  } while (after);
  await gravarEstornos(estornos);
  return { desde, ate, dias: await gravar(store, desde, ate, dias), estornos: estornos.length };
}

// Operação em massa (bulk) de um intervalo: devolve o id da operação.
async function abrirBulk(gql: Awaited<ReturnType<typeof conexao>>, desde: string, ate: string): Promise<string> {
  const consulta = `{
    orders(query: "${filtro(desde, ate)}") {
      edges { node {
        id name createdAt cancelledAt displayFinancialStatus
        totalPriceSet { shopMoney { amount } }
        refunds { id createdAt totalRefundedSet { shopMoney { amount } } }
        lineItems { edges { node { currentQuantity discountedTotalSet { shopMoney { amount } } variant { inventoryItem { unitCost { amount } } } } } }
      } }
    }
  }`;
  const data = await gql(
    `mutation ($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id status } userErrors { field message } } }`,
    { q: consulta },
  );
  const r = data.bulkOperationRunQuery;
  if (r.userErrors?.length) throw new Error(JSON.stringify(r.userErrors));
  return r.bulkOperation.id;
}

// Lê o resultado de uma operação em massa concluída e soma por dia.
async function lerBulk(store: string, url: string | null) {
  const dias = new Map<string, Dia>();
  const estornos: Estorno[] = [];
  const pedidos = new Map<string, Dia | null>();
  if (!url) return { dias, estornos };
  const res = await fetch(url);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "";
  const linha = (l: string) => {
    if (!l) return;
    const o = JSON.parse(l);
    if (o.__parentId) {
      const d = pedidos.get(o.__parentId);
      if (!d) return;
      const custo = o.variant?.inventoryItem?.unitCost?.amount;
      somarLinha(d, o.currentQuantity ?? 0, money(o.discountedTotalSet), custo != null ? Number(custo) : null);
      return;
    }
    estornos.push(...estornosDoPedido(store, o));
    if (!PAGO.has(o.displayFinancialStatus)) { pedidos.set(o.id, null); return; }
    const dia = diaSP(o.createdAt);
    const d = dias.get(dia) ?? vazio();
    d.vendas += money(o.totalPriceSet);
    d.pedidos += 1;
    dias.set(dia, d);
    pedidos.set(o.id, d);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    resto += value;
    const partes = resto.split("\n");
    resto = partes.pop() ?? "";
    for (const p of partes) linha(p);
  }
  linha(resto);
  return { dias, estornos };
}

const fimDoMes = (mes: string) => addDays(`${addMes(mes, 1)}-01`, -1);
function addMes(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

// Histórico mês a mês, do mês atual para trás (um arquivo grande estoura o limite da função):
// cada chamada coleta o mês pronto e abre o anterior, até chegar em `desde`.
async function historico(store: string, body: { desde?: string; ate?: string; restart?: boolean }) {
  const chave = `vendas_diarias_hist:${store}`;
  const { data: st } = await supabase.from("sync_state").select("cursor").eq("source", chave).maybeSingle();
  const hoje = diaSP(new Date().toISOString());
  let estado: { mes: string; primeiro: string; op: string | null; concluido?: string } =
    st?.cursor && !body.restart ? JSON.parse(st.cursor) : { mes: (body.ate ?? hoje).slice(0, 7), primeiro: (body.desde ?? "2025-01-01").slice(0, 7), op: null };
  if (estado.concluido === "sim") return { status: "concluido" };
  const gql = await conexao(store);
  let gravados = 0;
  if (estado.op) {
    const data = await gql(`query ($id: ID!) { node(id: $id) { ... on BulkOperation { status errorCode url } } }`, { id: estado.op });
    const op = data.node;
    if (op.status === "CREATED" || op.status === "RUNNING") return { status: "rodando", mes: estado.mes };
    if (op.status !== "COMPLETED") throw new Error(`operação ${op.status} ${op.errorCode ?? ""} no mês ${estado.mes}`);
    const inicio = `${estado.mes}-01`;
    const fim = [fimDoMes(estado.mes), hoje].sort()[0];
    const lido = await lerBulk(store, op.url);
    await gravarEstornos(lido.estornos);
    gravados = await gravar(store, inicio, fim, lido.dias);
    estado = { ...estado, mes: addMes(estado.mes, -1), op: null };
  }
  if (estado.mes >= estado.primeiro) estado.op = await abrirBulk(gql, `${estado.mes}-01`, fimDoMes(estado.mes));
  else estado.concluido = "sim";
  await supabase.from("sync_state").upsert({ source: chave, cursor: JSON.stringify(estado), last_run_at: new Date().toISOString() });
  return { status: estado.concluido ? "concluido" : "proximo", mes: estado.mes, dias_gravados: gravados };
}

async function authorized(req: Request): Promise<boolean> {
  const key = req.headers.get("x-sync-key");
  if (!key) return false;
  const { data, error } = await supabase.rpc("check_sync_key", { k: key });
  return !error && data === true;
}

Deno.serve(async (req) => {
  if (!(await authorized(req))) return new Response("unauthorized", { status: 401 });
  const body = await req.json().catch(() => ({}));
  const store: string = body.store ?? "aphago";
  const mode: string = body.mode ?? "recente";
  try {
    const r = mode === "historico" ? await historico(store, body) : await recente(store);
    await supabase.from("sync_log").insert({ source: `vendas_diarias:${store}`, rows_read: 0, status: "ok" });
    return Response.json({ store, mode, ...r });
  } catch (e) {
    await supabase.from("sync_log").insert({ source: `vendas_diarias:${store}`, rows_read: 0, status: "erro", error: String(e) });
    return Response.json({ store, mode, error: String(e) }, { status: 500 });
  }
});
