import { useEffect, useRef } from "react";

/* ─────────── Fog Lab C — settled sheet ─────────── */
/* Ground fog as one continuous sheet hovering along the stage floor — not
   a bunch of little clouds. Big, wide, flat, heavily overlapping fog
   masses merge into an unbroken horizontal band. The mouse stirs it
   sideways: move right and the sheet streams right, move left and it
   flows left — like dragging your hand through real stage fog. Vertical
   motion is deliberately starved: nothing billows or shoots upward, the
   sheet just breathes where it lies and re-settles after every pass.
   Textures carry true alpha (black baked out, edges feathered) and are
   cache-busted (?v=2); screen blending keeps overlaps luminous with no
   black boxes and no visible image borders. */

const TEX_URLS = [
  "/images/fog/smoke-1.png?v=2",
  "/images/fog/smoke-2.png?v=2",
  "/images/fog/smoke-3.png?v=2",
];

const COUNT = 90;         // few, huge masses — not many little puffs
const LAYER_FRAC = 0.16;  // the settled sheet occupies the bottom 16%
const WIND = 22;          // px/s ambient breeze (slowly shifts direction)
const SPRING = 9.0;       // 1/s² — vertical pull back to resting height
const DAMP_X = 0.94;      // horizontal velocity damping (per frame)
const DAMP_Y = 0.84;      // vertical damping — much harsher, kills rise
const FLOW_R = 0.4;       // cursor influence radius, × min(W,H)
const PUSH_X = 6400;      // horizontal stream along the pointer's travel
const PUSH_Y = 800;       // vertical stream — deliberately weak
const PART_X = 900;       // gentle sideways parting around the pointer
const SWIRL = 800;        // faint curl — flow, not vortex
const VMAX = 2600;        // particle speed cap — strong but bounded

interface P {
  x: number; y: number; homeY: number;
  vx: number; vy: number;
  size: number; wide: number; flat: number;
  angle: number; spin: number;
  life: number; maxLife: number;
  tex: number; peak: number; seed: number;
}

