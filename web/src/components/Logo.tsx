/** Marca do Pharol: um farol simples em traço, sobre fundo escuro. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg bg-ink text-white"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size * 0.7} height={size * 0.7} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {/* facho de luz */}
        <path d="M9 6.5 3.5 4.5M9 6.5 3.5 8.5M15 6.5l5.5-2M15 6.5l5.5 2" stroke="#F5C451" />
        {/* telhado e lanterna */}
        <path d="M10 5 12 3.2 14 5M10 5h4v3h-4z" />
        {/* torre, faixa e base */}
        <path d="M10.2 8 9 20h6L13.8 8" />
        <path d="M9.6 14h4.8" />
        <path d="M7 20h10" />
      </svg>
    </div>
  );
}

export function Marca() {
  return (
    <div className="flex items-center gap-2.5">
      <Logo />
      <div className="text-[17px] font-extrabold tracking-tight">Pharol</div>
    </div>
  );
}
