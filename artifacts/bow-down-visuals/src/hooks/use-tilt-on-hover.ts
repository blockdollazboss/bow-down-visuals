import { useEffect, useRef } from "react";

interface TiltOptions {
  /** Max rotateX/rotateY in degrees. Default 9. */
  maxDeg?: number;
  /** Max parallax translate in px from hover tilt. Default 8. */
  maxShift?: number;
  /**
   * Follow the cursor: the element drifts toward the pointer anywhere on
   * the page with smooth eased (lerped) motion, on top of the hover tilt.
   * Intended for the hero logo. Default false (nav brand keeps tilt only).
   */
  track?: boolean;
  /** Fraction of the cursor-to-center distance applied as translation. Default 0.08. */
  trackFactor?: number;
  /** Max cursor-follow translation in px. Default 36. */
  trackMax?: number;
}

/**
 * useTiltOnHover — subtle 3D tilt toward the cursor with a gold glow that
 * ramps as the cursor approaches the element's center. Optionally (track:
 * true) the element also drifts toward the pointer with smooth eased motion.
 *
 * - Desktop only: requires `(hover: hover) and (pointer: fine)`; touch
 *   devices get a static element.
 * - Honors `prefers-reduced-motion` (no motion at all).
 * - One rAF loop per element lerps tilt / shift / track / glow toward
 *   their targets; animates only `transform` + `filter` (GPU-friendly)
 *   and eases back to rest when the cursor leaves.
 */
export function useTiltOnHover<T extends HTMLElement>(options: TiltOptions = {}) {
  const ref = useRef<T | null>(null);
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const { maxDeg = 9, maxShift = 8, track = false, trackFactor = 0.08, trackMax = 36 } =
      optsRef.current;

    const clampN = (v: number) => Math.max(-1, Math.min(1, v));
    const clampPx = (v: number) => Math.max(-trackMax, Math.min(trackMax, v));
    const lerp = (cur: number, tgt: number, k: number) => cur + (tgt - cur) * k;

    // Targets (t) and current lerped values (c): tilt deg, hover shift px,
    // track px, glow 0..1.
    let rTX = 0, rTY = 0, rCX = 0, rCY = 0;
    let sTX = 0, sTY = 0, sCX = 0, sCY = 0;
    let tTX = 0, tTY = 0, tCX = 0, tCY = 0;
    let gT = 0, gC = 0;

    let raf = 0;
    let running = false;

    const settled = () =>
      Math.abs(rTX - rCX) < 0.02 && Math.abs(rTY - rCY) < 0.02 &&
      Math.abs(sTX - sCX) < 0.05 && Math.abs(sTY - sCY) < 0.05 &&
      Math.abs(tTX - tCX) < 0.05 && Math.abs(tTY - tCY) < 0.05 &&
      Math.abs(gT - gC) < 0.004;

    const loop = () => {
      rCX = lerp(rCX, rTX, 0.2);
      rCY = lerp(rCY, rTY, 0.2);
      sCX = lerp(sCX, sTX, 0.2);
      sCY = lerp(sCY, sTY, 0.2);
      // Slow lerp = the eased "mouse tracking" drift.
      tCX = lerp(tCX, tTX, 0.07);
      tCY = lerp(tCY, tTY, 0.07);
      gC = lerp(gC, gT, 0.12);

      el.style.transform =
        `perspective(700px) rotateX(${rCX.toFixed(2)}deg) ` +
        `rotateY(${rCY.toFixed(2)}deg) ` +
        `translate3d(${(sCX + tCX).toFixed(1)}px, ${(sCY + tCY).toFixed(1)}px, 0)`;
      el.style.filter =
        `drop-shadow(0 0 ${(8 + gC * 28).toFixed(1)}px ` +
        `rgba(218, 165, 32, ${(0.22 + gC * 0.58).toFixed(2)}))`;

      if (settled()) {
        raf = 0;
        running = false;
      } else {
        raf = requestAnimationFrame(loop);
      }
    };
    const kick = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(loop);
      }
    };

    const center = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height };
    };

    // Hover tilt + glow, driven by cursor position over the element.
    const onElMove = (e: MouseEvent) => {
      const c = center();
      if (!c) return;
      const nx = clampN((e.clientX - c.x) / (c.w / 2));
      const ny = clampN((e.clientY - c.y) / (c.h / 2));
      rTX = -ny * maxDeg;
      rTY = nx * maxDeg;
      sTX = nx * maxShift;
      sTY = ny * maxShift;
      const dist = Math.hypot(nx, ny);
      gT = Math.max(0, 1 - dist / 1.8); // 1 at center → 0 away
      kick();
    };
    const onElLeave = () => {
      rTX = 0; rTY = 0;
      sTX = 0; sTY = 0;
      gT = 0;
      kick();
    };

    // Cursor tracking: drift toward the pointer wherever it is on the page.
    const onWinMove = (e: MouseEvent) => {
      const c = center();
      if (!c) return;
      tTX = clampPx((e.clientX - c.x) * trackFactor);
      tTY = clampPx((e.clientY - c.y) * trackFactor);
      kick();
    };
    const onWinOut = () => {
      tTX = 0;
      tTY = 0;
      kick();
    };

    el.style.willChange = "transform, filter";
    el.addEventListener("mousemove", onElMove);
    el.addEventListener("mouseleave", onElLeave);
    if (track) {
      window.addEventListener("mousemove", onWinMove, { passive: true });
      window.addEventListener("blur", onWinOut);
      document.documentElement.addEventListener("mouseleave", onWinOut);
    }

    return () => {
      el.removeEventListener("mousemove", onElMove);
      el.removeEventListener("mouseleave", onElLeave);
      if (track) {
        window.removeEventListener("mousemove", onWinMove);
        window.removeEventListener("blur", onWinOut);
        document.documentElement.removeEventListener("mouseleave", onWinOut);
      }
      if (raf) cancelAnimationFrame(raf);
      el.style.willChange = "";
      el.style.transform = "";
      el.style.filter = "";
    };
  }, []);

  return ref;
}
