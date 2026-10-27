import { Link } from "react-router-dom";
import { usePeriod } from "../period-context";
import { useStoreParam, nomeLoja } from "../lib/store";
import { useDashData } from "../lib/data";
import { byCanal, byDay, byProduto, kpis } from "../lib/agg";
import { listDays } from "../lib/period";
import { ddmm, delta, diaMes, money, money2, num, pct } from "../lib/format";
import { Card, Empty, ErrorBox, GrupoTag, Kpi, Loading, PageTitle, ShareBar } from "../components/ui";
import { PeriodPicker } from "../components/PeriodPicker";

export function VisaoGeral() {
  const { period } = usePeriod();
  const store = useStoreParam();
  const { data, error, loading } = useDashData(period, store);

  return (
    <>
      <PageTitle
        title={`Visão geral · ${nomeLoja(store)}`}
        sub={`${diaMes(period.start)} a ${diaMes(period.end)} · comparado ao período anterior de mesmo tamanho`}
        right={<PeriodPicker />}
      />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && <Conteudo data={data} start={period.start} end={period.end} store={store} />}
    </>
  );
}

function Conteudo({ data, start, end, store }: { data: NonNullable<ReturnType<typeof useDashData>["data"]>; start: string; end: string; store: string }) {
  const k = kpis(data.orders);
  const kp = kpis(data.prevOrders);
  const dias = byDay(data.orders, listDays(start, end));
  const max = Math.max(...dias.map((d) => d.fat), 1);
  const pico = dias.reduce((a, b) => (b.fat > a.fat ? b : a), dias[0]);
  const canais = byCanal(data.orders).slice(0, 8);
  const maxShare = Math.max(...canais.map((c) => c.share), 1);
  const semUtm = byCanal(data.orders)
    .filter((c) => c.grupo === "direto" || c.grupo === "sem utm")
    .reduce((s, c) => s + c.share, 0);
  const produtos = byProduto(data.items).slice(0, 6);
  const step = Math.max(1, Math.ceil(dias.length / 6));

  return (
    <>
      <section aria-label="Indicadores" className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
        <Kpi label="Faturamento" value={money(k.fat)} delta={delta(k.fat, kp.fat)} sub={`vs. ${money(kp.fat)}`} />
        <Kpi label="Pedidos" value={num(k.ped)} delta={delta(k.ped, kp.ped)} sub={`vs. ${num(kp.ped)}`} />
        <Kpi label="Ticket médio" value={money2(k.ticket)} delta={delta(k.ticket, kp.ticket)} sub={`vs. ${money2(kp.ticket)}`} />
        <Kpi
          label="Clientes novos"
          value={num(k.novos)}
          sub={k.ped ? `${pct((k.novos / k.ped) * 100, 0)} dos pedidos · ${num(k.ped - k.novos)} recompras` : undefined}
        />
      </section>

      {dias.length > 1 && (
        <Card
          title="Faturamento por dia"
          extra={pico.fat > 0 ? `Pico em ${ddmm(pico.dia)}: ${money(pico.fat)} em ${pico.ped} pedidos` : undefined}
        >
          <div className="mt-[18px] overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="flex h-[200px] items-end gap-1.5 border-b border-[#D6D1C7]">
                {dias.map((d) => (
                  <div
                    key={d.dia}
                    title={`${ddmm(d.dia)}: ${money(d.fat)} · ${d.ped} pedidos`}
                    className={`flex-1 rounded-t ${d === pico ? "bg-roxo" : "bg-roxo-claro"}`}
                    style={{ height: `${Math.max(d.fat > 0 ? 4 : 0, Math.round((d.fat / max) * 190))}px` }}
                  />
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                {dias.map((d, i) => (
                  <div key={d.dia} className="flex-1 whitespace-nowrap text-center text-[11px] text-muted">
                    {i % step === 0 || i === dias.length - 1 ? ddmm(d.dia) : ""}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-start gap-6">
        <Card
          className="flex-[999_1_560px]"
          title={<>Por canal <span className="text-[13px] font-medium text-muted">· último clique</span></>}
          extra={<Link to={`/${store}/canais`} className="font-semibold">Ver todos os canais</Link>}
        >
          {canais.length === 0 ? (
            <Empty>Nenhum pedido no período.</Empty>
          ) : (
            <div className="mt-3.5 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="py-2 pr-2 font-semibold">Canal</th>
                    <th scope="col" className="w-[34%] p-2 font-semibold">Participação</th>
                    <th scope="col" className="p-2 text-right font-semibold">Pedidos</th>
                    <th scope="col" className="p-2 text-right font-semibold">Faturamento</th>
                    <th scope="col" className="py-2 pl-2 text-right font-semibold">Novos</th>
                  </tr>
                </thead>
                <tbody>
                  {canais.map((c) => (
                    <tr key={c.canal} className="border-t border-soft">
                      <td className="py-[11px] pr-2 font-semibold">{c.canal}<GrupoTag grupo={c.grupo} /></td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <ShareBar value={c.share} max={maxShare} />
                          <span className="w-10 text-right text-xs text-body">{pct(c.share)}</span>
                        </div>
                      </td>
                      <td className="p-2 text-right">{num(c.ped)}</td>
                      <td className="p-2 text-right font-semibold">{money(c.fat)}</td>
                      <td className="py-2 pl-2 text-right text-body">{num(c.novos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {semUtm > 0 && (
            <p className="mt-3.5 text-[13px] text-muted">
              {pct(semUtm, 0)} do faturamento chega sem UTM (direto ou sem marcação). A padronização dos links reduz essa fatia.
            </p>
          )}
        </Card>

        <Card className="flex-[1_1_380px]" title="Produtos que mais faturam" extra={<Link to={`/${store}/produtos`} className="font-semibold">Ver todos</Link>}>
          {produtos.length === 0 ? (
            <Empty>Nenhum produto vendido no período.</Empty>
          ) : (
            <ol className="m-0 mt-3.5 list-none p-0">
              {produtos.map((p, i) => (
                <li key={p.produto} className="flex items-center gap-3 border-t border-soft py-[11px]">
                  <span className="w-[22px] text-[13px] font-bold text-muted">{i + 1}</span>
                  <div className="min-w-0 flex-auto">
                    <div className="truncate text-sm font-semibold">{p.produto}</div>
                    <div className="mt-0.5 text-xs text-muted">{num(p.qtd)} vendidos · mais via {p.canal}</div>
                  </div>
                  <span className="text-sm font-bold">{money(p.fat)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
