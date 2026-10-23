import { useState } from "react";
import { usePeriod } from "../period-context";
import { useDashData } from "../lib/data";
import { byProduto } from "../lib/agg";
import { diaMes, money, num } from "../lib/format";
import { Card, Empty, ErrorBox, Loading, PageTitle, ShareBar } from "../components/ui";
import { PeriodPicker } from "../components/PeriodPicker";

export function Produtos() {
  const { period } = usePeriod();
  const { data, error, loading } = useDashData(period);
  const [busca, setBusca] = useState("");
  const todos = data ? byProduto(data.items) : [];
  const q = busca.trim().toLowerCase();
  const lista = q ? todos.filter((p) => p.produto.toLowerCase().includes(q)) : todos;
  const max = Math.max(...todos.map((p) => p.fat), 1);

  return (
    <>
      <PageTitle title="Produtos" sub={`${diaMes(period.start)} a ${diaMes(period.end)}`} right={<PeriodPicker />} />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && (
        <Card
          title={`${num(todos.length)} produtos vendidos`}
          extra={
            <label className="flex items-center gap-2">
              <span className="sr-only">Buscar produto</span>
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar produto"
                className="min-h-10 w-56 rounded-lg border border-line px-3 text-sm text-ink"
              />
            </label>
          }
        >
          {lista.length === 0 ? (
            <Empty>Nenhum produto encontrado.</Empty>
          ) : (
            <div className="mt-3.5 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="w-10 py-2 pr-2 font-semibold">#</th>
                    <th scope="col" className="p-2 font-semibold">Produto</th>
                    <th scope="col" className="w-[22%] p-2 font-semibold">Faturamento</th>
                    <th scope="col" className="p-2 text-right font-semibold">Vendidos</th>
                    <th scope="col" className="p-2 text-right font-semibold">Pedidos</th>
                    <th scope="col" className="py-2 pl-2 font-semibold">Canal principal</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((p) => (
                    <tr key={p.produto} className="border-t border-soft">
                      <td className="py-[11px] pr-2 text-[13px] font-bold text-muted">{todos.indexOf(p) + 1}</td>
                      <td className="p-2 font-semibold">{p.produto}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <ShareBar value={p.fat} max={max} />
                          <span className="w-20 text-right font-semibold">{money(p.fat)}</span>
                        </div>
                      </td>
                      <td className="p-2 text-right">{num(p.qtd)}</td>
                      <td className="p-2 text-right">{num(p.pedidos)}</td>
                      <td className="py-2 pl-2 text-body">{p.canal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
