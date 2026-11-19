import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { LOJAS, nomeLoja } from "../lib/store";
import { useAuth } from "../auth";
import { Card } from "./ui";

type Conta = { id: string; nome: string; ativa: boolean; loja: string; nova?: boolean };
type Status = { store: string; final: string; permissoes: string[]; contas: Conta[]; erro: string | null; verificado_em: string | null; salvo_em: string; salvo_por: string | null };

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

/** Token do usuário do sistema "Pharol" no Meta, salvo pelo próprio site (só admin). O token nunca é mostrado de volta. */
export function ConexaoMeta() {
  const { isAdmin } = useAuth();
  const [status, setStatus] = useState<Status[] | null>(null);
  const [loja, setLoja] = useState("aphago");
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    const { data } = await supabase.rpc("meta_tokens_status");
    setStatus((data as Status[]) ?? []);
  };
  useEffect(() => { if (isAdmin) carregar(); }, [isAdmin]);
  if (!isAdmin) return null;

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true); setMsg(null);
    const { error } = await supabase.rpc("meta_token_salvar", { p_store: loja, p_token: token });
    setSalvando(false);
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    setToken("");
    setMsg({ tipo: "ok", texto: "Token salvo. Conferindo permissões e contas no Meta… (leva alguns segundos; contas novas já recebem o gasto desde 01/08)" });
    // a conferência roda no servidor; atualiza o quadro quando terminar
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const { data } = await supabase.rpc("meta_tokens_status");
      const s = ((data as Status[]) ?? []).find((x) => x.store === loja);
      setStatus((data as Status[]) ?? []);
      if (s?.verificado_em) {
        setMsg(s.erro ? { tipo: "erro", texto: `O Meta recusou o token: ${s.erro}` } : { tipo: "ok", texto: `Token conferido: ${s.contas.length} conta(s) de anúncio visível(is).` });
        break;
      }
    }
  };

  return (
    <Card title="Conexão com o Meta" extra="token do usuário do sistema Pharol · só administradores">
      <p className="mt-2 text-[13px] text-muted">
        Cole aqui o token gerado no Meta (Configurações do negócio → Usuários do sistema → Pharol → Gerar novo token). Ele fica guardado no servidor e nunca aparece de novo na tela.
        Contas de anúncio novas que o token enxergar entram automaticamente na loja escolhida.
      </p>

      {status && status.length > 0 && (
        <div className="mt-3 space-y-3">
          {status.map((s) => (
            <div key={s.store} className="rounded-xl border border-line p-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <strong className="text-sm">{nomeLoja(s.store)}</strong>
                <span className="font-mono text-muted">••••{s.final}</span>
                <span className="text-muted">salvo em {quando(s.salvo_em)}{s.salvo_por ? ` por ${s.salvo_por}` : ""}</span>
                {!s.verificado_em && <span className="font-semibold text-muted">conferindo…</span>}
                {s.erro && <span className="font-semibold text-ruim">erro: {s.erro}</span>}
              </div>
              {s.verificado_em && !s.erro && (
                <>
                  <div className="mt-1.5">
                    Permissões:{" "}
                    {["ads_read", "ads_management", "business_management"].map((p) => (
                      <span key={p} className={`mr-1.5 inline-block rounded-md px-1.5 py-0.5 font-mono text-[12px] ${s.permissoes.includes(p) ? "bg-[#EAF5EF] text-bom" : "bg-ground text-muted line-through"}`}>{p}</span>
                    ))}
                    {!s.permissoes.includes("ads_management") && <span className="text-muted">— sem ads_management o Pharol só lê, não edita anúncios</span>}
                  </div>
                  <ul className="m-0 mt-1.5 list-none p-0">
                    {s.contas.map((c) => (
                      <li key={c.id} className="py-0.5">
                        {c.nome} <span className="font-mono text-muted">{c.id}</span> · {nomeLoja(c.loja)}
                        {!c.ativa && <span className="text-muted"> · desativada no Meta</span>}
                        {c.nova && <span className="ml-1 rounded-full bg-roxo-claro px-2 py-0.5 text-[11px] font-bold text-roxo-texto">nova</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={salvar} className="mt-4 flex flex-wrap items-end gap-2 rounded-xl bg-ground p-3">
        <label className="flex flex-col gap-1 text-[13px] font-semibold">Loja
          <select className="min-h-10 rounded-lg border border-line px-3 text-sm" value={loja} onChange={(e) => setLoja(e.target.value)}>
            {LOJAS.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </label>
        <label className="flex min-w-[280px] flex-1 flex-col gap-1 text-[13px] font-semibold">Token do Meta
          <input type="password" autoComplete="off" spellCheck={false} required value={token} onChange={(e) => setToken(e.target.value)}
            placeholder="EAAB…" className="min-h-10 rounded-lg border border-line px-3 font-mono text-sm" />
        </label>
        <button type="submit" disabled={salvando || !token.trim()} className="min-h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">
          {salvando ? "Salvando…" : "Salvar e conferir"}
        </button>
      </form>
      {msg && <p role="status" className={`mb-0 mt-2 text-sm ${msg.tipo === "erro" ? "text-ruim" : "text-bom"}`}>{msg.texto}</p>}
    </Card>
  );
}
