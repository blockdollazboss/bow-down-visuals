import { useEffect, useRef } from "react";

/**
 * Slim vertical video banners — the luxury-ticker band turned on its side.
 * One gold/black loop video is split across two slim rails (left rail shows
 * the left half, right rail the right half), playing in sync as a seamless
 * loop.
 *
 * With `mouseScrub`, the rails become pointer-driven like the sign-in
 * screen's drone background: horizontal cursor position scrubs the video
 * clock (left edge = start of the loop, right edge = end). The left rail
 * is the leader; the right rail mirrors its clock every frame so both
 * sides always show the exact same loop frame — no drift, no jumps.
 * Touch devices (coarse pointer) fall back to the autoplay loop so the
 * rails never sit on a frozen frame.
 */
const VIDEO_SRC = `${import.meta.env.BASE_URL}videos/auth-side-banner.mp4`;

function Rail({ side, scrubbed }: { side: "left" | "right"; scrubbed: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Respect reduced-motion: keep a still frame instead of playing.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
      return;
    }
    // Scrubbed rails on fine-pointer devices are driven by the cursor —
    // no autoplay. (Coarse pointers fall back to the loop below.)
    if (scrubbed && window.matchMedia("(pointer: fine)").matches) {
      video.autoplay = false;
      video.pause();
      return;
    }
    const play = () => video.play().catch(() => {});
    if (video.readyState >= 2) play();
    else video.addEventListener("canplay", play, { once: true });
    return () => video.removeEventListener("canplay", play);
  }, [scrubbed]);

  return (
    <div
      aria-hidden="true"
      className={[
        "pointer-events-none fixed inset-y-0 z-0 hidden w-32 overflow-hidden md:block lg:w-48 xl:w-56",
        side === "left" ? "left-0" : "right-0",
      ].join(" ")}
    >
      <video
        ref={videoRef}
        src={VIDEO_SRC}
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        disablePictureInPicture
        data-rail={side}
        className="h-full w-[200%] max-w-none object-cover"
        style={{
          ...(side === "right" ? { transform: "translateX(-50%)" } : {}),
          filter: "brightness(0.75) saturate(0.85)",
        }}
      />
      {/* Soft top/bottom fade so the videos melt into the page edges. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60" />
      <div
        className={
          side === "left"
            ? "absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-black/50 to-transparent"
            : "absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-black/50 to-transparent"
        }
      />
    </div>
  );
}

export function SideVideoBanners({ mouseScrub = false }: { mouseScrub?: boolean }) {
  // 0 … 1 across the viewport width; null until the pointer first moves.
  const scrubRatio = useRef<number | null>(null);

  // Pointer scrub, mirroring the sign-in screen: horizontal cursor position
  // drives the video clock. Fine pointers only; touch falls back to autoplay.
  useEffect(() => {
    if (!mouseScrub || typeof window === "undefined") return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onPointerMove = (e: PointerEvent) => {
      scrubRatio.current = Math.min(Math.max(e.clientX / window.innerWidth, 0), 1);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [mouseScrub]);

  useEffect(() => {
    let raf = 0;
    const fine =
      mouseScrub &&
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: fine)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sync = () => {
      const left = document.querySelector<HTMLVideoElement>('video[data-rail="left"]');
      const right = document.querySelector<HTMLVideoElement>('video[data-rail="right"]');
      if (left && right) {
        // Scrub drive: the left rail is the leader. fastSeek() where
        // available (built for scrubbing), frame-throttled so seeks never
        // stutter — same pro-grade pattern as the sign-in screen.
        if (
          fine &&
          scrubRatio.current !== null &&
          left.duration &&
          isFinite(left.duration) &&
          left.readyState >= 2
        ) {
          const target = scrubRatio.current * left.duration;
          if (Math.abs(left.currentTime - target) > 0.02) {
            const v = left as HTMLVideoElement & { fastSeek?: (t: number) => void };
            if (typeof v.fastSeek === "function") v.fastSeek(target);
            else left.currentTime = target;
          }
        }
        // Mirror: the right rail always follows the leader's clock.
        // In autoplay mode only correct while both are playing (never fight
        // buffering); in scrub mode both are paused, so always mirror.
        const drift = Math.abs(left.currentTime - right.currentTime);
        if (drift > 0.04 && (fine || (!left.paused && !right.paused))) {
          try {
            right.currentTime = left.currentTime;
          } catch {
            /* seek while metadata loads — retry next frame */
          }
        }
        // Keep playback rates identical in autoplay mode.
        if (!fine && right.playbackRate !== left.playbackRate) {
          right.playbackRate = left.playbackRate;
        }
      }
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [mouseScrub]);

  return (
    <>
      <Rail side="left" scrubbed={mouseScrub} />
      <Rail side="right" scrubbed={mouseScrub} />
    </>
  );
}
