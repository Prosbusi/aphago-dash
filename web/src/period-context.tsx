import { createContext, useContext, useState, type ReactNode } from "react";
import { makePeriod, type Period, type PeriodKey } from "./lib/period";

type Ctx = { period: Period; setPeriod: (k: PeriodKey, custom?: { start: string; end: string }) => void };
const PeriodCtx = createContext<Ctx | null>(null);

function initial(): Period {
  try {
    const saved = localStorage.getItem("periodo");
    if (saved && ["hoje", "7d", "30d", "mes"].includes(saved)) return makePeriod(saved as PeriodKey);
  } catch {
    /* sem armazenamento local */
  }
  return makePeriod("30d");
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, set] = useState<Period>(initial);
  const setPeriod = (k: PeriodKey, custom?: { start: string; end: string }) => {
    set(makePeriod(k, custom));
    try {
      if (k !== "custom") localStorage.setItem("periodo", k);
    } catch {
      /* sem armazenamento local */
    }
  };
  return <PeriodCtx.Provider value={{ period, setPeriod }}>{children}</PeriodCtx.Provider>;
}

export function usePeriod() {
  const c = useContext(PeriodCtx);
  if (!c) throw new Error("PeriodProvider ausente");
  return c;
}
