import { Fragment, useEffect, useMemo, useState } from "react";
import { usePeriod } from "../period-context";
import { useStoreParam, nomeLoja } from "../lib/store";
import { useDataVersion } from "../lib/data";
import { supabase } from "../lib/supabase";
import { dec, ddmm, diaMes, money, money2, pct } from "../lib/format";
import { Card, Empty, ErrorBox, GrupoTag, Loading, PageTitle, ShareBar } from "../components/ui";
import { PeriodPicker } from "../components/PeriodPicker";

// Atribuição por canal e por botão: cada pedido divide 100% do valor entre os canais do caminho.
// O cálculo é feito no banco (tabela atribuicao); a tela só lê a função atribuicao_painel.

type Modelo = "linear" | "em_u" | "primeiro" | "ultimo";
const MODELOS: { id: Modelo; nome: string; ajuda: string }[] = [
  { id: "linear", nome: "Linear", ajuda: "Partes iguais entre os canais do caminho. Visão geral e decisão de verba." },
  { id: "em_u", nome: "Inteligente", ajuda: "Peso por etapa da jornada: quem abre, quem ajuda no meio e quem fecha a venda. Os pesos podem ser ajustados abaixo." },
  { id: "primeiro", nome: "Primeiro clique", ajuda: "100% no primeiro canal do caminho. Mostra quem traz gente nova." },
  { id: "ultimo", nome: "Último clique", ajuda: "100% na visita da compra. Igual ao relatório padrão da Shopify." },
];

type Grupo = { grupo: string; valor: number; pedidos: number };
type Canal = { canal: string; grupo: string; valor: number; pedidos: number; novos: number; gasto: number | null; valor_ultimo: number };
type Campanha = { canal: string; campanha: string; valor: number; pedidos: number; novos: number | null; gasto: number | null; ligada: boolean };
type Botao = { canal: string; botao: string; nome: string; valor: number; pedidos: number; pedidos_com_clique: number };
type Caminho = { caminho: string[]; pedidos: number; valor: number };
type Dados = {
  total: { valor: number; pedidos: number };
  grupos: Grupo[]; canais: Canal[]; campanhas: Campanha[]; botoes: Botao[]; botoes_desde: string | null;
  caminhos: Caminho[]; dias: { dia: string; grupo: string; valor: number }[]; horas: { hora: number; pedidos: number; valor: number }[];
};

const GRUPOS = ["Pago", "Orgânico", "Mensagens", "Direto", "Outros", "Sem dados"];
const COR: Record<string, string> = {
  Pago: "rgb(var(--accent))", Orgânico: "#3F8F6B", Mensagens: "#E39A6F", Direto: "#8C877D", Outros: "#C9A227", "Sem dados": "#C9C4BA",
};
const ped = (n: number) => dec(Number(n) || 0, 1);
const fmtRet = (v: number, g: number | null) => (g && g > 0 ? `${dec(v / g, 2)}x` : "—");
const nomeBotao = (b: Botao) => {
  if (b.nome) return b.nome;
  if (b.botao.startsWith("produto-")) {
    const p = b.botao.slice(8).replace(/-/g, " ");
    return `Produto: ${p.charAt(0).toUpperCase()}${p.slice(1)}`;
  }
  return b.botao;
};

function useAtribuicao(store: string, inicio: string, fim: string, modelo: Modelo, horaDe: number, horaAte: number) {
  const v = useDataVersion();
  const [state, setState] = useState<{ data?: Dados; error?: string }>({});
  useEffect(() => {
    let vivo = true;
    setState((s) => ({ data: s.data }));
    supabase
      .rpc("atribuicao_painel", { p_store: store, p_inicio: inicio, p_fim: fim, p_modelo: modelo, p_hora_de: horaDe, p_hora_ate: horaAte })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) setState({ error: error.message });
        else setState({ data: data as Dados });
      });
    return () => { vivo = false; };
  }, [store, inicio, fim, modelo, horaDe, horaAte, v]);
  return state;
}

