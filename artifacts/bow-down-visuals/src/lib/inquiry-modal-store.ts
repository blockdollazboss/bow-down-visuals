/* inquiry-modal-store — the ad-inquiry modal's home OUTSIDE the loader.
 *
 * Pass 8 defect (payfix Fix 2): the loading-screen Spotlight / Loading
 * Screen Takeover promo card was effectively unclickable. WittyLoader
 * rendered the inquiry modals inside itself, and every WittyLoader host
 * (ProtectedRoute, GuestGate, video-editor) unmounts the loader the
 * moment loading resolves — so the SPA replaced the screen before a
 * click could land, and even a landed click lost its form when the
 * loader unmounted a beat later.
 *
 * The fix is a race fix, not a rebuild: the click now records the
 * inquiry in this tiny module-level store, and InquiryModalHost —
 * mounted once at the App root, which SPA navigation never unmounts —
 * renders the EXISTING SpotlightModal / LoadingScreenModal from it.
 * The form therefore survives the loader's unmount and stays up until
 * the user closes it or submits. The inquiry forms themselves (and
 * their /api/spotlight/inquire + /api/loading-screen/inquire rails
 * into spotlight_inquiries) are untouched.
 */

export type InquiryKind = "spotlight" | "loading-screen";

let current: InquiryKind | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

/** Open (or switch to) an inquiry form. Called by the promo card click. */
export function openInquiry(kind: InquiryKind) {
  if (current === kind) return;
  current = kind;
  emit();
}

/** Close the inquiry form — only ever from the user's own action. */
export function closeInquiry() {
  if (current === null) return;
  current = null;
  emit();
}

export function getInquiry(): InquiryKind | null {
  return current;
}

export function subscribeInquiry(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
