import { useEffect, useRef } from "react";

/* ─────────── Fog Lab A — real smoke sprites (DOM) ─────────── */
/* The same smoke, but rendered from photographic smoke-puff textures
   with true transparency (black baked to alpha, edges feathered), so no
   image borders or black boxes are ever visible. */

const TEX = [
  "/images/fog/smoke-1.png?v=2",
  "/images/fog/smoke-2.png?v=2",
  "/images/fog/smoke-3.png?v=2",
];

interface Sprite {
  tex: number;
  left: number;   // base position, % of container width
  bottom: number; // base position, % of container height (from bottom)
  size: number;   // width, % of container width
  peak: number;   // peak opacity
  depth: number;  // mouse parallax factor
  life: number;   // seconds per rise cycle
  phase: number;  // 0…1 start offset
  drift: number;  // horizontal sway amplitude, % of width
  rise: number;   // vertical travel over one life, % of height
  spin: number;   // deg per second
  flip: boolean;
}

const SPRITES: Sprite[] = [
  /* Low ground bank — wide, slow, barely rising. */
  { tex: 0, left: 4,  bottom: -14, size: 42, peak: 0.5,  depth: 1.0,  life: 26, phase: 0.0,  drift: 7, rise: 14, spin: 4,  flip: false },
  { tex: 1, left: 30, bottom: -18, size: 38, peak: 0.42, depth: 0.6,  life: 32, phase: 0.35, drift: 6, rise: 12, spin: -3, flip: true  },
  { tex: 2, left: 58, bottom: -15, size: 44, peak: 0.46, depth: 0.8,  life: 29, phase: 0.6,  drift: 8, rise: 16, spin: 3,  flip: false },
  { tex: 0, left: 82, bottom: -17, size: 36, peak: 0.4,  depth: 0.5,  life: 35, phase: 0.8,  drift: 6, rise: 10, spin: -4, flip: true  },
  /* Mid layer — drifting across. */
  { tex: 2, left: 14, bottom: -6,  size: 30, peak: 0.44, depth: 0.9,  life: 24, phase: 0.15, drift: 9, rise: 22, spin: 5,  flip: false },
  { tex: 0, left: 44, bottom: -8,  size: 34, peak: 0.38, depth: 0.7,  life: 27, phase: 0.5,  drift: 8, rise: 20, spin: -5, flip: true  },
  { tex: 1, left: 70, bottom: -5,  size: 28, peak: 0.42, depth: 0.85, life: 23, phase: 0.7,  drift: 10, rise: 24, spin: 4, flip: false },
  { tex: 2, left: 90, bottom: -9,  size: 26, peak: 0.36, depth: 0.55, life: 30, phase: 0.25, drift: 7, rise: 18, spin: -3, flip: true },
  /* Rising tendrils — narrower, climbing. */
  { tex: 1, left: 8,  bottom: 2,   size: 20, peak: 0.5,  depth: 0.95, life: 20, phase: 0.1,  drift: 5, rise: 55, spin: 6,  flip: false },
  { tex: 2, left: 36, bottom: 0,   size: 18, peak: 0.44, depth: 0.75, life: 24, phase: 0.55, drift: 6, rise: 62, spin: -6, flip: true  },
  { tex: 0, left: 62, bottom: 3,   size: 22, peak: 0.48, depth: 0.9,  life: 21, phase: 0.3,  drift: 5, rise: 58, spin: 5,  flip: false },
  { tex: 1, left: 84, bottom: 1,   size: 17, peak: 0.4,  depth: 0.65, life: 26, phase: 0.85, drift: 6, rise: 50, spin: -5, flip: true  },
  /* Deep background haze sprites — dim, huge, slow. */
  { tex: 0, left: 20, bottom: -22, size: 55, peak: 0.22, depth: 0.35, life: 40, phase: 0.4,  drift: 5, rise: 8,  spin: 2,  flip: false },
  { tex: 2, left: 60, bottom: -24, size: 58, peak: 0.2,  depth: 0.3,  life: 44, phase: 0.9,  drift: 5, rise: 8,  spin: -2, flip: true  },
];

const FLOW_RADIUS = 0.42;  // cursor influence, × container width
const PUSH_GAIN = 2.4;     // stream along cursor travel
const PART_GAIN = 30;      // part around the cursor
const STRETCH_GAIN = 0.012;
const STRETCH_MAX = 0.55;
const VEL_SMOOTH = 0.25;
const GLIDE_RANGE = 160;
const GLIDE_EASE = 0.14;

