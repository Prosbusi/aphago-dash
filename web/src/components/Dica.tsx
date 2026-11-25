import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as PEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Explicação de uma métrica: abre ao passar o mouse (computador) ou ao tocar/clicar (celular e computador).
 * Fecha ao tocar fora, apertar Esc ou rolar a página. O balão fica preso dentro da tela.
 */
export function Dica({ texto, children, className = "" }: { texto: string; children: ReactNode; className?: string }) {
  const [aberta, setAberta] = useState(false);
  const [fixa, setFixa] = useState(false); // aberta por clique: não fecha ao tirar o mouse
  const [pos, setPos] = useState<{ top: number; left: number; acima: boolean } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const balao = useRef<HTMLDivElement>(null);
  const fechar = useRef<number>();
  const id = useId();

  const fecharAgora = useCallback(() => { setAberta(false); setFixa(false); }, []);

  // posição: abaixo do ícone; se não couber, acima. Sempre dentro da largura da tela.
  useLayoutEffect(() => {
    if (!aberta || !botao.current) return;
    const b = botao.current.getBoundingClientRect();
    const largura = balao.current?.offsetWidth ?? 260;
    const altura = balao.current?.offsetHeight ?? 60;
    const margem = 8;
    const left = Math.min(Math.max(margem, b.left + b.width / 2 - largura / 2), window.innerWidth - largura - margem);
    const acima = b.bottom + 6 + altura > window.innerHeight - margem && b.top - 6 - altura > margem;
    setPos({ top: acima ? b.top - 6 - altura : b.bottom + 6, left, acima });
  }, [aberta, texto]);

  useEffect(() => {
    if (!aberta) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (botao.current?.contains(alvo) || balao.current?.contains(alvo)) return;
      fecharAgora();
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fecharAgora(); };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    window.addEventListener("scroll", fecharAgora, true);
    window.addEventListener("resize", fecharAgora);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", fecharAgora, true);
      window.removeEventListener("resize", fecharAgora);
    };
  }, [aberta, fecharAgora]);

  const mouseEntra = (e: PEvent) => {
    if (e.pointerType !== "mouse") return;
    window.clearTimeout(fechar.current);
    setAberta(true);
  };
  const mouseSai = (e: PEvent) => {
    if (e.pointerType !== "mouse" || fixa) return;
    fechar.current = window.setTimeout(() => setAberta(false), 120);
  };

  return (
    <>
      <button
        ref={botao}
        type="button"
        aria-label={texto}
        aria-expanded={aberta}
        aria-describedby={aberta ? id : undefined}
        onPointerEnter={mouseEntra}
        onPointerLeave={mouseSai}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (aberta && fixa) fecharAgora();
          else { setAberta(true); setFixa(true); }
        }}
        className={`relative inline-flex cursor-help items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-aphago/50 before:absolute before:-inset-2.5 before:content-[''] ${className}`}
      >
        {children}
      </button>
      {aberta &&
        createPortal(
          <div
            ref={balao}
            id={id}
            role="tooltip"
            onPointerEnter={mouseEntra}
            onPointerLeave={mouseSai}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="fixed z-[100] w-max max-w-[min(300px,calc(100vw-16px))] whitespace-pre-line rounded-[10px] bg-[#1F1B24] px-3 py-2 text-left text-[12.5px] font-medium leading-snug text-white shadow-lg"
          >
            {texto}
          </div>,
          document.body,
        )}
    </>
  );
}
