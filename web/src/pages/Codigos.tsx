import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { fetchAll, supabase } from "../lib/supabase";
import { num } from "../lib/format";
import { Card, Empty, ErrorBox, Loading } from "../components/ui";

// Códigos de produto: família AP0000 / AB0000 + letra do modelo. A família é a referência
// para anúncios e atribuição; o código completo (AP0006-c) identifica o modelo.

type Linha = {
  product_id: string; store: string; familia: string; familia_nome: string; familia_origem: string;
  letra: string; modelo: string; codigo: string; origem: "existente" | "corrigido" | "novo"; revisar: string | null;
  gravado_em: string | null; title: string; handle: string; status: string; image_url: string | null;
  online_url: string | null; tags_codigo: string[]; pendente: boolean;
};
type Parecida = { familia: string; nome: string; parecida: string; parecida_nome: string };
type Familia = { familia: string; nome: string; produtos: Linha[]; letras: string[]; pendentes: number };

const LETRAS: [string, string][] = [
  ["a", "Camiseta"], ["b", "Algodão Peruano"], ["c", "Oversized"], ["d", "Suéter"], ["e", "Hoodie"], ["f", "Moletom Cropped"],
  ["g", "Cropped"], ["h", "Regata"], ["i", "Body"], ["j", "Mini"], ["k", "Caneca"], ["l", "Quadro"], ["m", "Poster"],
  ["n", "Capa de Mala"], ["o", "Camiseta Frente e Verso"], ["p", "Oversized Frente e Verso"],
];
const STATUS: Record<string, string> = { ACTIVE: "Ativo", DRAFT: "Rascunho", UNLISTED: "Não listado", ARCHIVED: "Arquivado" };
type Filtro = "todos" | "pendentes" | "alterados" | "alerta";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function Copiar({ texto, className = "" }: { texto: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      title="Copiar"
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1200); }}
      className={`rounded-md border border-line bg-soft px-2 py-0.5 font-mono text-[12px] font-bold tracking-wide text-ink hover:bg-white ${className}`}
    >
      {ok ? "copiado" : texto}
    </button>
  );
}

