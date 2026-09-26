import { useEffect, useRef } from "react";

/**
 * Slim vertical video banners for the auth screens — the luxury-ticker band
 * turned on its side. One gold/black loop video is split across two slim
 * rails (left rail shows the left half, right rail the right half), playing
 * in sync as a seamless loop.
 */
const VIDEO_SRC = `${import.meta.env.BASE_URL}videos/auth-side-banner.mp4`;

function Rail({ side }: { side: "left" | "right" }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Respect reduced-motion: keep a still frame instead of playing.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
      return;
    }
    const play = () => video.play().catch(() => {});
    if (video.readyState >= 2) play();
    else video.addEventListener("canplay", play, { once: true });
    return () => video.removeEventListener("canplay", play);
  }, []);

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

export function SideVideoBanners() {
  // Keep the two rails locked in sync: the right rail continuously mirrors
  // the left rail's clock via rAF, so both sides play the exact same loop
  // frame — no drift, no visible jumps.
  useEffect(() => {
    let raf = 0;
    const sync = () => {
      const left = document.querySelector<HTMLVideoElement>('video[data-rail="left"]');
      const right = document.querySelector<HTMLVideoElement>('video[data-rail="right"]');
      if (left && right && !left.paused && !right.paused) {
        const drift = Math.abs(left.currentTime - right.currentTime);
        if (drift > 0.04) right.currentTime = left.currentTime;
        // Keep playback rates identical too.
        if (right.playbackRate !== left.playbackRate) right.playbackRate = left.playbackRate;
      }
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <Rail side="left" />
      <Rail side="right" />
    </>
  );
}
