// ia-coleta — recebe os uploads e as gerações de imagem com IA feitos na página do produto
// (script no theme.liquid das lojas) e grava em ia_eventos.
// A loja vem do domínio myshopify (Shopify.shop) ou do site, conferidos na tabela stores.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

let lojas: { store: string; shop_domain: string | null; site_url: string | null }[] | null = null;
async function lojaDe(shop: string, host: string) {
  if (!lojas) {
    const { data } = await sb.from("stores").select("store,shop_domain,site_url");
    lojas = data ?? [];
  }
  const h = host.replace(/^www\./, "");
  return lojas.find((l) =>
    (shop && l.shop_domain?.toLowerCase() === shop) ||
    (h && l.site_url && new URL(l.site_url).hostname.replace(/^www\./, "") === h)
  )?.store ?? null;
}

const txt = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: cors });
  try {
    const corpo = await req.text();
    if (corpo.length > 6000) return new Response(null, { status: 413, headers: cors });
    const b = JSON.parse(corpo);
    const evento = b.evento === "upload" ? "upload" : b.evento === "geracao" ? "geracao" : null;
    const store = await lojaDe(String(b.shop ?? "").toLowerCase(), String(b.host ?? "").toLowerCase());
    if (evento && store) {
      const id = String(b.product_id ?? "").replace(/\D/g, "");
      const status = Number.isFinite(Number(b.status)) ? Math.trunc(Number(b.status)) : null;
      const { error } = await sb.from("ia_eventos").insert({
        store,
        evento,
        product_id: id ? `gid://shopify/Product/${id}` : null,
        handle: txt(b.handle, 200),
        ok: evento === "geracao" ? b.ok !== false : null,
        status,
        aid: txt(b.aid, 100),
        url: txt(b.url, 300),
        efeito: txt(b.efeito, 400),
      });
      if (error) console.error("ia_eventos", error.message);
    }
  } catch (e) {
    console.error("ia-coleta", String(e));
  }
  return new Response(null, { status: 204, headers: cors });
});
