import { useSyncExternalStore } from "react";
import SpotlightModal from "@/components/SpotlightModal";
import LoadingScreenModal from "@/components/LoadingScreenModal";
import {
  closeInquiry,
  getInquiry,
  subscribeInquiry,
} from "@/lib/inquiry-modal-store";

/* InquiryModalHost — mounted ONCE at the App root (payfix Fix 2).
 *
 * Renders the existing Spotlight / Loading Screen inquiry modals from
 * the module-level inquiry store, so a form opened from the transient
 * WittyLoader promo card survives the loader unmounting underneath it
 * and stays interactive until the user closes or submits it.
 *
 * The wrapper is a fixed layer above the loader overlay (z-20000):
 * the modals' own z-50 resolves inside this stacking context, so the
 * form paints over the still-finishing loader instead of behind it.
 * pointer-events follow openness — when no inquiry is open the layer
 * is click-through and the (null-rendering) modals block nothing. */
export default function InquiryModalHost() {
  const kind = useSyncExternalStore(subscribeInquiry, getInquiry, () => null);

  return (
    <div
      data-testid="inquiry-modal-host"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 30000,
        pointerEvents: kind ? "auto" : "none",
      }}
    >
      <SpotlightModal open={kind === "spotlight"} onClose={closeInquiry} />
      <LoadingScreenModal open={kind === "loading-screen"} onClose={closeInquiry} />
    </div>
  );
}
