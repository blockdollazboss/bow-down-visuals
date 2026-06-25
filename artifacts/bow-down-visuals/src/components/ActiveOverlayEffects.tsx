/**
 * ActiveOverlayEffects — premium animated CSS/SVG overlays driven by
 * settings.overlays chip selections.  Each effect accepts an intensity
 * 0-100 (missing = 100) that uniformly scales opacity / density.
 *
 * Visual design goals: cinematic, music-video quality.  Not flat buttons.
 */
import type React from "react";

/* ─── CSS keyframes (one <style> block, deduped by React) ─────────────────── */
const KEYFRAMES = `
@keyframes bdv-rain{
  0%  { transform:translateY(-10%) rotate(15deg);opacity:.8 }
  100%{ transform:translateY(118%) rotate(15deg);opacity:.1 }
}
@keyframes bdv-smoke{
  0%  { transform:translateY(0)    scale(1);   opacity:.55 }
  60% { opacity:.22 }
  100%{ transform:translateY(-130%) scale(3.4); opacity:0  }
}
@keyframes bdv-spark{
  0%  { transform:translate(0,0)               scale(1.6); opacity:1   }
  60% { opacity:.7 }
  100%{ transform:translate(var(--dx),var(--dy)) scale(.05); opacity:0  }
}
@keyframes bdv-dust{
  0%  { transform:translate(0,0); opacity:0   }
  14% { opacity:.8 }
  84% { opacity:.4 }
  100%{ transform:translate(var(--dx),var(--dy)); opacity:0 }
}
@keyframes bdv-flare-pulse{
  0%,100%{ opacity:.88; transform:scale(1)    }
  40%    { opacity:1;   transform:scale(1.09) }
  70%    { opacity:.68; transform:scale(.93)  }
}
@keyframes bdv-flare-drift{
  0%,100%{ left:68% }
  50%    { left:74% }
}
@keyframes bdv-leak{
  0%  { opacity:0; transform:translateX(-72%) skewX(-12deg) }
  22% { opacity:.85 }
  72% { opacity:.55 }
  100%{ opacity:0; transform:translateX(92%)  skewX(-12deg) }
}
@keyframes bdv-bar{
  0%,100%{ transform:scaleY(var(--h1)) }
  50%    { transform:scaleY(var(--h2)) }
}
`;

/* ─── Deterministic pseudo-random — same positions every render ─────────── */
const dr = (s: number) => ((s * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff;

/* ─── Intensity helper ──────────────────────────────────────────────────── */
type IntensityMap = Record<string, number>;
const gi = (map: IntensityMap, name: string) =>
  Math.max(0.05, Math.min(1, (map[name] ?? 100) / 100));

/* ══════════════════════════════════════ Rain ════════════════════════════════ */
function RainEffect({ opacity }: { opacity: number }) {
  const N = 26;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {Array.from({ length: N }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${dr(i * 3) * 95 + 0.5}%`,
            top: `${-10 - dr(i * 3 + 1) * 8}%`,
            width: dr(i * 3 + 2) > 0.6 ? "1.5px" : "1px",
            height: `${55 + dr(i * 7) * 58}px`,
            background: `rgba(200,230,255,${0.45 + dr(i * 5) * 0.4})`,
            borderRadius: "1px",
            filter: "blur(0.4px)",
            boxShadow: `0 0 3px rgba(180,220,255,0.65), 0 0 7px rgba(140,200,255,0.3)`,
            animationName: "bdv-rain",
            animationDuration: `${0.32 + dr(i * 11) * 0.48}s`,
            animationDelay: `${-dr(i * 13) * 1.6}s`,
            animationTimingFunction: "linear",
            animationIterationCount: "infinite",
          }}
        />
      ))}
    </div>
  );
}

/* ══════════════════════════════════════ Smoke ═══════════════════════════════ */
function SmokeEffect({ opacity }: { opacity: number }) {
  const N = 7;
  return (
    <div style={{ position: "absolute", inset: 0, opacity, mixBlendMode: "screen" as const }}>
      {Array.from({ length: N }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${16 + dr(i * 7) * 68}%`,
            bottom: `${-8 + dr(i * 3) * 14}%`,
            width: `${70 + dr(i * 11) * 90}px`,
            height: `${70 + dr(i * 5) * 90}px`,
            background: `rgba(210,210,210,0.20)`,
            borderRadius: "50%",
            filter: `blur(${22 + dr(i * 13) * 28}px)`,
            animationName: "bdv-smoke",
            animationDuration: `${3.0 + dr(i * 7) * 3.2}s`,
            animationDelay: `${-dr(i * 17) * 4.5}s`,
            animationTimingFunction: "ease-out",
            animationIterationCount: "infinite",
          }}
        />
      ))}
    </div>
  );
}

