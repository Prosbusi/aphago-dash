import { useEffect, useMemo, useState, type FormEvent } from "react";
import { usePeriod } from "../period-context";
import { useStoreParam, nomeLoja } from "../lib/store";
import { useDataVersion } from "../lib/data";
import { supabase } from "../lib/supabase";
import { ddmm, diaMes, money, money2, num, pct } from "../lib/format";
import { todaySP } from "../lib/period";
import { Card, Empty, ErrorBox, Kpi, Loading, PageTitle, ShareBar } from "../components/ui";
import { PeriodPicker } from "../components/PeriodPicker";

type Tipo = "vip" | "app" | "creator" | "promocao" | "pos_venda" | "interno";
type Cupom = {
  codigo: string; tipo: Tipo; sugerido: boolean; mediana: number | null; primeiro: string | null; ultimo: string | null; pedidos_total: number;
  nome: string | null; instagram: string | null; tiktok: string | null; email: string | null; pix: string | null;
  comissao_pct: number; ativo: boolean; obs: string | null;
  pedidos: number; vendas: number; desconto: number; estornos: number; novos: number; canal: string | null;
};
type Resumo = {
  pedidos: number; vendas: number; pedidos_cupom: number; vendas_cupom: number; desconto_cupom: number; novos_cupom: number;
  pedidos_creator: number; vendas_creator: number; ticket_sem_cupom: number;
};
type Dia = { dia: string; sem: number; tipos: Partial<Record<Tipo, number>> };
type Painel = { admin: boolean; resumo: Resumo; cupons: Cupom[]; dias: Dia[] };

const TIPOS: { id: Tipo; nome: string; cor: string; texto: string }[] = [
  { id: "vip", nome: "Grupo VIP", cor: "#25A35A", texto: "cupons VIP…, disparados no grupo VIP do WhatsApp" },
  { id: "app", nome: "App (push)", cor: "#3B6FD8", texto: "cupons APP…, disparados no app" },
  { id: "creator", nome: "Creator", cor: "rgb(var(--accent))", texto: "cupom com nome de alguém, comissão sobre as vendas" },
  { id: "promocao", nome: "Promoção", cor: "#E39A6F", texto: "campanhas e ações da loja (Black, VIP, frete…)" },
  { id: "pos_venda", nome: "Pós-venda", cor: "#4C8C6B", texto: "boas-vindas, agradecimento e volta (gerados pela loja)" },
  { id: "interno", nome: "Interno", cor: "#8C877D", texto: "ajustes do time, testes e trocas" },
];
/** VIP… e APP… são regra fixa: o tipo vem do prefixo e não se muda na tela. */
const porPrefixo = (codigo: string) => /^(VIP|APP)/.test(codigo);
const nomeTipo = (t: Tipo) => TIPOS.find((x) => x.id === t)?.nome ?? t;
const corTipo = (t: Tipo) => TIPOS.find((x) => x.id === t)?.cor ?? "#8C877D";

function nomeCanal(c: string | null) {
  if (!c) return "—";
  if (c === "direct") return "Direto";
  if (c === "an unknown source") return "Desconhecido";
  const m = c.match(/^https?:\/\/(?:www\.|m\.|l\.)?([^/]+)/);
  if (m) return m[1];
  return c;
}
const share = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const ticket = (v: number, p: number) => (p > 0 ? v / p : 0);
const nomeCupom = (c: Cupom) => c.nome || c.codigo;
const ehCreator = (c: Cupom) => c.tipo === "creator";
const comissao = (c: Cupom) => (ehCreator(c) ? (c.vendas * c.comissao_pct) / 100 : 0);

function usePainel(store: string, inicio: string, fim: string, tick: number) {
  const v = useDataVersion();
  const [state, setState] = useState<{ data?: Painel; error?: string }>({});
  useEffect(() => {
    let vivo = true;
    supabase.rpc("cupons_painel", { p_store: store, p_inicio: inicio, p_fim: fim }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) setState({ error: error.message });
      else setState({ data: data as Painel });
    });
    return () => { vivo = false; };
  }, [store, inicio, fim, v, tick]);
  return state;
}

type Aba = "visao" | "creators" | "todos" | "comissoes";

export function Cupons() {
  const { period } = usePeriod();
  const store = useStoreParam();
  const [tick, setTick] = useState(0);
  const recarregar = () => setTick((t) => t + 1);
  const { data, error } = usePainel(store, period.start, period.end, tick);
  const [aba, setAba] = useState<Aba>("visao");

  const abas: { id: Aba; nome: string }[] = [
    { id: "visao", nome: "Visão geral" },
    { id: "todos", nome: "Todos os cupons" },
    { id: "creators", nome: "Creators" },
    ...(data?.admin ? [{ id: "comissoes" as Aba, nome: "Comissões" }] : []),
  ];

  return (
    <>
      <PageTitle title={`Cupons · ${nomeLoja(store)}`} sub={`${diaMes(period.start)} a ${diaMes(period.end)} · pedidos pagos, vendas sem frete e já sem estornos`} right={aba !== "comissoes" ? <PeriodPicker /> : undefined} />
      <div role="tablist" aria-label="Seções" className="flex w-fit flex-wrap gap-1 rounded-[10px] border border-line bg-white p-1">
        {abas.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}
            className={`min-h-9 rounded-[7px] px-3.5 text-[13px] font-semibold ${aba === a.id ? "bg-ink text-white" : "text-body hover:bg-soft"}`}>
            {a.nome}
          </button>
        ))}
      </div>
      {error && <ErrorBox message={error} />}
      {!data && !error && <Loading />}
      {data && aba === "visao" && <Visao d={data} irPara={setAba} />}
      {data && aba === "creators" && <Creators d={data} store={store} onSalvo={recarregar} />}
      {data && aba === "todos" && <Todos d={data} store={store} onSalvo={recarregar} />}
      {data?.admin && aba === "comissoes" && <Comissoes store={store} />}
    </>
  );
}

