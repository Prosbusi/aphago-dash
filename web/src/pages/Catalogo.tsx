import { Fragment, useMemo, useState } from "react";
import { usePeriod } from "../period-context";
import { useCatalogo, MODELO, roas, type Catalogo as Cat, type FamiliaCat, type ProdutoCat } from "../lib/catalogo";
import { dec, money, money2, num } from "../lib/format";
import { Card, Empty, ErrorBox, Kpi, Loading, ShareBar } from "../components/ui";

// Catálogo: famílias de produto ranqueadas por investimento, receita, ROAS...
// Gasto: anúncios do Meta com o código (AP0091) ou a tag antiga (EUS) entre parênteses no nome.
// Receita e unidades: vendas reais da Shopify (linhas dos pedidos, sem cancelados), somando todos os modelos da família.

type Ordem = "gasto" | "receita" | "roas" | "unidades" | "cac";
const ORDENS: [Ordem, string][] = [["gasto", "Investimento"], ["receita", "Receita"], ["roas", "ROAS"], ["unidades", "Unidades"], ["cac", "CAC"]];
const fmtRoas = (r: number | null) => (r == null ? "—" : `${dec(r, 2)}x`);

export function Catalogo({ store }: { store: string }) {
  const { period } = usePeriod();
  const { data, error } = useCatalogo(store, period.start, period.end);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  return <Conteudo d={data} />;
}

