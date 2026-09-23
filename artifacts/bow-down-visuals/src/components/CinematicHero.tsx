import { useEffect, useRef } from "react";

/* ─────────────────── Bowing shark hero ─────────────────── */
/* Canvas sprite scrubber. The shark-king clip was keyed out with an AI
   segmenter (clean studio background removal — no fringe, no halo; crown,
   face, jacket, fingers fully intact) and baked into 3 transparent WebP
   sprite sheets (102 frames, 600px, covering the 0 → ~4.2s bow). He floats
   on the page background in his own fixed square slot (never overlapping
   the headline); the bow scrubs with the mouse — mouse up = standing tall,
   mouse down = deep bow.
   Why sprites instead of <video>: frame-accurate scrubbing with zero
   seek/keyframe weirdness, guaranteed transparency in every browser, and
   GPU-accelerated drawImage — the smoothest possible pointer tracking.
   Input is read at window level so tracking works no matter what is under
   the cursor; the scrub loop always runs because this motion is 100%
   user-driven (direct manipulation), never autonomous animation. Under
   prefers-reduced-motion the follow snaps 1:1 instead of easing, and the
   pointer-leave reset is instant. */

const FRAMES = 102; // frames 0..101 → 0 … ~4.21s of the bow
const BOW_END = 4.2; // seconds of pointer travel mapped across the bow
const SHEETS = 3; // hero-bow-sheet-{0,1,2}.webp
const COLS = 6;
const PER_SHEET = 36; // 6×6 grid
const FS = 600; // frame size in px

export function HeroLogo3D() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const slot = sectionRef.current;
    if (!canvas || !slot || typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const base = import.meta.env.BASE_URL;
    const sheets: (HTMLImageElement | null)[] = new Array(SHEETS).fill(null);
    let sheetsReady = 0;

    let target = 0; // desired time (s): 0 = standing … BOW_END = full bow
    let current = 0; // rendered time
    let drawnFrame = -1;
    let raf = 0;
    let cancelled = false;

    const drawFrame = (f: number) => {
      if (f === drawnFrame) return;
      const sheet = sheets[Math.floor(f / PER_SHEET)];
      if (!sheet) return; // sheet not loaded yet — poster shows underneath
      const k = f % PER_SHEET;
      const sx = (k % COLS) * FS;
      const sy = Math.floor(k / COLS) * FS;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(sheet, sx, sy, FS, FS, 0, 0, canvas.width, canvas.height);
      drawnFrame = f;
    };

    const frameFor = (t: number) =>
      Math.min(FRAMES - 1, Math.max(0, Math.round((t / BOW_END) * (FRAMES - 1))));

    // Preload sprite sheets; draw the standing frame the moment sheet 0 lands.
    for (let s = 0; s < SHEETS; s++) {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        sheets[s] = img;
        sheetsReady++;
        if (sheetsReady === 1) drawFrame(frameFor(current));
      };
      img.onerror = () => console.error(`[hero] sprite sheet ${s} failed to load`);
      img.src = `${base}hero-bow-sheet-${s}.webp`;
      // Assign synchronously so a cached sheet is usable immediately.
      if (img.complete && img.naturalWidth > 0) {
        sheets[s] = img;
        sheetsReady++;
      }
    }
    // If sheet 0 was already cached, draw immediately.
    if (sheets[0]) drawFrame(0);

    // Scrub across the whole hero section — not just the shark's own box —
    // so the bow progresses gradually as the cursor travels down the page:
    // top of hero = standing tall, bottom = deep bow. Read at window level
    // so no overlay or stacking quirk can swallow the input.
    const heroSection = slot.closest("section") ?? slot;
    const setTargetFromClientY = (clientY: number) => {
      const r = heroSection.getBoundingClientRect();
      const p = (clientY - r.top) / Math.max(1, r.height);
      target = Math.min(BOW_END, Math.max(0, p * BOW_END));
    };
    const onPointerMove = (e: PointerEvent) => {
      const r = heroSection.getBoundingClientRect();
      // Ignore movement far outside the hero (e.g. hero scrolled away).
      if (e.clientY < r.top - 80 || e.clientY > r.bottom + 80) return;
      setTargetFromClientY(e.clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) setTargetFromClientY(t.clientY);
    };
    // Back to standing when the pointer leaves the hero.
    const onLeave = () => {
      target = 0;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    heroSection.addEventListener("pointerleave", onLeave, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave, {
      passive: true,
    });
    heroSection.addEventListener("touchmove", onTouchMove, { passive: true });

    const loop = () => {
      if (cancelled) return;
      if (reduce) {
        // Reduced motion: direct 1:1 follow, no easing animation.
        current = target;
      } else {
        // Snappy easing: tracks the cursor 1:1 without stepping.
        current += (target - current) * 0.35;
        if (Math.abs(target - current) < 0.015) current = target;
      }
      drawFrame(frameFor(current));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // Hidden diagnostics hook (not user-visible): lets QA drive and read
    // the scrubber — e.g. __bdvHero.seek(2), __bdvHero.frame().
    const w = window as unknown as Record<string, unknown>;
    const prevHook = w.__bdvHero;
    w.__bdvHero = {
      target: () => target,
      current: () => current,
      frame: () => frameFor(current),
      sheetsReady: () => sheetsReady,
      seek: (t: number) => {
        target = Math.min(BOW_END, Math.max(0, t));
      },
    };

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      heroSection.removeEventListener("pointerleave", onLeave);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      heroSection.removeEventListener("touchmove", onTouchMove);
      if (w.__bdvHero && typeof prevHook === "undefined") delete w.__bdvHero;
      else w.__bdvHero = prevHook;
    };
  }, []);

  const base = import.meta.env.BASE_URL;

  return (
    <div ref={sectionRef} className="relative w-[480px] max-w-full aspect-square">
      {/* Standing-shark poster: instant paint + fallback if sprites fail. */}
      <img
        src={`${base}hero-bow-poster.webp`}
        alt=""
        aria-hidden
        fetchPriority="high"
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
      {/* Shark-king bow scrubber — transparent sprite frames on canvas.
          Cursor up = standing tall, cursor down = deep bow; returns to
          standing on pointer leave. */}
      <canvas
        ref={canvasRef}
        width={FS}
        height={FS}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Bow Down Visuals shark king bowing"
      />
    </div>
  );
}
