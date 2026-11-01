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

function hasInstalledIOSApp(): boolean {
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

function hasOptedOutIOSPromo(): boolean {
  try {
    return localStorage.getItem(OPTOUT_KEY) === "1";
  } catch {
    return false;
  }
}


/** Reactive: true when the iOS promo should show to this visitor. */
