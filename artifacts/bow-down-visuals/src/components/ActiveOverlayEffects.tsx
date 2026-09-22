/**
 * ActiveOverlayEffects — premium animated CSS/SVG overlays.
 *
 * Opacity architecture:
 *   Each effect's inner elements animate 1.0 → 0.0.
 *   The outer container carries gi() = the user's intensity setting.
 *   This ensures "35%" really means 35% visible — no hidden multiplier.
 *
 * Play-state architecture:
 *   isPlaying prop is forwarded to every sub-effect.
 *   Every animated element sets animation-play-state: running|paused.
 *   When master player is paused/scrubbing, all CSS animations freeze instantly.
 */
import type React from "react";

/* ─── Watermark asset (transparent PNG) ─────────────────────────────────── */
const WATERMARK_URL = `${import.meta.env.BASE_URL}bdv-watermark.png`;

/* ─── Music Video defaults — clearly visible, never 100% ────────────────── */
export const OVERLAY_DEFAULT_INTENSITY: Record<string, number> = {
  "Light Leaks":       35,
  "Lens Flare":        30,
  "Smoke":             28,
  "Rain":              35,
  "Sparks":            35,
  "Dust":              25,
  "Animated Waveform": 45,
  "Logo / Watermark":  65,
};

/* ─── Per-mode intensity presets ─────────────────────────────────────────── */
export const STRENGTH_PRESETS: Record<string, Record<string, number>> = {
  subtle: {
    "Light Leaks": 8, "Lens Flare": 8, "Smoke": 8,
    "Rain": 10, "Sparks": 6, "Dust": 6, "Animated Waveform": 20,
  },
  visible: {
    "Light Leaks": 25, "Lens Flare": 22, "Smoke": 20,
    "Rain": 25, "Sparks": 25, "Dust": 18, "Animated Waveform": 35,
  },
  "music-video": {
    "Light Leaks": 35, "Lens Flare": 30, "Smoke": 28,
    "Rain": 35, "Sparks": 35, "Dust": 25, "Animated Waveform": 45,
  },
  heavy: {
    "Light Leaks": 55, "Lens Flare": 45, "Smoke": 45,
    "Rain": 55, "Sparks": 55, "Dust": 40, "Animated Waveform": 65,
  },
};

/* ─── CSS keyframes — elements animate 1.0 → 0 so container opacity is sole scale ── */
const KEYFRAMES = `
@keyframes bdv-rain{
  0%  { transform:translateY(-15%) rotate(10deg); opacity:1   }
  100%{ transform:translateY(120%) rotate(10deg); opacity:0   }
}
@keyframes bdv-smoke{
  0%  { transform:translateY(0)     scale(1);   opacity:1   }
  55% { opacity:0.65 }
  100%{ transform:translateY(-90%)  scale(3.2); opacity:0   }
}
@keyframes bdv-spark{
  0%  { transform:translate(0,0) scale(1.4);               opacity:1   }
  70% { opacity:0.55 }
  100%{ transform:translate(var(--dx),var(--dy)) scale(0); opacity:0   }
}
@keyframes bdv-dust{
  0%  { transform:translate(0,0); opacity:0   }
  15% { opacity:1   }
  80% { opacity:0.6 }
  100%{ transform:translate(var(--dx),var(--dy)); opacity:0 }
}
@keyframes bdv-flare-pulse{
  0%,100%{ opacity:1;    transform:scale(1)    }
  45%    { opacity:0.75; transform:scale(1.08) }
  70%    { opacity:0.55; transform:scale(0.95) }
}
@keyframes bdv-flare-drift{
  0%,100%{ left:66% }
  50%    { left:74% }
}
@keyframes bdv-leak{
  0%  { opacity:0; transform:translateX(-80%) skewX(-10deg) }
  25% { opacity:1   }
  70% { opacity:0.75 }
  100%{ opacity:0; transform:translateX(100%) skewX(-10deg) }
}
@keyframes bdv-bar{
  0%,100%{ transform:scaleY(var(--h1)) }
  50%    { transform:scaleY(var(--h2)) }
}
`;

