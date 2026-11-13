import { useState, type FormEvent } from "react";
import { useAuth } from "../../auth";
import { supabase } from "../../lib/supabase";
import { dataCurta, emailAtual, useTabela, IDEIA_MARCAS, TEMAS, type Colecao, type Ideia, type Modelo, type Pessoa, type Produto } from "../../lib/time";
import { Card, Empty, ErrorBox, Loading, PageTitle } from "../../components/ui";
import { CampoImagens, Chip, Miniaturas, RecadoBox, Rotulo, Texto, btnPrim, btnSec, inputCls, type Recado } from "../../components/time";
import { FormProduto, produtoVazio } from "./Produtos";
import { ACCENT } from "../../components/Layout";

const LOJAS = [{ marca: "AP" as const, nome: "Aphago", area: "aphago" }, { marca: "AB" as const, nome: "Abrasso", area: "abrasso" }];
const btnLoja = "min-h-10 rounded-lg bg-roxo px-4 text-sm font-semibold text-white hover:bg-roxo-escuro disabled:opacity-60";

type Rascunho = { id?: string; marca: Ideia["marca"]; titulo: string; resumo: string; descricao: string; imagens: string[]; temas: string[] };

/** Título e resumo da ideia; ideias antigas (só descrição) usam a 1ª e a 2ª linha. */
const tituloDe = (i: Ideia) => i.titulo || i.descricao.split("\n")[0] || i.temas.join(", ");
const resumoDe = (i: Ideia) => i.resumo || (i.titulo ? "" : i.descricao.split("\n").slice(1).join(" ").trim());

