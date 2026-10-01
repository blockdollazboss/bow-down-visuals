import { useEffect, useRef } from "react";

/* ─────────────────── Homepage hero ground fog ─────────────────── */
/* Soft gold-tinted fog banks pooling around the Shark King's feet at the
   bottom of the hero. Pure CSS blobs, no assets, no cost.

   Motion, two layers that stack:
   1. Mouse glide (rAF) — the whole fog bank eases toward the cursor
      horizontally, with per-blob parallax: nearer, denser banks travel
      further than far ones. Tracks the spotlight rig's glide so the fog
      and the beams move as one atmosphere.
   2. Ambient drift (CSS) — a faint slow drift keeps the fog alive when
      the pointer is still.

   Layering: above the spotlight rig (z-[2]) so the fog catches the beams,
   over the shark's feet (z-[4], placed after him in the DOM so it veils
   rather than hides behind him), and below the curtain overlay (z-[5])
   and the hero copy (z-10).

   Reduced motion: the drift stops and the glide snaps 1:1 (no easing). */

interface FogBlob {
  left: string;
  width: string;
  duration: string;
  delay: string;
  opacity: number;
  depth: number; // parallax factor — nearer banks glide further
  reverse?: boolean;
}

const BLOBS: FogBlob[] = [
  { left: "-6%", width: "46%", duration: "26s", delay: "0s",   opacity: 0.85, depth: 1.0 },
  { left: "18%", width: "40%", duration: "34s", delay: "-11s", opacity: 0.7,  depth: 0.55, reverse: true },
  { left: "44%", width: "48%", duration: "29s", delay: "-7s",  opacity: 0.8,  depth: 0.8 },
  { left: "68%", width: "42%", duration: "38s", delay: "-19s", opacity: 0.65, depth: 0.4,  reverse: true },
  { left: "88%", width: "30%", duration: "24s", delay: "-4s",  opacity: 0.72, depth: 0.65 },
];

/* Peak glide travel, px each way (scaled per-blob by depth). */
const GLIDE_RANGE = 90;

export function HeroFog({ className = "" }: { className?: string }) {
  const blobsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let targetX = 0; // -1 … 1 across the viewport
    let cx = 0;
    let raf = 0;
    let cancelled = false;

    const onMove = (e: PointerEvent) => {
      targetX = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const loop = () => {
      if (cancelled) return;
      // Ease toward the cursor — mirrors the spotlight rig's glide.
      cx += (targetX - cx) * (reduce ? 1 : 0.06);
      if (Math.abs(targetX - cx) < 0.001) cx = targetX;
      // Per-blob parallax via the CSS `translate` property, which composes
      // with the ambient drift animation's `transform` instead of fighting it.
      const blobs = blobsRef.current;
      for (let i = 0; i < blobs.length; i++) {
        const el = blobs[i];
        if (!el) continue;
        const depth = BLOBS[i]?.depth ?? 0.5;
        el.style.translate = `${(cx * GLIDE_RANGE * depth).toFixed(1)}px 0px`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute overflow-hidden ${className}`}
      style={{
        maskImage: "linear-gradient(to bottom, transparent 0%, black 45%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 45%)",
      }}
    >
      {BLOBS.map((b, i) => (
        <div
          key={i}
          ref={(el) => { blobsRef.current[i] = el; }}
          className="hero-fog-blob absolute bottom-[-30%] h-[130%] rounded-[50%]"
          style={{
            left: b.left,
            width: b.width,
            opacity: b.opacity,
            animationDuration: b.duration,
            animationDelay: b.delay,
            animationDirection: b.reverse ? "reverse" : "normal",
            background:
              "radial-gradient(ellipse at center, rgba(255,232,160,0.42) 0%, rgba(255,216,125,0.20) 45%, transparent 75%)",
            filter: "blur(48px)",
          }}
        />
      ))}
    </div>
  );
}
