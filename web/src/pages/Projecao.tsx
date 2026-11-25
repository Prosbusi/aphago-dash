import { useEffect, useState } from "react";
import { useStoreParam, nomeLoja } from "../lib/store";
import { useDataVersion } from "../lib/data";
import { supabase } from "../lib/supabase";
import { ddmm, dec, money } from "../lib/format";
import { Card, ErrorBox, Kpi, Loading, PageTitle } from "../components/ui";
import { Dica } from "../components/Dica";

type Estorno = { pedido: string | null; pedido_dia: string; valor: number; cancelado: boolean };
type Dia = {
  dia: string; dia_ant: string; offset: number;
  bruto: number; estornos: number; estornos_itens: Estorno[] | null; estornos_ant: number; estornos_ant_itens: Estorno[] | null;
  vendas: number; pedidos: number; custo: number; marketing: number; lucro: number;
  vendas_ant: number; pedidos_ant: number; custo_ant: number; marketing_ant: number; lucro_ant: number; tem_vendas_ant: boolean;
};
type Dados = { hoje: string; atualizado_em: string | null; historico_desde: string | null; dias: Dia[] };

const SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const diaSemana = (iso: string) => SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const roas = (v: number, m: number) => (m > 0 ? v / m : 0);
const fmtRoas = (r: number) => (r > 0 ? `${dec(r, 2)}x` : "—");

/** Bandeira vermelha no dia em que houve estorno; o detalhe aparece ao passar o mouse ou tocar. */
function Bandeira({ valor, itens }: { valor: number; itens: Estorno[] | null }) {
  if (!valor) return null;
  const detalhe = (itens ?? []).map((e) => `#${e.pedido ?? "?"} de ${ddmm(e.pedido_dia)}${e.cancelado ? " (cancelado)" : ""}: ${money(e.valor)}`).join("\n");
  const texto = `Estornos no dia: ${money(valor)} já descontados das vendas\n${detalhe}`;
  return (
    <Dica texto={texto} className="ml-1.5 align-middle text-ruim">
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M5 2a1 1 0 0 1 1 1v1h11.5a1 1 0 0 1 .8 1.6L15.75 9l2.55 3.4a1 1 0 0 1-.8 1.6H6v7a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Z" /></svg>
    </Dica>
  );
}

function Variacao({ atual, anterior, inverter = false }: { atual: number; anterior: number; inverter?: boolean }) {
  if (!anterior) return null;
  const d = ((atual - anterior) / Math.abs(anterior)) * 100;
  const bom = inverter ? d <= 0 : d >= 0;
  return <span className={`ml-1.5 text-[11px] font-bold ${bom ? "text-bom" : "text-ruim"}`}>{d > 0 ? "+" : ""}{dec(d, 0)}%</span>;
}

export function Projecao() {
  const store = useStoreParam();
  const v = useDataVersion();
  const [state, setState] = useState<{ data?: Dados; error?: string }>({});
  useEffect(() => {
    let vivo = true;
    setState({});
    supabase.rpc("projecao_diaria", { p_store: store }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) setState({ error: error.message });
      else setState({ data: data as Dados });
    });
    return () => { vivo = false; };
  }, [store, v]);

  const ano = state.data?.hoje.slice(0, 4) ?? "";
  const anoAnt = ano ? String(Number(ano) - 1) : "";

  return (
    <>
      <PageTitle title={`Projeção diária · ${nomeLoja(store)}`} sub={`Comparativo ${ano} vs ${anoAnt} · 7 dias atrás, hoje e 7 dias à frente, mesma data do ano anterior`} />
      {state.error && <ErrorBox message={state.error} />}
      {!state.data && !state.error && <Loading />}
      {state.data && <Conteudo d={state.data} ano={ano} anoAnt={anoAnt} />}
    </>
  );
}

