import { useEffect, useRef } from "react";

interface TiltOptions {
  /** Max rotateX/rotateY in degrees. Default 9. */
  maxDeg?: number;
  /** Max parallax translate in px. Default 8. */
  maxShift?: number;
}

/**
 * useTiltOnHover — subtle 3D tilt toward the cursor with a gold glow that
 * ramps as the cursor approaches the element's center.
 *
 * - Desktop only: requires `(hover: hover) and (pointer: fine)`.
 * - Honors `prefers-reduced-motion` (no tilt at all).
 * - rAF-throttled mousemove; animates only `transform` + `filter`
 *   (GPU-friendly) and eases back to rest on mouseleave.
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

    let raf = 0;
    const setFromPoint = (clientX: number, clientY: number) => {
      const { maxDeg = 9, maxShift = 8 } = optsRef.current;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      const nx = clamp((clientX - (rect.left + rect.width / 2)) / (rect.width / 2));
      const ny = clamp((clientY - (rect.top + rect.height / 2)) / (rect.height / 2));
      const dist = Math.hypot(nx, ny);
      const glow = Math.max(0, 1 - dist / 1.8); // 1 at center → 0 away
      el.style.transform =
        `perspective(700px) rotateX(${(-ny * maxDeg).toFixed(2)}deg) ` +
        `rotateY(${(nx * maxDeg).toFixed(2)}deg) ` +
        `translate3d(${(nx * maxShift).toFixed(1)}px, ${(ny * maxShift).toFixed(1)}px, 0)`;
      el.style.filter =
        `drop-shadow(0 0 ${(8 + glow * 28).toFixed(1)}px ` +
        `rgba(218, 165, 32, ${(0.22 + glow * 0.58).toFixed(2)}))`;
    };

    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.transition = "transform 0.1s linear, filter 0.18s ease-out";
        setFromPoint(e.clientX, e.clientY);
      });
    };
    const onLeave = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      // Ease back to rest (base glow restored by clearing inline styles).
      el.style.transition =
        "transform 0.65s cubic-bezier(0.22,1,0.36,1), filter 0.65s ease-out";
      el.style.transform = "";
      el.style.filter = "";
    };

    el.style.willChange = "transform, filter";
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
      el.style.willChange = "";
      el.style.transition = "";
      el.style.transform = "";
      el.style.filter = "";
    };
  }, []);

  return ref;
}
