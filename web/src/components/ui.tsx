import type { ReactNode } from "react";
import { pct } from "../lib/format";

export function Card({ title, extra, children, className = "" }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-[14px] border border-line bg-white px-6 py-[22px] ${className}`}>
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
    <div className="rounded-[14px] border border-line bg-white px-[22px] py-5">
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

export function Loading() {
  return <div className="py-16 text-center text-sm text-muted">Carregando dados…</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-[14px] border border-ruim/30 bg-white p-5 text-sm text-ruim">
      Não foi possível carregar os dados: {message}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
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
