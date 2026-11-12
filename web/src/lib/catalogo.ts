import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useDataVersion } from "./data";

// Catálogo por família de produto (função catalogo_familias no banco).

export type FamiliaCat = {
  familia: string; nome: string; imagem: string | null; modelos: string; anuncios: number; gasto: number; cliques: number;
  impressoes: number; compras_meta: number; receita_meta: number; unidades: number; receita: number; pedidos: number; pedidos_novos: number;
};
export type ProdutoCat = {
  familia: string; product_id: string; title: string; online_url: string | null; image_url: string | null;
  unidades: number; receita: number; pedidos: number;
};
export type Catalogo = {
  totais: {
    gasto_meta: number; gasto_familia: number; gasto_all: number; gasto_sem_familia: number;
    receita: number; unidades: number; pedidos: number; gasto_google: number;
  };
  familias: FamiliaCat[];
  modelos: { letra: string; modelo: string; unidades: number; receita: number }[];
  produtos: ProdutoCat[];
  familia_modelos: { familia: string; letra: string; unidades: number; receita: number }[];
  dias: { dia: string; familia: string; receita: number; gasto: number }[];
  canais: { familia: string; canal: string; grupo: string; valor: number }[];
};

export const MODELO: Record<string, string> = {
  a: "Camiseta", b: "Algodão Peruano", c: "Oversized", d: "Suéter", e: "Hoodie", f: "Moletom Cropped", g: "Cropped", h: "Regata",
  i: "Body", j: "Mini", k: "Caneca", l: "Quadro", m: "Poster", n: "Capa de Mala", o: "Camiseta Frente e Verso", p: "Oversized Frente e Verso",
};

/** Ordem fixa de cores categóricas (validada para daltonismo nos pares vizinhos). Nunca reciclar: o 7º vira "Outros". */
export const CATEGORICAS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
export const OUTROS = "#a8a49b";

export const roas = (receita: number, gasto: number) => (gasto > 0 ? receita / gasto : null);

export function useCatalogo(store: string, inicio: string, fim: string) {
  const v = useDataVersion();
  const [state, setState] = useState<{ data?: Catalogo; error?: string }>({});
  useEffect(() => {
    let vivo = true;
    setState({});
    supabase.rpc("catalogo_familias", { p_store: store, p_inicio: inicio, p_fim: fim }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) { setState({ error: error.message }); return; }
      const d = data as Catalogo;
      const n = (x: unknown) => Number(x) || 0;
      d.familias = d.familias.map((f) => ({
        ...f, gasto: n(f.gasto), receita: n(f.receita), unidades: n(f.unidades), cliques: n(f.cliques), impressoes: n(f.impressoes),
        compras_meta: n(f.compras_meta), receita_meta: n(f.receita_meta), pedidos: n(f.pedidos), pedidos_novos: n(f.pedidos_novos), anuncios: n(f.anuncios),
      }));
      for (const k of Object.keys(d.totais) as (keyof Catalogo["totais"])[]) d.totais[k] = n(d.totais[k]);
      d.modelos = d.modelos.map((m) => ({ ...m, receita: n(m.receita), unidades: n(m.unidades) }));
      d.produtos = (d.produtos ?? []).map((x) => ({ ...x, unidades: n(x.unidades), receita: n(x.receita), pedidos: n(x.pedidos) }));
      d.familia_modelos = d.familia_modelos.map((m) => ({ ...m, receita: n(m.receita), unidades: n(m.unidades) }));
      d.dias = d.dias.map((x) => ({ ...x, receita: n(x.receita), gasto: n(x.gasto) }));
      d.canais = d.canais.map((x) => ({ ...x, valor: n(x.valor) }));
      setState({ data: d });
    });
    return () => { vivo = false; };
  }, [store, inicio, fim, v]);
  return state;
}