export function FogSprites({ className = "" }: { className?: string }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const elsRef = useRef<(HTMLImageElement | null)[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const box = boxRef.current;
    if (!box) return;

    let targetX = 0;
    let cx = 0;
    let px = 0, py = 0, ppx = 0, ppy = 0, vx = 0, vy = 0;
    let hasPointer = false;
    let raf = 0;
    let cancelled = false;
    const t0 = performance.now();

    const onMove = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      px = e.clientX - r.left;
      py = e.clientY - r.top;
      targetX = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      if (!hasPointer) { ppx = px; ppy = py; hasPointer = true; }
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const loop = (now: number) => {
      if (cancelled) return;
      const r = box.getBoundingClientRect();
      const W = Math.max(1, r.width);
      const H = Math.max(1, r.height);
      const t = (now - t0) / 1000;

      cx += (targetX - cx) * (reduce ? 1 : GLIDE_EASE);
      if (Math.abs(targetX - cx) < 0.001) cx = targetX;

      const ivx = px - ppx;
      const ivy = py - ppy;
      ppx = px; ppy = py;
      if (!reduce && hasPointer) {
        vx += (ivx - vx) * VEL_SMOOTH;
        vy += (ivy - vy) * VEL_SMOOTH;
      } else { vx = 0; vy = 0; }
      const speed = Math.hypot(vx, vy);
      const R = W * FLOW_RADIUS;
      const headingDeg = speed > 0.5 ? (Math.atan2(vy, vx) * 180) / Math.PI : 0;

      const els = elsRef.current;
      for (let i = 0; i < SPRITES.length; i++) {
        const el = els[i];
        const s = SPRITES[i];
        if (!el || !s) continue;
        const lt = ((t / s.life) + s.phase) % 1; // life 0…1
        const wPx = (s.size / 100) * W;
        // Ambient: rise + sideways sway + slow spin.
        let x = (s.left / 100) * W - wPx / 2
          + Math.sin(lt * Math.PI * 2 + s.phase * 12.56) * (s.drift / 100) * W;
        let y = -((s.bottom + lt * s.rise) / 100) * H; // up = negative
        let rot = reduce ? 0 : t * s.spin * (s.flip ? -1 : 1);
        let sclX = 1, sclY = 1;

        // Flow field: stream + part + stretch near the cursor.
        const scx = x + wPx / 2;
        const scy = H + y - wPx / 4; // approx visual center
        if (!reduce && hasPointer && speed > 0.01) {
          const ox = scx - px;
          const oy = scy - py;
          const dist = Math.hypot(ox, oy);
          const q = dist / R;
          const infl = Math.exp(-q * q);
          if (infl > 0.01) {
            x += vx * PUSH_GAIN * infl * s.depth;
            y += vy * PUSH_GAIN * infl * s.depth;
            const d = Math.max(1, dist);
            x += (ox / d) * PART_GAIN * infl * s.depth;
            y += (oy / d) * PART_GAIN * infl * s.depth;
            if (speed > 0.5) {
              const st = Math.min(STRETCH_MAX, speed * STRETCH_GAIN * infl);
              if (st > 0.02) {
                rot = headingDeg;
                sclX = 1 + st;
                sclY = 1 - st * 0.4;
              }
            }
          }
        }
        x += cx * GLIDE_RANGE * s.depth;

        el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
        el.style.rotate = rot ? `${rot.toFixed(1)}deg` : "";
        el.style.scale = sclX !== 1 || sclY !== 1
          ? `${sclX.toFixed(3)} ${sclY.toFixed(3)}`
          : "";
        // Breathe: fade in, hold, fade out over the life cycle.
        const env = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, lt))), 1.2);
        el.style.opacity = (env * s.peak).toFixed(3);
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
        maskImage: "linear-gradient(to bottom, transparent 0%, black 55%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 55%)",
      }}
    >
      {SPRITES.map((s, i) => (
        <img
          key={i}
          ref={(el) => { elsRef.current[i] = el; }}
          src={TEX[s.tex % TEX.length]}
          alt=""
          draggable={false}
          className="absolute select-none"
          style={{
            left: 0,
            bottom: 0,
            width: `${s.size}%`,
            height: "auto",
            opacity: 0,
            transform: s.flip ? "scaleX(-1)" : undefined,
            willChange: "transform, opacity",
          }}
        />
      ))}
    </div>
  );
}
