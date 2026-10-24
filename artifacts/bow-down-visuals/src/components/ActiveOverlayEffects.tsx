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
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { getDefaultWatermarkUrl } from "@/lib/watermark";

/* ─── Watermark asset (theme-aware — use getDefaultWatermarkUrl(isLight)) ── */

/* ─── Music Video defaults — clearly visible, never 100% ────────────────── */
export const OVERLAY_DEFAULT_INTENSITY: Record<string, number> = {
  "Light Leaks":       35,
  "Lens Flare":        30,
  "Smoke":             18,
  "Rain":              35,
  "Sparks":            35,
  "Dust":              25,
  "Animated Waveform": 45,
  "Logo / Watermark":  30,
  "Snow":              30,
  "Confetti":          40,
  "Fireworks":         40,
  "God Rays":          30,
  "Anamorphic Flares": 30,
  "Bokeh":             30,
  "Scan Lines":        25,
  "Hologram":          35,
  "Kaleidoscope":      35,
  "Mirror":            30,
  "Neon Frame":        30,
  "VHS Tracking":      35,
  "Datamosh-lite":     35,
  "Tilt-Shift":        30,
};

/* ─── Per-mode intensity presets ─────────────────────────────────────────── */
export const STRENGTH_PRESETS: Record<string, Record<string, number>> = {
  subtle: {
    "Light Leaks": 8, "Lens Flare": 8, "Smoke": 8,
    "Rain": 10, "Sparks": 6, "Dust": 6, "Animated Waveform": 20,
    "Snow": 12, "Confetti": 14, "Fireworks": 12, "God Rays": 10,
    "Anamorphic Flares": 10, "Bokeh": 10, "Scan Lines": 10, "Hologram": 12,
    "Kaleidoscope": 12, "Mirror": 10, "Neon Frame": 10, "VHS Tracking": 12,
    "Datamosh-lite": 12, "Tilt-Shift": 10,
  },
  visible: {
    "Light Leaks": 25, "Lens Flare": 22, "Smoke": 20,
    "Rain": 25, "Sparks": 25, "Dust": 18, "Animated Waveform": 35,
    "Snow": 22, "Confetti": 28, "Fireworks": 28, "God Rays": 20,
    "Anamorphic Flares": 20, "Bokeh": 20, "Scan Lines": 16, "Hologram": 24,
    "Kaleidoscope": 24, "Mirror": 20, "Neon Frame": 20, "VHS Tracking": 24,
    "Datamosh-lite": 24, "Tilt-Shift": 20,
  },
  "music-video": {
    "Light Leaks": 35, "Lens Flare": 30, "Smoke": 28,
    "Rain": 35, "Sparks": 35, "Dust": 25, "Animated Waveform": 45,
    "Snow": 30, "Confetti": 40, "Fireworks": 40, "God Rays": 30,
    "Anamorphic Flares": 30, "Bokeh": 30, "Scan Lines": 25, "Hologram": 35,
    "Kaleidoscope": 35, "Mirror": 30, "Neon Frame": 30, "VHS Tracking": 35,
    "Datamosh-lite": 35, "Tilt-Shift": 30,
  },
  heavy: {
    "Light Leaks": 55, "Lens Flare": 45, "Smoke": 45,
    "Rain": 55, "Sparks": 55, "Dust": 40, "Animated Waveform": 65,
    "Snow": 50, "Confetti": 60, "Fireworks": 60, "God Rays": 50,
    "Anamorphic Flares": 48, "Bokeh": 48, "Scan Lines": 40, "Hologram": 55,
    "Kaleidoscope": 55, "Mirror": 48, "Neon Frame": 48, "VHS Tracking": 55,
    "Datamosh-lite": 55, "Tilt-Shift": 50,
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
@keyframes bdv-snow{
  0%  { transform:translate(0,-12%); opacity:1   }
  50% { transform:translate(var(--swx),52%) }
  100%{ transform:translate(0,115%);  opacity:0   }
}
@keyframes bdv-confetti{
  0%  { transform:translateY(-10%) rotate(0deg);   opacity:1 }
  100%{ transform:translateY(120%) rotate(560deg); opacity:0 }
}
@keyframes bdv-firework{
  0%  { transform:translate(0,0) scale(1.6);               opacity:1 }
  60% { opacity:0.7 }
  100%{ transform:translate(var(--dx),var(--dy)) scale(0.05); opacity:0 }
}
@keyframes bdv-rays{
  0%,100%{ transform:rotate(-9deg) scale(1.15); opacity:1   }
  50%    { transform:rotate(9deg)  scale(1.25);  opacity:0.72 }
}
@keyframes bdv-bokeh{
  0%  { transform:translateY(8%)  scale(1);    opacity:0 }
  20% { opacity:1 }
  85% { opacity:0.75 }
  100%{ transform:translateY(-95%) scale(1.35); opacity:0 }
}
@keyframes bdv-scan-drift{
  0%  { background-position-y:0px }
  100%{ background-position-y:8px }
}
@keyframes bdv-holo-flicker{
  0%,100%{ opacity:1    }
  8%     { opacity:0.55 }
  12%    { opacity:1    }
  46%    { opacity:0.70 }
  52%    { opacity:1    }
}
@keyframes bdv-holo-scan{
  0%  { top:-12%; opacity:1 }
  88% { opacity:1 }
  100%{ top:112%; opacity:0 }
}
@keyframes bdv-prism{
  0%  { transform:rotate(0deg)   scale(1.25); filter:hue-rotate(0deg)   }
  100%{ transform:rotate(360deg) scale(1.25); filter:hue-rotate(360deg) }
}
@keyframes bdv-neon-pulse{
  0%,100%{ opacity:1    }
  50%    { opacity:0.55 }
}
@keyframes bdv-tracking{
  0%  { top:-14%; opacity:1 }
  88% { opacity:1 }
  100%{ top:112%; opacity:0 }
}
@keyframes bdv-datamosh{
  0%,100%{ transform:translateX(0) }
  25%    { transform:translateX(var(--jx)) }
  50%    { transform:translateX(calc(var(--jx) * -1)) }
  75%    { transform:translateX(var(--jx)) }
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
            // Warm, soft, low-alpha wisps — atmosphere, not gray smudges.
            background: `rgba(216,205,190,${0.32 + dr(i * 9) * 0.22})`,
            borderRadius: "50%",
            filter: `blur(${52 + dr(i * 13) * 55}px)`,
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

/* ══════════════════ Snow ══════════════════════════════════════════════════ */
function SnowEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  const N = 60;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }} data-effect="snow">
      {Array.from({ length: N }, (_, i) => {
        const sz = 2 + dr(i * 3) * 4.5;
        const swx = Math.round((dr(i * 7) - 0.5) * 90);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${dr(i * 5) * 98}%`,
              top: "-6%",
              width: `${sz}px`,
              height: `${sz}px`,
              background: `rgba(${225 + Math.round(dr(i * 11) * 30)},${235 + Math.round(dr(i * 13) * 20)},255,${0.55 + dr(i * 17) * 0.45})`,
              borderRadius: "50%",
              filter: "blur(0.6px)",
              "--swx": `${swx}px`,
              animationName: "bdv-snow",
              animationDuration: `${3 + dr(i * 19) * 5.5}s`,
              animationDelay: `${-dr(i * 23) * 8}s`,
              animationTimingFunction: "linear",
              animationIterationCount: "infinite",
              animationPlayState: playState,
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

/* ══════════════════ Confetti ══════════════════════════════════════════════ */
function ConfettiEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  const palette = ["#C9A84C", "#FF5DA2", "#4FD8FF", "#7CFF6B", "#FF8A3D", "#FFFFFF"];
  return (
    <div style={{ position: "absolute", inset: 0, opacity }} data-effect="confetti">
      {Array.from({ length: 46 }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${dr(i * 5) * 96}%`,
            top: "-8%",
            width: `${5 + dr(i * 3) * 5}px`,
            height: `${8 + dr(i * 7) * 7}px`,
            background: palette[i % palette.length],
            borderRadius: "1px",
            animationName: "bdv-confetti",
            animationDuration: `${2.2 + dr(i * 11) * 2.4}s`,
            animationDelay: `${-dr(i * 13) * 4.6}s`,
            animationTimingFunction: "linear",
            animationIterationCount: "infinite",
            animationPlayState: playState,
          }}
        />
      ))}
    </div>
  );
}

