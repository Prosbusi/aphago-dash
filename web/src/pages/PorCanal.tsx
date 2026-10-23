import { useState } from "react";
import { usePeriod } from "../period-context";
import { useDashData } from "../lib/data";
import { byCanal, byGrupo } from "../lib/agg";
import { delta, diaMes, money, money2, num, pct } from "../lib/format";
import { Card, Empty, ErrorBox, GrupoTag, Loading, PageTitle, ShareBar } from "../components/ui";
import { PeriodPicker } from "../components/PeriodPicker";

const GRUPO_NOME: Record<string, string> = {
  pago: "Pago",
  organico: "Orgânico",
  mensagem: "Mensagens",
  direto: "Direto",
  "sem utm": "Sem UTM",
  "não classificado": "Não classificado",
};

export function PorCanal() {
  const { period } = usePeriod();
  const { data, error, loading } = useDashData(period);
  const [toque, setToque] = useState<"ultimo" | "primeiro">("ultimo");

  const canais = data ? byCanal(data.orders, toque) : [];
  const prev = data ? new Map(byCanal(data.prevOrders, toque).map((c) => [c.canal, c])) : new Map();
  const grupos = data ? byGrupo(data.orders) : [];
  const maxShare = Math.max(...canais.map((c) => c.share), 1);

  return (
    <>
      <PageTitle title="Por canal" sub={`${diaMes(period.start)} a ${diaMes(period.end)}`} right={<PeriodPicker />} />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <section aria-label="Grupos de canal" className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
            {grupos.map((g) => (
              <div key={g.grupo} className="rounded-[14px] border border-line bg-white px-5 py-4">
                <div className="text-[13px] font-semibold text-muted">{GRUPO_NOME[g.grupo] ?? g.grupo}</div>
                <div className="mt-1.5 text-2xl font-extrabold">{pct(g.share, 0)}</div>
                <div className="mt-1 text-xs text-muted">{money(g.fat)} · {num(g.ped)} pedidos</div>
              </div>
            ))}
          </section>

          <Card
            title="Todos os canais"
            extra={
              <div role="group" aria-label="Atribuição" className="flex gap-1 rounded-[10px] border border-line p-1">
                {(["ultimo", "primeiro"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={toque === t}
                    onClick={() => setToque(t)}
                    className={`min-h-9 rounded-[7px] px-3 text-[13px] font-semibold ${toque === t ? "bg-ink text-white" : "text-body hover:bg-soft"}`}
                  >
                    {t === "ultimo" ? "Último clique" : "Primeiro clique"}
                  </button>
                ))}
              </div>
            }
          >
            <p className="mt-2 text-[13px] text-muted">
              {toque === "ultimo" ? "Crédito para o canal que trouxe a visita da compra." : "Crédito para o canal que trouxe a primeira visita da jornada."}
            </p>
            {canais.length === 0 ? (
              <Empty>Nenhum pedido no período.</Empty>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th scope="col" className="py-2 pr-2 font-semibold">Canal</th>
                      <th scope="col" className="w-[26%] p-2 font-semibold">Participação</th>
                      <th scope="col" className="p-2 text-right font-semibold">Pedidos</th>
                      <th scope="col" className="p-2 text-right font-semibold">Faturamento</th>
                      <th scope="col" className="p-2 text-right font-semibold">vs. anterior</th>
                      <th scope="col" className="p-2 text-right font-semibold">Ticket</th>
                      <th scope="col" className="py-2 pl-2 text-right font-semibold">Novos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {canais.map((c) => {
                      const d = delta(c.fat, prev.get(c.canal)?.fat ?? 0);
                      return (
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
                          <td className={`p-2 text-right text-[13px] font-semibold ${d == null ? "text-muted" : d >= 0 ? "text-bom" : "text-ruim"}`}>
                            {d == null ? "novo" : `${d >= 0 ? "▲" : "▼"} ${pct(Math.abs(d), 0)}`}
                          </td>
                          <td className="p-2 text-right">{money2(c.ticket)}</td>
                          <td className="py-2 pl-2 text-right text-body">{num(c.novos)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
