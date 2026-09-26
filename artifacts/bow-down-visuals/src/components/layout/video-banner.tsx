import { useEffect, useRef } from "react";
import { Crown } from "lucide-react";

/* ─────────────────── Shark King banner ─────────────────── */
/* Slim full-width strip (toolbar-sized) starring the Shark King — the
   brand mascot — on his golden throne-room seascape. The strip is built
   to feel like ONE seamless visual with the page: its base color matches
   the site background (#0b0603), the artwork melts into that base through
   vertical edge fades, and gradient scrims dissolve the top/bottom seams
   into the surrounding page so there are no harsh edges.

   Pointer-reactive like the old banner: horizontal pointer position eases
   a subtle "prowl" pan of the artwork toward the cursor (±28px, artwork
   scaled 1.14 so the pan never exposes edges), plus a soft gold radial
   glow that follows the cursor. A slow ambient ken-burns drift runs on a
   wrapper layer (CSS animation, transform-only). Cheap by design: rAF
   loop + transform/opacity only, no layout thrash.

   Under prefers-reduced-motion the drift, shimmer and pan snap off. */

interface VideoBannerProps {
  /** Reports the strip's rendered height (px) — e.g. so the video editor's
   *  layout math can reserve the same space the old TopBar occupied. */
  onHeightChange?: (height: number) => void;
  className?: string;
}

/** Site background base — must match the gold-bullion tile's dark base. */
const PAGE_BG = "#0b0603";

export function VideoBanner({ onHeightChange, className }: VideoBannerProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const media = mediaRef.current;
    const glow = glowRef.current;
    if (!wrap || !media || typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
      // Prowl pan toward the cursor; 1.14 scale hides the pan edges.
      media.style.transform = `translate3d(${(currentX * 28).toFixed(2)}px, 0, 0) scale(1.14)`;
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
      className={`bdv-banner relative w-full overflow-hidden h-[72px] md:h-[88px] ${className ?? ""}`}
      style={{ backgroundColor: PAGE_BG }}
      aria-label="Bow Down Visuals banner"
    >
      {/* Ambient drift wrapper (CSS ken-burns) */}
      <div className="bdv-banner-drift absolute inset-0 will-change-transform">
        {/* Prowl-pan artwork layer — edge-faded so it melts into the base */}
        <div ref={mediaRef} className="absolute inset-0 will-change-transform">
          <video
            src={`${base}top-banner-drone.mp4`}
            autoPlay
            muted
            loop
            playsInline
            aria-hidden
            onEnded={(e) => { const v = e.currentTarget; v.currentTime = 0; v.play().catch(() => {}); }}
            className="h-full w-full object-cover object-[center_35%]"
            style={{
              maskImage:
                "linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%)",
            }}
          />
        </div>
      </div>

      {/* Blend scrims — dissolve the seams into the page background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-2/5"
        style={{
          background: `linear-gradient(to bottom, ${PAGE_BG} 0%, transparent 100%)`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background: `linear-gradient(to top, ${PAGE_BG} 0%, transparent 100%)`,
        }}
      />
      {/* Side vignettes — boundless edges */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1/4"
        style={{
          background: `linear-gradient(to right, ${PAGE_BG} 0%, transparent 100%)`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-1/4"
        style={{
          background: `linear-gradient(to left, ${PAGE_BG} 0%, transparent 100%)`,
        }}
      />

      {/* Gold shimmer sweep across the strip */}
      <div aria-hidden className="shimmer pointer-events-none absolute inset-0" />

      {/* Brand wordmark — centered, readable over the artwork */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          aria-hidden
          className="absolute h-16 w-[26rem] max-w-[80%] rounded-full"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(5,3,1,0.72) 0%, rgba(5,3,1,0.28) 55%, transparent 75%)",
          }}
        />
        <div className="relative flex flex-col items-center gap-0.5 px-4 text-center">
          <span className="flex items-center gap-2">
            <Crown
              className="h-3.5 w-3.5 md:h-4 md:w-4 text-[#e8c96a]"
              strokeWidth={2.2}
              aria-hidden
            />
            <span
              className="tracking-[0.22em] text-base md:text-xl text-transparent bg-clip-text"
              style={{
                fontFamily: "'Cinzel', serif",
                fontWeight: 700,
                backgroundImage:
                  "linear-gradient(100deg, #8a6b1f 0%, #e8c96a 25%, #fff3c4 50%, #e8c96a 75%, #8a6b1f 100%)",
                backgroundSize: "200% auto",
                filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.9))",
              }}
            >
              BOW&nbsp;DOWN&nbsp;VISUALS
            </span>
            <Crown
              className="h-3.5 w-3.5 md:h-4 md:w-4 text-[#e8c96a] -scale-x-100"
              strokeWidth={2.2}
              aria-hidden
            />
          </span>
          <span
            className="text-[9px] md:text-[10px] tracking-[0.38em] text-[#e8c96a] uppercase"
            style={{
              fontFamily: "'Cinzel', serif",
              fontWeight: 700,
              textShadow: "0 2px 6px rgba(0,0,0,0.95), 0 0 20px rgba(232,201,106,0.3)",
            }}
          >
            The Content Creator&rsquo;s Cheat Code
          </span>
        </div>
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

      {/* Soft gold hairline along the bottom edge */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
      />
    </div>
  );
}
