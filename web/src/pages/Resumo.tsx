import { Link } from "react-router-dom";
import { usePeriod } from "../period-context";
import { useDashData, type OrderRow } from "../lib/data";
import { byDay, byGrupo, kpis } from "../lib/agg";
import { listDays } from "../lib/period";
import { LOJAS } from "../lib/store";
import { ddmm, delta, diaMes, money, money2, num, pct } from "../lib/format";
import { Card, Empty, ErrorBox, Kpi, Loading, PageTitle } from "../components/ui";
import { PeriodPicker } from "../components/PeriodPicker";

const GRUPOS: { id: string; nome: string }[] = [
  { id: "pago", nome: "Pago" },
  { id: "organico", nome: "Orgânico" },
  { id: "mensagem", nome: "Mensagens" },
  { id: "direto", nome: "Direto" },
  { id: "sem utm", nome: "Sem UTM" },
  { id: "não classificado", nome: "Não classificado" },
];

export function Resumo() {
  const { period } = usePeriod();
  const { data, error, loading } = useDashData(period, null);

  return (
    <>
      <PageTitle
        title="Resumo das lojas"
        sub={`${diaMes(period.start)} a ${diaMes(period.end)} · Aphago e Abrasso juntas e lado a lado`}
        right={<PeriodPicker />}
      />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && <Conteudo orders={data.orders} prev={data.prevOrders} start={period.start} end={period.end} />}
    </>
  );
}

function Conteudo({ orders, prev, start, end }: { orders: OrderRow[]; prev: OrderRow[]; start: string; end: string }) {
  const k = kpis(orders);
  const kp = kpis(prev);
  const lojas = LOJAS.map((l) => {
    const o = orders.filter((x) => x.store === l.id);
    const p = prev.filter((x) => x.store === l.id);
    return { ...l, k: kpis(o), kp: kpis(p), orders: o };
  });
  const dias = listDays(start, end);
  const porLoja = lojas.map((l) => byDay(l.orders, dias));
  const totDia = dias.map((_, i) => porLoja.reduce((s, d) => s + d[i].fat, 0));
  const max = Math.max(...totDia, 1);
  const step = Math.max(1, Math.ceil(dias.length / 6));
  const grupos = lojas.map((l) => new Map(byGrupo(l.orders).map((g) => [g.grupo, g.share])));

  return (
    <>
      <section aria-label="As duas lojas juntas" className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
        <Kpi label="Faturamento total" value={money(k.fat)} delta={delta(k.fat, kp.fat)} sub={`vs. ${money(kp.fat)}`} />
        <Kpi label="Pedidos" value={num(k.ped)} delta={delta(k.ped, kp.ped)} sub={`vs. ${num(kp.ped)}`} />
        <Kpi label="Ticket médio" value={money2(k.ticket)} delta={delta(k.ticket, kp.ticket)} sub={`vs. ${money2(kp.ticket)}`} />
        <Kpi label="Clientes novos" value={num(k.novos)} sub={k.ped ? `${pct((k.novos / k.ped) * 100, 0)} dos pedidos` : undefined} />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        {lojas.map((l) => (
          <Card
            key={l.id}
            title={<span className="flex items-center gap-2"><span aria-hidden="true" className="h-3 w-3 rounded-[3px]" style={{ background: l.cor }} />{l.nome}</span>}
            extra={<Link to={`/${l.id}`} className="font-semibold">Abrir análises da {l.nome}</Link>}
          >
            <dl className="m-0 mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
              <Metrica nome="Faturamento" valor={money(l.k.fat)} d={delta(l.k.fat, l.kp.fat)} />
              <Metrica nome="Pedidos" valor={num(l.k.ped)} d={delta(l.k.ped, l.kp.ped)} />
              <Metrica nome="Ticket médio" valor={money2(l.k.ticket)} d={delta(l.k.ticket, l.kp.ticket)} />
              <Metrica nome="Clientes novos" valor={l.k.ped ? pct((l.k.novos / l.k.ped) * 100, 0) : "—"} />
            </dl>
            <p className="mb-0 mt-4 text-[13px] text-muted">{k.fat ? `${pct((l.k.fat / k.fat) * 100, 0)} do faturamento das duas lojas` : "Sem vendas no período."}</p>
          </Card>
        ))}
      </div>

      {dias.length > 1 && (
        <Card
          title="Faturamento por dia"
          extra={
            <span className="flex flex-wrap gap-4">
              {lojas.map((l) => (
                <span key={l.id} className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[3px]" style={{ background: l.cor }} />{l.nome}</span>
              ))}
            </span>
          }
        >
          <div className="mt-[18px] overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="flex h-[200px] items-end gap-1.5 border-b border-[#D6D1C7]">
                {dias.map((d, i) => (
                  <div
                    key={d}
                    className="flex flex-1 flex-col-reverse overflow-hidden rounded-t"
                    style={{ height: `${Math.round((totDia[i] / max) * 190)}px` }}
                    title={`${ddmm(d)}: ${lojas.map((l, j) => `${l.nome} ${money(porLoja[j][i].fat)}`).join(" · ")}`}
                  >
                    {lojas.map((l, j) => (
                      <div key={l.id} style={{ background: l.cor, height: totDia[i] ? `${(porLoja[j][i].fat / totDia[i]) * 100}%` : 0 }} />
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                {dias.map((d, i) => (
                  <div key={d} className="flex-1 whitespace-nowrap text-center text-[11px] text-muted">
                    {i % step === 0 || i === dias.length - 1 ? ddmm(d) : ""}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card title="De onde vem o faturamento" extra="último clique, % do faturamento de cada loja">
        {orders.length === 0 ? (
          <Empty>Nenhum pedido no período.</Empty>
        ) : (
          <div className="mt-3.5 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-2 font-semibold">Grupo de canal</th>
                  {lojas.map((l) => <th key={l.id} scope="col" className="p-2 text-right font-semibold">{l.nome}</th>)}
                </tr>
              </thead>
              <tbody>
                {GRUPOS.filter((g) => grupos.some((m) => m.has(g.id))).map((g) => (
                  <tr key={g.id} className="border-t border-soft">
                    <td className="py-[11px] pr-2 font-semibold">{g.nome}</td>
                    {grupos.map((m, j) => (
                      <td key={lojas[j].id} className="p-2 text-right">{m.has(g.id) ? pct(m.get(g.id)!, 0) : "—"}</td>
                    ))}
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

function Metrica({ nome, valor, d }: { nome: string; valor: string; d?: number | null }) {
  return (
    <div>
      <dt className="text-[13px] font-semibold text-muted">{nome}</dt>
      <dd className="m-0 mt-1 text-2xl font-extrabold tracking-tight">{valor}</dd>
      {d != null && <dd className={`m-0 mt-0.5 text-[13px] font-bold ${d >= 0 ? "text-bom" : "text-ruim"}`}>{d >= 0 ? "▲" : "▼"} {pct(Math.abs(d))}</dd>}
    </div>
  );
}
