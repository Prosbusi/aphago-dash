import { useEffect, useState, type FormEvent } from "react";
import { usePeriod } from "../period-context";
import { useStoreParam, nomeLoja } from "../lib/store";
import { useDataVersion } from "../lib/data";
import { supabase } from "../lib/supabase";
import { ddmm, dec, diaMes, money, money2, num, pct } from "../lib/format";
import { todaySP } from "../lib/period";
import { Card, Empty, ErrorBox, Kpi, Loading, PageTitle, ShareBar } from "../components/ui";
import { PeriodPicker } from "../components/PeriodPicker";

type Produto = {
  chave: string; nome: string; link: string | null;
  geracoes: number; falhas: number; uploads: number; custo: number | null;
  pedidos: number; unidades: number; receita: number;
};
type Dia = { dia: string; geracoes: number; falhas: number; uploads: number; custo: number | null };
type Fatura = { mes: string; valor: number; requisicoes: number | null; obs: string | null; geracoes: number };
type Auto = { atualizado_em: string | null; ultimo_dia_custo: string | null; moeda: string | null; custo_periodo: number | null; requisicoes_periodo: number | null };
type Painel = {
  admin: boolean;
  auto: Auto | null;
  custo_unitario: number | null;
  faturas: Fatura[] | null;
  primeiro_evento: string | null;
  resumo: {
    geracoes: number; falhas: number; uploads: number; custo: number | null;
    receita: number; pedidos: number; receita_com_ia: number; pedidos_com_ia: number;
  };
  dias: Dia[];
  produtos: Produto[];
};

