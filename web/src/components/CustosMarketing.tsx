import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { bumpData } from "../lib/data";
import { LOJAS, nomeLoja } from "../lib/store";
import { money2 } from "../lib/format";
import { useAuth } from "../auth";
import { Card, Empty, Loading } from "./ui";

type Custo = { id: number; store: string; tipo: "email" | "push" | "outro"; descricao: string | null; valor_mensal: number; desde: string; ate: string | null };
const TIPOS = { email: "E-mail", push: "Push", outro: "Outro" } as const;
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** E-mail (fatura da Shopify), push e outros custos de marketing que não vêm das plataformas de anúncio. */
export function CustosMarketing() {
  const { isAdmin } = useAuth();
  const [lista, setLista] = useState<Custo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState({ store: "aphago", tipo: "email", descricao: "", valor: "", desde: "", ate: "" });
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    const { data, error } = await supabase.from("custos_marketing").select("id,store,tipo,descricao,valor_mensal,desde,ate").order("desde", { ascending: false });
    if (error) setErro(error.message);
    else setLista((data ?? []).map((c) => ({ ...c, valor_mensal: Number(c.valor_mensal) })) as Custo[]);
  };
  useEffect(() => { carregar(); }, []);

  // e-mail: escolher o mês preenche o período inteiro
  const escolherMes = (mes: string) => {
    if (!mes) return;
    const [a, m] = mes.split("-").map(Number);
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    setForm((f) => ({ ...f, desde: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, "0")}` }));
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const valor = Number(form.valor.replace(/\./g, "").replace(",", "."));
    if (!(valor >= 0) || !form.desde) { setErro("Preencha o valor e a data de início."); return; }
    setSalvando(true);
    const { error } = await supabase.from("custos_marketing").insert({
      store: form.store, tipo: form.tipo, descricao: form.descricao.trim() || null, valor_mensal: valor, desde: form.desde, ate: form.ate || null,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setErro(null);
    setForm((f) => ({ ...f, descricao: "", valor: "", desde: "", ate: "" }));
    bumpData();
    carregar();
  };

  const remover = async (c: Custo) => {
    if (!window.confirm(`Remover ${TIPOS[c.tipo]} de ${nomeLoja(c.store)} (${money2(c.valor_mensal)} por mês)?`)) return;
    const { error } = await supabase.from("custos_marketing").delete().eq("id", c.id);
    if (error) { setErro(error.message); return; }
    bumpData();
    carregar();
  };

  const encerrar = async (c: Custo) => {
    const ate = window.prompt("Último dia deste custo (AAAA-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!ate) return;
    const { error } = await supabase.from("custos_marketing").update({ ate }).eq("id", c.id);
    if (error) { setErro(error.message); return; }
    bumpData();
    carregar();
  };

  const campo = "min-h-10 rounded-lg border border-line px-3 text-sm";

  return (
    <Card title="Custos de marketing fora dos anúncios" extra="entram no marketing do dia, na projeção e no retorno">
      <p className="mt-2 text-[13px] text-muted">
        Valor por mês, dividido pelos dias do mês. A Shopify não libera a fatura de e-mail por API: lance o valor de "Marketing emails" da fatura de cada mês, de 1º ao último dia do mês. O push é a mensalidade, sem data de fim.
      </p>
      {erro && <p role="alert" className="mt-2 text-sm text-ruim">{erro}</p>}
      {lista === null ? <Loading /> : lista.length === 0 ? <Empty>Nenhum custo cadastrado.</Empty> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-2 font-semibold">Loja</th>
                <th scope="col" className="p-2 font-semibold">Tipo</th>
                <th scope="col" className="p-2 font-semibold">Descrição</th>
                <th scope="col" className="p-2 text-right font-semibold">Por mês</th>
                <th scope="col" className="p-2 font-semibold">Período</th>
                {isAdmin && <th scope="col" className="py-2 pl-2"><span className="sr-only">Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className="border-t border-soft">
                  <td className="py-2.5 pr-2 font-semibold">{nomeLoja(c.store)}</td>
                  <td className="p-2">{TIPOS[c.tipo]}</td>
                  <td className="p-2 text-body">{c.descricao ?? "—"}</td>
                  <td className="p-2 text-right font-semibold">{money2(c.valor_mensal)}</td>
                  <td className="p-2 text-body">{br(c.desde)} {c.ate ? `a ${br(c.ate)}` : "em diante"}</td>
                  {isAdmin && (
                    <td className="whitespace-nowrap py-2 pl-2 text-right">
                      {!c.ate && <button type="button" onClick={() => encerrar(c)} className="mr-1 min-h-9 rounded-lg border border-line px-2.5 text-[13px] font-semibold hover:bg-ground">Encerrar</button>}
                      <button type="button" onClick={() => remover(c)} className="min-h-9 rounded-lg border border-line px-2.5 text-[13px] font-semibold text-ruim hover:bg-ground">Remover</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isAdmin && (
        <form onSubmit={salvar} className="mt-4 flex flex-wrap items-end gap-2 rounded-xl bg-ground p-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold">Loja
            <select className={campo} value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })}>
              {LOJAS.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">Tipo
            <select className={campo} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
              {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">Descrição
            <input className={`${campo} w-44`} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder={form.tipo === "email" ? "Fatura de outubro" : "Opcional"} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">Valor por mês (R$)
            <input className={`${campo} w-32`} inputMode="decimal" required value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} placeholder="297,00" />
          </label>
          {form.tipo === "email" && (
            <label className="flex flex-col gap-1 text-[13px] font-semibold">Mês da fatura
              <input type="month" className={campo} onChange={(e) => escolherMes(e.target.value)} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-[13px] font-semibold">De
            <input type="date" className={campo} required value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">Até (opcional)
            <input type="date" className={campo} value={form.ate} onChange={(e) => setForm({ ...form, ate: e.target.value })} />
          </label>
          <button type="submit" disabled={salvando} className="min-h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-60">
            {salvando ? "Salvando…" : "Adicionar"}
          </button>
        </form>
      )}
    </Card>
  );
}
