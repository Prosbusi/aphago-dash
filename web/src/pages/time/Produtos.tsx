import { useState, type FormEvent } from "react";
import { useAuth } from "../../auth";
import { supabase } from "../../lib/supabase";
import { num } from "../../lib/format";
import {
  avisar, citados, dataCurta, emailAtual, etapaFeita, etapas, podeLancar, statusPrazo, useTabela,
  CORES_PRODUTO, MARCAS, type Colecao, type Ideia, type Modelo, type Pessoa, type Produto,
} from "../../lib/time";
import { Card, Empty, ErrorBox, Loading, PageTitle } from "../../components/ui";
import { CampoImagens, Chip, Miniaturas, RecadoBox, Rotulo, Texto, btnPrim, btnSec, inputCls, type Recado } from "../../components/time";

type Rascunho = {
  id?: string; marca: "AP" | "AB"; nome: string; descricao: string; imagens: string[];
  modelos: string[]; cores: string[]; colecao_id: string; prazo: string;
};
export const produtoVazio = (): Rascunho => ({ marca: "AP", nome: "", descricao: "", imagens: [], modelos: [], cores: [], colecao_id: "", prazo: "" });

export function Produtos() {
  const produtos = useTabela<Produto>("produtos_criacao", "created_at", false);
  const modelos = useTabela<Modelo>("modelos", "posicao");
  const colecoes = useTabela<Colecao>("colecoes", "created_at");
  const pessoas = useTabela<Pessoa>("equipe", "created_at");
  const [colecao, setColecao] = useState("todas");
  const [marca, setMarca] = useState<"todas" | "AP" | "AB">("todas");
  const [cancelados, setCancelados] = useState(false);
  const [form, setForm] = useState<Rascunho | null>(null);
  const [recado, setRecado] = useState<Recado>(null);
  const [novaColecao, setNovaColecao] = useState<string | null>(null);

  const erro = produtos.error || modelos.error || colecoes.error || pessoas.error;
  const lista = (produtos.data ?? []).filter((p) =>
    (colecao === "todas" || (colecao === "single" ? !p.colecao_id : p.colecao_id === colecao)) &&
    (marca === "todas" || p.marca === marca) && (cancelados || !p.cancelado));

  const criarColecao = async (e: FormEvent) => {
    e.preventDefault();
    if (!novaColecao?.trim()) return;
    const { error } = await supabase.from("colecoes").insert({ nome: novaColecao.trim() });
    if (error) setRecado({ tipo: "erro", texto: error.message }); else { setNovaColecao(null); colecoes.recarregar(); }
  };

  const salvo = (texto: string, tipo: "ok" | "aviso" = "ok") => { setForm(null); setRecado({ tipo, texto }); produtos.recarregar(); };

  return (
    <>
      <PageTitle
        title="Criação de produtos"
        sub="Do Customily ao anúncio: as 4 etapas de cada produto novo"
        right={!form && <button type="button" className={btnPrim} onClick={() => setForm(produtoVazio())}>Cadastrar produto</button>}
      />
      <RecadoBox recado={recado} onFechar={() => setRecado(null)} />
      {erro && <ErrorBox message={erro} />}

      {form && modelos.data && colecoes.data && pessoas.data && (
        <FormProduto inicial={form} modelos={modelos.data} colecoes={colecoes.data} pessoas={pessoas.data}
          onModeloNovo={modelos.recarregar} onCancelar={() => setForm(null)} onSalvo={salvo} />
      )}

      {!erro && (!produtos.data || !modelos.data || !colecoes.data) && <Loading />}
      {produtos.data && modelos.data && colecoes.data && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Chip ativo={colecao === "todas"} onClick={() => setColecao("todas")}>Todos os produtos</Chip>
            {colecoes.data.map((c) => <Chip key={c.id} ativo={colecao === c.id} onClick={() => setColecao(c.id)}>{c.nome}</Chip>)}
            <Chip ativo={colecao === "single"} onClick={() => setColecao("single")}>Sem coleção</Chip>
            {novaColecao === null
              ? <button type="button" onClick={() => setNovaColecao("")} className="text-[13px] font-semibold text-roxo-texto">+ Nova coleção</button>
              : (
                <form onSubmit={criarColecao} className="flex gap-1.5">
                  <input autoFocus value={novaColecao} onChange={(e) => setNovaColecao(e.target.value)} aria-label="Nome da coleção" placeholder="Nome da coleção" className="min-h-9 rounded-lg border border-line px-2 text-sm" />
                  <button type="submit" className="min-h-9 rounded-lg bg-ink px-3 text-[13px] font-semibold text-white">Criar</button>
                  <button type="button" onClick={() => setNovaColecao(null)} className="px-2 text-[13px] text-muted">Cancelar</button>
                </form>
              )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(["todas", "AP", "AB"] as const).map((m) => <Chip key={m} ativo={marca === m} onClick={() => setMarca(m)}>{m === "todas" ? "Todas as marcas" : MARCAS[m]}</Chip>)}
            <label className="ml-auto flex items-center gap-2 text-[13px] font-semibold text-body">
              <input type="checkbox" checked={cancelados} onChange={(e) => setCancelados(e.target.checked)} className="h-4 w-4" />
              Mostrar cancelados
            </label>
          </div>

          {lista.length === 0 ? <Card><Empty>Nenhum produto aqui.</Empty></Card> : (
            <div className="flex flex-col gap-3">
              {lista.map((p) => (
                <CartaoProduto key={p.id} p={p} modelos={modelos.data!} colecoes={colecoes.data!}
                  onTrocar={(patch) => produtos.trocar(p.id, patch)} onRecarregar={produtos.recarregar} setRecado={setRecado}
                  onEditar={() => setForm({ id: p.id, marca: p.marca, nome: p.nome, descricao: p.descricao, imagens: p.imagens, modelos: p.modelos, cores: p.cores, colecao_id: p.colecao_id ?? "", prazo: p.prazo ?? "" })} />
              ))}
            </div>
          )}
          <p className="m-0 text-xs text-muted">{num(lista.length)} {lista.length === 1 ? "produto" : "produtos"}. Os códigos (AP0001, AB0001…) são os que vieram do Fazeno; produto cadastrado aqui fica sem código até a nomenclatura nova ser definida.</p>
        </>
      )}
    </>
  );
}