/* ─── Pseudo-random ──────────────────────────────────────────────────────── */
const dr = (s: number) => ((s * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff;

/* ─── Effective opacity for one effect ──────────────────────────────────── */
type IntensityMap = Record<string, number>;
const gi = (map: IntensityMap, name: string) =>
  Math.max(0.01, Math.min(1, (map[name] ?? OVERLAY_DEFAULT_INTENSITY[name] ?? 20) / 100));

/* ══════════════════ Rain ══════════════════════════════════════════════════ */
function RainEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  return (
    <div
      style={{ position: "absolute", inset: 0, opacity }}
      data-effect="rain"
    >
      {Array.from({ length: 44 }, (_, i) => {
        const thick = dr(i * 3 + 2) > 0.6;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${dr(i * 3) * 96}%`,
              top: `${-15 - dr(i * 3 + 1) * 10}%`,
              width: thick ? "1.8px" : "1.1px",
              height: `${55 + dr(i * 7) * 80}px`,
              background: `rgba(190,215,255,${0.7 + dr(i * 5) * 0.3})`,
              borderRadius: "2px",
              filter: "blur(0.4px)",
              animationName: "bdv-rain",
              animationDuration: `${0.22 + dr(i * 11) * 0.38}s`,
              animationDelay: `${-dr(i * 13) * 1.2}s`,
              animationTimingFunction: "linear",
              animationIterationCount: "infinite",
              animationPlayState: playState,
            }}
          />
        );
      })}
    </div>
  );
}

/* ══════════════════ Smoke ═════════════════════════════════════════════════ */
function SmokeEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  return (
    <div
      style={{ position: "absolute", inset: 0, opacity, mixBlendMode: "screen" as const }}
      data-effect="smoke"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${10 + dr(i * 7) * 70}%`,
            bottom: `${-8 + dr(i * 3) * 15}%`,
            width: `${80 + dr(i * 11) * 120}px`,
            height: `${80 + dr(i * 5) * 120}px`,
            background: `rgba(200,200,200,${0.55 + dr(i * 9) * 0.30})`,
            borderRadius: "50%",
            filter: `blur(${38 + dr(i * 13) * 45}px)`,
            animationName: "bdv-smoke",
            animationDuration: `${3.5 + dr(i * 7) * 5}s`,
            animationDelay: `${-dr(i * 17) * 5.5}s`,
            animationTimingFunction: "ease-out",
            animationIterationCount: "infinite",
            animationPlayState: playState,
          }}
        />
      ))}
    </div>
  );
}

