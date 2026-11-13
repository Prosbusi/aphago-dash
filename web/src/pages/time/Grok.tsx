import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth";
import { supabase } from "../../lib/supabase";
import { MARCAS, type Produto } from "../../lib/time";
import { Card, ErrorBox, Loading, PageTitle } from "../../components/ui";
import { btnPrim, btnSec, inputCls, type Recado } from "../../components/time";

// Ligação Pharol ⇄ Grok.
// Pharol → Grok: botão "Enviar para o Grok" faz POST da ficha na rotina (webhook) do Grok da loja.
// Grok → Pharol: o Grok chama a API do Pharol (função pharol-api) com uma chave da loja.

const API_URL = "https://gajxzdfcttcocsnjdvha.supabase.co/functions/v1/pharol-api";
const STATUS: Record<string, string> = { ACTIVE: "Ativo", DRAFT: "Rascunho", UNLISTED: "Não listado", ARCHIVED: "Arquivado" };

type Achado = { product_id: string; title: string; status: string; online_url: string | null; image_url: string | null; letra: string | null; codigo: string | null };

/** Dentro do cartão do lançamento: enviar ao Grok, copiar a ficha e ver o que já existe na Shopify. */
export function GrokPainel({ p, setRecado, onRecarregar }: { p: Produto; setRecado: (r: Recado) => void; onRecarregar: () => void }) {
  const [achados, setAchados] = useState<Achado[] | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(() => {
    supabase.rpc("lancamento_shopify", { p_codigo: p.codigo }).then(({ data }) => setAchados((data ?? []) as Achado[]));
  }, [p.codigo]);
  useEffect(() => { carregar(); }, [carregar]);

  const enviar = async () => {
    setEnviando(true);
    const { data: req, error } = await supabase.rpc("lancamento_enviar_grok", { p_id: p.id });
    if (error) { setEnviando(false); setRecado({ tipo: "erro", texto: error.message }); return; }
    // espera a resposta do webhook para mostrar se o Grok recebeu
    let resp: { status?: number; erro?: string; corpo?: string } | null = null;
    for (let i = 0; i < 6 && !resp; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const { data } = await supabase.rpc("grok_resposta", { p_req: req });
      resp = data as typeof resp;
    }
    setEnviando(false);
    onRecarregar();
    if (!resp) setRecado({ tipo: "aviso", texto: "Enviado. O Grok ainda não respondeu; confira no chat dele." });
    else if (resp.status && resp.status < 300) setRecado({ tipo: "ok", texto: `${p.codigo} enviado ao Grok da ${MARCAS[p.marca]}.` });
    else setRecado({ tipo: "erro", texto: `O Grok recusou (${resp.status ?? "sem resposta"}): ${resp.erro ?? resp.corpo ?? ""}` });
  };

  const copiarFicha = async () => {
    const { data, error } = await supabase.rpc("lancamento_ficha", { p_id: p.id });
    if (error) { setRecado({ tipo: "erro", texto: error.message }); return; }
    await navigator.clipboard?.writeText(JSON.stringify(data, null, 2));
    setRecado({ tipo: "ok", texto: "Ficha copiada. Cole no chat do Grok." });
  };

  const enviado = p.checks.includes("grok.enviado");
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-bold">Grok e Shopify</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSec} onClick={copiarFicha}>Copiar ficha</button>
          <button type="button" className={btnPrim} disabled={enviando} onClick={enviar}>
            {enviando ? "Enviando…" : enviado ? "Enviar de novo ao Grok" : "Enviar para o Grok"}
          </button>
        </div>
      </div>
      <p className="mb-0 mt-2 text-xs text-muted">
        Cada modelo vira um produto na Shopify com as tags <b className="font-mono text-ink">{p.codigo}</b> e{" "}
        <b className="font-mono text-ink">{p.codigo}-letra</b>. O Pharol lê a Shopify de hora em hora (ou quando o Grok avisa) e marca sozinho
        "Criação do produto" e cada versão encontrada.
      </p>
      <div className="mt-3">
        <div className="text-xs font-semibold text-muted">Na Shopify com este código</div>
        {achados === null ? <p className="mt-1 text-xs text-muted">Carregando…</p> : achados.length === 0 ? (
          <p className="mt-1 text-xs text-muted">Nenhum produto ainda.</p>
        ) : (
          <ul className="m-0 mt-1 list-none space-y-1 p-0 text-[13px]">
            {achados.map((a) => (
              <li key={a.product_id} className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 font-mono text-xs font-bold ${a.codigo ? "bg-soft" : "bg-[#FBE0DD] text-ruim"}`}>{a.codigo ?? "sem tag de modelo"}</span>
                {a.online_url ? <a href={a.online_url} target="_blank" rel="noreferrer" className="hover:underline">{a.title}</a> : <span>{a.title}</span>}
                <span className="text-xs text-muted">{STATUS[a.status] ?? a.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type Chave = { id: string; nome: string; loja: string | null; final: string; ativa: boolean; ultimo_uso: string | null; criada_em: string };
type Integracao = { chave: string; url: string; token: string | null };

/** Time › Grok (admin): webhook da rotina de cada loja e chaves da API do Pharol. */
export function GrokConfig() {
  const { isAdmin } = useAuth();
  const [chaves, setChaves] = useState<Chave[] | null>(null);
  const [integ, setInteg] = useState<Record<string, Integracao>>({});
  const [nova, setNova] = useState<{ loja: string; chave: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [c, i] = await Promise.all([
      supabase.from("api_chaves").select("id,nome,loja,final,ativa,ultimo_uso,criada_em").order("criada_em", { ascending: false }),
      supabase.from("integracoes").select("*"),
    ]);
    if (c.error || i.error) { setErro((c.error ?? i.error)!.message); return; }
    setChaves(c.data as Chave[]);
    setInteg(Object.fromEntries(((i.data ?? []) as Integracao[]).map((x) => [x.chave, x])));
  }, []);
  useEffect(() => { if (isAdmin) carregar(); }, [isAdmin, carregar]);

  if (!isAdmin) return <><PageTitle title="Grok" /><ErrorBox message="Só admin configura a ligação com o Grok." /></>;
  if (erro) return <ErrorBox message={erro} />;
  if (!chaves) return <Loading />;

  const gerar = async (loja: string) => {
    const { data, error } = await supabase.rpc("api_chave_gerar", { p_nome: `Grok ${loja === "aphago" ? "Aphago" : "Abrasso"}`, p_loja: loja });
    if (error) { setMsg(error.message); return; }
    setNova({ loja, chave: data as string });
    carregar();
  };
  const desativar = async (id: string) => {
    await supabase.from("api_chaves").update({ ativa: false }).eq("id", id);
    carregar();
  };

  return (
    <>
      <PageTitle title="Grok" sub="Ligação nos dois sentidos, um bot por loja" />
      {msg && <p role="status" className="text-sm font-semibold">{msg}</p>}
      {(["aphago", "abrasso"] as const).map((loja) => (
        <LojaGrok key={loja} loja={loja} integ={integ[`grok_${loja}`]} chaves={chaves.filter((c) => c.loja === loja)}
          nova={nova?.loja === loja ? nova.chave : null} onGerar={() => gerar(loja)} onDesativar={desativar}
          onSalvo={(t) => { setMsg(t); carregar(); }} />
      ))}
    </>
  );
}

function LojaGrok({ loja, integ, chaves, nova, onGerar, onDesativar, onSalvo }: {
  loja: "aphago" | "abrasso"; integ?: Integracao; chaves: Chave[]; nova: string | null;
  onGerar: () => void; onDesativar: (id: string) => void; onSalvo: (t: string) => void;
}) {
  const nome = loja === "aphago" ? "Aphago" : "Abrasso";
  const [url, setUrl] = useState(integ?.url ?? "");
  const [token, setToken] = useState(integ?.token ?? "");
  useEffect(() => { setUrl(integ?.url ?? ""); setToken(integ?.token ?? ""); }, [integ]);
  const salvar = async () => {
    const { error } = await supabase.from("integracoes").upsert({ chave: `grok_${loja}`, url: url.trim(), token: token.trim() || null, updated_at: new Date().toISOString() });
    onSalvo(error ? `Erro: ${error.message}` : `Webhook do Grok da ${nome} salvo.`);
  };
  const ativas = chaves.filter((c) => c.ativa);
  const instrucoes = `Você tem acesso à API do Pharol (central da ${nome}).
Endereço: ${API_URL}
Sempre POST com JSON e o cabeçalho "Authorization: Bearer ${nova ?? "<chave da API>"}".
Ações (campo "acao"):
- nova_ideia {titulo, descricao, temas[], links[]}: manda uma ideia pesquisada para a Chuva de ideias.
- produtos {situacao: "andamento"}: lista os lançamentos aprovados.
- ficha {codigo}: dados completos do produto aprovado (modelos com código e tags, cores, descrição, imagens).
- marcar {codigo, itens[]}: marca etapas (customily.template, customily.options, customily.test, shopify.mockups, ads.images, ads.videos, ads.created).
- produto_criado {codigo}: avise depois de criar os produtos na Shopify.
- conferir {codigo}: confere o que já está na Shopify e o que falta.
Regras: cada modelo é um produto na Shopify com DUAS tags, a família (ex.: AB0123) e o modelo (ex.: AB0123-c). Nunca alterar o SKU. Anúncios levam o código da família entre parênteses no nome, ex.: "Criativo 03 (AB0123)". O código é sempre o que o Pharol mandou; nunca invente um.
Quando o Pharol mandar um POST na sua rotina com "origem": "pharol", é um produto aprovado: siga o "comando" e a "ficha".`;

  return (
    <Card title={`Grok da ${nome}`}>
      <div className="mt-3 grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="m-0 text-sm font-bold">1 · Pharol → Grok (rotina do Grok)</h3>
          <p className="mt-1 text-xs text-muted">Cole o endereço e a chave da rotina que o Grok criou (em Rotinas). O botão "Enviar para o Grok" usa estes dados.</p>
          <label className="mt-2 block text-xs font-semibold">Endereço do webhook
            <input className={`${inputCls} mt-1 w-full`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </label>
          <label className="mt-2 block text-xs font-semibold">Chave da rotina
            <input className={`${inputCls} mt-1 w-full font-mono`} value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" />
          </label>
          <button type="button" className={`${btnPrim} mt-3`} disabled={!/^https:\/\//.test(url.trim())} onClick={salvar}>Salvar</button>
        </div>
        <div>
          <h3 className="m-0 text-sm font-bold">2 · Grok → Pharol (API do Pharol)</h3>
          <p className="mt-1 text-xs text-muted">Gere uma chave e cole as instruções abaixo no bot da {nome}. A chave aparece uma vez só.</p>
          {nova ? (
            <div className="mt-2 rounded-lg border border-bom/40 bg-[#F1FAF4] p-3 text-xs">
              <b>Chave nova (copie agora):</b>
              <div className="mt-1 break-all font-mono text-[13px]">{nova}</div>
            </div>
          ) : (
            <button type="button" className={`${btnSec} mt-2`} onClick={onGerar}>{ativas.length ? "Gerar outra chave" : "Gerar chave"}</button>
          )}
          {ativas.length > 0 && (
            <ul className="m-0 mt-2 list-none space-y-1 p-0 text-xs text-muted">
              {ativas.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="font-mono">ph_…{c.final}</span>
                  <span>{c.ultimo_uso ? `usada em ${new Date(c.ultimo_uso).toLocaleString("pt-BR")}` : "nunca usada"}</span>
                  <button type="button" className="font-semibold text-ruim underline" onClick={() => onDesativar(c.id)}>desativar</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <h3 className="m-0 text-sm font-bold">Instruções para colar no bot da {nome}</h3>
          <button type="button" className={btnSec} onClick={() => navigator.clipboard?.writeText(instrucoes)}>Copiar</button>
        </div>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-soft p-3 text-xs">{instrucoes}</pre>
      </div>
    </Card>
  );
}
