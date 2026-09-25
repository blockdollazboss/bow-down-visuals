import { useEffect, useRef } from "react";

/* ─────────────────── Interactive video banner ─────────────────── */
/* Slim full-width strip (toolbar-sized) playing the Thy Cheat Code banner
   clip on loop. Pointer-reactive like the hero (see CinematicHero):
   horizontal pointer position across the banner eases a subtle "prowl" pan
   of the video layer toward the cursor (translateX ±24px, video scaled 1.06
   so the pan never exposes edges) so the shark feels like he swims toward
   your mouse, plus a soft gold radial glow that follows the cursor.
   Cheap by design: rAF loop, transform/opacity only, no layout thrash.
   Input is read at window level so tracking works even over the video;
   under prefers-reduced-motion the clip pauses and the pan snaps off. */

interface VideoBannerProps {
  /** Reports the strip's rendered height (px) — e.g. so the video editor's
   *  layout math can reserve the same space the old TopBar occupied. */
  onHeightChange?: (height: number) => void;
  className?: string;
}

export function VideoBanner({ onHeightChange, className }: VideoBannerProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const media = mediaRef.current;
    const glow = glowRef.current;
    const video = videoRef.current;
    if (!wrap || !media || typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce && video) video.pause();

    let targetX = 0; // -1 … 1 across the banner
    let currentX = 0;
    let glowTX = 0;
    let glowTY = 0;
    let glowCX = 0;
    let glowCY = 0;
    let raf = 0;
    let cancelled = false;

    const onPointerMove = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      // Ignore movement far above/below the strip (e.g. scrolled away).
      if (e.clientY < r.top - 120 || e.clientY > r.bottom + 120) return;
      targetX = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
      glowTX = e.clientX - r.left;
      glowTY = e.clientY - r.top;
    };
    // Ease back to center when the pointer leaves the page.
    const onLeave = () => {
      targetX = 0;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave, {
      passive: true,
    });

    const loop = () => {
      if (cancelled) return;
      const k = reduce ? 1 : 0.12;
      currentX += (targetX - currentX) * k;
      glowCX += (glowTX - glowCX) * k;
      glowCY += (glowTY - glowCY) * k;
      if (Math.abs(targetX - currentX) < 0.002) currentX = targetX;
      // Prowl pan toward the cursor; 1.06 scale hides the pan edges.
      media.style.transform = `translate3d(${(currentX * 24).toFixed(2)}px, 0, 0) scale(1.06)`;
      if (glow) {
        glow.style.transform = `translate3d(${glowCX.toFixed(1)}px, ${glowCY.toFixed(1)}px, 0) translate(-50%, -50%)`;
        glow.style.opacity = reduce ? "0" : "1";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  /* Report rendered height for layout consumers (video editor). */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !onHeightChange) return;
    const report = () => onHeightChange(el.getBoundingClientRect().height);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);

  const base = import.meta.env.BASE_URL;

  return (
    <div
      ref={wrapRef}
      className={`relative w-full overflow-hidden bg-black h-[72px] md:h-[88px] ${className ?? ""}`}
      aria-label="Bow Down Visuals banner"
    >
      {/* Prowl-pan video layer */}
      <div ref={mediaRef} className="absolute inset-0 will-change-transform">
        <video
          ref={videoRef}
          src={`${base}bowdownvisuals-banner-cheatcode.mp4`}
          className="h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
          tabIndex={-1}
        />
      </div>
      {/* Cursor-following gold glow */}
      <div
        ref={glowRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 h-44 w-44 rounded-full opacity-0"
        style={{
          background:
            "radial-gradient(circle, rgba(218,165,32,0.30) 0%, rgba(218,165,32,0.08) 45%, transparent 70%)",
        }}
      />
      {/* Gold hairline along the bottom edge */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
      />
    </div>
  );
}
