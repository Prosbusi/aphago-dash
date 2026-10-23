import { useEffect, useState } from "react";
import { fetchAll, supabase } from "../lib/supabase";
import { clearDataCache } from "../lib/data";
import { addDays, todaySP } from "../lib/period";
import { num } from "../lib/format";
import { Card, Empty, ErrorBox, Loading, PageTitle } from "../components/ui";

type Regra = { source: string; medium: string; canal: string; grupo: string };
const GRUPOS = ["pago", "organico", "mensagem", "direto", "sem utm"] as const;

export function Ajustes() {
  const [regras, setRegras] = useState<Regra[] | null>(null);
  const [pendentes, setPendentes] = useState<{ chave: string; n: number }[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState<Regra>({ source: "", medium: "*", canal: "", grupo: "pago" });
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    try {
      const [r, v] = await Promise.all([
        fetchAll<Regra>((f, t) => supabase.from("channel_map").select("source,medium,canal,grupo").order("canal").order("source").range(f, t)),
        fetchAll<{ chave: string }>((f, t) =>
          supabase.from("v_visits").select("chave").eq("canal", "Não classificado").gte("occurred_at", `${addDays(todaySP(), -90)}T00:00:00-03:00`).range(f, t),
        ),
      ]);
      setRegras(r);
      const m = new Map<string, number>();
      v.forEach((x) => m.set(x.chave, (m.get(x.chave) ?? 0) + 1));
      setPendentes([...m.entries()].map(([chave, n]) => ({ chave, n })).sort((a, b) => b.n - a.n));
    } catch (e) {
      setErro((e as Error).message);
    }
  };
  useEffect(() => { carregar(); }, []);

  const salvar = async (r: Regra) => {
    setSalvando(true);
    const row = { ...r, source: r.source.trim().toLowerCase(), medium: (r.medium.trim() || "*").toLowerCase(), canal: r.canal.trim(), updated_at: new Date().toISOString() };
    const { error } = await supabase.from("channel_map").upsert(row, { onConflict: "source,medium" });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    clearDataCache();
    setForm({ source: "", medium: "*", canal: "", grupo: "pago" });
    carregar();
  };

  const remover = async (r: Regra) => {
    if (!window.confirm(`Remover a regra ${r.source} / ${r.medium}? Os pedidos que ela classificava passam para "Não classificado".`)) return;
    const { error } = await supabase.from("channel_map").delete().eq("source", r.source).eq("medium", r.medium);
    if (error) { setErro(error.message); return; }
    clearDataCache();
    carregar();
  };

  const preencher = (chave: string) => {
    const [s, m] = chave.split(" / ");
    setForm({ source: s, medium: s.startsWith("ref:") ? "*" : m || "*", canal: "", grupo: s.startsWith("ref:") ? "sem utm" : "pago" });
    document.getElementById("nova-regra")?.scrollIntoView({ behavior: "smooth" });
  };

  const q = busca.trim().toLowerCase();
  const lista = (regras ?? []).filter((r) => !q || `${r.source} ${r.medium} ${r.canal}`.toLowerCase().includes(q));
  const canaisExistentes = [...new Set((regras ?? []).map((r) => r.canal))].sort();

  return (
    <>
      <PageTitle title="Ajustes" sub="Tradução de UTMs em canais. Uma mudança aqui reclassifica todo o histórico." />
      {erro && <ErrorBox message={erro} />}

      <Card title="Não classificados" extra="visitas dos últimos 90 dias">
        {pendentes === null ? <Loading /> : pendentes.length === 0 ? (
          <Empty>Tudo classificado. Nenhuma origem desconhecida nos últimos 90 dias.</Empty>
        ) : (
          <ul className="m-0 mt-3 list-none p-0">
            {pendentes.map((p) => (
              <li key={p.chave} className="flex flex-wrap items-center gap-3 border-t border-soft py-2.5 text-sm">
                <code className="flex-auto break-all rounded bg-ground px-2 py-1 text-[13px]">{p.chave}</code>
                <span className="text-muted">{num(p.n)} visitas</span>
                <button type="button" onClick={() => preencher(p.chave)} className="min-h-9 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-ground">
                  Classificar
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Nova regra" className="scroll-mt-6">
        <form
          id="nova-regra"
          className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); if (form.source && form.canal) salvar(form); }}
        >
          <Campo label="utm_source" hint="ou ref:site para tráfego sem UTM">
            <input required value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="min-h-10 w-full rounded-lg border border-line px-3" />
          </Campo>
          <Campo label="utm_medium" hint="* vale para qualquer medium">
            <input value={form.medium} onChange={(e) => setForm({ ...form, medium: e.target.value })} className="min-h-10 w-full rounded-lg border border-line px-3" />
          </Campo>
          <Campo label="Canal">
            <input required list="canais" value={form.canal} onChange={(e) => setForm({ ...form, canal: e.target.value })} className="min-h-10 w-full rounded-lg border border-line px-3" />
            <datalist id="canais">{canaisExistentes.map((c) => <option key={c} value={c} />)}</datalist>
          </Campo>
          <Campo label="Grupo">
            <select value={form.grupo} onChange={(e) => setForm({ ...form, grupo: e.target.value })} className="min-h-10 w-full rounded-lg border border-line bg-white px-3">
              {GRUPOS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Campo>
          <button type="submit" disabled={salvando} className="min-h-10 rounded-lg bg-ink px-4 font-semibold text-white disabled:opacity-60">
            {salvando ? "Salvando…" : "Salvar regra"}
          </button>
        </form>
      </Card>

      <Card
        title={`Regras de canal${regras ? ` (${regras.length})` : ""}`}
        extra={
          <label>
            <span className="sr-only">Buscar regra</span>
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" className="min-h-10 w-48 rounded-lg border border-line px-3 text-sm text-ink" />
          </label>
        }
      >
        {regras === null ? <Loading /> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-2 font-semibold">utm_source</th>
                  <th scope="col" className="p-2 font-semibold">utm_medium</th>
                  <th scope="col" className="p-2 font-semibold">Canal</th>
                  <th scope="col" className="p-2 font-semibold">Grupo</th>
                  <th scope="col" className="py-2 pl-2"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((r) => (
                  <tr key={`${r.source}|${r.medium}`} className="border-t border-soft">
                    <td className="py-2 pr-2"><code className="text-[13px]">{r.source}</code></td>
                    <td className="p-2"><code className="text-[13px]">{r.medium}</code></td>
                    <td className="p-2 font-semibold">{r.canal}</td>
                    <td className="p-2 text-body">{r.grupo}</td>
                    <td className="py-2 pl-2 text-right">
                      <button type="button" onClick={() => setForm(r)} className="min-h-9 rounded-lg px-2.5 text-[13px] font-semibold text-roxo-texto hover:bg-ground">Editar</button>
                      <button type="button" onClick={() => remover(r)} className="min-h-9 rounded-lg px-2.5 text-[13px] font-semibold text-ruim hover:bg-ground">Remover</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-semibold">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}