export function Ideias() {
  const ideias = useTabela<Ideia>("ideias", "created_at", false);
  const produtos = useTabela<Produto>("produtos_criacao", "created_at", false);
  const modelos = useTabela<Modelo>("modelos", "posicao");
  const colecoes = useTabela<Colecao>("colecoes", "created_at");
  const pessoas = useTabela<Pessoa>("equipe", "created_at");
  const [form, setForm] = useState<Rascunho | null>(null);
  const [converter, setConverter] = useState<Ideia | null>(null);
  const [tema, setTema] = useState("todos");
  const [aba, setAba] = useState<"AP" | "AB">("AP");
  const loja = LOJAS.find((l) => l.marca === aba)!;
  const [recado, setRecado] = useState<Recado>(null);

  const erro = ideias.error || produtos.error || modelos.error || colecoes.error || pessoas.error;
  const todosTemas = [...new Set([...TEMAS, ...(ideias.data ?? []).flatMap((i) => i.temas)])];
  // ideias "Ambas" aparecem nas duas abas
  const daLoja = (ideias.data ?? []).filter((i) => i.marca === aba || i.marca === "BOTH");
  const lista = daLoja.filter((i) => tema === "todos" || i.temas.includes(tema));

  const pronto = (texto: string, tipo: "ok" | "aviso" = "ok") => {
    setForm(null); setConverter(null); setRecado({ tipo, texto }); ideias.recarregar(); produtos.recarregar();
  };

  return (
    <>
      <PageTitle
        title="Chuva de ideias"
        sub="Ideias de produto do time; quando uma for para frente, vira produto com um clique"
        right={!form && !converter && <button type="button" className={btnPrim} onClick={() => setForm({ marca: aba, titulo: "", resumo: "", descricao: "", imagens: [], temas: [] })}>Nova ideia</button>}
      />
      <RecadoBox recado={recado} onFechar={() => setRecado(null)} />
      {erro && <ErrorBox message={erro} />}

      {form && <FormIdeia inicial={form} temas={todosTemas} onCancelar={() => setForm(null)} onSalvo={pronto} />}
      {converter && modelos.data && colecoes.data && pessoas.data && (
        <FormProduto
          ideia={converter} modelos={modelos.data} colecoes={colecoes.data} pessoas={pessoas.data}
          inicial={{ ...produtoVazio(), marca: converter.marca === "AB" ? "AB" : "AP", nome: tituloDe(converter), descricao: resumoDe(converter) || converter.descricao, imagens: [...converter.imagens] }}
          onModeloNovo={modelos.recarregar} onCancelar={() => setConverter(null)} onSalvo={pronto}
        />
      )}

      {!erro && !ideias.data && <Loading />}
      {ideias.data && (
        <div style={ACCENT[loja.area]} className="flex flex-col gap-4">
          <div role="tablist" aria-label="Loja" className="flex gap-2">
            {LOJAS.map((l) => {
              const n = (ideias.data ?? []).filter((i) => i.marca === l.marca || i.marca === "BOTH").length;
              return (
                <button key={l.marca} role="tab" type="button" aria-selected={aba === l.marca} style={ACCENT[l.area]}
                  onClick={() => { setAba(l.marca); setTema("todos"); }}
                  className={`min-h-11 rounded-xl px-5 text-sm font-bold ${aba === l.marca ? "bg-roxo text-white" : "border border-line bg-white text-roxo-texto hover:bg-roxo-claro/40"}`}>
                  {l.nome} · {n}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip destaque ativo={tema === "todos"} onClick={() => setTema("todos")}>Todas · {daLoja.length}</Chip>
            {todosTemas.map((t) => {
              const n = daLoja.filter((i) => i.temas.includes(t)).length;
              return n > 0 ? <Chip destaque key={t} ativo={tema === t} onClick={() => setTema(t)}>{t} · {n}</Chip> : null;
            })}
          </div>
          {lista.length === 0 ? <Card><Empty>Nenhuma ideia ainda.</Empty></Card> : (
            <div className="flex flex-col gap-3">
              {lista.map((i) => (
                <CartaoIdeia key={i.id} i={i} prod={(produtos.data ?? []).find((p) => p.id === i.produto_id)}
                  onVirar={() => { setForm(null); setConverter(i); }}
                  onEditar={() => { setConverter(null); setForm({ id: i.id, marca: i.marca, titulo: tituloDe(i), resumo: resumoDe(i), descricao: i.titulo ? i.descricao : "", imagens: i.imagens, temas: i.temas }); }}
                  onApagado={() => pronto("Ideia apagada.")} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Linha recolhida como no Fazeno: título + como funciona; abre para imagens, pesquisa completa e ações. */
function CartaoIdeia({ i, prod, onVirar, onEditar, onApagado }: {
  i: Ideia; prod?: Produto; onVirar: () => void; onEditar: () => void; onApagado: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [pesquisa, setPesquisa] = useState(false);
  const resumo = resumoDe(i);
  const detalhes = i.titulo ? i.descricao.trim() : "";
  // links de referência (da pesquisa ou do resumo) aparecem logo na abertura
  const links = [...new Set(`${i.resumo}\n${i.descricao}`.match(/https?:\/\/[^\s)<>"']+/g) ?? [])].map((u) => u.replace(/[.,;:]+$/, ""));
  return (
    <section className={`rounded-[14px] border border-l-4 border-l-roxo bg-white ${i.produto_id ? "border-bom/50" : "border-line"}`}>
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-roxo-claro/60 text-base">💡</span>
        <span className="min-w-0 flex-auto">
          <span className="block font-semibold">{tituloDe(i)}</span>
          {resumo && <span className={`mt-0.5 block text-sm text-muted ${aberto ? "" : "line-clamp-1"}`}>{resumo}</span>}
        </span>
        {i.produto_id && <span className="hidden rounded-full bg-[#E6F4EA] px-2 py-0.5 text-[11px] font-bold text-bom sm:inline">virou produto</span>}
        {i.marca === "BOTH" && <span className="shrink-0 text-xs font-semibold text-roxo-texto">{IDEIA_MARCAS[i.marca]}</span>}
        <span aria-hidden="true" className="text-muted">{aberto ? "▴" : "▾"}</span>
      </button>
      {aberto && (
        <div className="flex flex-col gap-3 border-t border-soft px-5 py-4">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {i.temas.map((t) => <span key={t} className="rounded-full bg-soft px-2 py-0.5 font-semibold text-body">{t}</span>)}
            <span className="ml-auto">{dataCurta(i.created_at.slice(0, 10))}</span>
          </div>
          <Miniaturas caminhos={i.imagens} />
          {links.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted">Referência{links.length > 1 ? "s" : ""}</div>
              <ul className="m-0 mt-1 list-none space-y-1 p-0">
                {links.map((u) => (
                  <li key={u}>
                    <a href={u} target="_blank" rel="noreferrer" className="break-all text-[13px] font-semibold text-roxo-texto underline">
                      {u.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {detalhes && (
            <div>
              <button type="button" className="text-[13px] font-semibold text-roxo-texto underline" onClick={() => setPesquisa((v) => !v)}>
                {pesquisa ? "esconder pesquisa completa" : "ver pesquisa completa"}
              </button>
              {pesquisa && <div className="mt-2 rounded-lg bg-ground p-3 text-[13px]"><Texto>{detalhes}</Texto></div>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnSec} onClick={onEditar}>Editar</button>
            <Apagar id={i.id} onApagado={onApagado} />
            <span className="ml-auto">
              {i.produto_id
                ? <span className="text-[13px] font-semibold text-bom">Virou produto{prod ? `: ${prod.codigo ? `${prod.codigo} · ` : ""}${prod.nome}` : ""}</span>
                : <button type="button" className={btnLoja} onClick={onVirar}>Virar produto</button>}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function Apagar({ id, onApagado }: { id: string; onApagado: () => void }) {
  const [c, setC] = useState(false);
  const apagar = async () => { const { error } = await supabase.from("ideias").delete().eq("id", id); if (!error) onApagado(); };
  return c
    ? <><button type="button" className="min-h-10 rounded-lg bg-ruim px-4 text-sm font-semibold text-white" onClick={apagar}>Confirmar</button><button type="button" className={btnSec} onClick={() => setC(false)}>Voltar</button></>
    : <button type="button" className={`${btnSec} text-ruim`} onClick={() => setC(true)}>Apagar</button>;
}

function FormIdeia({ inicial, temas, onCancelar, onSalvo }: { inicial: Rascunho; temas: string[]; onCancelar: () => void; onSalvo: (t: string) => void }) {
  const { session } = useAuth();
  const [f, setF] = useState(inicial);
  const [outro, setOutro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const alterna = (t: string) => setF((x) => ({ ...x, temas: x.temas.includes(t) ? x.temas.filter((y) => y !== t) : [...x.temas, t] }));

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    const extra = outro.trim();
    const lista = extra && !f.temas.includes(extra) ? [...f.temas, extra] : f.temas;
    if (!f.titulo.trim()) { setErro("Dê um título para a ideia."); return; }
    if (!lista.length) { setErro("Escolha pelo menos um tema."); return; }
    setSalvando(true); setErro(null);
    const campos = { marca: f.marca, titulo: f.titulo.trim(), resumo: f.resumo.trim(), descricao: f.descricao.trim(), imagens: f.imagens, temas: lista };
    const { error } = f.id
      ? await supabase.from("ideias").update(campos).eq("id", f.id)
      : await supabase.from("ideias").insert({ ...campos, criado_por: emailAtual(session.user.email) });
    setSalvando(false);
    if (error) setErro(error.message); else onSalvo(f.id ? "Ideia salva." : "Ideia registrada.");
  };

  return (
    <Card title={f.id ? "Editar ideia" : "Nova ideia"}>
      <form onSubmit={salvar} className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Rotulo>Marca</Rotulo>
          <div className="flex gap-2">{(["AP", "AB", "BOTH"] as const).map((m) => <Chip key={m} ativo={f.marca === m} onClick={() => setF({ ...f, marca: m })}>{IDEIA_MARCAS[m]}</Chip>)}</div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Rotulo htmlFor="i-tit">Título</Rotulo>
          <input id="i-tit" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} className={inputCls} placeholder="Ex.: Madrinha e Padrinho Club" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Rotulo htmlFor="i-res">Como funciona <span className="font-normal text-muted">· 1 ou 2 frases</span></Rotulo>
          <textarea id="i-res" rows={2} value={f.resumo} onChange={(e) => setF({ ...f, resumo: e.target.value })} className={`${inputCls} py-2`} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Rotulo htmlFor="i-desc">Detalhes / pesquisa <span className="font-normal text-muted">· opcional, fica recolhido</span></Rotulo>
          <textarea id="i-desc" rows={3} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} className={`${inputCls} py-2`} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Rotulo>Imagens</Rotulo>
          <CampoImagens valor={f.imagens} onChange={(v) => setF({ ...f, imagens: v })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Rotulo>Tema <span className="font-normal text-muted">· pode escolher mais de um</span></Rotulo>
          <div className="flex flex-wrap items-center gap-2">
            {temas.map((t) => <Chip key={t} ativo={f.temas.includes(t)} onClick={() => alterna(t)}>{t}</Chip>)}
            <input value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="Outro tema" aria-label="Outro tema" className="min-h-9 w-40 rounded-lg border border-line px-2 text-sm" />
          </div>
        </div>
        {erro && <p role="alert" className="m-0 text-sm text-ruim">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSec} onClick={onCancelar}>Cancelar</button>
          <button type="submit" className={btnPrim} disabled={salvando}>{salvando ? "Salvando…" : "Salvar ideia"}</button>
        </div>
      </form>
    </Card>
  );
}
