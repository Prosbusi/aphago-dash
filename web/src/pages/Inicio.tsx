import { useEffect, useState } from "react";
import { usePeriod } from "../period-context";
import { useDataVersion } from "../lib/data";
import { supabase } from "../lib/supabase";
import { delta, diaMes, money, num } from "../lib/format";
import { ACCENT } from "../components/Layout";
import { ErrorBox, Kpi, Loading, PageTitle } from "../components/ui";
import { PeriodPicker } from "../components/PeriodPicker";

type Valores = { vendas: number; estornos: number; pedidos: number; itens: number; custo: number; marketing: number; lucro: number };
type Loja = { store: string; nome: string; atual: Valores; anterior: Valores };
type Dados = { lojas: Loja[]; atualizado_em: string | null };

const somar = (l: Valores[]): Valores =>
  l.reduce((a, b) => ({
    vendas: a.vendas + +b.vendas, estornos: a.estornos + +b.estornos, pedidos: a.pedidos + +b.pedidos, itens: a.itens + +b.itens,
    custo: a.custo + +b.custo, marketing: a.marketing + +b.marketing, lucro: a.lucro + +b.lucro,
  }), { vendas: 0, estornos: 0, pedidos: 0, itens: 0, custo: 0, marketing: 0, lucro: 0 });

/** As quatro métricas do painel, com a variação contra o período anterior. */
function Metricas({ a, p }: { a: Valores; p: Valores }) {
  const retorno = a.marketing > 0 ? a.vendas / a.marketing : 0;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Kpi label="Total vendido" value={money(a.vendas)} delta={delta(a.vendas, p.vendas)} sub={`vs. ${money(p.vendas)}${a.estornos ? ` · já sem ${money(a.estornos)} de estornos` : ""}`} />
      <Kpi label="Pedidos (itens)" value={`${num(a.pedidos)} (${num(a.itens)})`} delta={delta(a.pedidos, p.pedidos)} sub={`vs. ${num(p.pedidos)} (${num(p.itens)} itens)`} />
      <Kpi label="Marketing" value={money(a.marketing)} delta={delta(a.marketing, p.marketing)} invert sub={retorno ? `retorno ${retorno.toFixed(2).replace(".", ",")}x · vs. ${money(p.marketing)}` : `vs. ${money(p.marketing)}`} />
      <Kpi label="Lucro" value={money(a.lucro)} delta={p.lucro ? delta(a.lucro, p.lucro) : null} sub={`vs. ${money(p.lucro)}${a.vendas ? ` · margem ${((a.lucro / a.vendas) * 100).toFixed(0)}%` : ""}`} />
    </div>
  );
}

export function Inicio() {
  const { period } = usePeriod();
  const v = useDataVersion();
  const [state, setState] = useState<{ data?: Dados; error?: string }>({});
  useEffect(() => {
    let vivo = true;
    setState({});
    supabase.rpc("painel_inicio", { p_inicio: period.start, p_fim: period.end, p_ant_inicio: period.prevStart, p_ant_fim: period.prevEnd }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) setState({ error: error.message });
      else setState({ data: data as Dados });
    });
    return () => { vivo = false; };
  }, [period.start, period.end, period.prevStart, period.prevEnd, v]);

  const d = state.data;
  return (
    <>
      <PageTitle title="Início" sub={`${diaMes(period.start)} a ${diaMes(period.end)} · comparado ao período anterior de mesmo tamanho`} right={<PeriodPicker />} />
      {state.error && <ErrorBox message={state.error} />}
      {!d && !state.error && <Loading />}
      {d && (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {d.lojas.map((l) => (
              <section key={l.store} aria-labelledby={`loja-${l.store}`} style={ACCENT[l.store]} className="rounded-[18px] border-t-4 border-roxo bg-white/60 p-4">
                <h2 id={`loja-${l.store}`} className="m-0 mb-3 flex items-center gap-2 text-xl font-extrabold">
                  <span aria-hidden="true" className="h-3 w-3 rounded-full bg-roxo" />
                  {l.nome}
                </h2>
                <Metricas a={l.atual} p={l.anterior} />
              </section>
            ))}
          </div>
          <section aria-labelledby="total" className="rounded-[18px] border-t-4 border-ink bg-white/60 p-4">
            <h2 id="total" className="m-0 mb-3 text-xl font-extrabold">Total das lojas</h2>
            <Metricas a={somar(d.lojas.map((l) => l.atual))} p={somar(d.lojas.map((l) => l.anterior))} />
          </section>
          <p className="m-0 text-xs text-muted">
            Total vendido: pedidos pagos no dia do pedido, menos estornos no dia em que foram feitos. Marketing: anúncios, e-mail, push e outros custos. Lucro: vendas − produtos − marketing − impostos, gateway e apps (mesma conta da Projeção).
            {d.atualizado_em && ` Vendas atualizadas às ${new Date(d.atualizado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`}
          </p>
        </>
      )}
    </>
  );
}
