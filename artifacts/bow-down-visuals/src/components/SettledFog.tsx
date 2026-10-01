import { useEffect, useRef } from "react";

/* ─────────── Fog Lab C — settled layer ─────────── */
/* The look from the user's reference photo: a thin, bright, wispy smoke
   layer settled along the very bottom edge — not a tall bank. Particles
   are softly sprung to their resting height so the layer always
   re-settles, while the cursor tears through it: a strong push along the
   pointer's path, radial parting, a curling swirl, and a wake dragged
   along the pointer's travel segment so fast whips stay dramatic.
   Textures carry true alpha (black baked out, edges feathered) and are
   cache-busted (?v=2); screen blending re-brightens overlaps into a
   luminous bank with no black boxes and no visible image borders. */

const TEX_URLS = [
  "/images/fog/smoke-1.png?v=2",
  "/images/fog/smoke-2.png?v=2",
  "/images/fog/smoke-3.png?v=2",
];

const COUNT = 280;
const LAYER_FRAC = 0.16;  // the settled layer occupies the bottom 16%
const WIND = 16;          // px/s ambient sideways drift
const SPRING = 5.0;       // 1/s² — pull back to resting height (re-settle)
const DAMP = 0.92;        // per-frame velocity damping
const FLOW_R = 0.35;      // cursor influence radius, × min(W,H)
const PUSH = 5200;        // stream along the cursor path (strong)
const PART = 1600;        // radial shove — tears the layer open
const SWIRL = 3200;       // tangential curl around the pointer
const VMAX = 2800;        // particle speed cap — whips stay violent but bounded

interface P {
  x: number; y: number; homeY: number;
  vx: number; vy: number;
  size: number; angle: number; spin: number;
  life: number; maxLife: number;
  tex: number; peak: number; seed: number;
}

export function FogSettled({ className = "" }: { className?: string }) {
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
      const layerH = H * LAYER_FRAC;
      const tendril = Math.random() < 0.16; // a few wisps rise a little higher
      p.x = rnd(-30, W + 30);
      // Bias resting heights toward the very bottom so the layer reads solid.
      p.homeY = tendril ? H - layerH - rnd(0, H * 0.1) : H - Math.pow(Math.random(), 1.4) * layerH;
      p.y = initial ? rnd(H - layerH * 1.4, H + 20) : H + rnd(4, 30);
      p.vx = rnd(-6, 6);
      p.vy = 0;
      // Puffs sized to the band so their bright cores concentrate in the
      // layer instead of diluting across a huge area (reads as a solid bank).
      p.size = rnd(W * 0.035, W * 0.075);
      p.angle = rnd(0, Math.PI * 2);
      p.spin = rnd(-0.3, 0.3);
      p.maxLife = rnd(6, 12);
      p.life = initial ? rnd(0, p.maxLife) : 0;
      p.tex = (Math.random() * tex.length) | 0;
      p.peak = tendril ? rnd(0.16, 0.3) : rnd(0.34, 0.58);
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
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // Screen blending re-brightens overlaps into a luminous bank. Safe now:
      // the textures carry true alpha (black baked out, edges feathered) and
      // the URLs are cache-busted, so no stale black-background bytes linger.
      ctx.globalCompositeOperation = "screen";

      for (const p of parts) {
        if (!reduce) {
          // Ambient: slow sideways wind + tiny bob, spring pulls back to the layer.
          p.vx += (Math.sin(t * 0.4 + p.seed) * 6 + WIND * 0.4 - p.vx * 0.15) * dt;
          p.vy += (p.homeY - p.y) * SPRING * dt;
          p.vy += Math.cos(t * 0.7 + p.seed * 1.3) * 8 * dt;
          // Cursor: tear through the layer.
          if (hasPointer && mSpeed > 1) {
            const ox = p.x - mx;
            const oy = p.y - my;
            const dist = Math.hypot(ox, oy);
            const q = dist / R;
            if (q < 3) {
              const infl = Math.exp(-q * q);
              // 1. Stream hard along the pointer's path.
              p.vx += mvx * PUSH * infl * dt / 1000;
              p.vy += mvy * PUSH * infl * dt / 1000;
              const d = Math.max(1, dist);
              // 2. Radial part — rip the layer open around the pointer.
              p.vx += (ox / d) * PART * infl * speedN * dt;
              p.vy += (oy / d) * PART * infl * speedN * dt;
              // 3. Swirl — curl around the moving pointer like a vortex.
              const s = Math.sign(mvx * oy - mvy * ox) || 1;
              p.vx += (-oy / d) * s * SWIRL * infl * speedN * dt;
              p.vy += (ox / d) * s * SWIRL * infl * speedN * dt;
              // 4. Wake — drag smoke along the pointer's travel segment.
              //    A fast whip covers a long segment per frame, so this is
              //    what makes whips dramatic where velocity alone saturates.
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
                  // Yank toward the wake's travel velocity…
                  p.vx += (sdx * 2200 - p.vx) * k2;
                  p.vy += (sdy * 2200 - p.vy) * k2;
                  // …and shove outward off the path to rip the tear open.
                  const wdd = Math.max(1, wd);
                  p.vx += (wx / wdd) * 1500 * grab * dt;
                  p.vy += (wy / wdd) * 1500 * grab * dt;
                }
              }
            }
          }
          p.vx *= DAMP;
          p.vy *= DAMP;
          // Cap whip velocities — violent but bounded, no runaway.
          const pv = Math.hypot(p.vx, p.vy);
          if (pv > VMAX) { const k3 = VMAX / pv; p.vx *= k3; p.vy *= k3; }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.angle += p.spin * dt;
          p.life += dt;
          if (p.life >= p.maxLife) spawn(p, false);
          // Recycle anything flung far off-canvas — it fades back in through
          // the life cycle instead of popping to the far edge.
          if (p.x < -220 || p.x > W + 220 || p.y < -320 || p.y > H + 220) spawn(p, false);
        }
        const img = tex[p.tex];
        if (!img || !img.complete || img.naturalWidth === 0) continue;
        const lt = Math.min(1, p.life / p.maxLife);
        const env = Math.pow(Math.sin(Math.PI * lt), 1.4);
        const alpha = env * p.peak;
        if (alpha <= 0.004) continue;
        const s = p.size * (0.7 + 0.8 * lt);
        // Stretch along fast motion so whipped smoke streaks.
        const sp = Math.hypot(p.vx, p.vy);
        let rot = p.angle;
        let sx = 1, sy = 1;
        if (!reduce && sp > 120) {
          const st = Math.min(0.5, sp * 0.0009);
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
  }, []);

  return (
    <div ref={boxRef} aria-hidden className={`pointer-events-none absolute overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
