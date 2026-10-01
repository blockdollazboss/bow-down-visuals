import { useEffect, useRef } from "react";

/* ─────────────────── Homepage hero ground fog ─────────────────── */
/* Bright white ground fog pooling around the Shark King's feet and rising
   past his ankles — high-contrast against the golden stage so it reads
   unmistakably as mist. Pure CSS, no assets, no cost.

   Motion:
   1. Mouse glide (rAF) — the fog chases the cursor fast and travels far
      (±160px peak), with per-blob parallax so nearer wisps visibly outrun
      farther ones. The motion is meant to be SEEN.
   2. Ambient drift (CSS) — a slow drift keeps the fog alive when the
      pointer is still.

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
  depth: number; // parallax factor — nearer wisps glide further
  reverse?: boolean;
}

const BLOBS: FogBlob[] = [
  { left: "-10%", width: "52%", duration: "26s", delay: "0s",   opacity: 0.8,  depth: 1.0 },
  { left: "16%",  width: "38%", duration: "34s", delay: "-11s", opacity: 0.65, depth: 0.55, reverse: true },
  { left: "42%",  width: "50%", duration: "29s", delay: "-7s",  opacity: 0.75, depth: 0.8 },
  { left: "66%",  width: "44%", duration: "38s", delay: "-19s", opacity: 0.6,  depth: 0.4,  reverse: true },
  { left: "86%",  width: "34%", duration: "24s", delay: "-4s",  opacity: 0.68, depth: 0.65 },
];

/* Peak glide travel, px each way (scaled per-blob by depth). Big on
   purpose — the user should SEE the smoke follow the cursor. */
const GLIDE_RANGE = 160;
/* Ease per frame — snappy enough to feel alive, smooth enough to feel
   like drifting smoke rather than a rigid layer. */
const GLIDE_EASE = 0.14;

/* The base bank follows the cursor at half depth so the whole fog mass
   visibly shifts while the wisps parallax over it. */
const BANK_DEPTH = 0.5;

export function HeroFog({ className = "" }: { className?: string }) {
  const blobsRef = useRef<(HTMLDivElement | null)[]>([]);
  const bankRef = useRef<HTMLDivElement | null>(null);

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
      // Chase the cursor — mirrors the spotlight rig's glide, faster.
      cx += (targetX - cx) * (reduce ? 1 : GLIDE_EASE);
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
      // The base bank shifts with the cursor so the whole mass moves.
      if (bankRef.current) {
        bankRef.current.style.translate = `${(cx * GLIDE_RANGE * BANK_DEPTH).toFixed(1)}px 0px`;
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
        // Tall, gentle fade — the fog rises past the ankles and dissolves
        // softly into the stage light instead of ending in a hard band.
        maskImage: "linear-gradient(to bottom, transparent 0%, black 62%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 62%)",
      }}
    >
      {/* Base bank — one continuous fog bed spanning the whole stage
          bottom so there are no gaps between the wisps. Brightest near
          the feet, dissolving upward. */}
      <div
        ref={bankRef}
        className="absolute inset-x-[-12%] bottom-[-4%] h-[92%]"
        style={{
          background:
            "linear-gradient(to top, rgba(255,255,255,0.08) 0%, rgba(255,253,248,0.34) 38%, rgba(255,250,240,0.14) 62%, transparent 88%)",
          filter: "blur(44px)",
        }}
      />
      {BLOBS.map((b, i) => (
        <div
          key={i}
          ref={(el) => { blobsRef.current[i] = el; }}
          className="hero-fog-blob absolute bottom-[-28%] h-[128%] rounded-[50%]"
          style={{
            left: b.left,
            width: b.width,
            opacity: b.opacity,
            animationDuration: b.duration,
            animationDelay: b.delay,
            animationDirection: b.reverse ? "reverse" : "normal",
            background:
              "radial-gradient(ellipse at center, rgba(255,255,255,0.46) 0%, rgba(255,250,240,0.22) 45%, transparent 75%)",
            filter: "blur(56px)",
          }}
        />
      ))}
    </div>
  );
}