/* ───────────────────────── Visão geral ───────────────────────── */

function Visao({ d, irPara }: { d: Painel; irPara: (a: Aba) => void }) {
  const r = d.resumo;
  const usados = d.cupons.filter((c) => c.pedidos > 0);
  const creators = d.cupons.filter(ehCreator);
  const ticketCupom = ticket(r.vendas_cupom, r.pedidos_cupom);
  const sugeridos = usados.filter((c) => c.sugerido).length;
  const semVenda = creators.filter((c) => c.pedidos === 0 && c.ativo).length;

  const porTipo = TIPOS.map((t) => {
    const l = usados.filter((c) => c.tipo === t.id);
    const vendas = l.reduce((s, c) => s + c.vendas, 0);
    const pedidos = l.reduce((s, c) => s + c.pedidos, 0);
    const desconto = l.reduce((s, c) => s + c.desconto, 0);
    const novos = l.reduce((s, c) => s + c.novos, 0);
    const com = l.reduce((s, c) => s + comissao(c), 0);
    return { ...t, cupons: l.length, vendas, pedidos, desconto, novos, com };
  });
  const maxTipo = Math.max(...porTipo.map((t) => t.vendas), 1);

  const somaDia = (x: Dia) => TIPOS.reduce((s, t) => s + (x.tipos[t.id] ?? 0), 0);
  const maxDia = Math.max(...d.dias.map(somaDia), 1);
  const tiposNoGrafico = TIPOS.filter((t) => d.dias.some((x) => (x.tipos[t.id] ?? 0) > 0));
  const step = Math.max(1, Math.ceil(d.dias.length / 6));

  return (
    <>
      <section aria-label="Indicadores" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Kpi label="Vendas com cupom" value={money(r.vendas_cupom)} sub={`${pct(share(r.vendas_cupom, r.vendas), 0)} das vendas · ${num(r.pedidos_cupom)} de ${num(r.pedidos)} pedidos`} />
        <Kpi label="Desconto dado em cupons" value={money(r.desconto_cupom)} sub={`${pct(share(r.desconto_cupom, r.vendas_cupom + r.desconto_cupom), 0)} do valor cheio desses pedidos`} />
        {(["vip", "app"] as const).map((id) => {
          const t = porTipo.find((x) => x.id === id)!;
          return <Kpi key={id} label={`Vendas ${t.nome}`} value={money(t.vendas)} sub={t.pedidos ? `${num(t.pedidos)} pedidos · ${num(t.cupons)} ${t.cupons === 1 ? "cupom" : "cupons"} · desconto ${money(t.desconto)}` : "nenhum cupom usado no período"} />;
        })}
        <Kpi label="Ticket com cupom" value={money(ticketCupom)} sub={`sem cupom ${money(r.ticket_sem_cupom)} · ${pct(share(r.novos_cupom, r.pedidos_cupom), 0)} clientes novos`} />
      </section>

      {(sugeridos > 0 || semVenda > 0) && (
        <div className="flex flex-wrap gap-3 text-sm">
          {sugeridos > 0 && (
            <button type="button" onClick={() => irPara("todos")} className="rounded-xl border border-laranja/60 bg-white px-4 py-2.5 text-left font-semibold hover:bg-soft">
              {num(sugeridos)} {sugeridos === 1 ? "cupom usado foi classificado" : "cupons usados foram classificados"} automaticamente · conferir
            </button>
          )}
          {semVenda > 0 && (
            <button type="button" onClick={() => irPara("creators")} className="rounded-xl border border-line bg-white px-4 py-2.5 text-left font-semibold hover:bg-soft">
              {num(semVenda)} {semVenda === 1 ? "creator ativa sem venda" : "creators ativas sem venda"} no período · ver
            </button>
          )}
        </div>
      )}

      <Card title="Por tipo de cupom" extra="o custo soma desconto e comissão">
        <div className="mt-3.5 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-2 font-semibold">Tipo</th>
                <th scope="col" className="p-2 font-semibold">Vendas</th>
                <th scope="col" className="p-2 text-right font-semibold">Pedidos</th>
                <th scope="col" className="p-2 text-right font-semibold">Ticket</th>
                <th scope="col" className="p-2 text-right font-semibold">Clientes novos</th>
                <th scope="col" className="p-2 text-right font-semibold">Desconto</th>
                <th scope="col" className="p-2 text-right font-semibold">Comissão</th>
                <th scope="col" className="py-2 pl-2 text-right font-semibold">Custo a cada<br />R$ 100 vendidos</th>
              </tr>
            </thead>
            <tbody>
              {porTipo.map((t) => (
                <tr key={t.id} className="border-t border-soft">
                  <td className="py-[11px] pr-2">
                    <div className="font-semibold"><span aria-hidden="true" className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: t.cor }} />{t.nome}</div>
                    <div className="mt-0.5 text-xs text-muted">{num(t.cupons)} {t.cupons === 1 ? "cupom" : "cupons"} · {t.texto}</div>
                  </td>
                  <td className="p-2">
                    <div className="flex min-w-[170px] items-center gap-2"><ShareBar value={t.vendas} max={maxTipo} /><span className="w-24 text-right font-semibold">{money(t.vendas)}</span></div>
                  </td>
                  <td className="p-2 text-right">{num(t.pedidos)}</td>
                  <td className="p-2 text-right">{t.pedidos ? money(ticket(t.vendas, t.pedidos)) : "—"}</td>
                  <td className="p-2 text-right">{t.pedidos ? pct(share(t.novos, t.pedidos), 0) : "—"}</td>
                  <td className="p-2 text-right">{money(t.desconto)}</td>
                  <td className="p-2 text-right">{t.com ? money(t.com) : "—"}</td>
                  <td className="py-2 pl-2 text-right font-bold">{t.vendas ? money2(share(t.desconto + t.com, t.vendas)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mb-0 mt-3 text-xs text-muted">Custo a cada R$ 100: quanto a loja abriu mão (desconto) e pagou (comissão) para vender R$ 100 com aquele tipo de cupom. Serve para comparar uma promoção com a força das creators. Um pedido com dois cupons conta nos dois.</p>
      </Card>

      {d.dias.length > 1 && (
        <Card
          title="Vendas com cupom por dia"
          extra={
            <span className="flex flex-wrap gap-4">
              {tiposNoGrafico.map((t) => (
                <span key={t.id} className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[3px]" style={{ background: t.cor }} />{t.nome}</span>
              ))}
            </span>
          }
        >
          <div className="mt-[18px] overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="flex h-[180px] items-end gap-1.5 border-b border-[#E6DAC4]">
                {d.dias.map((x) => {
                  const tot = somaDia(x);
                  const partes = tiposNoGrafico.filter((t) => (x.tipos[t.id] ?? 0) > 0);
                  return (
                    <div key={x.dia} className="flex flex-1 flex-col-reverse overflow-hidden rounded-t" style={{ height: `${Math.round((tot / maxDia) * 170)}px` }}
                      title={`${ddmm(x.dia)}: ${partes.map((t) => `${t.nome} ${money(x.tipos[t.id] ?? 0)}`).join(" · ") || "sem cupom"} · ${pct(share(tot, tot + x.sem), 0)} das vendas do dia`}>
                      {partes.map((t) => <div key={t.id} style={{ background: t.cor, height: `${((x.tipos[t.id] ?? 0) / tot) * 100}%` }} />)}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-1.5">
                {d.dias.map((x, i) => (
                  <div key={x.dia} className="flex-1 whitespace-nowrap text-center text-[11px] text-muted">{i % step === 0 || i === d.dias.length - 1 ? ddmm(x.dia) : ""}</div>
                ))}
              </div>
              <div className="mt-1 flex gap-1.5" aria-label="Parte das vendas do dia com cupom">
                {d.dias.map((x) => {
                  const tot = somaDia(x);
                  return <div key={x.dia} className="flex-1 text-center text-[10.5px] font-semibold text-muted">{tot ? pct(share(tot, tot + x.sem), 0) : ""}</div>;
                })}
              </div>
              <p className="mb-0 mt-1 text-xs text-muted">Linha de baixo: parte das vendas do dia que usou cupom. Pedido com mais de um cupom entra num tipo só (VIP, depois App, Creator, Promoção…).</p>
            </div>
          </div>
        </Card>
      )}

      <Card title="Cupons que mais venderam" extra={<button type="button" onClick={() => irPara("todos")} className="font-semibold text-roxo-texto hover:underline">ver todos</button>}>
        {usados.length === 0 ? <Empty>Nenhum cupom usado no período.</Empty> : (
          <ol className="mt-3 space-y-2 p-0">
            {usados.slice(0, 8).map((c, i) => (
              <li key={c.codigo} className="flex list-none items-center gap-3 text-sm">
                <span className="w-5 text-right font-bold text-muted">{i + 1}</span>
                <span className="w-44 truncate font-semibold" title={c.codigo}>{c.codigo}</span>
                <TipoTag c={c} />
                <ShareBar value={c.vendas} max={usados[0].vendas || 1} />
                <span className="w-24 text-right font-semibold">{money(c.vendas)}</span>
                <span className="hidden w-20 text-right text-xs text-muted sm:inline">{num(c.pedidos)} ped.</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}

function TipoTag({ c }: { c: Cupom }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-body">
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: corTipo(c.tipo) }} />
      {nomeTipo(c.tipo)}
      {c.sugerido && <span className="font-normal text-muted">· sugerido</span>}
    </span>
  );
}

/* ───────────────────────── Creators ───────────────────────── */

function Creators({ d, store, onSalvo }: { d: Painel; store: string; onSalvo: () => void }) {
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);

  const ranking = useMemo(() => d.cupons.filter(ehCreator).sort((a, b) => b.vendas - a.vendas || a.codigo.localeCompare(b.codigo)), [d.cupons]);
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return ranking;
    return ranking.filter((c) => [c.codigo, c.nome, c.instagram, c.tiktok, c.email].some((x) => (x ?? "").toLowerCase().includes(q)));
  }, [ranking, busca]);
  const comVenda = ranking.filter((c) => c.pedidos > 0);
  const vendas = comVenda.reduce((s, c) => s + c.vendas, 0);
  const com = comVenda.reduce((s, c) => s + comissao(c), 0);
  const pedidos = comVenda.reduce((s, c) => s + c.pedidos, 0);
  const novos = comVenda.reduce((s, c) => s + c.novos, 0);

  return (
    <>
      <section aria-label="Indicadores das creators" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <Kpi label="Vendas por creators" value={money(vendas)} sub={`${num(pedidos)} pedidos`} />
        <Kpi label="Comissão do período" value={money(com)} sub={vendas ? `${pct(share(com, vendas), 1)} das vendas delas` : undefined} />
        <Kpi label="Creators que venderam" value={num(comVenda.length)} sub={`de ${num(ranking.filter((c) => c.ativo).length)} ativas`} />
        <Kpi label="Clientes novos" value={pedidos ? pct(share(novos, pedidos), 0) : "—"} sub="primeira compra na loja" />
      </section>

      <Card
        title="Ranking de creators"
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome, cupom, @" aria-label="Buscar creator" className="min-h-10 w-56 rounded-lg border border-line px-3 text-sm text-ink" />
            <button type="button" onClick={() => setNovo((v) => !v)} className="min-h-10 rounded-lg bg-ink px-3.5 text-[13px] font-semibold text-white">{novo ? "Fechar" : "Nova creator"}</button>
          </div>
        }
      >
        {novo && (
          <div className="mt-4 rounded-xl border border-line bg-ground p-4">
            <p className="m-0 mb-3 text-sm text-body">Cadastre o cupom antes da primeira venda. O cupom precisa existir também na Shopify, com o mesmo código.</p>
            <FormCupom store={store} admin={d.admin} onSalvo={() => { setNovo(false); onSalvo(); }} />
          </div>
        )}
        {lista.length === 0 ? <Empty>{ranking.length ? "Nenhuma creator encontrada." : "Nenhum cupom de creator ainda. Marque o tipo Creator na aba Todos os cupons."}</Empty> : (
          <ul className="mt-4 space-y-2 p-0">
            {lista.map((c) => {
              const pos = ranking.indexOf(c) + 1;
              const open = aberto === c.codigo;
              return (
                <li key={c.codigo} className={`list-none rounded-xl border ${open ? "border-roxo/50" : "border-line"} ${c.ativo ? "" : "opacity-60"}`}>
                  <button type="button" aria-expanded={open} onClick={() => setAberto(open ? null : c.codigo)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                    <Posicao n={c.pedidos > 0 ? pos : 0} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">
                        {nomeCupom(c)}
                        {c.sugerido && <span className="ml-2 text-xs font-normal text-muted">sugerido</span>}
                        {!c.ativo && <span className="ml-2 text-xs font-normal text-muted">inativa</span>}
                      </div>
                      <div className="truncate text-xs text-muted">
                        <span className="font-semibold text-roxo-texto">{c.codigo}</span>
                        {c.instagram ? ` · ${c.instagram}` : ""}
                        {c.ultimo ? ` · última venda ${ddmm(c.ultimo)}` : ""}
                      </div>
                    </div>
                    <Metrica rotulo="Pedidos" valor={num(c.pedidos)} className="hidden md:block" />
                    <Metrica rotulo="Clientes novos" valor={c.pedidos ? pct(share(c.novos, c.pedidos), 0) : "—"} className="hidden lg:block" />
                    <Metrica rotulo="Canal" valor={nomeCanal(c.canal)} className="hidden w-28 lg:block" />
                    <Metrica rotulo="Vendas" valor={money(c.vendas)} />
                    <Metrica rotulo={`Comissão ${String(c.comissao_pct).replace(".", ",")}%`} valor={money2(comissao(c))} className="hidden sm:block" />
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  {open && (
                    <div className="border-t border-soft px-4 pb-4 pt-3">
                      <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                        <Mini rotulo="Ticket médio" valor={c.pedidos ? money(ticket(c.vendas, c.pedidos)) : "—"} />
                        <Mini rotulo="Desconto dado" valor={money(c.desconto)} />
                        <Mini rotulo="Estornos" valor={money(c.estornos)} />
                        <Mini rotulo="Primeira venda" valor={c.primeiro ? ddmm(c.primeiro) : "—"} />
                        <Mini rotulo="Vendas desde o início" valor={`${num(c.pedidos_total)} pedidos`} />
                      </div>
                      <FormCupom store={store} admin={d.admin} cupom={c} onSalvo={onSalvo} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mb-0 mt-3 text-xs text-muted">Ranking por vendas no período (sem frete, já sem estornos). Comissão estimada sobre essas vendas; o valor a pagar de cada mês fica na aba Comissões.</p>
      </Card>
    </>
  );
}

function Posicao({ n }: { n: number }) {
  const cls = n === 1 ? "bg-[#F2C94C] text-[#5C4400]" : n === 2 ? "bg-[#D9D6CF] text-ink" : n === 3 ? "bg-[#E3A877] text-[#4A2A0E]" : "bg-soft text-muted";
  return <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-extrabold ${cls}`}>{n || "–"}</span>;
}
function Metrica({ rotulo, valor, className = "" }: { rotulo: string; valor: string; className?: string }) {
  return (
    <div className={`shrink-0 text-right ${className}`}>
      <div className="text-[11px] font-semibold text-muted">{rotulo}</div>
      <div className="truncate text-sm font-bold">{valor}</div>
    </div>
  );
}
function Mini({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg bg-ground px-3 py-2">
      <div className="text-[11px] font-semibold text-muted">{rotulo}</div>
      <div className="font-bold">{valor}</div>
    </div>
  );
}

function FormCupom({ store, admin, cupom, onSalvo }: { store: string; admin: boolean; cupom?: Cupom; onSalvo: () => void }) {
  const [f, setF] = useState({
    codigo: cupom?.codigo ?? "",
    tipo: (cupom?.tipo ?? "creator") as Tipo,
    nome: cupom?.nome ?? "",
    instagram: cupom?.instagram ?? "",
    tiktok: cupom?.tiktok ?? "",
    email: cupom?.email ?? "",
    pix: cupom?.pix ?? "",
    comissao_pct: String(cupom?.comissao_pct ?? 10),
    ativo: cupom?.ativo ?? true,
    obs: cupom?.obs ?? "",
  });
  const [extra, setExtra] = useState({ comissao_desde: "", saldo_inicial: "" });
  const [estado, setEstado] = useState<{ salvando?: boolean; erro?: string; ok?: boolean }>({});
  const campo = "min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink";

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    const codigo = f.codigo.trim().toUpperCase();
    if (!codigo) return setEstado({ erro: "Informe o código do cupom." });
    const p: Record<string, unknown> = { tipo: f.tipo, nome: f.nome, instagram: f.instagram, tiktok: f.tiktok, email: f.email, ativo: f.ativo, obs: f.obs };
    if (admin) {
      p.pix = f.pix;
      const n = Number(f.comissao_pct.replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n > 100) return setEstado({ erro: "Comissão deve ser um número de 0 a 100." });
      p.comissao_pct = n;
      if (extra.comissao_desde) p.comissao_desde = extra.comissao_desde;
      if (extra.saldo_inicial) p.saldo_inicial = Number(extra.saldo_inicial.replace(",", "."));
    }
    setEstado({ salvando: true });
    const { error } = await supabase.rpc("cupom_salvar", { p_store: store, p_codigo: codigo, p });
    if (error) return setEstado({ erro: error.message });
    setEstado({ ok: true });
    onSalvo();
  };

  return (
    <form onSubmit={salvar} className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {!cupom && (
        <label className="flex flex-col gap-1 font-semibold">Código do cupom
          <input required value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value.toUpperCase() })} className={campo} placeholder="EX.: MARIA" />
        </label>
      )}
      <label className="flex flex-col gap-1 font-semibold">Tipo
        <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as Tipo })} className={campo}>
          {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 font-semibold">Nome
        <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} className={campo} />
      </label>
      <label className="flex flex-col gap-1 font-semibold">Instagram
        <input value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} className={campo} placeholder="@" />
      </label>
      <label className="flex flex-col gap-1 font-semibold">TikTok
        <input value={f.tiktok} onChange={(e) => setF({ ...f, tiktok: e.target.value })} className={campo} placeholder="@" />
      </label>
      <label className="flex flex-col gap-1 font-semibold">E-mail
        <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={campo} />
      </label>
      {admin && (
        <>
          <label className="flex flex-col gap-1 font-semibold">Chave Pix
            <input value={f.pix} onChange={(e) => setF({ ...f, pix: e.target.value })} className={campo} />
          </label>
          <label className="flex flex-col gap-1 font-semibold">Comissão (%)
            <input inputMode="decimal" value={f.comissao_pct} onChange={(e) => setF({ ...f, comissao_pct: e.target.value })} className={campo} />
          </label>
          <label className="flex flex-col gap-1 font-semibold">Comissão a partir de
            <input type="date" value={extra.comissao_desde} onChange={(e) => setExtra({ ...extra, comissao_desde: e.target.value })} className={campo} />
            <span className="text-[11px] font-normal text-muted">vazio = mantém (padrão 01/11/2026)</span>
          </label>
          <label className="flex flex-col gap-1 font-semibold">Saldo do sistema antigo (R$)
            <input inputMode="decimal" value={extra.saldo_inicial} onChange={(e) => setExtra({ ...extra, saldo_inicial: e.target.value })} className={campo} placeholder="não pago até out/2026" />
          </label>
        </>
      )}
      <label className="flex flex-col gap-1 font-semibold sm:col-span-2">Observação
        <input value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} className={campo} />
      </label>
      <label className="flex items-center gap-2 self-end pb-2 font-semibold">
        <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} className="h-4 w-4" />
        Ativo
      </label>
      <div className="flex items-end gap-3">
        <button type="submit" disabled={estado.salvando} className="min-h-10 rounded-lg bg-ink px-4 text-[13px] font-semibold text-white disabled:opacity-60">{estado.salvando ? "Salvando…" : "Salvar"}</button>
        {estado.ok && <span role="status" className="text-xs font-semibold text-bom">Salvo</span>}
      </div>
      {estado.erro && <p role="alert" className="m-0 text-xs font-semibold text-ruim sm:col-span-2 lg:col-span-4">{estado.erro}</p>}
    </form>
  );
}

/* ───────────────────────── Todos os cupons ───────────────────────── */

type Ordem = "vendas" | "pedidos" | "desconto" | "custo" | "ultimo";

function Todos({ d, store, onSalvo }: { d: Painel; store: string; onSalvo: () => void }) {
  const [filtro, setFiltro] = useState<Tipo | "todos" | "sugeridos">("todos");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("vendas");
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const usados = d.cupons.filter((c) => c.pedidos > 0);
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const custo = (c: Cupom) => share(c.desconto + comissao(c), c.vendas);
    return usados
      .filter((c) => filtro === "todos" || (filtro === "sugeridos" ? c.sugerido : c.tipo === filtro))
      .filter((c) => !q || [c.codigo, c.nome, c.instagram].some((x) => (x ?? "").toLowerCase().includes(q)))
      .sort((a, b) =>
        ordem === "pedidos" ? b.pedidos - a.pedidos
        : ordem === "desconto" ? b.desconto - a.desconto
        : ordem === "custo" ? custo(b) - custo(a)
        : ordem === "ultimo" ? (b.ultimo ?? "").localeCompare(a.ultimo ?? "")
        : b.vendas - a.vendas);
  }, [usados, filtro, busca, ordem]);
  const sugeridos = lista.filter((c) => c.sugerido);

  const mudarTipo = async (codigo: string, tipo: Tipo) => {
    setSalvando(codigo);
    setErro(null);
    const { error } = await supabase.rpc("cupom_salvar", { p_store: store, p_codigo: codigo, p: { tipo } });
    setSalvando(null);
    if (error) setErro(error.message);
    else onSalvo();
  };
  const confirmarTodos = async () => {
    setSalvando("*");
    setErro(null);
    for (const c of sugeridos) {
      const { error } = await supabase.rpc("cupom_salvar", { p_store: store, p_codigo: c.codigo, p: { tipo: c.tipo } });
      if (error) { setErro(error.message); break; }
    }
    setSalvando(null);
    onSalvo();
  };

  const contagem = (t: Tipo | "todos" | "sugeridos") => (t === "todos" ? usados.length : t === "sugeridos" ? usados.filter((c) => c.sugerido).length : usados.filter((c) => c.tipo === t).length);

  return (
    <Card
      title={`Cupons usados no período (${lista.length})`}
      extra={
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cupom" aria-label="Buscar cupom" className="min-h-9 w-44 rounded-lg border border-line px-3 text-sm text-ink" />
          <label className="flex items-center gap-1.5">Ordenar
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} className="min-h-9 rounded-[8px] border border-line bg-white px-2 text-ink">
              <option value="vendas">vendas</option>
              <option value="pedidos">pedidos</option>
              <option value="desconto">desconto</option>
              <option value="custo">custo por R$ 100</option>
              <option value="ultimo">último uso</option>
            </select>
          </label>
        </div>
      }
    >
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filtrar tipo" className="flex flex-wrap gap-1 rounded-[10px] border border-line p-1">
          {(["todos", ...TIPOS.map((t) => t.id), "sugeridos"] as const).map((t) => (
            <button key={t} type="button" aria-pressed={filtro === t} onClick={() => setFiltro(t)}
              className={`min-h-9 rounded-[7px] px-3 text-[13px] font-semibold ${filtro === t ? "bg-ink text-white" : "text-body hover:bg-soft"}`}>
              {t === "todos" ? "Todos" : t === "sugeridos" ? "A conferir" : nomeTipo(t)} <span className="font-normal opacity-70">{contagem(t)}</span>
            </button>
          ))}
        </div>
        {sugeridos.length > 0 && (
          <button type="button" disabled={salvando !== null} onClick={confirmarTodos} className="min-h-9 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-soft disabled:opacity-60">
            {salvando === "*" ? "Confirmando…" : `Confirmar as ${sugeridos.length} sugestões da lista`}
          </button>
        )}
      </div>
      {erro && <p role="alert" className="mt-2 text-sm font-semibold text-ruim">{erro}</p>}
      {lista.length === 0 ? <Empty>Nenhum cupom neste filtro.</Empty> : (
        <div className="mt-3.5 overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-2 font-semibold">Cupom</th>
                <th scope="col" className="p-2 font-semibold">Tipo</th>
                <th scope="col" className="p-2 text-right font-semibold">Pedidos</th>
                <th scope="col" className="p-2 text-right font-semibold">Vendas</th>
                <th scope="col" className="p-2 text-right font-semibold">Ticket</th>
                <th scope="col" className="p-2 text-right font-semibold">Desconto<br /><span className="font-normal">típico</span></th>
                <th scope="col" className="p-2 text-right font-semibold">Custo a cada<br />R$ 100</th>
                <th scope="col" className="p-2 text-right font-semibold">Clientes<br />novos</th>
                <th scope="col" className="p-2 font-semibold">Canal principal</th>
                <th scope="col" className="py-2 pl-2 text-right font-semibold">Uso</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.codigo} className="border-t border-soft">
                  <td className="py-[11px] pr-2">
                    <div className="font-semibold">{c.codigo}</div>
                    {c.nome && <div className="text-xs text-muted">{c.nome}</div>}
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-1.5">
                      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: corTipo(c.tipo) }} />
                      {porPrefixo(c.codigo) ? <span className="text-xs font-semibold" title="Definido pelo começo do código">{nomeTipo(c.tipo)}</span> : (
                      <select aria-label={`Tipo do cupom ${c.codigo}`} value={c.tipo} disabled={salvando !== null} onChange={(e) => mudarTipo(c.codigo, e.target.value as Tipo)}
                        className={`min-h-8 rounded-md border bg-white px-1.5 text-xs font-semibold ${c.sugerido ? "border-dashed border-laranja" : "border-line"}`}>
                        {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.nome}{c.sugerido && t.id === c.tipo ? " (sugerido)" : ""}</option>)}
                      </select>)}
                    </div>
                  </td>
                  <td className="p-2 text-right">{num(c.pedidos)}</td>
                  <td className="p-2 text-right font-semibold">{money(c.vendas)}</td>
                  <td className="p-2 text-right">{money(ticket(c.vendas, c.pedidos))}</td>
                  <td className="p-2 text-right">{c.mediana != null ? pct(c.mediana * 100, 0) : "—"}</td>
                  <td className="p-2 text-right font-bold">{c.vendas ? money2(share(c.desconto + comissao(c), c.vendas)) : "—"}</td>
                  <td className="p-2 text-right">{pct(share(c.novos, c.pedidos), 0)}</td>
                  <td className="max-w-[140px] truncate p-2 text-body" title={c.canal ?? ""}>{nomeCanal(c.canal)}</td>
                  <td className="whitespace-nowrap py-2 pl-2 text-right text-xs text-muted">{c.primeiro && c.ultimo ? `${ddmm(c.primeiro)} → ${ddmm(c.ultimo)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mb-0 mt-3 text-xs text-muted">Grupo VIP e App vêm do começo do código (VIP… e APP…) e não precisam de conferência. Tracejado = tipo sugerido pelo Pharol (pelo nome do cupom e pelo desconto típico; 5% com nome de pessoa vira Creator). Mudar o tipo vale para todo o histórico. Desconto típico e uso consideram todo o histórico; o resto, só o período. Canal principal = canal da última visita antes da compra na maioria dos pedidos.</p>
    </Card>
  );
}

/* ───────────────────────── Comissões ───────────────────────── */

type LinhaComissao = {
  codigo: string; sugerido: boolean; nome: string | null; instagram: string | null; pix: string | null; email: string | null;
  pct: number; desde: string; pedidos_mes: number; vendas_mes: number; comissao_mes: number; acumulado: number; total: number;
  pagamento: { valor: number; pago_em: string; pago_por: string | null } | null;
};
const MINIMO = 100;

function mesAnterior() {
  const hoje = todaySP();
  const d = new Date(`${hoje.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}
const nomeMes = (ym: string) => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

function Comissoes({ store }: { store: string }) {
  const [mes, setMes] = useState(() => (mesAnterior() < "2026-11" ? "2026-11" : mesAnterior()));
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ linhas?: LinhaComissao[]; error?: string }>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setState({});
    supabase.rpc("cupons_comissoes", { p_store: store, p_mes: `${mes}-01` }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) setState({ error: error.message });
      else setState({ linhas: (data as { linhas: LinhaComissao[] }).linhas });
    });
    return () => { vivo = false; };
  }, [store, mes, tick]);

  const linhas = state.linhas ?? [];
  const aberto = mes >= todaySP().slice(0, 7);
  const pagas = linhas.filter((l) => l.pagamento);
  const pendentes = linhas.filter((l) => !l.pagamento && l.total > 0);
  const aPagar = pendentes.filter((l) => l.total >= MINIMO);
  const acumulando = pendentes.filter((l) => l.total < MINIMO);

  const pagar = async (l: LinhaComissao) => {
    if (!window.confirm(`Confirmar pagamento de ${money2(l.total)} para ${l.nome || l.codigo}?`)) return;
    setOcupado(l.codigo);
    const { error } = await supabase.rpc("comissao_pagar", { p_store: store, p_codigo: l.codigo, p_mes: `${mes}-01`, p_valor: l.total });
    setOcupado(null);
    if (error) window.alert(error.message);
    else setTick((t) => t + 1);
  };
  const desfazer = async (l: LinhaComissao) => {
    setOcupado(l.codigo);
    const { error } = await supabase.rpc("comissao_desfazer", { p_store: store, p_codigo: l.codigo, p_mes: `${mes}-01` });
    setOcupado(null);
    if (error) window.alert(error.message);
    else setTick((t) => t + 1);
  };
  const copiar = async (texto: string, chave: string) => {
    try { await navigator.clipboard.writeText(texto); setCopiado(chave); setTimeout(() => setCopiado(null), 1500); } catch { /* sem área de transferência */ }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold">Mês
          <input type="month" value={mes} min="2026-11" max={todaySP().slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} className="min-h-10 rounded-lg border border-line bg-white px-3 text-ink" />
        </label>
        <span className="text-sm text-muted">{nomeMes(mes)}{aberto ? " · mês em andamento, os valores ainda mudam" : ""}</span>
      </div>
      {state.error && <ErrorBox message={state.error} />}
      {!state.linhas && !state.error && <Loading />}
      {state.linhas && (
        <>
          <section aria-label="Resumo das comissões" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
            <Kpi label="A pagar" value={money2(aPagar.reduce((s, l) => s + l.total, 0))} sub={`${num(aPagar.length)} creators com ${money(MINIMO)} ou mais`} />
            <Kpi label="Já pago" value={money2(pagas.reduce((s, l) => s + (l.pagamento?.valor ?? 0), 0))} sub={`${num(pagas.length)} pagamentos neste mês`} />
            <Kpi label="Acumulando" value={money2(acumulando.reduce((s, l) => s + l.total, 0))} sub={`${num(acumulando.length)} abaixo de ${money(MINIMO)}, passam para o próximo mês`} />
            <Kpi label="Comissão gerada no mês" value={money2(linhas.reduce((s, l) => s + l.comissao_mes, 0))} sub={`sobre ${money(linhas.reduce((s, l) => s + l.vendas_mes, 0))} em vendas`} />
          </section>
          <Card title="Comissão por creator">
            {linhas.length === 0 ? <Empty>Nenhuma comissão neste mês.</Empty> : (
              <div className="mt-3.5 overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th scope="col" className="py-2 pr-2 font-semibold">Creator</th>
                      <th scope="col" className="p-2 font-semibold">Pix</th>
                      <th scope="col" className="p-2 text-right font-semibold">Vendas no mês</th>
                      <th scope="col" className="p-2 text-right font-semibold">Comissão do mês</th>
                      <th scope="col" className="p-2 text-right font-semibold">Saldo anterior</th>
                      <th scope="col" className="p-2 text-right font-semibold">Total</th>
                      <th scope="col" className="py-2 pl-2 text-right font-semibold">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.codigo} className="border-t border-soft">
                        <td className="py-[11px] pr-2">
                          <div className="font-semibold">{l.nome || l.codigo}{l.sugerido && <span className="ml-2 text-xs font-normal text-muted">sugerida, confirme o cadastro</span>}</div>
                          <div className="text-xs text-muted"><span className="font-semibold text-roxo-texto">{l.codigo}</span> · {String(l.pct).replace(".", ",")}%{l.instagram ? ` · ${l.instagram}` : ""}</div>
                        </td>
                        <td className="p-2">
                          {l.pix ? (
                            <button type="button" onClick={() => copiar(l.pix!, l.codigo)} title="Copiar chave Pix" className="max-w-[180px] truncate rounded-md border border-line px-2 py-1 text-xs hover:bg-soft">
                              {copiado === l.codigo ? "Copiado" : l.pix}
                            </button>
                          ) : <span className="text-xs text-ruim">sem Pix</span>}
                        </td>
                        <td className="p-2 text-right">{money2(l.vendas_mes)} <span className="text-xs text-muted">· {num(l.pedidos_mes)}</span></td>
                        <td className="p-2 text-right">{money2(l.comissao_mes)}</td>
                        <td className="p-2 text-right">{l.acumulado ? money2(l.acumulado) : "—"}</td>
                        <td className="p-2 text-right font-bold">{money2(l.pagamento ? l.pagamento.valor : l.total)}</td>
                        <td className="py-2 pl-2 text-right">
                          {l.pagamento ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="text-xs font-semibold text-bom">Pago em {new Date(l.pagamento.pago_em).toLocaleDateString("pt-BR")}</span>
                              <button type="button" disabled={ocupado !== null} onClick={() => desfazer(l)} className="min-h-8 rounded-md border border-line px-2 text-xs font-semibold hover:bg-soft disabled:opacity-60">Desfazer</button>
                            </span>
                          ) : l.total <= 0 ? (
                            <span className="text-xs text-muted">Nada a pagar</span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              {l.total < MINIMO && <span className="text-xs text-muted">Abaixo de {money(MINIMO)}, acumula</span>}
                              <button type="button" disabled={ocupado !== null} onClick={() => pagar(l)}
                                className={`min-h-8 rounded-md px-3 text-xs font-semibold disabled:opacity-60 ${l.total >= MINIMO ? "bg-ink text-white" : "border border-line hover:bg-soft"}`}>
                                {ocupado === l.codigo ? "…" : "Marcar pago"}
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <details className="mt-4 rounded-xl bg-ground px-4 py-3 text-[13px] text-body">
              <summary className="cursor-pointer font-semibold text-ink">Como a comissão é calculada</summary>
              <ul className="mb-1 mt-2 list-disc space-y-1.5 pl-5">
                <li>Comissão = % da creator (padrão 10%) sobre as vendas pagas com o cupom, sem frete, depois do desconto e dos estornos.</li>
                <li>Saldo abaixo de {money(MINIMO)} acumula para o mês seguinte. Marcar como pago quita o total até este mês. Dá para pagar valores menores se quiser.</li>
                <li>O Pharol começa a contar em 01/11/2026. O que ficou pendente no painel antigo entra como &quot;Saldo do sistema antigo&quot; no cadastro da creator (aba Creators).</li>
                <li>Se um pedido for estornado depois do pagamento, a diferença aparece no saldo do mês seguinte.</li>
              </ul>
            </details>
          </Card>
        </>
      )}
    </>
  );
}
