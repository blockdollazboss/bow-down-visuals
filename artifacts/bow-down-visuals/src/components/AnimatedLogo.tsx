const BASE_URL = import.meta.env.BASE_URL as string;

interface AnimatedLogoProps {
  className?: string;
}

// ─── Wave bar data ────────────────────────────────────────────────────────────
// viewBox: 0 0 1100 880  |  play-button center: (550, 310)
// Each entry: [x, maxHalfHeight, animDurationSec, delayOffsetSec]
const LEFT_BARS: [number, number, number, number][] = [
  [454, 58, 0.68, 0.00],
  [441, 72, 0.82, 0.06],
  [428, 85, 0.74, 0.12],
  [415, 68, 0.90, 0.18],
  [402, 78, 0.78, 0.24],
  [389, 55, 0.86, 0.30],
  [376, 65, 0.72, 0.36],
  [363, 48, 0.94, 0.42],
  [350, 58, 0.80, 0.48],
  [337, 42, 0.70, 0.54],
  [324, 50, 0.88, 0.60],
  [311, 36, 0.76, 0.66],
  [298, 44, 0.92, 0.72],
  [285, 30, 0.84, 0.78],
  [272, 36, 0.68, 0.84],
  [259, 24, 0.96, 0.90],
  [246, 28, 0.74, 0.96],
  [233, 18, 0.82, 1.02],
  [220, 22, 0.70, 1.08],
  [207, 14, 0.90, 1.14],
  [194, 18, 0.78, 1.20],
  [181, 10, 0.86, 1.26],
];

// Mirror left bars to the right of center (1100 - x - barWidth)
const BAR_W = 8;
const RIGHT_BARS: [number, number, number, number][] = LEFT_BARS.map(
  ([x, h, dur, del]) => [1100 - x - BAR_W, h, dur, del + 0.04]
);

// ─── Sparkle positions ────────────────────────────────────────────────────────
// Clustered around the diamond play button (center ~550, 310, radius ~88)
const SPARKLES = [
  { x: 528, y: 244, size: 14, dur: 2.2, delay: 0.0 },
  { x: 610, y: 268, size: 10, dur: 1.9, delay: 0.5 },
  { x: 630, y: 325, size: 16, dur: 2.6, delay: 1.0 },
  { x: 598, y: 380, size: 11, dur: 2.0, delay: 0.3 },
  { x: 498, y: 378, size: 13, dur: 2.4, delay: 0.8 },
  { x: 466, y: 315, size: 9,  dur: 1.8, delay: 1.3 },
  { x: 490, y: 250, size: 15, dur: 2.1, delay: 0.6 },
  { x: 643, y: 300, size: 8,  dur: 2.3, delay: 1.6 },
  { x: 560, y: 233, size: 12, dur: 1.7, delay: 0.9 },
];

// ─── Sparkle path helper ──────────────────────────────────────────────────────
function starPath(cx: number, cy: number, r: number): string {
  const r2 = r * 0.25;
  return (
    `M${cx},${cy - r} ` +
    `L${cx + r2},${cy - r2} ` +
    `L${cx + r},${cy} ` +
    `L${cx + r2},${cy + r2} ` +
    `L${cx},${cy + r} ` +
    `L${cx - r2},${cy + r2} ` +
    `L${cx - r},${cy} ` +
    `L${cx - r2},${cy - r2} Z`
  );
}

