/**
 * ActiveOverlayEffects — premium animated CSS/SVG overlays driven by
 * settings.overlays chip selections.  Each effect uses a per-effect
 * intensity default (not 100%) for a professional, cinematic look.
 *
 * Visual design goals: subtle, music-video quality, captions always readable.
 */
import type React from "react";

/* ─── Per-effect intensity defaults (professional, subtle) ──────────────── */
export const OVERLAY_DEFAULT_INTENSITY: Record<string, number> = {
  "Light Leaks":       20,
  "Lens Flare":        20,
  "Smoke":             15,
  "Rain":              20,
  "Sparks":            15,
  "Dust":              12,
  "Animated Waveform": 35,
  "Logo / Watermark":  65,
};

/* ─── CSS keyframes ─────────────────────────────────────────────────────── */
const KEYFRAMES = `
@keyframes bdv-rain{
  0%  { transform:translateY(-10%) rotate(12deg);opacity:.65 }
  100%{ transform:translateY(118%) rotate(12deg);opacity:.04 }
}
@keyframes bdv-smoke{
  0%  { transform:translateY(0)    scale(1);   opacity:.28 }
  60% { opacity:.11 }
  100%{ transform:translateY(-130%) scale(3.4); opacity:0  }
}
@keyframes bdv-spark{
  0%  { transform:translate(0,0)               scale(1.4); opacity:1   }
  60% { opacity:.55 }
  100%{ transform:translate(var(--dx),var(--dy)) scale(.04); opacity:0  }
}
@keyframes bdv-dust{
  0%  { transform:translate(0,0); opacity:0   }
  14% { opacity:.55 }
  84% { opacity:.22 }
  100%{ transform:translate(var(--dx),var(--dy)); opacity:0 }
}
@keyframes bdv-flare-pulse{
  0%,100%{ opacity:.68; transform:scale(1)    }
  40%    { opacity:.84; transform:scale(1.06) }
  70%    { opacity:.48; transform:scale(.95)  }
}
@keyframes bdv-flare-drift{
  0%,100%{ left:68% }
  50%    { left:74% }
}
@keyframes bdv-leak{
  0%  { opacity:0; transform:translateX(-72%) skewX(-12deg) }
  22% { opacity:.38 }
  72% { opacity:.22 }
  100%{ opacity:0; transform:translateX(92%)  skewX(-12deg) }
}
@keyframes bdv-bar{
  0%,100%{ transform:scaleY(var(--h1)) }
  50%    { transform:scaleY(var(--h2)) }
}
`;

/* ─── Deterministic pseudo-random ─────────────────────────────────────── */
const dr = (s: number) => ((s * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff;

/* ─── Intensity helper — uses per-effect defaults, never 100 ─────────── */
type IntensityMap = Record<string, number>;
const gi = (map: IntensityMap, name: string) =>
  Math.max(0.05, Math.min(1, (map[name] ?? OVERLAY_DEFAULT_INTENSITY[name] ?? 20) / 100));

/* ─── Stacking multiplier — prevent washed-out video with many overlays ─ */
function calcStackMult(visualCount: number): number {
  if (visualCount <= 1) return 1.0;
  if (visualCount === 2) return 0.80;
  if (visualCount === 3) return 0.62;
  return 0.50; // 4+
}

/* ══════════════════ Rain ══════════════════════════════════════════════════ */
function RainEffect({ opacity }: { opacity: number }) {
  const N = 30;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {Array.from({ length: N }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${dr(i * 3) * 95 + 0.5}%`,
            top: `${-10 - dr(i * 3 + 1) * 8}%`,
            width: dr(i * 3 + 2) > 0.75 ? "0.8px" : "0.5px",
            height: `${32 + dr(i * 7) * 36}px`,
            background: `rgba(200,225,255,${0.30 + dr(i * 5) * 0.28})`,
            borderRadius: "1px",
            filter: "blur(0.2px)",
            animationName: "bdv-rain",
            animationDuration: `${0.28 + dr(i * 11) * 0.42}s`,
            animationDelay: `${-dr(i * 13) * 1.4}s`,
            animationTimingFunction: "linear",
            animationIterationCount: "infinite",
          }}
        />
      ))}
    </div>
  );
}

/* ══════════════════ Smoke ═════════════════════════════════════════════════ */
function SmokeEffect({ opacity }: { opacity: number }) {
  const N = 5;
  return (
    <div style={{ position: "absolute", inset: 0, opacity, mixBlendMode: "screen" as const }}>
      {Array.from({ length: N }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${18 + dr(i * 7) * 64}%`,
            bottom: `${-6 + dr(i * 3) * 12}%`,
            width: `${50 + dr(i * 11) * 70}px`,
            height: `${50 + dr(i * 5) * 70}px`,
            background: `rgba(210,210,210,0.09)`,
            borderRadius: "50%",
            filter: `blur(${30 + dr(i * 13) * 35}px)`,
            animationName: "bdv-smoke",
            animationDuration: `${4.0 + dr(i * 7) * 4.5}s`,
            animationDelay: `${-dr(i * 17) * 5.5}s`,
            animationTimingFunction: "ease-out",
            animationIterationCount: "infinite",
          }}
        />
      ))}
    </div>
  );
}

