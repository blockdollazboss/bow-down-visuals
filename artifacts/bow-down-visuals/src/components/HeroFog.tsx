import { useEffect, useRef } from "react";

/* ─────────────────── Homepage hero ground fog ─────────────────── */
/* Flowing white smoke around the Shark King's feet — distinct drifting
   wisps and rising tendrils, NOT one uniform haze. Two families:
   - Ground drifters: wide soft wisps sliding sideways along the stage.
   - Rising tendrils: narrower columns that curl upward past his ankles
     and dissipate, like real smoke.
   Pure CSS, no assets, no cost.

   Motion:
   1. Mouse glide (rAF) — the whole smoke mass chases the cursor
      (±220px peak), with per-wisp parallax so nearer wisps visibly
      outrun farther ones.
   2. Ambient flow (CSS) — drift, sway-with-curl, and rise-and-fade
      keyframes keep every wisp alive when the pointer is still.

   Layering: above the spotlight rig (z-[2]) so the smoke catches the
   beams, over the shark's feet (z-[4], placed after him in the DOM so it
   veils rather than hides behind him), and below the curtain overlay
   (z-[5]) and the hero copy (z-10).

   Reduced motion: the flow stops and the glide snaps 1:1 (no easing). */

interface Wisp {
  left: string;
  bottom: string;
  width: string;
  height: string;
  radius: string;
  blur: number;
  peak: number;   // peak opacity (0…1)
  depth: number;  // mouse parallax factor — nearer wisps glide further
  anim: "smoke-drift" | "smoke-sway" | "smoke-rise";
  duration: string;
  delay: string;
  reverse?: boolean;
  coreY: string;  // vertical center of the bright core ("50%" | "70%"…)
}

const WISPS: Wisp[] = [
  /* Ground-hugging drifters — wide, soft, sliding sideways. */
  { left: "-9%", bottom: "-30%", width: "36%", height: "118%", radius: "50%", blur: 46, peak: 0.5,  depth: 1.0,  anim: "smoke-drift", duration: "27s", delay: "0s",    coreY: "62%" },
  { left: "17%", bottom: "-36%", width: "28%", height: "106%", radius: "50%", blur: 54, peak: 0.4,  depth: 0.55, anim: "smoke-drift", duration: "35s", delay: "-13s", reverse: true, coreY: "58%" },
  { left: "43%", bottom: "-28%", width: "34%", height: "122%", radius: "50%", blur: 48, peak: 0.46, depth: 0.8,  anim: "smoke-sway",  duration: "31s", delay: "-9s",  coreY: "64%" },
  { left: "69%", bottom: "-34%", width: "30%", height: "110%", radius: "50%", blur: 56, peak: 0.38, depth: 0.45, anim: "smoke-drift", duration: "39s", delay: "-21s", reverse: true, coreY: "60%" },
  { left: "89%", bottom: "-30%", width: "24%", height: "108%", radius: "50%", blur: 50, peak: 0.44, depth: 0.65, anim: "smoke-sway",  duration: "25s", delay: "-6s",  coreY: "62%" },
  /* Rising tendrils — narrower columns that curl upward past the ankles
     and dissipate. Staggered so there is always smoke rising. */
  { left: "7%",  bottom: "-6%", width: "15%", height: "148%", radius: "46% 54% 52% 48% / 64% 62% 38% 36%", blur: 36, peak: 0.5,  depth: 0.9,  anim: "smoke-rise", duration: "22s", delay: "-7s",  coreY: "72%" },
  { left: "51%", bottom: "-8%", width: "13%", height: "158%", radius: "54% 46% 48% 52% / 60% 64% 36% 40%", blur: 34, peak: 0.44, depth: 0.7,  anim: "smoke-rise", duration: "27s", delay: "-15s", coreY: "74%" },
  { left: "79%", bottom: "-4%", width: "14%", height: "142%", radius: "50% 50% 46% 54% / 66% 62% 38% 34%", blur: 38, peak: 0.47, depth: 0.85, anim: "smoke-rise", duration: "24s", delay: "-2s",  coreY: "70%" },
];

/* Peak glide travel, px each way (scaled per-wisp by depth). Big on
   purpose — the user should SEE the smoke follow the cursor. */
const GLIDE_RANGE = 220;
/* Ease per frame — snappy enough to feel alive, smooth enough to feel
   like drifting smoke rather than a rigid layer. */
const GLIDE_EASE = 0.14;

export function HeroFog({ className = "" }: { className?: string }) {
  const wispsRef = useRef<(HTMLDivElement | null)[]>([]);

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
      // Per-wisp parallax via the CSS `translate` property, which composes
      // with the ambient flow animation's `transform` instead of fighting it.
      const wisps = wispsRef.current;
      for (let i = 0; i < wisps.length; i++) {
        const el = wisps[i];
        if (!el) continue;
        const depth = WISPS[i]?.depth ?? 0.5;
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
        // Tall, gentle fade — the smoke rises past the ankles and dissolves
        // softly into the stage light instead of ending in a hard band.
        maskImage: "linear-gradient(to bottom, transparent 0%, black 62%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 62%)",
      }}
    >
      {WISPS.map((w, i) => (
        <div
          key={i}
          ref={(el) => { wispsRef.current[i] = el; }}
          className="hero-fog-wisp absolute"
          style={{
            left: w.left,
            bottom: w.bottom,
            width: w.width,
            height: w.height,
            borderRadius: w.radius,
            // Rising tendrils manage their own opacity through the
            // smoke-rise keyframes (fade in at the base, out at the top);
            // drifters hold a steady peak opacity.
            opacity: w.anim === "smoke-rise" ? undefined : w.peak,
            ["--wisp-peak" as string]: w.peak,
            animationName: w.anim,
            animationDuration: w.duration,
            animationDelay: w.delay,
            animationDirection: w.reverse ? "reverse" : "normal",
            background: `radial-gradient(ellipse at 50% ${w.coreY}, rgba(255,255,255,0.6) 0%, rgba(255,250,240,0.26) 45%, transparent 75%)`,
            filter: `blur(${w.blur}px)`,
          }}
        />
      ))}
    </div>
  );
}