export function AnimatedLogo({ className }: AnimatedLogoProps) {
  return (
    <div className={`relative inline-block ${className ?? ""}`}>
      {/* ── Keyframes ─────────────────────────────────────────────────── */}
      <style>{`
        @keyframes bdvFloat {
          0%,100% { transform: translateY(0px); }
          50%      { transform: translateY(-5px); }
        }
        @keyframes bdvWave {
          0%,100% { transform: scaleY(0.12); opacity: 0.55; }
          50%     { transform: scaleY(1);    opacity: 1;    }
        }
        @keyframes bdvSparkle {
          0%,100% { opacity: 0; transform: scale(0) rotate(0deg); }
          40%,60% { opacity: 1; transform: scale(1) rotate(15deg); }
        }
        @keyframes bdvCrownGlow {
          0%,100% { opacity: 0;    transform: scale(0.75); }
          50%     { opacity: 0.35; transform: scale(1);    }
        }
        @keyframes bdvDiamondRing {
          0%,100% { opacity: 0; transform: scale(0.85); }
          50%     { opacity: 0.18; transform: scale(1.08); }
        }
        @keyframes bdvTextGlow {
          0%,100% { opacity: 0; }
          50%     { opacity: 0.22; }
        }
      `}</style>

      {/* ── Base logo — whole logo floats ─────────────────────────────── */}
      <img
        src={`${BASE_URL}logo-static.png`}
        alt="Bow Down Visuals"
        className="block w-full h-full object-contain"
        style={{ animation: "bdvFloat 3.2s ease-in-out infinite" }}
        draggable={false}
      />

      {/* ── SVG overlay (screen blend — gold adds to gold, black is invisible) */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        viewBox="0 0 1100 880"
        style={{ mixBlendMode: "screen" }}
        aria-hidden="true"
      >
        <defs>
          {/* Gold bar gradient */}
          <linearGradient id="bdvGold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#FFE066" stopOpacity="1" />
            <stop offset="45%"  stopColor="#FFC200" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#FFE066" stopOpacity="1" />
          </linearGradient>

          {/* Crown radial glow */}
          <radialGradient id="bdvCrownRG" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#FFE566" stopOpacity="1" />
            <stop offset="100%" stopColor="#FFB800" stopOpacity="0" />
          </radialGradient>

          {/* Diamond ring gradient */}
          <radialGradient id="bdvRingRG" cx="50%" cy="50%" r="50%">
            <stop offset="60%"  stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="1" />
          </radialGradient>

          {/* Text glow */}
          <radialGradient id="bdvTextRG" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#FFD700" stopOpacity="1" />
            <stop offset="100%" stopColor="#FFD700" stopOpacity="0" />
          </radialGradient>

          {/* Soft glow blur filter */}
          <filter id="bdvBlur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>

          {/* Strong sparkle glow */}
          <filter id="bdvSparkGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Crown glow pulse ──────────────────────────────────────── */}
        <ellipse
          cx="550" cy="118" rx="100" ry="80"
          fill="url(#bdvCrownRG)"
          style={{
            animation: "bdvCrownGlow 2.8s ease-in-out infinite",
            transformBox: "fill-box",
            transformOrigin: "center center",
          }}
        />

        {/* ── Diamond ring shimmer ──────────────────────────────────── */}
        <circle
          cx="550" cy="310" r="96"
          fill="none"
          stroke="url(#bdvRingRG)"
          strokeWidth="18"
          style={{
            animation: "bdvDiamondRing 3.5s ease-in-out infinite",
            transformBox: "fill-box",
            transformOrigin: "center center",
          }}
        />

        {/* ── Left wave bars ────────────────────────────────────────── */}
        {LEFT_BARS.map(([x, halfH, dur, del], i) => (
          <rect
            key={`l${i}`}
            x={x}
            y={310 - halfH}
            width={BAR_W}
            height={halfH * 2}
            rx={3}
            fill="url(#bdvGold)"
            filter="url(#bdvBlur)"
            style={{
              transformBox: "fill-box",
              transformOrigin: "50% 50%",
              animation: `bdvWave ${dur}s ease-in-out infinite`,
              animationDelay: `${del}s`,
            }}
          />
        ))}

        {/* ── Right wave bars ───────────────────────────────────────── */}
        {RIGHT_BARS.map(([x, halfH, dur, del], i) => (
          <rect
            key={`r${i}`}
            x={x}
            y={310 - halfH}
            width={BAR_W}
            height={halfH * 2}
            rx={3}
            fill="url(#bdvGold)"
            filter="url(#bdvBlur)"
            style={{
              transformBox: "fill-box",
              transformOrigin: "50% 50%",
              animation: `bdvWave ${dur}s ease-in-out infinite`,
              animationDelay: `${del}s`,
            }}
          />
        ))}

        {/* ── Diamond sparkles ─────────────────────────────────────── */}
        {SPARKLES.map((sp, i) => (
          <g
            key={`sp${i}`}
            filter="url(#bdvSparkGlow)"
            style={{
              transformBox: "fill-box",
              transformOrigin: `${sp.x}px ${sp.y}px`,
              animation: `bdvSparkle ${sp.dur}s ease-in-out infinite`,
              animationDelay: `${sp.delay}s`,
            }}
          >
            <path
              d={starPath(sp.x, sp.y, sp.size)}
              fill="white"
            />
          </g>
        ))}

        {/* ── "BOW DOWN VISUALS" text gold glow ────────────────────── */}
        <ellipse
          cx="550" cy="560" rx="320" ry="90"
          fill="url(#bdvTextRG)"
          style={{ animation: "bdvTextGlow 4s ease-in-out infinite" }}
        />
      </svg>
    </div>
  );
}
