import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import { useLastSync } from "../lib/data";
import { supabase } from "../lib/supabase";

const NAV = [
  { to: "/", label: "Visão geral", end: true },
  { to: "/canais", label: "Por canal" },
  { to: "/produtos", label: "Produtos" },
  { to: "/jornada", label: "Jornada" },
  { to: "/retorno", label: "Retorno", fase: "fase 2" },
  { to: "/lancamentos", label: "Lançamentos", fase: "fase 2" },
  { to: "/links", label: "Links UTM" },
  { to: "/ajustes", label: "Ajustes" },
];

function ago(iso: string | null) {
  if (!iso) return "Sem coleta ainda";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "Atualizado agora";
  if (min < 60) return `Atualizado há ${min} min`;
  const h = Math.round(min / 60);
  return `Atualizado há ${h} h`;
}

export function Layout() {
  const { session } = useAuth();
  const last = useLastSync();
  const inicial = (session.user.email ?? "?").slice(0, 1).toUpperCase();
  return (
    <div className="min-h-screen bg-ground font-sans text-ink tabular-nums">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-8 gap-y-4 px-4 py-3.5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-[15px] font-extrabold text-white">A</div>
            <div className="text-[17px] font-extrabold tracking-tight">Aphago Dash</div>
          </div>
          <nav aria-label="Telas" className="flex flex-[1_1_520px] flex-wrap gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded-lg px-3.5 py-2.5 text-sm font-semibold no-underline ${isActive ? "bg-ink text-white" : n.fase ? "text-[#6B6862] hover:bg-soft" : "text-body hover:bg-soft"}`
                }
              >
                {n.label}
                {n.fase && <span className="ml-1 rounded-full border border-[#D6D1C7] px-1.5 py-px text-[11px] font-bold">{n.fase}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">{ago(last)}</span>
            <button
              type="button"
              title={`${session.user.email} · clique para sair`}
              aria-label={`Sair da conta ${session.user.email}`}
              onClick={() => supabase.auth.signOut()}
              className="h-9 w-9 rounded-full border border-[#D6D1C7] bg-ground text-[13px] font-bold"
            >
              {inicial}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-[1320px] flex-col gap-6 px-4 py-8 sm:px-8">
        <Outlet />
      </main>
    </div>
  );
}
