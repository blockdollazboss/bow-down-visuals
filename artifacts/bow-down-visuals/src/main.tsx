import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/i18n"; // initialize i18next before rendering
import { bootThemePack } from "./lib/theme-packs";

// Restore the saved theme (mode + pack) before the first paint: the
// mode class follows "bdv-theme" exactly as it always has, and a saved
// theme pack brings its world (data-theme-pack) with it — see
// lib/theme-packs.ts.
bootThemePack();

// Register the PWA service worker in production only — never in dev, where
// it would serve stale cached assets and break hot reload.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* service worker is a progressive enhancement — the site works without it */
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