/* ══════════════════ Fireworks ═════════════════════════════════════════════ */
function FireworksEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  const bursts = [
    { x: 18, y: 24, r: 255, g: 196, b: 70 },
    { x: 62, y: 16, r: 120, g: 220, b: 255 },
    { x: 42, y: 32, r: 255, g: 110, b: 160 },
    { x: 80, y: 32, r: 190, g: 255, b: 150 },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, opacity }} data-effect="fireworks">
      {bursts.map((b, bi) => (
        <div key={bi} style={{ position: "absolute", left: `${b.x}%`, top: `${b.y}%` }}>
          {/* Launch flash */}
          <div style={{
            position: "absolute", left: "-14px", top: "-14px", width: "28px", height: "28px",
            borderRadius: "50%",
            background: `radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(${b.r},${b.g},${b.b},0.55) 45%, transparent 70%)`,
            filter: "blur(1px)",
            animationName: "bdv-flare-pulse",
            animationDuration: "1.5s",
            animationDelay: `${-bi * 0.38}s`,
            animationTimingFunction: "ease-in-out",
            animationIterationCount: "infinite",
            animationPlayState: playState,
          }} />
          {Array.from({ length: 18 }, (_, i) => {
            const idx = bi * 31 + i;
            const angle = (i / 18) * 2 * Math.PI + dr(idx * 3) * 0.6;
            const dist = 45 + dr(idx * 7) * 110;
            const sz = 2 + dr(idx * 11) * 3.5;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: "-3px", top: "-3px",
                  width: `${sz}px`, height: `${sz}px`,
                  borderRadius: "50%",
                  background: `rgb(${b.r},${b.g},${b.b})`,
                  boxShadow: `0 0 ${sz * 2.5}px ${sz * 0.8}px rgba(${b.r},${b.g},${b.b},0.8)`,
                  "--dx": `${Math.round(Math.cos(angle) * dist)}px`,
                  "--dy": `${Math.round(Math.sin(angle) * dist)}px`,
                  animationName: "bdv-firework",
                  animationDuration: `${1.0 + dr(idx * 13) * 0.9}s`,
                  animationDelay: `${-bi * 0.55 - dr(idx * 17) * 1.4}s`,
                  animationTimingFunction: "ease-out",
                  animationIterationCount: "infinite",
                  animationPlayState: playState,
                } as React.CSSProperties}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ══════════════════ God Rays ══════════════════════════════════════════════ */
function GodRaysEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  return (
    <div style={{ position: "absolute", inset: 0, opacity, mixBlendMode: "screen" as const, overflow: "hidden" }} data-effect="god-rays">
      <div style={{
        position: "absolute", inset: "-25%",
        transformOrigin: "50% 0%",
        background: "repeating-conic-gradient(from 0deg at 50% 0%, rgba(255,228,150,0.14) 0deg 5deg, transparent 5deg 11deg)",
        animationName: "bdv-rays",
        animationDuration: "14s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
        animationPlayState: playState,
      }} />
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 90% 55% at 50% 0%, rgba(255,225,140,0.28), transparent 70%)",
      }} />
    </div>
  );
}

