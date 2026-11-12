import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { usePeriod } from "../period-context";
import { useCatalogo, MODELO, CATEGORICAS, OUTROS, roas, type Catalogo as Cat } from "../lib/catalogo";
import { dec, ddmm, money, num } from "../lib/format";
import { Card, Empty, ErrorBox, Loading } from "../components/ui";

// Análises visuais do catálogo por família. Uma escala por gráfico (nunca dois eixos);
// cores categóricas em ordem fixa, seguindo a família (não a posição); legenda sempre que houver 2+ séries.

const ACENTO = "rgb(var(--accent))";
const GASTO = "#eb6834";

/** Caixa de dica que segue o mouse dentro do gráfico. */
function useDica() {
  const [dica, setDica] = useState<{ x: number; y: number; texto: ReactNode } | null>(null);
  const mostrar = (e: MouseEvent, texto: ReactNode) => {
    const r = (e.currentTarget as Element).closest("[data-grafico]")!.getBoundingClientRect();
    setDica({ x: e.clientX - r.left, y: e.clientY - r.top, texto });
  };
  const caixa = dica && (
    <div className="pointer-events-none absolute z-10 max-w-[260px] rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-md"
      style={{ left: dica.x + 12, top: dica.y + 12 }}>
      {dica.texto}
    </div>
  );
  return { mostrar, esconder: () => setDica(null), caixa };
}

function Legenda({ itens }: { itens: { nome: string; cor: string; linha?: boolean }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-body">
      {itens.map((i) => (
        <span key={i.nome} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={i.linha ? "h-[3px] w-4 rounded" : "h-3 w-3 rounded-[3px]"} style={{ background: i.cor }} />
          {i.nome}
        </span>
      ))}
    </div>
  );
}

export function Analises({ store }: { store: string }) {
  const { period } = usePeriod();
  const { data, error } = useCatalogo(store, period.start, period.end);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  if (!data.familias.length) return <Empty>Nenhuma venda nem anúncio no período.</Empty>;
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReceitaGasto d={data} />
        <MapaRetorno d={data} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Modelos d={data} />
        <Concentracao d={data} />
      </div>
      <CrossSell d={data} />
      <Evolucao d={data} />
    </>
  );
}

/** Barras lado a lado: receita real × investimento, top 12 por investimento. */
function ReceitaGasto({ d }: { d: Cat }) {
  const { mostrar, esconder, caixa } = useDica();
  const top = [...d.familias].filter((f) => f.gasto > 0).sort((a, b) => b.gasto - a.gasto).slice(0, 12);
  if (!top.length) return <Card title="Receita × investimento"><Empty>Nenhum anúncio ligado a produto no período.</Empty></Card>;
  const max = Math.max(...top.flatMap((f) => [f.receita, f.gasto]), 1);
  return (
    <Card title="Receita × investimento" extra="12 famílias com mais investimento no Meta">
      <Legenda itens={[{ nome: "Receita Shopify", cor: ACENTO }, { nome: "Investimento Meta", cor: GASTO }]} />
      <div data-grafico className="relative mt-3 space-y-2.5" onMouseLeave={esconder}>
        {top.map((f) => {
          const r = roas(f.receita, f.gasto);
          const texto = (
            <>
              <b>{f.familia} · {f.nome}</b><br />Receita {money(f.receita)} · Investimento {money(f.gasto)}<br />ROAS {r == null ? "—" : `${dec(r, 2)}x`}
            </>
          );
          return (
            <div key={f.familia} className="grid grid-cols-[minmax(0,9rem)_1fr_3.5rem] items-center gap-2 text-[12px]"
              onMouseMove={(e) => mostrar(e, texto)}>
              <span className="truncate font-semibold" title={f.nome}>{f.nome}</span>
              <div className="space-y-[2px]">
                <div className="h-2.5 rounded-r" style={{ width: `${Math.max(0.5, (f.receita / max) * 100)}%`, background: ACENTO }} />
                <div className="h-2.5 rounded-r" style={{ width: `${Math.max(0.5, (f.gasto / max) * 100)}%`, background: GASTO }} />
              </div>
              <span className={`text-right font-semibold ${r != null && r < 1 ? "text-ruim" : ""}`}>{r == null ? "—" : `${dec(r, 1)}x`}</span>
            </div>
          );
        })}
        {caixa}
      </div>
      <p className="mt-3 text-xs text-muted">À direita, o ROAS (receita ÷ investimento). Abaixo de 1x em vermelho.</p>
    </Card>
  );
}

