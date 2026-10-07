import { useEffect, useState } from "react";

/* ─── Android app promo visibility ───
   The Bow Down Visuals Android APK is promoted to Android visitors
   (dashboard banner, /download page, sidebar) UNTIL they download it.
   Clicking the download link calls markAndroidDownloaded(), which sets a
   persistent localStorage flag; every promo surface hides itself after that.
   Mirrors the extension promo pattern in extension-promo.ts. */

const DOWNLOADED_KEY = "bdv-android-downloaded";
const OPTOUT_KEY = "bdv-android-promo-optout";

/** True when the visitor is on an Android device. */
export function isAndroidDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

export function hasDownloadedAndroidApp(): boolean {
  try {
    return localStorage.getItem(DOWNLOADED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markAndroidDownloaded(): void {
  try {
    localStorage.setItem(DOWNLOADED_KEY, "1");
    window.dispatchEvent(new Event("bdv-android-downloaded"));
  } catch {
    /* private mode — promo just stays visible */
  }
}

export function hasOptedOutAndroidPromo(): boolean {
  try {
    return localStorage.getItem(OPTOUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function optOutAndroidPromo(): void {
  try {
    localStorage.setItem(OPTOUT_KEY, "1");
    window.dispatchEvent(new Event("bdv-android-promo-optout"));
  } catch {
    /* private mode */
  }
}

/** Reactive: true when the Android promo should show to this visitor. */
export function useAndroidPromoVisible(): boolean {
  const [visible, setVisible] = useState(
    () =>
      isAndroidDevice() &&
      !hasDownloadedAndroidApp() &&
      !hasOptedOutAndroidPromo()
  );
  useEffect(() => {
    const hide = () => setVisible(false);
    window.addEventListener("bdv-android-downloaded", hide);
    window.addEventListener("bdv-android-promo-optout", hide);
    const onStorage = (e: StorageEvent) => {
      if (
        (e.key === DOWNLOADED_KEY || e.key === OPTOUT_KEY) &&
        e.newValue === "1"
      )
        hide();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("bdv-android-downloaded", hide);
      window.removeEventListener("bdv-android-promo-optout", hide);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return visible;
}
