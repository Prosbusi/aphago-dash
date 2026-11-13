import { useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../../auth";
import { supabase } from "../../lib/supabase";
import { dec, num } from "../../lib/format";
import { avisar, dataCurta, emailAtual, numerosPorPessoa, ordenarPorPrazo, statusPrazo, useTabela, CORES_ETIQUETA, type Etiqueta, type Pessoa, type Tarefa } from "../../lib/time";
import { Card, Empty, ErrorBox, Loading, PageTitle } from "../../components/ui";
import { CampoImagens, Chip, EtiquetaTag, Miniaturas, RecadoBox, Rotulo, Texto, btnPrim, btnSec, inputCls, type Recado } from "../../components/time";

type Rascunho = { id?: string; titulo: string; descricao: string; pessoa_id: string; prazo: string; link: string; etiquetas: string[]; imagens: string[] };
const vazio = (pessoa = ""): Rascunho => ({ titulo: "", descricao: "", pessoa_id: pessoa, prazo: "", link: "", etiquetas: [], imagens: [] });

const STATUS: Record<string, { texto: string; cls: string }> = {
  atrasada: { texto: "Atrasada", cls: "bg-[#FBE0DD] text-ruim" },
  hoje: { texto: "Vence hoje", cls: "bg-[#FBEFD0] text-[#8A5A00]" },
  amanha: { texto: "Vence amanhã", cls: "bg-[#FBEFD0] text-[#8A5A00]" },
};

export function Tarefas() {
  const { session, isAdmin } = useAuth();
  const pessoas = useTabela<Pessoa>("equipe", "created_at");
  const tarefas = useTabela<Tarefa>("tarefas", "created_at", false);
  const etiquetas = useTabela<Etiqueta>("etiquetas", "nome");
  const [filtro, setFiltro] = useState<string>("todos");
  const [ocultar, setOcultar] = useState(true);
  const [form, setForm] = useState<Rascunho | null>(null);
  const [recado, setRecado] = useState<Recado>(null);
  const [equipeAberta, setEquipeAberta] = useState(false);

  const ativos = (pessoas.data ?? []).filter((p) => p.ativo);
  const lista = tarefas.data ?? [];
  const numeros = useMemo(() => numerosPorPessoa(ativos, lista), [ativos, lista]);
  const visiveis = ordenarPorPrazo(lista.filter((t) => (filtro === "todos" || (filtro === "sem" ? !t.pessoa_id : t.pessoa_id === filtro)) && (!ocultar || !t.concluida)));
  const pendentes = (id: string | null) => lista.filter((t) => !t.concluida && t.pessoa_id === id).length;
  const semDono = pendentes(null);

  const salvo = (texto: string, tipo: "ok" | "aviso" = "ok") => { setForm(null); setRecado({ tipo, texto }); tarefas.recarregar(); };

  const marcar = async (t: Tarefa) => {
    tarefas.trocar(t.id, { concluida: !t.concluida });
    const { error } = await supabase.from("tarefas").update({ concluida: !t.concluida }).eq("id", t.id);
    if (error) { setRecado({ tipo: "erro", texto: `Não deu para salvar: ${error.message}` }); }
    tarefas.recarregar();
  };

  const erro = pessoas.error || tarefas.error || etiquetas.error;

  return (
    <>
      <PageTitle
        title="Tarefas do time"
        sub="Quem está com o quê, por ordem de vencimento"
        right={!form && <button type="button" className={btnPrim} onClick={() => setForm(vazio(filtro !== "todos" && filtro !== "sem" ? filtro : ""))}>Nova tarefa</button>}
      />
      <RecadoBox recado={recado} onFechar={() => setRecado(null)} />
      {erro && <ErrorBox message={erro} />}
      {!erro && (!pessoas.data || !tarefas.data) && <Loading />}

      {form && pessoas.data && (
        <FormTarefa
          inicial={form} pessoas={ativos} etiquetas={etiquetas.data ?? []} email={emailAtual(session.user.email)}
          onEtiquetaNova={etiquetas.recarregar} onCancelar={() => setForm(null)} onSalvo={salvo}
        />
      )}

      {pessoas.data && tarefas.data && (
        <>
          <section aria-label="Números por pessoa" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
            {numeros.map((p) => (
              <button key={p.id} type="button" onClick={() => setFiltro(p.id)} aria-pressed={filtro === p.id}
                className={`rounded-[14px] border bg-white px-5 py-4 text-left ${filtro === p.id ? "border-roxo" : "border-line hover:border-roxo/50"}`}>
                <div className="text-[13px] font-semibold text-muted">{p.nome}</div>
                <div className="mt-1 text-[28px] font-extrabold tracking-tight">{num(p.pendentes)} <span className="text-sm font-semibold text-muted">pendentes</span></div>
                <div className="mt-1 text-xs text-muted">{num(p.concluidas)} concluídas{p.media != null && ` · ${dec(p.media < 48 ? p.media : p.media / 24, 1)} ${p.media < 48 ? "h" : "dias"} em média`}</div>
              </button>
            ))}
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <Chip ativo={filtro === "todos"} onClick={() => setFiltro("todos")}>Todos · {num(lista.filter((t) => !t.concluida).length)}</Chip>
            {ativos.map((p) => <Chip key={p.id} ativo={filtro === p.id} onClick={() => setFiltro(p.id)}>{p.nome} · {num(pendentes(p.id))}</Chip>)}
            {semDono > 0 && <Chip ativo={filtro === "sem"} onClick={() => setFiltro("sem")}>Sem responsável · {num(semDono)}</Chip>}
            <label className="ml-auto flex items-center gap-2 text-[13px] font-semibold text-body">
              <input type="checkbox" checked={ocultar} onChange={(e) => setOcultar(e.target.checked)} className="h-4 w-4" />
              Ocultar concluídas
            </label>
          </div>

          <Card>
            {visiveis.length === 0 ? <Empty>Nenhuma tarefa aqui.</Empty> : (
              <ul className="m-0 list-none p-0">
                {visiveis.map((t) => (
                  <LinhaTarefa key={t.id} t={t} pessoa={ativos.find((p) => p.id === t.pessoa_id) ?? pessoas.data!.find((p) => p.id === t.pessoa_id)}
                    etiquetas={etiquetas.data ?? []} onMarcar={() => marcar(t)}
                    onEditar={() => setForm({ id: t.id, titulo: t.titulo, descricao: t.descricao, pessoa_id: t.pessoa_id ?? "", prazo: t.prazo ?? "", link: t.link ?? "", etiquetas: t.etiquetas, imagens: t.imagens })}
                    onApagado={() => { setRecado({ tipo: "ok", texto: "Tarefa apagada." }); tarefas.recarregar(); }} />
                ))}
              </ul>
            )}
          </Card>

          {isAdmin && (
            <Card title="Equipe" extra={<button type="button" className="font-semibold text-roxo-texto" onClick={() => setEquipeAberta((v) => !v)}>{equipeAberta ? "Fechar" : "Gerenciar"}</button>}>
              {equipeAberta && <Equipe pessoas={pessoas.data} onSalvo={pessoas.recarregar} />}
            </Card>
          )}
        </>
      )}
    </>
  );
}

function LinhaTarefa({ t, pessoa, etiquetas, onMarcar, onEditar, onApagado }: {
  t: Tarefa; pessoa?: Pessoa; etiquetas: Etiqueta[]; onMarcar: () => void; onEditar: () => void; onApagado: () => void;
}) {
  const [aberta, setAberta] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const st = statusPrazo(t.prazo, t.concluida);
  const apagar = async () => { const { error } = await supabase.from("tarefas").delete().eq("id", t.id); if (!error) onApagado(); };
  return (
    <li className="border-t border-soft py-3 first:border-t-0">
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={t.concluida} onChange={onMarcar} aria-label={t.concluida ? "Reabrir tarefa" : "Concluir tarefa"} className="mt-1 h-5 w-5 shrink-0" />
        <button type="button" onClick={() => setAberta((v) => !v)} aria-expanded={aberta} className="min-w-0 flex-auto text-left">
          <span className={`block font-semibold ${t.concluida ? "text-muted line-through" : "text-ink"}`}>{t.titulo || t.descricao.split("\n")[0] || "Sem título"}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span>{pessoa?.nome ?? "Sem responsável"}</span>
            {t.prazo && <span>· {dataCurta(t.prazo)}</span>}
            {st && STATUS[st] && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS[st].cls}`}>{STATUS[st].texto}</span>}
            {t.etiquetas.map((e) => <EtiquetaTag key={e} nome={e} cor={etiquetas.find((x) => x.nome === e)?.cor} />)}
            {t.imagens.length > 0 && <span>· {t.imagens.length} {t.imagens.length === 1 ? "imagem" : "imagens"}</span>}
          </span>
        </button>
      </div>
      {aberta && (
        <div className="ml-8 mt-3 flex flex-col gap-3">
          {t.descricao && <Texto>{t.descricao}</Texto>}
          {t.link && <a href={t.link} target="_blank" rel="noreferrer" className="break-all text-sm">{t.link}</a>}
          <Miniaturas caminhos={t.imagens} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSec} onClick={onEditar}>Editar</button>
            {confirmar
              ? <><button type="button" className="min-h-10 rounded-lg bg-ruim px-4 text-sm font-semibold text-white" onClick={apagar}>Confirmar</button><button type="button" className={btnSec} onClick={() => setConfirmar(false)}>Cancelar</button></>
              : <button type="button" className={`${btnSec} text-ruim`} onClick={() => setConfirmar(true)}>Apagar</button>}
          </div>
        </div>
      )}
    </li>
  );
}

function FormTarefa({ inicial, pessoas, etiquetas, email, onEtiquetaNova, onCancelar, onSalvo }: {
  inicial: Rascunho; pessoas: Pessoa[]; etiquetas: Etiqueta[]; email: string | null;
  onEtiquetaNova: () => void; onCancelar: () => void; onSalvo: (texto: string, tipo?: "ok" | "aviso") => void;
}) {
  const [f, setF] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [nova, setNova] = useState<{ nome: string; cor: string } | null>(null);
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setF((x) => ({ ...x, [k]: v }));

  const criarEtiqueta = async () => {
    if (!nova?.nome.trim()) return;
    const { error } = await supabase.from("etiquetas").insert({ nome: nova.nome.trim(), cor: nova.cor });
    if (error) { setErro(error.message); return; }
    set("etiquetas", [...f.etiquetas, nova.nome.trim()]); setNova(null); onEtiquetaNova();
  };

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    const titulo = f.titulo.trim() || f.descricao.trim().split("\n")[0].slice(0, 120);
    if (!titulo) { setErro("Escreva um título ou uma descrição."); return; }
    setSalvando(true); setErro(null);
    const campos = { titulo, descricao: f.descricao, pessoa_id: f.pessoa_id || null, prazo: f.prazo || null, link: f.link.trim() || null, etiquetas: f.etiquetas, imagens: f.imagens };
    if (f.id) {
      const { error } = await supabase.from("tarefas").update(campos).eq("id", f.id);
      setSalvando(false);
      if (error) setErro(error.message); else onSalvo("Tarefa salva.");
      return;
    }
    const { data, error } = await supabase.from("tarefas").insert({ ...campos, criado_por: email }).select("id").single();
    if (error || !data) { setSalvando(false); setErro(error?.message ?? "Não deu para salvar."); return; }
    const falha = await avisar("tarefa", data.id);
    setSalvando(false);
    onSalvo(falha ? `Tarefa criada, mas o aviso no Discord não saiu: ${falha}` : "Tarefa criada e avisada no Discord.", falha ? "aviso" : "ok");
  };

  return (
    <Card title={f.id ? "Editar tarefa" : "Nova tarefa"}>
      <form onSubmit={salvar} className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Rotulo htmlFor="t-desc">Descrição</Rotulo>
          <textarea id="t-desc" rows={4} value={f.descricao} onChange={(e) => set("descricao", e.target.value)} className={`${inputCls} py-2`} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Rotulo htmlFor="t-tit">Título <span className="font-normal text-muted">· se ficar vazio, usa a primeira linha da descrição</span></Rotulo>
          <input id="t-tit" value={f.titulo} onChange={(e) => set("titulo", e.target.value)} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Rotulo htmlFor="t-pes">Responsável</Rotulo>
          <select id="t-pes" value={f.pessoa_id} onChange={(e) => set("pessoa_id", e.target.value)} className={inputCls}>
            <option value="">Sem responsável</option>
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Rotulo htmlFor="t-pra">Prazo</Rotulo>
          <input id="t-pra" type="date" value={f.prazo} onChange={(e) => set("prazo", e.target.value)} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Rotulo htmlFor="t-link">Link</Rotulo>
          <input id="t-link" type="url" value={f.link} onChange={(e) => set("link", e.target.value)} placeholder="https://" className={inputCls} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Rotulo>Etiquetas</Rotulo>
          <div className="flex flex-wrap items-center gap-2">
            {etiquetas.map((e) => {
              const on = f.etiquetas.includes(e.nome);
              return (
                <button key={e.id} type="button" aria-pressed={on} onClick={() => set("etiquetas", on ? f.etiquetas.filter((x) => x !== e.nome) : [...f.etiquetas, e.nome])}
                  className={`rounded-full border-2 ${on ? "border-ink" : "border-transparent opacity-70 hover:opacity-100"}`}>
                  <EtiquetaTag nome={e.nome} cor={e.cor} />
                </button>
              );
            })}
            {nova ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <input autoFocus value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} placeholder="Nome" aria-label="Nome da etiqueta" className="min-h-9 w-36 rounded-lg border border-line px-2 text-sm" />
                <select value={nova.cor} onChange={(e) => setNova({ ...nova, cor: e.target.value })} aria-label="Cor da etiqueta" className="min-h-9 rounded-lg border border-line px-2 text-sm">
                  {Object.entries(CORES_ETIQUETA).map(([k, c]) => <option key={k} value={k}>{c.nome}</option>)}
                </select>
                <button type="button" onClick={criarEtiqueta} className="min-h-9 rounded-lg bg-ink px-3 text-[13px] font-semibold text-white">Criar</button>
                <button type="button" onClick={() => setNova(null)} className="min-h-9 px-2 text-[13px] text-muted">Cancelar</button>
              </span>
            ) : <button type="button" onClick={() => setNova({ nome: "", cor: "green" })} className="text-[13px] font-semibold text-roxo-texto">+ Nova etiqueta</button>}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Rotulo>Imagens</Rotulo>
          <CampoImagens valor={f.imagens} onChange={(v) => set("imagens", v)} />
        </div>
        {erro && <p role="alert" className="m-0 text-sm text-ruim sm:col-span-2">{erro}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className={btnSec} onClick={onCancelar}>Cancelar</button>
          <button type="submit" className={btnPrim} disabled={salvando}>{salvando ? "Salvando…" : f.id ? "Salvar" : "Criar tarefa"}</button>
        </div>
      </form>
    </Card>
  );
}

function Equipe({ pessoas, onSalvo }: { pessoas: Pessoa[]; onSalvo: () => void }) {
  const [edit, setEdit] = useState<Partial<Pessoa> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit?.nome?.trim()) return;
    const campos = { nome: edit.nome.trim(), email: edit.email?.trim().toLowerCase() || null, discord_id: edit.discord_id?.trim() || null, ativo: edit.ativo ?? true };
    const { error } = edit.id ? await supabase.from("equipe").update(campos).eq("id", edit.id) : await supabase.from("equipe").insert(campos);
    if (error) setErro(error.message); else { setEdit(null); setErro(null); onSalvo(); }
  };
  return (
    <div className="mt-3">
      <ul className="m-0 list-none p-0">
        {pessoas.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 border-t border-soft py-2.5 text-sm">
            <span className={`flex-auto font-semibold ${p.ativo ? "" : "text-muted line-through"}`}>{p.nome}</span>
            <span className="text-xs text-muted">{p.email ?? "sem login"} · {p.discord_id ? "Discord ligado" : "sem Discord"}</span>
            <button type="button" className="text-[13px] font-semibold text-roxo-texto" onClick={() => setEdit(p)}>Editar</button>
          </li>
        ))}
      </ul>
      {edit ? (
        <form onSubmit={salvar} className="mt-3 grid gap-3 sm:grid-cols-4">
          <input aria-label="Nome" placeholder="Nome" value={edit.nome ?? ""} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} className={inputCls} />
          <input aria-label="E-mail de login" placeholder="E-mail de login" value={edit.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} className={inputCls} />
          <input aria-label="ID do Discord" placeholder="ID do Discord" value={edit.discord_id ?? ""} onChange={(e) => setEdit({ ...edit, discord_id: e.target.value })} className={inputCls} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.ativo ?? true} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} className="h-4 w-4" />Ativo</label>
          {erro && <p role="alert" className="m-0 text-sm text-ruim sm:col-span-4">{erro}</p>}
          <div className="flex gap-2 sm:col-span-4"><button type="submit" className={btnPrim}>Salvar</button><button type="button" className={btnSec} onClick={() => setEdit(null)}>Cancelar</button></div>
        </form>
      ) : <button type="button" className={`${btnSec} mt-3`} onClick={() => setEdit({ nome: "", ativo: true })}>Adicionar pessoa</button>}
    </div>
  );
}
