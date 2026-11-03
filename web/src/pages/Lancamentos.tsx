import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useStoreParam, nomeLoja } from "../lib/store";
import { useDataVersion } from "../lib/data";
import { supabase } from "../lib/supabase";
import { todaySP } from "../lib/period";
import { ddmm, diaMes, money, num, dec, pct } from "../lib/format";
import { Card, Empty, ErrorBox, Kpi, Loading, PageTitle } from "../components/ui";

type Lancamento = {
  id: number; store: string; nome: string; inicio: string;
  termos_campanha: string[]; termos_produto: string[]; custo_extra: number; nota: string | null;
};
type Dia = {
  dia: string; meta: number; google: number; outros: number; receita_plataforma: number;
  vendas_campanha: number; pedidos_campanha: number; vendas_produto: number; unidades: number; pedidos_produto: number;
};
type Placar = {
  lancamento: Lancamento; fim: string; dias: Dia[];
  clientes_novos_produto: number; clientes_novos_campanha: number;
  campanhas: { platform: string; campaign_id: string; campanha: string; primeiro_dia: string; gasto: number; receita_plataforma: number; compras_plataforma: number; pedidos_shopify: number; vendas_shopify: number }[] | null;
  outras_campanhas: { canal: string; campanha: string; pedidos: number; vendas: number }[] | null;
  produtos: { produto: string; unidades: number; vendas: number; pedidos: number }[] | null;
  canais: { canal: string; pedidos: number; vendas: number }[] | null;
};
type Sugestao = { termo: string; nome: string; inicio: string; gasto: number };
type Previa = {
  campanhas: { platform: string; campanha: string; primeiro_dia: string; gasto: number }[];
  utms: { campanha: string; pedidos: number; primeiro_dia: string }[];
  produtos: { produto: string; status: string }[];
};
type Form = { id?: number; nome: string; inicio: string; termos_campanha: string; termos_produto: string; custo_extra: string; nota: string };

const MARCOS = [0, 1, 3, 7, 14, 30];
const COR_PLAT: Record<string, string> = { meta: "rgb(var(--accent))", google: "#E39A6F" };
const NOME_PLAT: Record<string, string> = { meta: "Meta", google: "Google" };

const lista = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const roas = (v: number, g: number) => (g > 0 ? v / g : 0);
const fmtRoas = (r: number) => (r > 0 ? dec(r, 2) : "—");

/** Soma dos dias 0..n (n = null: todos). */
function acumulado(p: Placar, n: number | null) {
  const dias = n == null ? p.dias : p.dias.slice(0, n + 1);
  const s = { anuncios: 0, vendasProduto: 0, unidades: 0, pedidosProduto: 0, vendasCampanha: 0, pedidosCampanha: 0, receitaPlataforma: 0 };
  for (const d of dias) {
    s.anuncios += d.meta + d.google + d.outros;
    s.vendasProduto += d.vendas_produto;
    s.unidades += d.unidades;
    s.pedidosProduto += d.pedidos_produto;
    s.vendasCampanha += d.vendas_campanha;
    s.pedidosCampanha += d.pedidos_campanha;
    s.receitaPlataforma += d.receita_plataforma;
  }
  const investimento = s.anuncios + Number(p.lancamento.custo_extra || 0);
  const temProduto = p.lancamento.termos_produto.length > 0;
  const vendas = temProduto ? s.vendasProduto : s.vendasCampanha;
  return { ...s, investimento, vendas, roas: roas(vendas, investimento) };
}

function useRpc<T>(fn: string, args: Record<string, unknown> | null, chave: string) {
  const v = useDataVersion();
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    if (!args) { setState({}); return; }
    let vivo = true;
    setState((s) => ({ data: s.data }));
    supabase.rpc(fn, args).then(({ data, error }) => {
      if (!vivo) return;
      setState(error ? { error: error.message } : { data: data as T });
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, chave, v]);
  return state;
}

