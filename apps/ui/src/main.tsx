import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { hydrate } from "./bridge/live";
import "./styles/app.css";

// In the desktop app, load first-run state and settings from the backend before the first
// render, so the first-run guard and every settings screen start from the real values.
void hydrate().finally(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
