import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./fonts.css";
import "./styles.css";
import { registerSW } from "virtual:pwa-register";

// Offline after the first load: the service worker precaches the app and
// the store textures; new versions install in the background.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