/** Dispersão: investimento (x) × ROAS (y), tamanho = receita. Linha tracejada = ROAS geral. */
function MapaRetorno({ d }: { d: Cat }) {
  const { mostrar, esconder, caixa } = useDica();
  const pts = d.familias.filter((f) => f.gasto > 0).map((f) => ({ ...f, r: roas(f.receita, f.gasto)! }));
  if (pts.length < 2) return <Card title="Mapa de retorno"><Empty>Precisa de 2+ produtos com anúncio no período.</Empty></Card>;
  const W = 520, H = 300, L = 44, B = 30, T = 10, R = 12;
  const maxX = Math.max(...pts.map((p) => p.gasto)) * 1.08;
  const maxY = Math.max(4, Math.min(30, Math.max(...pts.map((p) => p.r)) * 1.1));
  const geral = roas(pts.reduce((s, p) => s + p.receita, 0), pts.reduce((s, p) => s + p.gasto, 0)) ?? 0;
  const x = (v: number) => L + (v / maxX) * (W - L - R);
  const y = (v: number) => T + (1 - Math.min(v, maxY) / maxY) * (H - T - B);
  const maxRec = Math.max(...pts.map((p) => p.receita), 1);
  const rotulos = new Set([...pts].sort((a, b) => b.gasto - a.gasto).slice(0, 5).map((p) => p.familia));
  const ticksY = [0, maxY / 4, maxY / 2, (3 * maxY) / 4, maxY];
  return (
    <Card title="Mapa de retorno" extra="Investimento × ROAS · tamanho = receita">
      <div data-grafico className="relative mt-2" onMouseLeave={esconder}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Investimento por ROAS de cada família">
          {ticksY.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#EEEBE4" />
              <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#8C877D">{dec(v, 0)}x</text>
            </g>
          ))}
          <line x1={L} x2={W - R} y1={y(1)} y2={y(1)} stroke="#B42318" strokeDasharray="2 3" />
          <text x={W - R} y={y(1) - 4} textAnchor="end" fontSize="10" fill="#B42318">1x (empate)</text>
          {geral > 0 && geral < maxY && (
            <>
              <line x1={L} x2={W - R} y1={y(geral)} y2={y(geral)} stroke="#5E5B55" strokeDasharray="5 4" />
              <text x={W - R} y={y(geral) - 4} textAnchor="end" fontSize="10" fill="#5E5B55">média {dec(geral, 1)}x</text>
            </>
          )}
          <text x={(W + L) / 2} y={H - 4} textAnchor="middle" fontSize="10" fill="#8C877D">investimento no Meta →</text>
          <text x={L} y={H - 16} fontSize="10" fill="#8C877D">R$ 0</text>
          <text x={W - R} y={H - 16} textAnchor="end" fontSize="10" fill="#8C877D">{money(maxX)}</text>
          {[...pts].sort((a, b) => b.receita - a.receita).map((p) => (
            <g key={p.familia}
              onMouseMove={(e) => mostrar(e, <><b>{p.familia} · {p.nome}</b><br />Investimento {money(p.gasto)} · Receita {money(p.receita)}<br />ROAS {dec(p.r, 2)}x</>)}>
              <circle cx={x(p.gasto)} cy={y(p.r)} r={4 + Math.sqrt(p.receita / maxRec) * 14} fill={ACENTO} fillOpacity={0.55} stroke="#fff" strokeWidth={2} />
              <circle cx={x(p.gasto)} cy={y(p.r)} r={18} fill="transparent" />
              {rotulos.has(p.familia) && (
                <text x={x(p.gasto)} y={y(p.r) - 8 - Math.sqrt(p.receita / maxRec) * 14} textAnchor="middle" fontSize="10" fontWeight="700" fill="#17171A">
                  {p.nome.length > 18 ? p.nome.slice(0, 17) + "…" : p.nome}
                </text>
              )}
            </g>
          ))}
        </svg>
        {caixa}
      </div>
      <p className="mt-1 text-xs text-muted">Acima e à direita: muito investimento com bom retorno (escalar). Abaixo da linha de 1x: investimento maior que a receita.</p>
    </Card>
  );
}

