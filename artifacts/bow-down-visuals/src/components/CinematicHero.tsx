import { useEffect, useRef } from "react";
import { AnimatedLogo } from "@/components/AnimatedLogo";

/* ─────────────────── Shared pointer rig (module singleton) ─────────────────── */

interface Shock {
  x: number;
  y: number;
  t0: number;
  burst?: boolean;
}

interface Rig {
  tx: number;
  ty: number;
  x: number;
  y: number;
  px: number;
  py: number;
  /* Idle tracking — based on actual pointer POSITION, not event timestamps,
     so stray/no-op pointermove events can't stall the idle timer. */
  stableX: number;
  stableY: number;
  stableAt: number;
  logoCX: number;
  logoCY: number;
  shocks: Shock[];
  attached: boolean;
}

const rig: Rig = {
  tx: 0.5,
  ty: 0.42,
  x: 0.5,
  y: 0.42,
  px: -9999,
  py: -9999,
  stableX: -9999,
  stableY: -9999,
  stableAt: 0,
  logoCX: -9999,
  logoCY: -9999,
  shocks: [],
  attached: false,
};

/*
 * True when the pointer has genuinely stayed put (>4s without moving
 * more than a few px of noise). Immune to duplicate pointermove events
 * that carry the same coordinates.
 */
function rigIdle(now: number): boolean {
  if (Math.abs(rig.px - rig.stableX) > 3 || Math.abs(rig.py - rig.stableY) > 3) {
    rig.stableX = rig.px;
    rig.stableY = rig.py;
    rig.stableAt = now;
  }
  return now - rig.stableAt > 4000;
}

function attachRig() {
  if (rig.attached || typeof window === "undefined") return;
  rig.attached = true;
  rig.px = window.innerWidth / 2;
  rig.py = window.innerHeight * 0.3;
  rig.stableX = rig.px;
  rig.stableY = rig.py;
  rig.stableAt = performance.now();
  window.addEventListener(
    "pointermove",
    (e) => {
      rig.tx = Math.min(1, Math.max(0, e.clientX / window.innerWidth));
      rig.ty = Math.min(1, Math.max(0, e.clientY / window.innerHeight));
      rig.px = e.clientX;
      rig.py = e.clientY;
    },
    { passive: true }
  );
  window.addEventListener(
    "pointerdown",
    (e) => {
      rig.shocks.push({ x: e.clientX, y: e.clientY, t0: performance.now() });
      if (rig.shocks.length > 6) rig.shocks.shift();
      // A click counts as activity even if the cursor didn't move.
      rig.stableAt = performance.now();
    },
    { passive: true }
  );
}

/* ─────────────────── Sprites & particles ─────────────────── */

function makeGlowSprite(color: string): HTMLCanvasElement {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const g = c.getContext("2d");
  if (!g) return c;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(255,244,214,1)");
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return c;
}

interface Ember {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  ph: number;
  sp: number;
  spr: number;
  a: number;
}

interface Burst {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  r: number;
  spr: number;
}

interface Mote {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  a: number;
  depth: number;
}

interface Ray {
  fx: number;
  wdt: number;
  a: number;
  ph: number;
}

/* ─────────────────── Backdrop canvas ─────────────────── */

