import { useEffect, useState } from "react";
import { X, Puzzle, Download, Smartphone } from "lucide-react";
import { Link } from "wouter";
import {
  shouldShowPromoModal,
  markPromoModalShown,
  markExtensionDownloaded,
  optOutExtensionPromo,
  usePwaInstall,
} from "@/lib/extension-promo";

/* ─── Extension + PWA reminder popup ───
   Pops up once per day (site-wide) until the visitor downloads the Chrome
   extension or tells us to stop. Two asks in one card:
     1. Download the Thy Cheat Code Chrome extension (v2 zip).
     2. Install bowdownvisuals.com as a Chrome app (PWA install prompt).
   "Don't show me this again" = permanent opt-out of all extension promos. */

export default function ExtensionPromoModal() {
  const [open, setOpen] = useState(false);
  const { canInstall, isInstalled, promptInstall } = usePwaInstall();
  const [pwaDone, setPwaDone] = useState(false);

  useEffect(() => {
    if (!shouldShowPromoModal()) return;
    const t = window.setTimeout(() => {
      setOpen(true);
      markPromoModalShown();
    }, 12000); // let the page settle first
    return () => window.clearTimeout(t);
  }, []);

  // If the extension gets downloaded while the modal is open, close it.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("bdv-extension-downloaded", close);
    return () => window.removeEventListener("bdv-extension-downloaded", close);
  }, [open ]);

  if (!open) return null;

  const close = () => setOpen(false);
  const stopAll = () => {
    optOutExtensionPromo();
    setOpen(false);
  };

  const installApp = async () => {
    const accepted = await promptInstall();
    if (accepted) setPwaDone(true);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Get Thy Cheat Code everywhere"
      className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-[#C9A84C]/40 bg-gradient-to-b from-[#171206] to-black p-7 text-center shadow-[0_0_60px_rgba(201,168,76,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute top-3 right-3 rounded-full p-1.5 text-white/40 hover:text-white transition"
        >
          <X className="h-4 w-4" />
        </button>

        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#e8c86a]">
          🦈 Thy Cheat Code reminds you
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">
          Take the cheat code <span className="text-[#e8c86a]">with you.</span>
        </h2>
        <p className="mt-2 text-sm text-white/55">
          AI chat, every site tool, daily bonuses and one-click saving — in your
          browser and on your home screen.
        </p>

        <div className="mt-6 space-y-3">
          <a
            href="/bow-down-visuals-extension-v2.zip"
            download
            onClick={() => {
              markExtensionDownloaded();
              setOpen(false);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#C9A84C] to-[#e8c86a] px-6 py-3.5 font-bold text-black hover:brightness-110 transition"
          >
            <Puzzle className="h-5 w-5" />
            Download the Chrome extension
          </a>

          {!isInstalled && !pwaDone && (
            canInstall ? (
              <button
                type="button"
                onClick={installApp}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 px-6 py-3.5 font-semibold text-white hover:bg-white/5 transition"
              >
                <Smartphone className="h-5 w-5 text-[#e8c86a]" />
                Install the site as a Chrome app
              </button>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3.5 text-left">
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Smartphone className="h-4 w-4 text-[#e8c86a]" /> Install as a Chrome app
                </p>
                <p className="mt-1 text-xs text-white/50">
                  Chrome menu <span className="text-white">⋮</span> → “Save and share” → “Install page as app”.
                  {typeof navigator !== "undefined" && /iPhone|iPad/i.test(navigator.userAgent)
                    ? " On iPhone: Share → Add to Home Screen."
                    : ""}
                </p>
              </div>
            )
          )}
          {(pwaDone || isInstalled) && (
            <p className="text-sm text-[#e8c86a]">✓ App installed — nice.</p>
          )}

          <Link href="/extension" onClick={close} className="block text-sm text-[#e8c86a] hover:underline">
            <Download className="mr-1 inline h-3.5 w-3.5" />
            Install guide &amp; details
          </Link>
        </div>

        <button
          type="button"
          onClick={stopAll}
          className="mt-5 text-xs text-white/30 underline hover:text-white/60 transition"
        >
          Don't show me this again
        </button>
      </div>
    </div>
  );
}
