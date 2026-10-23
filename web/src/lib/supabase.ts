import { createClient } from "@supabase/supabase-js";

// Chave publicável: pode ficar no código. Os dados só saem do banco
// para quem fez login e está na lista de acesso (regras de acesso no Supabase).
const SUPABASE_URL = "https://gajxzdfcttcocsnjdvha.supabase.co";
const SUPABASE_KEY = "sb_publishable_wAumkku4CCdCphaqM9yB6g_ySsXO0Hz";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  // pkce: o retorno do login chega como ?code=..., sem conflitar com as rotas em #/
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

/** Busca todas as linhas de uma consulta, em páginas de 1000 (limite da API). */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
