import { usePeriod } from "../period-context";
import { useStoreParam, nomeLoja } from "../lib/store";
import { useDashData } from "../lib/data";
import { caminhos, faixasVisitas, media, papeis } from "../lib/agg";
import { dec, diaMes, num, pct } from "../lib/format";
import { Card, Empty, ErrorBox, Loading, PageTitle } from "../components/ui";
import { PeriodPicker } from "../components/PeriodPicker";

export function Jornada() {
  const { period } = usePeriod();
  const store = useStoreParam();
  const { data, error, loading } = useDashData(period, store);

  return (
    <>
      <PageTitle
        title={`Jornada · ${nomeLoja(store)}`}
        sub={`Como o cliente chega até a compra · ${diaMes(period.start)} a ${diaMes(period.end)}${data ? ` · ${num(data.orders.length)} pedidos` : ""}`}
        right={<PeriodPicker />}
      />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && (data.orders.length === 0 ? <Empty>Nenhum pedido no período.</Empty> : <Conteudo orders={data.orders} />)}
    </>
  );
}

function Conteudo({ orders }: { orders: NonNullable<ReturnType<typeof useDashData>["data"]>["orders"] }) {
  const p = papeis(orders).slice(0, 8);
  const maxP = Math.max(...p.map((r) => Math.max(r.abre, r.fecha)), 1);
  const cam = caminhos(orders).slice(0, 6);
  const faixas = faixasVisitas(orders);
  const totF = faixas.reduce((s, f) => s + f.n, 0) || 1;
  const maxF = Math.max(...faixas.map((f) => f.n), 1);
  const metaAbreOutroFecha = orders.filter((o) => o.canal_primeiro === "Meta Ads" && o.canal_ultimo !== "Meta Ads").length;
  const bar = (n: number, cls: string) => (
    <div className="flex items-center gap-2">
      <div className={`h-3 min-w-[3px] rounded-[3px] ${cls}`} style={{ width: `calc(${Math.max(1, (n / maxP) * 100)}% - 40px)` }} />
      <span className="text-xs text-body">{num(n)}</span>
    </div>
  );

  return (
    <>
      <section aria-label="Resumo da jornada" className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
        <Resumo label="Tempo até a compra" valor={`${dec(media(orders.map((o) => o.days_to_conversion)))} dias`} sub="média da 1ª visita ao pedido" />
        <Resumo label="Visitas até comprar" valor={dec(media(orders.map((o) => o.visits_count)))} sub={`${pct((faixas[0].n / totF) * 100, 0)} compram na primeira visita`} />
        <Resumo label="Abertas pelo Meta, fechadas por outro canal" valor={`${num(metaAbreOutroFecha)} vendas`} sub="crédito que o último clique não dá ao Meta" />
      </section>

      <div className="flex flex-wrap items-start gap-6">
        <Card className="flex-[999_1_560px]" title="Quem abre e quem fecha a venda">
          <div className="mt-2.5 flex flex-wrap gap-[18px] text-[13px] text-body">
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[3px] bg-roxo" />Abre (primeiro clique)</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[3px] bg-laranja" />Fecha (último clique)</span>
          </div>
          <div className="mt-[18px] flex flex-col gap-3.5">
            {p.map((r) => (
              <div key={r.canal} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <div className="w-[170px] text-sm font-semibold">{r.canal}</div>
                <div className="flex flex-[1_1_300px] flex-col gap-1">
                  {bar(r.abre, "bg-roxo")}
                  {bar(r.fecha, "bg-laranja")}
                </div>
                <div className="w-[120px] text-right text-xs font-bold text-body">
                  {r.abre > r.fecha * 1.15 ? "mais abre" : r.fecha > r.abre * 1.15 ? "mais fecha" : "equilibrado"}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-6">
          <Card title="Caminhos mais comuns">
            {cam.length === 0 ? (
              <Empty>Todas as compras começaram e terminaram no mesmo canal.</Empty>
            ) : (
              <ol className="m-0 mt-3 list-none p-0">
                {cam.map((c) => (
                  <li key={`${c.abre}-${c.fecha}`} className="flex items-center gap-2.5 border-t border-soft py-2.5 text-sm">
                    <span className="font-semibold">{c.abre}</span>
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5E5B55" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                    <span className="flex-auto font-semibold">{c.fecha}</span>
                    <span className="font-bold">{num(c.n)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Visitas até a compra">
            <div className="mt-3.5 flex flex-col gap-2.5">
              {faixas.map((f) => (
                <div key={f.faixa} className="flex items-center gap-2.5 text-[13px]">
                  <span className="w-[92px] text-body">{f.faixa}</span>
                  <div className="h-3.5 flex-auto overflow-hidden rounded bg-soft">
                    <div className="h-full bg-roxo" style={{ width: `${(f.n / maxF) * 100}%` }} />
                  </div>
                  <span className="w-20 text-right font-semibold">{num(f.n)} · {pct((f.n / totF) * 100, 0)}</span>
                </div>
              ))}
            </div>
          </Card>

          <section aria-label="Próxima fase" className="rounded-[14px] border border-dashed border-[#C9C3B7] px-[22px] py-[18px] text-[13px] text-body">
            <strong className="text-ink">Fase 3:</strong> lembretes do WhatsApp e e-mails enviados entram na jornada, mesmo quando o cliente não clica no link.
          </section>
        </div>
      </div>
    </>
  );
}

function Resumo({ label, valor, sub }: { label: string; valor: string; sub: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-white px-[22px] py-5">
      <div className="text-[13px] font-semibold text-muted">{label}</div>
      <div className="mt-2 text-[32px] font-extrabold tracking-tight">{valor}</div>
      <div className="mt-1.5 text-[13px] text-muted">{sub}</div>
    </div>
  );
}
