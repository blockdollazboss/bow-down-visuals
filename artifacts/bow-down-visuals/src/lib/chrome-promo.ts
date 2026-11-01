import { useEffect, useState } from "react";

/* ─── Chrome web app promo visibility ───
   Chrome mobile visitors get instructions to install Bow Down Visuals
   as a web app (menu → Install app / Add to Home Screen) UNTIL they
   mark it as installed. Mirrors the iOS promo pattern in ios-promo.ts. */

const INSTALLED_KEY = "bdv-chrome-installed";
const OPTOUT_KEY = "bdv-chrome-promo-optout";

/** True when the visitor is on Chrome for Android (mobile). Excludes
    Edge, Opera, Samsung Internet and other Chromium forks. */
export function isChromeMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  const isChrome = /Chrome\/\d+/i.test(ua);
  const isFork = /Edg|OPR|SamsungBrowser|Brave|Vivaldi|YaBrowser/i.test(ua);
  const isIOSChrome = /CriOS/i.test(ua);
  return isAndroid && isChrome && !isFork && !isIOSChrome;
}

function hasInstalledChromeApp(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markChromeInstalled(): void {
  try {
    localStorage.setItem(INSTALLED_KEY, "1");
    window.dispatchEvent(new Event("bdv-chrome-installed"));
  } catch {
    /* private mode — promo just stays visible */
  }
}

function hasOptedOutChromePromo(): boolean {
  try {
    return localStorage.getItem(OPTOUT_KEY) === "1";
  } catch {
    return false;
  }
}


/** Reactive: true when the Chrome promo should show to this visitor. */
