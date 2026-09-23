import { useEffect, useRef } from "react";

/* ─────────────────── Bowing shark hero ─────────────────── */
/* Native video scrubber. The shark-king clip keeps its own clean studio
   background — no cutout, no transparency tricks, no fringe, no glow, no
   shadow. He stands in position in his own fixed square slot (never
   overlapping the headline); the bow scrubs with the mouse — mouse up =
   standing tall, mouse down = deep bow. The bow-down lives in the first
   ~4.2s of the clip, so pointer Y maps to 0 → BOW_END seconds. Scrubbing
   the real 24fps video is smoother and far higher-quality than scrubbing
   still frames.
   The scrub loop always runs: this motion is 100% user-driven (the video
   only moves while the pointer moves — direct manipulation), never
   autonomous animation. Under prefers-reduced-motion the follow snaps
   1:1 instead of easing, and the pointer-leave reset is instant. */

const BOW_END = 4.2; // seconds — deepest point of the bow in hero-bow.mp4

export function HeroLogo3D() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    const slot = sectionRef.current;
    if (!video || !slot || typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let target = 0; // desired time (s): 0 = standing … BOW_END = full bow
    let current = 0; // rendered time
    let raf = 0;
    let cancelled = false;
    let ready = false;

    video.pause();

    const markReady = () => {
      if (ready) return;
      ready = true;
      // Preroll the standing frame so the slot is never blank.
      try {
        video.currentTime = 0.001;
      } catch {
        /* seek not ready yet — poster covers the slot */
      }
      current = 0;
    };
    if (video.readyState >= 1) markReady();
    video.addEventListener("loadedmetadata", markReady);
    video.addEventListener("canplay", markReady);

    // Scrub across the whole hero section — not just the shark's own box —
    // so the bow progresses gradually as the cursor travels down the page:
    // top of hero = standing tall, bottom = deep bow.
    const heroSection = slot.closest("section") ?? slot;
    const setTargetFromClientY = (clientY: number) => {
      const r = heroSection.getBoundingClientRect();
      const p = (clientY - r.top) / Math.max(1, r.height);
      target = Math.min(BOW_END, Math.max(0, p * BOW_END));
    };
    const onPointerMove = (e: PointerEvent) => setTargetFromClientY(e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) setTargetFromClientY(t.clientY);
    };
    // Back to standing when the pointer leaves the hero.
    const onLeave = () => {
      target = 0;
    };
    heroSection.addEventListener("pointermove", onPointerMove, { passive: true });
    heroSection.addEventListener("pointerleave", onLeave, { passive: true });
    heroSection.addEventListener("touchmove", onTouchMove, { passive: true });

    const loop = () => {
      if (cancelled) return;
      // Self-healing: if the metadata event was missed, pick it up here.
      if (!ready && video.readyState >= 1) markReady();
      if (reduce) {
        // Reduced motion: direct 1:1 follow, no easing animation.
        current = target;
      } else {
        // Snappy easing: tracks the cursor 1:1 without stepping.
        current += (target - current) * 0.35;
        if (Math.abs(target - current) < 0.015) current = target;
      }
      // Only seek when meaningfully behind — avoids redundant seeks.
      if (ready && Math.abs(video.currentTime - current) > 0.02) {
        try {
          video.currentTime = current;
        } catch {
          /* transient seek failure — next frame retries */
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      video.removeEventListener("loadedmetadata", markReady);
      video.removeEventListener("canplay", markReady);
      heroSection.removeEventListener("pointermove", onPointerMove);
      heroSection.removeEventListener("pointerleave", onLeave);
      heroSection.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  const base = import.meta.env.BASE_URL;

  return (
    <div ref={sectionRef} className="relative w-[480px] max-w-full aspect-square">
      {/* Shark-king bow scrubber — native video with its own background.
          No canvas, no frame images, no effects. Cursor up = standing tall,
          cursor down = deep bow; returns to standing on pointer leave. */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        src={`${base}hero-bow.mp4`}
        poster={`${base}hero-bow-poster.jpg`}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        aria-label="Bow Down Visuals shark king bowing"
      />
    </div>
  );
}
