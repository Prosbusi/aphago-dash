/** Marca do Pharol: o facho de luz de um farol, em forma de cone. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 12 22 4v16Z" fill="#F2B632" />
      <path d="M3.5 12 22 8.5v7Z" fill="#F7CF6B" />
      <circle cx="3.5" cy="12" r="2.5" fill="#17171A" />
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