const share = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const nomeMes = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}`;

function usePainel(store: string, inicio: string, fim: string, tick: number) {
  const v = useDataVersion();
  const [state, setState] = useState<{ data?: Painel; error?: string }>({});
  useEffect(() => {
    let vivo = true;
    supabase.rpc("ia_painel", { p_store: store, p_inicio: inicio, p_fim: fim }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) setState({ error: error.message });
      else setState({ data: data as Painel });
    });
    return () => { vivo = false; };
  }, [store, inicio, fim, v, tick]);
  return state;
}

export function GastosIA() {
  const { period } = usePeriod();
  const store = useStoreParam();
  const [tick, setTick] = useState(0);
  const { data, error } = usePainel(store, period.start, period.end, tick);

  return (
    <>
      <PageTitle
        title={`Gastos com IA · ${nomeLoja(store)}`}
        sub={`${diaMes(period.start)} a ${diaMes(period.end)} · imagens geradas pelo Customily (Gemini) na página do produto`}
        right={<PeriodPicker />}
      />
      {error && <ErrorBox message={error} />}
      {!data && !error && <Loading />}
      {data && !data.primeiro_evento && <SemDados />}
      {data && data.primeiro_evento && <Visao d={data} />}
      {data?.admin && <Faturas d={data} onSalvo={() => setTick((t) => t + 1)} />}
    </>
  );
}

function SemDados() {
  return (
    <Card title="Ainda sem gerações registradas">
      <p className="mb-0 mt-3 text-sm text-body">
        A coleta começa quando o script <code>scripts/ia-tema.liquid</code> estiver no <code>theme.liquid</code> da loja (logo depois de <code>&lt;head&gt;</code>).
        Cada imagem gerada e cada foto enviada na página do produto aparece aqui em poucos segundos.
      </p>
    </Card>
  );
}

function Visao({ d }: { d: Painel }) {
  const r = d.resumo;
  const custo = r.custo ?? 0;
  const max = Math.max(...d.dias.map((x) => x.geracoes + x.falhas), 1);
  const step = Math.max(1, Math.ceil(d.dias.length / 6));
  const maxProd = Math.max(...d.produtos.map((p) => p.geracoes), 1);
  const [busca, setBusca] = useState("");
  const q = busca.trim().toLowerCase();
  const lista = q ? d.produtos.filter((p) => `${p.nome} ${p.chave}`.toLowerCase().includes(q)) : d.produtos;

  return (
    <>
      <section aria-label="Indicadores" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Kpi label="Imagens geradas" value={num(r.geracoes)} sub={`${num(r.uploads)} fotos enviadas · ${r.uploads ? dec(r.geracoes / r.uploads) : "—"} gerações por foto`} />
        {d.admin && (
          <Kpi label="Custo estimado de IA" value={money(custo)}
            sub={d.custo_unitario != null ? `${money2(d.custo_unitario)} por geração` : "lance a fatura do Gemini abaixo"} />
        )}
        {d.admin && <Kpi label="Custo de IA por pedido" value={r.pedidos ? money2(custo / r.pedidos) : "—"} sub={`${pct(share(custo, r.receita))} da receita (${money(r.receita)})`} />}
        <Kpi label="Gerações por pedido" value={r.pedidos ? dec(r.geracoes / r.pedidos) : "—"} sub={`${num(r.pedidos)} pedidos pagos no período`} />
        <Kpi label="Gerações com erro" value={num(r.falhas)} sub={r.geracoes + r.falhas ? `${pct(share(r.falhas, r.geracoes + r.falhas))} das tentativas` : "nenhuma tentativa"} />
      </section>

      {d.dias.length > 1 && (
        <Card
          title="Gerações por dia"
          extra={
            <span className="flex flex-wrap gap-4">
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[3px] bg-roxo" />Com sucesso</span>
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[3px] bg-ruim" />Com erro</span>
            </span>
          }
        >
          <div className="mt-[18px] overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="flex h-[180px] items-end gap-1.5 border-b border-[#E6DAC4]">
                {d.dias.map((x) => {
                  const tot = x.geracoes + x.falhas;
                  return (
                    <div key={x.dia} className="flex flex-1 flex-col-reverse overflow-hidden rounded-t" style={{ height: `${Math.round((tot / max) * 170)}px` }}
                      title={`${ddmm(x.dia)}: ${num(x.geracoes)} gerações${x.falhas ? ` · ${num(x.falhas)} com erro` : ""} · ${num(x.uploads)} fotos${x.custo != null ? ` · ${money(x.custo)}` : ""}`}>
                      {x.geracoes > 0 && <div className="bg-roxo" style={{ height: `${(x.geracoes / tot) * 100}%` }} />}
                      {x.falhas > 0 && <div className="bg-ruim" style={{ height: `${(x.falhas / tot) * 100}%` }} />}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-1.5">
                {d.dias.map((x, i) => (
                  <div key={x.dia} className="flex-1 whitespace-nowrap text-center text-[11px] text-muted">{i % step === 0 || i === d.dias.length - 1 ? ddmm(x.dia) : ""}</div>
                ))}
              </div>
              {d.admin && (
                <div className="mt-1 flex gap-1.5" aria-label="Custo estimado do dia">
                  {d.dias.map((x) => (
                    <div key={x.dia} className="flex-1 text-center text-[10.5px] font-semibold text-muted">{x.custo ? money(x.custo) : ""}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card
        title={`${num(d.produtos.length)} produtos com IA no período`}
        extra={
          <label className="flex items-center gap-2">
            <span className="sr-only">Buscar produto</span>
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto ou código"
              className="min-h-10 w-56 rounded-lg border border-line px-3 text-sm text-ink" />
          </label>
        }
      >
        {lista.length === 0 ? <Empty>Nenhum produto com geração no período.</Empty> : (
          <div className="mt-3.5 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-2 font-semibold">Produto</th>
                  <th scope="col" className="p-2 font-semibold">Gerações</th>
                  <th scope="col" className="p-2 text-right font-semibold">Fotos</th>
                  <th scope="col" className="p-2 text-right font-semibold">Erros</th>
                  {d.admin && <th scope="col" className="p-2 text-right font-semibold">Custo IA</th>}
                  <th scope="col" className="p-2 text-right font-semibold">Pedidos</th>
                  <th scope="col" className="p-2 text-right font-semibold">Receita</th>
                  <th scope="col" className="p-2 text-right font-semibold">Gerações<br />por pedido</th>
                  {d.admin && <th scope="col" className="p-2 text-right font-semibold">Custo IA<br />por pedido</th>}
                  {d.admin && <th scope="col" className="py-2 pl-2 text-right font-semibold">% da<br />receita</th>}
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => {
                  const pesoReceita = p.custo != null ? share(p.custo, p.receita) : 0;
                  const alerta = d.admin && p.custo != null && (p.pedidos === 0 ? p.custo > 0 : pesoReceita >= 10);
                  return (
                    <tr key={p.chave} className="border-t border-soft">
                      <td className="py-[11px] pr-2">
                        <div className="font-semibold">{p.nome}</div>
                        <div className="mt-0.5 text-xs text-muted">{p.chave.startsWith("gid://") ? "sem código" : p.chave}</div>
                      </td>
                      <td className="p-2">
                        <div className="flex min-w-[150px] items-center gap-2"><ShareBar value={p.geracoes} max={maxProd} /><span className="w-14 text-right font-semibold">{num(p.geracoes)}</span></div>
                      </td>
                      <td className="p-2 text-right">{num(p.uploads)}</td>
                      <td className={`p-2 text-right ${p.falhas ? "font-semibold text-ruim" : ""}`}>{p.falhas ? num(p.falhas) : "—"}</td>
                      {d.admin && <td className="p-2 text-right font-semibold">{p.custo != null ? money2(p.custo) : "—"}</td>}
                      <td className="p-2 text-right">{num(p.pedidos)}</td>
                      <td className="p-2 text-right">{money(p.receita)}</td>
                      <td className="p-2 text-right">{p.pedidos ? dec(p.geracoes / p.pedidos) : "—"}</td>
                      {d.admin && <td className="p-2 text-right">{p.pedidos && p.custo != null ? money2(p.custo / p.pedidos) : "—"}</td>}
                      {d.admin && (
                        <td className={`py-2 pl-2 text-right font-bold ${alerta ? "text-ruim" : ""}`}>
                          {p.custo == null ? "—" : p.receita ? pct(pesoReceita) : p.custo ? "sem venda" : "—"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mb-0 mt-3 text-xs text-muted">
          Produtos agrupados pela família (código raiz). Pedidos e receita: pedidos pagos do período com aquele produto, gerado com IA ou não.
          {d.admin && " Em vermelho: IA custando 10% ou mais da receita do produto, ou custo sem nenhuma venda."}
        </p>
      </Card>
    </>
  );
}

function Automatico({ a }: { a: Auto | null }) {
  if (!a?.atualizado_em) {
    return (
      <p className="mb-0 mt-3 text-sm text-body">
        <strong>Automático:</strong> aguardando a primeira leitura da fatura no Google Cloud (roda de hora em hora).
      </p>
    );
  }
  const quando = new Date(a.atualizado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="mt-3 rounded-lg bg-soft px-4 py-3 text-sm text-body">
      <strong>Automático (Google Cloud):</strong> custo real por dia, lido da fatura do Gemini, e requisições do Cloud Monitoring.
      Custo por geração de cada dia = custo ÷ requisições dos 7 dias até ele.
      <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
        <span>Atualizado em {quando}</span>
        <span>Fatura até {a.ultimo_dia_custo ? ddmm(a.ultimo_dia_custo) : "—"}</span>
        <span>No período: {a.custo_periodo != null ? money2(a.custo_periodo) : "—"} · {a.requisicoes_periodo != null ? `${num(a.requisicoes_periodo)} requisições` : "requisições ainda não lidas"}</span>
      </div>
    </div>
  );
}

function Faturas({ d, onSalvo }: { d: Painel; onSalvo: () => void }) {
  const mesAtual = `${todaySP().slice(0, 7)}`;
  const [mes, setMes] = useState(mesAtual);
  const [valor, setValor] = useState("");
  const [req, setReq] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const v = Number(valor.replace(/\./g, "").replace(",", "."));
    if (!mes || !Number.isFinite(v) || v < 0) { setErro("Informe o mês e o valor da fatura."); return; }
    const n = req.trim() ? Number(req.replace(/\D/g, "")) : null;
    setSalvando(true);
    setErro(null);
    const { error } = await supabase.rpc("ia_custo_salvar", { p_mes: `${mes}-01`, p_valor: v, p_requisicoes: n || null, p_obs: null });
    setSalvando(false);
    if (error) setErro(error.message);
    else { setValor(""); setReq(""); onSalvo(); }
  }

  async function apagar(m: string) {
    const { error } = await supabase.rpc("ia_custo_salvar", { p_mes: m, p_valor: null, p_requisicoes: null, p_obs: null });
    if (error) setErro(error.message);
    else onSalvo();
  }

  return (
    <Card title="Fatura do Gemini" extra="só administradores · vale para as duas lojas">
      <Automatico a={d.auto} />
      <p className="mb-0 mt-4 text-sm text-body">
        <strong>Lançamento manual (reserva).</strong> Só é usado nos dias sem dado automático. O custo de cada geração é a fatura do mês
        dividida pelas requisições do mês (as do painel do Gemini, se informadas; senão, as gerações que o Pharol registrou).
      </p>
      <form onSubmit={salvar} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Mês
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="min-h-10 rounded-lg border border-line px-3 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Valor (R$)
          <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="5.000,00" className="min-h-10 w-36 rounded-lg border border-line px-3 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Requisições no Gemini (opcional)
          <input inputMode="numeric" value={req} onChange={(e) => setReq(e.target.value)} placeholder="ex.: 12.500" className="min-h-10 w-44 rounded-lg border border-line px-3 text-sm text-ink" />
        </label>
        <button type="submit" disabled={salvando} className="min-h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-60">
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </form>
      {erro && <p role="alert" className="mb-0 mt-2 text-sm text-ruim">{erro}</p>}
      {(d.faturas ?? []).length > 0 && (
        <table className="mt-4 w-full max-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-2 font-semibold">Mês</th>
              <th scope="col" className="p-2 text-right font-semibold">Fatura</th>
              <th scope="col" className="p-2 text-right font-semibold">Requisições<br />(Gemini)</th>
              <th scope="col" className="p-2 text-right font-semibold">Gerações<br />(Pharol)</th>
              <th scope="col" className="p-2 text-right font-semibold">Custo por<br />geração</th>
              <th scope="col" className="py-2 pl-2"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {(d.faturas ?? []).map((f) => {
              const base = f.requisicoes ?? f.geracoes;
              return (
                <tr key={f.mes} className="border-t border-soft">
                  <td className="py-2 pr-2 font-semibold">{nomeMes(f.mes)}</td>
                  <td className="p-2 text-right">{money2(f.valor)}</td>
                  <td className="p-2 text-right">{f.requisicoes ? num(f.requisicoes) : "—"}</td>
                  <td className="p-2 text-right">{num(f.geracoes)}</td>
                  <td className="p-2 text-right font-bold">{base ? money2(f.valor / base) : "—"}</td>
                  <td className="py-2 pl-2 text-right">
                    <button type="button" onClick={() => apagar(f.mes)} className="text-xs font-semibold text-muted hover:text-ruim">apagar</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