export function PorCanal() {
  const { period } = usePeriod();
  const store = useStoreParam();
  const [modelo, setModelo] = useState<Modelo>("linear");
  const [horaDe, setHoraDe] = useState(0);
  const [horaAte, setHoraAte] = useState(23);
  const [aba, setAba] = useState<"canais" | "botoes">("canais");
  const { data, error } = useAtribuicao(store, period.start, period.end, modelo, horaDe, horaAte);
  const m = MODELOS.find((x) => x.id === modelo)!;
  const filtroHora = horaDe !== 0 || horaAte !== 23;

  return (
    <>
      <PageTitle title={`Por canal · ${nomeLoja(store)}`} sub={`${diaMes(period.start)} a ${diaMes(period.end)}`} right={<PeriodPicker />} />

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Modelo de atribuição" className="flex flex-wrap gap-1 rounded-[10px] border border-line bg-white p-1">
          {MODELOS.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={modelo === x.id}
              onClick={() => setModelo(x.id)}
              className={`min-h-9 rounded-[7px] px-3 text-[13px] font-semibold ${modelo === x.id ? "bg-ink text-white" : "text-body hover:bg-soft"}`}
            >
              {x.nome}{x.id === "linear" ? " (padrão)" : ""}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          Horário
          <select value={horaDe} onChange={(e) => setHoraDe(Math.min(Number(e.target.value), horaAte))} className="min-h-9 rounded-[8px] border border-line bg-white px-2 text-ink">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}h</option>)}
          </select>
          a
          <select value={horaAte} onChange={(e) => setHoraAte(Math.max(Number(e.target.value), horaDe))} className="min-h-9 rounded-[8px] border border-line bg-white px-2 text-ink">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}h59</option>)}
          </select>
          {filtroHora && (
            <button type="button" onClick={() => { setHoraDe(0); setHoraAte(23); }} className="font-semibold text-roxo underline">limpar</button>
          )}
        </label>
      </div>
      <p className="-mt-2 text-[13px] text-muted">{m.ajuda}</p>
      {modelo === "em_u" && <Pesos />}

      {error && <ErrorBox message={error} />}
      {!data && !error && <Loading />}
      {data && (data.total.pedidos === 0 ? <Empty>Nenhum pedido no período{filtroHora ? " e horário" : ""}.</Empty> : (
        <Conteudo d={data} modelo={m} aba={aba} setAba={setAba} />
      ))}

      <p className="text-xs leading-relaxed text-muted">
        A Shopify só enxerga visitas no mesmo navegador: quem viu no celular e comprou no computador, ou só viu o anúncio sem clicar, não entra no caminho.
        Por isso o painel do Meta sempre mostra mais vendas que o Pharol; os dois estão certos, medem coisas diferentes.
        Pedidos cancelados ficam fora. Pedidos sem jornada (app, pedido manual, POS) aparecem como "Sem dados".
      </p>
    </>
  );
}

type PesosCfg = { peso_primeiro: number; peso_meio: number; peso_ultimo: number; updated_at: string };

// Pesos do modelo Inteligente: primeiro canal / canais do meio / último canal (somam 100).
function Pesos() {
  const [cfg, setCfg] = useState<PesosCfg | null>(null);
  const [edit, setEdit] = useState<{ p: string; m: string; u: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc("atribuicao_pesos").then(({ data }) => data && setCfg(data as PesosCfg));
  }, []);
  if (!cfg) return null;
  const n = (x: string) => Number(x.replace(",", "."));
  const soma = edit ? n(edit.p) + n(edit.m) + n(edit.u) : 100;
  const salvar = async () => {
    if (!edit || Math.abs(soma - 100) > 0.001) return;
    const novo = { peso_primeiro: n(edit.p), peso_meio: n(edit.m), peso_ultimo: n(edit.u) };
    const { error } = await supabase.from("atribuicao_config").update({ ...novo, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) { setMsg(`Não foi possível salvar: ${error.message}`); return; }
    setCfg({ ...cfg, ...novo });
    setEdit(null);
    setMsg("Pesos salvos. Os números são recalculados em até 10 minutos.");
  };
  const campo = (k: "p" | "m" | "u", rotulo: string) => (
    <label className="flex items-center gap-1.5">
      {rotulo}
      <input
        inputMode="decimal"
        value={edit![k]}
        onChange={(e) => setEdit({ ...edit!, [k]: e.target.value })}
        className="min-h-9 w-16 rounded-[8px] border border-line bg-white px-2 text-right text-ink"
      />%
    </label>
  );
  return (
    <div className="-mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-line bg-white px-4 py-3 text-[13px] text-body">
      {edit ? (
        <>
          {campo("p", "Primeiro canal")}
          {campo("m", "Canais do meio")}
          {campo("u", "Último canal")}
          <span className={Math.abs(soma - 100) > 0.001 ? "font-semibold text-ruim" : "text-muted"}>Soma: {dec(soma, 0)}%</span>
          <button type="button" onClick={salvar} disabled={Math.abs(soma - 100) > 0.001} className="min-h-9 rounded-[8px] bg-ink px-3 font-semibold text-white disabled:opacity-40">Salvar</button>
          <button type="button" onClick={() => setEdit(null)} className="font-semibold text-muted underline">cancelar</button>
        </>
      ) : (
        <>
          <span>
            Pesos: <b>{dec(cfg.peso_primeiro, 0)}%</b> primeiro canal · <b>{dec(cfg.peso_meio, 0)}%</b> canais do meio · <b>{dec(cfg.peso_ultimo, 0)}%</b> último canal.
            <span className="text-muted"> Com 2 canais, o peso do meio é dividido na mesma proporção entre os dois; com 1 canal, 100% para ele.</span>
          </span>
          <button
            type="button"
            onClick={() => { setMsg(null); setEdit({ p: String(cfg.peso_primeiro), m: String(cfg.peso_meio), u: String(cfg.peso_ultimo) }); }}
            className="font-semibold text-roxo underline"
          >
            ajustar pesos
          </button>
        </>
      )}
      {msg && <span className="w-full text-muted">{msg}</span>}
    </div>
  );
}

