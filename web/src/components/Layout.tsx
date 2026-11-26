import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useLastSync, useRefresh } from "../lib/data";
import type { StoreId } from "../lib/data";
import { AREAS, telaDaRota } from "../lib/acesso";
import { LOJAS } from "../lib/store";
import { montarMenu, type GrupoMenu, type ItemMenu } from "../lib/menu";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Marca } from "./Logo";
import { Icone } from "./Icone";
import { Farolzinho } from "./Farolzinho";
import type { CSSProperties } from "react";

/** Cor de destaque por área: roxo na Aphago e no Geral, vinho na Abrasso. */
export const ACCENT: Record<string, CSSProperties> = {
  time: { "--accent": "124 92 224", "--accent-claro": "228 220 255", "--accent-texto": "91 63 196", "--accent-escuro": "69 48 154" } as CSSProperties,
  geral: { "--accent": "124 92 224", "--accent-claro": "228 220 255", "--accent-texto": "91 63 196", "--accent-escuro": "69 48 154" } as CSSProperties,
  aphago: { "--accent": "124 92 224", "--accent-claro": "228 220 255", "--accent-texto": "91 63 196", "--accent-escuro": "69 48 154" } as CSSProperties,
  abrasso: { "--accent": "157 34 53", "--accent-claro": "231 200 205", "--accent-texto": "157 34 53", "--accent-escuro": "118 24 39" } as CSSProperties,
};

const CHAVE_LOJA = "pharol:loja";

function ago(iso: string | null) {
  if (!iso) return "Sem coleta ainda";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "Atualizado agora";
  if (min < 60) return `Atualizado há ${min} min`;
  return `Atualizado há ${Math.round(min / 60)} h`;
}

function lojaSalva(): StoreId {
  try {
    const v = localStorage.getItem(CHAVE_LOJA);
    if (LOJAS.some((l) => l.id === v)) return v as StoreId;
  } catch {
    /* sem armazenamento: fica na Aphago */
  }
  return "aphago";
}

const itemBase = "flex min-h-9 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] no-underline";