export function FogSettled({
  className = "",
  layerFrac = LAYER_FRAC,
  brightness = 1,
}: {
  className?: string;
  /** Fraction of the container the settled sheet occupies (resting heights). */
  layerFrac?: number;
  /** Multiplier on puff opacity — <1 dims the bank a touch. */
  brightness?: number;
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
    const spawn = (p: P, initial: boolean) => {
      const layerH = H * layerFrac;
      p.x = rnd(-60, W + 60);
      // Resting heights live inside the band, biased toward the floor so the
      // sheet reads densest at the bottom. Nothing parks above the sheet.
      p.homeY = H - Math.pow(Math.random(), 1.25) * layerH;
      p.y = initial ? rnd(H - layerH * 1.5, H + 24) : H + rnd(4, 30);
      p.vx = rnd(-6, 6);
      p.vy = 0;
      // Big soft masses — each one spans a large fraction of the stage so
      // they merge into a sheet instead of reading as discrete clouds.
      p.size = rnd(W * 0.16, W * 0.3);
      // Wide and flat: strata, not puffs.
      p.wide = rnd(1.7, 2.3);
      p.flat = rnd(0.45, 0.6);
      p.angle = rnd(0, Math.PI * 2);
      p.spin = rnd(-0.12, 0.12);
      p.maxLife = rnd(7, 13);
      p.life = initial ? rnd(0, p.maxLife) : 0;
      p.tex = (Math.random() * tex.length) | 0;
      // Low individual alpha — the sheet's body comes from heavy overlap.
      p.peak = rnd(0.1, 0.22) * brightness;
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

      let segX = 0, segY = 0, segLen = 0, segAx = 0, segAy = 0;
      if (hasPointer && !reduce) {
        const ivx = (mx - pmx) / Math.max(dt, 1e-3);
        const ivy = (my - pmy) / Math.max(dt, 1e-3);
        // This frame's pointer travel segment — the wake keys off it so fast
        // whips inject energy proportional to distance traveled.
        segAx = pmx; segAy = pmy;
        segX = mx - pmx; segY = my - pmy;
        segLen = Math.hypot(segX, segY);
        pmx = mx; pmy = my;
        mvx += (ivx - mvx) * 0.2;
        mvy += (ivy - mvy) * 0.2;
        const sp = Math.hypot(mvx, mvy);
        if (sp > 8000) { const k = 8000 / sp; mvx *= k; mvy *= k; }
      } else { mvx = 0; mvy = 0; }
      const mSpeed = Math.hypot(mvx, mvy);
      const speedN = Math.min(1, mSpeed / 1500);

      const R = Math.min(W, H) * FLOW_R;
      const layerH = H * layerFrac;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // Screen blending re-brightens overlaps into a luminous sheet. Safe:
      // the textures carry true alpha (black baked out, edges feathered) and
      // the URLs are cache-busted, so no stale black-background bytes linger.
      ctx.globalCompositeOperation = "screen";

      for (const p of parts) {
        if (!reduce) {
          // Ambient: a slow breeze that shifts direction over time, plus a
          // faint breathing bob. The spring pins everything to the sheet.
          const breeze = Math.sin(t * 0.12 + p.seed * 0.01) * WIND;
          p.vx += (breeze + Math.sin(t * 0.4 + p.seed) * 5 - p.vx * 0.12) * dt;
          p.vy += (p.homeY - p.y) * SPRING * dt;
          p.vy += Math.sin(t * 0.6 + p.seed * 1.7) * 4 * dt;
          // Cursor: stir the sheet sideways.
          if (hasPointer && mSpeed > 1) {
            const ox = p.x - mx;
            const oy = p.y - my;
            const dist = Math.hypot(ox, oy);
            const q = dist / R;
            if (q < 3) {
              const infl = Math.exp(-q * q);
              // 1. Stream with the pointer — overwhelmingly horizontal, so a
              //    sideways whip drags the sheet sideways with it.
              p.vx += mvx * PUSH_X * infl * dt / 1000;
              p.vy += mvy * PUSH_Y * infl * dt / 1000;
              const d = Math.max(1, dist);
              // 2. Gentle sideways parting around the pointer.
              p.vx += (ox / d) * PART_X * infl * speedN * dt;
              p.vy += (oy / d) * PART_X * 0.25 * infl * speedN * dt;
              // 3. Faint curl — a whisper of swirl, not a vortex.
              const s = Math.sign(mvx * oy - mvy * ox) || 1;
              p.vx += (-oy / d) * s * SWIRL * infl * speedN * dt;
              p.vy += (ox / d) * s * SWIRL * 0.3 * infl * speedN * dt;
              // 4. Wake — drag the sheet along the pointer's travel segment.
              //    Weighted horizontal so whips read as lateral flow.
              if (segLen > 4) {
                const sdx = segX / segLen, sdy = segY / segLen;
                const rx = p.x - segAx, ry = p.y - segAy;
                let tt = (rx * segX + ry * segY) / (segLen * segLen);
                tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
                const cx = segAx + segX * tt, cy = segAy + segY * tt;
                const wx = p.x - cx, wy = p.y - cy;
                const wd = Math.hypot(wx, wy);
                const wq = wd / R;
                if (wq < 1.6) {
                  const winfl = Math.exp(-wq * wq * 1.5);
                  const grab = Math.min(1, segLen / 200) * winfl;
                  const k2 = Math.min(1, grab * 0.6);
                  // Yank toward the wake's travel — hard sideways, soft vertical.
                  p.vx += (sdx * 2400 - p.vx) * k2;
                  p.vy += (sdy * 2400 - p.vy) * k2 * 0.3;
                  // …and ease it off the path sideways to open the flow line.
                  const wdd = Math.max(1, wd);
                  p.vx += (wx / wdd) * 1500 * grab * dt;
                  p.vy += (wy / wdd) * 1500 * 0.25 * grab * dt;
                }
              }
            }
          }
          p.vx *= DAMP_X;
          p.vy *= DAMP_Y;
          // Cap whip velocities — strong but bounded, no runaway.
          const pv = Math.hypot(p.vx, p.vy);
          if (pv > VMAX) { const k3 = VMAX / pv; p.vx *= k3; p.vy *= k3; }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.angle += p.spin * dt;
          p.life += dt;
          if (p.life >= p.maxLife) spawn(p, false);
          // Horizontal wrap — the sheet stays unbroken no matter how hard
          // the fog gets dragged sideways.
          const m = p.size;
          if (p.x < -m) p.x += W + m * 2;
          else if (p.x > W + m) p.x -= W + m * 2;
          // Vertical containment — nothing escapes above the sheet.
          const topLim = H - layerH * 1.7;
          if (p.y < topLim) { p.y = topLim; p.vy = Math.abs(p.vy) * 0.3; }
          if (p.y > H + 60) spawn(p, false);
        }
        const img = tex[p.tex];
        if (!img || !img.complete || img.naturalWidth === 0) continue;
        const lt = Math.min(1, p.life / p.maxLife);
        const env = Math.pow(Math.sin(Math.PI * lt), 1.4);
        const alpha = env * p.peak;
        if (alpha <= 0.004) continue;
        const s = p.size * (0.7 + 0.8 * lt);
        // Always wide and flat; fast sideways motion stretches it further.
        const st = Math.min(0.6, Math.abs(p.vx) * 0.0008);
        const sx = p.wide * (1 + st);
        const sy = p.flat * (1 - st * 0.2);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
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
  }, []);

  return (
    <div ref={boxRef} aria-hidden className={`pointer-events-none absolute overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
