import { useState } from "react";
import { usePeriod } from "../period-context";
import type { PeriodKey } from "../lib/period";
import { todaySP } from "../lib/period";

const OPTS: { key: PeriodKey; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "mes", label: "Mês" },
  { key: "custom", label: "Personalizado" },
];

export function PeriodPicker() {
  const { period, setPeriod } = usePeriod();
  const [start, setStart] = useState(period.start);
  const [end, setEnd] = useState(period.end);
  const btn = (on: boolean) =>
    `min-h-9 rounded-[7px] px-3.5 text-[13px] font-semibold ${on ? "bg-ink text-white" : "text-body hover:bg-soft"}`;
  return (
    <div className="flex flex-col items-end gap-2">
      <div role="group" aria-label="Período" className="flex flex-wrap gap-1 rounded-[10px] border border-line bg-white p-1">
        {OPTS.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={period.key === o.key}
            className={btn(period.key === o.key)}
            onClick={() => setPeriod(o.key, o.key === "custom" ? { start, end } : undefined)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {period.key === "custom" && (
        <form
          className="flex flex-wrap items-center gap-2 text-[13px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (start && end && start <= end) setPeriod("custom", { start, end });
          }}
        >
          <label className="flex items-center gap-1.5">
            De
            <input type="date" value={start} max={todaySP()} onChange={(e) => setStart(e.target.value)} className="rounded-md border border-line px-2 py-1.5" />
          </label>
          <label className="flex items-center gap-1.5">
            até
            <input type="date" value={end} max={todaySP()} onChange={(e) => setEnd(e.target.value)} className="rounded-md border border-line px-2 py-1.5" />
          </label>
          <button type="submit" className="min-h-9 rounded-md bg-ink px-3 font-semibold text-white">
            Aplicar
          </button>
        </form>
      )}
    </div>
  );
}
