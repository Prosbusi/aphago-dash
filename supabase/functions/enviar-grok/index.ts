// Pharol → Grok: manda a ficha do lançamento para a rotina (webhook) do bot da loja.
// Chamada pelo banco (lancamento_enviar_grok → run_sync) com { id, mensagem? }.
// As imagens de referência vão como links temporários (7 dias) para o bot conseguir abrir.
// Responde com o mesmo status e corpo que o Grok devolveu (a tela mostra se ele recebeu).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const key = req.headers.get("x-sync-key");
  const { data: ok } = await supabase.rpc("check_sync_key", { k: key ?? "" });
  if (ok !== true) return new Response("unauthorized", { status: 401 });

  const { id, mensagem } = await req.json().catch(() => ({}));
  const { data: pc } = await supabase.from("produtos_criacao").select("id,codigo,marca,imagens,checks").eq("id", id).maybeSingle();
  if (!pc) return Response.json({ erro: "Lançamento não encontrado" }, { status: 404 });
  const { data: integ } = await supabase.from("integracoes").select("url,token").eq("chave", pc.marca === "AP" ? "grok_aphago" : "grok_abrasso").maybeSingle();
  if (!integ?.url) return Response.json({ erro: "Webhook do Grok desta loja não configurado (Time › Grok)" }, { status: 400 });

  const { data: ficha } = await supabase.rpc("lancamento_ficha", { p_id: pc.id });
  let imagens: string[] = [];
  if (pc.imagens?.length) {
    const { data } = await supabase.storage.from("time").createSignedUrls(pc.imagens, 60 * 60 * 24 * 7);
    imagens = (data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[];
  }
  const corpo = {
    origem: "pharol",
    comando: (mensagem && String(mensagem).trim()) ||
      `Produto aprovado no Pharol: ${pc.codigo}. Crie tudo conforme a ficha: Customily, Shopify (um produto por modelo, com as duas tags de cada modelo), ` +
      `mockups e criativos. Use as imagens de referência abaixo. Ao terminar cada etapa, marque na API do Pharol (acao "marcar") e, depois de criar na Shopify, ` +
      `chame a acao "produto_criado" com o código ${pc.codigo}.`,
    ficha: { ...(ficha as Record<string, unknown>), imagens },
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (integ.token) { headers.Authorization = `Bearer ${integ.token}`; headers["x-api-key"] = integ.token; }
  try {
    const res = await fetch(integ.url, { method: "POST", headers, body: JSON.stringify(corpo) });
    const txt = (await res.text()).slice(0, 1000);
    if (res.ok) {
      const checks = [...new Set([...(pc.checks ?? []), "grok.enviado"])];
      await supabase.from("produtos_criacao").update({ checks }).eq("id", pc.id);
    }
    await supabase.from("sync_log").insert({ source: `grok:${pc.codigo}`, rows_read: imagens.length, status: res.ok ? "ok" : "erro", error: res.ok ? null : `${res.status} ${txt}` });
    return new Response(txt || (res.ok ? "ok" : ""), { status: res.status });
  } catch (e) {
    await supabase.from("sync_log").insert({ source: `grok:${pc.codigo}`, rows_read: 0, status: "erro", error: String(e) });
    return Response.json({ erro: `Não consegui falar com o Grok: ${e}` }, { status: 502 });
  }
});
