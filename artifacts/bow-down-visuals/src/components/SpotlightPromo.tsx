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
      {/* Floating "this spot is for sale" badge over the video.
          S27-06: the dismiss used to be a span role=button nested INSIDE
          the badge button (invalid nesting, 18px target). It is now a
          proper sibling button with a 40px hit area; the badge's own
          open-the-modal action is untouched. */}
      <div className="spotlight-promo-badge absolute top-4 right-4 z-20 group flex items-center gap-2 rounded-full border border-[#c9a84c]/50 bg-black/55 backdrop-blur-md pl-4 pr-1 py-2 text-sm font-medium text-[#e8c86a] shadow-[0_0_18px_rgba(201,168,76,0.25)] transition hover:bg-black/75 hover:shadow-[0_0_26px_rgba(201,168,76,0.45)]">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 text-sm font-medium text-[#e8c86a]"
          aria-label="Advertise on this screen"
        >
          <Sparkles className="h-4 w-4" />
          <span>Your video here · $1,000/7 days</span>
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          data-testid="spotlight-dismiss"
          className="flex h-10 w-10 -my-2 shrink-0 items-center justify-center rounded-full text-white/40 hover:text-white"
          onClick={dismiss}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <SpotlightModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
