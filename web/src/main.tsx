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
import { EmBreve } from "./pages/EmBreve";
import { Links } from "./pages/Links";
import { LOJAS } from "./lib/store";

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
              <Route index element={<Navigate to="/geral" replace />} />
              <Route path="geral" element={<Resumo />} />
              <Route path="geral/links" element={<Links />} />
              <Route path="geral/ajustes" element={<Ajustes />} />
              {/* endereços antigos */}
              <Route path="links" element={<Navigate to="/geral/links" replace />} />
              <Route path="ajustes" element={<Navigate to="/geral/ajustes" replace />} />
              <Route path=":store" element={<LojaValida><VisaoGeral /></LojaValida>} />
              <Route path=":store/canais" element={<LojaValida><PorCanal /></LojaValida>} />
              <Route path=":store/produtos" element={<LojaValida><Produtos /></LojaValida>} />
              <Route path=":store/jornada" element={<LojaValida><Jornada /></LojaValida>} />
              <Route
                path=":store/retorno"
                element={<LojaValida><EmBreve titulo="Retorno" texto="Investimento, ROAS e custo por compra por canal, campanha e anúncio. Entra quando conectarmos Meta Ads e Google Ads." /></LojaValida>}
              />
              <Route
                path=":store/lancamentos"
                element={<LojaValida><EmBreve titulo="Lançamentos" texto="O placar de cada coleção desde o lançamento: D+1, D+3, D+7, faturamento, investimento e ROAS." /></LojaValida>}
              />
              <Route path="*" element={<Navigate to="/geral" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </PeriodProvider>
    </AuthGate>
  </React.StrictMode>,
);
