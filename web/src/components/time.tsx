import { useRef, useState, type ReactNode } from "react";
import { CORES_ETIQUETA, enviarImagem, useImagens } from "../lib/time";

const CORES_TEXTO: Record<string, string> = { red: "#dc2626", green: "#16a34a", blue: "#2563eb", yellow: "#b45309" };
const TOKEN = /\*\*([\s\S]+?)\*\*|(?<![\p{L}\d])_([\s\S]+?)_(?![\p{L}\d])|\+\+([\s\S]+?)\+\+|~~([\s\S]+?)~~|\[(red|green|blue|yellow)\]([\s\S]+?)\[\/\5\]/u;
const URL_RE = /(https?:\/\/[^\s)]+)/g;

function comLinks(t: string, chave: string): ReactNode[] {
  return t.split(URL_RE).map((parte, i) =>
    i % 2 ? <a key={`${chave}-l${i}`} href={parte} target="_blank" rel="noreferrer" className="break-all">{parte}</a> : <span key={`${chave}-t${i}`}>{parte}</span>,
  );
}

function formatar(texto: string, chave = "f"): ReactNode[] {
  const out: ReactNode[] = [];
  let resto = texto, i = 0;
  while (resto) {
    const m = TOKEN.exec(resto);
    if (!m) { out.push(...comLinks(resto, `${chave}-${i}`)); break; }
    if (m.index) out.push(...comLinks(resto.slice(0, m.index), `${chave}-${i++}`));
    const k = `${chave}-${i++}`;
    if (m[1] !== undefined) out.push(<strong key={k}>{formatar(m[1], k)}</strong>);
    else if (m[2] !== undefined) out.push(<em key={k}>{formatar(m[2], k)}</em>);
    else if (m[3] !== undefined) out.push(<u key={k}>{formatar(m[3], k)}</u>);
    else if (m[4] !== undefined) out.push(<s key={k}>{formatar(m[4], k)}</s>);
    else out.push(<span key={k} style={{ color: CORES_TEXTO[m[5]] }}>{formatar(m[6] ?? "", k)}</span>);
    resto = resto.slice(m.index + m[0].length);
  }
  return out;
}

/** Texto com a formatação do Fazeno (**negrito**, _itálico_, ++sublinhado++, ~~riscado~~, [red]cor[/red]) e links clicáveis. */
export function Texto({ children, className = "" }: { children: string; className?: string }) {
  return <div className={`whitespace-pre-wrap break-words text-sm ${className}`}>{formatar(children)}</div>;
}

export function EtiquetaTag({ nome, cor }: { nome: string; cor?: string }) {
  const c = CORES_ETIQUETA[cor ?? "green"] ?? CORES_ETIQUETA.green;
  return <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: c.fundo, color: c.texto }}>{nome}</span>;
}

export function Miniaturas({ caminhos, onRemover }: { caminhos: string[]; onRemover?: (c: string) => void }) {
  const links = useImagens(caminhos);
  if (!caminhos.length) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {caminhos.map((c) => (
        <li key={c} className="relative">
          <a href={links[c] || undefined} target="_blank" rel="noreferrer" className="block h-20 w-20 overflow-hidden rounded-lg border border-line bg-soft">
            {links[c] && <img src={links[c]} alt="" className="h-full w-full object-cover" />}
          </a>
          {onRemover && (
            <button type="button" aria-label="Remover imagem" onClick={() => onRemover(c)} className="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full border border-line bg-white text-xs font-bold">×</button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CampoImagens({ valor, onChange }: { valor: string[]; onChange: (v: string[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const enviar = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return;
    setEnviando(true); setErro(null);
    try {
      const novos: string[] = [];
      for (const a of Array.from(arquivos)) novos.push(await enviarImagem(a));
      onChange([...valor, ...novos]);
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha no envio"); }
    setEnviando(false);
  };
  return (
    <div className="flex flex-col gap-2">
      <Miniaturas caminhos={valor} onRemover={(c) => onChange(valor.filter((x) => x !== c))} />
      <div>
        <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { enviar(e.target.files); e.target.value = ""; }} />
        <button type="button" disabled={enviando} onClick={() => ref.current?.click()} className="min-h-9 rounded-lg border border-line bg-white px-3 text-[13px] font-semibold hover:bg-ground disabled:opacity-60">
          {enviando ? "Enviando…" : "Adicionar imagens"}
        </button>
        {erro && <span role="alert" className="ml-2 text-xs text-ruim">{erro}</span>}
      </div>
    </div>
  );
}

/** Recado curto no topo da tela (substitui os "toasts" do Fazeno). */
export type Recado = { tipo: "ok" | "aviso" | "erro"; texto: string } | null;
export function RecadoBox({ recado, onFechar }: { recado: Recado; onFechar: () => void }) {
  if (!recado) return null;
  const cor = recado.tipo === "ok" ? "border-bom/30 text-bom" : recado.tipo === "aviso" ? "border-[#B45309]/30 text-[#8A5A00]" : "border-ruim/30 text-ruim";
  return (
    <div role="status" className={`flex items-start justify-between gap-3 rounded-[14px] border bg-white px-5 py-3 text-sm ${cor}`}>
      <span>{recado.texto}</span>
      <button type="button" onClick={onFechar} aria-label="Fechar recado" className="font-bold">×</button>
    </div>
  );
}

export const inputCls = "min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm";
export const btnPrim = "min-h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-60";
export const btnSec = "min-h-10 rounded-lg border border-line bg-white px-4 text-sm font-semibold hover:bg-ground disabled:opacity-60";

export function Rotulo({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="text-[13px] font-semibold">{children}</label>;
}

export function Chip({ ativo, onClick, children, title }: { ativo: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" aria-pressed={ativo} title={title} onClick={onClick}
      className={`min-h-9 rounded-full border px-3 text-[13px] font-semibold ${ativo ? "border-ink bg-ink text-white" : "border-line bg-white text-body hover:bg-ground"}`}>
      {children}
    </button>
  );
}
