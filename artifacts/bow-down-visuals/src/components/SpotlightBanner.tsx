import { useState } from "react";
import { Sparkles, ArrowRight, X } from "lucide-react";
import SpotlightModal from "@/components/SpotlightModal";

/* Spotlight Takeover banner for the dashboard — logged-in users never see
   the auth screens, so this puts the "this spot is for sale" promo where
   they actually are. Dismissible per session. */

const DISMISS_KEY = "spotlight-banner-dismissed";

export default function SpotlightBanner() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
  };

  return (
    <>
      <div className="relative overflow-hidden rounded-[18px] border border-[#c9a84c]/30 bg-gradient-to-r from-[#c9a84c]/[0.08] via-transparent to-transparent px-5 py-4 flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#c9a84c]/40 bg-[#c9a84c]/10">
          <Sparkles className="h-5 w-5 text-[#e8c86a]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">
            Your video on our front door <span className="text-[#e8c86a]">· $99/7 days</span>
          </p>
          <p className="text-xs text-white/45 mt-0.5 truncate">
            Spotlight Takeover — your video as the background on the sign-in &amp; sign-up screens.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] px-4 py-2 text-xs font-bold text-black hover:brightness-110 transition"
        >
          Get this spot <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute top-2 right-2 rounded-full p-1 text-white/30 hover:text-white transition"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <SpotlightModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
