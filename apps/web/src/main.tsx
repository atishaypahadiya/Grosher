import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import "./fonts.css";
import "./styles.css";
import { registerSW } from "virtual:pwa-register";

console.info(`[grosher] build ${import.meta.env.VITE_BUILD_ID}`);

// Offline after the first load: the service worker (src/sw.ts) precaches the app and the store textures,
// answers navigations network-first, and takes over as soon as a new version installs.
registerSW({ immediate: true });

/** after App's first commit: tells the boot guard (index.html) the app started */
function Booted() {
  useEffect(() => window.__grosherBoot?.(), []);
  return null;
}

createRoot(document.getElementById("root")!, {
  onUncaughtError: (error) => console.error("[grosher] uncaught", error),
}).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <Booted />
    </ErrorBoundary>
  </StrictMode>,
);