function Conteudo({ d, modelo, aba, setAba }: { d: Dados; modelo: (typeof MODELOS)[number]; aba: "canais" | "botoes"; setAba: (a: "canais" | "botoes") => void }) {
  const total = Number(d.total.valor) || 1;
  const grupos = GRUPOS.map((g) => d.grupos.find((x) => x.grupo === g) ?? { grupo: g, valor: 0, pedidos: 0 }).filter((g) => g.grupo !== "Sem dados" || g.pedidos > 0);

  return (
    <>
      <section aria-label="Grupos de canal" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4">
        {grupos.map((g) => (
          <div key={g.grupo} className="rounded-[14px] border border-line bg-white px-5 py-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: COR[g.grupo] }} />{g.grupo}
            </div>
            <div className="mt-1.5 text-2xl font-extrabold">{pct((Number(g.valor) / total) * 100, 0)}</div>
            <div className="mt-1 text-xs text-muted">{money(Number(g.valor))} · {ped(g.pedidos)} pedidos</div>
          </div>
        ))}
      </section>

      <div role="tablist" aria-label="Visão" className="flex gap-1 border-b border-line">
        {([["canais", "Canais"], ["botoes", "Botões"]] as const).map(([id, nome]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={aba === id}
            onClick={() => setAba(id)}
            className={`-mb-px min-h-10 border-b-2 px-4 text-sm font-semibold ${aba === id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {nome}
          </button>
        ))}
      </div>

      {aba === "canais" ? (
        <>
          <TabelaCanais d={d} modelo={modelo} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Caminhos d={d} />
            <Horas d={d} />
          </div>
          <LinhaDoTempo d={d} />
        </>
      ) : (
        <Botoes d={d} />
      )}
    </>
  );
}

function TabelaCanais({ d, modelo }: { d: Dados; modelo: (typeof MODELOS)[number] }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const total = Number(d.total.valor) || 1;
  const canais = d.canais.filter((c) => Number(c.valor) > 0 || Number(c.valor_ultimo) > 0);
  const maxShare = Math.max(...canais.map((c) => (Number(c.valor) / total) * 100), 1);
  const ehUltimo = modelo.id === "ultimo";
  const th = "p-2 text-right font-semibold";

  return (
    <Card title={`Todos os canais · ${modelo.nome}`} extra="Clique no canal para ver as campanhas">
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-2 font-semibold">Canal</th>
              <th scope="col" className="w-[18%] p-2 font-semibold">Participação</th>
              <th scope="col" className={th}>Pedidos</th>
              <th scope="col" className={th}>Faturamento</th>
              <th scope="col" className={th}>Gasto</th>
              <th scope="col" className={th}>Retorno</th>
              <th scope="col" className={th}>Ticket</th>
              <th scope="col" className={th}>Novos</th>
              {!ehUltimo && <th scope="col" className={`${th} pl-2 pr-0`}>vs. último clique</th>}
            </tr>
          </thead>
          <tbody>
            {canais.map((c) => {
              const valor = Number(c.valor);
              const share = (valor / total) * 100;
              const dif = valor - Number(c.valor_ultimo);
              const camps = d.campanhas.filter((x) => x.canal === c.canal && (Number(x.valor) > 0 || Number(x.gasto) > 0));
              const open = aberto === c.canal;
              return (
                <Fragment key={c.canal}>
                  <tr className="border-t border-soft">
                    <td className="py-[11px] pr-2 font-semibold">
                      <button type="button" aria-expanded={open} onClick={() => setAberto(open ? null : c.canal)} className="text-left hover:underline">
                        <span aria-hidden="true" className="mr-1 inline-block w-3 text-muted">{camps.length ? (open ? "▾" : "▸") : ""}</span>
                        {c.canal}
                      </button>
                      <GrupoTag grupo={c.grupo} />
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <ShareBar value={share} max={maxShare} />
                        <span className="w-11 text-right text-xs text-body">{pct(share)}</span>
                      </div>
                    </td>
                    <td className="p-2 text-right">{ped(c.pedidos)}</td>
                    <td className="p-2 text-right font-semibold">{money(valor)}</td>
                    <td className="p-2 text-right text-body">{c.gasto ? money(Number(c.gasto)) : "—"}</td>
                    <td className="p-2 text-right font-semibold">{fmtRet(valor, c.gasto)}</td>
                    <td className="p-2 text-right">{Number(c.pedidos) ? money2(valor / Number(c.pedidos)) : "—"}</td>
                    <td className="p-2 text-right text-body">{ped(c.novos)}</td>
                    {!ehUltimo && (
                      <td className={`py-2 pl-2 text-right text-[13px] font-semibold ${Math.abs(dif) < 1 ? "text-muted" : dif > 0 ? "text-bom" : "text-ruim"}`}>
                        {Math.abs(dif) < 1 ? "=" : `${dif > 0 ? "+" : "−"}${money(Math.abs(dif))}`}
                      </td>
                    )}
                  </tr>
                  {open && camps.map((x) => {
                    const v = Number(x.valor);
                    return (
                      <tr key={`${c.canal}|${x.campanha}`} className="bg-soft/50 text-[13px]">
                        <td className="py-2 pl-6 pr-2 text-body" colSpan={2}>
                          {x.campanha || "(sem campanha)"}
                          {!x.ligada && c.gasto ? <span className="ml-2 text-[11px] text-muted">sem gasto ligado</span> : null}
                        </td>
                        <td className="p-2 text-right">{ped(x.pedidos)}</td>
                        <td className="p-2 text-right font-semibold">{money(v)}</td>
                        <td className="p-2 text-right text-body">{x.gasto ? money(Number(x.gasto)) : "—"}</td>
                        <td className="p-2 text-right font-semibold">{fmtRet(v, x.gasto)}</td>
                        <td className="p-2 text-right">{Number(x.pedidos) ? money2(v / Number(x.pedidos)) : "—"}</td>
                        <td className="p-2 text-right text-body">{ped(Number(x.novos) || 0)}</td>
                        {!ehUltimo && <td />}
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Pedidos com uma casa decimal: um pedido pode ser dividido entre canais. Retorno = faturamento atribuído ÷ gasto da plataforma no período.
      </p>
    </Card>
  );
}

function Caminhos({ d }: { d: Dados }) {
  return (
    <Card title="Caminhos mais comuns">
      {d.caminhos.length === 0 ? <Empty>Sem caminhos no período.</Empty> : (
        <ol className="mt-3 space-y-2">
          {d.caminhos.map((c, i) => (
            <li key={c.caminho.join(">")} className="flex items-start justify-between gap-3 border-t border-soft pt-2 text-sm">
              <span className="min-w-0">
                <span className="mr-2 text-xs text-muted">{i + 1}.</span>
                {c.caminho.join(" → ")}
              </span>
              <span className="shrink-0 text-right text-[13px]"><b>{c.pedidos}</b> <span className="text-muted">ped. · {money(Number(c.valor))}</span></span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Horas({ d }: { d: Dados }) {
  const horas = Array.from({ length: 24 }, (_, h) => d.horas.find((x) => x.hora === h) ?? { hora: h, pedidos: 0, valor: 0 });
  const max = Math.max(...horas.map((h) => h.pedidos), 1);
  const tot = horas.reduce((s, h) => s + h.pedidos, 0) || 1;
  return (
    <Card title="Pedidos por hora" extra="Todo o período, sem filtro de horário">
      <div className="mt-4 flex h-[150px] items-end gap-[3px]" role="img" aria-label="Pedidos por hora do dia">
        {horas.map((h) => (
          <div key={h.hora} className="flex flex-1 flex-col items-center justify-end" title={`${h.hora}h: ${h.pedidos} pedidos (${pct((h.pedidos / tot) * 100, 0)}) · ${money(Number(h.valor))}`}>
            <div className="w-full rounded-t-[3px] bg-roxo" style={{ height: `${(h.pedidos / max) * 130}px`, minHeight: h.pedidos ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
    </Card>
  );
}

function LinhaDoTempo({ d }: { d: Dados }) {
  const dias = useMemo(() => [...new Set(d.dias.map((x) => x.dia))].sort(), [d.dias]);
  const grupos = GRUPOS.filter((g) => d.dias.some((x) => x.grupo === g));
  if (dias.length < 2) return null;
  const val = (dia: string, g: string) => Number(d.dias.find((x) => x.dia === dia && x.grupo === g)?.valor ?? 0);
  const max = Math.max(...dias.flatMap((dia) => grupos.map((g) => val(dia, g))), 1);
  const W = 900, H = 200, P = 8;
  const x = (i: number) => P + (i / (dias.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const step = Math.max(1, Math.ceil(dias.length / 8));
  return (
    <Card title="Faturamento atribuído por dia" extra={`Máximo do período: ${money(max)}`}>
      <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
        {grupos.map((g) => (
          <span key={g} className="flex items-center gap-1.5"><span aria-hidden="true" className="h-[3px] w-4 rounded" style={{ background: COR[g] }} />{g}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-[200px] w-full" preserveAspectRatio="none" role="img" aria-label="Faturamento atribuído por dia e grupo">
        {grupos.map((g) => (
          <polyline key={g} fill="none" stroke={COR[g]} strokeWidth={2} vectorEffect="non-scaling-stroke"
            points={dias.map((dia, i) => `${x(i)},${y(val(dia, g))}`).join(" ")}>
            <title>{g}</title>
          </polyline>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        {dias.filter((_, i) => i % step === 0 || i === dias.length - 1).map((dia) => <span key={dia}>{ddmm(dia)}</span>)}
      </div>
    </Card>
  );
}

function Botoes({ d }: { d: Dados }) {
  const bio = d.botoes.filter((b) => b.canal === "Instagram orgânico");
  const live = d.botoes.filter((b) => b.canal === "Live");
  const desde = d.botoes_desde;
  return (
    <>
      <p className="text-[13px] text-muted">
        {desde
          ? <>Medição dos botões desde <b className="text-ink">{diaMes(desde)}</b> (data do primeiro pedido com "Origem bio"). Antes disso, a fatia do Instagram orgânico aparece como "Bio (sem botão)".</>
          : <>Ainda não chegou nenhum pedido com "Origem bio". Os botões aparecem aqui depois que os blocos da página de links estiverem no tema; até lá, sem dado.</>}
      </p>
      <TabelaBotoes titulo="Botões da bio (fatia do Instagram orgânico)" linhas={bio} vazio="Nenhum pedido com Instagram orgânico no período." />
      {live.length > 0 && <TabelaBotoes titulo="Live" linhas={live} vazio="" />}
    </>
  );
}

function TabelaBotoes({ titulo, linhas, vazio }: { titulo: string; linhas: Botao[]; vazio: string }) {
  const th = "p-2 text-right font-semibold";
  return (
    <Card title={titulo}>
      {linhas.length === 0 ? <Empty>{vazio}</Empty> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-2 font-semibold">Botão</th>
                <th scope="col" className={th}>Cliques que viraram pedido</th>
                <th scope="col" className={th}>Pedidos atribuídos</th>
                <th scope="col" className={th}>Faturamento</th>
                <th scope="col" className={`${th} pr-0`}>Ticket</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((b) => (
                <tr key={b.botao} className="border-t border-soft">
                  <td className={`py-[11px] pr-2 font-semibold ${b.botao === "Bio (sem botão)" ? "text-muted" : ""}`}>{nomeBotao(b)}</td>
                  <td className="p-2 text-right">{b.botao === "Bio (sem botão)" ? "—" : b.pedidos_com_clique}</td>
                  <td className="p-2 text-right">{ped(b.pedidos)}</td>
                  <td className="p-2 text-right font-semibold">{money(Number(b.valor))}</td>
                  <td className="py-2 pl-2 text-right">{Number(b.pedidos) ? money2(Number(b.valor) / Number(b.pedidos)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
