import { useEffect, useMemo, useState } from "react";
import { usePeriod } from "../period-context";
import { useStoreParam, nomeLoja } from "../lib/store";
import { useDataVersion } from "../lib/data";
import { supabase } from "../lib/supabase";
import { ddmm, diaMes, money, money2, num, pct, dec } from "../lib/format";
import { Card, Empty, ErrorBox, Kpi, Loading, PageTitle } from "../components/ui";
import { PeriodPicker } from "../components/PeriodPicker";

type Canal = {
  canal: string; platform: string; gasto: number; impressoes: number; cliques: number;
  compras_plataforma: number; receita_plataforma: number; pedidos_shopify: number; vendas_shopify: number;
};
type Campanha = Canal & { campaign_id: string; campanha: string; acao: string | null };
type Posicionamento = { placement: string; gasto: number; impressoes: number; cliques: number; compras_plataforma: number; receita_plataforma: number };
type Anuncio = { ad_id: string; anuncio: string; campanha: string; gasto: number; cliques: number; compras_plataforma: number; receita_plataforma: number };
type Dia = { dia: string; meta: number; google: number; outros: number; faturamento: number };
type Dados = {
  loja: { faturamento: number; pedidos: number };
  investimento: number;
  canais: Canal[]; campanhas: Campanha[]; posicionamentos: Posicionamento[]; anuncios: Anuncio[]; dias: Dia[];
};

const COR: Record<string, string> = { meta: "rgb(var(--accent))", google: "#E39A6F", outros: "#8C877D" };
const roas = (v: number, g: number) => (g > 0 ? v / g : 0);
const fmtRoas = (r: number) => (r > 0 ? dec(r, 2) : "—");

const POS: Record<string, string> = {
  feed: "Feed", instagram_stories: "Stories", instagram_reels: "Reels", facebook_reels: "Reels",
  facebook_stories: "Stories", instagram_explore: "Explorar", instagram_explore_grid_home: "Explorar (grade)",
  marketplace: "Marketplace", search: "Busca", right_hand_column: "Coluna direita", video_feeds: "Vídeos",
  instream_video: "Vídeo in-stream", messenger_inbox: "Caixa de entrada", an_classic: "Rede de público",
  instagram_profile_feed: "Perfil", status: "Status", threads_feed: "Feed",
};
const PLAT: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", messenger: "Messenger", audience_network: "Audience Network", whatsapp: "WhatsApp", threads: "Threads" };
const nomePos = (p: string) => {
  const [plat, pos] = p.split("/");
  return `${PLAT[plat] ?? plat} · ${POS[pos] ?? pos.replace(/_/g, " ")}`;
};

function useRetorno(store: string, inicio: string, fim: string) {
  const v = useDataVersion();
  const [state, setState] = useState<{ data?: Dados; error?: string }>({});
  useEffect(() => {
    let vivo = true;
    setState({});
    supabase.rpc("retorno", { p_store: store, p_inicio: inicio, p_fim: fim }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) setState({ error: error.message });
      else setState({ data: data as Dados });
    });
    return () => { vivo = false; };
  }, [store, inicio, fim, v]);
  return state;
}

export function Retorno() {
  const { period } = usePeriod();
  const store = useStoreParam();
  const { data, error } = useRetorno(store, period.start, period.end);

  return (
    <>
      <PageTitle title={`Retorno · ${nomeLoja(store)}`} sub={`${diaMes(period.start)} a ${diaMes(period.end)} · investimento em anúncios x vendas`} right={<PeriodPicker />} />
      {error && <ErrorBox message={error} />}
      {!data && !error && <Loading />}
      {data && (data.investimento === 0 ? <Empty>Nenhum investimento em anúncios registrado neste período.</Empty> : <Conteudo d={data} />)}
    </>
  );
}

