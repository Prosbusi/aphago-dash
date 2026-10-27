import { useId } from "react";

/** Marca do Pharol: a lâmpada (retângulo) e o facho de luz abrindo para a esquerda,
 *  em degradê do amarelo forte (junto da lâmpada) ao amarelo claro (ponta do facho). */
export function Logo({ size = 28 }: { size?: number }) {
  const id = `facho-${useId().replace(/:/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="20.5" y1="12" x2="2" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E09B00" />
          <stop offset="1" stopColor="#FADF8C" />
        </linearGradient>
      </defs>
      <path d="M20.5 12 2 4v16Z" fill={`url(#${id})`} />
      <rect x="19.5" y="9.5" width="3" height="5" fill="#17171A" />
    </svg>
  );
}

export function Marca() {
  return (
    <div className="flex items-center gap-2">
      <Logo />
      <div className="text-[17px] font-extrabold tracking-tight">Pharol</div>
    </div>
  );
}
