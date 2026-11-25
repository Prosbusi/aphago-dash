import { useEffect, useState } from "react";
import { usePeriod } from "../period-context";
import { useDataVersion } from "../lib/data";
import { supabase } from "../lib/supabase";
import { delta, diaMes, money, num } from "../lib/format";
import { ACCENT } from "../components/Layout";
import { ErrorBox, Loading, PageTitle } from "../components/ui";
import { PeriodPicker } from "../components/PeriodPicker";
import { Dica } from "../components/Dica";

type Valores = { vendas: number; estornos: number; pedidos: number; itens: number; custo: number; marketing: number; lucro: number };
type Loja = { store: string; nome: string; atual: Valores; anterior: Valores };
type Dados = { lojas: Loja[]; atualizado_em: string | null };

const somar = (l: Valores[]): Valores =>
  l.reduce((a, b) => ({
    vendas: a.vendas + +b.vendas, estornos: a.estornos + +b.estornos, pedidos: a.pedidos + +b.pedidos, itens: a.itens + +b.itens,
    custo: a.custo + +b.custo, marketing: a.marketing + +b.marketing, lucro: a.lucro + +b.lucro,
  }), { vendas: 0, estornos: 0, pedidos: 0, itens: 0, custo: 0, marketing: 0, lucro: 0 });

type Tom = "neutro" | "bom" | "ruim" | "aphago" | "abrasso";
const TOM: Record<Tom, string> = {
  neutro: "border-line bg-white",
  bom: "border-bom/60 bg-[#EAF5EF]",
  ruim: "border-ruim/50 bg-[#FBECEA]",
  aphago: "border-aphago/70 bg-[#F4ECFD]",
  abrasso: "border-abrasso/60 bg-[#F8EAEC]",
};

/** Quadro do painel: valor grande, nome embaixo com explicação no (?), variação contra o período anterior. */
function Quadro({ valor, nome, ajuda, variacao, inverter = false, tom = "neutro" }: {
  valor: string; nome: string; ajuda: string; variacao?: number | null; inverter?: boolean; tom?: Tom;
}) {
  const bom = variacao != null && (inverter ? variacao <= 0 : variacao >= 0);
  return (
    <div className={`rounded-[16px] border-2 px-4 py-4 sm:px-5 ${TOM[tom]}`}>
      <div className="text-[22px] font-extrabold leading-tight tracking-tight sm:text-[28px]">{valor}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-muted sm:text-sm">
        {nome}
        <Dica texto={ajuda} className="h-[18px] w-[18px] shrink-0 border border-current text-[11px] font-bold">?</Dica>
      </div>
      {variacao != null && (
        <div className={`mt-1 text-xs font-bold ${bom ? "text-bom" : "text-ruim"}`}>
          {variacao >= 0 ? "▲" : "▼"} {Math.abs(variacao).toFixed(1).replace(".", ",")}% <span className="font-medium text-muted">vs. período anterior</span>
        </div>
      )}
    </div>
  );
}

const AJUDA = {
  vendido: "Pedidos pagos no dia do pedido, menos os estornos feitos no período (no dia em que aconteceram).",
  pedidos: "Pedidos pagos no período e, entre parênteses, a quantidade de itens vendidos.",
  marketing: "Meta + imposto do Meta (13,82%) + Google + outras plataformas + e-mail + push + outros custos cadastrados em Ajustes.",
  lucro: "Vendas − custo dos produtos − marketing (já com o imposto do Meta) − gateway (3,5%) − apps (5%) − imposto (14% do lucro bruto).",
};

/** As quatro métricas em duas colunas. */
function Metricas({ a, p, tomLucro = "neutro" }: { a: Valores; p: Valores; tomLucro?: Tom }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      <Quadro valor={money(a.vendas)} nome="Total vendido" ajuda={AJUDA.vendido} variacao={delta(a.vendas, p.vendas)} />
      <Quadro valor={`${num(a.pedidos)} (${num(a.itens)})`} nome="Pedidos (itens)" ajuda={AJUDA.pedidos} variacao={delta(a.pedidos, p.pedidos)} />
      <Quadro valor={money(a.marketing)} nome="Marketing" ajuda={AJUDA.marketing} variacao={delta(a.marketing, p.marketing)} inverter />
      <Quadro valor={money(a.lucro)} nome="Lucro" ajuda={AJUDA.lucro} variacao={p.lucro ? delta(a.lucro, p.lucro) : null} tom={a.lucro < 0 ? "ruim" : tomLucro} />
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
              <section key={l.store} aria-labelledby={`loja-${l.store}`} style={ACCENT[l.store]} className="rounded-[22px] border border-line bg-white p-4 sm:p-6">
                <h2 id={`loja-${l.store}`} className="m-0 mb-4 flex items-center gap-2 text-xl font-extrabold">
                  <span aria-hidden="true" className="h-3 w-3 rounded-full bg-roxo" />
                  {l.nome}
                </h2>
                <Metricas a={l.atual} p={l.anterior} />
              </section>
            ))}
          </div>
          <section aria-labelledby="total" className="rounded-[22px] border border-line bg-white p-4 sm:p-6">
            <h2 id="total" className="m-0 text-xl font-extrabold">Resumo (total)</h2>
            <p className="mb-4 mt-1 text-sm text-muted">{d.lojas.map((l) => l.nome).join(" + ")} · pedidos pagos</p>
            <Metricas a={somar(d.lojas.map((l) => l.atual))} p={somar(d.lojas.map((l) => l.anterior))} tomLucro="bom" />
            <div className="mt-3 grid grid-cols-2 gap-3 sm:mt-4 sm:gap-4">
              {d.lojas.map((l) => (
                <Quadro
                  key={l.store}
                  valor={money(l.atual.lucro)}
                  nome={`Lucro · ${l.nome}`}
                  ajuda={AJUDA.lucro}
                  variacao={l.anterior.lucro ? delta(l.atual.lucro, l.anterior.lucro) : null}
                  tom={l.store === "aphago" ? "aphago" : "abrasso"}
                />
              ))}
            </div>
          </section>
          <p className="m-0 text-xs text-muted">
            Passe o mouse ou toque no (?) para ver como cada número é calculado.
            {d.atualizado_em && ` Vendas atualizadas às ${new Date(d.atualizado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`}
          </p>
        </>
      )}
    </>
  );
}