function Item({ item, visivel, pathname }: { item: ItemMenu; visivel: (i: ItemMenu) => boolean; pathname: string }) {
  const filhos = item.filhos?.filter(visivel) ?? [];
  const algumAtivo = filhos.some((f) => f.to && (pathname === f.to || pathname.startsWith(`${f.to}/`)));
  const [aberto, setAberto] = useState(algumAtivo);
  useEffect(() => {
    if (algumAtivo) setAberto(true);
  }, [algumAtivo]);

  if (item.emBreve) {
    return (
      <div className={`${itemBase} cursor-default text-[#9A968E]`} title="Em breve no Pharol">
        <Icone nome={item.icone} />
        <span>{item.label}</span>
        <span className="ml-auto rounded-full border border-line px-1.5 py-px text-[10.5px] font-bold">em breve</span>
      </div>
    );
  }

  if (item.filhos) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setAberto((a) => !a)}
          aria-expanded={aberto}
          className={`${itemBase} font-semibold ${algumAtivo ? "text-ink" : "text-body"} hover:bg-soft`}
        >
          <Icone nome={item.icone} className={algumAtivo ? "text-roxo-texto" : "text-muted"} />
          <span>{item.label}</span>
          <Icone nome="seta" tamanho={15} className={`ml-auto text-muted transition-transform ${aberto ? "rotate-90" : ""}`} />
        </button>
        {aberto && (
          <div className="ml-[19px] mt-0.5 flex flex-col gap-0.5 border-l border-line pl-2.5">
            {filhos.map((f) => (
              <NavLink
                key={f.to}
                to={f.to!}
                end={f.end}
                className={({ isActive }) =>
                  `flex min-h-8 items-center rounded-xl px-2.5 py-1.5 text-[13px] no-underline ${isActive ? "bg-roxo-claro/55 font-bold text-ink" : "font-semibold text-body hover:bg-soft"}`
                }
              >
                {f.label}
                {f.contador && <span className="ml-auto rounded-full bg-roxo px-1.5 py-px text-[11px] font-bold text-white">{f.contador}</span>}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.to!}
      end={item.end}
      className={({ isActive }) => `${itemBase} group ${isActive ? "bg-roxo-claro/70 font-extrabold text-ink" : "font-semibold text-body hover:bg-soft"}`}
    >
      {({ isActive }) => (
        <>
          <Icone nome={item.icone} className={isActive ? "text-roxo-texto" : "text-muted group-hover:text-body"} />
          <span>{item.label}</span>
          {item.contador && <span className="ml-auto rounded-full bg-roxo px-1.5 py-px text-[11px] font-bold text-white">{item.contador}</span>}
        </>
      )}
    </NavLink>
  );
}

function Grupo({ grupo, visivel, pathname }: { grupo: GrupoMenu; visivel: (i: ItemMenu) => boolean; pathname: string }) {
  const itens = grupo.itens.filter(visivel);
  if (!itens.length) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {grupo.titulo && <p className="m-0 mb-1 mt-4 px-2.5 text-[11px] font-extrabold uppercase tracking-[0.09em] text-lavanda">{grupo.titulo}</p>}
      {itens.map((i) => (
        <Item key={i.label} item={i} visivel={visivel} pathname={pathname} />
      ))}
    </div>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { session, pode, isAdmin } = useAuth();
  const [pendentes, setPendentes] = useState(0);
  const [gaveta, setGaveta] = useState(false);
  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("allowed_users").select("email", { count: "exact", head: true }).eq("status", "pendente").then(({ count }) => setPendentes(count ?? 0));
  }, [isAdmin, pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setGaveta(false), [pathname]);

  const last = useLastSync();
  const refresh = useRefresh();

  // Loja: a da rota (/aphago/..., /abrasso/...) ou a última escolhida.
  const area = pathname.split("/")[1] || "geral";
  const lojaDaRota = LOJAS.find((l) => l.id === area)?.id;
  const [ultimaLoja, setUltimaLoja] = useState<StoreId>(lojaSalva);
  const loja: StoreId = lojaDaRota ?? ultimaLoja;
  useEffect(() => {
    if (!lojaDaRota) return;
    setUltimaLoja(lojaDaRota);
    try {
      localStorage.setItem(CHAVE_LOJA, lojaDaRota);
    } catch {
      /* ignora */
    }
  }, [lojaDaRota]);

  function trocarLoja(id: StoreId) {
    setUltimaLoja(id);
    try {
      localStorage.setItem(CHAVE_LOJA, id);
    } catch {
      /* ignora */
    }
    if (lojaDaRota && lojaDaRota !== id) navigate(pathname.replace(`/${lojaDaRota}`, `/${id}`));
  }

  const visivel = (i: ItemMenu): boolean => {
    if (i.emBreve) return true;
    if (i.filhos) return i.filhos.some(visivel);
    if (i.admin) return isAdmin;
    return i.chave ? pode(i.chave) : true;
  };
  const menu = montarMenu(loja, pendentes);

  const tela = telaDaRota(pathname);
  const bloqueada = (tela && !pode(tela.chave)) || ((pathname === "/geral/acessos" || pathname === "/geral/inicio") && !isAdmin);
  const primeira = AREAS.flatMap((a) => a.telas).find((t) => pode(t.chave))?.rota ?? (isAdmin ? "/geral/inicio" : null);
  const inicial = (session.user.email ?? "?").slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-ground font-sans text-ink tabular-nums lg:flex" style={ACCENT[loja]}>
      {gaveta && <div aria-hidden="true" onClick={() => setGaveta(false)} className="fixed inset-0 z-30 bg-ink/30 lg:hidden" />}

      <aside
        aria-label="Menu"
        className={`fixed inset-y-0 left-0 z-40 flex w-[264px] shrink-0 flex-col border-r border-line bg-white transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${gaveta ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <Marca altura={28} />
          <button type="button" onClick={() => setGaveta(false)} aria-label="Fechar menu" className="rounded-lg p-1.5 text-muted hover:bg-soft lg:hidden">
            <Icone nome="fechar" />
          </button>
        </div>

        <div role="group" aria-label="Loja" className="mx-3 flex gap-1 rounded-2xl border border-line bg-ground p-1">
          {LOJAS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => trocarLoja(l.id)}
              aria-pressed={loja === l.id}
              className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-bold ${loja === l.id ? "bg-white text-ink shadow-[0_0_0_1px_#EFE5D3]" : "text-muted hover:text-body"}`}
            >
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: l.cor }} />
              {l.nome}
            </button>
          ))}
        </div>

        <nav aria-label="Telas" className="flex-1 overflow-y-auto px-3 pb-4 pt-3">
          {menu.principal.map((g, i) => (
            <Grupo key={g.titulo ?? i} grupo={g} visivel={visivel} pathname={pathname} />
          ))}
        </nav>

        <div className="border-t border-line px-3 py-3">
          <Grupo grupo={menu.rodape} visivel={visivel} pathname={pathname} />
          <div className="mt-2 flex items-center gap-2.5 rounded-lg px-2.5 py-2">
            <span
              title={session.user.email ?? ""}
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E6DAC4] bg-ground text-[12px] font-bold"
            >
              {inicial}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{session.user.email}</span>
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.reload();
              }}
              aria-label={`Sair da conta ${session.user.email}`}
              title="Sair"
              className="rounded-lg p-1.5 text-muted hover:bg-soft hover:text-ink"
            >
              <Icone nome="sair" tamanho={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-ground/95 px-4 py-2.5 backdrop-blur sm:px-8">
          <button type="button" onClick={() => setGaveta(true)} aria-label="Abrir menu" className="-ml-1.5 rounded-lg p-1.5 text-body hover:bg-soft lg:hidden">
            <Icone nome="menu" tamanho={22} />
          </button>
          <span className="lg:hidden">
            <Marca altura={24} />
          </span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted sm:inline" aria-live="polite">
              {refresh.state === "running" ? "Iluminando os números…" : refresh.state === "recent" ? "Tudo fresquinho!" : refresh.state === "error" ? "Ops, o facho apagou. Tenta de novo?" : ago(last)}
            </span>
            <button
              type="button"
              onClick={refresh.run}
              disabled={refresh.state === "running"}
              title="Buscar agora os pedidos novos das lojas"
              className="flex min-h-9 items-center gap-1.5 rounded-xl border border-line bg-white px-3 text-[13px] font-semibold text-body hover:bg-ground disabled:opacity-60"
            >
              {refresh.state === "running" ? <Farolzinho tamanho={18} facho piscando /> : <Icone nome="atualizar" tamanho={14} />}
              Atualizar
            </button>
          </div>
        </header>
        <main className="mx-auto flex max-w-[1320px] flex-col gap-6 px-4 py-8 sm:px-8">
          {!bloqueada ? (
            <Outlet />
          ) : primeira && primeira !== pathname ? (
            <Navigate to={primeira} replace />
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted">
              <Farolzinho tamanho={72} humor="dormindo" />
              Nenhuma tela liberada para você ainda. Fale com um administrador.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
