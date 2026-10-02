import { useEffect, useState } from "react";

/* ─── Extension promo visibility ───
   The Thy Cheat Code Chrome extension is promoted site-wide (homepage band,
   dashboard banner, auth badge, sidebar) UNTIL the visitor downloads it.
   Clicking any download link calls markExtensionDownloaded(), which sets a
   persistent localStorage flag; every promo surface hides itself after that.
   The /extension page itself always stays reachable. */

const DOWNLOADED_KEY = "bdv-extension-downloaded";

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

/** Reactive: true when the extension promo should show (not downloaded). */
export function useExtensionPromoVisible(): boolean {
  const [visible, setVisible] = useState(() => !hasDownloadedExtension());
  useEffect(() => {
    const hide = () => setVisible(false);
    window.addEventListener("bdv-extension-downloaded", hide);
    // Cross-tab: another tab downloads → hide here too.
    const onStorage = (e: StorageEvent) => {
      if (e.key === DOWNLOADED_KEY && e.newValue === "1") hide();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("bdv-extension-downloaded", hide);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return visible;
}