/* ══════════════════ Sparks ════════════════════════════════════════════════ */
function SparksEffect({ opacity }: { opacity: number }) {
  const N = 18;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {Array.from({ length: N }, (_, i) => {
        const angle = (i / N) * 2 * Math.PI + dr(i * 7) * 0.6 - Math.PI / 2;
        const dist  = 50 + dr(i * 13) * 95;
        const dx    = Math.round(Math.cos(angle) * dist);
        const dy    = Math.round(Math.sin(angle) * dist) - 28;
        const sz    = 1.5 + dr(i * 7) * 3.0;
        const r     = 210 + Math.round(dr(i * 9) * 45);
        const g     = 65  + Math.round(dr(i * 11) * 90);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `calc(${43 + dr(i * 5) * 14}% + ${Math.round((dr(i * 3) - 0.5) * 38)}px)`,
              bottom: `${4 + dr(i * 11) * 13}%`,
              width:  `${sz}px`,
              height: `${sz}px`,
              background: `rgba(${r},${g},10,1)`,
              borderRadius: "50%",
              boxShadow: [
                `0 0 ${sz * 1.4}px rgba(${r},${g},10,0.80)`,
                `0 0 ${sz * 2.8}px rgba(255,110,10,0.45)`,
                `0 0 ${sz * 5.5}px rgba(255,60,0,0.20)`,
              ].join(", "),
              "--dx": `${dx}px`,
              "--dy": `${dy}px`,
              animationName: "bdv-spark",
              animationDuration: `${0.48 + dr(i * 17) * 1.05}s`,
              animationDelay: `${-dr(i * 19) * 2.3}s`,
              animationTimingFunction: "ease-out",
              animationIterationCount: "infinite",
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

/* ══════════════════ Dust ══════════════════════════════════════════════════ */
function DustEffect({ opacity }: { opacity: number }) {
  const N = 24;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {Array.from({ length: N }, (_, i) => {
        const dx = Math.round((dr(i * 3) - 0.5) * 60);
        const dy = Math.round((dr(i * 7) - 0.5) * 60);
        const sz = 0.8 + dr(i * 5) * 2.2;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${dr(i * 11) * 94}%`,
              top:  `${dr(i * 13) * 94}%`,
              width:  `${sz}px`,
              height: `${sz}px`,
              background: `rgba(218,200,162,${0.28 + dr(i * 17) * 0.30})`,
              borderRadius: "50%",
              "--dx": `${dx}px`,
              "--dy": `${dy}px`,
              animationName: "bdv-dust",
              animationDuration: `${4.5 + dr(i * 11) * 6.5}s`,
              animationDelay: `${-dr(i * 19) * 6.5}s`,
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

/* ══════════════════ Lens Flare ════════════════════════════════════════════ */
function LensFlareEffect({ opacity }: { opacity: number }) {
  const cy = "19%";
  const pulse: React.CSSProperties = {
    animationName: "bdv-flare-pulse",
    animationDuration: "2.9s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  };
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {/* Main glow — drifts horizontally */}
      <div style={{
        ...pulse,
        position: "absolute",
        top: cy,
        animationName: "bdv-flare-drift, bdv-flare-pulse",
        animationDuration: "12s, 2.9s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
        transform: "translateY(-50%)",
        width: "54px", height: "54px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,248,188,0.75) 0%, rgba(255,210,65,0.28) 36%, transparent 72%)",
        filter: "blur(2px)",
        boxShadow: "0 0 24px 8px rgba(255,225,90,0.20)",
      }} />
      {/* Ring 1 — subtle */}
      <div style={{
        ...pulse,
        position: "absolute", left: "68%", top: cy,
        transform: "translate(-50%,-50%)",
        width: "105px", height: "105px", borderRadius: "50%",
        border: "0.8px solid rgba(255,228,120,0.14)",
      }} />
      {/* Ring 2 — very subtle */}
      <div style={{
        ...pulse,
        position: "absolute", left: "68%", top: cy,
        transform: "translate(-50%,-50%)",
        width: "170px", height: "170px", borderRadius: "50%",
        border: "0.5px solid rgba(255,225,120,0.07)",
      }} />
      {/* Horizontal streak */}
      <div style={{
        ...pulse,
        position: "absolute", top: cy, left: 0, right: 0,
        height: "0.5px",
        background: "linear-gradient(90deg,transparent 3%,rgba(255,225,120,0.10) 25%,rgba(255,248,188,0.35) 68%,rgba(255,225,120,0.10) 84%,transparent 97%)",
      }} />
      {/* Secondary dot */}
      <div style={{
        ...pulse,
        position: "absolute", left: "28%", top: "79%",
        transform: "translate(-50%,-50%)",
        width: "12px", height: "12px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(100,200,255,0.38) 0%, transparent 72%)",
        filter: "blur(1px)",
      }} />
    </div>
  );
}

/* ══════════════════ Light Leaks ═══════════════════════════════════════════ */
function LightLeaksEffect({ opacity }: { opacity: number }) {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity, mixBlendMode: "screen" as const }}>
      {/* Primary warm sweep — cinematic, not overwhelming */}
      <div style={{
        position: "absolute",
        top: "-20%", left: "-30%",
        width: "58%", height: "148%",
        background: "linear-gradient(132deg,rgba(255,195,55,.35) 0%,rgba(255,105,18,.22) 34%,rgba(220,50,70,.08) 62%,transparent 82%)",
        animationName: "bdv-leak",
        animationDuration: "4.8s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
      }} />
      {/* Secondary cool sweep */}
      <div style={{
        position: "absolute",
        top: "-20%", left: "-30%",
        width: "48%", height: "148%",
        background: "linear-gradient(150deg,rgba(90,180,255,.16) 0%,rgba(255,180,55,.12) 42%,transparent 68%)",
        animationName: "bdv-leak",
        animationDuration: "5.8s",
        animationDelay: "-2.5s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
      }} />
    </div>
  );
}

/* ══════════════════ Animated Waveform ═════════════════════════════════════ */
type WaveStyle = "bars" | "strip";
type WaveColor = "gold" | "white" | "black" | "custom";
export type WavePosition = "bottom-safe" | "bottom" | "top" | "hidden";

function WaveformEffect({
  opacity,
  waveStyle = "bars",
  waveColor = "gold",
  customColor,
  position = "bottom-safe",
}: {
  opacity: number;
  waveStyle?: WaveStyle;
  waveColor?: WaveColor;
  customColor?: string;
  position?: WavePosition;
}) {
  if (position === "hidden") return null;

  const N   = 30;
  const BAR = 5;
  const GAP = 3;
  const H   = 50;
  const W   = N * (BAR + GAP) - GAP;

  const baseColor =
    waveColor === "gold"  ? "#C9A84C" :
    waveColor === "white" ? "#ffffff" :
    waveColor === "black" ? "#222222" :
    (customColor ?? "#C9A84C");

  const hexToRgb = (hex: string) => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  });
  const rgb = hexToRgb(baseColor.startsWith("#") ? baseColor : "#C9A84C");

  /* bottom-safe = above caption area (~19% from bottom); top = near top */
  const posStyle: React.CSSProperties =
    position === "top"
      ? { top: "4%", bottom: "auto" }
      : position === "bottom"
      ? { bottom: "2%", top: "auto" }
      : { bottom: "20%", top: "auto" }; /* bottom-safe */

  if (waveStyle === "strip") {
    return (
      <svg
        width="100%" height={H}
        style={{ position: "absolute", left: 0, ...posStyle, opacity }}
        viewBox={`0 0 ${W * 2} ${H}`}
        preserveAspectRatio="none"
      >
        {Array.from({ length: N * 2 }, (_, i) => {
          const h1 = (5 + dr(i * 7) * 40) / H;
          const h2 = (5 + dr(i * 11 + 3) * 40) / H;
          return (
            <rect
              key={i}
              x={i * (BAR + GAP)} y={0} width={BAR} height={H} rx={1}
              fill={`rgba(${rgb.r},${rgb.g},${rgb.b},0.60)`}
              style={{
                transformBox: "fill-box", transformOrigin: "50% 100%",
                animationName: "bdv-bar",
                animationDuration: `${0.22 + dr(i * 13) * 0.55}s`,
                animationDelay: `${-dr(i * 17) * 0.55}s`,
                animationTimingFunction: "ease-in-out",
                animationIterationCount: "infinite",
                "--h1": String(h1), "--h2": String(h2),
              } as React.CSSProperties}
            />
          );
        })}
      </svg>
    );
  }

  return (
    <svg
      width={W} height={H}
      style={{
        position: "absolute",
        left: "50%",
        ...posStyle,
        transform: "translateX(-50%)",
        opacity,
        overflow: "visible",
        filter: `drop-shadow(0 0 4px rgba(${rgb.r},${rgb.g},${rgb.b},0.35))`,
      }}
    >
      {Array.from({ length: N }, (_, i) => {
        const h1 = (7 + dr(i * 7) * 38) / H;
        const h2 = (7 + dr(i * 11 + 3) * 38) / H;
        const x  = i * (BAR + GAP);
        const alpha = 0.68 + dr(i * 5) * 0.26;
        return (
          <rect
            key={i}
            x={x} y={0} width={BAR} height={H} rx={2}
            fill={`rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`}
            style={{
              transformBox: "fill-box", transformOrigin: "50% 100%",
              animationName: "bdv-bar",
              animationDuration: `${0.24 + dr(i * 13) * 0.54}s`,
              animationDelay: `${-dr(i * 17) * 0.55}s`,
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
              "--h1": String(h1), "--h2": String(h2),
            } as React.CSSProperties}
          />
        );
      })}
    </svg>
  );
}

/* ══════════════════ Logo / Watermark ══════════════════════════════════════ */
function LogoWatermarkEffect({ opacity, text }: { opacity: number; text: string }) {
  return (
    <div
      data-testid="watermark-overlay"
      style={{
        position: "absolute",
        bottom: "8%",
        right: "4%",
        opacity,
        background: "rgba(0,0,0,0.50)",
        color: "rgba(201,168,76,0.92)",
        fontSize: "clamp(8px,1.45vw,12px)",
        fontWeight: 900,
        letterSpacing: "0.14em",
        padding: "0.24rem 0.72rem",
        borderRadius: "0.28rem",
        border: "1px solid rgba(201,168,76,0.28)",
        backdropFilter: "blur(4px)",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        boxShadow: "0 0 8px rgba(201,168,76,0.08)",
      }}
    >
      {text || "Bow Down Visuals"}
    </div>
  );
}

/* ══════════════════ Root ══════════════════════════════════════════════════ */
export interface ActiveOverlayEffectsProps {
  activeOverlays: string[];
  intensity: IntensityMap;
  testActive: boolean;
  watermarkText?: string;
  waveformPosition?: string;
}

const VISUAL_EFFECTS = ["Rain", "Smoke", "Sparks", "Dust", "Light Leaks", "Lens Flare", "Animated Waveform"];

export function ActiveOverlayEffects({
  activeOverlays,
  intensity,
  testActive,
  watermarkText = "Bow Down Visuals",
  waveformPosition = "bottom-safe",
}: ActiveOverlayEffectsProps) {
  const show = testActive
    ? [...new Set([...activeOverlays, "Rain", "Sparks", "Lens Flare"])]
    : activeOverlays;

  if (show.length === 0) return null;

  const visualCount = show.filter((x) => VISUAL_EFFECTS.includes(x)).length;
  const sm = calcStackMult(visualCount);

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 13 }}
      data-testid="active-overlay-effects"
    >
      <style>{KEYFRAMES}</style>

      {show.includes("Rain")               && <RainEffect       opacity={gi(intensity, "Rain") * sm} />}
      {show.includes("Smoke")              && <SmokeEffect      opacity={gi(intensity, "Smoke") * sm} />}
      {show.includes("Sparks")             && <SparksEffect     opacity={gi(intensity, "Sparks") * sm} />}
      {show.includes("Lens Flare")         && <LensFlareEffect  opacity={gi(intensity, "Lens Flare") * sm} />}
      {show.includes("Dust")               && <DustEffect       opacity={gi(intensity, "Dust") * sm} />}
      {show.includes("Light Leaks")        && <LightLeaksEffect opacity={gi(intensity, "Light Leaks") * sm} />}
      {show.includes("Animated Waveform")  && (
        <WaveformEffect
          opacity={gi(intensity, "Animated Waveform") * sm}
          waveColor="gold"
          position={(waveformPosition as WavePosition) || "bottom-safe"}
        />
      )}
      {show.includes("Logo / Watermark") && (
        <LogoWatermarkEffect
          opacity={gi(intensity, "Logo / Watermark")}
          text={watermarkText || "Bow Down Visuals"}
        />
      )}

      {testActive && (
        <div
          data-testid="active-overlay-test-label"
          style={{
            position: "absolute",
            top: "12%",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.90)",
            color: "#C9A84C",
            fontWeight: 900,
            fontSize: "clamp(11px,2.5vw,19px)",
            padding: "0.38rem 1.4rem",
            borderRadius: "0.5rem",
            border: "2px solid #C9A84C",
            letterSpacing: "0.1em",
            whiteSpace: "nowrap",
            boxShadow: "0 0 30px rgba(201,168,76,0.55), 0 0 60px rgba(201,168,76,0.20)",
            zIndex: 30,
          }}
        >
          OVERLAY TEST ACTIVE
        </div>
      )}
    </div>
  );
}
