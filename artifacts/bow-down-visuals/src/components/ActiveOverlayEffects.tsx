/**
 * ActiveOverlayEffects — premium animated CSS/SVG overlays for the master player.
 *
 * Design goals:
 *   • Subtle, cinematic defaults — nothing at 100% opacity
 *   • Logo watermark (Bow Down Visuals PNG) by default, not text
 *   • Overlay quality mode scales all intensities uniformly
 *   • Captions and artist face safe areas respected
 */
import type React from "react";

/* ─── Logo asset path (served from public/) ─────────────────────────────── */
const LOGO_URL = `${import.meta.env.BASE_URL}logo-static.png`;

/* ─── Per-effect intensity defaults — subtle/cinematic, never 100% ──────── */
export const OVERLAY_DEFAULT_INTENSITY: Record<string, number> = {
  "Light Leaks":       12,
  "Lens Flare":        10,
  "Smoke":             10,
  "Rain":              12,
  "Sparks":             8,
  "Dust":               8,
  "Animated Waveform": 25,
  "Logo / Watermark":  65,
};

/* ─── Quality mode multipliers ──────────────────────────────────────────── */
function qualityMult(mode: string): number {
  if (mode === "subtle")    return 0.50;
  if (mode === "cinematic") return 1.30;
  if (mode === "heavy")     return 1.75;
  return 1.0; // music-video (default)
}

/* ─── CSS keyframes ─────────────────────────────────────────────────────── */
const KEYFRAMES = `
@keyframes bdv-rain{
  0%  { transform:translateY(-10%) rotate(12deg);opacity:.55 }
  100%{ transform:translateY(118%) rotate(12deg);opacity:.03 }
}
@keyframes bdv-smoke{
  0%  { transform:translateY(0)    scale(1);   opacity:.22 }
  60% { opacity:.09 }
  100%{ transform:translateY(-130%) scale(3.4); opacity:0  }
}
@keyframes bdv-spark{
  0%  { transform:translate(0,0)               scale(1.3); opacity:1   }
  60% { opacity:.45 }
  100%{ transform:translate(var(--dx),var(--dy)) scale(.04); opacity:0  }
}
@keyframes bdv-dust{
  0%  { transform:translate(0,0); opacity:0   }
  14% { opacity:.50 }
  84% { opacity:.18 }
  100%{ transform:translate(var(--dx),var(--dy)); opacity:0 }
}
@keyframes bdv-flare-pulse{
  0%,100%{ opacity:.60; transform:scale(1)    }
  40%    { opacity:.75; transform:scale(1.06) }
  70%    { opacity:.42; transform:scale(.95)  }
}
@keyframes bdv-flare-drift{
  0%,100%{ left:68% }
  50%    { left:74% }
}
@keyframes bdv-leak{
  0%  { opacity:0; transform:translateX(-72%) skewX(-12deg) }
  22% { opacity:.35 }
  72% { opacity:.20 }
  100%{ opacity:0; transform:translateX(92%)  skewX(-12deg) }
}
@keyframes bdv-bar{
  0%,100%{ transform:scaleY(var(--h1)) }
  50%    { transform:scaleY(var(--h2)) }
}
`;

