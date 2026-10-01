import { useEffect, useRef } from "react";

/* ─────────── Fog — procedural settled sheet ─────────── */
/* Ground fog as ONE continuous procedural sheet — no sprites, no blobs, no
   texture borders (there are no textures to border). A living surface line
   undulates in large, slow swells; beneath it a warm-white body melts into
   the stage floor; a scrolling fbm noise strip carves wispy light and shadow
   into the body; a lit crest along the surface and a few soft tendrils
   finish the smoke read. The mouse drags the whole bank sideways — move
   right and it streams right, move left and it flows left — parting around
   a fast pointer, then springing flat again (re-settle). Vertical motion is
   starved by design: near the pointer the surface only ever dips DOWN,
   never rises. A hard ceiling (canvas clip + clamped surface + capped
   tendrils) guarantees the fog can never climb past ceilingFrac — it stays
   at his feet and can never reach his hips. Everything is painted
   warm-white and screen-blended, so it glows over the dark stage instead of
   graying out; true black can never appear. */

const LAYER_FRAC = 0.16; // resting sheet thickness, fraction of container height
const COL_STEP = 4; // px between surface samples (CSS px)
const WISPS = 8; // tendril count

export function FogSettled({
  className = "",
  layerFrac = LAYER_FRAC,
  brightness = 1,
  ceilingFrac = 0.7,
}: {
  className?: string;
  /** Fraction of the container height the resting sheet occupies. */
  layerFrac?: number;
  /** Multiplier on fog alpha — <1 dims the bank a touch. */
  brightness?: number;
  /** Hard ceiling: fraction of the container height (from the bottom) above
      which NOTHING renders. The fog can never rise past it, ever. */
  ceilingFrac?: number;
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

    /* ---- tileable fbm noise strip: wispy light/shadow carved into the body.
       Tileable in x so it scrolls seamlessly; stretched vertically so the
       grain runs in horizontal strata, like real settled fog. ---- */
    const strip = (() => {
      const NW = 1024;
      const NH = 160;
      const cv = document.createElement("canvas");
      cv.width = NW;
      cv.height = NH;
      const cx = cv.getContext("2d");
      if (!cx) return cv;
      const img = cx.createImageData(NW, NH);
      const d = img.data;
      const octaves = [
        { ox: 5, oy: 3, amp: 0.45 },
        { ox: 10, oy: 6, amp: 0.27 },
        { ox: 21, oy: 12, amp: 0.17 },
        { ox: 43, oy: 24, amp: 0.11 },
      ];
      const grids = octaves.map((o) => {
        const w = o.ox + 1;
        const h = o.oy + 1;
        const g = new Float32Array(w * h);
        for (let i = 0; i < g.length; i++) g[i] = Math.random();
        // wrap column ox onto column 0 so the strip tiles seamlessly in x
        for (let r = 0; r < h; r++) g[r * w + o.ox] = g[r * w];
        return { ...o, w, g };
      });
      const sm = (t: number) => t * t * (3 - 2 * t);
      for (let y = 0; y < NH; y++) {
        const v = y / NH;
        for (let x = 0; x < NW; x++) {
          const u = x / NW;
          let n = 0;
          for (const o of grids) {
            const gx = u * o.ox;
            const gy = v * o.oy;
            const x0 = Math.floor(gx) % o.ox;
            const fx = gx - Math.floor(gx);
            const y0 = Math.min(o.oy - 1, Math.floor(gy));
            const fy = gy - Math.floor(gy);
            const x1 = x0 + 1;
            const y1 = y0 + 1;
            const w = o.w;
            const v00 = o.g[y0 * w + x0];
            const v10 = o.g[y0 * w + x1];
            const v01 = o.g[y1 * w + x0];
            const v11 = o.g[y1 * w + x1];
            const sx = sm(fx);
            const sy = sm(fy);
            n += o.amp * (v00 * (1 - sx) * (1 - sy) + v10 * sx * (1 - sy) + v01 * (1 - sx) * sy + v11 * sx * sy);
          }
          const vv = Math.max(0, Math.min(255, Math.round(n * 255)));
          const idx = (y * NW + x) * 4;
          d[idx] = vv;
          d[idx + 1] = vv;
          d[idx + 2] = vv;
          d[idx + 3] = 255;
        }
      }
      cx.putImageData(img, 0, 0);
      return cv;
    })();

    /* ---- soft tendril sprite (stretched vertically at draw time) ---- */
    const wisp = (() => {
      const s = 64;
      const cv = document.createElement("canvas");
      cv.width = s;
      cv.height = s;
      const cx = cv.getContext("2d");
      if (!cx) return cv;
      const g = cx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,252,246,0.9)");
      g.addColorStop(0.45, "rgba(255,252,246,0.35)");
      g.addColorStop(1, "rgba(255,252,246,0)");
      cx.fillStyle = g;
      cx.fillRect(0, 0, s, s);
      return cv;
    })();

    /* ---- offscreen layer: body + texture + crest + tendrils composite here
       with normal blending, then screen-blitted onto the page in one go ---- */
    const layer = document.createElement("canvas");
    const lctx = layer.getContext("2d");
    if (!lctx) return;

    let W = 0;
    let H = 0;
    let dpr = 1;
    const resize = () => {
      const r = box.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      layer.width = canvas.width;
      layer.height = canvas.height;
    };
    resize();
    window.addEventListener("resize", resize);

    /* ---- pointer: position + smoothed velocity ---- */
    let px = -9999;
    let py = -9999;
    let ppx = -9999;
    let ppy = -9999;
    let pvx = 0;
    let pvy = 0;
    let hasP = false;
    const onMove = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      px = e.clientX - r.left;
      py = e.clientY - r.top;
      if (!hasP) {
        ppx = px;
        ppy = py;
        hasP = true;
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    /* ---- persistent state ---- */
    let flowX = 0; // the bank's lateral drift (breeze + pointer) — never springs back
    let dragX = 0; // transient yank from a fast pointer — springs back to 0 (re-settle)
    const surf = new Float32Array(2048); // surface heights per column
    const wake = new Float32Array(2048); // pointer parting displacement per column
    const P1 = 1.3;
    const P2 = 2.9;
    const P3 = 4.7;

    let raf = 0;
    let cancelled = false;
    let last = performance.now();
    let t = 0;

    const frame = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!reduce) t += dt;

      const layerH = H * layerFrac;
      const ceilY = H * (1 - ceilingFrac); // hard ceiling, px from top
      const baseY = H - layerH; // resting surface line
      const lumpAmp = layerH * 0.35; // large-swell amplitude
      const surfTop = baseY - lumpAmp; // highest the surface normally reaches

      /* smoothed pointer velocity */
      if (hasP && !reduce) {
        const ivx = (px - ppx) / Math.max(dt, 1e-3);
        const ivy = (py - ppy) / Math.max(dt, 1e-3);
        ppx = px;
        ppy = py;
        pvx += (ivx - pvx) * 0.22;
        pvy += (ivy - pvy) * 0.22;
        const sp = Math.hypot(pvx, pvy);
        if (sp > 6000) {
          const k = 6000 / sp;
          pvx *= k;
          pvy *= k;
        }
      } else {
        pvx = 0;
        pvy = 0;
      }

      /* lateral flow: slow breeze + the pointer's direction. Move right and
         the whole bank streams right; move left and it flows left. */
      const breeze = reduce ? 0 : Math.sin(t * 0.07) * 14 + 8;
      if (!reduce) flowX += (breeze + pvx * 0.3) * dt;

      /* transient drag — a fast whip yanks the bank sideways, then it eases
         back flat. This is the re-settle. */
      const dragTarget = reduce ? 0 : Math.max(-140, Math.min(140, pvx * 0.1));
      dragX += (dragTarget - dragX) * Math.min(1, 5 * dt);

      const shift = flowX + dragX; // total lateral offset of the fog pattern
      const n = Math.min(2047, Math.ceil(W / COL_STEP) + 1);
      const R = Math.min(W, H) * 0.4; // pointer influence radius
      const speedN = Math.min(1, Math.hypot(pvx, pvy) / 1000);
      const partDepth = layerH * 0.55;

      /* surface line: large slow swells + pointer parting (down only),
         clamped so it can never cross the ceiling. */
      for (let i = 0; i < n; i++) {
        const x = i * COL_STEP;
        const u = x - shift;
        const lump =
          Math.sin(u * 0.004 + t * 0.22 + P1) * 0.5 +
          Math.sin(u * 0.0093 + t * 0.16 + P2) * 0.3 +
          Math.sin(u * 0.021 + t * 0.31 + P3) * 0.2;
        let wTarget = 0;
        if (hasP && !reduce && speedN > 0.02) {
          const dx = (x - px) / R;
          wTarget = partDepth * speedN * Math.exp(-dx * dx);
        }
        wake[i] += (wTarget - wake[i]) * Math.min(1, 6 * dt);
        let y = baseY - lump * lumpAmp - wake[i];
        if (y < ceilY) y = ceilY;
        else if (y > H + 40) y = H + 40;
        surf[i] = y;
      }
      const surfAt = (x: number) => {
        const f = Math.max(0, Math.min(n - 1.001, x / COL_STEP));
        const i0 = Math.floor(f);
        const fr = f - i0;
        return surf[i0] * (1 - fr) + surf[i0 + 1] * fr;
      };

      /* ---- paint the fog layer offscreen ---- */
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lctx.clearRect(0, 0, W, H);
      const b = brightness;

      // body: one continuous fill from the living surface down to the floor
      const body = new Path2D();
      body.moveTo(0, surf[0]);
      for (let i = 1; i < n; i++) body.lineTo(i * COL_STEP, surf[i]);
      body.lineTo(W, H + 2);
      body.lineTo(0, H + 2);
      body.closePath();
      const g = lctx.createLinearGradient(0, surfTop, 0, H);
      g.addColorStop(0.0, "rgba(255,251,243,0)");
      g.addColorStop(0.14, `rgba(255,251,243,${0.5 * b})`);
      g.addColorStop(0.38, `rgba(255,250,240,${0.66 * b})`);
      g.addColorStop(0.72, `rgba(255,249,238,${0.58 * b})`);
      g.addColorStop(1.0, `rgba(250,243,230,${0.42 * b})`);
      lctx.fillStyle = g;
      lctx.fill(body);

      // wispy texture carved into the body — scrolls with the flow
      lctx.save();
      lctx.clip(body);
      lctx.globalCompositeOperation = "soft-light";
      lctx.globalAlpha = 0.62;
      const tileW = Math.max(720, W * 0.85);
      const wrapped = ((shift % tileW) + tileW) % tileW;
      for (let sx = wrapped - tileW; sx < W; sx += tileW) {
        lctx.drawImage(strip, sx, surfTop, tileW, H - surfTop);
      }
      lctx.restore();

      // lit crest hugging the surface — the top edge catches the stage light
      const crestH = layerH * 0.3;
      const crest = new Path2D();
      crest.moveTo(0, surf[0]);
      for (let i = 1; i < n; i++) crest.lineTo(i * COL_STEP, surf[i]);
      for (let i = n - 1; i >= 0; i--) crest.lineTo(i * COL_STEP, surf[i] + crestH);
      crest.closePath();
      const cg = lctx.createLinearGradient(0, surfTop, 0, surfTop + crestH);
      cg.addColorStop(0, `rgba(255,255,255,${0.32 * b})`);
      cg.addColorStop(1, "rgba(255,255,255,0)");
      lctx.fillStyle = cg;
      lctx.fill(crest);

      // tendrils breathing above the surface — capped at the ceiling
      for (let i = 0; i < WISPS; i++) {
        const fx = (i + 0.5) / WISPS;
        const wx = fx * W + Math.sin(t * 0.45 + i * 2.4) * 22 + dragX * 0.4;
        const syy = surfAt(Math.max(0, Math.min(W - 1, wx)));
        const wh = layerH * (0.3 + 0.2 * Math.sin(i * 3.7 + 1)) * (0.85 + 0.3 * Math.sin(t * 0.6 + i * 1.9));
        const top = Math.max(ceilY, syy - wh);
        const ww = 30 + 14 * Math.sin(i * 7.1 + 2);
        lctx.globalAlpha = Math.max(0.04, 0.11 + 0.05 * Math.sin(t * 0.8 + i * 2.2)) * b;
        lctx.drawImage(wisp, wx - ww / 2, top, ww, syy - top);
      }
      lctx.globalAlpha = 1;

      /* ---- blit to the page: hard ceiling clip + screen blend ---- */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, ceilY, W, H - ceilY + 2);
      ctx.clip();
      ctx.globalCompositeOperation = "screen";
      ctx.drawImage(layer, 0, 0, W, H);
      ctx.restore();

      if (!reduce) raf = requestAnimationFrame(frame);
    };

    if (reduce) {
      frame(performance.now());
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, [layerFrac, brightness, ceilingFrac]);

  return (
    <div ref={boxRef} aria-hidden className={`pointer-events-none absolute overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
