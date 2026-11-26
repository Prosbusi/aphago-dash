import { Navigate, useParams } from "react-router-dom";
import { PageTitle } from "../components/ui";
import { nomeLoja, useStoreParam } from "../lib/store";

const CANAIS: Record<string, { titulo: string; texto: string }> = {
  calendario: { titulo: "Calendário", texto: "Todos os envios do mês num lugar só: Grupo VIP, push e e-mail, para ver o que sai em cada dia." },
  vip: { titulo: "Grupo VIP", texto: "Mensagens do mês programadas aqui. O Grok busca a mensagem aprovada do dia e envia às 9h; os cliques, pedidos e cupons VIP voltam para cá." },
  push: { titulo: "Push", texto: "Pushes planejados aqui, com link e UTM automáticos. Um botão gera a planilha pronta para importar na Foxy." },
  email: { titulo: "E-mail", texto: "HTML, públicos e datas de cada e-mail. O Grok programa a partir daqui e os resultados mostram se algum envio precisa de ajuste." },
};

export function Comunicacao() {
  const { canal = "" } = useParams();
  const loja = useStoreParam();
  const c = CANAIS[canal];
  if (!c) return <Navigate to={`/${loja}/comunicacao/calendario`} replace />;
  return (
    <>
      <PageTitle title={c.titulo} sub={`${nomeLoja(loja)} · Comunicação`} />
      <section className="rounded-[14px] border border-dashed border-[#C9C3B7] bg-white px-6 py-10 text-center">
        <p className="m-0 text-sm font-bold">Em construção</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">{c.texto}</p>
      </section>
    </>
  );
}
