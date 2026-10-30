import { useEffect, useRef, useState } from "react";
import { firstGamepad } from "@/lib/world/gamepad";
import { hudIdleDue, isTextEntryElement } from "@/lib/world/hud-idle";

/**
 * The World's furniture idle (stack900, owner's directive
 * 2026-10-29: no "bunch of selections around" the fullscreen).
 * While the walker is simply IN the World — no panel, desk,
 * settings, map or keyboard open (the page folds all of those
 * into `enabled`) — the header, the footer, the radio chip and
 * the compass carry [data-hud-fade] and the page root wears
 * .hud-idle once the controls have sat untouched for
 * HUD_IDLE_MS: the furniture fades, the place remains.
 *
 * Activity is broad on purpose, because waking must be
 * effortless: any pointer move or press, any key, any pad
 * button or stick deflection stamps the clock and (when the
 * furniture is already out) brings it straight back. The rule
 * is the same windowed as fullscreen — the furniture is the
 * same furniture, and a walker practising in a window earns
 * the same clean frame; fullscreen is just where the ring of
 * selections hurt most.
 *
 * Two things never count as quiet: a focused text field (the
 * say box, a desk field — typing owns the input, so the
 * furniture holds while a field holds focus), and the tab
 * hiding (rAF sleeps with it; nothing fades out from under a
 * walker who isn't looking).
 */
export function useHudIdle(opts: { enabled: boolean }): boolean {
  const { enabled } = opts;
  const [idle, setIdle] = useState(false);
  const idleRef = useRef(false);
  idleRef.current = idle;

  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let lastActivity = performance.now();
    let textFocused = isTextEntryElement(document.activeElement as Element | null);
    let raf = 0;
    let disposed = false;

    const stamp = () => {
      lastActivity = performance.now();
      if (idleRef.current) setIdle(false);
    };
    const onPointer = () => stamp();
    const onKey = () => stamp();
    const onFocusIn = (e: FocusEvent) => {
      textFocused = isTextEntryElement(e.target as Element | null);
      if (textFocused) stamp();
    };
    const onFocusOut = () => {
      /* Read the NEXT focus owner on the following tick — a
       * field-to-field hop must not read as "no field". */
      window.setTimeout(() => {
        textFocused = isTextEntryElement(document.activeElement as Element | null);
      }, 0);
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    const loop = () => {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      /* The pad wakes the furniture too: any button down or a
       * stick pushed past the drift line is a walker at the
       * controls, even mid-walk with no verb firing. */
      const pad = firstGamepad(navigator.getGamepads ? navigator.getGamepads() : []);
      if (pad) {
        const buttonDown = pad.buttons.some((b) => b.pressed);
        const stickMoved = pad.axes.some((a) => Math.abs(a) > 0.3);
        if (buttonDown || stickMoved) stamp();
      }
      if (!idleRef.current && !textFocused && hudIdleDue(lastActivity, performance.now())) {
        setIdle(true);
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [enabled]);

  return idle;
}
