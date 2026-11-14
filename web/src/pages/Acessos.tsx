import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { AREAS, TODAS_AS_TELAS } from "../lib/acesso";
import { useAuth } from "../auth";
import { Card, Empty, ErrorBox, Loading, PageTitle } from "../components/ui";

type Pessoa = {
  email: string; nome: string | null; papel: string; status: "pendente" | "aprovado" | "bloqueado";
  telas: string[]; foto: string | null; pedido_em: string; aprovado_em: string | null; aprovado_por: string | null;
};

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export function Acessos() {
  const { session } = useAuth();
  const eu = (session.user.email ?? "").toLowerCase();
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  const carregar = async () => {
    const { data, error } = await supabase.from("allowed_users").select("email,nome,papel,status,telas,foto,pedido_em,aprovado_em,aprovado_por").order("pedido_em", { ascending: false });
    if (error) setErro(error.message);
    else setPessoas((data ?? []) as Pessoa[]);
  };
  useEffect(() => { carregar(); }, []);

  const salvar = async (email: string, mudanca: Partial<Pessoa>) => {
    const extra = mudanca.status === "aprovado" ? { aprovado_em: new Date().toISOString(), aprovado_por: eu } : {};
    const { error } = await supabase.from("allowed_users").update({ ...mudanca, ...extra }).eq("email", email);
    if (error) { setErro(error.message); return false; }
    setErro(null);
    await carregar();
    return true;
  };

  const pendentes = (pessoas ?? []).filter((p) => p.status === "pendente");
  const outros = (pessoas ?? []).filter((p) => p.status !== "pendente");

  return (
    <>
      <PageTitle title="Acessos" sub="Quem entra com o Google pede acesso. A pessoa só vê dados depois que você aprova e escolhe as telas." />
      {erro && <ErrorBox message={erro} />}
      {pessoas === null ? <Loading /> : (
        <>
          <Card title={`Pedidos de acesso (${pendentes.length})`}>
            {pendentes.length === 0 ? <Empty>Nenhum pedido esperando aprovação.</Empty> : (
              <ul className="m-0 mt-3 list-none p-0">
                {pendentes.map((p) => (
                  <li key={p.email} className="border-t border-soft py-3">
                    <Linha p={p} extra={`pediu em ${quando(p.pedido_em)}`} aberto={aberto === p.email} onAbrir={() => setAberto(aberto === p.email ? null : p.email)} />
                    {aberto === p.email ? (
                      <Editor p={p} rotulo="Aprovar com estas telas" onSalvar={(telas, admin) => salvar(p.email, { telas, papel: admin ? "admin" : "time", status: "aprovado" }).then((ok) => ok && setAberto(null))} />
                    ) : (
                      <div className="mt-2 flex gap-2 pl-12">
                        <button type="button" onClick={() => setAberto(p.email)} className="min-h-9 rounded-lg bg-ink px-3 text-[13px] font-semibold text-white">Escolher telas e aprovar</button>
                        <button type="button" onClick={() => salvar(p.email, { status: "bloqueado" })} className="min-h-9 rounded-lg border border-line px-3 text-[13px] font-semibold text-ruim hover:bg-ground">Recusar</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Pessoas (${outros.length})`}>
            <ul className="m-0 mt-3 list-none p-0">
              {outros.map((p) => {
                const proprio = p.email === eu;
                return (
                  <li key={p.email} className="border-t border-soft py-3">
                    <Linha
                      p={p}
                      extra={p.status === "bloqueado" ? "bloqueado" : p.papel === "admin" ? "admin · vê tudo" : `${p.telas.length} de ${TODAS_AS_TELAS.length} telas`}
                      aberto={aberto === p.email}
                      onAbrir={() => setAberto(aberto === p.email ? null : p.email)}
                    />
                    {aberto === p.email && (
                      <>
                        {p.status === "bloqueado" ? (
                          <div className="mt-2 pl-12">
                            <button type="button" onClick={() => salvar(p.email, { status: "aprovado" }).then(() => setAberto(null))} className="min-h-9 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-ground">Desbloquear</button>
                          </div>
                        ) : (
                          <Editor
                            p={p}
                            rotulo="Salvar"
                            travarAdmin={proprio}
                            onSalvar={(telas, admin) => salvar(p.email, { telas, papel: admin ? "admin" : "time" }).then((ok) => ok && setAberto(null))}
                            onBloquear={proprio ? undefined : () => salvar(p.email, { status: "bloqueado" }).then(() => setAberto(null))}
                          />
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

function Linha({ p, extra, aberto, onAbrir }: { p: Pessoa; extra: string; aberto: boolean; onAbrir: () => void }) {
  return (
    <div className="flex items-center gap-3">
      {p.foto ? (
        <img src={p.foto} alt="" referrerPolicy="no-referrer" className="h-9 w-9 rounded-full" />
      ) : (
        <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-ground text-[13px] font-bold">{(p.nome ?? p.email).slice(0, 1).toUpperCase()}</span>
      )}
      <div className="min-w-0 flex-auto">
        <div className="truncate text-sm font-semibold">{p.nome ?? p.email}</div>
        <div className="truncate text-xs text-muted">{p.email} · {extra}</div>
      </div>
      {p.status !== "pendente" && (
        <button type="button" aria-expanded={aberto} onClick={onAbrir} className="min-h-9 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-ground">
          {aberto ? "Fechar" : "Editar"}
        </button>
      )}
    </div>
  );
}

function Editor({ p, rotulo, onSalvar, onBloquear, travarAdmin = false }: {
  p: Pessoa; rotulo: string; onSalvar: (telas: string[], admin: boolean) => void; onBloquear?: () => void; travarAdmin?: boolean;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(p.telas));
  const [admin, setAdmin] = useState(p.papel === "admin");
  const alterna = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const area = (chaves: string[], ligar: boolean) => setSel((s) => { const n = new Set(s); chaves.forEach((k) => (ligar ? n.add(k) : n.delete(k))); return n; });

  return (
    <div className="mt-3 rounded-xl bg-ground p-4 sm:ml-12">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={admin} disabled={travarAdmin} onChange={(e) => setAdmin(e.target.checked)} className="h-4 w-4" />
        Administrador (vê todas as telas, aprova acessos e edita custos)
      </label>
      {!admin && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setSel(new Set(TODAS_AS_TELAS))} className="min-h-9 rounded-lg border border-line bg-white px-3 text-[13px] font-semibold">Marcar todas</button>
            <button type="button" onClick={() => setSel(new Set())} className="min-h-9 rounded-lg border border-line bg-white px-3 text-[13px] font-semibold">Desmarcar todas</button>
          </div>
          <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
            {AREAS.map((a) => {
              const chaves = a.telas.map((t) => t.chave);
              const todas = chaves.every((k) => sel.has(k));
              return (
                <fieldset key={a.id} className="m-0 rounded-lg border border-line bg-white p-3">
                  <legend className="px-1 text-[13px] font-bold">{a.nome}</legend>
                  <label className="flex items-center gap-2 py-1 text-[13px] font-semibold text-muted">
                    <input type="checkbox" checked={todas} onChange={(e) => area(chaves, e.target.checked)} className="h-4 w-4" />
                    Todas de {a.nome}
                  </label>
                  {a.telas.map((t) => (
                    <label key={t.chave} className="flex items-center gap-2 py-1 text-sm">
                      <input type="checkbox" checked={sel.has(t.chave)} onChange={() => alterna(t.chave)} className="h-4 w-4" />
                      {t.nome}
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </div>
          <p className="mb-0 mt-2 text-xs text-muted">Sem nenhuma tela de uma loja, a pessoa também não lê os pedidos e gastos daquela loja.</p>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onSalvar([...sel], admin)} disabled={!admin && sel.size === 0} className="min-h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{rotulo}</button>
        {onBloquear && <button type="button" onClick={onBloquear} className="min-h-10 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ruim">Bloquear acesso</button>}
      </div>
    </div>
  );
}
