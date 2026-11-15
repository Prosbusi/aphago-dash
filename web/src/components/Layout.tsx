import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { useLastSync, useRefresh } from "../lib/data";
import { AREAS, telaDaRota } from "../lib/acesso";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Marca } from "./Logo";
import type { CSSProperties } from "react";

type Item = { to: string; label: string; end?: boolean; fase?: string };

/** Telas de cada área que a pessoa pode ver (admin vê todas, mais a tela de acessos). */
function navDaArea(area: string, pode: (k: string) => boolean, admin: boolean, pendentes: number): Item[] {
  const a = AREAS.find((x) => x.id === area);
  const itens: Item[] = (a?.telas ?? []).filter((t) => pode(t.chave)).map((t) => ({ to: t.rota, label: t.nome, end: t.end }));
  if (area === "geral" && admin) {
    itens.unshift({ to: "/geral/inicio", label: "Início" });
    itens.push({ to: "/geral/acessos", label: "Acessos", fase: pendentes ? String(pendentes) : undefined });
  }
  return itens;
}

/** Cor de destaque por área: roxo na Aphago e no Geral, vinho na Abrasso. */
export const ACCENT: Record<string, CSSProperties> = {
  time: { "--accent": "160 101 231", "--accent-claro": "217 195 245", "--accent-texto": "122 61 200", "--accent-escuro": "91 42 154" } as CSSProperties,
  geral: { "--accent": "160 101 231", "--accent-claro": "217 195 245", "--accent-texto": "122 61 200", "--accent-escuro": "91 42 154" } as CSSProperties,
  aphago: { "--accent": "160 101 231", "--accent-claro": "217 195 245", "--accent-texto": "122 61 200", "--accent-escuro": "91 42 154" } as CSSProperties,
  abrasso: { "--accent": "157 34 53", "--accent-claro": "231 200 205", "--accent-texto": "157 34 53", "--accent-escuro": "118 24 39" } as CSSProperties,
};

function ago(iso: string | null) {
  if (!iso) return "Sem coleta ainda";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "Atualizado agora";
  if (min < 60) return `Atualizado há ${min} min`;
  return `Atualizado há ${Math.round(min / 60)} h`;
}

export function Layout() {
  const { pathname } = useLocation();
  const { session, pode, isAdmin } = useAuth();
  const [pendentes, setPendentes] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("allowed_users").select("email", { count: "exact", head: true }).eq("status", "pendente").then(({ count }) => setPendentes(count ?? 0));
  }, [isAdmin, pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = useLastSync();
  const refresh = useRefresh();
  const area = pathname.split("/")[1] || "geral";
  const nav = navDaArea(area, pode, isAdmin, pendentes);
  const tela = telaDaRota(pathname);
  const bloqueada = (tela && !pode(tela.chave)) || ((pathname === "/geral/acessos" || pathname === "/geral/inicio") && !isAdmin);
  const primeira = AREAS.flatMap((a) => a.telas).find((t) => pode(t.chave))?.rota ?? (isAdmin ? "/geral/inicio" : null);
  const areas = AREAS.filter((a) => a.telas.some((t) => pode(t.chave)) || (a.id === "geral" && isAdmin));
  const inicial = (session.user.email ?? "?").slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-ground font-sans text-ink tabular-nums" style={ACCENT[area] ?? ACCENT.geral}>
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-6 gap-y-3 px-4 pt-3.5 sm:px-8">
          <Marca />
          <nav aria-label="Lojas" className="flex gap-1 rounded-[10px] border border-line bg-ground p-1">
            {areas.map((a) => (
              <NavLink
                key={a.id}
                to={a.id === "geral" && isAdmin ? "/geral/inicio" : a.telas.find((t) => pode(t.chave))?.rota ?? `/${a.id}`}
                className={() =>
                  `min-h-9 rounded-[7px] px-3.5 py-2 text-[13px] font-bold no-underline ${area === a.id ? "bg-ink text-white" : "text-body hover:bg-white"}`
                }
              >
                {a.nome}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted sm:inline" aria-live="polite">
              {refresh.state === "running" ? "Buscando dados novos…" : refresh.state === "recent" ? "Atualizado há instantes" : refresh.state === "error" ? "Não deu para atualizar" : ago(last)}
            </span>
            <button
              type="button"
              onClick={refresh.run}
              disabled={refresh.state === "running"}
              title="Buscar agora os pedidos novos das lojas"
              className="flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-semibold text-body hover:bg-ground disabled:opacity-60"
            >
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={refresh.state === "running" ? "animate-spin" : ""}>
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              Atualizar
            </button>
            <span
              title={session.user.email ?? ""}
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#D6D1C7] bg-ground text-[13px] font-bold"
            >
              {inicial}
            </span>
            <span className="hidden max-w-[200px] truncate text-xs text-muted lg:inline">{session.user.email}</span>
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.reload();
              }}
              aria-label={`Sair da conta ${session.user.email}`}
              className="flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-semibold text-body hover:bg-ground"
            >
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
              Sair
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
        {!bloqueada ? (
          <Outlet />
        ) : primeira && primeira !== pathname ? (
          <Navigate to={primeira} replace />
        ) : (
          <p className="py-16 text-center text-sm text-muted">Nenhuma tela liberada para você ainda. Fale com um administrador.</p>
        )}
      </main>
    </div>
  );
}