/* ─── Deterministic pseudo-random ─────────────────────────────────────── */
const dr = (s: number) => ((s * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff;

/* ─── Effective opacity for one effect ──────────────────────────────────── */
type IntensityMap = Record<string, number>;
const gi = (map: IntensityMap, name: string, qm: number, sm: number) =>
  Math.max(0.02, Math.min(1, (map[name] ?? OVERLAY_DEFAULT_INTENSITY[name] ?? 12) / 100 * qm * sm));

/* ─── Stack multiplier — prevent washed-out video with many overlays ────── */
function calcStackMult(n: number): number {
  if (n <= 1) return 1.0;
  if (n === 2) return 0.82;
  if (n === 3) return 0.65;
  return 0.52;
}

/* ══════════════════ Rain ══════════════════════════════════════════════════ */
function RainEffect({ opacity }: { opacity: number }) {
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {Array.from({ length: 28 }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${dr(i * 3) * 95 + 0.5}%`,
            top: `${-10 - dr(i * 3 + 1) * 8}%`,
            width: dr(i * 3 + 2) > 0.75 ? "0.7px" : "0.45px",
            height: `${28 + dr(i * 7) * 32}px`,
            background: `rgba(200,225,255,${0.28 + dr(i * 5) * 0.25})`,
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
  return (
    <div style={{ position: "absolute", inset: 0, opacity, mixBlendMode: "screen" as const }}>
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${18 + dr(i * 7) * 64}%`,
            bottom: `${-6 + dr(i * 3) * 12}%`,
            width: `${45 + dr(i * 11) * 65}px`,
            height: `${45 + dr(i * 5) * 65}px`,
            background: `rgba(210,210,210,0.07)`,
            borderRadius: "50%",
            filter: `blur(${32 + dr(i * 13) * 38}px)`,
            animationName: "bdv-smoke",
            animationDuration: `${4.5 + dr(i * 7) * 5}s`,
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
  const N = 16;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {Array.from({ length: N }, (_, i) => {
        const angle = (i / N) * 2 * Math.PI + dr(i * 7) * 0.6 - Math.PI / 2;
        const dist  = 45 + dr(i * 13) * 90;
        const dx    = Math.round(Math.cos(angle) * dist);
        const dy    = Math.round(Math.sin(angle) * dist) - 25;
        const sz    = 1.2 + dr(i * 7) * 2.5;
        const r     = 205 + Math.round(dr(i * 9) * 50);
        const g     = 60  + Math.round(dr(i * 11) * 80);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `calc(${44 + dr(i * 5) * 12}% + ${Math.round((dr(i * 3) - 0.5) * 35)}px)`,
              bottom: `${4 + dr(i * 11) * 12}%`,
              width: `${sz}px`,
              height: `${sz}px`,
              background: `rgba(${r},${g},10,1)`,
              borderRadius: "50%",
              boxShadow: `0 0 ${sz * 1.3}px rgba(${r},${g},10,0.75), 0 0 ${sz * 2.5}px rgba(255,100,10,0.40)`,
              "--dx": `${dx}px`,
              "--dy": `${dy}px`,
              animationName: "bdv-spark",
              animationDuration: `${0.50 + dr(i * 17) * 1.1}s`,
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
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {Array.from({ length: 22 }, (_, i) => {
        const dx = Math.round((dr(i * 3) - 0.5) * 55);
        const dy = Math.round((dr(i * 7) - 0.5) * 55);
        const sz = 0.7 + dr(i * 5) * 1.8;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${dr(i * 11) * 94}%`,
              top:  `${dr(i * 13) * 94}%`,
              width:  `${sz}px`,
              height: `${sz}px`,
              background: `rgba(218,200,162,${0.22 + dr(i * 17) * 0.25})`,
              borderRadius: "50%",
              "--dx": `${dx}px`,
              "--dy": `${dy}px`,
              animationName: "bdv-dust",
              animationDuration: `${5 + dr(i * 11) * 7}s`,
              animationDelay: `${-dr(i * 19) * 7}s`,
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
  const cy = "18%";
  const pulse: React.CSSProperties = {
    animationName: "bdv-flare-pulse",
    animationDuration: "3.0s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  };
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      <div style={{
        ...pulse,
        position: "absolute",
        top: cy,
        animationName: "bdv-flare-drift, bdv-flare-pulse",
        animationDuration: "13s, 3.0s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
        transform: "translateY(-50%)",
        width: "46px", height: "46px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,248,188,0.65) 0%, rgba(255,210,65,0.22) 36%, transparent 72%)",
        filter: "blur(2px)",
        boxShadow: "0 0 18px 6px rgba(255,225,90,0.15)",
      }} />
      <div style={{
        ...pulse,
        position: "absolute", left: "68%", top: cy,
        transform: "translate(-50%,-50%)",
        width: "90px", height: "90px", borderRadius: "50%",
        border: "0.6px solid rgba(255,228,120,0.10)",
      }} />
      <div style={{
        ...pulse,
        position: "absolute", top: cy, left: 0, right: 0,
        height: "0.5px",
        background: "linear-gradient(90deg,transparent 3%,rgba(255,225,120,0.08) 25%,rgba(255,248,188,0.28) 68%,rgba(255,225,120,0.08) 84%,transparent 97%)",
      }} />
      <div style={{
        ...pulse,
        position: "absolute", left: "26%", top: "80%",
        transform: "translate(-50%,-50%)",
        width: "10px", height: "10px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(100,200,255,0.30) 0%, transparent 72%)",
        filter: "blur(1px)",
      }} />
    </div>
  );
}

/* ══════════════════ Light Leaks ═══════════════════════════════════════════ */
function LightLeaksEffect({ opacity, protectCaptions }: { opacity: number; protectCaptions: boolean }) {
  /* If captions are protected we clip the leak so it doesn't bleed into bottom 22% */
  const clipStyle: React.CSSProperties = protectCaptions
    ? { clipPath: "inset(0 0 22% 0)" }
    : {};
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity, mixBlendMode: "screen" as const }}>
      <div style={{
        ...clipStyle,
        position: "absolute",
        top: "-20%", left: "-30%",
        width: "55%", height: "148%",
        background: "linear-gradient(132deg,rgba(255,195,55,.28) 0%,rgba(255,105,18,.16) 34%,rgba(220,50,70,.06) 62%,transparent 82%)",
        animationName: "bdv-leak",
        animationDuration: "5.0s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
      }} />
      <div style={{
        ...clipStyle,
        position: "absolute",
        top: "-20%", left: "-30%",
        width: "44%", height: "148%",
        background: "linear-gradient(150deg,rgba(90,180,255,.12) 0%,rgba(255,180,55,.09) 42%,transparent 68%)",
        animationName: "bdv-leak",
        animationDuration: "6.2s",
        animationDelay: "-2.8s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
      }} />
    </div>
  );
}

/* ══════════════════ Animated Waveform ═════════════════════════════════════ */
export type WavePosition = "bottom-safe" | "bottom" | "top" | "hidden";

function WaveformEffect({
  opacity,
  position = "bottom-safe",
  protectCaptions,
}: {
  opacity: number;
  position?: WavePosition;
  protectCaptions: boolean;
}) {
  /* When captions are protected, never let waveform sit at raw "bottom" */
  const effectivePos: WavePosition =
    protectCaptions && position === "bottom" ? "bottom-safe" : position;

  if (effectivePos === "hidden") return null;

  const N   = 28;
  const BAR = 5;
  const GAP = 3;
  const H   = 46;
  const W   = N * (BAR + GAP) - GAP;
  const rgb = { r: 201, g: 168, b: 76 }; // gold

  const posStyle: React.CSSProperties =
    effectivePos === "top"    ? { top: "4%",  bottom: "auto" } :
    effectivePos === "bottom" ? { bottom: "2%", top: "auto"  } :
                                { bottom: "21%", top: "auto" }; /* bottom-safe */

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
        filter: `drop-shadow(0 0 3px rgba(${rgb.r},${rgb.g},${rgb.b},0.28))`,
      }}
    >
      {Array.from({ length: N }, (_, i) => {
        const h1 = (6 + dr(i * 7) * 35) / H;
        const h2 = (6 + dr(i * 11 + 3) * 35) / H;
        const alpha = 0.65 + dr(i * 5) * 0.28;
        return (
          <rect
            key={i}
            x={i * (BAR + GAP)} y={0} width={BAR} height={H} rx={2}
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
function WatermarkEffect({
  opacity,
  type = "logo",
  text = "Bow Down Visuals",
  position = "bottom-right",
  size = "medium",
  margin = 16,
  showOnPreview = true,
}: {
  opacity: number;
  type?: string;
  text?: string;
  position?: string;
  size?: string;
  margin?: number;
  showOnPreview?: boolean;
}) {
  if (!showOnPreview || type === "none") return null;

  const isBottom = position.includes("bottom");
  const isRight  = position.includes("right");

  const posStyle: React.CSSProperties = {
    position: "absolute",
    ...(isBottom ? { bottom: margin } : { top: margin }),
    ...(isRight  ? { right:  margin } : { left:  margin }),
  };

  if (type === "logo") {
    const h = size === "small" ? 28 : size === "large" ? 58 : 42;
    return (
      <div
        data-testid="watermark-overlay"
        style={{
          ...posStyle,
          opacity,
          padding: "3px 5px",
          borderRadius: "0.3rem",
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(3px)",
        }}
      >
        <img
          src={LOGO_URL}
          alt="Bow Down Visuals"
          style={{ height: h, width: "auto", display: "block" }}
          draggable={false}
        />
      </div>
    );
  }

  /* type === "text" */
  const fontSize =
    size === "small" ? "clamp(7px,1.1vw,10px)" :
    size === "large" ? "clamp(10px,1.8vw,15px)" :
                       "clamp(8px,1.4vw,12px)";
  return (
    <div
      data-testid="watermark-overlay"
      style={{
        ...posStyle,
        opacity,
        background: "rgba(0,0,0,0.48)",
        color: "rgba(201,168,76,0.92)",
        fontSize,
        fontWeight: 900,
        letterSpacing: "0.14em",
        padding: "0.22rem 0.70rem",
        borderRadius: "0.28rem",
        border: "1px solid rgba(201,168,76,0.26)",
        backdropFilter: "blur(4px)",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
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
  /* Watermark */
  watermarkText?: string;
  watermarkType?: string;
  watermarkPosition?: string;
  watermarkSize?: string;
  watermarkMargin?: number;
  watermarkShowOnPreview?: boolean;
  /* Waveform */
  waveformPosition?: string;
  /* Quality / Safe areas */
  overlayQualityMode?: string;
  overlayProtectCaptions?: boolean;
}

const VISUAL_EFFECTS = ["Rain", "Smoke", "Sparks", "Dust", "Light Leaks", "Lens Flare", "Animated Waveform"];

export function ActiveOverlayEffects({
  activeOverlays,
  intensity,
  testActive,
  watermarkText = "Bow Down Visuals",
  watermarkType = "logo",
  watermarkPosition = "bottom-right",
  watermarkSize = "medium",
  watermarkMargin = 16,
  watermarkShowOnPreview = true,
  waveformPosition = "bottom-safe",
  overlayQualityMode = "music-video",
  overlayProtectCaptions = true,
}: ActiveOverlayEffectsProps) {
  const show = testActive
    ? [...new Set([...activeOverlays, "Rain", "Sparks", "Lens Flare"])]
    : activeOverlays;

  if (show.length === 0) return null;

  const qm = qualityMult(overlayQualityMode);
  const visualCount = show.filter((x) => VISUAL_EFFECTS.includes(x)).length;
  const sm = calcStackMult(visualCount);
  const o = (name: string) => gi(intensity, name, qm, sm);

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 13 }}
      data-testid="active-overlay-effects"
    >
      <style>{KEYFRAMES}</style>

      {show.includes("Rain")               && <RainEffect         opacity={o("Rain")} />}
      {show.includes("Smoke")              && <SmokeEffect        opacity={o("Smoke")} />}
      {show.includes("Sparks")             && <SparksEffect       opacity={o("Sparks")} />}
      {show.includes("Lens Flare")         && <LensFlareEffect    opacity={o("Lens Flare")} />}
      {show.includes("Dust")               && <DustEffect         opacity={o("Dust")} />}
      {show.includes("Light Leaks")        && <LightLeaksEffect   opacity={o("Light Leaks")} protectCaptions={overlayProtectCaptions} />}
      {show.includes("Animated Waveform")  && (
        <WaveformEffect
          opacity={o("Animated Waveform")}
          position={(waveformPosition as WavePosition) || "bottom-safe"}
          protectCaptions={overlayProtectCaptions}
        />
      )}
      {show.includes("Logo / Watermark") && (
        <WatermarkEffect
          opacity={gi(intensity, "Logo / Watermark", 1.0, 1.0)} /* watermark ignores stack+quality multipliers */
          type={watermarkType}
          text={watermarkText}
          position={watermarkPosition}
          size={watermarkSize}
          margin={watermarkMargin}
          showOnPreview={watermarkShowOnPreview}
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
            boxShadow: "0 0 30px rgba(201,168,76,0.55)",
            zIndex: 30,
          }}
        >
          OVERLAY TEST ACTIVE
        </div>
      )}
    </div>
  );
}