export function Lancamentos() {
  const store = useStoreParam();
  const [recarga, setRecarga] = useState(0);
  const listaRes = useRpc<Placar[]>("lancamentos_lista", { p_store: store }, `${store}|${recarga}`);
  const sug = useRpc<Sugestao[]>("lancamento_sugestoes", { p_store: store }, `${store}|${recarga}`);
  const [sel, setSel] = useState<number | null>(null);
  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => { setSel(null); setForm(null); }, [store]);
  const itens = listaRes.data ?? [];
  const selecionado = sel ?? itens[0]?.lancamento.id ?? null;

  const novo = (s?: Sugestao) =>
    setForm({
      nome: s?.nome ?? "", inicio: s?.inicio ?? todaySP(),
      termos_campanha: s ? s.termo.replace(/-/g, " ").toLowerCase() : "",
      termos_produto: s ? s.termo.replace(/-/g, " ").toLowerCase() : "",
      custo_extra: "", nota: "",
    });

  const salvo = (id?: number) => { setForm(null); setRecarga((r) => r + 1); if (id) setSel(id); };

  return (
    <>
      <PageTitle
        title={`Lançamentos · ${nomeLoja(store)}`}
        sub="O placar de cada coleção, data ou produto novo desde o dia do lançamento"
        right={!form && <button type="button" onClick={() => novo()} className="min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white">Novo lançamento</button>}
      />

      {form && <Formulario store={store} inicial={form} onCancelar={() => setForm(null)} onSalvo={salvo} />}

      {!form && (sug.data?.length ?? 0) > 0 && (
        <section aria-label="Sugestões" className="rounded-[14px] border border-roxo/30 bg-roxo-claro/25 px-5 py-4">
          <p className="m-0 text-sm font-semibold">Campanhas novas no padrão da esteira que ainda não são lançamentos</p>
          <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
            {sug.data!.map((s) => (
              <li key={s.termo}>
                <button type="button" onClick={() => novo(s)} className="min-h-10 rounded-lg border border-line bg-white px-3 text-left text-[13px] hover:border-roxo">
                  <strong>{s.nome}</strong> <span className="text-muted">· desde {ddmm(s.inicio)} · {money(s.gasto)} investidos</span> <span className="font-semibold text-roxo-texto">Criar</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {listaRes.error && <ErrorBox message={listaRes.error} />}
      {!listaRes.data && !listaRes.error && <Loading />}
      {listaRes.data && itens.length === 0 && !form && (
        <Card>
          <Empty>
            Nenhum lançamento cadastrado. Clique em <strong>Novo lançamento</strong>, dê um nome, a data e as palavras que aparecem no nome das campanhas e dos produtos.
          </Empty>
        </Card>
      )}

      {itens.length > 0 && <Tabela itens={itens} selecionado={selecionado} onSelecionar={setSel} />}

      {selecionado != null && !form && (
        <Detalhe
          id={selecionado}
          recarga={recarga}
          onEditar={(l) => setForm({
            id: l.id, nome: l.nome, inicio: l.inicio, termos_campanha: l.termos_campanha.join(", "),
            termos_produto: l.termos_produto.join(", "), custo_extra: l.custo_extra ? String(l.custo_extra) : "", nota: l.nota ?? "",
          })}
          onExcluido={() => { setSel(null); setRecarga((r) => r + 1); }}
        />
      )}
    </>
  );
}

function Tabela({ itens, selecionado, onSelecionar }: { itens: Placar[]; selecionado: number | null; onSelecionar: (id: number) => void }) {
  return (
    <Card title={`${itens.length} ${itens.length === 1 ? "lançamento" : "lançamentos"}`} extra="vendas acumuladas desde o dia do lançamento">
      <div className="mt-3.5 overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-2 font-semibold">Lançamento</th>
              <th scope="col" className="p-2 text-right font-semibold">D+1</th>
              <th scope="col" className="p-2 text-right font-semibold">D+3</th>
              <th scope="col" className="p-2 text-right font-semibold">D+7</th>
              <th scope="col" className="p-2 text-right font-semibold">Vendas até hoje</th>
              <th scope="col" className="p-2 text-right font-semibold">Investimento</th>
              <th scope="col" className="py-2 pl-2 text-right font-semibold">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((p) => {
              const l = p.lancamento;
              const hoje = p.dias.length - 1;
              const tot = acumulado(p, null);
              const ativo = l.id === selecionado;
              return (
                <tr key={l.id} className={`border-t border-soft ${ativo ? "bg-roxo-claro/30" : "hover:bg-ground"}`}>
                  <td className="py-[11px] pr-2">
                    <button type="button" aria-pressed={ativo} onClick={() => onSelecionar(l.id)} className="text-left">
                      <span className="font-semibold text-ink underline decoration-line underline-offset-4">{l.nome}</span>
                      <span className="mt-0.5 block text-xs text-muted">{ddmm(l.inicio)} · {hoje < 0 ? "começa em breve" : `dia ${hoje}`}</span>
                    </button>
                  </td>
                  {[1, 3, 7].map((n) => (
                    <td key={n} className="p-2 text-right">{n <= hoje ? money(acumulado(p, n).vendas) : <span className="text-xs text-muted">em {n - hoje} {n - hoje === 1 ? "dia" : "dias"}</span>}</td>
                  ))}
                  <td className="p-2 text-right font-semibold">{money(tot.vendas)}</td>
                  <td className="p-2 text-right">{money(tot.investimento)}</td>
                  <td className={`py-2 pl-2 text-right font-bold ${tot.roas >= 2 ? "text-bom" : tot.roas > 0 && tot.roas < 1 ? "text-ruim" : ""}`}>{fmtRoas(tot.roas)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mb-0 mt-3 text-xs text-muted">Vendas = itens vendidos dos produtos do lançamento, em qualquer canal. Se o lançamento não tem produtos definidos, vale a venda que veio pelas campanhas dele.</p>
    </Card>
  );
}

function Detalhe({ id, recarga, onEditar, onExcluido }: { id: number; recarga: number; onEditar: (l: Lancamento) => void; onExcluido: () => void }) {
  const { data, error } = useRpc<Placar>("lancamento_placar", { p_id: id, p_detalhe: true }, `${id}|${recarga}`);
  const [confirmar, setConfirmar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => setConfirmar(false), [id]);

  if (error) return <ErrorBox message={error} />;
  if (!data || data.lancamento.id !== id) return <Loading />;

  const l = data.lancamento;
  const hoje = data.dias.length - 1;
  const tot = acumulado(data, null);
  const temProduto = l.termos_produto.length > 0;
  const temCampanha = l.termos_campanha.length > 0;
  const linhas = [...MARCOS.filter((n) => n < hoje), hoje].filter((n, i, a) => n >= 0 && a.indexOf(n) === i);
  const futuros = MARCOS.filter((n) => n > hoje);

  const excluir = async () => {
    const { error: e } = await supabase.from("lancamentos").delete().eq("id", l.id);
    if (e) setErro(e.message); else onExcluido();
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-6">
        <div>
          <h2 className="m-0 text-[24px] font-extrabold tracking-tight">{l.nome}</h2>
          <p className="mb-0 mt-1 text-sm text-muted">
            Lançado em {diaMes(l.inicio)} · {hoje < 0 ? "ainda não começou" : `dia ${hoje}`}
            {hoje >= 89 && " · placar dos primeiros 90 dias"}
            {l.nota && <> · {l.nota}</>}
          </p>
          <p className="mb-0 mt-1.5 text-xs text-muted">
            {temCampanha && <>Campanhas com <Termos t={l.termos_campanha} /></>}
            {temCampanha && temProduto && " · "}
            {temProduto && <>Produtos com <Termos t={l.termos_produto} /></>}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => onEditar(l)} className="min-h-10 rounded-lg border border-line bg-white px-4 text-sm font-semibold hover:bg-ground">Editar</button>
          {confirmar ? (
            <>
              <button type="button" onClick={excluir} className="min-h-10 rounded-lg bg-ruim px-4 text-sm font-semibold text-white">Confirmar exclusão</button>
              <button type="button" onClick={() => setConfirmar(false)} className="min-h-10 rounded-lg border border-line bg-white px-4 text-sm font-semibold">Cancelar</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmar(true)} className="min-h-10 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ruim hover:bg-ground">Excluir</button>
          )}
        </div>
      </div>
      {erro && <ErrorBox message={erro} />}

      {hoje < 0 ? (
        <Card><Empty>O lançamento começa em {diaMes(l.inicio)}. O placar aparece a partir do primeiro dia.</Empty></Card>
      ) : (
        <>
          <section aria-label="Indicadores do lançamento" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
            <Kpi label="Investimento" value={money(tot.investimento)} sub={l.custo_extra ? `${money(tot.anuncios)} em anúncios + ${money(Number(l.custo_extra))} de outros custos` : "em anúncios das campanhas do lançamento"} />
            {temProduto && <Kpi label="Vendas dos produtos" value={money(tot.vendasProduto)} sub={`${num(tot.unidades)} unidades · ${num(tot.pedidosProduto)} pedidos · qualquer canal`} />}
            {temCampanha && <Kpi label="Vendas pelas campanhas" value={money(tot.vendasCampanha)} sub={`${num(tot.pedidosCampanha)} pedidos · último clique na campanha`} />}
            <Kpi label={temProduto ? "ROAS (vendas dos produtos)" : "ROAS (vendas das campanhas)"} value={fmtRoas(tot.roas)} sub={tot.roas ? `R$ ${dec(tot.roas, 2)} vendidos por R$ 1 investido` : undefined} />
          </section>

          <Card title="Placar" extra="acumulado desde o dia do lançamento (D0)">
            <div className="mt-3.5 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="py-2 pr-2 font-semibold">Até</th>
                    <th scope="col" className="p-2 text-right font-semibold">Investimento</th>
                    {temProduto && <th scope="col" className="p-2 text-right font-semibold">Vendas dos produtos</th>}
                    {temProduto && <th scope="col" className="p-2 text-right font-semibold">Unidades</th>}
                    {temCampanha && <th scope="col" className="p-2 text-right font-semibold">Vendas pelas campanhas</th>}
                    <th scope="col" className="p-2 text-right font-semibold">ROAS</th>
                    {temCampanha && <th scope="col" className="py-2 pl-2 text-right font-semibold">ROAS plataforma</th>}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((n) => {
                    const a = acumulado(data, n);
                    const ehHoje = n === hoje;
                    return (
                      <tr key={n} className="border-t border-soft">
                        <th scope="row" className="py-[11px] pr-2 text-left font-semibold">
                          {n === 0 ? "D0" : `D+${n}`} <span className="font-normal text-muted">· {ddmm(data.dias[n].dia)}{ehHoje && n > 0 ? " · hoje" : ""}</span>
                        </th>
                        <td className="p-2 text-right">{money(a.investimento)}</td>
                        {temProduto && <td className="p-2 text-right font-semibold">{money(a.vendasProduto)}</td>}
                        {temProduto && <td className="p-2 text-right">{num(a.unidades)}</td>}
                        {temCampanha && <td className="p-2 text-right">{money(a.vendasCampanha)} <span className="text-xs text-muted">· {num(a.pedidosCampanha)}</span></td>}
                        <td className="p-2 text-right font-bold">{fmtRoas(a.roas)}</td>
                        {temCampanha && <td className="py-2 pl-2 text-right text-body">{fmtRoas(roas(a.receitaPlataforma, a.anuncios))}</td>}
                      </tr>
                    );
                  })}
                  {futuros.map((n) => (
                    <tr key={`f${n}`} className="border-t border-soft text-muted">
                      <th scope="row" className="py-[11px] pr-2 text-left font-semibold">D+{n}</th>
                      <td colSpan={6} className="p-2 text-xs">em {n - hoje} {n - hoje === 1 ? "dia" : "dias"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mb-0 mt-3 text-xs text-muted">
              D+7 soma do dia do lançamento até 7 dias depois. {temProduto && "Vendas dos produtos contam os itens do lançamento em qualquer pedido, de qualquer canal. "}
              {temCampanha && "Vendas pelas campanhas contam o pedido inteiro quando o último clique veio de uma campanha do lançamento."}
            </p>
          </Card>

          <Grafico p={data} temProduto={temProduto} />

          <div className="flex flex-wrap items-start gap-6">
            {(data.campanhas?.length ?? 0) > 0 && (
              <Card className="flex-[1_1_520px]" title="Campanhas do lançamento">
                <div className="mt-3.5 overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th scope="col" className="py-2 pr-2 font-semibold">Campanha</th>
                        <th scope="col" className="p-2 text-right font-semibold">Investimento</th>
                        <th scope="col" className="p-2 text-right font-semibold">Vendas Shopify</th>
                        <th scope="col" className="py-2 pl-2 text-right font-semibold">Vendas plataforma</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.campanhas!.map((c) => (
                        <tr key={`${c.platform}-${c.campaign_id}`} className="border-t border-soft align-top">
                          <td className="py-[11px] pr-2">
                            <div className="font-semibold"><span aria-hidden="true" className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COR_PLAT[c.platform] ?? "#8C877D" }} />{c.campanha}</div>
                            <div className="mt-0.5 text-xs text-muted">{NOME_PLAT[c.platform] ?? c.platform} · desde {ddmm(c.primeiro_dia)}</div>
                          </td>
                          <td className="p-2 text-right font-semibold">{money(c.gasto)}</td>
                          <td className="p-2 text-right">{money(c.vendas_shopify)} <span className="text-xs text-muted">· {num(c.pedidos_shopify)}</span></td>
                          <td className="py-2 pl-2 text-right text-body">{money(c.receita_plataforma)} <span className="text-xs text-muted">· ROAS {fmtRoas(roas(c.receita_plataforma, c.gasto))}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {(data.produtos?.length ?? 0) > 0 && (
              <Card className="flex-[1_1_400px]" title={`Produtos (${data.produtos!.length})`}>
                <ol className="m-0 mt-3.5 list-none p-0">
                  {data.produtos!.slice(0, 15).map((pr) => (
                    <li key={pr.produto} className="flex items-center gap-3 border-t border-soft py-[11px]">
                      <div className="min-w-0 flex-auto truncate text-sm font-semibold" title={pr.produto}>{pr.produto}</div>
                      <div className="whitespace-nowrap text-right text-sm"><strong>{money(pr.vendas)}</strong> <span className="text-xs text-muted">· {num(pr.unidades)} un.</span></div>
                    </li>
                  ))}
                </ol>
              </Card>
            )}
          </div>

          {((data.canais?.length ?? 0) > 0 || (data.outras_campanhas?.length ?? 0) > 0) && (
            <div className="flex flex-wrap items-start gap-6">
              {(data.canais?.length ?? 0) > 0 && (
                <Card className="flex-[1_1_400px]" title="De onde vieram as vendas dos produtos" extra="último clique">
                  <ul className="m-0 mt-3.5 list-none p-0">
                    {data.canais!.map((c) => (
                      <li key={c.canal} className="flex items-center gap-3 border-t border-soft py-[11px] text-sm">
                        <span className="flex-auto font-semibold">{c.canal}</span>
                        <span className="text-muted">{num(c.pedidos)} ped.</span>
                        <span className="w-24 text-right font-semibold">{money(c.vendas)}</span>
                        <span className="w-12 text-right text-xs text-muted">{tot.vendasProduto ? pct((c.vendas / tot.vendasProduto) * 100, 0) : ""}</span>
                      </li>
                    ))}
                  </ul>
                  {temProduto && tot.pedidosProduto > 0 && (
                    <p className="mb-0 mt-3 text-xs text-muted">{pct((data.clientes_novos_produto / tot.pedidosProduto) * 100, 0)} dos pedidos com produtos do lançamento foram de clientes novos.</p>
                  )}
                </Card>
              )}
              {(data.outras_campanhas?.length ?? 0) > 0 && (
                <Card className="flex-[1_1_400px]" title="Links UTM do lançamento" extra="WhatsApp, e-mail, push…">
                  <ul className="m-0 mt-3.5 list-none p-0">
                    {data.outras_campanhas!.map((c) => (
                      <li key={`${c.canal}-${c.campanha}`} className="flex items-center gap-3 border-t border-soft py-[11px] text-sm">
                        <span className="min-w-0 flex-auto">
                          <span className="block font-semibold">{c.canal}</span>
                          <code className="block truncate text-xs text-muted">{c.campanha}</code>
                        </span>
                        <span className="text-muted">{num(c.pedidos)} ped.</span>
                        <span className="w-24 text-right font-semibold">{money(c.vendas)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

function Termos({ t }: { t: string[] }) {
  return <>{t.map((x, i) => <span key={x}>{i > 0 && ", "}<strong className="font-semibold text-body">“{x}”</strong></span>)}</>;
}

function Grafico({ p, temProduto }: { p: Placar; temProduto: boolean }) {
  const dias = p.dias;
  if (dias.length < 2) return null;
  const venda = (d: Dia) => (temProduto ? d.vendas_produto : d.vendas_campanha);
  const gasto = (d: Dia) => d.meta + d.google + d.outros;
  const max = Math.max(...dias.map((d) => Math.max(venda(d), gasto(d))), 1);
  const step = Math.max(1, Math.ceil(dias.length / 10));
  return (
    <Card
      title="Dia a dia"
      extra={
        <span className="flex flex-wrap gap-4">
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[3px] bg-roxo" />{temProduto ? "Vendas dos produtos" : "Vendas pelas campanhas"}</span>
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[3px] bg-laranja" />Investimento</span>
        </span>
      }
    >
      <div className="mt-[18px] overflow-x-auto">
        <div style={{ minWidth: `${Math.max(480, dias.length * 22)}px` }}>
          <div className="flex h-[180px] items-end gap-1.5 border-b border-[#D6D1C7]">
            {dias.map((d, i) => (
              <div key={d.dia} className="flex h-full flex-1 items-end justify-center gap-px" title={`D${i ? `+${i}` : "0"} (${ddmm(d.dia)}): vendas ${money(venda(d))} · investimento ${money(gasto(d))}`}>
                <div className="w-1/2 max-w-[14px] rounded-t bg-roxo" style={{ height: `${Math.round((venda(d) / max) * 170)}px` }} />
                <div className="w-1/2 max-w-[14px] rounded-t bg-laranja" style={{ height: `${Math.round((gasto(d) / max) * 170)}px` }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            {dias.map((d, i) => (
              <div key={d.dia} className="flex-1 whitespace-nowrap text-center text-[11px] text-muted">{i % step === 0 || i === dias.length - 1 ? (i === 0 ? "D0" : `D+${i}`) : ""}</div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Formulario({ store, inicial, onCancelar, onSalvo }: { store: string; inicial: Form; onCancelar: () => void; onSalvo: (id?: number) => void }) {
  const [f, setF] = useState<Form>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  // prévia do que os termos pegam (espera o usuário parar de digitar)
  const tc = useMemo(() => lista(f.termos_campanha), [f.termos_campanha]);
  const tp = useMemo(() => lista(f.termos_produto), [f.termos_produto]);
  const [previa, setPrevia] = useState<Previa | null>(null);
  useEffect(() => {
    let vivo = true;
    const t = window.setTimeout(() => {
      supabase.rpc("lancamento_previa", { p_store: store, p_termos_campanha: tc, p_termos_produto: tp })
        .then(({ data }) => { if (vivo) setPrevia(data as Previa); });
    }, 500);
    return () => { vivo = false; window.clearTimeout(t); };
  }, [store, tc.join("|"), tp.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const pronto = f.nome.trim() && f.inicio && (tc.length > 0 || tp.length > 0);

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!pronto) return;
    setSalvando(true);
    setErro(null);
    const linha = {
      store, nome: f.nome.trim(), inicio: f.inicio, termos_campanha: tc, termos_produto: tp,
      custo_extra: Number(f.custo_extra.replace(/\./g, "").replace(",", ".")) || 0,
      nota: f.nota.trim() || null, updated_at: new Date().toISOString(),
    };
    const res = f.id
      ? await supabase.from("lancamentos").update(linha).eq("id", f.id).select("id").single()
      : await supabase.from("lancamentos").insert(linha).select("id").single();
    setSalvando(false);
    if (res.error) setErro(res.error.message);
    else onSalvo((res.data as { id: number }).id);
  };

  const inp = "min-h-10 w-full rounded-lg border border-line px-3";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title={f.id ? "Editar lançamento" : "Novo lançamento"}>
        <form onSubmit={salvar} className="mt-4 flex flex-col gap-4">
          <Campo label="Nome">
            <input required value={f.nome} onChange={set("nome")} placeholder="ex.: Black Friday 2026" className={inp} />
          </Campo>
          <Campo label="Dia do lançamento (D0)">
            <input required type="date" value={f.inicio} onChange={set("inicio")} className={inp} />
          </Campo>
          <Campo label="Palavras no nome das campanhas" ajuda="Separe por vírgula. Vale para anúncios do Meta e do Google e para links UTM (utm_campaign). Maiúsculas, acentos, espaços e hífens não importam.">
            <input value={f.termos_campanha} onChange={set("termos_campanha")} placeholder="ex.: black friday, bf2026" className={inp} />
          </Campo>
          <Campo label="Palavras no nome dos produtos" ajuda="Separe por vírgula. Conta os itens vendidos desses produtos em qualquer canal. Deixe vazio para medir só pelas campanhas.">
            <input value={f.termos_produto} onChange={set("termos_produto")} placeholder="ex.: lugares do meu gato" className={inp} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Outros custos (R$, opcional)" ajuda="Influenciador, amostras, produção…">
              <input inputMode="decimal" value={f.custo_extra} onChange={set("custo_extra")} placeholder="0" className={inp} />
            </Campo>
            <Campo label="Anotação (opcional)">
              <input value={f.nota} onChange={set("nota")} className={inp} />
            </Campo>
          </div>
          {erro && <p role="alert" className="m-0 text-sm text-ruim">Não deu para salvar: {erro}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={!pronto || salvando} className="min-h-11 rounded-lg bg-ink px-5 font-semibold text-white disabled:opacity-50">
              {salvando ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" onClick={onCancelar} className="min-h-11 rounded-lg border border-line px-5 font-semibold hover:bg-ground">Cancelar</button>
          </div>
          {!pronto && <p className="m-0 text-xs text-muted">Preencha o nome, a data e pelo menos uma palavra de campanha ou de produto.</p>}
        </form>
      </Card>

      <Card title="O que entra no lançamento" className="lg:self-start">
        {!previa ? (
          <Empty>Digite as palavras para ver o que elas pegam.</Empty>
        ) : (
          <div className="mt-3 flex flex-col gap-4 text-sm">
            <Bloco titulo="Campanhas de anúncio" vazio={tc.length ? "Nenhuma campanha com essas palavras." : "Sem palavras de campanha."} n={previa.campanhas.length}>
              {previa.campanhas.map((c) => (
                <li key={`${c.platform}${c.campanha}`} className="flex gap-2 py-1.5">
                  <span aria-hidden="true" className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COR_PLAT[c.platform] ?? "#8C877D" }} />
                  <span className="min-w-0 flex-auto">{c.campanha} <span className="text-xs text-muted">· desde {ddmm(c.primeiro_dia)} · {money(c.gasto)}</span></span>
                  {c.primeiro_dia < f.inicio && <span className="shrink-0 text-xs font-semibold text-laranja">antes do D0</span>}
                </li>
              ))}
            </Bloco>
            <Bloco titulo="utm_campaign em pedidos" vazio={tc.length ? "Nenhum pedido com essas palavras na UTM." : "Sem palavras de campanha."} n={previa.utms.length}>
              {previa.utms.map((u) => (
                <li key={u.campanha} className="py-1.5"><code className="break-all text-[13px]">{u.campanha}</code> <span className="text-xs text-muted">· {num(u.pedidos)} pedidos desde {ddmm(u.primeiro_dia)}</span></li>
              ))}
            </Bloco>
            <Bloco titulo="Produtos" vazio={tp.length ? "Nenhum produto com essas palavras." : "Sem palavras de produto."} n={previa.produtos.length}>
              {previa.produtos.map((p) => (
                <li key={p.produto} className="py-1.5">{p.produto} {p.status !== "ACTIVE" && <span className="text-xs text-muted">· {p.status === "DRAFT" ? "rascunho" : p.status === "vendido" ? "fora do catálogo" : p.status.toLowerCase()}</span>}</li>
              ))}
            </Bloco>
          </div>
        )}
      </Card>
    </div>
  );
}

function Bloco({ titulo, vazio, n, children }: { titulo: string; vazio: string; n: number; children: ReactNode }) {
  return (
    <div>
      <h3 className="m-0 text-[13px] font-bold text-muted">{titulo}{n > 0 && ` (${n}${n >= 30 ? "+" : ""})`}</h3>
      {n === 0 ? <p className="m-0 mt-1.5 text-[13px] text-muted">{vazio}</p> : <ul className="m-0 mt-1 max-h-56 list-none overflow-y-auto p-0">{children}</ul>}
    </div>
  );
}

function Campo({ label, ajuda, children }: { label: string; ajuda?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-semibold">{label}</span>
      {children}
      {ajuda && <span className="mt-1 block text-xs text-muted">{ajuda}</span>}
    </label>
  );
}
