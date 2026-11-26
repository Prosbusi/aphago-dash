import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useDataVersion } from "../lib/data";
import { usePeriod } from "../period-context";
import { useStoreParam, nomeLoja } from "../lib/store";
import { useDashData } from "../lib/data";
import { byCanal, byDay, byProduto, kpis } from "../lib/agg";
import { listDays } from "../lib/period";
import { ddmm, dec, delta, diaMes, money, money2, num, pct } from "../lib/format";
import { Card, Empty, ErrorBox, GrupoTag, Kpi, Loading, PageTitle, ShareBar } from "../components/ui";
import { PeriodPicker } from "../components/PeriodPicker";

export function VisaoGeral() {
  const { period } = usePeriod();
  const store = useStoreParam();
  const { data, error, loading } = useDashData(period, store);
  const mk = useMarketing(store, period.start, period.end);
  const mkAnt = useMarketing(store, period.prevStart, period.prevEnd);
  const est = useEstornos(store, period.start, period.end);
  const estAnt = useEstornos(store, period.prevStart, period.prevEnd);

  return (
    <>
      <PageTitle
        title={`Visão geral · ${nomeLoja(store)}`}
        sub={`${diaMes(period.start)} a ${diaMes(period.end)} · comparado ao período anterior de mesmo tamanho`}
        right={<PeriodPicker />}
      />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && <Conteudo data={data} start={period.start} end={period.end} store={store} mk={mk} mkAnt={mkAnt} est={est} estAnt={estAnt} />}
    </>
  );
}

export type MkDia = { dia: string; meta: number; imposto_meta: number; google: number; outras_plataformas: number; email: number; push: number; outros: number; total: number };

/** Marketing por dia da loja: anúncios + e-mail + push + outros custos cadastrados. */
export function useMarketing(store: string, inicio: string, fim: string) {
  const v = useDataVersion();
  const [dias, setDias] = useState<MkDia[] | null>(null);
  useEffect(() => {
    let vivo = true;
    setDias(null);
    supabase.rpc("marketing_diario", { p_store: store, p_inicio: inicio, p_fim: fim }).then(({ data }) => {
      if (vivo) setDias(((data ?? []) as MkDia[]).map((d) => ({ ...d, meta: +d.meta, imposto_meta: +(d.imposto_meta ?? 0), google: +d.google, outras_plataformas: +d.outras_plataformas, email: +d.email, push: +d.push, outros: +d.outros, total: +d.total })));
    });
    return () => { vivo = false; };
  }, [store, inicio, fim, v]);
  return dias;
}

type Estornos = { total: number; pedidos: number };

/** Estornos (reembolsos) feitos no período, pelo dia do estorno. */
function useEstornos(store: string, inicio: string, fim: string) {
  const v = useDataVersion();
  const [e, setE] = useState<Estornos | null>(null);
  useEffect(() => {
    let vivo = true;
    setE(null);
    supabase.rpc("estornos_periodo", { p_store: store, p_inicio: inicio, p_fim: fim }).then(({ data }) => {
      if (vivo && data) setE({ total: Number((data as Estornos).total), pedidos: Number((data as Estornos).pedidos) });
    });
    return () => { vivo = false; };
  }, [store, inicio, fim, v]);
  return e;
}

