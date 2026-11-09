import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { initializeSettingsPersistence } from "../packages/ui/src/app/settings-persistence.ts";

void initializeSettingsPersistence().then(() => createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
));
