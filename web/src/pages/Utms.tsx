import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { usePeriod } from "../period-context";
import { useStoreParam, nomeLoja } from "../lib/store";
import { dec, diaMes, money, money2, pct } from "../lib/format";
import { Card, Empty, ErrorBox, GrupoTag, Loading, PageTitle } from "../components/ui";
import { PeriodPicker } from "../components/PeriodPicker";
import { MODELOS, useUtmPainel, type LinhaUtm, type Modelo } from "../lib/utmPainel";

// Vendas por UTM. O crédito é o mesmo do Por canal (soma por canal bate), repartido entre as UTMs de cada pedido.

type Dim = "canal" | "source" | "medium" | "campanha" | "conteudo" | "termo";
const DIMS: { id: Dim; nome: string }[] = [
  { id: "canal", nome: "Canal" },
  { id: "source", nome: "Source" },
  { id: "medium", nome: "Medium" },
  { id: "campanha", nome: "Campanha" },
  { id: "conteudo", nome: "Conteúdo" },
  { id: "termo", nome: "Termo" },
];
const PADRAO: Dim[] = ["canal", "source", "medium", "campanha"];
const ped = (n: number) => dec(Number(n) || 0, 1);
const vazio = (d: Dim) => (d === "campanha" ? "(sem campanha)" : d === "canal" ? "—" : "(vazio)");

type Agrupada = {
  chave: string; valores: Partial<Record<Dim, string | null>>; grupo: string;
  valor: number; pedidos: number; novos: number; passaram: number; linhas: number;
  mensagem: LinhaUtm["mensagem"];
};