/* ══════════════════ Anamorphic Flares ═════════════════════════════════════ */
function AnamorphicFlaresEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  const pulse = {
    animationName: "bdv-flare-pulse",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    animationPlayState: playState,
  } as React.CSSProperties;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }} data-effect="anamorphic-flares">
      {/* Blue streak */}
      <div style={{
        ...pulse,
        position: "absolute", top: "26%", left: "4%", right: "4%", height: "3px",
        background: "linear-gradient(90deg, transparent, rgba(120,190,255,0.75) 25%, rgba(200,240,255,0.95) 50%, rgba(120,190,255,0.75) 75%, transparent)",
        filter: "blur(1px)",
        boxShadow: "0 0 18px 3px rgba(120,190,255,0.35)",
        animationDuration: "3.2s",
      }} />
      <div style={{
        position: "absolute", top: "26%", left: "64%", width: "10px", height: "10px",
        transform: "translate(-50%,-50%)", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(220,245,255,1) 0%, rgba(120,190,255,0.6) 60%, transparent 70%)",
      }} />
      {/* Warm streak */}
      <div style={{
        ...pulse,
        position: "absolute", top: "58%", left: "8%", right: "8%", height: "2px",
        background: "linear-gradient(90deg, transparent, rgba(255,190,120,0.60) 30%, rgba(255,240,200,0.85) 52%, rgba(255,190,120,0.60) 72%, transparent)",
        filter: "blur(1px)",
        boxShadow: "0 0 14px 2px rgba(255,190,120,0.30)",
        animationDuration: "4.1s",
        animationDelay: "-1.7s",
      }} />
    </div>
  );
}

