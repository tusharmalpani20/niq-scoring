import { initializeMonitoring, captureReactError } from "./monitoring";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

initializeMonitoring();

createRoot(document.getElementById("root")!, { onUncaughtError: captureReactError, onCaughtError: captureReactError }).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
