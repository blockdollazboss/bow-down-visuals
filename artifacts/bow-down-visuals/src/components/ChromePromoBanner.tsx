import { useState } from "react";
import { Globe, X, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { useChromePromoVisible, markChromeInstalled, optOutChromePromo } from "@/lib/chrome-promo";

/* Dashboard banner promoting the Bow Down Visuals Chrome web app.
   Only shows to Chrome Android visitors, until they mark it installed
   (persistent localStorage flag), plus a per-session dismiss. */

const DISMISS_KEY = "chrome-banner-dismissed";

export default function ChromePromoBanner() {
  const promoVisible = useChromePromoVisible();
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

  const optOut = () => {
    optOutChromePromo();
    dismiss();
  };

  return (
    <div className="relative overflow-hidden rounded-[18px] border border-[#c9a84c]/30 bg-gradient-to-r from-[#c9a84c]/[0.08] via-transparent to-transparent px-5 py-4 flex items-center gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#c9a84c]/40 bg-[#c9a84c]/10">
        <Globe className="h-5 w-5 text-[#e8c86a]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-white">
          Install Bow Down Visuals <span className="text-[#e8c86a]">· Free</span>
        </p>
        <p className="text-xs text-white/45 mt-0.5 truncate">
          Add the studio to your home screen straight from Chrome — no download needed.
        </p>
      </div>
      <Link
        href="/download"
        onClick={markChromeInstalled}
        className="shrink-0 flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] px-4 py-2 text-xs font-bold text-black hover:brightness-110 transition"
      >
        Install <ArrowRight className="h-3.5 w-3.5" />
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-2 right-2 rounded-full p-1 text-white/30 hover:text-white transition"
      >
        <X className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={optOut}
        className="absolute bottom-1.5 right-3 text-[10px] text-white/25 hover:text-white/50 transition"
      >
        Don't show again
      </button>
    </div>
  );
}