/** Receita por modelo (todas as famílias). */
function Modelos({ d }: { d: Cat }) {
  const { mostrar, esconder, caixa } = useDica();
  const tot = d.modelos.reduce((s, m) => s + m.receita, 0) || 1;
  const max = Math.max(...d.modelos.map((m) => m.receita), 1);
  return (
    <Card title="O que as pessoas compram" extra="Receita por modelo">
      <div data-grafico className="relative mt-3 space-y-2" onMouseLeave={esconder}>
        {d.modelos.map((m) => (
          <div key={m.letra} className="grid grid-cols-[9rem_1fr_6rem] items-center gap-2 text-[12px]"
            onMouseMove={(e) => mostrar(e, <><b>{MODELO[m.letra] ?? m.modelo}</b><br />{money(m.receita)} · {num(m.unidades)} unidades · {dec((m.receita / tot) * 100, 1)}%</>)}>
            <span className="truncate"><b className="font-mono">{m.letra}</b> · {MODELO[m.letra] ?? m.modelo}</span>
            <div className="h-3 rounded-r" style={{ width: `${Math.max(0.5, (m.receita / max) * 100)}%`, background: ACENTO }} />
            <span className="text-right font-semibold">{money(m.receita)}</span>
          </div>
        ))}
        {caixa}
      </div>
    </Card>
  );
}

/** Quanto da receita vem das maiores famílias (curva de concentração). */
function Concentracao({ d }: { d: Cat }) {
  const ord = [...d.familias].sort((a, b) => b.receita - a.receita);
  const tot = ord.reduce((s, f) => s + f.receita, 0) || 1;
  const faixas = [1, 5, 10, 20, 50].filter((n) => n <= ord.length).map((n) => ({
    n, share: ord.slice(0, n).reduce((s, f) => s + f.receita, 0) / tot,
  }));
  const comVenda = ord.filter((f) => f.receita > 0).length;
  return (
    <Card title="Concentração da receita" extra={`${num(comVenda)} famílias venderam no período`}>
      <ul className="mt-4 space-y-3">
        {faixas.map((f) => (
          <li key={f.n} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-2 text-[13px]">
            <span>Top {f.n} {f.n === 1 ? "família" : "famílias"}</span>
            <div className="h-3 overflow-hidden rounded-full bg-soft"><div className="h-full rounded-full" style={{ width: `${f.share * 100}%`, background: ACENTO }} /></div>
            <span className="text-right font-semibold">{dec(f.share * 100, 0)}%</span>
          </li>
        ))}
      </ul>
      {ord[0] && <p className="mt-4 text-xs text-muted">Maior família: <b className="text-ink">{ord[0].nome}</b> ({money(ord[0].receita)}).</p>}
    </Card>
  );
}

/** Para as famílias com mais investimento: em quais modelos a receita caiu (barra empilhada por modelo). */
function CrossSell({ d }: { d: Cat }) {
  const { mostrar, esconder, caixa } = useDica();
  const top = [...d.familias].filter((f) => f.gasto > 0 && f.receita > 0).sort((a, b) => b.gasto - a.gasto).slice(0, 10);
  const letrasTop = useMemo(() => d.modelos.slice(0, CATEGORICAS.length - 1).map((m) => m.letra), [d.modelos]);
  if (!top.length) return null;
  const cor = (l: string) => (letrasTop.includes(l) ? CATEGORICAS[letrasTop.indexOf(l)] : OUTROS);
  return (
    <Card title="Anunciou a família, vendeu qual modelo?" extra="Receita de cada família dividida por modelo · 10 com mais investimento">
      <Legenda itens={[...letrasTop.map((l) => ({ nome: MODELO[l] ?? l, cor: cor(l) })), { nome: "Outros modelos", cor: OUTROS }]} />
      <div data-grafico className="relative mt-3 space-y-2" onMouseLeave={esconder}>
        {top.map((f) => {
          const partes = d.familia_modelos.filter((m) => m.familia === f.familia).sort((a, b) => b.receita - a.receita);
          return (
            <div key={f.familia} className="grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-2 text-[12px]">
              <span className="truncate font-semibold" title={f.nome}>{f.nome}</span>
              <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded">
                {partes.map((m) => (
                  <div key={m.letra} style={{ width: `${(m.receita / f.receita) * 100}%`, background: cor(m.letra) }}
                    onMouseMove={(e) => mostrar(e, <><b>{f.nome}</b><br />{MODELO[m.letra]}: {money(m.receita)} ({dec((m.receita / f.receita) * 100, 0)}%) · {num(m.unidades)} un.</>)} />
                ))}
              </div>
            </div>
          );
        })}
        {caixa}
      </div>
      <p className="mt-3 text-xs text-muted">Mostra o quanto da venda vem de outros modelos além do anunciado (ex.: anúncio de camiseta que vende oversized e moletom).</p>
    </Card>
  );
}

