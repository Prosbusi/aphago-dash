import type { ItemRow, OrderRow } from "./data";

export type Kpis = { fat: number; ped: number; ticket: number; novos: number };

export function kpis(orders: OrderRow[]): Kpis {
  const fat = orders.reduce((s, o) => s + o.total, 0);
  const ped = orders.length;
  return { fat, ped, ticket: ped ? fat / ped : 0, novos: orders.filter((o) => o.cliente_novo).length };
}

export function byDay(orders: OrderRow[], days: string[]) {
  const m = new Map(days.map((d) => [d, { dia: d, fat: 0, ped: 0 }]));
  for (const o of orders) {
    const r = m.get(o.dia);
    if (r) { r.fat += o.total; r.ped += 1; }
  }
  return [...m.values()];
}

export type CanalRow = { canal: string; grupo: string; ped: number; fat: number; novos: number; share: number; ticket: number };

export function byCanal(orders: OrderRow[], toque: "ultimo" | "primeiro" = "ultimo"): CanalRow[] {
  const total = orders.reduce((s, o) => s + o.total, 0) || 1;
  const m = new Map<string, CanalRow>();
  for (const o of orders) {
    const canal = toque === "ultimo" ? o.canal_ultimo : o.canal_primeiro;
    const grupo = toque === "ultimo" ? o.grupo_ultimo : o.grupo_primeiro;
    const r = m.get(canal) ?? { canal, grupo, ped: 0, fat: 0, novos: 0, share: 0, ticket: 0 };
    r.ped += 1;
    r.fat += o.total;
    if (o.cliente_novo) r.novos += 1;
    m.set(canal, r);
  }
  return [...m.values()]
    .map((r) => ({ ...r, share: (r.fat / total) * 100, ticket: r.fat / r.ped }))
    .sort((a, b) => b.fat - a.fat);
}

export function byGrupo(orders: OrderRow[]) {
  const total = orders.reduce((s, o) => s + o.total, 0) || 1;
  const m = new Map<string, { grupo: string; fat: number; ped: number }>();
  for (const o of orders) {
    const r = m.get(o.grupo_ultimo) ?? { grupo: o.grupo_ultimo, fat: 0, ped: 0 };
    r.fat += o.total;
    r.ped += 1;
    m.set(o.grupo_ultimo, r);
  }
  return [...m.values()].map((r) => ({ ...r, share: (r.fat / total) * 100 })).sort((a, b) => b.fat - a.fat);
}

export type ProdutoRow = { produto: string; qtd: number; fat: number; pedidos: number; canal: string };

export function byProduto(items: ItemRow[]): ProdutoRow[] {
  const m = new Map<string, { produto: string; qtd: number; fat: number; pedidos: Set<string>; canais: Map<string, number> }>();
  for (const i of items) {
    const k = i.product_title;
    const r = m.get(k) ?? { produto: k, qtd: 0, fat: 0, pedidos: new Set(), canais: new Map() };
    r.qtd += i.quantity;
    r.fat += i.amount;
    r.pedidos.add(i.order_id);
    r.canais.set(i.canal_ultimo, (r.canais.get(i.canal_ultimo) ?? 0) + 1);
    m.set(k, r);
  }
  return [...m.values()]
    .map((r) => ({
      produto: r.produto,
      qtd: r.qtd,
      fat: r.fat,
      pedidos: r.pedidos.size,
      canal: [...r.canais.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—",
    }))
    .sort((a, b) => b.fat - a.fat);
}

export function papeis(orders: OrderRow[]) {
  const m = new Map<string, { canal: string; abre: number; fecha: number }>();
  for (const o of orders) {
    const a = m.get(o.canal_primeiro) ?? { canal: o.canal_primeiro, abre: 0, fecha: 0 };
    a.abre += 1;
    m.set(o.canal_primeiro, a);
    const f = m.get(o.canal_ultimo) ?? { canal: o.canal_ultimo, abre: 0, fecha: 0 };
    f.fecha += 1;
    m.set(o.canal_ultimo, f);
  }
  return [...m.values()].sort((a, b) => Math.max(b.abre, b.fecha) - Math.max(a.abre, a.fecha));
}

export function caminhos(orders: OrderRow[]) {
  const m = new Map<string, { abre: string; fecha: string; n: number }>();
  for (const o of orders) {
    if (o.canal_primeiro === o.canal_ultimo) continue;
    const k = `${o.canal_primeiro}→${o.canal_ultimo}`;
    const r = m.get(k) ?? { abre: o.canal_primeiro, fecha: o.canal_ultimo, n: 0 };
    r.n += 1;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

export function faixasVisitas(orders: OrderRow[]) {
  const f = [
    { faixa: "1 visita", n: 0 },
    { faixa: "2 visitas", n: 0 },
    { faixa: "3 a 4", n: 0 },
    { faixa: "5 ou mais", n: 0 },
  ];
  for (const o of orders) {
    const v = o.visits_count;
    if (v == null) continue;
    if (v <= 1) f[0].n++;
    else if (v === 2) f[1].n++;
    else if (v <= 4) f[2].n++;
    else f[3].n++;
  }
  return f;
}

export function media(xs: (number | null)[]) {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
}
