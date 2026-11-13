import { useState, type FormEvent } from "react";
import { useAuth } from "../../auth";
import { supabase } from "../../lib/supabase";
import { dataCurta, emailAtual, useTabela, IDEIA_MARCAS, TEMAS, type Colecao, type Ideia, type Modelo, type Pessoa, type Produto } from "../../lib/time";
import { Card, Empty, ErrorBox, Loading, PageTitle } from "../../components/ui";
import { CampoImagens, Chip, Miniaturas, RecadoBox, Rotulo, Texto, btnPrim, btnSec, inputCls, type Recado } from "../../components/time";
import { FormProduto, produtoVazio } from "./Produtos";

type Rascunho = { id?: string; marca: Ideia["marca"]; descricao: string; imagens: string[]; temas: string[] };

export function Ideias() {
  const ideias = useTabela<Ideia>("ideias", "created_at", false);
  const produtos = useTabela<Produto>("produtos_criacao", "created_at", false);
  const modelos = useTabela<Modelo>("modelos", "posicao");
  const colecoes = useTabela<Colecao>("colecoes", "created_at");
  const pessoas = useTabela<Pessoa>("equipe", "created_at");
  const [form, setForm] = useState<Rascunho | null>(null);
  const [converter, setConverter] = useState<Ideia | null>(null);
  const [tema, setTema] = useState("todos");
  const [recado, setRecado] = useState<Recado>(null);

  const erro = ideias.error || produtos.error || modelos.error || colecoes.error || pessoas.error;
  const todosTemas = [...new Set([...TEMAS, ...(ideias.data ?? []).flatMap((i) => i.temas)])];
  const lista = (ideias.data ?? []).filter((i) => tema === "todos" || i.temas.includes(tema));

  const pronto = (texto: string, tipo: "ok" | "aviso" = "ok") => {
    setForm(null); setConverter(null); setRecado({ tipo, texto }); ideias.recarregar(); produtos.recarregar();
  };

  return (
    <>
      <PageTitle
        title="Chuva de ideias"
        sub="Ideias de produto do time; quando uma for para frente, vira produto com um clique"
        right={!form && !converter && <button type="button" className={btnPrim} onClick={() => setForm({ marca: "AP", descricao: "", imagens: [], temas: [] })}>Nova ideia</button>}
      />
      <RecadoBox recado={recado} onFechar={() => setRecado(null)} />
      {erro && <ErrorBox message={erro} />}

      {form && <FormIdeia inicial={form} temas={todosTemas} onCancelar={() => setForm(null)} onSalvo={pronto} />}
      {converter && modelos.data && colecoes.data && pessoas.data && (
        <FormProduto
          ideia={converter} modelos={modelos.data} colecoes={colecoes.data} pessoas={pessoas.data}
          inicial={{ ...produtoVazio(), marca: converter.marca === "AB" ? "AB" : "AP", descricao: converter.descricao, imagens: [...converter.imagens] }}
          onModeloNovo={modelos.recarregar} onCancelar={() => setConverter(null)} onSalvo={pronto}
        />
      )}

      {!erro && !ideias.data && <Loading />}
      {ideias.data && (
        <>
          <div className="flex flex-wrap gap-2">
            <Chip ativo={tema === "todos"} onClick={() => setTema("todos")}>Todas · {ideias.data.length}</Chip>
            {todosTemas.map((t) => {
              const n = ideias.data!.filter((i) => i.temas.includes(t)).length;
              return n > 0 ? <Chip key={t} ativo={tema === t} onClick={() => setTema(t)}>{t} · {n}</Chip> : null;
            })}
          </div>
          {lista.length === 0 ? <Card><Empty>Nenhuma ideia ainda.</Empty></Card> : (
            <div className="grid gap-3 md:grid-cols-2">
              {lista.map((i) => {
                const prod = (produtos.data ?? []).find((p) => p.id === i.produto_id);
                return (
                  <section key={i.id} className="flex flex-col gap-3 rounded-[14px] border border-line bg-white px-5 py-4">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span className="font-bold text-ink">{IDEIA_MARCAS[i.marca]}</span>
                      {i.temas.map((t) => <span key={t} className="rounded-full bg-soft px-2 py-0.5 font-semibold text-body">{t}</span>)}
                      <span className="ml-auto">{dataCurta(i.created_at.slice(0, 10))}</span>
                    </div>
                    {i.descricao && <Texto>{i.descricao}</Texto>}
                    <Miniaturas caminhos={i.imagens} />
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      {i.produto_id
                        ? <span className="text-[13px] font-semibold text-bom">Virou produto{prod ? `: ${prod.codigo ? `${prod.codigo} · ` : ""}${prod.nome}` : ""}</span>
                        : <button type="button" className={btnPrim} onClick={() => { setForm(null); setConverter(i); }}>Transformar em produto</button>}
                      <button type="button" className={btnSec} onClick={() => { setConverter(null); setForm({ id: i.id, marca: i.marca, descricao: i.descricao, imagens: i.imagens, temas: i.temas }); }}>Editar</button>
                      <Apagar id={i.id} onApagado={() => pronto("Ideia apagada.")} />
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
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
    if (!f.descricao.trim() && !f.imagens.length) { setErro("Adicione uma descrição ou imagem."); return; }
    if (!lista.length) { setErro("Escolha pelo menos um tema."); return; }
    setSalvando(true); setErro(null);
    const campos = { marca: f.marca, descricao: f.descricao.trim(), imagens: f.imagens, temas: lista };
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
          <Rotulo htmlFor="i-desc">Descrição</Rotulo>
          <textarea id="i-desc" rows={4} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} className={`${inputCls} py-2`} />
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
