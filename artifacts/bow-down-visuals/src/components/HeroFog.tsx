/* ─────────────────── Homepage hero ground fog ─────────────────── */
/* Soft gold-tinted fog banks pooling around the Shark King's feet at the
   bottom of the hero. Pure CSS: blurred translucent blobs drifting slowly
   on alternating loops — no assets, no cost.

   Layering: above the spotlight rig (z-[2]) so the fog catches the beams,
   below the shark (z-[4]) so it wraps his feet instead of washing over
   him, and below the curtain overlay (z-[5]).

   Reduced motion: the drift stops and the fog holds still. */

interface FogBlob {
  left: string;
  width: string;
  duration: string;
  delay: string;
  opacity: number;
  reverse?: boolean;
}

const BLOBS: FogBlob[] = [
  { left: "-6%",  width: "46%", duration: "26s", delay: "0s",   opacity: 0.5 },
  { left: "18%",  width: "40%", duration: "34s", delay: "-11s", opacity: 0.42, reverse: true },
  { left: "44%",  width: "48%", duration: "29s", delay: "-7s",  opacity: 0.46 },
  { left: "68%",  width: "42%", duration: "38s", delay: "-19s", opacity: 0.38, reverse: true },
  { left: "88%",  width: "30%", duration: "24s", delay: "-4s",  opacity: 0.34 },
];

export function HeroFog({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute overflow-hidden ${className}`}
      style={{
        maskImage: "linear-gradient(to bottom, transparent 0%, black 45%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 45%)",
      }}
    >
      {BLOBS.map((b, i) => (
        <div
          key={i}
          className="hero-fog-blob absolute bottom-[-30%] h-[130%] rounded-[50%]"
          style={{
            left: b.left,
            width: b.width,
            opacity: b.opacity,
            animationDuration: b.duration,
            animationDelay: b.delay,
            animationDirection: b.reverse ? "reverse" : "normal",
            background:
              "radial-gradient(ellipse at center, rgba(255,228,150,0.20) 0%, rgba(255,214,120,0.10) 45%, transparent 72%)",
            filter: "blur(56px)",
          }}
        />
      ))}
    </div>
  );
}
