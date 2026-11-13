// Avisos do time no Discord (vindos do Fazeno).
// Corpo: { "tipo": "tarefa", "id": uuid }                          -> canal de tarefas, marca o responsável
//        { "tipo": "mencao", "id": uuid, "pessoas": [uuid, ...] }  -> canal de tarefas, marca quem foi citado com @Nome no produto
//        { "tipo": "lancamento", "id": uuid }                       -> canal de lançamentos da marca, com a copy dos grupos VIP
// Lê tudo com o login de quem chamou (regras de acesso do banco valem aqui também).
// Segredo: DISCORD_BOT_TOKEN (token do bot que já está nos canais).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CANAL_TAREFAS = "1561807227365498970";
const CANAL_LANCAMENTO: Record<string, string> = { AP: "1130602129497788596", AB: "1470919498797154417" };
const SITE = "https://pharol.aphago.com.br/#/time";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Pessoa = { id: string; nome: string; discord_id: string | null };
type Modelo = { id: string; nome: string };

const norm = (s: string) => s.toLocaleLowerCase("pt-BR");
const citados = (texto: string, pessoas: Pessoa[]) =>
  pessoas.filter((p) => p.nome.trim() && norm(texto).includes(`@${norm(p.nome.trim())}`));
const marcar = (p: Pessoa) => (p.discord_id ? `<@${p.discord_id}>` : p.nome.slice(0, 100));
const limpar = (t: string) => t.replace(/\[\/?(?:red|green|blue|yellow)\]/g, "").replace(/\*\*|\+\+|~~/g, "").replace(/@/g, "＠");
const dataBR = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "Sem prazo");

async function enviar(canal: string, content: string, users: string[]) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("Discord ainda não configurado (falta o token do bot).");
  const res = await fetch(`https://discord.com/api/v10/channels/${canal}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    // nunca @everyone/@here: só marca as pessoas listadas
    body: JSON.stringify({ content: content.slice(0, 1990), allowed_mentions: { parse: [], users, replied_user: false } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Discord [${res.status}]: ${(await res.text()).slice(0, 300)}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: ok } = await db.rpc("is_allowed");
    if (ok !== true) return json({ error: "Sem acesso" }, 403);

    const { tipo, id, pessoas: ids = [] } = await req.json();
    const { data: equipe, error: e1 } = await db.from("equipe").select("id, nome, discord_id");
    if (e1) throw new Error(e1.message);
    const pessoas = (equipe ?? []) as Pessoa[];

    if (tipo === "tarefa") {
      const { data: t, error } = await db.from("tarefas").select("titulo, prazo, pessoa_id").eq("id", id).single();
      if (error || !t) throw new Error("Tarefa não encontrada.");
      const p = pessoas.find((x) => x.id === t.pessoa_id);
      const resp = p ? (p.discord_id ? `<@${p.discord_id}> (${p.nome})` : p.nome) : "Sem responsável";
      await enviar(CANAL_TAREFAS, ["📋 Nova tarefa no Pharol", limpar(t.titulo).slice(0, 900), `Responsável: ${resp}`, `Prazo: ${dataBR(t.prazo)}`, SITE].join("\n"),
        p?.discord_id ? [p.discord_id] : []);
      return json({ ok: true });
    }

    const { data: pr, error } = await db.from("produtos_criacao").select("*").eq("id", id).single();
    if (error || !pr) throw new Error("Produto não encontrado.");
    const titulo = `${pr.codigo ? `${pr.codigo} · ` : ""}${String(pr.nome).slice(0, 250)}`;

    if (tipo === "mencao") {
      // só marca quem está mesmo citado na descrição salva
      const alvo = citados(pr.descricao, pessoas).filter((p) => (ids as string[]).includes(p.id));
      if (!alvo.length) return json({ ok: true, marcados: [] });
      await enviar(CANAL_TAREFAS, ["🚀 Você foi mencionado em um produto", titulo, `Mencionados: ${alvo.map(marcar).join(", ")}`, `${SITE}/produtos`].join("\n"),
        alvo.map((p) => p.discord_id).filter((u): u is string => !!u));
      return json({ ok: true, marcados: alvo.map((p) => p.nome) });
    }

    if (tipo === "lancamento") {
      const { data: modelos } = await db.from("modelos").select("id, nome").order("posicao");
      const versoes = ((modelos ?? []) as Modelo[]).filter((m) => pr.modelos.includes(m.id));
      const fase3 = versoes.every((m) => pr.checks.includes(`model.${m.id}`));
      if (pr.cancelado || !fase3) throw new Error("Conclua a fase 3 e mantenha o produto ativo antes de lançar.");
      let colecao: string | null = null;
      if (pr.colecao_id) colecao = (await db.from("colecoes").select("nome").eq("id", pr.colecao_id).single()).data?.nome ?? null;
      const linhas = [
        "🚀 Produto pronto para lançamento",
        titulo,
        colecao ? `Coleção: ${colecao.slice(0, 100)}` : "Lançamento single",
        limpar(pr.descricao).slice(0, 600),
        `Versões: ${versoes.map((m) => m.nome).join(", ").slice(0, 400) || "Produto principal (sem versões extras)"}`,
        pr.cores.length ? `Cores: ${pr.cores.join(", ").slice(0, 150)}` : "",
        "",
        "Time: enviar o produto nos grupos VIP com 10 cupons de 40% de desconto.",
        ...(pr.codigo
          ? ["Copy para copiar e enviar:", "Produto novo na área.", `10 cupons disponíveis para os grupos vips pagar apenas 60% do valor, cupom: ${pr.codigo}`, "", "⚠️ Criar/validar o cupom na Shopify antes de divulgar."]
          : ["⚠️ Produto ainda sem código: definir o cupom antes de divulgar."]),
        `${SITE}/produtos`,
      ];
      await enviar(CANAL_LANCAMENTO[pr.marca], linhas.join("\n"), []);
      return json({ ok: true });
    }

    return json({ error: "Tipo de aviso desconhecido." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
