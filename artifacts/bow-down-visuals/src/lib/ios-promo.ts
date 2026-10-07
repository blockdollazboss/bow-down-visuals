import { useEffect, useState } from "react";

/* ─── iOS web app promo visibility ───
   iPhone/iPad visitors get instructions to install Bow Down Visuals
   as a Safari web app (Share → Add to Home Screen) UNTIL they mark it
   as installed. Mirrors the Android promo pattern in android-promo.ts. */

const INSTALLED_KEY = "bdv-ios-installed";
const OPTOUT_KEY = "bdv-ios-promo-optout";

/** True when the visitor is on an iPhone or iPad. */
export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPad on iOS 13+ reports as Macintosh — check touch points too
  const isIPadOS =
    /Macintosh/i.test(ua) &&
    typeof navigator.maxTouchPoints !== "undefined" &&
    navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(ua) || isIPadOS;
}

export function hasInstalledIOSApp(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markIOSInstalled(): void {
  try {
    localStorage.setItem(INSTALLED_KEY, "1");
    window.dispatchEvent(new Event("bdv-ios-installed"));
  } catch {
    /* private mode — promo just stays visible */
  }
}

export function hasOptedOutIOSPromo(): boolean {
  try {
    return localStorage.getItem(OPTOUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function optOutIOSPromo(): void {
  try {
    localStorage.setItem(OPTOUT_KEY, "1");
    window.dispatchEvent(new Event("bdv-ios-promo-optout"));
  } catch {
    /* private mode */
  }
}

/** Reactive: true when the iOS promo should show to this visitor. */
export function useIOSPromoVisible(): boolean {
  const [visible, setVisible] = useState(
    () =>
      isIOSDevice() &&
      !hasInstalledIOSApp() &&
      !hasOptedOutIOSPromo()
  );
  useEffect(() => {
    const hide = () => setVisible(false);
    window.addEventListener("bdv-ios-installed", hide);
    window.addEventListener("bdv-ios-promo-optout", hide);
    const onStorage = (e: StorageEvent) => {
      if (
        (e.key === INSTALLED_KEY || e.key === OPTOUT_KEY) &&
        e.newValue === "1"
      )
        hide();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("bdv-ios-installed", hide);
      window.removeEventListener("bdv-ios-promo-optout", hide);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return visible;
}
