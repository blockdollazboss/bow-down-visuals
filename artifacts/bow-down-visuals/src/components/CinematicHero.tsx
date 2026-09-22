import { useEffect, useRef } from "react";

/* ─────────────────── Bowing shark logo ─────────────────── */
/* The shark-king frames have a REAL alpha channel: the background is
   genuinely transparent, so he floats over the hero with nothing behind
   him — no glow blob, no shadow, no blend-mode hacks. He stands in
   position in his own fixed square slot (never overlapping the headline);
   the bow scrubs with the mouse — mouse up = standing tall, mouse
   down = deep bow. */

const FRAME_COUNT = 45; // pre-rendered transparent scrub frames in public/hero-frames/
const FRAME_SIZE = 800; // px — square frames

export function HeroLogo3D() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const posterRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const section = sectionRef.current;
    if (!canvas || !section || typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const base = import.meta.env.BASE_URL;
    const frames: HTMLImageElement[] = [];
    let loaded = 0;
    let target = 0; // desired bow progress: 0 = standing … 1 = full bow
    let current = 0; // eased progress
    let drawn = -1; // last frame index painted
    let raf = 0;
    let cancelled = false;

    const draw = (idx: number) => {
      const img = frames[idx];
      if (!img || !img.complete || img.naturalWidth === 0) return;
      ctx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);
      ctx.drawImage(img, 0, 0, FRAME_SIZE, FRAME_SIZE);
      drawn = idx;
      // Once the real frame is up, drop the poster placeholder.
      if (posterRef.current) posterRef.current.style.display = "none";
    };

    // Preload the whole sequence up front so scrubbing never waits on the
    // network or on video-seek decoding — this is what makes it butter-smooth.
    for (let i = 0; i < FRAME_COUNT; i++) {
      const img = new Image();
      img.decoding = "async";
      img.src = `${base}hero-frames/f_${String(i + 1).padStart(3, "0")}.webp`;
      img.onload = () => {
        if (cancelled) return;
        loaded++;
        // Paint the standing frame the moment it's ready.
        if (loaded === 1) draw(0);
        else if (drawn >= 0) draw(drawn); // repaint in case it was a placeholder draw
      };
      frames.push(img);
    }

    // Scrub across the whole hero section — not just the shark's own box — so
    // the bow progresses gradually with plenty of in-between frames as the
    // cursor travels down the page: top of hero = standing tall, bottom =
    // deep bow. (Mapping to the shark's small box made the transition feel
    // binary: standing one moment, bowed the next, nothing in between.)
    const heroSection = section.closest("section") ?? section;
    const setTargetFromClientY = (clientY: number) => {
      const r = heroSection.getBoundingClientRect();
      const p = (clientY - r.top) / Math.max(1, r.height);
      target = Math.min(1, Math.max(0, p));
    };
    const onPointerMove = (e: PointerEvent) => setTargetFromClientY(e.clientY);
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    if (!reduce) {
      const loop = () => {
        // Critically-damped-ish easing: snappy enough to feel 1:1 with the
        // cursor, smooth enough to never step or stutter.
        current += (target - current) * 0.32;
        if (Math.abs(target - current) < 0.0015) current = target;
        const idx = Math.min(
          FRAME_COUNT - 1,
          Math.max(0, Math.round(current * (FRAME_COUNT - 1)))
        );
        if (idx !== drawn) draw(idx);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } else {
      // Reduced motion: hold the standing frame once loaded.
      const t = window.setInterval(() => {
        if (frames[0]?.complete && frames[0].naturalWidth > 0) {
          draw(0);
          window.clearInterval(t);
        }
      }, 100);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return (
    <div ref={sectionRef} className="relative w-[480px] max-w-full aspect-square">
      {/* Shark-king hero scrubber — 45 pre-rendered frames with a real alpha
          channel, drawn on canvas and eased toward the pointer. No video
          seeks (which stutter), no glow, no shadow, no blend hacks. The
          fixed square slot keeps him in position above the headline — he
          never covers it, even after the poster placeholder hides itself.
          Cursor up = standing tall, cursor down = deep bow. */}
      <img
        ref={posterRef}
        src={`${import.meta.env.BASE_URL}hero-shark-poster.png`}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-contain"
        draggable={false}
      />
      <canvas
        ref={canvasRef}
        width={FRAME_SIZE}
        height={FRAME_SIZE}
        className="absolute inset-0 h-full w-full"
        aria-label="Bow Down Visuals shark king bowing"
      />
    </div>
  );
}