function Conteudo({ d }: { d: Dados }) {
  const roasLoja = roas(d.loja.faturamento, d.investimento);
  const [canalFiltro, setCanalFiltro] = useState<string>("todos");
  const campanhas = useMemo(() => d.campanhas.filter((c) => canalFiltro === "todos" || c.platform === canalFiltro), [d.campanhas, canalFiltro]);
  const plataformas = [...new Set(d.campanhas.map((c) => c.platform))];
  const maxDia = Math.max(...d.dias.map((x) => x.meta + x.google + x.outros), 1);
  const step = Math.max(1, Math.ceil(d.dias.length / 6));
  const gastoMeta = d.posicionamentos.reduce((s, p) => s + p.gasto, 0) || 1;

  return (
    <>
      <section aria-label="Indicadores" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Kpi label="Investimento em anúncios" value={money(d.investimento)} sub={d.loja.faturamento ? `${pct((d.investimento / d.loja.faturamento) * 100, 0)} do faturamento` : undefined} />
        <Kpi label="Faturamento da loja" value={money(d.loja.faturamento)} sub={`${num(d.loja.pedidos)} pedidos`} />
        <Kpi label="ROAS da loja" value={fmtRoas(roasLoja)} sub={roasLoja ? `${money2(roasLoja)} vendidos por R$ 1 investido` : undefined} />
        <Kpi label="Custo por pedido" value={d.loja.pedidos ? money2(d.investimento / d.loja.pedidos) : "—"} sub="investimento ÷ todos os pedidos" />
      </section>

      <Card title="Por canal de anúncio">
        <div className="mt-3.5 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-2 font-semibold">Canal</th>
                <th scope="col" className="p-2 text-right font-semibold">Investimento</th>
                <th scope="col" className="p-2 text-right font-semibold">Vendas no Shopify<br /><span className="font-normal">último clique</span></th>
                <th scope="col" className="p-2 text-right font-semibold">ROAS Shopify</th>
                <th scope="col" className="p-2 text-right font-semibold">Custo por pedido</th>
                <th scope="col" className="p-2 text-right font-semibold">Vendas que a<br />plataforma informa</th>
                <th scope="col" className="py-2 pl-2 text-right font-semibold">ROAS plataforma</th>
              </tr>
            </thead>
            <tbody>
              {d.canais.map((c) => (
                <tr key={c.canal} className="border-t border-soft">
                  <td className="py-[11px] pr-2 font-semibold"><span aria-hidden="true" className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COR[c.platform] ?? COR.outros }} />{c.canal}</td>
                  <td className="p-2 text-right font-semibold">{money(c.gasto)}</td>
                  <td className="p-2 text-right">{money(c.vendas_shopify)} <span className="text-xs text-muted">· {num(c.pedidos_shopify)} ped.</span></td>
                  <td className="p-2 text-right font-bold">{fmtRoas(roas(c.vendas_shopify, c.gasto))}</td>
                  <td className="p-2 text-right">{c.pedidos_shopify ? money2(c.gasto / c.pedidos_shopify) : "—"}</td>
                  <td className="p-2 text-right text-body">{money(c.receita_plataforma)} <span className="text-xs text-muted">· {dec(c.compras_plataforma, 0)} compras</span></td>
                  <td className="py-2 pl-2 text-right text-body">{fmtRoas(roas(c.receita_plataforma, c.gasto))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="mt-4 rounded-xl bg-ground px-4 py-3 text-[13px] text-body">
          <summary className="cursor-pointer font-semibold text-ink">Por que o Shopify e as plataformas mostram vendas diferentes?</summary>
          <ul className="mb-1 mt-2 list-disc space-y-1.5 pl-5">
            <li><strong>Shopify (último clique):</strong> cada pedido conta uma vez só, para o canal da visita em que a compra aconteceu. Nunca passa do faturamento real.</li>
            <li><strong>Plataforma:</strong> o Meta e o Google contam a venda sempre que a pessoa clicou ou viu o anúncio dias antes. Se ela também passou por outro canal, as duas plataformas contam a mesma venda.</li>
            <li><strong>Para decidir verba,</strong> o ROAS da loja é o número mais seguro. O ROAS Shopify mostra o mínimo que cada canal trouxe; o da plataforma, o máximo provável. A verdade fica entre os dois.</li>
          </ul>
        </details>
      </Card>

      {d.dias.length > 1 && (
        <Card
          title="Investimento por dia"
          extra={
            <span className="flex flex-wrap gap-4">
              {d.canais.map((c) => (
                <span key={c.platform} className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[3px]" style={{ background: COR[c.platform] ?? COR.outros }} />{c.canal}</span>
              ))}
            </span>
          }
        >
          <div className="mt-[18px] overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="flex h-[180px] items-end gap-1.5 border-b border-[#D6D1C7]">
                {d.dias.map((x) => {
                  const tot = x.meta + x.google + x.outros;
                  return (
                    <div
                      key={x.dia}
                      className="flex flex-1 flex-col-reverse overflow-hidden rounded-t"
                      style={{ height: `${Math.round((tot / maxDia) * 170)}px` }}
                      title={`${ddmm(x.dia)}: investimento ${money(tot)} · faturamento ${money(x.faturamento)} · ROAS ${fmtRoas(roas(x.faturamento, tot))}`}
                    >
                      {(["meta", "google", "outros"] as const).map((k) => (
                        <div key={k} style={{ background: COR[k], height: tot ? `${(x[k] / tot) * 100}%` : 0 }} />
                      ))}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-1.5">
                {d.dias.map((x, i) => (
                  <div key={x.dia} className="flex-1 whitespace-nowrap text-center text-[11px] text-muted">{i % step === 0 || i === d.dias.length - 1 ? ddmm(x.dia) : ""}</div>
                ))}
              </div>
              <div className="mt-1 flex gap-1.5" aria-label="ROAS da loja por dia">
                {d.dias.map((x) => {
                  const r = roas(x.faturamento, x.meta + x.google + x.outros);
                  return <div key={x.dia} className={`flex-1 text-center text-[10.5px] font-semibold ${r >= roasLoja ? "text-bom" : "text-muted"}`}>{r ? dec(r, 1) : ""}</div>;
                })}
              </div>
              <p className="mb-0 mt-1 text-xs text-muted">Linha de baixo: ROAS da loja no dia (faturamento ÷ investimento). Em verde, os dias acima da média do período.</p>
            </div>
          </div>
        </Card>
      )}

      <Card
        title={`Campanhas (${campanhas.length})`}
        extra={
          <div role="group" aria-label="Filtrar canal" className="flex gap-1 rounded-[10px] border border-line p-1">
            {["todos", ...plataformas].map((p) => (
              <button key={p} type="button" aria-pressed={canalFiltro === p} onClick={() => setCanalFiltro(p)}
                className={`min-h-9 rounded-[7px] px-3 text-[13px] font-semibold ${canalFiltro === p ? "bg-ink text-white" : "text-body hover:bg-soft"}`}>
                {p === "todos" ? "Todos" : p === "meta" ? "Meta" : p === "google" ? "Google" : p}
              </button>
            ))}
          </div>
        }
      >
        <div className="mt-3.5 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-2 font-semibold">Campanha</th>
                <th scope="col" className="p-2 text-right font-semibold">Investimento</th>
                <th scope="col" className="p-2 text-right font-semibold">Vendas Shopify</th>
                <th scope="col" className="p-2 text-right font-semibold">ROAS Shopify</th>
                <th scope="col" className="p-2 text-right font-semibold">Vendas plataforma</th>
                <th scope="col" className="py-2 pl-2 text-right font-semibold">ROAS plataforma</th>
              </tr>
            </thead>
            <tbody>
              {campanhas.map((c) => (
                <tr key={`${c.platform}-${c.campaign_id}`} className="border-t border-soft align-top">
                  <td className="py-[11px] pr-2">
                    <div className="font-semibold"><span aria-hidden="true" className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COR[c.platform] ?? COR.outros }} />{c.campanha}</div>
                    {c.acao && c.acao !== (c.campanha ?? "").toLowerCase() && <div className="mt-0.5 text-xs text-muted">ação <code>{c.acao}</code></div>}
                  </td>
                  <td className="p-2 text-right font-semibold">{money(c.gasto)}</td>
                  <td className="p-2 text-right">{money(c.vendas_shopify)} <span className="text-xs text-muted">· {num(c.pedidos_shopify)}</span></td>
                  <td className="p-2 text-right font-bold">{fmtRoas(roas(c.vendas_shopify, c.gasto))}</td>
                  <td className="p-2 text-right text-body">{money(c.receita_plataforma)}</td>
                  <td className="py-2 pl-2 text-right text-body">{fmtRoas(roas(c.receita_plataforma, c.gasto))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mb-0 mt-3 text-xs text-muted">Vendas Shopify por campanha dependem da UTM do anúncio. Campanhas do Google só passam a ter vendas ligadas a partir de outubro, quando o sufixo de UTM entrou.</p>
      </Card>

      {d.posicionamentos.length > 0 && (
        <div className="flex flex-wrap items-start gap-6">
          <Card className="flex-[1_1_440px]" title="Posicionamentos do Meta" extra="dados do Meta">
            <div className="mt-3.5 overflow-x-auto">
              <table className="w-full min-w-[460px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="py-2 pr-2 font-semibold">Posicionamento</th>
                    <th scope="col" className="p-2 text-right font-semibold">Investimento</th>
                    <th scope="col" className="p-2 text-right font-semibold">CTR</th>
                    <th scope="col" className="py-2 pl-2 text-right font-semibold">ROAS plataforma</th>
                  </tr>
                </thead>
                <tbody>
                  {d.posicionamentos.slice(0, 10).map((p) => (
                    <tr key={p.placement} className="border-t border-soft">
                      <td className="py-[11px] pr-2 font-semibold">{nomePos(p.placement)}</td>
                      <td className="p-2 text-right">{money(p.gasto)} <span className="text-xs text-muted">· {pct((p.gasto / gastoMeta) * 100, 0)}</span></td>
                      <td className="p-2 text-right">{p.impressoes ? pct((p.cliques / p.impressoes) * 100, 2) : "—"}</td>
                      <td className="py-2 pl-2 text-right font-bold">{fmtRoas(roas(p.receita_plataforma, p.gasto))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="flex-[1_1_440px]" title="Anúncios do Meta com mais investimento" extra="dados do Meta">
            <ol className="m-0 mt-3.5 list-none p-0">
              {d.anuncios.slice(0, 10).map((a) => {
                const r = roas(a.receita_plataforma, a.gasto);
                return (
                  <li key={a.ad_id} className="flex items-center gap-3 border-t border-soft py-[11px]">
                    <div className="min-w-0 flex-auto">
                      <div className="truncate text-sm font-semibold">{a.anuncio}</div>
                      <div className="mt-0.5 truncate text-xs text-muted">{a.campanha} · {dec(a.compras_plataforma, 0)} compras</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold">{money(a.gasto)}</div>
                      <div className={`text-xs font-semibold ${r >= 2 ? "text-bom" : r < 1 ? "text-ruim" : "text-muted"}`}>ROAS {fmtRoas(r)}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      )}
    </>
  );
}