export function Codigos({ store }: { store: string }) {
  const { isAdmin } = useAuth();
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [parecidas, setParecidas] = useState<Parecida[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [aberta, setAberta] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [mostrarParecidas, setMostrarParecidas] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [l, p] = await Promise.all([
        fetchAll<Linha>((from, to) =>
          supabase.from("v_produto_codigos").select("*").eq("store", store).order("familia").order("letra").range(from, to)),
        supabase.rpc("familias_parecidas", { p_store: store }),
      ]);
      setLinhas(l);
      setParecidas((p.data ?? []) as Parecida[]);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [store]);
  useEffect(() => { setLinhas(null); carregar(); }, [carregar]);

  const familias = useMemo(() => {
    const m = new Map<string, Familia>();
    for (const l of linhas ?? []) {
      const f = m.get(l.familia) ?? { familia: l.familia, nome: l.familia_nome, produtos: [], letras: [], pendentes: 0 };
      f.produtos.push(l);
      if (!f.letras.includes(l.letra)) f.letras.push(l.letra);
      if (l.pendente) f.pendentes++;
      m.set(l.familia, f);
    }
    return [...m.values()].map((f) => ({ ...f, letras: f.letras.sort() }));
  }, [linhas]);

  const q = norm(busca.trim());
  const visiveis = familias.filter((f) => {
    const passa = (l: Linha) =>
      filtro === "todos" ? true : filtro === "pendentes" ? l.pendente : filtro === "alterados" ? l.origem === "corrigido" : !!l.revisar;
    if (!f.produtos.some(passa)) return false;
    if (!q) return true;
    return norm(`${f.familia} ${f.nome}`).includes(q) || f.produtos.some((l) => norm(`${l.codigo} ${l.title} ${l.handle}`).includes(q));
  });
  const pendentes = (linhas ?? []).filter((l) => l.pendente).length;
  const total = linhas?.length ?? 0;

  const acao = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setMsg(null);
    const { error } = await fn();
    if (error) { setMsg(`Erro: ${error.message}`); return; }
    setMsg(ok);
    await carregar();
  };

  const gravar = async () => {
    if (!window.confirm(`Gravar ${num(pendentes)} códigos como tags na Shopify? As tags de código antigas desses produtos são trocadas.`)) return;
    setGravando(true);
    setMsg("Gravando na Shopify… pode levar alguns minutos.");
    let antes = pendentes;
    for (let rodada = 0; rodada < 40; rodada++) {
      const { error } = await supabase.rpc("codigos_gravar", { p_store: store });
      if (error) { setMsg(`Erro: ${error.message}`); break; }
      await new Promise((r) => setTimeout(r, 25_000));
      const { count } = await supabase.from("v_produto_codigos").select("product_id", { count: "exact", head: true })
        .eq("store", store).eq("pendente", true);
      const agora = count ?? 0;
      setMsg(`Gravando na Shopify… faltam ${num(agora)}.`);
      if (agora === 0) { setMsg("Todos os códigos estão gravados na Shopify."); break; }
      if (agora >= antes) {
        const { data } = await supabase.from("sync_log").select("status,error").eq("source", `codigos:${store}`)
          .order("ran_at", { ascending: false }).limit(1);
        setMsg(`Parou com ${num(agora)} pendentes. ${data?.[0]?.error ?? "Tente de novo em alguns minutos."}`);
        break;
      }
      antes = agora;
    }
    setGravando(false);
    await carregar();
  };

  const exportar = () => {
    const esc = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const linhasCsv = [["familia", "nome_familia", "codigo", "modelo", "produto", "status", "situacao", "tags_atuais", "link"].join(";")];
    for (const l of linhas ?? []) {
      linhasCsv.push([l.familia, l.familia_nome, l.codigo, l.modelo, l.title, STATUS[l.status] ?? l.status, l.origem,
        l.tags_codigo.join(" "), l.online_url ?? ""].map(esc).join(";"));
    }
    const blob = new Blob(["﻿" + linhasCsv.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `codigos-${store}.csv`;
    a.click();
  };

  if (erro) return <ErrorBox message={erro} />;
  if (!linhas) return <Loading />;

  return (
    <>
      <Card
        title={`${num(familias.length)} famílias · ${num(total)} produtos`}
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportar} className="min-h-9 rounded-[8px] border border-line px-3 font-semibold text-ink hover:bg-soft">
              Exportar planilha
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => acao(() => supabase.rpc("codigos_atualizar"), "Lista atualizada com os produtos novos.")}
                className="min-h-9 rounded-[8px] border border-line px-3 font-semibold text-ink hover:bg-soft"
              >
                Incluir produtos novos
              </button>
            )}
            {isAdmin && pendentes > 0 && (
              <button type="button" disabled={gravando} onClick={gravar} className="min-h-9 rounded-[8px] bg-ink px-3 font-semibold text-white disabled:opacity-50">
                Gravar na Shopify ({num(pendentes)})
              </button>
            )}
          </div>
        }
      >
        <p className="mt-2 text-[13px] text-muted">
          Código = família + letra do modelo (ex.: <b className="text-ink">AP0006-c</b>). Na Shopify ficam duas tags: a família e o código.
          Nos anúncios use a família entre parênteses, ex.: <b className="text-ink">Criativo 03 (AP0006)</b>.
          {pendentes > 0 && <> <b className="text-ink">{num(pendentes)}</b> produtos ainda não têm o código gravado na Shopify.</>}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código, família ou produto"
            aria-label="Buscar por código, família ou produto"
            className="min-h-10 w-full max-w-sm rounded-lg border border-line px-3 text-sm text-ink"
          />
          <div role="group" aria-label="Filtro" className="flex flex-wrap gap-1 rounded-[10px] border border-line p-1">
            {([["todos", "Todos"], ["pendentes", "Falta gravar"], ["alterados", "Código alterado"], ["alerta", "Com alerta"]] as const).map(([id, nome]) => (
              <button key={id} type="button" aria-pressed={filtro === id} onClick={() => setFiltro(id)}
                className={`min-h-8 rounded-[7px] px-3 text-[13px] font-semibold ${filtro === id ? "bg-ink text-white" : "text-body hover:bg-soft"}`}>
                {nome}
              </button>
            ))}
          </div>
          {isAdmin && parecidas.length > 0 && (
            <button type="button" onClick={() => setMostrarParecidas((x) => !x)} className="text-[13px] font-semibold text-roxo underline">
              {mostrarParecidas ? "esconder" : "ver"} {num(parecidas.length)} famílias parecidas
            </button>
          )}
        </div>
        {msg && <p role="status" className="mt-3 text-[13px] font-semibold text-ink">{msg}</p>}
      </Card>

      {isAdmin && mostrarParecidas && (
        <Card title="Famílias parecidas" extra="Todas as palavras de uma estão no nome da outra. Junte só se for a mesma estampa.">
          <ul className="mt-3 divide-y divide-soft text-sm">
            {parecidas.map((p) => (
              <li key={`${p.familia}>${p.parecida}`} className="flex flex-wrap items-center gap-2 py-2">
                <Copiar texto={p.familia} /> <span>{p.nome}</span>
                <span className="text-muted">parece</span>
                <Copiar texto={p.parecida} /> <span>{p.parecida_nome}</span>
                <button type="button"
                  onClick={() => acao(() => supabase.rpc("familia_juntar", { p_de: p.familia, p_para: p.parecida }), `${p.familia} juntada em ${p.parecida}.`)}
                  className="ml-auto min-h-8 rounded-[7px] border border-line px-2.5 text-[13px] font-semibold hover:bg-soft">
                  Juntar {p.familia} em {p.parecida}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        {visiveis.length === 0 ? <Empty>Nada encontrado.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-2 font-semibold">Família</th>
                  <th scope="col" className="p-2 font-semibold">Estampa</th>
                  <th scope="col" className="p-2 font-semibold">Modelos</th>
                  <th scope="col" className="p-2 text-right font-semibold">Produtos</th>
                  <th scope="col" className="py-2 pl-2 text-right font-semibold">Shopify</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.slice(0, 300).map((f) => {
                  const open = aberta === f.familia || (!!q && visiveis.length <= 5);
                  const capa = f.produtos.find((l) => l.image_url)?.image_url;
                  return (
                    <Fragment key={f.familia}>
                      <tr className="cursor-pointer border-t border-soft hover:bg-soft/40" onClick={() => setAberta(open ? null : f.familia)}>
                        <td className="py-2.5 pr-2"><Copiar texto={f.familia} /></td>
                        <td className="p-2">
                          <div className="flex items-center gap-2.5">
                            {capa ? <img src={capa} alt="" className="h-9 w-9 rounded-md object-cover" loading="lazy" /> : <span className="h-9 w-9 rounded-md bg-soft" />}
                            <span className="font-semibold">{f.nome}</span>
                            <span aria-hidden="true" className="text-muted">{open ? "▾" : "▸"}</span>
                          </div>
                        </td>
                        <td className="p-2 font-mono text-[13px] text-body">{f.letras.join(" ")}</td>
                        <td className="p-2 text-right">{f.produtos.length}</td>
                        <td className={`py-2 pl-2 text-right text-[13px] font-semibold ${f.pendentes ? "text-ruim" : "text-bom"}`}>
                          {f.pendentes ? `falta ${f.pendentes}` : "gravado"}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-soft/40">
                          <td colSpan={5} className="px-2 pb-3 pt-1">
                            <FamiliaDetalhe f={f} isAdmin={isAdmin} acao={acao} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {visiveis.length > 300 && <p className="mt-3 text-[13px] text-muted">Mostrando 300 de {num(visiveis.length)} famílias. Use a busca para achar as outras.</p>}
          </div>
        )}
      </Card>
    </>
  );
}

function FamiliaDetalhe({ f, isAdmin, acao }: {
  f: Familia; isAdmin: boolean;
  acao: (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => Promise<void>;
}) {
  const [nome, setNome] = useState(f.nome);
  const [juntar, setJuntar] = useState("");
  return (
    <div className="rounded-[10px] border border-line bg-white p-3">
      {isAdmin && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <label className="flex items-center gap-1.5">Nome da estampa
            <input value={nome} onChange={(e) => setNome(e.target.value)} className="min-h-8 w-64 rounded-md border border-line px-2" />
          </label>
          <button type="button" disabled={nome.trim() === f.nome || !nome.trim()}
            onClick={() => acao(() => supabase.rpc("familia_renomear", { p_familia: f.familia, p_nome: nome }), "Nome salvo.")}
            className="min-h-8 rounded-md border border-line px-2.5 font-semibold disabled:opacity-40">Salvar nome</button>
          <span className="mx-2 text-muted">·</span>
          <label className="flex items-center gap-1.5">Juntar esta família em
            <input value={juntar} onChange={(e) => setJuntar(e.target.value.toUpperCase())} placeholder="AP0000"
              className="min-h-8 w-24 rounded-md border border-line px-2 font-mono" />
          </label>
          <button type="button" disabled={!/^(AP|AB)\d{4}$/.test(juntar)}
            onClick={() => acao(() => supabase.rpc("familia_juntar", { p_de: f.familia, p_para: juntar }), `${f.familia} juntada em ${juntar}.`)}
            className="min-h-8 rounded-md border border-line px-2.5 font-semibold disabled:opacity-40">Juntar</button>
        </div>
      )}
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th scope="col" className="py-1.5 pr-2 font-semibold">Código</th>
            <th scope="col" className="p-1.5 font-semibold">Produto</th>
            <th scope="col" className="p-1.5 font-semibold">Status</th>
            <th scope="col" className="p-1.5 font-semibold">Hoje na Shopify</th>
            {isAdmin && <th scope="col" className="py-1.5 pl-1.5 font-semibold">Alterar</th>}
          </tr>
        </thead>
        <tbody>
          {f.produtos.map((l) => <ProdutoLinha key={l.product_id} l={l} isAdmin={isAdmin} acao={acao} />)}
        </tbody>
      </table>
    </div>
  );
}

function ProdutoLinha({ l, isAdmin, acao }: {
  l: Linha; isAdmin: boolean;
  acao: (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => Promise<void>;
}) {
  const [fam, setFam] = useState(l.familia);
  const [letra, setLetra] = useState(l.letra);
  const mudou = fam !== l.familia || letra !== l.letra;
  return (
    <tr className="border-t border-soft align-middle">
      <td className="py-2 pr-2"><Copiar texto={l.codigo} /></td>
      <td className="p-1.5">
        {l.online_url ? <a href={l.online_url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{l.title}</a> : <span className="font-semibold">{l.title}</span>}
        <div className="text-xs text-muted">{l.modelo}{l.revisar ? ` · ⚠ ${l.revisar}` : ""}</div>
      </td>
      <td className="p-1.5 text-body">{STATUS[l.status] ?? l.status}</td>
      <td className="p-1.5 font-mono text-xs">
        {l.tags_codigo.length ? l.tags_codigo.join(" ") : <span className="font-sans text-muted">sem código</span>}
        {l.pendente && <span className="ml-1 font-sans font-semibold text-ruim">· falta gravar</span>}
      </td>
      {isAdmin && (
        <td className="py-1.5 pl-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <input aria-label="Família" value={fam} onChange={(e) => setFam(e.target.value.toUpperCase())} className="min-h-8 w-[5.5rem] rounded-md border border-line px-1.5 font-mono text-xs" />
            <select aria-label="Modelo" value={letra} onChange={(e) => setLetra(e.target.value)} className="min-h-8 rounded-md border border-line px-1 text-xs">
              {LETRAS.map(([k, n]) => <option key={k} value={k}>{k} · {n}</option>)}
            </select>
            <button type="button" disabled={!mudou || !/^(AP|AB)\d{4}$/.test(fam)}
              onClick={() => acao(() => supabase.rpc("codigo_alterar", { p_product: l.product_id, p_familia: fam, p_letra: letra }), "Código alterado.")}
              className="min-h-8 rounded-md border border-line px-2 text-xs font-semibold disabled:opacity-40">Salvar</button>
            <button type="button" title="Tirar este produto da família e criar uma família nova para ele"
              onClick={() => acao(() => supabase.rpc("codigo_alterar", { p_product: l.product_id, p_familia: "nova", p_letra: letra }), "Família nova criada.")}
              className="min-h-8 rounded-md px-1.5 text-xs font-semibold text-roxo underline">nova família</button>
          </div>
        </td>
      )}
    </tr>
  );
}