/* ══════════════════ Sparks ════════════════════════════════════════════════ */
function SparksEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  const N = 28;
  return (
    <div
      style={{ position: "absolute", inset: 0, opacity }}
      data-effect="sparks"
    >
      {Array.from({ length: N }, (_, i) => {
        const angle = (i / N) * 2 * Math.PI + dr(i * 7) * 0.8 - Math.PI / 2;
        const dist  = 55 + dr(i * 13) * 110;
        const dx    = Math.round(Math.cos(angle) * dist);
        const dy    = Math.round(Math.sin(angle) * dist) - 30;
        const sz    = 2.5 + dr(i * 7) * 4.5;
        const r     = 210 + Math.round(dr(i * 9) * 45);
        const g     = 55  + Math.round(dr(i * 11) * 90);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `calc(${42 + dr(i * 5) * 16}% + ${Math.round((dr(i * 3) - 0.5) * 45)}px)`,
              bottom: `${3 + dr(i * 11) * 14}%`,
              width: `${sz}px`,
              height: `${sz}px`,
              background: `rgb(${r},${g},8)`,
              borderRadius: "50%",
              boxShadow: [
                `0 0 ${sz * 1.5}px ${sz * 0.4}px rgba(${r},${g},8,0.90)`,
                `0 0 ${sz * 3}px ${sz * 1.0}px rgba(255,100,10,0.55)`,
                `0 0 ${sz * 6}px ${sz * 1.5}px rgba(255,50,0,0.22)`,
              ].join(","),
              "--dx": `${dx}px`,
              "--dy": `${dy}px`,
              animationName: "bdv-spark",
              animationDuration: `${0.45 + dr(i * 17) * 1.0}s`,
              animationDelay: `${-dr(i * 19) * 2.2}s`,
              animationTimingFunction: "ease-out",
              animationIterationCount: "infinite",
              animationPlayState: playState,
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

/* ══════════════════ Dust ══════════════════════════════════════════════════ */
function DustEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  return (
    <div
      style={{ position: "absolute", inset: 0, opacity }}
      data-effect="dust"
    >
      {Array.from({ length: 40 }, (_, i) => {
        const dx = Math.round((dr(i * 3) - 0.5) * 70);
        const dy = Math.round((dr(i * 7) - 0.5) * 70);
        const sz = 1.2 + dr(i * 5) * 3.0;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${dr(i * 11) * 94}%`,
              top:  `${dr(i * 13) * 94}%`,
              width:  `${sz}px`,
              height: `${sz}px`,
              background: `rgba(220,205,168,${0.65 + dr(i * 17) * 0.35})`,
              borderRadius: "50%",
              boxShadow: `0 0 ${sz * 1.8}px rgba(220,200,150,0.50)`,
              "--dx": `${dx}px`,
              "--dy": `${dy}px`,
              animationName: "bdv-dust",
              animationDuration: `${4 + dr(i * 11) * 6}s`,
              animationDelay: `${-dr(i * 19) * 7}s`,
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
              animationPlayState: playState,
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

/* ══════════════════ Lens Flare ════════════════════════════════════════════ */
function LensFlareEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  const cy = "16%";
  const pulse: React.CSSProperties = {
    animationName: "bdv-flare-pulse",
    animationDuration: "2.8s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    animationPlayState: playState,
  };
  return (
    <div
      style={{ position: "absolute", inset: 0, opacity }}
      data-effect="lens-flare"
    >
      {/* Core glow */}
      <div style={{
        ...pulse,
        position: "absolute",
        top: cy,
        animationName: "bdv-flare-drift, bdv-flare-pulse",
        animationDuration: "11s, 2.8s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
        animationPlayState: playState,
        transform: "translateY(-50%)",
        width: "70px", height: "70px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,248,180,0.95) 0%, rgba(255,210,50,0.55) 35%, transparent 70%)",
        filter: "blur(1.5px)",
        boxShadow: "0 0 28px 8px rgba(255,225,80,0.42)",
      }} />
      {/* Horizontal streak */}
      <div style={{
        ...pulse,
        position: "absolute", top: cy, left: 0, right: 0,
        height: "2px",
        background: "linear-gradient(90deg,transparent 2%,rgba(255,230,120,0.22) 20%,rgba(255,248,188,0.65) 66%,rgba(255,230,120,0.22) 82%,transparent 97%)",
      }} />
      {/* Ring halo */}
      <div style={{
        ...pulse,
        position: "absolute", left: "68%", top: cy,
        transform: "translate(-50%,-50%)",
        width: "120px", height: "120px", borderRadius: "50%",
        border: "1px solid rgba(255,228,120,0.22)",
      }} />
      {/* Counter flare */}
      <div style={{
        ...pulse,
        position: "absolute", left: "24%", top: "78%",
        transform: "translate(-50%,-50%)",
        width: "18px", height: "18px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(100,200,255,0.70) 0%, transparent 70%)",
        filter: "blur(1px)",
      }} />
    </div>
  );
}

/* ══════════════════ Light Leaks ═══════════════════════════════════════════ */
function LightLeaksEffect({ opacity, protectCaptions, isPlaying }: { opacity: number; protectCaptions: boolean; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  const clipStyle: React.CSSProperties = protectCaptions
    ? { clipPath: "inset(0 0 22% 0)" }
    : {};
  return (
    <div
      style={{ position: "absolute", inset: 0, overflow: "hidden", opacity, mixBlendMode: "screen" as const }}
      data-effect="light-leaks"
    >
      {/* Primary warm sweep */}
      <div style={{
        ...clipStyle,
        position: "absolute",
        top: "-25%", left: "-35%",
        width: "60%", height: "155%",
        background: "linear-gradient(135deg,rgba(255,200,60,0.90) 0%,rgba(255,110,20,0.55) 32%,rgba(220,55,75,0.18) 60%,transparent 80%)",
        animationName: "bdv-leak",
        animationDuration: "4.8s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
        animationPlayState: playState,
      }} />
      {/* Secondary cool accent */}
      <div style={{
        ...clipStyle,
        position: "absolute",
        top: "-25%", left: "-35%",
        width: "48%", height: "155%",
        background: "linear-gradient(150deg,rgba(100,190,255,0.40) 0%,rgba(255,190,60,0.30) 40%,transparent 65%)",
        animationName: "bdv-leak",
        animationDuration: "6.0s",
        animationDelay: "-2.6s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
        animationPlayState: playState,
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
  isPlaying,
}: {
  opacity: number;
  position?: WavePosition;
  protectCaptions: boolean;
  isPlaying: boolean;
}) {
  const playState = isPlaying ? "running" : "paused";
  const effectivePos: WavePosition =
    protectCaptions && position === "bottom" ? "bottom-safe" : position;
  if (effectivePos === "hidden") return null;

  const N   = 34;
  const BAR = 6;
  const GAP = 3;
  const H   = 56;
  const W   = N * (BAR + GAP) - GAP;

  const posStyle: React.CSSProperties =
    effectivePos === "top"    ? { top: "4%",  bottom: "auto" } :
    effectivePos === "bottom" ? { bottom: "2%", top: "auto"  } :
                                { bottom: "22%", top: "auto" };

  return (
    <svg
      width={W} height={H}
      data-effect="waveform"
      style={{
        position: "absolute",
        left: "50%",
        ...posStyle,
        transform: "translateX(-50%)",
        opacity,
        overflow: "visible",
        filter: `drop-shadow(0 0 4px rgba(201,168,76,0.50))`,
      }}
    >
      {Array.from({ length: N }, (_, i) => {
        const h1 = (8 + dr(i * 7) * 42) / H;
        const h2 = (8 + dr(i * 11 + 3) * 42) / H;
        const alpha = 0.80 + dr(i * 5) * 0.20;
        const r = 201 + Math.round(dr(i * 3) * 20);
        const g = 148 + Math.round(dr(i * 7) * 30);
        return (
          <rect
            key={i}
            x={i * (BAR + GAP)} y={0} width={BAR} height={H} rx={2}
            fill={`rgba(${r},${g},40,${alpha})`}
            style={{
              transformBox: "fill-box", transformOrigin: "50% 100%",
              animationName: "bdv-bar",
              animationDuration: `${0.20 + dr(i * 13) * 0.50}s`,
              animationDelay: `${-dr(i * 17) * 0.55}s`,
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
              animationPlayState: playState,
              "--h1": String(h1), "--h2": String(h2),
            } as React.CSSProperties}
          />
        );
      })}
    </svg>
  );
}

/* ══════════════════ Logo / Watermark (transparent, no box) ════════════════ */
function WatermarkEffect({
  opacity,
  type = "logo",
  text = "Bow Down Visuals",
  position = "bottom-right",
  size = "medium",
  margin = 16,
  showOnPreview = true,
  logoUrl,
}: {
  opacity: number;
  type?: string;
  text?: string;
  position?: string;
  size?: string;
  margin?: number;
  showOnPreview?: boolean;
  logoUrl?: string;
}) {
  if (!showOnPreview || type === "none") return null;

  const isBottom = position.includes("bottom");
  const isRight  = position.includes("right");

  // Margin & watermark footprint scale with the player's rendered box (container-query
  // units) instead of fixed pixels, so the corner offset/size stays visually consistent
  // as the floating/resizable Master Player is resized — instead of drifting relative to
  // the frame. This mirrors export-video.ts's buildWmPos/wmW math, which sizes the
  // burned-in watermark as a % of the export resolution rather than a fixed pixel value.
  // Reference: margin (px) / 1000 == fraction of the shorter container dimension (cqmin).
  const marginPct = (margin / 1000) * 100;
  const marginCq = `clamp(4px, ${marginPct}cqmin, 64px)`;
  const posStyle: React.CSSProperties = {
    position: "absolute",
    ...(isBottom ? { bottom: marginCq } : { top: marginCq }),
    ...(isRight  ? { right:  marginCq } : { left:  marginCq }),
  };

  if (type === "logo") {
    // Same % of container width as export's wmW (small 10% / medium 15% / large 20% of
    // TARGET_W), with height auto so the logo's own aspect ratio matches export exactly
    // (export scales by width only: `scale=${wmW}:-2`).
    const wPct = size === "small" ? 10 : size === "large" ? 20 : 15;
    const wClampPx = size === "small" ? [18, 140] : size === "large" ? [30, 260] : [24, 200];
    return (
      <img
        data-testid="watermark-overlay"
        src={logoUrl || WATERMARK_URL}
        alt="Bow Down Visuals"
        draggable={false}
        style={{
          ...posStyle,
          width: `clamp(${wClampPx[0]}px, ${wPct}cqw, ${wClampPx[1]}px)`,
          height: "auto",
          opacity,
          display: "block",
          filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.72)) drop-shadow(0 0 2px rgba(0,0,0,0.50))",
        }}
      />
    );
  }

  const fontSize =
    size === "small" ? "clamp(7px,1.6cqw,10px)" :
    size === "large" ? "clamp(10px,2.6cqw,15px)" :
                       "clamp(8px,2.0cqw,12px)";
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
  isPlaying?: boolean;
  soloPreviewOverlay?: string | null;
  watermarkText?: string;
  watermarkType?: string;
  watermarkPosition?: string;
  watermarkSize?: string;
  watermarkMargin?: number;
  watermarkShowOnPreview?: boolean;
  /** When set, this branding-driven watermark config takes priority over the
   *  legacy watermarkText/Type/Position/Size/Margin props above (mirrors
   *  export-video.ts, where branding.watermark also overrides the legacy
   *  addWatermark path). */
  brandingWatermark?: {
    enabled: boolean;
    bdvWatermark: boolean;
    customLogoUrl: string | null;
    position: string;
    opacity: "low" | "medium" | "high";
    size: string;
  } | null;
  waveformPosition?: string;
  overlayQualityMode?: string;
  overlayProtectCaptions?: boolean;
}

const BRANDING_WM_OPACITY: Record<string, number> = { low: 0.30, medium: 0.60, high: 0.90 };

const VISUAL_EFFECTS = ["Rain", "Smoke", "Sparks", "Dust", "Light Leaks", "Lens Flare", "Animated Waveform"];

export function ActiveOverlayEffects({
  activeOverlays,
  intensity,
  testActive,
  isPlaying = true,
  soloPreviewOverlay = null,
  watermarkText = "Bow Down Visuals",
  watermarkType = "logo",
  watermarkPosition = "bottom-right",
  watermarkSize = "medium",
  watermarkMargin = 16,
  watermarkShowOnPreview = true,
  brandingWatermark = null,
  waveformPosition = "bottom-safe",
  overlayProtectCaptions = true,
}: ActiveOverlayEffectsProps) {
  // branding.watermark (the "Watermark & Logo" panel) is the source of truth when
  // enabled — same precedence as export-video.ts, which prefers branding.watermark
  // over the legacy addWatermark/watermarkType flow.
  const useBrandingWm = !!brandingWatermark?.enabled;
  const brandingWmLogoUrl = useBrandingWm
    ? (brandingWatermark!.customLogoUrl || (brandingWatermark!.bdvWatermark !== false ? undefined : ""))
    : undefined;
  const brandingWmSuppressed = useBrandingWm && brandingWmLogoUrl === "";

  /* If solo preview is active, show only that overlay + watermark */
  let show: string[];
  if (soloPreviewOverlay) {
    show = [soloPreviewOverlay];
    if (activeOverlays.includes("Logo / Watermark") || useBrandingWm) show.push("Logo / Watermark");
  } else if (testActive) {
    show = [...new Set([...activeOverlays, "Rain", "Sparks", "Lens Flare"])];
  } else {
    show = useBrandingWm && !activeOverlays.includes("Logo / Watermark")
      ? [...activeOverlays, "Logo / Watermark"]
      : activeOverlays;
  }

  if (brandingWmSuppressed) show = show.filter((s) => s !== "Logo / Watermark");

  if (show.length === 0) return null;

  const o = (name: string) => gi(intensity, name);

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 13 }}
      data-testid="active-overlay-effects"
    >
      <style>{KEYFRAMES}</style>

      {show.includes("Rain")              && <RainEffect        opacity={o("Rain")}        isPlaying={isPlaying} />}
      {show.includes("Smoke")             && <SmokeEffect       opacity={o("Smoke")}       isPlaying={isPlaying} />}
      {show.includes("Sparks")            && <SparksEffect      opacity={o("Sparks")}      isPlaying={isPlaying} />}
      {show.includes("Lens Flare")        && <LensFlareEffect   opacity={o("Lens Flare")}  isPlaying={isPlaying} />}
      {show.includes("Dust")              && <DustEffect        opacity={o("Dust")}        isPlaying={isPlaying} />}
      {show.includes("Light Leaks")       && <LightLeaksEffect  opacity={o("Light Leaks")} protectCaptions={overlayProtectCaptions} isPlaying={isPlaying} />}
      {show.includes("Animated Waveform") && (
        <WaveformEffect
          opacity={o("Animated Waveform")}
          position={(waveformPosition as WavePosition) || "bottom-safe"}
          protectCaptions={overlayProtectCaptions}
          isPlaying={isPlaying}
        />
      )}
      {show.includes("Logo / Watermark") && (
        <WatermarkEffect
          opacity={useBrandingWm ? BRANDING_WM_OPACITY[brandingWatermark!.opacity] ?? 0.60 : gi(intensity, "Logo / Watermark")}
          type="logo"
          text={watermarkText}
          position={useBrandingWm ? brandingWatermark!.position : watermarkPosition}
          size={useBrandingWm ? brandingWatermark!.size : watermarkSize}
          margin={watermarkMargin}
          showOnPreview={watermarkShowOnPreview}
          logoUrl={useBrandingWm ? brandingWmLogoUrl : undefined}
        />
      )}

      {soloPreviewOverlay && (
        <div style={{
          position: "absolute", top: "8%", left: "50%", transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.88)", color: "#C9A84C", fontWeight: 900,
          fontSize: "clamp(10px,2.2vw,16px)", padding: "0.3rem 1.2rem",
          borderRadius: "0.5rem", border: "1.5px solid #C9A84C", letterSpacing: "0.08em",
          whiteSpace: "nowrap", boxShadow: "0 0 22px rgba(201,168,76,0.45)", zIndex: 30,
        }}>
          SOLO: {soloPreviewOverlay}
        </div>
      )}

      {testActive && !soloPreviewOverlay && (
        <div style={{
          position: "absolute", top: "12%", left: "50%", transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.90)", color: "#C9A84C", fontWeight: 900,
          fontSize: "clamp(11px,2.5vw,19px)", padding: "0.38rem 1.4rem",
          borderRadius: "0.5rem", border: "2px solid #C9A84C", letterSpacing: "0.1em",
          whiteSpace: "nowrap", boxShadow: "0 0 30px rgba(201,168,76,0.55)", zIndex: 30,
        }}>
          OVERLAY TEST ACTIVE
        </div>
      )}
    </div>
  );
}