/* ══════════════════════════════════════ Sparks ══════════════════════════════ */
function SparksEffect({ opacity }: { opacity: number }) {
  const N = 22;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {Array.from({ length: N }, (_, i) => {
        const angle = (i / N) * 2 * Math.PI + dr(i * 7) * 0.6 - Math.PI / 2;
        const dist  = 65 + dr(i * 13) * 120;
        const dx    = Math.round(Math.cos(angle) * dist);
        const dy    = Math.round(Math.sin(angle) * dist) - 35;
        const sz    = 2.5 + dr(i * 7) * 4.5;
        const r     = 220 + Math.round(dr(i * 9) * 35);
        const g     = 80  + Math.round(dr(i * 11) * 110);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `calc(${43 + dr(i * 5) * 14}% + ${Math.round((dr(i * 3) - 0.5) * 40)}px)`,
              bottom: `${5 + dr(i * 11) * 16}%`,
              width:  `${sz}px`,
              height: `${sz}px`,
              background: `rgba(${r},${g},15,1)`,
              borderRadius: "50%",
              boxShadow: [
                `0 0 ${sz * 1.8}px rgba(${r},${g},15,0.9)`,
                `0 0 ${sz * 4}px rgba(255,130,10,0.65)`,
                `0 0 ${sz * 8}px rgba(255,80,0,0.35)`,
              ].join(", "),
              "--dx": `${dx}px`,
              "--dy": `${dy}px`,
              animationName: "bdv-spark",
              animationDuration: `${0.42 + dr(i * 17) * 0.92}s`,
              animationDelay: `${-dr(i * 19) * 2.0}s`,
              animationTimingFunction: "ease-out",
              animationIterationCount: "infinite",
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════ Dust ════════════════════════════════ */
function DustEffect({ opacity }: { opacity: number }) {
  const N = 28;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {Array.from({ length: N }, (_, i) => {
        const dx = Math.round((dr(i * 3) - 0.5) * 75);
        const dy = Math.round((dr(i * 7) - 0.5) * 75);
        const sz = 1.2 + dr(i * 5) * 3.2;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${dr(i * 11) * 94}%`,
              top:  `${dr(i * 13) * 94}%`,
              width:  `${sz}px`,
              height: `${sz}px`,
              background: `rgba(218,200,162,${0.5 + dr(i * 17) * 0.45})`,
              borderRadius: "50%",
              boxShadow: `0 0 ${sz * 2}px rgba(218,200,162,0.4)`,
              "--dx": `${dx}px`,
              "--dy": `${dy}px`,
              animationName: "bdv-dust",
              animationDuration: `${3.5 + dr(i * 11) * 5}s`,
              animationDelay: `${-dr(i * 19) * 5.5}s`,
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════ Lens Flare ══════════════════════════ */
function LensFlareEffect({ opacity }: { opacity: number }) {
  /* top = fixed; left animated via bdv-flare-drift */
  const cy = "21%";
  const pulse: React.CSSProperties = {
    animationName: "bdv-flare-pulse",
    animationDuration: "2.6s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  };
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {/* Main glow — drifts horizontally */}
      <div
        style={{
          ...pulse,
          position: "absolute",
          top: cy,
          animationName: "bdv-flare-drift, bdv-flare-pulse",
          animationDuration: "12s, 2.6s",
          animationTimingFunction: "ease-in-out",
          animationIterationCount: "infinite",
          transform: "translateY(-50%)",
          width: "88px", height: "88px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,248,188,1) 0%, rgba(255,210,65,0.55) 36%, transparent 72%)",
          filter: "blur(2px)",
          boxShadow: "0 0 55px 22px rgba(255,225,90,0.45)",
        }}
      />
      {/* Ring 1 */}
      <div style={{
        ...pulse,
        position: "absolute", left: "68%", top: cy,
        transform: "translate(-50%,-50%)",
        width: "155px", height: "155px", borderRadius: "50%",
        border: "1.5px solid rgba(255,228,120,0.30)",
        boxShadow: "0 0 18px rgba(255,210,60,0.12)",
      }} />
      {/* Ring 2 */}
      <div style={{
        ...pulse,
        position: "absolute", left: "68%", top: cy,
        transform: "translate(-50%,-50%)",
        width: "230px", height: "230px", borderRadius: "50%",
        border: "1px solid rgba(255,225,120,0.14)",
      }} />
      {/* Horizontal streak */}
      <div style={{
        ...pulse,
        position: "absolute", top: cy, left: 0, right: 0,
        height: "1px",
        background: "linear-gradient(90deg,transparent 3%,rgba(255,225,120,0.22) 25%,rgba(255,248,188,0.75) 68%,rgba(255,225,120,0.22) 84%,transparent 97%)",
      }} />
      {/* Secondary dot — opposing corner */}
      <div style={{
        ...pulse,
        position: "absolute", left: "28%", top: "79%",
        transform: "translate(-50%,-50%)",
        width: "22px", height: "22px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(100,200,255,0.7) 0%, transparent 72%)",
        filter: "blur(1px)",
      }} />
    </div>
  );
}

/* ══════════════════════════════════════ Light Leaks ═════════════════════════ */
function LightLeaksEffect({ opacity }: { opacity: number }) {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity, mixBlendMode: "screen" as const }}>
      {/* Primary warm sweep */}
      <div style={{
        position: "absolute",
        top: "-20%", left: "-30%",
        width: "65%", height: "148%",
        background: "linear-gradient(132deg,rgba(255,195,55,.85) 0%,rgba(255,105,18,.65) 34%,rgba(220,50,70,.25) 62%,transparent 82%)",
        animationName: "bdv-leak",
        animationDuration: "4.1s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
      }} />
      {/* Secondary cool sweep */}
      <div style={{
        position: "absolute",
        top: "-20%", left: "-30%",
        width: "54%", height: "148%",
        background: "linear-gradient(150deg,rgba(90,180,255,.45) 0%,rgba(255,180,55,.35) 42%,transparent 68%)",
        animationName: "bdv-leak",
        animationDuration: "5.0s",
        animationDelay: "-2.1s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
      }} />
    </div>
  );
}

/* ══════════════════════════════════════ Animated Waveform ═══════════════════ */
type WaveStyle = "bars" | "line" | "circle" | "strip";
type WaveColor = "gold" | "white" | "black" | "custom";

function WaveformEffect({
  opacity,
  waveStyle = "bars",
  waveColor = "gold",
  customColor,
}: {
  opacity: number;
  waveStyle?: WaveStyle;
  waveColor?: WaveColor;
  customColor?: string;
}) {
  const N   = 32;
  const BAR = 6;
  const GAP = 3;
  const H   = 72;
  const W   = N * (BAR + GAP) - GAP;

  const baseColor =
    waveColor === "gold"   ? "#C9A84C" :
    waveColor === "white"  ? "#ffffff" :
    waveColor === "black"  ? "#222222" :
    (customColor ?? "#C9A84C");

  const hexToRgb = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  };
  const rgb = hexToRgb(baseColor.startsWith("#") ? baseColor : "#C9A84C");

  if (waveStyle === "strip") {
    /* Full-width bottom strip */
    return (
      <svg
        width="100%" height={H}
        style={{ position: "absolute", left: 0, bottom: 0, opacity }}
        viewBox={`0 0 ${W * 2} ${H}`}
        preserveAspectRatio="none"
      >
        {Array.from({ length: N * 2 }, (_, i) => {
          const h1 = (8 + dr(i * 7) * 58) / H;
          const h2 = (8 + dr(i * 11 + 3) * 58) / H;
          return (
            <rect
              key={i}
              x={i * (BAR + GAP)} y={0} width={BAR} height={H} rx={1}
              fill={`rgba(${rgb.r},${rgb.g},${rgb.b},0.75)`}
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
        position: "absolute", left: "50%", bottom: "6%",
        transform: "translateX(-50%)", opacity,
        overflow: "visible",
        filter: `drop-shadow(0 0 6px rgba(${rgb.r},${rgb.g},${rgb.b},0.55))`,
      }}
    >
      {Array.from({ length: N }, (_, i) => {
        const h1 = (10 + dr(i * 7) * 56) / H;
        const h2 = (10 + dr(i * 11 + 3) * 56) / H;
        const x  = i * (BAR + GAP);
        /* Gold: slight warm variation per bar; white: slight warm tint */
        const alpha = 0.82 + dr(i * 5) * 0.16;
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

/* ══════════════════════════════════════ Logo / Watermark ════════════════════ */
function LogoWatermarkEffect({ opacity }: { opacity: number }) {
  return (
    <div
      data-testid="watermark-overlay"
      style={{
        position: "absolute",
        bottom: "8%",
        right: "4%",
        opacity,
        background: "rgba(0,0,0,0.58)",
        color: "rgba(201,168,76,0.92)",
        fontSize: "clamp(8px,1.6vw,13px)",
        fontWeight: 900,
        letterSpacing: "0.13em",
        padding: "0.28rem 0.85rem",
        borderRadius: "0.3rem",
        border: "1px solid rgba(201,168,76,0.38)",
        backdropFilter: "blur(6px)",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        boxShadow: "0 0 12px rgba(201,168,76,0.15)",
      }}
    >
      Your Watermark
    </div>
  );
}

/* ══════════════════════════════════════ Root ════════════════════════════════ */
export interface ActiveOverlayEffectsProps {
  activeOverlays: string[];
  intensity: IntensityMap;
  testActive: boolean;
}

export function ActiveOverlayEffects({
  activeOverlays,
  intensity,
  testActive,
}: ActiveOverlayEffectsProps) {
  const show = testActive
    ? [...new Set([...activeOverlays, "Rain", "Sparks", "Lens Flare"])]
    : activeOverlays;

  if (show.length === 0) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 13 }}
      data-testid="active-overlay-effects"
    >
      <style>{KEYFRAMES}</style>

      {show.includes("Rain")               && <RainEffect       opacity={gi(intensity, "Rain")} />}
      {show.includes("Smoke")              && <SmokeEffect      opacity={gi(intensity, "Smoke")} />}
      {show.includes("Sparks")             && <SparksEffect     opacity={gi(intensity, "Sparks")} />}
      {show.includes("Lens Flare")         && <LensFlareEffect  opacity={gi(intensity, "Lens Flare")} />}
      {show.includes("Dust")               && <DustEffect       opacity={gi(intensity, "Dust")} />}
      {show.includes("Light Leaks")        && <LightLeaksEffect opacity={gi(intensity, "Light Leaks")} />}
      {show.includes("Animated Waveform")  && (
        <WaveformEffect opacity={gi(intensity, "Animated Waveform")} waveColor="gold" />
      )}
      {show.includes("Logo / Watermark")   && <LogoWatermarkEffect opacity={gi(intensity, "Logo / Watermark")} />}

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
