import { useEffect, useRef } from "react";

/**
 * useModalA11y — the dialog contract for hand-rolled overlays (the ones
 * that are NOT built on Radix, which traps natively): while `open`,
 * - Escape closes (calls onClose),
 * - Tab / Shift+Tab cycle inside the dialog container (focus trap),
 * - initial focus moves to the first focusable element (or the
 *   container itself when it has none),
 * - on close/unmount, focus returns to the element that had it before
 *   the dialog opened.
 *
 * Usage: attach the returned ref to the dialog element and give that
 * element role="dialog" aria-modal="true" tabIndex={-1}.
 *
 * Stacking (round 2): modals can stack (the credit-confirm dialog opens
 * over a publish modal). Open instances register on a module stack and
 * only the TOPMOST instance answers Escape/Tab, so one Escape closes
 * one dialog — the one the user is looking at — not the whole stack.
 */
const openStack: object[] = [];

export function useModalA11y<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const container = ref.current;
    if (!container) return;
    const instance = {};
    openStack.push(instance);
    const isTop = () => openStack[openStack.length - 1] === instance;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const initial = focusables()[0] ?? container;
    initial.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTop()) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === container || !container.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      const idx = openStack.indexOf(instance);
      if (idx >= 0) openStack.splice(idx, 1);
      document.removeEventListener("keydown", onKeyDown, true);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open ]);

  return ref;
}
