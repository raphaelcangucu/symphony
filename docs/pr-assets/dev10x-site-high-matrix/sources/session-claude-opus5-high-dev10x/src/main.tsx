import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// os estilos base entram antes dos componentes para que o CSS de cada
// componente possa sobrescrever as primitivas globais
import "./styles/tokens.css";
import "./styles/base.css";

import { App } from "./App";

const container = document.getElementById("root");

if (!container) {
  throw new Error("elemento #root não encontrado");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
