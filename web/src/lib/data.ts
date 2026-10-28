import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { fetchAll, supabase } from "./supabase";
import type { Period } from "./period";

export type StoreId = "aphago" | "abrasso";

export type OrderRow = {
  store: StoreId;
  order_id: string;
  dia: string;
  total: number;
  cliente_novo: boolean | null;
  canal_ultimo: string;
  grupo_ultimo: string;
  chave_ultimo: string;
  canal_primeiro: string;
  grupo_primeiro: string;
  days_to_conversion: number | null;
  visits_count: number | null;
  acao_ultima: string | null;
};

export type ItemRow = {
  store: StoreId;
  order_id: string;
  dia: string;
  product_id: string | null;
  product_title: string;
  quantity: number;
  amount: number;
  canal_ultimo: string;
};

export type DashData = { orders: OrderRow[]; prevOrders: OrderRow[]; items: ItemRow[] };

const cache = new Map<string, Promise<DashData>>();

// versão dos dados: sobe quando alguém pede "Atualizar agora", e as telas recarregam
let version = 0;
const subs = new Set<() => void>();
function subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export function useDataVersion() { return useSyncExternalStore(subscribe, () => version); }
export function bumpData() { cache.clear(); version += 1; subs.forEach((f) => f()); }

async function load(p: Period, store: StoreId | null): Promise<DashData> {
  const cols =
    "store,order_id,dia,total,cliente_novo,canal_ultimo,grupo_ultimo,chave_ultimo,canal_primeiro,grupo_primeiro,days_to_conversion,visits_count,acao_ultima";
  const [all, items] = await Promise.all([
    fetchAll<OrderRow>((from, to) => {
      let q = supabase.from("v_orders").select(cols).gte("dia", p.prevStart).lte("dia", p.end);
      if (store) q = q.eq("store", store);
      return q.order("order_id").range(from, to);
    }),
    fetchAll<ItemRow>((from, to) => {
      let q = supabase
        .from("v_order_items")
        .select("store,order_id,dia,product_id,product_title,quantity,amount,canal_ultimo")
        .gte("dia", p.start)
        .lte("dia", p.end);
      if (store) q = q.eq("store", store);
      return q.order("line_id").range(from, to);
    }),
  ]);
  const norm = (o: OrderRow) => ({ ...o, total: Number(o.total) });
  return {
    orders: all.filter((o) => o.dia >= p.start).map(norm),
    prevOrders: all.filter((o) => o.dia <= p.prevEnd).map(norm),
    items: items.map((i) => ({ ...i, amount: Number(i.amount) })),
  };
}

/** Dados do período; `store` null = as duas lojas juntas. */
export function useDashData(p: Period, store: StoreId | null) {
  const v = useDataVersion();
  const key = `${store ?? "todas"}|${p.prevStart}|${p.end}|${v}`;
  const [state, setState] = useState<{ data?: DashData; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    if (!cache.has(key)) cache.set(key, load(p, store));
    cache
      .get(key)!
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e: Error) => {
        cache.delete(key);
        if (alive) setState({ error: e.message, loading: false });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function clearDataCache() {
  cache.clear();
}

/** Última execução da coleta, para o "Atualizado há…" */
export function useLastSync() {
  const [at, setAt] = useState<string | null>(null);
  const v = useDataVersion();
  useEffect(() => {
    supabase
      .from("sync_log")
      .select("ran_at,status")
      .neq("status", "erro")
      .order("ran_at", { ascending: false })
      .limit(1)
      .then(({ data }) => setAt(data?.[0]?.ran_at ?? null));
  }, [v]);
  return at;
}

export type RefreshState = "idle" | "running" | "recent" | "error";

/** "Atualizar agora": pede uma coleta imediata das lojas e recarrega as telas quando ela termina. */
export function useRefresh() {
  const [state, setState] = useState<RefreshState>("idle");
  const run = useCallback(async () => {
    setState("running");
    const { data, error } = await supabase.rpc("request_sync");
    if (error) { setState("error"); return; }
    const res = data as { status: string; pedido_em: string };
    if (res.status === "recente") { setState("recent"); window.setTimeout(() => setState("idle"), 4000); return; }
    const desde = res.pedido_em;
    const lojas = (await supabase.from("stores").select("store")).data?.length ?? 2;
    const fim = Date.now() + 150_000;
    while (Date.now() < fim) {
      await new Promise((r) => setTimeout(r, 5000));
      const { data: log } = await supabase.from("sync_log").select("source").like("source", "shopify:%").gte("ran_at", desde);
      if ((log?.length ?? 0) >= lojas) break;
    }
    bumpData();
    setState("idle");
  }, []);
  return { state, run };
}

export type StoreInfo = { store: StoreId; nome: string; site_url: string | null };

let storesPromise: Promise<StoreInfo[]> | null = null;
export function useStores() {
  const [stores, setStores] = useState<StoreInfo[] | null>(null);
  useEffect(() => {
    if (!storesPromise) {
      storesPromise = Promise.resolve(
        supabase.from("stores").select("store,nome,site_url").order("store", { ascending: false }),
      ).then(({ data, error }) => {
        if (error) { storesPromise = null; throw new Error(error.message); }
        return (data ?? []) as StoreInfo[];
      });
    }
    storesPromise.then(setStores).catch(() => setStores([]));
  }, []);
  return stores;
}
