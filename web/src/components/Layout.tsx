import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { useLastSync } from "../lib/data";
import { LOJAS } from "../lib/store";
import { supabase } from "../lib/supabase";

type Item = { to: string; label: string; end?: boolean; fase?: string };

const GERAL: Item[] = [
  { to: "/geral", label: "Resumo", end: true },
  { to: "/geral/links", label: "Links UTM" },
  { to: "/geral/ajustes", label: "Ajustes" },
];

const loja = (id: string): Item[] => [
  { to: `/${id}`, label: "Visão geral", end: true },
  { to: `/${id}/canais`, label: "Por canal" },
  { to: `/${id}/produtos`, label: "Produtos" },
  { to: `/${id}/jornada`, label: "Jornada" },
  { to: `/${id}/retorno`, label: "Retorno", fase: "fase 2" },
  { to: `/${id}/lancamentos`, label: "Lançamentos", fase: "fase 2" },
];

const AREAS = [{ id: "geral", nome: "Geral" }, ...LOJAS.map((l) => ({ id: l.id, nome: l.nome }))];

function ago(iso: string | null) {
  if (!iso) return "Sem coleta ainda";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "Atualizado agora";
  if (min < 60) return `Atualizado há ${min} min`;
  return `Atualizado há ${Math.round(min / 60)} h`;
}

export function Layout() {
  const { session } = useAuth();
  const last = useLastSync();
  const { pathname } = useLocation();
  const area = pathname.split("/")[1] || "geral";
  const nav = area === "geral" ? GERAL : loja(area);
  const inicial = (session.user.email ?? "?").slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-ground font-sans text-ink tabular-nums">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-6 gap-y-3 px-4 pt-3.5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-[15px] font-extrabold text-white">A</div>
            <div className="text-[17px] font-extrabold tracking-tight">Aphago Dash</div>
          </div>
          <nav aria-label="Lojas" className="flex gap-1 rounded-[10px] border border-line bg-ground p-1">
            {AREAS.map((a) => (
              <NavLink
                key={a.id}
                to={`/${a.id}`}
                className={() =>
                  `min-h-9 rounded-[7px] px-3.5 py-2 text-[13px] font-bold no-underline ${area === a.id ? "bg-ink text-white" : "text-body hover:bg-white"}`
                }
              >
                {a.nome}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
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
        <div className="mx-auto max-w-[1320px] px-4 pb-2.5 pt-3 sm:px-8">
          <nav aria-label="Telas" className="flex flex-wrap gap-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded-lg px-3.5 py-2.5 text-sm font-semibold no-underline ${isActive ? "bg-roxo-claro/60 text-ink" : n.fase ? "text-[#6B6862] hover:bg-soft" : "text-body hover:bg-soft"}`
                }
              >
                {n.label}
                {n.fase && <span className="ml-1 rounded-full border border-[#D6D1C7] px-1.5 py-px text-[11px] font-bold">{n.fase}</span>}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto flex max-w-[1320px] flex-col gap-6 px-4 py-8 sm:px-8">
        <Outlet />
      </main>
    </div>
  );
}
