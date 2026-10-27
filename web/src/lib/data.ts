import { useEffect, useState } from "react";
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
  const key = `${store ?? "todas"}|${p.prevStart}|${p.end}`;
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
  useEffect(() => {
    supabase
      .from("sync_log")
      .select("ran_at,status")
      .neq("status", "erro")
      .order("ran_at", { ascending: false })
      .limit(1)
      .then(({ data }) => setAt(data?.[0]?.ran_at ?? null));
  }, []);
  return at;
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