function Conteudo({ d }: { d: Cat }) {
  const [ordem, setOrdem] = useState<Ordem>("gasto");
  const [busca, setBusca] = useState("");
  const [todos, setTodos] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const t = d.totais;

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const val = (f: FamiliaCat) =>
      ordem === "roas" ? roas(f.receita, f.gasto) ?? -1 : ordem === "cac" ? (f.unidades ? f.gasto / f.unidades : Infinity) : f[ordem];
    return d.familias
      .filter((f) => todos || f.gasto > 0)
      .filter((f) => !q || `${f.familia} ${f.nome}`.toLowerCase().includes(q))
      .sort((a, b) => (ordem === "cac" ? val(a) - val(b) : val(b) - val(a)));
  }, [d.familias, ordem, busca, todos]);
  const maxGasto = Math.max(...lista.map((f) => f.gasto), 1);
  // produtos vendidos de cada família (já vêm do mais vendido para o menos vendido)
  const porFamilia = useMemo(() => {
    const m = new Map<string, ProdutoCat[]>();
    for (const p of d.produtos) m.set(p.familia, [...(m.get(p.familia) ?? []), p]);
    return m;
  }, [d.produtos]);
  const th = "p-2 text-right font-semibold";

  return (
    <>
      <section aria-label="Resumo" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <Kpi label="Investimento Meta" value={money(t.gasto_meta)} sub={`${money(t.gasto_familia)} ligado a produtos`} />
        <Kpi label="Receita Shopify (produtos)" value={money(t.receita)} sub={`${num(t.pedidos)} pedidos`} />
        <Kpi label="Unidades" value={num(t.unidades)} />
        <Kpi label="ROAS geral (Meta)" value={fmtRoas(roas(t.receita, t.gasto_meta))} sub="receita ÷ investimento Meta" />
      </section>
      <p className="-mt-1 text-[13px] text-muted">
        Só o anúncio com o código entre parênteses no nome (ex.: <b className="text-ink">Criativo 03 (AP0091)</b>) ou a tag antiga (ex.: (EUS)) tem o
        investimento ligado ao produto. Genérico (ALL): <b className="text-ink">{money(t.gasto_all)}</b> · sem código no nome:{" "}
        <b className="text-ink">{money(t.gasto_sem_familia)}</b>. Google Ads ({money(t.gasto_google)}) ainda não entra por produto.
      </p>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar código ou produto"
            aria-label="Buscar código ou produto" className="min-h-10 w-full max-w-xs rounded-lg border border-line px-3 text-sm" />
          <button type="button" aria-pressed={todos} onClick={() => setTodos((x) => !x)}
            className={`min-h-9 rounded-[8px] border border-line px-3 text-[13px] font-semibold ${todos ? "bg-ink text-white" : "hover:bg-soft"}`}>
            {todos ? "Mostrando todos os produtos" : "Mostrar produtos sem anúncio"}
          </button>
          <label className="ml-auto flex items-center gap-2 text-[13px] text-muted">Ordenar por
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} className="min-h-9 rounded-[8px] border border-line bg-white px-2 text-ink">
              {ORDENS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
        </div>

        {lista.length === 0 ? <Empty>Nenhum produto com anúncio ligado no período.</Empty> : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-2 font-semibold">Família</th>
                  <th scope="col" className="p-2 font-semibold">Produto</th>
                  <th scope="col" className={th}>Anúncios</th>
                  <th scope="col" className={`${th} w-[13%]`}>Investimento</th>
                  <th scope="col" className={th}>Cliques</th>
                  <th scope="col" className={th}>Compras Meta</th>
                  <th scope="col" className={th}>Unidades</th>
                  <th scope="col" className={th}>Receita</th>
                  <th scope="col" className={th}>ROAS</th>
                  <th scope="col" className={th}>CAC</th>
                  <th scope="col" className={`${th} pr-0`}>Ticket</th>
                </tr>
              </thead>
              <tbody>
                {lista.slice(0, 200).map((f) => {
                  const r = roas(f.receita, f.gasto);
                  const open = aberta === f.familia;
                  const prods = porFamilia.get(f.familia) ?? [];
                  const capa = prods.find((p) => p.image_url)?.image_url ?? f.imagem;
                  const unico = prods.length === 1 ? prods[0] : null;
                  return (
                    <Fragment key={f.familia}>
                      <tr className="cursor-pointer border-t border-soft hover:bg-soft/40" onClick={() => setAberta(open ? null : f.familia)}>
                        <td className="py-2.5 pr-2"><span className="rounded-md border border-line bg-soft px-2 py-0.5 font-mono text-[12px] font-bold">{f.familia}</span></td>
                        <td className="p-2">
                          <div className="flex items-center gap-2.5">
                            <span aria-hidden="true" className="w-3 text-[11px] text-muted">{prods.length > 1 ? (open ? "▾" : "▸") : ""}</span>
                            {capa ? <img src={capa} alt="" loading="lazy" className="h-10 w-10 rounded-md object-cover" /> : <span className="h-10 w-10 rounded-md bg-soft" />}
                            <div className="min-w-0">
                              <div className="font-semibold">{f.nome}</div>
                              <div className="truncate text-xs text-muted">
                                {prods.length > 1
                                  ? `${prods.length} produtos vendidos no período · clique para ${open ? "recolher" : "ver"}`
                                  : unico?.online_url ? unico.online_url.replace(/^https?:\/\//, "") : f.modelos.split("").map((l) => MODELO[l] ?? l).join(" · ")}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-2 text-right">{f.anuncios || "—"}</td>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            <ShareBar value={f.gasto} max={maxGasto} />
                            <span className="w-[5.5rem] text-right">{f.gasto ? money2(f.gasto) : "—"}</span>
                          </div>
                        </td>
                        <td className="p-2 text-right">{f.cliques ? num(f.cliques) : "—"}</td>
                        <td className="p-2 text-right">{f.compras_meta ? num(Math.round(f.compras_meta)) : "—"}</td>
                        <td className="p-2 text-right">{num(f.unidades)}</td>
                        <td className="p-2 text-right font-semibold">{money2(f.receita)}</td>
                        <td className={`p-2 text-right font-semibold ${r == null ? "text-muted" : r < 1 ? "text-ruim" : ""}`}>{fmtRoas(r)}</td>
                        <td className="p-2 text-right">{f.gasto && f.unidades ? money2(f.gasto / f.unidades) : "—"}</td>
                        <td className="py-2 pl-2 text-right">{f.pedidos ? money2(f.receita / f.pedidos) : "—"}</td>
                      </tr>
                      {open && prods.length > 1 && prods.map((p) => {
                        // investimento, cliques e compras da família divididos pela receita de cada produto
                        const parte = f.receita > 0 ? p.receita / f.receita : 0;
                        const g = f.gasto * parte;
                        return (
                          <tr key={p.product_id} className="border-t border-soft bg-soft/30 text-[13px]">
                            <td className="py-2 pr-2 text-center text-muted">↳</td>
                            <td className="p-2">
                              <div className="flex items-center gap-2.5 pl-5">
                                {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="h-9 w-9 rounded-md object-cover" /> : <span className="h-9 w-9 rounded-md bg-soft" />}
                                <div className="min-w-0">
                                  <div className="font-semibold">{p.title}</div>
                                  {p.online_url && (
                                    <a href={p.online_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                                      className="block max-w-[340px] truncate text-xs text-muted hover:underline">{p.online_url.replace(/^https?:\/\//, "")}</a>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="p-2 text-right text-muted">—</td>
                            <td className="p-2 text-right">{g ? money2(g) : "—"}</td>
                            <td className="p-2 text-right">{f.cliques ? dec(f.cliques * parte, 1) : "—"}</td>
                            <td className="p-2 text-right">{f.compras_meta ? dec(f.compras_meta * parte, 1) : "—"}</td>
                            <td className="p-2 text-right">{num(p.unidades)}</td>
                            <td className="p-2 text-right font-semibold">{money2(p.receita)}</td>
                            <td className="p-2 text-right">{fmtRoas(r)}</td>
                            <td className="p-2 text-right">{g && p.unidades ? money2(g / p.unidades) : "—"}</td>
                            <td className="py-2 pl-2 text-right">{p.pedidos ? money2(p.receita / p.pedidos) : "—"}</td>
                          </tr>
                        );
                      })}
                      {open && (
                        <tr className="bg-soft/30">
                          <td colSpan={11} className="px-2 pb-3 pt-2"><Detalhe f={f} d={d} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {lista.length > 200 && <p className="mt-2 text-[13px] text-muted">Mostrando 200 de {num(lista.length)}. Use a busca.</p>}
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          ROAS = receita real na Shopify ÷ investimento no Meta. CAC = investimento ÷ unidades. A receita soma todos os modelos da família:
          quem clica no anúncio da camiseta e compra o oversized conta para a mesma família. Nos produtos de cada família, o investimento,
          os cliques e as compras do Meta são divididos pela receita de cada um (o ROAS fica igual ao da família).
        </p>
      </Card>
    </>
  );
}

function Detalhe({ f, d }: { f: FamiliaCat; d: Cat }) {
  const mods = d.familia_modelos.filter((m) => m.familia === f.familia).sort((a, b) => b.receita - a.receita);
  const canais = d.canais.filter((c) => c.familia === f.familia).sort((a, b) => b.valor - a.valor).slice(0, 6);
  const maxM = Math.max(...mods.map((m) => m.receita), 1);
  const totC = canais.reduce((s, c) => s + c.valor, 0) || 1;
  return (
    <div className="grid gap-4 rounded-[10px] border border-line bg-white p-4 md:grid-cols-2">
      <div>
        <h3 className="m-0 text-[13px] font-bold">O que foi comprado (por modelo)</h3>
        {mods.length === 0 ? <p className="mt-2 text-[13px] text-muted">Sem vendas no período.</p> : (
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {mods.map((m) => (
              <li key={m.letra} className="flex items-center gap-2">
                <span className="w-40 truncate">{f.familia}-{m.letra} · {MODELO[m.letra]}</span>
                <ShareBar value={m.receita} max={maxM} />
                <span className="w-24 text-right font-semibold">{money(m.receita)}</span>
                <span className="w-14 text-right text-muted">{num(m.unidades)} un.</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="m-0 text-[13px] font-bold">De onde vieram as vendas (atribuição linear)</h3>
        {canais.length === 0 ? <p className="mt-2 text-[13px] text-muted">Sem vendas no período.</p> : (
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {canais.map((c) => (
              <li key={c.canal} className="flex items-center gap-2">
                <span className="w-36 truncate">{c.canal}</span>
                <ShareBar value={c.valor} max={totC} />
                <span className="w-24 text-right font-semibold">{money(c.valor)}</span>
                <span className="w-14 text-right text-muted">{dec((c.valor / totC) * 100, 0)}%</span>
              </li>
            ))}
          </ul>
        )}
        {f.gasto > 0 && (
          <p className="mt-3 text-xs text-muted">
            Meta diz {num(Math.round(f.compras_meta))} compras ({money(f.receita_meta)}); a Shopify registrou {num(f.pedidos)} pedidos com esta família
            ({money(f.receita)}), vindos de qualquer canal.
          </p>
        )}
      </div>
    </div>
  );
}
