import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

document.documentElement.classList.add("dark");

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
