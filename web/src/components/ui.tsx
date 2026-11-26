import type { ReactNode } from "react";
import { pct } from "../lib/format";
import { Farolzinho } from "./Farolzinho";

export function Card({ title, extra, children, className = "" }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-[18px] border border-line bg-white px-6 py-[22px] ${className}`}>
      {(title || extra) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="m-0 text-[17px] font-bold">{title}</h2>}
          {extra && <div className="text-[13px] text-muted">{extra}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, delta, sub, invert = false }: { label: string; value: string; delta?: number | null; sub?: string; invert?: boolean }) {
  const up = (delta ?? 0) >= 0;
  const good = invert ? !up : up;
  return (
    <div className="rounded-[18px] border border-line bg-white px-[22px] py-5">
      <div className="text-[13px] font-semibold text-muted">{label}</div>
      <div className="mt-2 text-[32px] font-extrabold tracking-tight">{value}</div>
      <div className="mt-1.5 text-[13px]">
        {delta != null && (
          <span className={`font-bold ${good ? "text-bom" : "text-ruim"}`}>
            {up ? "▲" : "▼"} {pct(Math.abs(delta))}{" "}
          </span>
        )}
        {sub && <span className="font-medium text-muted">{sub}</span>}
      </div>
    </div>
  );
}

export function ShareBar({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.max(1.5, (value / max) * 100) : 0;
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-soft">
      <div className="h-full rounded-full bg-roxo" style={{ width: `${w}%` }} />
    </div>
  );
}

export function GrupoTag({ grupo }: { grupo: string }) {
  return <span className="ml-1 text-[11px] font-semibold text-muted">{grupo}</span>;
}

export function Loading({ texto = "Iluminando os números…" }: { texto?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-14 text-center text-sm font-semibold text-muted">
      <Farolzinho tamanho={64} facho piscando humor="pensando" />
      {texto}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-center gap-4 rounded-[18px] border border-coral/50 bg-white p-5 text-sm">
      <Farolzinho tamanho={52} humor="triste" />
      <div>
        <p className="m-0 font-bold text-ink">Ops, o facho apagou.</p>
        <p className="m-0 mt-0.5 text-ruim">Não deu para carregar os dados: {message}</p>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted">
      <Farolzinho tamanho={44} humor="dormindo" />
      <p className="m-0 max-w-md">{children}</p>
    </div>
  );
}

export function PageTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="m-0 text-[30px] font-extrabold tracking-tight">{title}</h1>
        {sub && <p className="mt-1.5 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