/* ══════════════════ Bokeh ═════════════════════════════════════════════════ */
function BokehEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  const colors = ["255,210,130", "255,150,180", "150,210,255", "255,255,255", "200,160,255"];
  return (
    <div style={{ position: "absolute", inset: 0, opacity, mixBlendMode: "screen" as const }} data-effect="bokeh">
      {Array.from({ length: 26 }, (_, i) => {
        const c = colors[i % colors.length];
        const sz = 14 + dr(i * 3) * 46;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${dr(i * 5) * 94}%`,
              top: `${dr(i * 7) * 95}%`,
              width: `${sz}px`,
              height: `${sz}px`,
              borderRadius: "50%",
              background: `rgba(${c},0.50)`,
              filter: "blur(7px)",
              boxShadow: `0 0 ${sz * 0.8}px rgba(${c},0.35)`,
              animationName: "bdv-bokeh",
              animationDuration: `${6 + dr(i * 11) * 8}s`,
              animationDelay: `${-dr(i * 13) * 12}s`,
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
              animationPlayState: playState,
            }}
          />
        );
      })}
    </div>
  );
}

/* ══════════════════ Scan Lines ════════════════════════════════════════════ */
function ScanLinesEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  return (
    <div
      style={{
        position: "absolute", inset: 0, opacity,
        background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.32) 0px, rgba(0,0,0,0.32) 1px, transparent 1px, transparent 4px)",
        animationName: "bdv-scan-drift",
        animationDuration: "0.9s",
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
        animationPlayState: playState,
      }}
      data-effect="scan-lines"
    />
  );
}

/* ══════════════════ Hologram ══════════════════════════════════════════════ */
function HologramEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  const infinite = { animationTimingFunction: "linear", animationIterationCount: "infinite", animationPlayState: playState } as React.CSSProperties;
  return (
    <div style={{ position: "absolute", inset: 0, opacity, mixBlendMode: "screen" as const, overflow: "hidden" }} data-effect="hologram">
      <div style={{
        position: "absolute", inset: 0,
        background: "rgba(90,220,255,0.10)",
        animationName: "bdv-holo-flicker",
        animationDuration: "2.4s",
        ...infinite,
      }} />
      <div style={{
        position: "absolute", inset: 0,
        background: "repeating-linear-gradient(0deg, rgba(140,240,255,0.16) 0 1px, transparent 1px 3px)",
      }} />
      <div style={{
        position: "absolute", left: 0, right: 0, height: "10%", top: "-12%",
        background: "linear-gradient(180deg, transparent, rgba(160,245,255,0.35), transparent)",
        animationName: "bdv-holo-scan",
        animationDuration: "3.4s",
        ...infinite,
      }} />
    </div>
  );
}

/* ══════════════════ Kaleidoscope ══════════════════════════════════════════ */
function KaleidoscopeEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  return (
    <div style={{ position: "absolute", inset: 0, opacity, mixBlendMode: "screen" as const, overflow: "hidden" }} data-effect="kaleidoscope">
      <div style={{
        position: "absolute", inset: "-30%",
        background: "repeating-conic-gradient(from 0deg at 50% 50%, rgba(255,90,160,0.10) 0deg 10deg, rgba(255,220,90,0.10) 10deg 20deg, rgba(90,220,255,0.10) 20deg 30deg, rgba(150,110,255,0.10) 30deg 40deg)",
        animationName: "bdv-prism",
        animationDuration: "26s",
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
        animationPlayState: playState,
      }} />
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(circle at 50% 50%, transparent 30%, rgba(255,255,255,0.06) 70%, transparent 100%)",
      }} />
    </div>
  );
}

/* ══════════════════ Mirror ════════════════════════════════════════════════ */
function MirrorEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  return (
    <div style={{ position: "absolute", inset: 0, opacity, overflow: "hidden" }} data-effect="mirror">
      {/* Center mirror glint */}
      <div style={{
        position: "absolute", top: 0, bottom: 0, left: "50%", width: "2px",
        transform: "translateX(-50%)",
        background: "linear-gradient(180deg, transparent, rgba(255,244,200,0.85) 30%, rgba(255,244,200,0.85) 70%, transparent)",
        boxShadow: "0 0 14px 2px rgba(255,230,150,0.45)",
      }} />
      {/* Sweeping sheen */}
      <div style={{
        position: "absolute", top: "-25%", left: "-35%", width: "34%", height: "155%",
        background: "linear-gradient(135deg, transparent, rgba(255,255,255,0.20) 45%, rgba(255,255,255,0.35) 55%, transparent)",
        mixBlendMode: "screen" as const,
        animationName: "bdv-leak",
        animationDuration: "5.4s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
        animationPlayState: playState,
      }} />
    </div>
  );
}

/* ══════════════════ Neon Frame (overlay) ══════════════════════════════════ */
/* Named "Neon Frame" (not "Neon Glow") to avoid colliding with the "Neon Glow"
 * filter effect — overlay + effect share the overlayIntensity key space. */
function NeonFrameEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  const pulse = {
    animationName: "bdv-neon-pulse",
    animationDuration: "2.2s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    animationPlayState: playState,
  } as React.CSSProperties;
  const magenta = "#FF4FD8";
  const cyan = "#3DE8FF";
  const h: React.CSSProperties = { position: "absolute", left: "1.5%", right: "1.5%", height: "5px", borderRadius: "3px" };
  const v: React.CSSProperties = { position: "absolute", top: "3%", bottom: "3%", width: "5px", borderRadius: "3px" };
  return (
    <div style={{ position: "absolute", inset: 0, opacity }} data-effect="neon-frame">
      <div style={{ ...h, ...pulse, top: "2%", background: `linear-gradient(90deg, ${magenta}, ${cyan})`, boxShadow: "0 0 16px 3px rgba(255,79,216,0.55)" }} />
      <div style={{ ...h, ...pulse, bottom: "2%", animationDelay: "-1.1s", background: `linear-gradient(90deg, ${cyan}, ${magenta})`, boxShadow: "0 0 16px 3px rgba(61,232,255,0.55)" }} />
      <div style={{ ...v, ...pulse, left: "1%", animationDelay: "-0.55s", background: `linear-gradient(180deg, ${magenta}, ${cyan})`, boxShadow: "0 0 16px 3px rgba(255,79,216,0.45)" }} />
      <div style={{ ...v, ...pulse, right: "1%", animationDelay: "-1.65s", background: `linear-gradient(180deg, ${cyan}, ${magenta})`, boxShadow: "0 0 16px 3px rgba(61,232,255,0.45)" }} />
    </div>
  );
}

/* ══════════════════ VHS Tracking ══════════════════════════════════════════ */
function VhsTrackingEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  return (
    <div style={{ position: "absolute", inset: 0, opacity, overflow: "hidden" }} data-effect="vhs-tracking">
      <div style={{
        position: "absolute", left: 0, right: 0, height: "9%", top: "-14%",
        background: "linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.12) 55%, rgba(120,200,255,0.30))",
        filter: "blur(2px)",
        boxShadow: "0 4px 18px rgba(150,220,255,0.35)",
        animationName: "bdv-tracking",
        animationDuration: "2.3s",
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
        animationPlayState: playState,
      }} />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} style={{
          position: "absolute", left: 0, right: 0, height: "2px",
          top: `${12 + dr(i * 7) * 70}%`,
          background: "rgba(255,255,255,0.35)",
          filter: "blur(0.5px)",
          animationName: "bdv-holo-flicker",
          animationDuration: `${0.4 + dr(i * 3) * 0.5}s`,
          animationTimingFunction: "linear",
          animationIterationCount: "infinite",
          animationPlayState: playState,
        }} />
      ))}
    </div>
  );
}

/* ══════════════════ Datamosh-lite ═════════════════════════════════════════ */
function DatamoshEffect({ opacity, isPlaying }: { opacity: number; isPlaying: boolean }) {
  const playState = isPlaying ? "running" : "paused";
  return (
    <div style={{ position: "absolute", inset: 0, opacity, overflow: "hidden", mixBlendMode: "screen" as const }} data-effect="datamosh">
      {Array.from({ length: 6 }, (_, i) => {
        const c = i % 2 === 0 ? "255,70,90" : "70,220,255";
        return (
          <div
            key={i}
            style={{
              position: "absolute", left: "-6%", right: "-6%",
              top: `${dr(i * 7) * 88}%`,
              height: `${12 + dr(i * 11) * 30}px`,
              background: `linear-gradient(90deg, rgba(${c},0.28), rgba(255,255,255,0.10) 50%, rgba(${c},0.28))`,
              "--jx": `${Math.round(12 + dr(i * 13) * 34)}px`,
              animationName: "bdv-datamosh",
              animationDuration: `${0.8 + dr(i * 5) * 0.9}s`,
              animationTimingFunction: "steps(4, end)",
              animationIterationCount: "infinite",
              animationPlayState: playState,
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

/* ══════════════════ Tilt-Shift ════════════════════════════════════════════ */
function TiltShiftEffect({ opacity }: { opacity: number; isPlaying: boolean }) {
  const band = (pos: "top" | "bottom"): React.CSSProperties => ({
    position: "absolute", left: 0, right: 0, height: "24%",
    ...(pos === "top" ? { top: 0 } : { bottom: 0 }),
    backdropFilter: "blur(5px) brightness(1.06) saturate(0.85)",
    WebkitBackdropFilter: "blur(5px) brightness(1.06) saturate(0.85)",
    maskImage: pos === "top"
      ? "linear-gradient(180deg, black 0%, black 55%, transparent 100%)"
      : "linear-gradient(0deg, black 0%, black 55%, transparent 100%)",
    WebkitMaskImage: pos === "top"
      ? "linear-gradient(180deg, black 0%, black 55%, transparent 100%)"
      : "linear-gradient(0deg, black 0%, black 55%, transparent 100%)",
  });
  return (
    <div style={{ position: "absolute", inset: 0, opacity }} data-effect="tilt-shift">
      <div style={band("top")} />
      <div style={band("bottom")} />
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
  const isLight = useIsLightTheme();
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
        src={logoUrl || getDefaultWatermarkUrl(isLight)}
        alt="Bow Down Visuals"
        draggable={false}
        style={{
          ...posStyle,
          width: `clamp(${wClampPx[0]}px, ${wPct}cqw, ${wClampPx[1]}px)`,
          height: "auto",
          opacity,
          display: "block",
          filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.45))",
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
  /** "Protect face / center" (Effects tab): when true, the visual overlay
   *  effects are masked out of a soft-edged ellipse at the upper-center of
   *  the frame — where a performer's face normally sits — so overlays never
   *  cover the subject. The watermark is not an overlay effect and is not
   *  masked. Opt-in per mount: only the editor preview passes it (from
   *  settings.overlayProtectFace). */
  overlayProtectFace?: boolean;
}

/* Soft center hole punched through the overlay stack when face protection
 * is on: transparent inside the ellipse, fully opaque outside it. */
const FACE_PROTECT_MASK =
  "radial-gradient(ellipse 36% 32% at 50% 40%, transparent 0%, transparent 58%, black 82%)";

const BRANDING_WM_OPACITY: Record<string, number> = { low: 0.30, medium: 0.60, high: 0.90 };

/* Names of overlays that are true animated visuals (vs. watermark branding).
 * Exported so the Effects tab's strength presets + debug panel stay in sync. */
export const VISUAL_EFFECTS = ["Rain", "Smoke", "Sparks", "Dust", "Light Leaks", "Lens Flare", "Animated Waveform", "Snow", "Confetti", "Fireworks", "God Rays", "Anamorphic Flares", "Bokeh", "Scan Lines", "Hologram", "Kaleidoscope", "Mirror", "Neon Frame", "VHS Tracking", "Datamosh-lite", "Tilt-Shift"];

export function ActiveOverlayEffects({
  activeOverlays,
  intensity,
  testActive,
  isPlaying = true,
  soloPreviewOverlay = null,
  watermarkText = "Bow Down Visuals",
  watermarkType = "logo",
  watermarkPosition = "bottom-right",
  watermarkSize = "small",
  watermarkMargin = 16,
  watermarkShowOnPreview = true,
  brandingWatermark = null,
  waveformPosition = "bottom-safe",
  overlayProtectCaptions = true,
  overlayProtectFace = false,
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

      {/* Visual effects stack — face/center protection masks this whole
          layer (never the watermark below) out of the subject's area. */}
      <div
        style={{
          position: "absolute", inset: 0,
          ...(overlayProtectFace
            ? { maskImage: FACE_PROTECT_MASK, WebkitMaskImage: FACE_PROTECT_MASK }
            : {}),
        }}
        data-face-protect={overlayProtectFace ? "on" : "off"}
      >
      {show.includes("Rain")              && <RainEffect        opacity={o("Rain")}        isPlaying={isPlaying} />}
      {show.includes("Smoke")             && <SmokeEffect       opacity={o("Smoke")}       isPlaying={isPlaying} />}
      {show.includes("Sparks")            && <SparksEffect      opacity={o("Sparks")}      isPlaying={isPlaying} />}
      {show.includes("Lens Flare")        && <LensFlareEffect   opacity={o("Lens Flare")}  isPlaying={isPlaying} />}
      {show.includes("Dust")              && <DustEffect        opacity={o("Dust")}        isPlaying={isPlaying} />}
      {show.includes("Snow")              && <SnowEffect        opacity={o("Snow")}        isPlaying={isPlaying} />}
      {show.includes("Confetti")          && <ConfettiEffect    opacity={o("Confetti")}    isPlaying={isPlaying} />}
      {show.includes("Fireworks")         && <FireworksEffect   opacity={o("Fireworks")}   isPlaying={isPlaying} />}
      {show.includes("God Rays")          && <GodRaysEffect     opacity={o("God Rays")}    isPlaying={isPlaying} />}
      {show.includes("Anamorphic Flares") && <AnamorphicFlaresEffect opacity={o("Anamorphic Flares")} isPlaying={isPlaying} />}
      {show.includes("Bokeh")             && <BokehEffect       opacity={o("Bokeh")}       isPlaying={isPlaying} />}
      {show.includes("Scan Lines")        && <ScanLinesEffect   opacity={o("Scan Lines")} isPlaying={isPlaying} />}
      {show.includes("Hologram")          && <HologramEffect    opacity={o("Hologram")}    isPlaying={isPlaying} />}
      {show.includes("Kaleidoscope")      && <KaleidoscopeEffect opacity={o("Kaleidoscope")} isPlaying={isPlaying} />}
      {show.includes("Mirror")            && <MirrorEffect      opacity={o("Mirror")}      isPlaying={isPlaying} />}
      {show.includes("Neon Frame")        && <NeonFrameEffect   opacity={o("Neon Frame")}  isPlaying={isPlaying} />}
      {show.includes("VHS Tracking")      && <VhsTrackingEffect opacity={o("VHS Tracking")} isPlaying={isPlaying} />}
      {show.includes("Datamosh-lite")     && <DatamoshEffect    opacity={o("Datamosh-lite")} isPlaying={isPlaying} />}
      {show.includes("Tilt-Shift")        && <TiltShiftEffect   opacity={o("Tilt-Shift")}  isPlaying={isPlaying} />}
      {show.includes("Light Leaks")       && <LightLeaksEffect  opacity={o("Light Leaks")} protectCaptions={overlayProtectCaptions} isPlaying={isPlaying} />}
      {show.includes("Animated Waveform") && (
        <WaveformEffect
          opacity={o("Animated Waveform")}
          position={(waveformPosition as WavePosition) || "bottom-safe"}
          protectCaptions={overlayProtectCaptions}
          isPlaying={isPlaying}
        />
      )}
      </div>
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
