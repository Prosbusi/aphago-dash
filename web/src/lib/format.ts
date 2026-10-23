const brl0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brl2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("pt-BR");

export const money = (n: number) => brl0.format(n);
export const money2 = (n: number) => brl2.format(n);
export const num = (n: number) => int.format(n);
export const pct = (n: number, digits = 1) => `${n.toFixed(digits).replace(".", ",")}%`;
export const dec = (n: number, digits = 1) => n.toFixed(digits).replace(".", ",");

/** dd/mm a partir de "YYYY-MM-DD" */
export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const diaMes = (iso: string) => `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1]}`;

/** Variação percentual com sinal; null quando não há base. */
export function delta(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return ((atual - anterior) / anterior) * 100;
}
