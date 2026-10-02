import { useEffect, useState } from "react";

/* ─── Extension promo visibility ───
   The Thy Cheat Code Chrome extension is promoted site-wide (homepage band,
   dashboard banner, auth badge, sidebar) UNTIL the visitor downloads it.
   Clicking any download link calls markExtensionDownloaded(), which sets a
   persistent localStorage flag; every promo surface hides itself after that.
   The /extension page itself always stays reachable. */

const DOWNLOADED_KEY = "bdv-extension-downloaded";
const OPTOUT_KEY = "bdv-extension-promo-optout";
const MODAL_SHOWN_KEY = "bdv-extension-modal-last-shown";

export function hasDownloadedExtension(): boolean {
  try {
    return localStorage.getItem(DOWNLOADED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markExtensionDownloaded(): void {
  try {
    localStorage.setItem(DOWNLOADED_KEY, "1");
    window.dispatchEvent(new Event("bdv-extension-downloaded"));
  } catch {
    /* private mode — promo just stays visible */
  }
}

/** "Stop promoting it" — the user told Thy Cheat Code (or a promo) enough. */
export function hasOptedOutExtensionPromo(): boolean {
  try {
    return localStorage.getItem(OPTOUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function optOutExtensionPromo(): void {
  try {
    localStorage.setItem(OPTOUT_KEY, "1");
    window.dispatchEvent(new Event("bdv-extension-promo-optout"));
  } catch {
    /* private mode */
  }
}

/** Reactive: true when the extension promo should show (not downloaded, not opted out). */
export function useExtensionPromoVisible(): boolean {
  const [visible, setVisible] = useState(
    () => !hasDownloadedExtension() && !hasOptedOutExtensionPromo()
  );
  useEffect(() => {
    const hide = () => setVisible(false);
    window.addEventListener("bdv-extension-downloaded", hide);
    window.addEventListener("bdv-extension-promo-optout", hide);
    // Cross-tab: another tab downloads or opts out → hide here too.
    const onStorage = (e: StorageEvent) => {
      if (
        (e.key === DOWNLOADED_KEY || e.key === OPTOUT_KEY) &&
        e.newValue === "1"
      )
        hide();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("bdv-extension-downloaded", hide);
      window.removeEventListener("bdv-extension-promo-optout", hide);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return visible;
}

/** Once per day at most: should the promo modal pop up right now? */
export function shouldShowPromoModal(): boolean {
  if (hasDownloadedExtension() || hasOptedOutExtensionPromo()) return false;
  try {
    const last = localStorage.getItem(MODAL_SHOWN_KEY);
    const today = new Date().toISOString().slice(0, 10);
    return last !== today;
  } catch {
    return true;
  }
}

export function markPromoModalShown(): void {
  try {
    localStorage.setItem(MODAL_SHOWN_KEY, new Date().toISOString().slice(0, 10));
  } catch {
    /* ignore */
  }
}

/* ─── PWA install (Chrome app) ─── */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPwaPrompt: BeforeInstallPromptEvent | null = null;
const pwaListeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    deferredPwaPrompt = e as BeforeInstallPromptEvent;
    pwaListeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferredPwaPrompt = null;
    pwaListeners.forEach((fn) => fn());
  });
}

/** Reactive PWA install state: canInstall + promptInstall(). */
export function usePwaInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const bump = () => force((n) => n + 1);
    pwaListeners.add(bump);
    return () => {
      pwaListeners.delete(bump);
    };
  }, []);
  const isInstalled =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true);
  return {
    canInstall: !!deferredPwaPrompt && !isInstalled,
    isInstalled,
    promptInstall: async () => {
      if (!deferredPwaPrompt) return false;
      await deferredPwaPrompt.prompt();
      const { outcome } = await deferredPwaPrompt.userChoice;
      deferredPwaPrompt = null;
      pwaListeners.forEach((fn) => fn());
      return outcome === "accepted";
    },
  };
}
