// Períodos sempre no fuso de São Paulo, em datas "YYYY-MM-DD" (coluna `dia` das views).

export type PeriodKey = "hoje" | "7d" | "30d" | "mes" | "custom";
export type Period = { key: PeriodKey; start: string; end: string; prevStart: string; prevEnd: string; label: string };

export function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

const toDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
};
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 864e5) + 1;

export function makePeriod(key: PeriodKey, custom?: { start: string; end: string }): Period {
  const today = todaySP();
  let start = today;
  let end = today;
  let label = "Hoje";
  if (key === "7d") { start = addDays(today, -6); label = "Últimos 7 dias"; }
  if (key === "30d") { start = addDays(today, -29); label = "Últimos 30 dias"; }
  if (key === "mes") { start = `${today.slice(0, 8)}01`; label = "Este mês"; }
  if (key === "custom" && custom) { start = custom.start; end = custom.end; label = "Personalizado"; }
  const len = daysBetween(start, end);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(len - 1));
  return { key, start, end, prevStart, prevEnd, label };
}

export function listDays(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