export function HeroBackdropCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    attachRig();
    const canvas = ref.current;
    if (!canvas || typeof window === "undefined") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const section = canvas.parentElement;
    if (!section) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let raf = 0;
    let last = performance.now();
    let frame = 0;

    const sprites = [
      makeGlowSprite("rgba(255,196,90,1)"),
      makeGlowSprite("rgba(255,140,50,1)"),
      makeGlowSprite("rgba(150,200,255,1)"),
    ];
    const bokehSprite = makeGlowSprite("rgba(255,210,130,1)");

    let embers: Ember[] = [];
    let motes: Mote[] = [];
    let bursts: Burst[] = [];
    let rays: Ray[] = [];
    let vignette: HTMLCanvasElement | null = null;
    const grains: HTMLCanvasElement[] = [];
    let grainIdx = 0;
    let nextSweep = 4;
    let sweepT0 = -1;

    const resetEmber = (e: Ember, initial: boolean) => {
      e.x = Math.random() * w;
      e.y = initial ? Math.random() * h : h + 20 + Math.random() * 40;
      e.r = 1 + Math.random() * 2.4;
      e.vy = 12 + Math.random() * 30;
      e.sway = 8 + Math.random() * 20;
      e.ph = Math.random() * Math.PI * 2;
      e.sp = 0.4 + Math.random() * 1.2;
      const roll = Math.random();
      e.spr = roll < 0.72 ? 0 : roll < 0.94 ? 1 : 2;
      e.a = 0.35 + Math.random() * 0.5;
    };

    const buildScene = () => {
      const emberCount = w < 640 ? 55 : 120;
      embers = Array.from({ length: emberCount }, () => {
        const e: Ember = { x: 0, y: 0, r: 1, vy: 1, sway: 1, ph: 0, sp: 1, spr: 0, a: 1 };
        resetEmber(e, true);
        return e;
      });
      motes = Array.from({ length: 8 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 40 + Math.random() * 55,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 6,
        a: 0.04 + Math.random() * 0.04,
        depth: 0.4 + Math.random() * 0.6,
      }));
      bursts = [];
      const defs: Array<[number, number, number]> = [
        [0.08, 70, 0.07],
        [0.24, 120, 0.05],
        [0.42, 90, 0.08],
        [0.6, 130, 0.05],
        [0.78, 80, 0.07],
        [0.93, 110, 0.05],
      ];
      rays = defs.map(([fx, wdt, a], i) => ({ fx, wdt, a, ph: i * 1.7 }));

      // Vignette (half-res offscreen)
      vignette = document.createElement("canvas");
      vignette.width = Math.max(2, Math.round(w / 2));
      vignette.height = Math.max(2, Math.round(h / 2));
      const vg = vignette.getContext("2d");
      if (vg) {
        const grd = vg.createRadialGradient(
          vignette.width / 2,
          vignette.height / 2,
          Math.min(vignette.width, vignette.height) * 0.36,
          vignette.width / 2,
          vignette.height / 2,
          Math.max(vignette.width, vignette.height) * 0.74
        );
        grd.addColorStop(0, "rgba(0,0,0,0)");
        grd.addColorStop(1, "rgba(0,0,0,0.62)");
        vg.fillStyle = grd;
        vg.fillRect(0, 0, vignette.width, vignette.height);
      }

      // Animated grain tiles (low-res noise)
      grains.length = 0;
      for (let i = 0; i < 4; i++) {
        const gc = document.createElement("canvas");
        gc.width = 320;
        gc.height = 180;
        const gg = gc.getContext("2d");
        if (gg) {
          const id = gg.createImageData(320, 180);
          for (let p = 0; p < id.data.length; p += 4) {
            const v = (Math.random() * 255) | 0;
            id.data[p] = v;
            id.data[p + 1] = v;
            id.data[p + 2] = v;
            id.data[p + 3] = 255;
          }
          gg.putImageData(id, 0, 0);
        }
        grains.push(gc);
      }
    };

    const resize = () => {
      const rect = section.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildScene();
    };

    const paint = (t: number, now: number, dt: number) => {
      const rect = section.getBoundingClientRect();
      ctx.clearRect(0, 0, w, h);

      const mCX = rig.x * w;
      const mCY = rig.y * window.innerHeight - rect.top;
      const lx = rig.logoCX - rect.left;
      const ly = rig.logoCY - rect.top;

      /* God rays */
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const ray of rays) {
        const sway = reduce ? 0 : Math.sin(t * 0.12 + ray.ph) * 40;
        const x = ray.fx * w + sway;
        const grd = ctx.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, `rgba(255,200,110,${ray.a})`);
        grd.addColorStop(1, "rgba(255,200,110,0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(x - ray.wdt / 2, -20);
        ctx.lineTo(x + ray.wdt / 2, -20);
        ctx.lineTo(x + ray.wdt / 2 + 90, h + 20);
        ctx.lineTo(x - ray.wdt / 2 + 90, h + 20);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      /* Floor glow beneath the logo */
      if (rig.logoCX > -1000) {
        const pulse = reduce ? 0.12 : 0.1 + 0.04 * Math.sin(t * 1.7);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.translate(lx, ly);
        ctx.scale(1, 0.45);
        ctx.translate(-lx, -ly);
        const fg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 300);
        fg.addColorStop(0, `rgba(255,180,80,${(pulse + 0.08).toFixed(3)})`);
        fg.addColorStop(1, "rgba(255,180,80,0)");
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(lx, ly, 300, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      /* Embers */
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const e of embers) {
        if (!reduce) {
          e.y -= e.vy * dt;
          e.ph += dt * e.sp;
          e.x += Math.sin(e.ph) * e.sway * dt;
          const dx = e.x - mCX;
          const dy = e.y - mCY;
          const d2 = dx * dx + dy * dy;
          if (d2 < 14400 && d2 > 1) {
            const d = Math.sqrt(d2);
            const f = (1 - d / 120) * 60 * dt;
            e.x += (dx / d) * f;
            e.y += (dy / d) * f;
          }
          if (e.y < -20) resetEmber(e, false);
        }
        const flick = reduce ? 0.8 : 0.55 + 0.45 * Math.sin(t * 2.5 + e.ph * 3);
        ctx.globalAlpha = Math.max(0, Math.min(1, e.a * flick));
        const s = e.r * 4;
        ctx.drawImage(sprites[e.spr], e.x - s / 2, e.y - s / 2, s, s);
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      /* Cinematic light sweep */
      if (!reduce && t > nextSweep && sweepT0 < 0) {
        sweepT0 = t;
        nextSweep = t + 6 + Math.random() * 5;
      }
      if (sweepT0 >= 0) {
        const p = (t - sweepT0) / 1.5;
        if (p >= 1) {
          sweepT0 = -1;
        } else {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.translate(w / 2, h / 2);
          ctx.rotate(-0.45);
          ctx.translate(-w / 2, -h / 2);
          const sx = w * (0.15 + p * 1.1) - w * 0.25;
          const edge = Math.max(0, 1 - Math.abs(p - 0.5) * 1.6);
          const grd = ctx.createLinearGradient(sx - 140, 0, sx + 140, 0);
          grd.addColorStop(0, "rgba(255,210,130,0)");
          grd.addColorStop(0.5, `rgba(255,210,130,${(0.32 * edge).toFixed(3)})`);
          grd.addColorStop(1, "rgba(255,210,130,0)");
          ctx.fillStyle = grd;
          ctx.fillRect(sx - 140, -h, 280, h * 2);
          ctx.restore();
        }
      }

      /* Shockwaves + spark bursts */
      for (let i = rig.shocks.length - 1; i >= 0; i--) {
        const s = rig.shocks[i];
        const p = (now - s.t0) / 900;
        if (p >= 1) {
          rig.shocks.splice(i, 1);
          continue;
        }
        const sx = s.x - rect.left;
        const sy = s.y - rect.top;
        if (!s.burst) {
          s.burst = true;
          for (let k = 0; k < 16; k++) {
            const ang = Math.random() * Math.PI * 2;
            const spd = 60 + Math.random() * 160;
            bursts.push({
              x: sx,
              y: sy,
              vx: Math.cos(ang) * spd,
              vy: Math.sin(ang) * spd - 40,
              life: 0.7 + Math.random() * 0.5,
              maxLife: 1.2,
              r: 1 + Math.random() * 2,
              spr: Math.random() < 0.8 ? 0 : 1,
            });
          }
        }
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = `rgba(255,200,120,${(0.55 * (1 - p)).toFixed(3)})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 20 + p * 220, 0, Math.PI * 2);
        ctx.stroke();
        const fg2 = ctx.createRadialGradient(sx, sy, 0, sx, sy, 160);
        fg2.addColorStop(0, `rgba(255,220,150,${(0.5 * (1 - p)).toFixed(3)})`);
        fg2.addColorStop(1, "rgba(255,220,150,0)");
        ctx.fillStyle = fg2;
        ctx.beginPath();
        ctx.arc(sx, sy, 160, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      /* Spark bursts */
      if (bursts.length) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = bursts.length - 1; i >= 0; i--) {
          const b = bursts[i];
          if (!reduce) {
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.vy -= 30 * dt;
            b.life -= dt;
          }
          if (b.life <= 0) {
            bursts.splice(i, 1);
            continue;
          }
          ctx.globalAlpha = Math.max(0, (b.life / b.maxLife) * 0.9);
          const s = b.r * 4;
          ctx.drawImage(sprites[b.spr], b.x - s / 2, b.y - s / 2, s, s);
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      /* Mouse light */
      if (rig.px > -1000) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const mg = ctx.createRadialGradient(mCX, mCY, 0, mCX, mCY, 340);
        mg.addColorStop(0, "rgba(255,190,90,0.14)");
        mg.addColorStop(1, "rgba(255,190,90,0)");
        ctx.fillStyle = mg;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      /* Foreground bokeh dust */
      ctx.save();
      for (const b of motes) {
        if (!reduce) {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          if (b.x < -b.r) b.x = w + b.r;
          if (b.x > w + b.r) b.x = -b.r;
          if (b.y < -b.r) b.y = h + b.r;
          if (b.y > h + b.r) b.y = -b.r;
        }
        const bx = b.x + (0.5 - rig.x) * b.depth * 60;
        const by = b.y + (0.5 - rig.y) * b.depth * 40;
        ctx.globalAlpha = b.a;
        ctx.drawImage(bokehSprite, bx - b.r, by - b.r, b.r * 2, b.r * 2);
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      /* Vignette */
      if (vignette) ctx.drawImage(vignette, 0, 0, w, h);

      /* Film grain */
      if (grains.length) {
        if (frame % 3 === 0) grainIdx = (grainIdx + 1) % grains.length;
        ctx.save();
        ctx.globalAlpha = 0.05;
        ctx.drawImage(grains[grainIdx], 0, 0, w, h);
        ctx.restore();
      }
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frame++;
      const t = now / 1000;
      if (!reduce) {
        const k = 0.065;
        rig.x += (rig.tx - rig.x) * k;
        rig.y += (rig.ty - rig.y) * k;
        if (rigIdle(now)) {
          rig.tx = 0.5 + Math.sin(t * 0.4) * 0.16;
          rig.ty = 0.4 + Math.cos(t * 0.31) * 0.1;
        }
      }
      paint(t, now, dt);
      if (!reduce) raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    if (reduce) {
      paint(0, performance.now(), 0);
    } else {
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
    />
  );
}

/* ─────────────────── Bowing shark logo ─────────────────── */
/* The shark-king physically bows with the mouse: cursor up = standing tall,
   cursor down = deep bow. Pivots at the waist (transform-origin near base)
   with spring physics so it has weight, plus a ground shadow that spreads
   as he bows. Idle = slow ceremonial bow so it stays alive like video. */

export function HeroLogo3D() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const shadowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    attachRig();
    let raf = 0;
    let bow = 0;
    let vel = 0;
    const loop = () => {
      const now = performance.now();
      const t = now / 1000;
      // Mouse height -> bow depth. Top of screen: standing tall. Bottom: deep bow.
      let target = Math.min(1, Math.max(0, (rig.y - 0.15) / 0.6));
      // Idle: slow ceremonial bow so it still feels alive like video.
      if (rigIdle(now)) {
        target = 0.5 - 0.5 * Math.cos(t * 0.45);
      }
      // Spring toward target — weighty and physical, slight overshoot.
      vel += (target - bow) * 0.075;
      vel *= 0.82;
      bow += vel;
      const b = Math.min(1.15, Math.max(-0.1, bow));
      const nx = rig.x - 0.5;

      const rotX = -5 + b * 46; // -5deg upright … ~41deg deep bow
      const rotY = nx * 12; // slight turn toward the cursor
      const dipY = b * 34; // body dips as it bows
      const scale = 1 + b * 0.05; // comes toward the viewer
      wrap.style.transform =
        `perspective(1100px) rotateX(${rotX.toFixed(2)}deg) ` +
        `rotateY(${rotY.toFixed(2)}deg) ` +
        `translate3d(${(nx * 18).toFixed(1)}px, ${dipY.toFixed(1)}px, 0) ` +
        `scale(${scale.toFixed(4)})`;

      const shadow = shadowRef.current;
      if (shadow) {
        const s = 1 + Math.max(0, b) * 0.4;
        shadow.style.transform = `translateX(-50%) scaleX(${s.toFixed(3)})`;
        shadow.style.opacity = (0.28 + Math.max(0, b) * 0.35).toFixed(3);
      }
      const glow = glowRef.current;
      if (glow) {
        glow.style.opacity = (0.8 + Math.max(0, b) * 0.2).toFixed(3);
      }
      const r = wrap.getBoundingClientRect();
      rig.logoCX = r.left + r.width / 2;
      rig.logoCY = r.top + r.height / 2;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative flex justify-center">
      <div
        ref={glowRef}
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full blur-[90px] will-change-transform"
        style={{
          left: "50%",
          top: "44%",
          width: 440,
          height: 440,
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(circle, rgba(255,186,66,0.30) 0%, rgba(212,160,23,0.12) 45%, transparent 70%)",
        }}
      />
      <div
        ref={wrapRef}
        className="relative will-change-transform"
        style={{ transformStyle: "preserve-3d", transformOrigin: "50% 84%" }}
      >
                {/* Shark-king hero video — bows in the footage and follows the             cursor via the 3D pointer rig above. */}         <video           ref={(v) => {             if (v) v.muted = true;           }}           className="w-[480px] max-w-full h-auto"           src={`${import.meta.env.BASE_URL}hero-shark.webm`}           poster={`${import.meta.env.BASE_URL}hero-shark-poster.jpg`}           autoPlay           muted           loop           playsInline           preload="auto"           disablePictureInPicture           aria-label="Bow Down Visuals shark king bowing"           draggable={false}         />
      </div>
      {/* Ground shadow — spreads and darkens as he bows */}
      <div
        ref={shadowRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 bottom-[4px] h-[30px] w-[60%] rounded-[100%] bg-black blur-[16px]"
        style={{ transform: "translateX(-50%)", opacity: 0.28 }}
      />
    </div>
  );
}
