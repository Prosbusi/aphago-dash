import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { fetchAll, supabase } from "../lib/supabase";
import { clearDataCache } from "../lib/data";
import { CANAIS, montarCampanha, montarLink, normalizarDestino, destinoLimpo, slug } from "../lib/utm";
import { Card, Empty, ErrorBox, Loading, PageTitle } from "../components/ui";

type Acao = { acao: string; nome: string; tipo: string | null };
type LinkSalvo = {
  id: number;
  created_at: string;
  created_by: string;
  canal: string;
  destino: string;
  campaign: string;
  content: string | null;
  url: string;
  nota: string | null;
};

const TIPOS = [
  { v: "lancamento", nome: "Lançamento" },
  { v: "promo", nome: "Promoção" },
  { v: "perpetuo", nome: "Perpétuo" },
  { v: "remarketing", nome: "Remarketing" },
  { v: "relacionamento", nome: "Relacionamento" },
];

const DESTINO_PADRAO = "https://aphago.com.br/";
const quando = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const t = document.createElement("textarea");
    t.value = texto;
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  }
}

export function Links() {
  const { session, isAdmin } = useAuth();
  const eu = (session.user.email ?? "").toLowerCase();

  const [acoes, setAcoes] = useState<Acao[] | null>(null);
  const [links, setLinks] = useState<LinkSalvo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [canalId, setCanalId] = useState(CANAIS[0].id);
  const [destino, setDestino] = useState(DESTINO_PADRAO);
  const [acao, setAcao] = useState("");
  const [detalhe, setDetalhe] = useState("");
  const [content, setContent] = useState("");
  const [term, setTerm] = useState("");
  const [nota, setNota] = useState("");
  const [novaNome, setNovaNome] = useState("");
  const [novaTipo, setNovaTipo] = useState("promo");

  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiadoId, setCopiadoId] = useState<number | null>(null);
  const [busca, setBusca] = useState("");

  const carregar = async () => {
    try {
      const [a, l] = await Promise.all([
        fetchAll<Acao>((f, t) => supabase.from("action_map").select("acao,nome,tipo").order("acao").range(f, t)),
        supabase.from("utm_links").select("id,created_at,created_by,canal,destino,campaign,content,url,nota").order("created_at", { ascending: false }).limit(200),
      ]);
      if (l.error) throw new Error(l.error.message);
      setAcoes(a);
      setLinks(l.data ?? []);
    } catch (e) {
      setErro((e as Error).message);
    }
  };
  useEffect(() => { carregar(); }, []);

  const canal = CANAIS.find((c) => c.id === canalId)!;
  const acaoSlug = slug(acao);
  const acaoExistente = acoes?.find((a) => a.acao === acaoSlug);
  const acaoNova = !!acaoSlug && acoes !== null && !acaoExistente;
  const url = normalizarDestino(destino);
  const foraDaLoja = url && !/(^|\.)aphago\.com\.br$/.test(url.hostname);
  const campaign = acaoSlug ? montarCampanha(acao, detalhe) : "";
  const contentSlug = slug(content);
  const termSlug = slug(term);
  const pronto = !!url && !!acaoSlug && (!acaoNova || !!novaNome.trim());
  const link = url && acaoSlug ? montarLink(url, { source: canal.source, medium: canal.medium, campaign, content: contentSlug, term: termSlug }) : "";

  // nome sugerido para a ação nova, a partir do que foi digitado
  useEffect(() => { if (acaoNova) setNovaNome(acao.trim()); }, [acaoSlug, acaoNova]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (msg: string) => { setAviso(msg); window.setTimeout(() => setAviso(null), 3500); };

  const salvarECopiar = async () => {
    if (!pronto || !url) return;
    setSalvando(true);
    setErro(null);
    if (acaoNova) {
      const { error } = await supabase.from("action_map").insert({ acao: acaoSlug, nome: novaNome.trim(), tipo: novaTipo });
      if (error && error.code !== "23505") { setSalvando(false); setErro(error.message); return; }
      clearDataCache();
    }
    const { error } = await supabase.from("utm_links").insert({
      canal: canal.nome,
      destino: destinoLimpo(url),
      source: canal.source,
      medium: canal.medium,
      campaign,
      content: contentSlug || null,
      term: termSlug || null,
      url: link,
      nota: nota.trim() || null,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    const ok = await copiar(link);
    flash(ok ? "Link copiado e salvo no histórico." : "Link salvo. Não deu para copiar automaticamente: copie da caixa acima.");
    setContent("");
    setNota("");
    carregar();
  };

  const soCopiar = async () => {
    if (!link) return;
    flash((await copiar(link)) ? "Link copiado (não foi salvo no histórico)." : "Não deu para copiar automaticamente.");
  };

  const reaproveitar = (l: LinkSalvo) => {
    const c = CANAIS.find((x) => x.nome === l.canal);
    if (c) setCanalId(c.id);
    setDestino(l.destino);
    const [a, ...resto] = l.campaign.split("_");
    setAcao(a);
    setDetalhe(resto.join("-"));
    setContent(l.content ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remover = async (l: LinkSalvo) => {
    if (!window.confirm("Remover este link do histórico? O link continua funcionando onde já foi usado.")) return;
    const { error } = await supabase.from("utm_links").delete().eq("id", l.id);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  const q = busca.trim().toLowerCase();
  const lista = useMemo(
    () => (links ?? []).filter((l) => !q || `${l.canal} ${l.campaign} ${l.content ?? ""} ${l.destino} ${l.nota ?? ""} ${l.created_by}`.toLowerCase().includes(q)),
    [links, q],
  );
  const nomeAcao = new Map((acoes ?? []).map((a) => [a.acao, a.nome]));

  return (
    <>
      <PageTitle title="Links UTM" sub="Para WhatsApp, e-mail, push e posts orgânicos. Anúncios preenchem as UTMs sozinhos." />
      {erro && <ErrorBox message={erro} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card title="Novo link">
          <form className="mt-4 flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); salvarECopiar(); }}>
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 p-0 text-[13px] font-semibold">Canal</legend>
              <div className="flex flex-wrap gap-2">
                {CANAIS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={c.id === canalId}
                    onClick={() => setCanalId(c.id)}
                    className={`min-h-10 rounded-lg border px-3.5 text-[13px] font-semibold ${c.id === canalId ? "border-ink bg-ink text-white" : "border-line bg-white text-body hover:bg-ground"}`}
                  >
                    {c.nome}
                  </button>
                ))}
              </div>
            </fieldset>

            <Campo label="Página de destino" hint="Cole o link do produto, da coleção ou da home. UTMs antigas no link são trocadas.">
              <input value={destino} onChange={(e) => setDestino(e.target.value)} inputMode="url" className="min-h-10 w-full rounded-lg border border-line px-3" />
              {destino.trim() && !url && <span className="text-xs font-semibold text-ruim">Esse endereço não parece um link válido.</span>}
              {foraDaLoja && <span className="text-xs font-semibold text-[#9A4A1C]">Atenção: esse link não é da aphago.com.br, a visita não vai aparecer no dashboard.</span>}
            </Campo>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Ação" hint="A campanha ou coleção. É por ela que o dashboard agrupa os resultados.">
                <input required list="acoes" value={acao} onChange={(e) => setAcao(e.target.value)} placeholder="ex.: black-friday" className="min-h-10 w-full rounded-lg border border-line px-3" />
                <datalist id="acoes">{(acoes ?? []).map((a) => <option key={a.acao} value={a.acao}>{a.nome}</option>)}</datalist>
                {acaoExistente && <span className="text-xs font-semibold text-bom">{acaoExistente.nome}</span>}
              </Campo>
              <Campo label="Detalhe (opcional)" hint={`O envio ou a etapa, ex.: ${canal.exemplo}`}>
                <input value={detalhe} onChange={(e) => setDetalhe(e.target.value)} className="min-h-10 w-full rounded-lg border border-line px-3" />
              </Campo>
            </div>

            {acaoNova && (
              <div className="rounded-xl border border-roxo-claro bg-[#FAF6FE] p-4">
                <p className="m-0 text-[13px] font-bold">Ação nova: <code>{acaoSlug}</code></p>
                <p className="mb-3 mt-1 text-xs text-muted">Ela entra na lista de ações do dashboard quando você salvar o link. Confira se não existe uma parecida antes.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo label="Nome para o dashboard">
                    <input required value={novaNome} onChange={(e) => setNovaNome(e.target.value)} className="min-h-10 w-full rounded-lg border border-line bg-white px-3" />
                  </Campo>
                  <Campo label="Tipo">
                    <select value={novaTipo} onChange={(e) => setNovaTipo(e.target.value)} className="min-h-10 w-full rounded-lg border border-line bg-white px-3">
                      {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.nome}</option>)}
                    </select>
                  </Campo>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Conteúdo (recomendado)" hint={`Para comparar peças do mesmo envio: ${canal.dica}`}>
                <input value={content} onChange={(e) => setContent(e.target.value)} className="min-h-10 w-full rounded-lg border border-line px-3" />
              </Campo>
              <Campo label="Público (opcional)" hint="ex.: clientes, vip, leads">
                <input value={term} onChange={(e) => setTerm(e.target.value)} className="min-h-10 w-full rounded-lg border border-line px-3" />
              </Campo>
            </div>

            <Campo label="Anotação (opcional, só para o histórico)">
              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="ex.: mensagem das 19h no grupo VIP" className="min-h-10 w-full rounded-lg border border-line px-3" />
            </Campo>
          </form>
        </Card>

        <Card title="Link pronto" className="lg:sticky lg:top-6 lg:self-start">
          {!link ? (
            <Empty>Escolha o canal, a página de destino e a ação para gerar o link.</Empty>
          ) : (
            <>
              <div className="mt-4 break-all rounded-xl bg-ground px-4 py-3.5 font-mono text-[13px] leading-relaxed">{link}</div>
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                <Param k="utm_source" v={canal.source} />
                <Param k="utm_medium" v={canal.medium} />
                <Param k="utm_campaign" v={campaign} />
                <Param k="utm_content" v={contentSlug} />
                <Param k="utm_term" v={termSlug} />
              </dl>
              <p className="mt-3 text-xs text-muted">
                No dashboard: <strong className="text-body">{canal.nome}</strong> · ação{" "}
                <strong className="text-body">{acaoExistente?.nome ?? (novaNome.trim() || acaoSlug)}</strong>
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" onClick={salvarECopiar} disabled={!pronto || salvando} className="min-h-11 flex-auto rounded-lg bg-ink px-4 font-semibold text-white disabled:opacity-50">
                  {salvando ? "Salvando…" : "Copiar e salvar"}
                </button>
                <button type="button" onClick={soCopiar} className="min-h-11 rounded-lg border border-line px-4 font-semibold hover:bg-ground">
                  Só copiar
                </button>
              </div>
              {acaoNova && !novaNome.trim() && <p className="mt-2 text-xs text-ruim">Dê um nome para a ação nova antes de salvar.</p>}
            </>
          )}
          <p role="status" aria-live="polite" className="m-0 mt-3 min-h-5 text-[13px] font-semibold text-bom">{aviso}</p>
        </Card>
      </div>

      <Card
        title={`Links criados${links ? ` (${links.length})` : ""}`}
        extra={
          <label>
            <span className="sr-only">Buscar link</span>
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" className="min-h-10 w-48 rounded-lg border border-line px-3 text-sm text-ink" />
          </label>
        }
      >
        {links === null ? <Loading /> : lista.length === 0 ? (
          <Empty>{links.length === 0 ? "Nenhum link salvo ainda. Os links que você copiar e salvar aparecem aqui para o time reaproveitar." : "Nenhum link encontrado."}</Empty>
        ) : (
          <ul className="m-0 mt-3 list-none p-0">
            {lista.map((l) => {
              const acaoL = l.campaign.split("_")[0];
              return (
                <li key={l.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-soft py-3 text-sm">
                  <div className="min-w-[220px] flex-1">
                    <div className="font-semibold">
                      {l.canal} · {nomeAcao.get(acaoL) ?? acaoL}
                    </div>
                    <div className="mt-0.5 break-all text-[13px] text-muted">
                      <code>{l.campaign}</code>{l.content && <> · <code>{l.content}</code></>} · {l.destino.replace(/^https?:\/\/(www\.)?/, "")}
                    </div>
                    {l.nota && <div className="mt-0.5 text-[13px] text-body">{l.nota}</div>}
                    <div className="mt-0.5 text-xs text-muted">{quando.format(new Date(l.created_at))} · {l.created_by}</div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={async () => { if (await copiar(l.url)) { setCopiadoId(l.id); window.setTimeout(() => setCopiadoId(null), 2000); } }}
                      className="min-h-9 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-ground"
                    >
                      {copiadoId === l.id ? "Copiado" : "Copiar"}
                    </button>
                    <button type="button" onClick={() => reaproveitar(l)} className="min-h-9 rounded-lg px-2.5 text-[13px] font-semibold text-roxo-texto hover:bg-ground">
                      Reaproveitar
                    </button>
                    {(l.created_by === eu || isAdmin) && (
                      <button type="button" onClick={() => remover(l)} className="min-h-9 rounded-lg px-2.5 text-[13px] font-semibold text-ruim hover:bg-ground">
                        Remover
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

function Param({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="font-mono text-muted">{k}</dt>
      <dd className="m-0 break-all font-mono font-semibold">{v || <span className="font-sans font-normal text-muted">vazio</span>}</dd>
    </>
  );
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-semibold">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}
