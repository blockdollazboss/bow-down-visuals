import { useEffect, useRef } from "react";

/* ─────────────────── Homepage hero ground fog ─────────────────── */
/* Flowing white smoke around the Shark King's feet — distinct drifting
   wisps and rising tendrils, NOT one uniform haze. Two families:
   - Ground drifters: wide soft wisps sliding sideways along the stage.
   - Rising tendrils: narrower columns that curl upward past his ankles
     and dissipate, like real smoke.
   Pure CSS + a small rAF loop, no assets, no cost.

   Motion:
   1. Mouse glide (rAF) — the whole smoke mass chases the cursor
      (±160px peak), with per-wisp parallax so nearer wisps visibly
      outrun farther ones.
   2. Cursor flow field (rAF) — the smoke behaves like a stream the
      cursor moves through. Each wisp feels the cursor through a
      gaussian influence zone around it:
        · stream — smoke near the cursor is dragged along the cursor's
          travel path (a visible wake);
        · part — smoke bows away from the cursor like water around a
          hull, so the fog visibly parts where you point;
        · stretch — fast cursor movement elongates nearby wisps along
          the direction of travel, like smoke streaking in a draft.
      Far wisps stay put, so the smoke streams and swirls instead of
      sliding as a rigid block.
   3. Ambient flow (CSS) — drift, sway-with-curl, and rise-and-fade
      keyframes keep every wisp alive when the pointer is still.

   Layering: above the spotlight rig (z-[2]) so the smoke catches the
   beams, over the shark's feet (z-[4], placed after him in the DOM so it
   veils rather than hides behind him), and below the curtain overlay
   (z-[5]) and the hero copy (z-10).

   Reduced motion: the flow field and glide ease off — glide snaps 1:1,
   no streaming, no stretch. */

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

const pct = (s: string) => parseFloat(s) / 100;

/* Whole-mass cursor chase, px each way (scaled per-wisp by depth). */
const GLIDE_RANGE = 160;
const GLIDE_EASE = 0.14;
/* Cursor flow field: gaussian influence radius around the cursor,
   as a fraction of the fog container's width. */
const FLOW_RADIUS = 0.42;
/* STREAM: px of wisp displacement per px/frame of cursor travel. */
const PUSH_GAIN = 2.4;
/* PART: radial push away from the cursor at the zone center, px. */
const PART_GAIN = 30;
/* STRETCH: elongation along the travel direction per px/frame of
   smoothed cursor speed (capped at STRETCH_MAX). */
const STRETCH_GAIN = 0.012;
const STRETCH_MAX = 0.55;
/* Smooth the cursor velocity so the stretch doesn't jitter. */
const VEL_SMOOTH = 0.25;

export function HeroFog({ className = "" }: { className?: string }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const wispsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const box = boxRef.current;
    if (!box) return;

    let targetX = 0; // glide target, -1 … 1 across the viewport
    let cx = 0;      // eased glide position
    let px = 0, py = 0;   // cursor, fog-container px
    let ppx = 0, ppy = 0; // previous-frame cursor
    let vx = 0, vy = 0;   // smoothed cursor velocity, px/frame
    let hasPointer = false;
    let raf = 0;
    let cancelled = false;

    const onMove = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      px = e.clientX - r.left;
      py = e.clientY - r.top;
      targetX = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      if (!hasPointer) {
        ppx = px;
        ppy = py;
        hasPointer = true;
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const loop = () => {
      if (cancelled) return;
      const r = box.getBoundingClientRect();
      const W = Math.max(1, r.width);
      const H = Math.max(1, r.height);

      // Glide: the whole smoke mass chases the cursor, faster than the
      // spotlight rig so the smoke feels light.
      cx += (targetX - cx) * (reduce ? 1 : GLIDE_EASE);
      if (Math.abs(targetX - cx) < 0.001) cx = targetX;

      // Smoothed cursor velocity drives the flow field.
      const ivx = px - ppx;
      const ivy = py - ppy;
      ppx = px;
      ppy = py;
      if (!reduce && hasPointer) {
        vx += (ivx - vx) * VEL_SMOOTH;
        vy += (ivy - vy) * VEL_SMOOTH;
      } else {
        vx = 0;
        vy = 0;
      }
      const speed = Math.hypot(vx, vy);
      const R = W * FLOW_RADIUS;
      const headingDeg = speed > 0.5 ? (Math.atan2(vy, vx) * 180) / Math.PI : 0;

      // Per-wisp flow: translate / rotate / scale are individual CSS
      // properties, so they compose with the ambient `transform` keyframes
      // instead of fighting them.
      const wisps = wispsRef.current;
      for (let i = 0; i < wisps.length; i++) {
        const el = wisps[i];
        if (!el) continue;
        const w = WISPS[i];
        const depth = w?.depth ?? 0.5;
        // Wisp center in container px (bottom-anchored → y measured from top).
        const wx = (pct(w?.left ?? "0") + pct(w?.width ?? "0") / 2) * W;
        const wy = H - (pct(w?.bottom ?? "0") + pct(w?.height ?? "0") / 2) * H;

        let dx = 0;
        let dy = 0;
        let rot = "";
        let scl = "";
        if (!reduce && hasPointer && speed > 0.01) {
          const ox = wx - px;
          const oy = wy - py;
          const dist = Math.hypot(ox, oy);
          const q = dist / R;
          const infl = Math.exp(-q * q);
          if (infl > 0.01) {
            // Stream: drag nearby smoke along the cursor's travel path.
            dx += vx * PUSH_GAIN * infl * depth;
            dy += vy * PUSH_GAIN * infl * depth;
            // Part: bow the smoke away from the cursor, like a hull.
            const d = Math.max(1, dist);
            dx += (ox / d) * PART_GAIN * infl * depth;
            dy += (oy / d) * PART_GAIN * infl * depth;
            // Stretch: elongate along the travel direction so fast
            // movement streaks the smoke like a draft.
            if (speed > 0.5) {
              const st = Math.min(STRETCH_MAX, speed * STRETCH_GAIN * infl);
              if (st > 0.02) {
                rot = `${headingDeg.toFixed(1)}deg`;
                scl = `${(1 + st).toFixed(3)} ${(1 - st * 0.4).toFixed(3)}`;
              }
            }
          }
        }
        const x = cx * GLIDE_RANGE * depth + dx;
        el.style.translate = `${x.toFixed(1)}px ${dy.toFixed(1)}px`;
        el.style.rotate = rot;
        el.style.scale = scl;
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
      ref={boxRef}
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
