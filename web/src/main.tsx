import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthGate } from "./auth";
import { PeriodProvider } from "./period-context";
import { Layout } from "./components/Layout";
import { VisaoGeral } from "./pages/VisaoGeral";
import { PorCanal } from "./pages/PorCanal";
import { Produtos } from "./pages/Produtos";
import { Jornada } from "./pages/Jornada";
import { Ajustes } from "./pages/Ajustes";
import { EmBreve } from "./pages/EmBreve";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>
      <PeriodProvider>
        <HashRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<VisaoGeral />} />
              <Route path="canais" element={<PorCanal />} />
              <Route path="produtos" element={<Produtos />} />
              <Route path="jornada" element={<Jornada />} />
              <Route path="retorno" element={<EmBreve titulo="Retorno" texto="Investimento, ROAS e custo por compra por canal, campanha e anúncio. Entra quando conectarmos Meta Ads e Google Ads." />} />
              <Route path="lancamentos" element={<EmBreve titulo="Lançamentos" texto="O placar de cada coleção desde o lançamento: D+1, D+3, D+7, faturamento, investimento e ROAS." />} />
              <Route path="ajustes" element={<Ajustes />} />
              <Route path="*" element={<VisaoGeral />} />
            </Route>
          </Routes>
        </HashRouter>
      </PeriodProvider>
    </AuthGate>
  </React.StrictMode>,
);
