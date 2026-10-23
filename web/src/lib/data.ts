import { useEffect, useState } from "react";
import { fetchAll, supabase } from "./supabase";
import type { Period } from "./period";

export type OrderRow = {
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
  order_id: string;
  dia: string;
  product_id: string | null;
  product_title: string;
  quantity: number;
  amount: number;
  canal_ultimo: string;
};

type DashData = { orders: OrderRow[]; prevOrders: OrderRow[]; items: ItemRow[] };

const cache = new Map<string, Promise<DashData>>();

async function load(p: Period): Promise<DashData> {
  const cols =
    "order_id,dia,total,cliente_novo,canal_ultimo,grupo_ultimo,chave_ultimo,canal_primeiro,grupo_primeiro,days_to_conversion,visits_count,acao_ultima";
  const [all, items] = await Promise.all([
    fetchAll<OrderRow>((from, to) =>
      supabase.from("v_orders").select(cols).gte("dia", p.prevStart).lte("dia", p.end).order("order_id").range(from, to),
    ),
    fetchAll<ItemRow>((from, to) =>
      supabase
        .from("v_order_items")
        .select("order_id,dia,product_id,product_title,quantity,amount,canal_ultimo")
        .gte("dia", p.start)
        .lte("dia", p.end)
        .order("line_id")
        .range(from, to),
    ),
  ]);
  const norm = (o: OrderRow) => ({ ...o, total: Number(o.total) });
  return {
    orders: all.filter((o) => o.dia >= p.start).map(norm),
    prevOrders: all.filter((o) => o.dia <= p.prevEnd).map(norm),
    items: items.map((i) => ({ ...i, amount: Number(i.amount) })),
  };
}

export function useDashData(p: Period) {
  const key = `${p.prevStart}|${p.end}`;
  const [state, setState] = useState<{ data?: DashData; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    if (!cache.has(key)) cache.set(key, load(p));
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
