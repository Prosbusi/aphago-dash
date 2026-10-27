import { useParams } from "react-router-dom";
import type { StoreId } from "./data";

export const LOJAS: { id: StoreId; nome: string; cor: string }[] = [
  { id: "aphago", nome: "Aphago", cor: "#A065E7" },
  { id: "abrasso", nome: "Abrasso", cor: "#E39A6F" },
];

export const nomeLoja = (id: string) => LOJAS.find((l) => l.id === id)?.nome ?? id;

/** Loja da rota atual (/aphago/..., /abrasso/...). */
export function useStoreParam(): StoreId {
  const { store } = useParams();
  return (LOJAS.some((l) => l.id === store) ? store : "aphago") as StoreId;
}
