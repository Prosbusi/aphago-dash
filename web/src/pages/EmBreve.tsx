import { PageTitle } from "../components/ui";
import { Farolzinho } from "../components/Farolzinho";

export function EmBreve({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <>
      <PageTitle title={titulo} />
      <section className="flex flex-col items-center rounded-[24px] border-2 border-dashed border-[#DCCDB3] bg-white px-6 py-10 text-center">
        <Farolzinho tamanho={80} humor="pensando" className="farol-balanco" />
        <p className="m-0 mt-3 text-sm font-bold">Fase 2</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">{texto}</p>
      </section>
    </>
  );
}
