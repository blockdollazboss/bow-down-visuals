import { useEffect, useState } from "react";
import { X, Sparkles } from "lucide-react";
import SpotlightModal from "@/components/SpotlightModal";

/* Spotlight Takeover promo — floats over the auth-screen video background
   advertising the 7-day paid video slot. The existing video is untouched;
   this is purely a "this spot is for sale" overlay. */

const DISMISS_KEY = "spotlight-promo-dismissed";

export default function SpotlightPromo() {
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
    } catch { /* private mode */ }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
  };

  if (dismissed) return null;

  return (
    <>
      {/* Floating "this spot is for sale" badge over the video */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute top-4 right-4 z-20 group flex items-center gap-2 rounded-full border border-[#c9a84c]/50 bg-black/55 backdrop-blur-md px-4 py-2 text-sm font-medium text-[#e8c86a] shadow-[0_0_18px_rgba(201,168,76,0.25)] transition hover:bg-black/75 hover:shadow-[0_0_26px_rgba(201,168,76,0.45)]"
        aria-label="Advertise on this screen"
      >
        <Sparkles className="h-4 w-4" />
        <span>Your video here · $99/7 days</span>
        <span
          role="button"
          tabIndex={0}
          aria-label="Dismiss"
          className="ml-1 rounded-full p-0.5 text-white/40 hover:text-white"
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); dismiss(); } }}
        >
          <X className="h-3.5 w-3.5" />
        </span>
      </button>

      <SpotlightModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