/** Linhas: receita diária das 6 famílias mais fortes do período. */
function Evolucao({ d }: { d: Cat }) {
  const [hover, setHover] = useState<number | null>(null);
  const dias = useMemo(() => [...new Set(d.dias.map((x) => x.dia))].sort(), [d.dias]);
  const fams = useMemo(() => {
    const tot = new Map<string, number>();
    for (const x of d.dias) tot.set(x.familia, (tot.get(x.familia) ?? 0) + x.receita);
    return [...tot.entries()].sort((a, b) => b[1] - a[1]).slice(0, CATEGORICAS.length).map(([f]) => f);
  }, [d.dias]);
  if (dias.length < 2 || !fams.length) return null;
  const nome = (f: string) => d.familias.find((x) => x.familia === f)?.nome ?? f;
  const val = (f: string, dia: string) => d.dias.find((x) => x.familia === f && x.dia === dia)?.receita ?? 0;
  const W = 900, H = 240, L = 50, B = 22, T = 8, R = 8;
  const max = Math.max(...fams.flatMap((f) => dias.map((dia) => val(f, dia))), 1);
  const x = (i: number) => L + (i / (dias.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const step = Math.max(1, Math.ceil(dias.length / 8));
  return (
    <Card title="Receita por dia das principais famílias" extra={`${fams.length} famílias com mais receita no período`}>
      <Legenda itens={fams.map((f, i) => ({ nome: nome(f), cor: CATEGORICAS[i], linha: true }))} />
      <div className="relative mt-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Receita diária por família"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            setHover(Math.max(0, Math.min(dias.length - 1, Math.round(((px - L) / (W - L - R)) * (dias.length - 1)))));
          }}>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(max * t)} y2={y(max * t)} stroke="#EEEBE4" />
              <text x={L - 6} y={y(max * t) + 4} textAnchor="end" fontSize="10" fill="#8C877D">{money(max * t)}</text>
            </g>
          ))}
          {dias.map((dia, i) => (i % step === 0 || i === dias.length - 1) && (
            <text key={dia} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#8C877D">{ddmm(dia)}</text>
          ))}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#C9C4BA" />}
          {fams.map((f, i) => (
            <polyline key={f} fill="none" stroke={CATEGORICAS[i]} strokeWidth={2} strokeLinejoin="round"
              points={dias.map((dia, j) => `${x(j)},${y(val(f, dia))}`).join(" ")} />
          ))}
          {hover != null && fams.map((f, i) => (
            <circle key={f} cx={x(hover)} cy={y(val(f, dias[hover]))} r={4} fill={CATEGORICAS[i]} stroke="#fff" strokeWidth={2} />
          ))}
        </svg>
        {hover != null && (
          <div className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-md"
            style={{ left: `min(calc(${(x(hover) / W) * 100}% + 12px), calc(100% - 230px))` }}>
            <b>{ddmm(dias[hover])}</b>
            {fams.map((f, i) => (
              <div key={f} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: CATEGORICAS[i] }} />
                <span className="max-w-[140px] truncate">{nome(f)}</span>
                <span className="ml-auto pl-2 font-semibold">{money(val(f, dias[hover]))}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
