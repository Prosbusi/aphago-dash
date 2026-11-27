// Vendas por UTM com o mesmo crédito do Por canal (função utm_painel no banco).
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useDataVersion } from "./data";

export type Modelo = "linear" | "em_u" | "primeiro" | "ultimo";
export const MODELOS: { id: Modelo; nome: string }[] = [
  { id: "linear", nome: "Linear" },
  { id: "em_u", nome: "Inteligente" },
  { id: "primeiro", nome: "Primeiro clique" },
  { id: "ultimo", nome: "Último clique" },
];

export type LinhaUtm = {
  canal: string; grupo: string; source: string | null; medium: string | null; campanha: string; conteudo: string | null; termo: string | null;
  valor: number; pedidos: number; novos: number; passaram: number;
  mensagem: { titulo: string; enviar_em: string; canal: string } | null;
};

const cache = new Map<string, LinhaUtm[]>();

export function useUtmPainel(store: string, inicio: string, fim: string, modelo: Modelo, ativo = true) {
  const v = useDataVersion();
  const chave = `${store}|${inicio}|${fim}|${modelo}|${v}`;
  const [st, setSt] = useState<{ chave?: string; data?: LinhaUtm[]; error?: string }>({});
  useEffect(() => {
    if (!ativo) return;
    const pronto = cache.get(chave);
    if (pronto) { setSt({ chave, data: pronto }); return; }
    let vivo = true;
    setSt({});
    supabase.rpc("utm_painel", { p_store: store, p_inicio: inicio, p_fim: fim, p_modelo: modelo }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) { setSt({ chave, error: error.message }); return; }
      const linhas = ((data ?? []) as LinhaUtm[]).map((l) => ({ ...l, valor: Number(l.valor), pedidos: Number(l.pedidos), novos: Number(l.novos), passaram: Number(l.passaram) }));
      cache.set(chave, linhas);
      setSt({ chave, data: linhas });
    });
    return () => { vivo = false; };
  }, [chave, ativo]); // eslint-disable-line react-hooks/exhaustive-deps
  return st.chave === chave ? st : {};
}
