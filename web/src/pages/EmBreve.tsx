import { PageTitle } from "../components/ui";

export function EmBreve({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <>
      <PageTitle title={titulo} />
      <section className="rounded-[14px] border border-dashed border-[#C9C3B7] bg-white px-6 py-10 text-center">
        <p className="m-0 text-sm font-bold">Fase 2</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">{texto}</p>
      </section>
    </>
  );
}
