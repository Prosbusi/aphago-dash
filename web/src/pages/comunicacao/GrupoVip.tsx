import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useDataVersion } from "../../lib/data";
import { nomeLoja, useStoreParam } from "../../lib/store";
import { money, num } from "../../lib/format";
import { addDays, todaySP } from "../../lib/period";
import { Card, Empty, ErrorBox, Kpi, Loading, PageTitle } from "../../components/ui";
import { Farolzinho } from "../../components/Farolzinho";
import { btnPrim, btnSec, inputCls } from "../../components/time";

type Status = "rascunho" | "aprovado" | "enviado" | "erro" | "cancelado";
type Envio = {
  id: string; campanha: string; enviar_em: string; titulo: string; texto: string; url: string; utm_content: string; link: string;
  cupom: string | null; imagem_url: string | null; status: Status; enviado_em: string | null; envio_obs: string | null;
  criado_por: string | null; atualizado_por: string | null; grupos: string[] | null; aplicar_cupom: boolean;
  extras: { link_original?: string; enviados?: string[] } | null;
  pecas: { grupo: string | null; nome: string | null; link: string; texto: string; enviado: boolean }[];
  por_grupo: { grupo: string; pedidos: number; vendas: number }[];
  pedidos: number; vendas: number; ultimo_clique: number; novos: number; cupom_pedidos: number; cupom_vendas: number;
};
type Grupo = { codigo: string; nome: string; ativo: boolean };
type Rascunho = {
  id?: string; data: string; hora: string; campanha: string; tema: string; texto: string; url: string; cupom: string; imagem_url: string;
  grupos: string[] | null; aplicar_cupom: boolean;
};