function Conteudo({ d, ano, anoAnt }: { d: Dados; ano: string; anoAnt: string }) {
  const passados = d.dias.filter((x) => x.offset < 0);
  const hoje = d.dias.find((x) => x.offset === 0);
  const futuros = d.dias.filter((x) => x.offset > 0);
  const soma = (l: Dia[], k: keyof Dia) => l.reduce((s, x) => s + Number(x[k]), 0);
  const v7 = soma(passados, "vendas");
  const v7ant = soma(passados, "vendas_ant");
  const m7 = soma(passados, "marketing");
  const m7ant = soma(passados, "marketing_ant");
  const e7 = soma(passados, "estornos");
  const e7ant = soma(passados, "estornos_ant");
  const l7 = soma(passados, "lucro");
  const l7ant = soma(passados, "lucro_ant");
  const temHistorico = passados.some((x) => x.tem_vendas_ant);
  const ritmo = v7ant > 0 ? v7 / v7ant : null;
  const projetado = (x: Dia) => (ritmo != null ? x.vendas_ant * ritmo : null);
  const proximos = ritmo != null ? soma(futuros, "vendas_ant") * ritmo : null;
  const delta = (a: number, b: number) => (b ? ((a - b) / Math.abs(b)) * 100 : null);

  return (
    <>
      {!temHistorico && (
        <div role="status" className="rounded-[14px] border border-line bg-white p-5 text-sm text-body">
          O histórico de {anoAnt} ainda está sendo carregado da Shopify (mês a mês). As colunas de {anoAnt} se completam sozinhas nas próximas horas.
        </div>
      )}

      <section aria-label="Indicadores" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Kpi label="Vendas · últimos 7 dias" value={money(v7)} delta={delta(v7, v7ant)} sub={`vs. ${money(v7ant)} em ${anoAnt}${e7 ? ` · já sem ${money(e7)} de estornos` : ""}`} />
        <Kpi label="Marketing · últimos 7 dias" value={money(m7)} delta={delta(m7, m7ant)} invert sub={`retorno ${fmtRoas(roas(v7, m7))} · ${anoAnt}: ${fmtRoas(roas(v7ant, m7ant))}`} />
        <Kpi label="Lucro · últimos 7 dias" value={money(l7)} delta={delta(l7, l7ant)} sub={`vs. ${money(l7ant)} em ${anoAnt}`} />
        <Kpi
          label="Projeção · próximos 7 dias"
          value={proximos != null ? money(proximos) : "—"}
          sub={ritmo != null ? `${anoAnt} no mesmo período × ritmo de ${ritmo >= 1 ? "+" : ""}${dec((ritmo - 1) * 100, 0)}%` : `sem ${anoAnt} para comparar`}
        />
      </section>

      <Card title={`Comparativo ${ano} vs ${anoAnt}`} extra={d.atualizado_em ? `vendas atualizadas às ${new Date(d.atualizado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : undefined}>
        <div className="mt-3.5 overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th scope="col" rowSpan={2} className="py-2 pr-2 text-left align-bottom font-semibold">Data</th>
                <th scope="colgroup" colSpan={5} className="border-l border-soft p-2 text-center text-[13px] font-bold text-ink">{ano}</th>
                <th scope="colgroup" colSpan={5} className="border-l border-soft p-2 text-center text-[13px] font-bold text-ink">{anoAnt}</th>
              </tr>
              <tr className="text-xs text-muted">
                <th scope="col" className="border-l border-soft p-2 text-left font-semibold">Dia</th>
                <th scope="col" className="p-2 text-right font-semibold">Vendas</th>
                <th scope="col" className="p-2 text-right font-semibold">Marketing</th>
                <th scope="col" className="p-2 text-right font-semibold">Lucro</th>
                <th scope="col" className="p-2 text-right font-semibold">ROAS</th>
                <th scope="col" className="border-l border-soft p-2 text-left font-semibold">Dia</th>
                <th scope="col" className="p-2 text-right font-semibold">Vendas</th>
                <th scope="col" className="p-2 text-right font-semibold">Marketing</th>
                <th scope="col" className="p-2 text-right font-semibold">Lucro</th>
                <th scope="col" className="py-2 pl-2 text-right font-semibold">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {d.dias.map((x) => {
                const futuro = x.offset > 0;
                const proj = projetado(x);
                return (
                  <tr key={x.dia} className={`border-t border-soft ${x.offset === 0 ? "bg-roxo-claro/30" : futuro ? "bg-ground/60" : ""}`}>
                    <th scope="row" className="whitespace-nowrap py-[11px] pr-2 text-left font-semibold">
                      {ddmm(x.dia)}
                      {x.offset === 0 && <span className="ml-2 rounded-full bg-roxo-claro px-2 py-0.5 text-[11px] font-bold text-roxo-texto">hoje</span>}
                    </th>
                    <td className="border-l border-soft p-2 text-body">{diaSemana(x.dia)}</td>
                    <td className="whitespace-nowrap p-2 text-right">
                      {futuro ? (
                        proj != null ? <span className="text-muted" title={`${anoAnt} × ritmo dos últimos 7 dias`}>≈ {money(proj)}</span> : <span className="text-muted">—</span>
                      ) : (
                        <><Bandeira valor={x.estornos} itens={x.estornos_itens} /><span className="ml-1 font-semibold">{money(x.vendas)}</span><Variacao atual={x.vendas} anterior={x.vendas_ant} /></>
                      )}
                    </td>
                    <td className="whitespace-nowrap p-2 text-right">
                      {futuro ? <span className="text-muted">—</span> : <><span className="font-semibold">{money(x.marketing)}</span><Variacao atual={x.marketing} anterior={x.marketing_ant} inverter /></>}
                    </td>
                    <td className="whitespace-nowrap p-2 text-right">
                      {futuro ? <span className="text-muted">—</span> : <><span className={`font-semibold ${x.lucro < 0 ? "text-ruim" : ""}`}>{money(x.lucro)}</span><Variacao atual={x.lucro} anterior={x.lucro_ant} /></>}
                    </td>
                    <td className="whitespace-nowrap p-2 text-right">{futuro ? <span className="text-muted">—</span> : fmtRoas(roas(x.vendas, x.marketing))}</td>
                    <td className="border-l border-soft p-2 text-body">{diaSemana(x.dia_ant)}</td>
                    <td className="whitespace-nowrap p-2 text-right">{x.tem_vendas_ant ? <><Bandeira valor={x.estornos_ant} itens={x.estornos_ant_itens} /><span className="ml-1">{money(x.vendas_ant)}</span></> : "—"}</td>
                    <td className="whitespace-nowrap p-2 text-right">{x.marketing_ant ? money(x.marketing_ant) : "—"}</td>
                    <td className={`whitespace-nowrap p-2 text-right ${x.lucro_ant < 0 ? "text-ruim" : ""}`}>{x.tem_vendas_ant ? money(x.lucro_ant) : "—"}</td>
                    <td className="whitespace-nowrap py-2 pl-2 text-right">{fmtRoas(roas(x.vendas_ant, x.marketing_ant))}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line font-bold">
                <th scope="row" className="py-[11px] pr-2 text-left">7 dias até ontem{e7 + e7ant > 0 && <span className="block text-[11px] font-semibold text-muted">estornos {money(e7)} · {anoAnt}: {money(e7ant)}</span>}</th>
                <td className="border-l border-soft p-2" />
                <td className="whitespace-nowrap p-2 text-right">{money(v7)}<Variacao atual={v7} anterior={v7ant} /></td>
                <td className="whitespace-nowrap p-2 text-right">{money(m7)}<Variacao atual={m7} anterior={m7ant} inverter /></td>
                <td className="whitespace-nowrap p-2 text-right">{money(l7)}<Variacao atual={l7} anterior={l7ant} /></td>
                <td className="whitespace-nowrap p-2 text-right">{fmtRoas(roas(v7, m7))}</td>
                <td className="border-l border-soft p-2" />
                <td className="whitespace-nowrap p-2 text-right">{money(v7ant)}</td>
                <td className="whitespace-nowrap p-2 text-right">{money(m7ant)}</td>
                <td className="whitespace-nowrap p-2 text-right">{money(l7ant)}</td>
                <td className="whitespace-nowrap py-2 pl-2 text-right">{fmtRoas(roas(v7ant, m7ant))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {hoje && hoje.vendas > 0 && <p className="mb-0 mt-3 text-xs text-muted">Hoje ainda está em andamento; o total de 7 dias usa até ontem.</p>}
        <details className="mt-4 rounded-xl bg-ground px-4 py-3 text-[13px] text-body">
          <summary className="cursor-pointer font-semibold text-ink">Como cada número é calculado</summary>
          <ul className="mb-1 mt-2 list-disc space-y-1.5 pl-5">
            <li><strong>Vendas:</strong> valor dos pedidos pagos na Shopify no dia da compra (com frete e descontos), menos os estornos feitos naquele dia. É a mesma lógica do relatório de vendas da Shopify. Pedidos ainda não pagos (Pix aguardando, por exemplo) entram quando o pagamento é confirmado.</li>
            <li><strong>Bandeira vermelha:</strong> o dia teve estorno (reembolso total ou parcial, inclusive de pedidos cancelados). O valor sai das vendas do dia em que o estorno foi feito, não do dia do pedido. Passe o mouse para ver os pedidos.</li>
            <li><strong>Marketing:</strong> Meta + imposto do Meta (13,82%) + Google + outras plataformas + e-mail + push + outros custos de marketing cadastrados em Ajustes (valores mensais divididos pelos dias do mês). Em {anoAnt}, o Meta vem do total diário da conta.</li>
            <li><strong>Lucro:</strong> vendas − custo dos produtos − marketing (já com o imposto do Meta) − gateway (3,5% das vendas) − apps (5% das vendas) − imposto (14% do lucro bruto). É a mesma conta da planilha de lucro.</li>
            <li><strong>Custo dos produtos:</strong> custo cadastrado em cada variante na Shopify × quantidade. Variantes apagadas ou sem custo recebem a mesma proporção custo/venda do dia.</li>
            <li><strong>Projeção:</strong> vendas de {anoAnt} na mesma data × o ritmo dos últimos 7 dias (vendas de {ano} ÷ vendas de {anoAnt} no mesmo período).</li>
            <li><strong>ROAS:</strong> vendas ÷ marketing do dia (o retorno real, com todo o marketing).</li>
          </ul>
        </details>
      </Card>
    </>
  );
}
