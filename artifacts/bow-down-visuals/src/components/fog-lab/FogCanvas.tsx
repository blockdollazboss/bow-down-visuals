import { useEffect, useRef } from "react";

/* ─────────── Fog Lab B — canvas particle smoke ─────────── */
/* A true particle simulation: ~220 smoke-textured particles advected by
   a curling ambient flow field plus cursor injection. The mouse doesn't
   move a layer — it stirs individual particles, so the smoke genuinely
   streams, eddies and parts around the pointer like a fluid. Particles
   are drawn from the photographic smoke textures with screen blending,
   stretch along their own velocity when moving fast, and breathe
   through fade-in / grow / fade-out life cycles. */

const TEX_URLS = [
  "/images/fog/smoke-1.png?v=2",
  "/images/fog/smoke-2.png?v=2",
  "/images/fog/smoke-3.png?v=2",
];

const COUNT = 220;
const FLOW_RADIUS = 0.4;   // cursor influence, × min(W,H)
const PUSH_GAIN = 900;     // stream: px/s² per px/s of cursor speed
const PART_GAIN = 260;     // part: radial shove px/s² at zone center
const DRAG = 0.94;         // velocity damping per frame
const BUOYANCY = -14;      // px/s² upward drift

interface P {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  angle: number; spin: number;
  life: number; maxLife: number;
  tex: number; peak: number;
  seed: number;
}

export function FogCanvas({
  className = "",
  ceilingFrac = 1,
  buoyancy = BUOYANCY,
}: {
  className?: string;
  /** Fraction of the container height (from the bottom) that particles may
      occupy. A particle rising above it fades out and respawns at the
      bottom — a hard guarantee the fog never climbs past it. 1 = no cap. */
  ceilingFrac?: number;
  /** Upward drift in px/s² (negative). Smaller magnitude = fog stays lower. */
  buoyancy?: number;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const tex: HTMLImageElement[] = TEX_URLS.map((u) => {
      const img = new Image();
      img.src = u;
      return img;
    });

    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      const r = box.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    // Softer launches when buoyancy is tuned down: scale the initial upward
    // kick with it so a low-buoyancy fog doesn't start by jumping.
    const vScale = Math.min(1, Math.abs(buoyancy) / 14);
    const spawn = (p: P, initial: boolean) => {
      p.x = rnd(-40, W + 40);
      p.y = initial ? rnd(H * 0.15, H + 60) : H + rnd(20, 90);
      p.vx = rnd(-8, 8);
      p.vy = rnd(-26, -8) * (initial ? 1 : vScale);
      p.size = rnd(W * 0.1, W * 0.3);
      p.angle = rnd(0, Math.PI * 2);
      p.spin = rnd(-0.25, 0.25);
      p.maxLife = rnd(9, 18);
      p.life = initial ? rnd(0, p.maxLife) : 0;
      p.tex = (Math.random() * tex.length) | 0;
      p.peak = rnd(0.14, 0.3);
      p.seed = rnd(0, 1000);
    };
    const parts: P[] = Array.from({ length: COUNT }, () => {
      const p = {} as P;
      spawn(p, true);
      return p;
    });

    let mx = -9999, my = -9999, pmx = -9999, pmy = -9999, mvx = 0, mvy = 0;
    let hasPointer = false;
    const onMove = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      pmx = mx; pmy = my;
      mx = e.clientX - r.left;
      my = e.clientY - r.top;
      if (!hasPointer) { pmx = mx; pmy = my; hasPointer = true; }
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let raf = 0;
    let cancelled = false;
    let last = performance.now();
    let t = 0;

    const frame = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!reduce) t += dt;

      // Smoothed cursor velocity (px/s).
      if (hasPointer && !reduce) {
        const ivx = (mx - pmx) / Math.max(dt, 1e-3);
        const ivy = (my - pmy) / Math.max(dt, 1e-3);
        pmx = mx; pmy = my;
        mvx += (ivx - mvx) * 0.2;
        mvy += (ivy - mvy) * 0.2;
        if (Math.hypot(mvx, mvy) > 4000) { // clamp spikes
          const k = 4000 / Math.hypot(mvx, mvy);
          mvx *= k; mvy *= k;
        }
      } else { mvx = 0; mvy = 0; }

      const R = Math.min(W, H) * FLOW_RADIUS;
      // Hard ceiling: particles may never occupy the container above this
      // line (px from top). Anything crossing it fades out and respawns low.
      const ceilY = H * (1 - ceilingFrac);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // Textures carry true alpha (black baked out, edges feathered) and are
      // cache-busted (?v=2), so screen blending is safe: transparent areas
      // add nothing, overlaps re-brighten into a luminous bank.
      ctx.globalCompositeOperation = "screen";

      for (const p of parts) {
        if (!reduce) {
          // Ambient curl-ish drift.
          const ax = Math.sin(p.y * 0.006 + t * 0.5 + p.seed) * 22
                   + Math.sin(t * 0.23 + p.seed * 1.7) * 10;
          const ay = Math.cos(p.x * 0.005 - t * 0.4 + p.seed) * 14 + buoyancy;
          p.vx += ax * dt;
          p.vy += ay * dt;
          // Cursor injection: stream along the pointer's path + part around it.
          if (hasPointer) {
            const ox = p.x - mx;
            const oy = p.y - my;
            const dist = Math.hypot(ox, oy);
            const q = dist / R;
            if (q < 3) {
              const infl = Math.exp(-q * q);
              p.vx += mvx * PUSH_GAIN * infl * dt / 1000;
              p.vy += mvy * PUSH_GAIN * infl * dt / 1000;
              const d = Math.max(1, dist);
              p.vx += (ox / d) * PART_GAIN * infl * dt;
              p.vy += (oy / d) * PART_GAIN * infl * dt;
            }
          }
          p.vx *= DRAG;
          p.vy *= DRAG;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.angle += p.spin * dt;
          p.life += dt;
          // Recycle above the ceiling — the fog can never climb past it.
          if (p.life >= p.maxLife || p.y < ceilY || p.x < -p.size * 1.5 || p.x > W + p.size * 1.5) {
            spawn(p, false);
          }
        }
        const img = tex[p.tex];
        if (!img || !img.complete || img.naturalWidth === 0) continue;
        const lt = Math.min(1, p.life / p.maxLife);
        const env = Math.pow(Math.sin(Math.PI * lt), 1.4);
        // Dissolve as a particle nears the ceiling so the cap never pops.
        const ceilFade = Math.max(0, Math.min(1, (p.y - ceilY) / Math.max(1, H * 0.12)));
        const alpha = env * p.peak * ceilFade;
        if (alpha <= 0.004) continue;
        const s = p.size * (0.65 + 0.9 * lt);
        // Stretch along the particle's own motion when it's really moving.
        const sp = Math.hypot(p.vx, p.vy);
        let rot = p.angle;
        let sx = 1, sy = 1;
        if (!reduce && sp > 60) {
          const st = Math.min(0.45, sp * 0.0011);
          rot = Math.atan2(p.vy, p.vx);
          sx = 1 + st;
          sy = 1 - st * 0.35;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rot);
        ctx.scale(sx, sy);
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, -s / 2, -s / 2, s, s);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, [ceilingFrac, buoyancy]);

  return (
    <div ref={boxRef} aria-hidden className={`pointer-events-none absolute overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