const CANAL = "vip";
const TZ = "America/Sao_Paulo";
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const diaSP = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const horaSP = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const tituloDia = (d: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00Z`)).replace(".", "");
const fimDoMes = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
const mudaMes = (mes: string, n: number) => {
  const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const SITE: Record<string, string> = { aphago: "https://www.aphago.com.br", abrasso: "https://abrasso.com.br" };
const enc = (s: string) => s.replace(/%/g, "%25").replace(/ /g, "%20").replace(/\//g, "%2F").replace(/\?/g, "%3F").replace(/=/g, "%3D").replace(/&/g, "%26").replace(/#/g, "%23").replace(/\+/g, "%2B");

/** Mesma regra do banco (comunicacao_link): UTM do Grupo VIP, utm_term = grupo e, com cupom, /discount/CUPOM?redirect=… */
function previaLink(r: Rascunho, store: string, grupo: string | null) {
  const url = r.url.trim();
  const cupom = r.cupom.trim().toUpperCase();
  if (/(utm_source=|utm_source%3D)/i.test(url)) return url;
  if (!url && !(cupom && r.aplicar_cupom)) return "";
  const ddmm = `${r.data.slice(8, 10)}${r.data.slice(5, 7)}`;
  const t = slug(r.tema);
  const content = t ? (/^\d{4}-/.test(t) ? t : `${ddmm}-${t}`) : `${ddmm}-${Number(r.hora.slice(0, 2))}h`;
  const origem = url.match(/^(https?:\/\/[^/?#]+)/)?.[1] ?? SITE[store];
  const caminho = url.replace(/^https?:\/\/[^/?#]+/, "") || "/";
  const destino = `${caminho}${caminho.includes("?") ? "&" : "?"}utm_source=whatsapp&utm_medium=grupo-vip&utm_campaign=${slug(r.campanha) || "sem-campanha"}&utm_content=${content}${grupo ? `&utm_term=${grupo}` : ""}`;
  return cupom && r.aplicar_cupom ? `${origem}/discount/${cupom}?redirect=${enc(destino)}` : `${origem}${destino}`;
}

/** Texto final: {link} vira o link; sem {link}, o link vai no fim. */
const textoFinal = (texto: string, link: string) => (texto.includes("{link}") ? texto.split("{link}").join(link) : link ? `${texto}\n${link}` : texto);

const STATUS: Record<Status, { nome: string; cls: string }> = {
  rascunho: { nome: "Rascunho", cls: "border-line bg-soft text-body" },
  aprovado: { nome: "Aprovada", cls: "border-roxo/40 bg-roxo-claro/60 text-roxo-texto" },
  enviado: { nome: "Enviada", cls: "border-bom/30 bg-[#E3F4EA] text-bom" },
  erro: { nome: "Erro no envio", cls: "border-coral/50 bg-[#FFE9E9] text-ruim" },
  cancelado: { nome: "Cancelada", cls: "border-line bg-white text-muted line-through" },
};

function useEnvios(store: string, inicio: string, fim: string, tick: number) {
  const v = useDataVersion();
  const [st, setSt] = useState<{ data?: Envio[]; error?: string }>({});
  useEffect(() => {
    let vivo = true;
    supabase.rpc("comunicacao_lista", { p_store: store, p_canal: CANAL, p_inicio: inicio, p_fim: fim }).then(({ data, error }) => {
      if (!vivo) return;
      setSt(error ? { error: error.message } : { data: (data ?? []) as Envio[] });
    });
    return () => { vivo = false; };
  }, [store, inicio, fim, v, tick]);
  return st;
}

function useGrupos(store: string, tick: number) {
  const [g, setG] = useState<Grupo[]>([]);
  useEffect(() => {
    supabase.rpc("comunicacao_grupos_lista", { p_store: store, p_canal: CANAL }).then(({ data }) => setG((data ?? []) as Grupo[]));
  }, [store, tick]);
  return g;
}

export function GrupoVip() {
  const store = useStoreParam();
  const hoje = todaySP();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [tick, setTick] = useState(0);
  const inicio = `${mes}-01`;
  const fimMes = fimDoMes(mes);
  const fimBusca = addDays(hoje, 7) > fimMes ? addDays(hoje, 7) : fimMes;
  const { data, error } = useEnvios(store, inicio, fimBusca, tick);
  const grupos = useGrupos(store, tick);
  const nomeGrupo = (c: string) => grupos.find((g) => g.codigo === c)?.nome ?? c;
  const [vendoGrupos, setVendoGrupos] = useState(false);
  const [editando, setEditando] = useState<Rascunho | null>(null);
  const [importando, setImportando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const recarregar = () => setTick((t) => t + 1);

  const doMes = useMemo(() => (data ?? []).filter((e) => diaSP(e.enviar_em).slice(0, 7) === mes), [data, mes]);
  const campanhas = useMemo(() => [...new Set((data ?? []).map((e) => e.campanha).filter(Boolean))], [data]);
  const porDia = useMemo(() => {
    const m = new Map<string, Envio[]>();
    for (const e of doMes) m.set(diaSP(e.enviar_em), [...(m.get(diaSP(e.enviar_em)) ?? []), e]);
    return [...m.entries()];
  }, [doMes]);

  // dias dos próximos 7 sem nenhuma mensagem aprovada
  const semMensagem = useMemo(() => {
    if (!data) return [];
    const ok = new Set(data.filter((e) => e.status === "aprovado" || e.status === "enviado").map((e) => diaSP(e.enviar_em)));
    return Array.from({ length: 7 }, (_, i) => addDays(hoje, i)).filter((d) => !ok.has(d));
  }, [data, hoje]);

  const rascunhos = doMes.filter((e) => e.status === "rascunho");
  const enviados = doMes.filter((e) => e.status === "enviado");
  const tot = enviados.reduce((a, e) => ({ pedidos: a.pedidos + e.pedidos, vendas: a.vendas + e.vendas, cupom: a.cupom + e.cupom_pedidos }), { pedidos: 0, vendas: 0, cupom: 0 });

  async function salvar(p: Record<string, unknown>) {
    const { error } = await supabase.rpc("comunicacao_salvar", { p_store: store, p_canal: CANAL, p });
    if (error) { setAviso(`Não deu para salvar: ${error.message}`); return false; }
    recarregar();
    return true;
  }

  async function aprovarTodos() {
    for (const e of rascunhos) await supabase.rpc("comunicacao_salvar", { p_store: store, p_canal: CANAL, p: { id: e.id, status: "aprovado" } });
    setAviso(`${rascunhos.length} ${rascunhos.length === 1 ? "mensagem aprovada" : "mensagens aprovadas"}.`);
    recarregar();
  }

  async function apagar(e: Envio) {
    if (!window.confirm("Apagar esta mensagem?")) return;
    const { error } = await supabase.rpc("comunicacao_apagar", { p_store: store, p_id: e.id });
    if (error) setAviso(error.message); else recarregar();
  }

  const novo = (data = hoje < inicio ? inicio : hoje): Rascunho => ({
    data, hora: "09:00", campanha: campanhas[campanhas.length - 1] ?? "", tema: "", texto: "", url: "", cupom: "", imagem_url: "", grupos: null, aplicar_cupom: true,
  });
  const editar = (e: Envio): Rascunho => ({
    id: e.id, data: diaSP(e.enviar_em), hora: horaSP(e.enviar_em), campanha: e.campanha, tema: e.utm_content, texto: e.texto,
    url: e.url, cupom: e.cupom ?? "", imagem_url: e.imagem_url ?? "", grupos: e.grupos, aplicar_cupom: e.aplicar_cupom,
  });

  return (
    <>
      <PageTitle
        title="Grupo VIP"
        sub={`${nomeLoja(store)} · mensagens do grupo no WhatsApp. O Grok envia as aprovadas no horário marcado.`}
        right={
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSec} onClick={() => setVendoGrupos((v) => !v)}>Grupos ({grupos.filter((g) => g.ativo).length})</button>
            <button type="button" className={btnSec} onClick={() => { setImportando((v) => !v); setEditando(null); }}>Importar planejamento</button>
            <button type="button" className={btnPrim} onClick={() => { setEditando(novo()); setImportando(false); }}>Nova mensagem</button>
          </div>
        }
      />

      {aviso && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm">
          {aviso}
          <button type="button" className="text-xs font-bold text-muted" onClick={() => setAviso(null)}>Fechar</button>
        </div>
      )}

      {semMensagem.length > 0 && data && (
        <div className="flex items-center gap-4 rounded-2xl border border-sol bg-[#FFF7D6] px-5 py-4 text-sm">
          <Farolzinho tamanho={48} humor="pensando" />
          <div>
            <p className="m-0 font-extrabold">Tem dia sem mensagem aprovada nos próximos 7 dias</p>
            <p className="m-0 mt-0.5 text-body">{semMensagem.map((d) => (d === hoje ? "hoje" : tituloDia(d))).join(" · ")}. Nesses dias o Grok não envia nada.</p>
          </div>
        </div>
      )}

      {vendoGrupos && <Grupos store={store} grupos={grupos} onMudou={recarregar} />}
      {importando && <Importar store={store} onFeito={(n) => { setImportando(false); setAviso(`${n} ${n === 1 ? "mensagem importada" : "mensagens importadas"} como rascunho. Confira e aprove.`); recarregar(); }} />}
      {editando && <Editor r={editando} store={store} grupos={grupos.filter((g) => g.ativo)} campanhas={campanhas} onCancelar={() => setEditando(null)} onSalvar={async (r, status) => {
        const ok = await salvar({
          id: r.id, campanha: r.campanha, enviar_em: `${r.data}T${r.hora}:00-03:00`, texto: r.texto, url: r.url, cupom: r.cupom,
          imagem_url: r.imagem_url, utm_content: r.tema, grupos: r.grupos, aplicar_cupom: r.aplicar_cupom, ...(status ? { status } : {}),
        });
        if (ok) setEditando(null);
      }} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-2xl border border-line bg-white p-1">
          <button type="button" aria-label="Mês anterior" className="min-h-9 rounded-xl px-3 font-bold hover:bg-soft" onClick={() => setMes((m) => mudaMes(m, -1))}>‹</button>
          <span className="min-w-[150px] text-center text-sm font-extrabold capitalize">{MESES[Number(mes.slice(5, 7)) - 1]} {mes.slice(0, 4)}</span>
          <button type="button" aria-label="Próximo mês" className="min-h-9 rounded-xl px-3 font-bold hover:bg-soft" onClick={() => setMes((m) => mudaMes(m, 1))}>›</button>
        </div>
        {rascunhos.length > 0 && (
          <button type="button" className={btnSec} onClick={aprovarTodos}>Aprovar {rascunhos.length} {rascunhos.length === 1 ? "rascunho" : "rascunhos"} do mês</button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Mensagens no mês" value={num(doMes.filter((e) => e.status !== "cancelado").length)} sub={`${num(enviados.length)} enviadas · ${num(rascunhos.length)} em rascunho`} />
        <Kpi label="Pedidos pelo link" value={num(tot.pedidos)} sub="das mensagens enviadas" />
        <Kpi label="Vendas pelo link" value={money(tot.vendas)} sub={enviados.length ? `${money(tot.vendas / enviados.length)} por mensagem` : undefined} />
        <Kpi label="Pedidos com o cupom" value={num(tot.cupom)} sub="nos 7 dias depois do envio" />
      </div>

      {error && <ErrorBox message={error} />}
      {!data && !error && <Loading />}
      {data && !porDia.length && (
        <Card><Empty>Nenhuma mensagem neste mês. Crie uma nova ou importe o planejamento.</Empty></Card>
      )}

      {porDia.map(([dia, envios]) => (
        <section key={dia} className="flex flex-col gap-3">
          <h2 className="m-0 text-sm font-extrabold capitalize text-muted">{dia === hoje ? `Hoje · ${tituloDia(dia)}` : tituloDia(dia)}</h2>
          {envios.map((e) => (
            <Linha key={e.id} e={e} hoje={hoje} nomeGrupo={nomeGrupo}
              onEditar={() => { setEditando(editar(e)); setImportando(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              onStatus={(status) => salvar({ id: e.id, status })}
              onApagar={() => apagar(e)}
              onCopiar={(p) => { navigator.clipboard?.writeText(p.texto); setAviso(`Texto do ${p.nome ?? "envio"} copiado, com o link desse grupo.`); }}
            />
          ))}
        </section>
      ))}
    </>
  );
}

function Bolha({ texto, imagem }: { texto: string; imagem?: string | null }) {
  return (
    <div className="max-w-[460px] rounded-2xl rounded-tl-md bg-[#E7F8DC] px-4 py-3 text-[14px] leading-relaxed text-[#1F2A1B]">
      {imagem && <img src={imagem} alt="" className="mb-2 max-h-48 w-full rounded-xl object-cover" />}
      <p className="m-0 whitespace-pre-wrap break-words">
        {texto ? texto.split(/(https?:\/\/\S+)/).map((t, i) => (i % 2 ? <span key={i} className="break-all text-[12.5px] text-[#2B6CB0]">{t}</span> : t)) : <span className="text-muted">Sem texto</span>}
      </p>
    </div>
  );
}

function Linha({ e, hoje, nomeGrupo, onEditar, onStatus, onApagar, onCopiar }: {
  e: Envio; hoje: string; nomeGrupo: (c: string) => string; onEditar: () => void; onStatus: (s: Status) => void; onApagar: () => void;
  onCopiar: (p: Envio["pecas"][number]) => void;
}) {
  const s = STATUS[e.status];
  const passou = diaSP(e.enviar_em) <= hoje;
  const primeira = e.pecas[0];
  return (
    <article className="grid gap-4 rounded-[18px] border border-line bg-white p-5 md:grid-cols-[92px_minmax(0,1fr)_220px]">
      <div className="flex flex-row items-center gap-3 md:flex-col md:items-start">
        <span className="text-2xl font-black tracking-tight">{horaSP(e.enviar_em)}</span>
        <span className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${s.cls}`}>{s.nome}</span>
      </div>
      <div className="min-w-0">
        <Bolha texto={primeira?.texto ?? textoFinal(e.texto, e.link)} imagem={e.imagem_url} />
        {e.pecas.some((p) => p.grupo) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold text-muted">Grupos:</span>
            {e.pecas.map((p) => (
              <button key={p.grupo} type="button" title="Copiar o texto deste grupo" onClick={() => onCopiar(p)}
                className={`rounded-full border px-2.5 py-0.5 font-bold ${p.enviado || e.status === "enviado" ? "border-bom/30 bg-[#E3F4EA] text-bom" : "border-line bg-white text-body hover:bg-soft"}`}>
                {(p.enviado || e.status === "enviado") && "✓ "}{p.nome}
              </button>
            ))}
          </div>
        )}
        <p className="mb-0 mt-2 text-xs text-muted">
          {e.campanha && <>Campanha <strong className="text-body">{e.campanha}</strong> · </>}
          utm_content <code className="rounded bg-soft px-1">{e.utm_content}</code>
          {e.cupom && <> · cupom <strong className="text-body">{e.cupom}</strong></>}
          {e.status === "enviado" && e.enviado_em && <> · enviada às {horaSP(e.enviado_em)}{e.atualizado_por === "grok" ? " pelo Grok" : ""}</>}
        </p>
        {e.status === "erro" && e.envio_obs && <p className="mb-0 mt-1 text-xs font-semibold text-ruim">Motivo: {e.envio_obs}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {e.status !== "enviado" && <button type="button" className={btnSec} onClick={onEditar}>Editar</button>}
          {e.status === "rascunho" && <button type="button" className={btnPrim} onClick={() => onStatus("aprovado")}>Aprovar</button>}
          {(e.status === "aprovado" || e.status === "erro") && <button type="button" className={btnSec} onClick={() => onStatus("rascunho")}>Voltar para rascunho</button>}
          {(e.status === "aprovado" || e.status === "erro") && passou && <button type="button" className={btnSec} onClick={() => onStatus("enviado")}>Marcar como enviada</button>}
          {!e.pecas.some((p) => p.grupo) && primeira && <button type="button" className={btnSec} onClick={() => onCopiar(primeira)}>Copiar</button>}
          {e.status !== "enviado" && <button type="button" className="min-h-10 rounded-lg px-3 text-sm font-semibold text-ruim hover:bg-[#FFE9E9]" onClick={onApagar}>Apagar</button>}
        </div>
      </div>
      <div className="rounded-2xl bg-ground p-4 text-sm">
        {e.status === "enviado" ? (
          <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2">
            <dt className="text-xs font-semibold text-muted">Pedidos</dt><dd className="m-0 text-right font-extrabold">{num(e.pedidos)}</dd>
            <dt className="text-xs font-semibold text-muted">Vendas</dt><dd className="m-0 text-right font-extrabold">{money(e.vendas)}</dd>
            <dt className="text-xs font-semibold text-muted">Último clique</dt><dd className="m-0 text-right font-bold">{num(e.ultimo_clique)}</dd>
            <dt className="text-xs font-semibold text-muted">Clientes novos</dt><dd className="m-0 text-right font-bold">{num(e.novos)}</dd>
            {e.cupom && <><dt className="text-xs font-semibold text-muted">Com o cupom</dt><dd className="m-0 text-right font-bold">{num(e.cupom_pedidos)} · {money(e.cupom_vendas)}</dd></>}
            {e.por_grupo.map((g) => (
              <Fragment key={g.grupo}><dt className="text-xs text-muted">{nomeGrupo(g.grupo)}</dt><dd className="m-0 text-right text-xs font-semibold">{num(g.pedidos)} · {money(g.vendas)}</dd></Fragment>
            ))}
          </dl>
        ) : (
          <p className="m-0 text-xs text-muted">O resultado aparece aqui depois do envio: pedidos e vendas que passaram pelo link e uso do cupom.</p>
        )}
      </div>
    </article>
  );
}

