import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import "./index.css";
import { AuthGate } from "./auth";
import { PeriodProvider } from "./period-context";
import { Layout } from "./components/Layout";
import { Resumo } from "./pages/Resumo";
import { VisaoGeral } from "./pages/VisaoGeral";
import { PorCanal } from "./pages/PorCanal";
import { Produtos } from "./pages/Produtos";
import { Jornada } from "./pages/Jornada";
import { Ajustes } from "./pages/Ajustes";
import { Links } from "./pages/Links";
import { Retorno } from "./pages/Retorno";
import { Lancamentos } from "./pages/Lancamentos";
import { Projecao } from "./pages/Projecao";
import { Acessos } from "./pages/Acessos";
import { Inicio } from "./pages/Inicio";
import { Cupons } from "./pages/Cupons";
import { GastosIA } from "./pages/GastosIA";
import { useAuth } from "./auth";
import { LOJAS } from "./lib/store";
import { Tarefas } from "./pages/time/Tarefas";
import { Produtos as ProdutosCriacao } from "./pages/time/Produtos";
import { Ideias } from "./pages/time/Ideias";
import { GrokConfig } from "./pages/time/Grok";
import { Comunicacao } from "./pages/Comunicacao";

/** Tela inicial: o administrador cai no Início; os demais, no Resumo (ou na primeira tela liberada). */
function Entrada() {
  const { isAdmin } = useAuth();
  return <Navigate to={isAdmin ? "/geral/inicio" : "/geral"} replace />;
}

/** Só deixa passar /aphago/... e /abrasso/...; o resto volta para o resumo. */
function LojaValida({ children }: { children: React.ReactNode }) {
  const { store } = useParams();
  return LOJAS.some((l) => l.id === store) ? <>{children}</> : <Navigate to="/geral" replace />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>
      <PeriodProvider>
        <HashRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Entrada />} />
              <Route path="geral/inicio" element={<Inicio />} />
              <Route path="geral" element={<Resumo />} />
              <Route path="geral/links" element={<Links />} />
              <Route path="geral/ajustes" element={<Ajustes />} />
              <Route path="geral/acessos" element={<Acessos />} />
              {/* endereços antigos */}
              <Route path="links" element={<Navigate to="/geral/links" replace />} />
              <Route path="ajustes" element={<Navigate to="/geral/ajustes" replace />} />
              <Route path="time" element={<Tarefas />} />
              <Route path="time/produtos" element={<ProdutosCriacao />} />
              <Route path="time/ideias" element={<Ideias />} />
              <Route path="time/grok" element={<GrokConfig />} />
              <Route path=":store" element={<LojaValida><VisaoGeral /></LojaValida>} />
              <Route path=":store/projecao" element={<LojaValida><Projecao /></LojaValida>} />
              <Route path=":store/canais" element={<LojaValida><PorCanal /></LojaValida>} />
              <Route path=":store/produtos" element={<LojaValida><Produtos /></LojaValida>} />
              <Route path=":store/jornada" element={<LojaValida><Jornada /></LojaValida>} />
              <Route path=":store/retorno" element={<LojaValida><Retorno /></LojaValida>} />
              <Route path=":store/cupons" element={<LojaValida><Cupons /></LojaValida>} />
              <Route path=":store/ia" element={<LojaValida><GastosIA /></LojaValida>} />
              <Route path=":store/lancamentos" element={<LojaValida><Lancamentos /></LojaValida>} />
              <Route path=":store/comunicacao/:canal" element={<LojaValida><Comunicacao /></LojaValida>} />
              <Route path="*" element={<Entrada />} />
            </Route>
          </Routes>
        </HashRouter>
      </PeriodProvider>
    </AuthGate>
  </React.StrictMode>,
);