function Conteudo({ data, start, end, store, mk, mkAnt, est, estAnt }: { data: NonNullable<ReturnType<typeof useDashData>["data"]>; start: string; end: string; store: string; mk: MkDia[] | null; mkAnt: MkDia[] | null; est: Estornos | null; estAnt: Estornos | null }) {
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
  const somaMk = (l: MkDia[] | null, k: keyof Omit<MkDia, "dia">) => (l ?? []).reduce((acc, d) => acc + d[k], 0);
  const mkTotal = somaMk(mk, "total");
  const mkTotalAnt = somaMk(mkAnt, "total");
  const retorno = mkTotal > 0 ? k.fat / mkTotal : 0;
  const retornoAnt = mkTotalAnt > 0 ? kp.fat / mkTotalAnt : 0;
  const partes = ([["Meta", "meta"], ["Imposto Meta", "imposto_meta"], ["Google", "google"], ["E-mail", "email"], ["Push", "push"], ["Outros", "outros"], ["Outras plataformas", "outras_plataformas"]] as const)
    .map(([nome, chave]) => ({ nome, valor: somaMk(mk, chave) }))
    .filter((p) => p.valor > 0);
  const fatDia = new Map(dias.map((d) => [d.dia, d.fat]));

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
        <Kpi
          label="Investido em marketing"
          value={mk ? money(mkTotal) : "…"}
          delta={mk && mkAnt ? delta(mkTotal, mkTotalAnt) : null}
          invert
          sub={partes.length ? partes.map((p) => `${p.nome} ${money(p.valor)}`).join(" · ") : undefined}
        />
        <Kpi
          label="Retorno real"
          value={retorno ? `${dec(retorno, 2)}x` : "—"}
          delta={retorno && retornoAnt ? delta(retorno, retornoAnt) : null}
          sub={retorno ? `${money2(retorno)} faturados por R$ 1 em marketing` : undefined}
        />
        <Kpi
          label="Estornos"
          value={est ? money(est.total) : "…"}
          delta={est && estAnt && estAnt.total ? delta(est.total, estAnt.total) : null}
          invert
          sub={est ? (est.pedidos ? `${num(est.pedidos)} ${est.pedidos === 1 ? "pedido reembolsado" : "pedidos reembolsados"} no período${k.fat ? ` · ${pct((est.total / k.fat) * 100, 1)} do faturamento` : ""}` : "nenhum reembolso no período") : undefined}
        />
      </section>

      {mk && mkTotal > 0 && (
        <Card title="Marketing por dia" extra="anúncios + imposto do Meta + e-mail + push + outros custos · retorno = faturamento ÷ marketing">
          <div className="mt-3.5 overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th scope="col" className="py-2 pr-2 text-left font-semibold">Dia</th>
                  <th scope="col" className="p-2 text-right font-semibold">Meta</th>
                  <th scope="col" className="p-2 text-right font-semibold">Imposto Meta</th>
                  <th scope="col" className="p-2 text-right font-semibold">Google</th>
                  <th scope="col" className="p-2 text-right font-semibold">E-mail</th>
                  <th scope="col" className="p-2 text-right font-semibold">Push</th>
                  <th scope="col" className="p-2 text-right font-semibold">Outros</th>
                  <th scope="col" className="p-2 text-right font-semibold">Marketing</th>
                  <th scope="col" className="p-2 text-right font-semibold">Faturamento</th>
                  <th scope="col" className="py-2 pl-2 text-right font-semibold">Retorno</th>
                </tr>
              </thead>
              <tbody>
                {[...mk].reverse().map((d) => {
                  const fat = fatDia.get(d.dia) ?? 0;
                  const r = d.total > 0 ? fat / d.total : 0;
                  return (
                    <tr key={d.dia} className="border-t border-soft">
                      <th scope="row" className="py-[9px] pr-2 text-left font-semibold">{ddmm(d.dia)}</th>
                      <td className="p-2 text-right">{money(d.meta)}</td>
                      <td className="p-2 text-right">{money(d.imposto_meta)}</td>
                      <td className="p-2 text-right">{money(d.google)}</td>
                      <td className="p-2 text-right">{d.email ? money(d.email) : "—"}</td>
                      <td className="p-2 text-right">{d.push ? money(d.push) : "—"}</td>
                      <td className="p-2 text-right">{d.outros + d.outras_plataformas ? money(d.outros + d.outras_plataformas) : "—"}</td>
                      <td className="p-2 text-right font-bold">{money(d.total)}</td>
                      <td className="p-2 text-right">{money(fat)}</td>
                      <td className={`py-2 pl-2 text-right font-bold ${r && r >= retorno ? "text-bom" : ""}`}>{r ? `${dec(r, 2)}x` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mb-0 mt-3 text-xs text-muted">E-mail, push e outros custos fixos entram pelo valor mensal cadastrado em Geral → Ajustes, dividido pelos dias do mês. Em verde, os dias com retorno acima da média do período.</p>
        </Card>
      )}

      {dias.length > 1 && (
        <Card
          title="Faturamento por dia"
          extra={pico.fat > 0 ? `Pico em ${ddmm(pico.dia)}: ${money(pico.fat)} em ${pico.ped} pedidos` : undefined}
        >
          <div className="mt-[18px] overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="flex h-[200px] items-end gap-1.5 border-b border-[#E6DAC4]">
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
