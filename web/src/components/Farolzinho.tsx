/** Farolzinho, o mascote do Pharol. `facho` acende o feixe de luz (pisca quando `piscando`). */
export type Humor = "feliz" | "pensando" | "triste" | "dormindo";

export function Farolzinho({
  tamanho = 64,
  humor = "feliz",
  facho = false,
  piscando = false,
  className = "",
}: {
  tamanho?: number;
  humor?: Humor;
  facho?: boolean;
  piscando?: boolean;
  className?: string;
}) {
  const ink = "#3A2E5C";
  const larg = facho ? 78 : 60;
  return (
    <svg
      aria-hidden="true"
      width={(tamanho * larg) / 96}
      height={tamanho}
      viewBox={`${facho ? 0 : 9} 0 ${larg} 96`}
      className={`shrink-0 ${className}`}
    >
      {facho && <path d="M48 18 L78 6 L78 34 Z" fill="#FFD447" className={piscando ? "farol-facho" : ""} opacity=".6" />}
      <path d="M39 4 L54 18 L24 18 Z" fill="#7C5CE0" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
      <rect x="27" y="18" width="24" height="12" rx="3" fill="#FFD447" stroke={ink} strokeWidth="2" />
      <path d="M26 30 L52 30 L57 90 L21 90 Z" fill="#fff" stroke={ink} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M24.6 54 L53.4 54 L54.6 66 L23.4 66 Z" fill="#FF7A7A" />
      <path d="M22.6 76 L55.4 76 L56.2 86 L21.8 86 Z" fill="#FF7A7A" />
      {humor === "dormindo" ? (
        <>
          <path d="M30 40 Q33 42.5 36 40" stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M42 40 Q45 42.5 48 40" stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="33" cy="40" r="2.6" fill={ink} />
          <circle cx="45" cy="40" r="2.6" fill={ink} />
          <circle cx="34" cy="39" r=".8" fill="#fff" />
          <circle cx="46" cy="39" r=".8" fill="#fff" />
        </>
      )}
      {humor === "feliz" && <path d="M35 45 Q39 48.5 43 45" stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />}
      {humor === "pensando" && <circle cx="39" cy="46.5" r="1.8" fill={ink} />}
      {humor === "triste" && <path d="M35 48 Q39 44.5 43 48" stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />}
      {humor === "dormindo" && <path d="M36 46.5 h6" stroke={ink} strokeWidth="2" strokeLinecap="round" />}
      <circle cx="29" cy="45" r="2.6" fill="#FFB3B3" />
      <circle cx="49" cy="45" r="2.6" fill="#FFB3B3" />
    </svg>
  );
}