export function Utms() {
  const { period } = usePeriod();
  const store = useStoreParam();
  const [params, setParams] = useSearchParams();
  const modelo = (params.get("modelo") as Modelo) || "linear";
  const canal = params.get("canal") ?? "";
  const campanha = params.get("campanha");
  const [busca, setBusca] = useState(params.get("busca") ?? "");
  const [dims, setDims] = useState<Dim[]>(() => {
    const d = params.get("por")?.split(",").filter((x): x is Dim => DIMS.some((y) => y.id === x));
    return d?.length ? d : campanha !== null ? ["campanha", "conteudo"] : PADRAO;
  });
  const [ordem, setOrdem] = useState<"valor" | "pedidos" | "passaram">("valor");
  const [limite, setLimite] = useState(150);
  const { data, error } = useUtmPainel(store, period.start, period.end, modelo);

  const muda = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v === null || v === "") p.delete(k); else p.set(k, v);
    setParams(p, { replace: true });
  };
  const alterna = (d: Dim) => setDims((x) => (x.includes(d) ? (x.length > 1 ? x.filter((y) => y !== d) : x) : DIMS.map((y) => y.id).filter((y) => y === d || x.includes(y))));

  const canais = useMemo(() => [...new Set((data ?? []).map((l) => l.canal))].sort(), [data]);
  const totalGeral = useMemo(() => (data ?? []).reduce((a, l) => a + l.valor, 0), [data]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (data ?? []).filter((l) => {
      if (canal && l.canal !== canal) return false;
      if (campanha !== null && l.campanha !== campanha) return false;
      if (!q) return true;
      return [l.canal, l.source, l.medium, l.campanha, l.conteudo, l.termo, l.mensagem?.titulo].some((x) => x && x.toLowerCase().includes(q));
    });
  }, [data, canal, campanha, busca]);

  const detalhe = dims.length === DIMS.length || (dims.includes("conteudo") && dims.includes("termo") && dims.includes("campanha") && dims.includes("source") && dims.includes("medium"));
  const linhas = useMemo(() => {
    const m = new Map<string, Agrupada>();
    for (const l of filtradas) {
      const valores = Object.fromEntries(dims.map((d) => [d, l[d]])) as Agrupada["valores"];
      const chave = dims.map((d) => l[d] ?? "∅").join("|");
      const a = m.get(chave) ?? { chave, valores, grupo: l.grupo, valor: 0, pedidos: 0, novos: 0, passaram: 0, linhas: 0, mensagem: null };
      a.valor += l.valor; a.pedidos += l.pedidos; a.novos += l.novos; a.passaram += l.passaram; a.linhas += 1;
      if (!a.mensagem && l.mensagem && dims.includes("conteudo")) a.mensagem = l.mensagem;
      m.set(chave, a);
    }
    return [...m.values()].sort((a, b) => b[ordem] - a[ordem]);
  }, [filtradas, dims, ordem]);
  const tot = linhas.reduce((a, l) => ({ valor: a.valor + l.valor, pedidos: a.pedidos + l.pedidos, novos: a.novos + l.novos }), { valor: 0, pedidos: 0, novos: 0 });

  const th = "p-2 text-right font-semibold";
  const ordBtn = (k: typeof ordem, nome: string) => (
    <button type="button" onClick={() => setOrdem(k)} className={`font-semibold ${ordem === k ? "text-ink underline" : "hover:text-ink"}`}>{nome}{ordem === k ? " ▾" : ""}</button>
  );

  return (
    <>
      <PageTitle title={`UTMs · ${nomeLoja(store)}`} sub={`${diaMes(period.start)} a ${diaMes(period.end)}`} right={<PeriodPicker />} />

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Modelo de atribuição" className="flex flex-wrap gap-1 rounded-xl border border-line bg-white p-1">
          {MODELOS.map((x) => (
            <button key={x.id} type="button" aria-pressed={modelo === x.id} onClick={() => muda("modelo", x.id === "linear" ? null : x.id)}
              className={`min-h-9 rounded-lg px-3 text-[13px] font-semibold ${modelo === x.id ? "bg-ink text-white" : "text-body hover:bg-soft"}`}>
              {x.nome}{x.id === "linear" ? " (padrão)" : ""}
            </button>
          ))}
        </div>
        <select aria-label="Canal" value={canal} onChange={(e) => muda("canal", e.target.value)} className="min-h-10 rounded-xl border border-line bg-white px-3 text-sm">
          <option value="">Todos os canais</option>
          {canais.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="search" aria-label="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar source, campanha, conteúdo, mensagem…" className="min-h-10 w-full max-w-sm flex-1 rounded-xl border border-line bg-white px-3 text-sm" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-muted">Agrupar por</span>
        {DIMS.map((d) => (
          <button key={d.id} type="button" aria-pressed={dims.includes(d.id)} onClick={() => alterna(d.id)}
            className={`min-h-8 rounded-full border px-3 text-[13px] font-semibold ${dims.includes(d.id) ? "border-roxo/50 bg-roxo-claro/60 text-roxo-texto" : "border-line bg-white text-body hover:bg-soft"}`}>
            {d.nome}
          </button>
        ))}
        {campanha !== null && (
          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-[13px]">
            Campanha: <strong>{campanha || "(sem campanha)"}</strong>
            <button type="button" aria-label="Tirar filtro de campanha" className="ml-1 font-bold text-muted" onClick={() => muda("campanha", null)}>×</button>
          </span>
        )}
      </div>

      {error && <ErrorBox message={error} />}
      {!data && !error && <Loading texto="Somando as UTMs do período…" />}
      {data && !linhas.length && <Card><Empty>Nenhuma UTM com venda {busca || canal ? "nesse filtro" : "no período"}.</Empty></Card>}

      {data && linhas.length > 0 && (
        <Card title={`${linhas.length} ${linhas.length === 1 ? "linha" : "linhas"}`} extra={`${money(tot.valor)} · ${pct(totalGeral ? (tot.valor / totalGeral) * 100 : 0)} do total`}>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  {dims.map((d) => <th key={d} scope="col" className="py-2 pr-3 font-semibold">{DIMS.find((x) => x.id === d)!.nome}</th>)}
                  <th scope="col" className={th}>{ordBtn("pedidos", "Pedidos")}</th>
                  <th scope="col" className={th}>{ordBtn("valor", "Faturamento")}</th>
                  <th scope="col" className={th}>Ticket</th>
                  <th scope="col" className={th}>Novos</th>
                  {detalhe && <th scope="col" className={th} title="Pedidos que tiveram uma visita com esta UTM, com crédito cheio">{ordBtn("passaram", "Passaram")}</th>}
                </tr>
              </thead>
              <tbody>
                {linhas.slice(0, limite).map((l) => (
                  <tr key={l.chave} className="border-t border-soft align-top">
                    {dims.map((d) => (
                      <td key={d} className="max-w-[260px] py-2 pr-3">
                        {d === "canal" ? (
                          <span className="font-semibold">{l.valores.canal}<GrupoTag grupo={l.grupo} /></span>
                        ) : (
                          <span className={`break-words ${l.valores[d] ? "" : "text-muted"}`}>{l.valores[d] || vazio(d)}</span>
                        )}
                        {d === "conteudo" && l.mensagem && (
                          <span className="mt-0.5 block text-xs text-roxo-texto">
                            {l.mensagem.canal}: {l.mensagem.titulo || "mensagem"} · {new Date(l.mensagem.enviar_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="p-2 text-right">{ped(l.pedidos)}</td>
                    <td className="p-2 text-right font-semibold">{money(l.valor)}</td>
                    <td className="p-2 text-right">{l.pedidos ? money2(l.valor / l.pedidos) : "—"}</td>
                    <td className="p-2 text-right text-body">{ped(l.novos)}</td>
                    {detalhe && <td className="p-2 text-right text-body">{l.passaram}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-bold">
                  <td className="py-2 pr-3" colSpan={dims.length}>Total</td>
                  <td className="p-2 text-right">{ped(tot.pedidos)}</td>
                  <td className="p-2 text-right">{money(tot.valor)}</td>
                  <td className="p-2 text-right">{tot.pedidos ? money2(tot.valor / tot.pedidos) : "—"}</td>
                  <td className="p-2 text-right">{ped(tot.novos)}</td>
                  {detalhe && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
          {linhas.length > limite && (
            <button type="button" className="mt-3 min-h-10 rounded-xl border border-line bg-white px-4 text-sm font-semibold hover:bg-soft" onClick={() => setLimite((n) => n + 300)}>
              Mostrar mais {Math.min(300, linhas.length - limite)}
            </button>
          )}
          <p className="mb-0 mt-3 text-xs leading-relaxed text-muted">
            O crédito é o mesmo do Por canal: cada pedido divide o valor entre os canais do caminho, e dentro do canal entre as UTMs que usou. Por isso a soma de um canal aqui bate com o Por canal.
            {detalhe && " \"Passaram\" conta todo pedido que teve uma visita com a UTM, com crédito cheio (um pedido pode aparecer em mais de uma linha)."}
            {" "}Pedidos com uma casa decimal: um pedido pode ser dividido entre UTMs. O filtro de horário do Por canal não vale aqui.
          </p>
        </Card>
      )}
    </>
  );
}
