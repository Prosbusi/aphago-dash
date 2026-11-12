import logo from "../assets/pharol-logo.png";
import logoBranco from "../assets/pharol-logo-branco.png";

/** Marca do Pharol: farol com o facho amarelo + "pharol". `branco` para fundos escuros. */
export function Marca({ altura = 30, branco = false }: { altura?: number; branco?: boolean }) {
  return <img src={branco ? logoBranco : logo} alt="Pharol" style={{ height: altura, width: "auto" }} className="block" />;
}