function Editor({ r: inicial, store, grupos, campanhas, onCancelar, onSalvar }: {
  r: Rascunho; store: string; grupos: Grupo[]; campanhas: string[]; onCancelar: () => void; onSalvar: (r: Rascunho, status?: Status) => Promise<void>;
}) {
  const [r, setR] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const set = (k: keyof Rascunho) => (ev: { target: { value: string } }) => setR((x) => ({ ...x, [k]: ev.target.value }));
  const valido = r.data && r.hora && r.texto.trim() && (r.grupos === null || r.grupos.length > 0);
  const marcados = r.grupos ?? grupos.map((g) => g.codigo);
  const alternar = (c: string) => setR((x) => {
    const atual = x.grupos ?? grupos.map((g) => g.codigo);
    const novo = atual.includes(c) ? atual.filter((y) => y !== c) : [...atual, c];
    return { ...x, grupos: novo.length === grupos.length ? null : novo };
  });
  const [previa, setPrevia] = useState<string | null>(null);
  const grupoPrevia = previa ?? marcados[0] ?? null;
  const ir = async (status?: Status) => { setSalvando(true); await onSalvar(r, status); setSalvando(false); };
  return (
    <Card title={r.id ? "Editar mensagem" : "Nova mensagem"}>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold">Dia<input type="date" className={`${inputCls} mt-1`} value={r.data} onChange={set("data")} /></label>
          <label className="text-xs font-semibold">Horário<input type="time" className={`${inputCls} mt-1`} value={r.hora} onChange={set("hora")} /></label>
          <label className="text-xs font-semibold sm:col-span-2">Mensagem
            <textarea rows={8} className={`${inputCls} mt-1 py-2`} value={r.texto} onChange={set("texto")} placeholder={"Texto que vai no grupo. Pode usar emoji e *negrito* do WhatsApp.\n\n👉 Link com desconto:\n{link}"} />
            <span className="mt-1 block font-normal text-muted">Escreva <code className="rounded bg-soft px-1">{"{link}"}</code> onde o link deve entrar. Cada grupo recebe o seu link.</span>
          </label>
          <label className="text-xs font-semibold sm:col-span-2">Link de destino (sem UTM)
            <input className={`${inputCls} mt-1`} value={r.url} onChange={set("url")} placeholder="https://www.aphago.com.br/collections/natal" />
          </label>
          <label className="text-xs font-semibold">Campanha
            <input list="vip-campanhas" className={`${inputCls} mt-1`} value={r.campanha} onChange={set("campanha")} placeholder="Natal VIP" />
            <datalist id="vip-campanhas">{campanhas.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="text-xs font-semibold">Tema (fim do utm_content)
            <input className={`${inputCls} mt-1`} value={r.tema} onChange={set("tema")} placeholder="meu-crush (opcional)" />
          </label>
          <label className="text-xs font-semibold">Cupom
            <input className={`${inputCls} mt-1 uppercase`} value={r.cupom} onChange={set("cupom")} placeholder="VIP60 (opcional)" />
          </label>
          <label className="text-xs font-semibold">Imagem (link)
            <input className={`${inputCls} mt-1`} value={r.imagem_url} onChange={set("imagem_url")} placeholder="https://cdn.shopify.com/… (opcional)" />
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold sm:col-span-2">
            <input type="checkbox" className="h-4 w-4" checked={r.aplicar_cupom} onChange={(e) => setR((x) => ({ ...x, aplicar_cupom: e.target.checked }))} />
            O link já aplica o cupom no carrinho (/discount/CUPOM)
          </label>
          {grupos.length > 0 && (
            <fieldset className="m-0 border-0 p-0 sm:col-span-2">
              <legend className="text-xs font-semibold">Enviar para</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {grupos.map((g) => (
                  <label key={g.codigo} className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${marcados.includes(g.codigo) ? "border-roxo/50 bg-roxo-claro/50" : "border-line bg-white"}`}>
                    <input type="checkbox" className="h-4 w-4" checked={marcados.includes(g.codigo)} onChange={() => alternar(g.codigo)} />
                    {g.nome}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <p className="m-0 mr-1 text-xs font-semibold text-muted">Como vai aparecer</p>
            {marcados.length > 1 && marcados.map((c) => (
              <button key={c} type="button" onClick={() => setPrevia(c)}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${c === grupoPrevia ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>
                {grupos.find((g) => g.codigo === c)?.nome ?? c}
              </button>
            ))}
          </div>
          <div className="rounded-2xl bg-[#EFE7DC] p-4"><Bolha texto={textoFinal(r.texto, previaLink(r, store, grupoPrevia))} imagem={r.imagem_url || null} /></div>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className={btnPrim} disabled={!valido || salvando} onClick={() => ir("aprovado")}>Salvar e aprovar</button>
        <button type="button" className={btnSec} disabled={!valido || salvando} onClick={() => ir(r.id ? undefined : "rascunho")}>{r.id ? "Salvar" : "Salvar como rascunho"}</button>
        <button type="button" className={btnSec} onClick={onCancelar}>Cancelar</button>
      </div>
    </Card>
  );
}

// ---------- Importar planejamento (JSON ou planilha colada) ----------

type Item = { enviar_em: string; texto: string; url: string; cupom: string; campanha: string; tema: string; imagem_url: string; grupos?: string[] };
const ALIAS: Record<string, keyof Item | "data" | "hora"> = {
  data: "data", dia: "data", hora: "hora", horario: "hora", "horário": "hora", enviar_em: "enviar_em", sendat: "enviar_em",
  texto: "texto", mensagem: "texto", message: "texto", url: "url", link: "url", cupom: "cupom", campanha: "campanha",
  tema: "tema", utm_content: "tema", imagem: "imagem_url", imagem_url: "imagem_url", imageurl: "imagem_url",
};

function quando(data: string, hora: string, enviar_em: string) {
  if (enviar_em) {
    const t = enviar_em.trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) return `${t}:00-03:00`;
    return t;
  }
  let d = data.trim();
  const br = d.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (br) d = `${br[3] ? (br[3].length === 2 ? `20${br[3]}` : br[3]) : todaySP().slice(0, 4)}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const h = (hora.trim() || "09:00").replace(/h$/i, ":00").padStart(5, "0");
  return `${d}T${h.length === 4 ? `0${h}` : h}:00-03:00`;
}

function lerPlanejamento(txt: string): { itens: Item[]; erro?: string } {
  const t = txt.trim();
  if (!t) return { itens: [] };
  try {
    if (t.startsWith("[") || t.startsWith("{")) {
      const j = JSON.parse(t);
      const lista = (Array.isArray(j) ? j : j.itens ?? j.mensagens ?? []) as Record<string, unknown>[];
      return {
        itens: lista.map((o) => {
          const it = normalizar(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v ?? "")])));
          return Array.isArray(o.grupos) ? { ...it, grupos: (o.grupos as unknown[]).map(String) } : it;
        }),
      };
    }
    const linhas = t.split(/\r?\n/).filter((l) => l.trim());
    const sep = linhas[0].includes("\t") ? "\t" : linhas[0].includes(";") ? ";" : ",";
    const cab = linhas[0].split(sep).map((c) => c.trim().toLowerCase());
    return {
      itens: linhas.slice(1).map((l) => {
        const cols = l.split(sep);
        return normalizar(Object.fromEntries(cab.map((c, i) => [c, (cols[i] ?? "").trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n")])));
      }),
    };
  } catch (e) {
    return { itens: [], erro: `Não consegui ler: ${(e as Error).message}` };
  }
}

function normalizar(o: Record<string, string>): Item {
  const v: Record<string, string> = {};
  for (const [k, val] of Object.entries(o)) {
    const a = ALIAS[k.trim().toLowerCase()];
    if (a) v[a] = val;
  }
  return {
    enviar_em: quando(v.data ?? "", v.hora ?? "", v.enviar_em ?? ""), texto: v.texto ?? "", url: v.url ?? "", cupom: v.cupom ?? "",
    campanha: v.campanha ?? "", tema: v.tema ?? "", imagem_url: v.imagem_url ?? "",
  };
}

const MODELO_PEDIDO = `Me devolva o planejamento do Grupo VIP em JSON, uma lista assim:
[{"data": "01/12", "hora": "09:00", "campanha": "natal-vip", "tema": "meu-crush", "cupom": "VIPCRUSH50", "url": "https://www.aphago.com.br/products/meu-crush", "imagem": "https://cdn.shopify.com/…", "texto": "❤️ *OFERTA VIP DO DIA: 50% OFF*\n\n…\n\n🎟️ Cupom: *VIPCRUSH50*\n👉 Link com desconto:\n{link}\n\n⏰ Só hoje."}]
Regras: url é a página sem UTM e sem /discount (o Pharol monta o link de cada grupo, já com o cupom e as UTMs). No texto, escreva {link} onde o link entra. tema = produto em poucas palavras (vira o utm_content com a data). Nos dias com várias mensagens, uma linha por horário; o tema pode ficar vazio (vira 2611-9h, 2611-13h…).`;

function Importar({ store, onFeito }: { store: string; onFeito: (n: number) => void }) {
  const [txt, setTxt] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const lido = useMemo(() => lerPlanejamento(txt), [txt]);
  const invalidos = lido.itens.filter((i) => isNaN(new Date(i.enviar_em).getTime()) || !i.texto.trim());

  async function importar() {
    setEnviando(true);
    setErro(null);
    const { data, error } = await supabase.rpc("comunicacao_importar", { p_store: store, p_canal: CANAL, p_itens: lido.itens.map((i) => ({ ...i, enviar_em: new Date(i.enviar_em).toISOString() })) });
    setEnviando(false);
    if (error) setErro(error.message); else onFeito(Number(data ?? 0));
  }

  return (
    <Card title="Importar planejamento">
      <p className="mb-0 mt-1 text-sm text-muted">
        Cole aqui o que o Claude gerou: JSON ou planilha (colunas <strong>data, hora, texto, url, cupom, campanha, tema</strong>). Tudo entra como rascunho para você conferir e aprovar.
        O Grok também consegue mandar direto com a ação <code>planejar_envios</code>.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btnSec} onClick={() => navigator.clipboard?.writeText(MODELO_PEDIDO)}>Copiar pedido de formato para o Claude</button>
      </div>
      <textarea rows={8} className={`${inputCls} mt-3 py-2 font-mono text-xs`} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={'[{"data": "01/12", "hora": "09:00", "texto": "…", "url": "https://…", "cupom": "VIP60"}]'} />
      {lido.erro && <p className="mb-0 mt-2 text-sm font-semibold text-ruim">{lido.erro}</p>}
      {erro && <p className="mb-0 mt-2 text-sm font-semibold text-ruim">{erro}</p>}
      {lido.itens.length > 0 && (
        <div className="mt-3 rounded-2xl bg-ground p-4 text-sm">
          <p className="m-0 font-bold">{lido.itens.length} {lido.itens.length === 1 ? "mensagem encontrada" : "mensagens encontradas"}{invalidos.length ? ` · ${invalidos.length} sem data ou texto` : ""}</p>
          <ul className="mb-0 mt-2 list-none space-y-1 p-0 text-xs text-body">
            {lido.itens.slice(0, 5).map((i, n) => (
              <li key={n}><strong>{isNaN(new Date(i.enviar_em).getTime()) ? "data inválida" : `${tituloDia(diaSP(i.enviar_em))} ${horaSP(i.enviar_em)}`}</strong> · {i.texto.slice(0, 90)}{i.texto.length > 90 ? "…" : ""}</li>
            ))}
            {lido.itens.length > 5 && <li>e mais {lido.itens.length - 5}…</li>}
          </ul>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" className={btnPrim} disabled={!lido.itens.length || invalidos.length > 0 || enviando} onClick={importar}>
          {enviando ? "Importando…" : `Importar ${lido.itens.length || ""} como rascunho`}
        </button>
      </div>
    </Card>
  );
}

function Grupos({ store, grupos, onMudou }: { store: string; grupos: Grupo[]; onMudou: () => void }) {
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [novo, setNovo] = useState({ codigo: "", nome: "" });
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(codigo: string, nome: string, ativo: boolean) {
    const { error } = await supabase.rpc("comunicacao_grupo_salvar", { p_store: store, p_canal: CANAL, p_codigo: codigo, p_nome: nome, p_ativo: ativo });
    if (error) setErro(error.message); else { setErro(null); onMudou(); }
  }
  return (
    <Card title="Grupos VIP">
      <p className="mb-0 mt-1 text-sm text-muted">
        Cada grupo recebe a mesma mensagem com o seu próprio link. O código do grupo vai no <code>utm_term</code>, e é assim que o Pharol separa os pedidos de cada grupo.
        Não troque o código de um grupo que já recebeu mensagens.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {grupos.map((g) => (
          <div key={g.codigo} className="flex flex-wrap items-center gap-2">
            <code className="w-16 rounded bg-soft px-2 py-1 text-xs">{g.codigo}</code>
            <input className={`${inputCls} max-w-xs`} value={nomes[g.codigo] ?? g.nome} onChange={(e) => setNomes((n) => ({ ...n, [g.codigo]: e.target.value }))} />
            <button type="button" className={btnSec} onClick={() => salvar(g.codigo, nomes[g.codigo] ?? g.nome, g.ativo)}>Salvar nome</button>
            <button type="button" className={btnSec} onClick={() => salvar(g.codigo, g.nome, !g.ativo)}>{g.ativo ? "Desativar" : "Reativar"}</button>
            {!g.ativo && <span className="text-xs font-semibold text-muted">desativado: não recebe mensagens</span>}
          </div>
        ))}
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <input className={`${inputCls} w-24`} placeholder="vip4" value={novo.codigo} onChange={(e) => setNovo((n) => ({ ...n, codigo: e.target.value }))} />
          <input className={`${inputCls} max-w-xs`} placeholder="Nome do grupo" value={novo.nome} onChange={(e) => setNovo((n) => ({ ...n, nome: e.target.value }))} />
          <button type="button" className={btnPrim} disabled={!novo.codigo.trim() || !novo.nome.trim()} onClick={async () => { await salvar(novo.codigo, novo.nome, true); setNovo({ codigo: "", nome: "" }); }}>Adicionar grupo</button>
        </div>
        {erro && <p className="m-0 text-sm font-semibold text-ruim">{erro}</p>}
      </div>
    </Card>
  );
}