function CartaoProduto({ p, modelos, colecoes, onTrocar, onRecarregar, onEditar, setRecado }: {
  p: Produto; modelos: Modelo[]; colecoes: Colecao[]; onTrocar: (patch: Partial<Produto>) => void;
  onRecarregar: () => void; onEditar: () => void; setRecado: (r: Recado) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [lancando, setLancando] = useState(false);
  const est = etapas(p.modelos, modelos);
  const feitas = est.filter((e) => etapaFeita(e, p.checks)).length;
  const st = statusPrazo(p.prazo, feitas === est.length);
  const col = colecoes.find((c) => c.id === p.colecao_id)?.nome;

  const salvarChecks = async (checks: string[]) => {
    onTrocar({ checks });
    const { error } = await supabase.from("produtos_criacao").update({ checks }).eq("id", p.id);
    if (error) { setRecado({ tipo: "erro", texto: `Não deu para salvar: ${error.message}` }); onRecarregar(); }
  };
  const alternar = (k: string) => salvarChecks(p.checks.includes(k) ? p.checks.filter((x) => x !== k) : [...p.checks, k]);
  const todos = (keys: string[], marcar: boolean) => salvarChecks(marcar ? [...new Set([...p.checks, ...keys])] : p.checks.filter((x) => !keys.includes(x)));

  const patch = async (campos: Partial<Produto>) => {
    const { error } = await supabase.from("produtos_criacao").update(campos).eq("id", p.id);
    if (error) setRecado({ tipo: "erro", texto: error.message }); onRecarregar();
  };
  const apagar = async () => {
    const { error } = await supabase.from("produtos_criacao").delete().eq("id", p.id);
    if (error) setRecado({ tipo: "erro", texto: error.message }); else setRecado({ tipo: "ok", texto: "Produto apagado." });
    onRecarregar();
  };
  const lancar = async () => {
    setLancando(true);
    const falha = await avisar("lancamento", p.id);
    setLancando(false);
    setRecado(falha ? { tipo: "erro", texto: `O lançamento não foi enviado: ${falha}` } : { tipo: "ok", texto: `Lançamento enviado ao canal da ${MARCAS[p.marca]}.` });
  };

  return (
    <section className={`rounded-[14px] border border-line bg-white ${p.cancelado ? "opacity-60" : ""}`}>
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} className="flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left">
        <span className={`rounded-md px-2 py-1 font-mono text-[13px] font-bold ${p.codigo ? "bg-ink text-white" : "border border-dashed border-line text-muted"}`}>{p.codigo ?? "Sem código"}</span>
        <span className="min-w-0 flex-auto">
          <span className={`block font-semibold ${p.cancelado ? "line-through" : ""}`}>{p.nome}</span>
          <span className="mt-0.5 block text-xs text-muted">
            {MARCAS[p.marca]} · {col ?? "Sem coleção"}{p.prazo && ` · prazo ${dataCurta(p.prazo)}`}{p.cancelado && " · cancelado"}
            {st === "atrasada" && <span className="ml-1.5 rounded-full bg-[#FBE0DD] px-2 py-0.5 text-[11px] font-bold text-ruim">Atrasado</span>}
          </span>
        </span>
        <span className="flex items-center gap-1" aria-label={`${feitas} de ${est.length} etapas concluídas`}>
          {est.map((e) => <span key={e.key} title={e.titulo} className={`h-2 w-7 rounded-full ${etapaFeita(e, p.checks) ? "bg-bom" : "bg-soft"}`} />)}
        </span>
      </button>

      {aberto && (
        <div className="flex flex-col gap-4 border-t border-soft px-5 py-4">
          {p.descricao && <Texto>{p.descricao}</Texto>}
          <Miniaturas caminhos={p.imagens} />
          {p.cores.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs text-muted">
              {p.cores.map((c) => { const cor = CORES_PRODUTO.find((x) => x.key === c); return <span key={c} className="flex items-center gap-1"><span className="h-3 w-3 rounded-full border border-line" style={{ background: cor?.hex ?? "#ccc" }} />{cor?.nome ?? c}</span>; })}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {est.map((e) => {
              const ok = etapaFeita(e, p.checks);
              const tudo = e.itens.length > 0 && e.itens.every((i) => p.checks.includes(i.key));
              return (
                <div key={e.key} className={`rounded-xl border p-4 ${ok ? "border-bom/40 bg-[#F1FAF4]" : "border-line"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="m-0 text-sm font-bold">{e.titulo}</h3>
                    {e.itens.length > 0 && !p.cancelado && (
                      <button type="button" className="text-xs font-semibold text-roxo-texto" onClick={() => todos(e.itens.map((i) => i.key), !tudo)}>{tudo ? "Desmarcar todos" : "Marcar todos"}</button>
                    )}
                  </div>
                  {e.itens.length === 0 ? <p className="mb-0 mt-2 text-xs text-muted">Sem versões extras.</p> : (
                    <ul className="m-0 mt-2 list-none p-0">
                      {e.itens.map((i) => (
                        <li key={i.key}>
                          <label className="flex min-h-8 items-center gap-2 text-sm">
                            <input type="checkbox" checked={p.checks.includes(i.key)} disabled={p.cancelado} onChange={() => alternar(i.key)} className="h-4 w-4" />
                            {i.label}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  {e.key === "versions" && (
                    <button type="button" className={`${btnPrim} mt-3`} disabled={lancando || !podeLancar(p, modelos)} onClick={lancar}
                      title={podeLancar(p, modelos) ? `Enviar ao canal de lançamentos da ${MARCAS[p.marca]}` : "Conclua o checklist de Outras versões"}>
                      {lancando ? "Enviando…" : "Lançar"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSec} onClick={onEditar}>Editar</button>
            <button type="button" className={btnSec} onClick={() => patch({ cancelado: !p.cancelado })}>{p.cancelado ? "Reativar" : "Cancelar produto"}</button>
            {confirmar
              ? <><button type="button" className="min-h-10 rounded-lg bg-ruim px-4 text-sm font-semibold text-white" onClick={apagar}>Confirmar</button><button type="button" className={btnSec} onClick={() => setConfirmar(false)}>Voltar</button></>
              : <button type="button" className={`${btnSec} text-ruim`} onClick={() => setConfirmar(true)}>Apagar</button>}
          </div>
        </div>
      )}
    </section>
  );
}

/** Formulário de produto. Com `ideia`, transforma a ideia em produto (uma vez só). */
export function FormProduto({ inicial, modelos, colecoes, pessoas, ideia, onModeloNovo, onCancelar, onSalvo }: {
  inicial: Rascunho; modelos: Modelo[]; colecoes: Colecao[]; pessoas: Pessoa[]; ideia?: Ideia;
  onModeloNovo: () => void; onCancelar: () => void; onSalvo: (texto: string, tipo?: "ok" | "aviso") => void;
}) {
  const { session } = useAuth();
  const [f, setF] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [novoModelo, setNovoModelo] = useState<string | null>(null);
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setF((x) => ({ ...x, [k]: v }));
  const alterna = (k: "modelos" | "cores", v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);

  const criarModelo = async () => {
    if (!novoModelo?.trim()) return;
    const { data, error } = await supabase.from("modelos").insert({ nome: novoModelo.trim() }).select("id").single();
    if (error || !data) { setErro(error?.message ?? "Não deu para criar o modelo."); return; }
    set("modelos", [...f.modelos, data.id]); setNovoModelo(null); onModeloNovo();
  };

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.nome.trim()) { setErro("Dê um nome ao produto."); return; }
    setSalvando(true); setErro(null);
    const campos = { nome: f.nome.trim(), descricao: f.descricao, imagens: f.imagens, modelos: f.modelos, cores: f.cores, colecao_id: f.colecao_id || null, prazo: f.prazo || null };
    let id: string | undefined = f.id;
    if (f.id) {
      const { error } = await supabase.from("produtos_criacao").update(campos).eq("id", f.id);
      if (error) { setSalvando(false); setErro(error.message); return; }
    } else if (ideia) {
      const { data, error } = await supabase.rpc("converter_ideia", { p_ideia: ideia.id, p_campos: { ...campos, marca: f.marca } });
      if (error || !data) { setSalvando(false); setErro(error?.message ?? "Não deu para converter a ideia."); return; }
      id = (data as Produto).id;
    } else {
      const { data, error } = await supabase.from("produtos_criacao").insert({ ...campos, marca: f.marca, criado_por: emailAtual(session.user.email) }).select("id").single();
      if (error || !data) { setSalvando(false); setErro(error?.message ?? "Não deu para cadastrar."); return; }
      id = data.id;
    }
    // avisa só quem passou a ser citado agora (@Nome)
    const antes = new Set(citados(inicial.descricao, pessoas).map((p) => p.id));
    const novos = citados(f.descricao, pessoas).filter((p) => !antes.has(p.id));
    let falha: string | null = null;
    if (novos.length && id) falha = await avisar("mencao", id, novos.map((p) => p.id));
    setSalvando(false);
    const base = f.id ? "Produto salvo." : ideia ? "Ideia transformada em produto." : "Produto cadastrado.";
    if (falha) onSalvo(`${base} O aviso no Discord não saiu: ${falha}`, "aviso");
    else onSalvo(novos.length ? `${base} Avisamos no Discord: ${novos.map((p) => p.nome).join(", ")}.` : base);
  };

  return (
    <Card title={f.id ? "Editar produto" : ideia ? "Transformar ideia em produto" : "Cadastrar produto"}>
      <form onSubmit={salvar} className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Rotulo>Marca</Rotulo>
          <div className="flex gap-2">
            {(["AP", "AB"] as const).map((m) => (
              <Chip key={m} ativo={f.marca === m} onClick={() => !f.id && set("marca", m)} title={f.id ? "A marca não muda depois do cadastro" : undefined}>{MARCAS[m]}</Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Rotulo htmlFor="p-nome">Nome</Rotulo>
          <input id="p-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Rotulo htmlFor="p-desc">Descrição <span className="font-normal text-muted">· use @Nome para avisar alguém no Discord</span></Rotulo>
          <textarea id="p-desc" rows={5} value={f.descricao} onChange={(e) => set("descricao", e.target.value)} className={`${inputCls} py-2`} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Rotulo>Imagens</Rotulo>
          <CampoImagens valor={f.imagens} onChange={(v) => set("imagens", v)} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Rotulo>Outras versões (modelos)</Rotulo>
          <div className="flex flex-wrap items-center gap-2">
            {modelos.map((m) => <Chip key={m.id} ativo={f.modelos.includes(m.id)} onClick={() => alterna("modelos", m.id)}>{m.nome}</Chip>)}
            {novoModelo === null
              ? <button type="button" onClick={() => setNovoModelo("")} className="text-[13px] font-semibold text-roxo-texto">+ Cadastrar modelo</button>
              : (
                <span className="flex gap-1.5">
                  <input autoFocus value={novoModelo} onChange={(e) => setNovoModelo(e.target.value)} aria-label="Nome do modelo" className="min-h-9 w-40 rounded-lg border border-line px-2 text-sm" />
                  <button type="button" onClick={criarModelo} className="min-h-9 rounded-lg bg-ink px-3 text-[13px] font-semibold text-white">Criar</button>
                  <button type="button" onClick={() => setNovoModelo(null)} className="px-2 text-[13px] text-muted">Cancelar</button>
                </span>
              )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Rotulo>Cores</Rotulo>
          <div className="flex flex-wrap gap-2">
            {CORES_PRODUTO.map((c) => (
              <Chip key={c.key} ativo={f.cores.includes(c.key)} onClick={() => alterna("cores", c.key)}>
                <span className="mr-1.5 inline-block h-3 w-3 rounded-full border border-line align-[-1px]" style={{ background: c.hex }} />{c.nome}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Rotulo htmlFor="p-col">Coleção</Rotulo>
          <select id="p-col" value={f.colecao_id} onChange={(e) => set("colecao_id", e.target.value)} className={inputCls}>
            <option value="">Sem coleção (single)</option>
            {colecoes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Rotulo htmlFor="p-prazo">Prazo</Rotulo>
          <input id="p-prazo" type="date" value={f.prazo} onChange={(e) => set("prazo", e.target.value)} className={inputCls} />
        </div>
        {erro && <p role="alert" className="m-0 text-sm text-ruim sm:col-span-2">{erro}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className={btnSec} onClick={onCancelar}>Cancelar</button>
          <button type="submit" className={btnPrim} disabled={salvando}>{salvando ? "Salvando…" : f.id ? "Salvar" : ideia ? "Criar produto" : "Cadastrar"}</button>
        </div>
      </form>
    </Card>
  );
}
