import { Farolzinho } from "./Farolzinho";

/** Marca do Pharol: o Farolzinho + "pharol". `branco` para fundos escuros. */
export function Marca({ altura = 30, branco = false }: { altura?: number; branco?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label="Pharol" role="img">
      <Farolzinho tamanho={Math.round(altura * 1.25)} />
      <span
        aria-hidden="true"
        className={`font-black lowercase tracking-tight ${branco ? "text-white" : "text-ink"}`}
        style={{ fontSize: Math.round(altura * 0.85), lineHeight: 1 }}
      >
        pharol
      </span>
    </span>
  );
}
