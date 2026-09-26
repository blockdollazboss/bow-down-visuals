import { useEffect, useRef } from "react";

/* ─────────── Floating shark — mouse-tracked bow on subpages ─────────── */
/* The homepage hero shark (HeroLogo3D), shrunk into a fixed corner slot so
   it rides along on every subpage. Same transparent WebP sprite sheets
   (102 frames, 600px, 0 → ~4.2s bow), same pointer tracking: cursor at the
   top of the viewport = standing tall, cursor at the bottom = deep bow.
   Why the same sprite approach as the hero: frame-accurate scrubbing with
   zero seek/keyframe weirdness, guaranteed transparency in every browser,
   and GPU-accelerated drawImage — the smoothest possible pointer tracking.
   Input is read at window level so tracking works no matter what is under
   the cursor; pointer-events are disabled on the slot itself so it can never
   swallow a click. Under prefers-reduced-motion the follow snaps 1:1
   instead of easing, and the pointer-leave reset is instant. */

const FRAMES = 102; // frames 0..101 → 0 … ~4.21s of the bow
const BOW_END = 4.2; // seconds of pointer travel mapped across the bow
const SHEETS = 3; // hero-bow-sheet-{0,1,2}.webp
const COLS = 6;
const PER_SHEET = 36; // 6×6 grid
const FS = 600; // frame size in px

export function FloatingSharkScrubber() {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const posterRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const slot = slotRef.current;
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
    let moves = 0;

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
      canvas.dataset.bdvFrame = String(f);
      // The poster did its job (instant paint / load fallback). Hide it now
      // that the canvas is painting — otherwise the standing poster ghosts
      // behind every bowed frame.
      if (posterRef.current) posterRef.current.style.display = "none";
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
      img.onerror = () => console.error(`[floating-shark] sprite sheet ${s} failed to load`);
      img.src = `${base}hero-bow-sheet-${s}.webp`;
      if (img.complete && img.naturalWidth > 0) {
        sheets[s] = img;
        sheetsReady++;
      }
    }
    if (sheets[0]) drawFrame(0);

    // Scrub across the whole viewport: top = standing tall, bottom = deep
    // bow. Read at window level so no overlay or stacking quirk can swallow
    // the input.
    const setTargetFromClientY = (clientY: number) => {
      const p = clientY / Math.max(1, window.innerHeight);
      target = Math.min(BOW_END, Math.max(0, p * BOW_END));
      canvas.dataset.bdvTarget = target.toFixed(2);
    };
    const onPointerMove = (e: PointerEvent) => {
      moves++;
      canvas.dataset.bdvMoves = String(moves);
      setTargetFromClientY(e.clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) setTargetFromClientY(t.clientY);
    };
    // Back to standing when the pointer leaves the page.
    const onLeave = () => {
      target = 0;
      canvas.dataset.bdvTarget = "0";
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave, {
      passive: true,
    });

    const loop = () => {
      if (cancelled) return;
      if (reduce) {
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
    // the scrubber — e.g. __bdvFloatShark.seek(2), __bdvFloatShark.frame().
    const w = window as unknown as Record<string, unknown>;
    const prevHook = w.__bdvFloatShark;
    w.__bdvFloatShark = {
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
      window.removeEventListener("touchmove", onTouchMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (w.__bdvFloatShark && typeof prevHook === "undefined") delete w.__bdvFloatShark;
      else w.__bdvFloatShark = prevHook;
    };
  }, []);

  const base = import.meta.env.BASE_URL;

  return (
    <div
      ref={slotRef}
      aria-hidden
      className="pointer-events-none fixed bottom-24 right-3 z-[60] h-36 w-36 sm:bottom-28 sm:right-5 sm:h-52 sm:w-52"
    >
      {/* Standing-shark poster: instant paint + fallback if sprites fail.
          Hidden the moment the canvas paints so it never ghosts behind
          bowed frames. */}
      <img
        ref={posterRef}
        src={`${base}hero-bow-poster.webp`}
        alt=""
        aria-hidden
        loading="lazy"
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
