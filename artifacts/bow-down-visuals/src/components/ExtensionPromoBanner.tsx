import { useState } from "react";
import { Puzzle, ArrowRight, X, Download } from "lucide-react";
import { useExtensionPromoVisible, markExtensionDownloaded } from "@/lib/extension-promo";

/* Dashboard banner promoting the Thy Cheat Code Chrome extension.
   Shows until the visitor downloads it (persistent localStorage flag),
   plus a per-session dismiss. Logged-in users never see auth screens,
   so this puts the promo where they actually are. */

const DISMISS_KEY = "extension-banner-dismissed";

export default function ExtensionPromoBanner() {
  const promoVisible = useExtensionPromoVisible();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (!promoVisible || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
  };

  return (
    <div className="relative overflow-hidden rounded-[18px] border border-[#c9a84c]/30 bg-gradient-to-r from-[#c9a84c]/[0.08] via-transparent to-transparent px-5 py-4 flex items-center gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#c9a84c]/40 bg-[#c9a84c]/10">
        <Puzzle className="h-5 w-5 text-[#e8c86a]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-white">
          Thy Cheat Code for Chrome <span className="text-[#e8c86a]">· Free</span>
        </p>
        <p className="text-xs text-white/45 mt-0.5 truncate">
          AI chat, every site tool, daily bonuses — in your browser toolbar.
        </p>
      </div>
      <a
        href="/bow-down-visuals-extension-v2.zip"
        download
        onClick={markExtensionDownloaded}
        className="shrink-0 flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] px-4 py-2 text-xs font-bold text-black hover:brightness-110 transition"
      >
        <Download className="h-3.5 w-3.5" /> Download
      </a>
      <a
        href="/extension"
        className="shrink-0 hidden sm:flex items-center gap-1.5 rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-white/70 hover:bg-white/5 transition"
      >
        Learn more <ArrowRight className="h-3.5 w-3.5" />
      </a>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-2 right-2 rounded-full p-1 text-white/30 hover:text-white transition"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
