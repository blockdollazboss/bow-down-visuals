import { useEffect, useRef, useState } from "react";
import { popupCoordinator, type PopupId } from "@/lib/popup-coordinator";

/**
 * usePopupSlot — a pop-up's claim on the first-session coordinator
 * (lib/popup-coordinator.ts, QC G10).
 *
 * `want` is the pop-up's own trigger ("my content is ready and I would
 * show now"). The return value is the coordinator's answer: render only
 * when it is true. While another coordinated pop-up holds the slot this
 * one waits — it is promoted automatically, highest priority first,
 * when the slot frees. Closing (want → false) or unmounting releases
 * the slot. A pop-up the coordinator denies (already shown this
 * session, per-person restraint) simply never renders.
 *
 * personKey is read through a ref, deliberately NOT an effect dep:
 * when sign-in resolves mid-display (guest → the member's id), the
 * claim must not release and re-claim — the session record already
 * marks the pop-up shown, so a re-claim would be denied and the
 * visible pop-up would vanish. The restraint records use the person
 * current at grant time.
 */
export function usePopupSlot(id: PopupId, personKey: string, want: boolean): boolean {
  const [granted, setGranted] = useState(false);
  const personRef = useRef(personKey);
  personRef.current = personKey;

  useEffect(() => {
    if (!want) {
      setGranted(false);
      return;
    }
    if (popupCoordinator.claim(id, personRef.current)) {
      setGranted(true);
      return () => {
        popupCoordinator.release(id);
      };
    }
    setGranted(false);
    const unsubscribe = popupCoordinator.subscribe(() => {
      if (popupCoordinator.activeId() === id) setGranted(true);
    });
    return () => {
      unsubscribe();
      popupCoordinator.release(id);
    };
  }, [id, want]);

  return want && granted;
}
