/**
 * ActiveOverlayEffects — animated CSS/SVG visual overlays driven by the
 * "Overlays" chip selections stored in settings.overlays.
 *
 * Immediately visible in the master player when a chip is toggled on.
 * When testActive=true, also shows Rain + Sparks + Lens Flare + label.
 */
import type React from "react";

/* ── CSS keyframes (injected once via <style> tag in JSX) ── */
const KEYFRAMES = `
@keyframes bdv-rain{0%{transform:translateY(-8%) rotate(15deg);opacity:.65}to{transform:translateY(115%) rotate(15deg);opacity:.15}}
@keyframes bdv-smoke{0%{transform:translateY(0) scale(1);opacity:.48}65%{opacity:.18}to{transform:translateY(-125%) scale(3.1);opacity:0}}
@keyframes bdv-spark{0%{transform:translate(0,0) scale(1.4);opacity:1}to{transform:translate(var(--dx),var(--dy)) scale(.08);opacity:0}}
@keyframes bdv-dust{0%{transform:translate(0,0);opacity:0}14%{opacity:.72}84%{opacity:.38}to{transform:translate(var(--dx),var(--dy));opacity:0}}
@keyframes bdv-flare{0%,100%{opacity:.82;transform:scale(1)}44%{opacity:1;transform:scale(1.07)}68%{opacity:.65;transform:scale(.94)}}
@keyframes bdv-leak{0%{opacity:0;transform:translateX(-65%) skewX(-12deg)}24%{opacity:.78}70%{opacity:.5}to{opacity:0;transform:translateX(88%) skewX(-12deg)}}
@keyframes bdv-bar{0%,100%{transform:scaleY(var(--h1))}50%{transform:scaleY(var(--h2))}}
`;

/* ── Deterministic pseudo-random (no re-randomization on re-render) ── */
const dr = (seed: number) =>
  ((seed * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff;

/* ════════════════════════════════════════ Rain ════════════════════════════ */
function RainEffect() {
  const N = 22;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {Array.from({ length: N }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${dr(i * 3) * 95 + 1}%`,
            top: `${-5 - dr(i * 3 + 1) * 8}%`,
            width: dr(i * 3 + 2) > 0.55 ? "1.5px" : "1px",
            height: `${48 + dr(i * 7) * 52}px`,
            background: `rgba(160,215,255,${0.30 + dr(i * 5) * 0.40})`,
            borderRadius: "1px",
            animationName: "bdv-rain",
            animationDuration: `${0.38 + dr(i * 11) * 0.52}s`,
            animationDelay: `${-dr(i * 13) * 1.5}s`,
            animationTimingFunction: "linear",
            animationIterationCount: "infinite",
          }}
        />
      ))}
    </div>
  );
}

/* ════════════════════════════════════════ Smoke ═══════════════════════════ */
function SmokeEffect() {
  const N = 6;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {Array.from({ length: N }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${18 + dr(i * 7) * 64}%`,
            bottom: `${-8 + dr(i * 3) * 12}%`,
            width: `${65 + dr(i * 11) * 85}px`,
            height: `${65 + dr(i * 5) * 85}px`,
            background: `rgba(190,190,190,0.16)`,
            borderRadius: "50%",
            filter: `blur(${20 + dr(i * 13) * 24}px)`,
            animationName: "bdv-smoke",
            animationDuration: `${3.0 + dr(i * 7) * 2.8}s`,
            animationDelay: `${-dr(i * 17) * 4}s`,
            animationTimingFunction: "ease-out",
            animationIterationCount: "infinite",
          }}
        />
      ))}
    </div>
  );
}

/* ════════════════════════════════════════ Sparks ══════════════════════════ */
function SparksEffect() {
  const N = 18;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {Array.from({ length: N }, (_, i) => {
        const angle = (i / N) * 2 * Math.PI + dr(i * 7) * 0.5 - Math.PI / 2;
        const dist = 55 + dr(i * 13) * 110;
        const dx = Math.round(Math.cos(angle) * dist);
        const dy = Math.round(Math.sin(angle) * dist) - 30;
        const r = Math.round(215 + dr(i * 9) * 40);
        const g = Math.round(90 + dr(i * 11) * 100);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `calc(${44 + dr(i * 5) * 12}% + ${Math.round((dr(i * 3) - 0.5) * 35)}px)`,
              bottom: `${6 + dr(i * 11) * 14}%`,
              width: `${2.5 + dr(i * 7) * 4}px`,
              height: `${2.5 + dr(i * 7) * 4}px`,
              background: `rgba(${r},${g},20,1)`,
              borderRadius: "50%",
              boxShadow: `0 0 5px rgba(255,155,25,0.85)`,
              "--dx": `${dx}px`,
              "--dy": `${dy}px`,
              animationName: "bdv-spark",
              animationDuration: `${0.45 + dr(i * 17) * 0.95}s`,
              animationDelay: `${-dr(i * 19) * 1.8}s`,
              animationTimingFunction: "ease-out",
              animationIterationCount: "infinite",
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════ Dust ════════════════════════════ */
function DustEffect() {
  const N = 26;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {Array.from({ length: N }, (_, i) => {
        const dx = Math.round((dr(i * 3) - 0.5) * 70);
        const dy = Math.round((dr(i * 7) - 0.5) * 70);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${dr(i * 11) * 94}%`,
              top: `${dr(i * 13) * 94}%`,
              width: `${1.2 + dr(i * 5) * 2.8}px`,
              height: `${1.2 + dr(i * 5) * 2.8}px`,
              background: `rgba(215,200,165,${0.45 + dr(i * 17) * 0.45})`,
              borderRadius: "50%",
              "--dx": `${dx}px`,
              "--dy": `${dy}px`,
              animationName: "bdv-dust",
              animationDuration: `${3.2 + dr(i * 11) * 4.5}s`,
              animationDelay: `${-dr(i * 19) * 5}s`,
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════ Lens Flare ══════════════════════ */
function LensFlareEffect() {
  const cx = "68%";
  const cy = "22%";
  const baseStyle: React.CSSProperties = {
    animationName: "bdv-flare",
    animationDuration: "2.5s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  };
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* Main glow */}
      <div style={{
        ...baseStyle,
        position: "absolute", left: cx, top: cy,
        transform: "translate(-50%,-50%)",
        width: "84px", height: "84px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,245,185,0.96) 0%, rgba(255,200,60,0.52) 38%, transparent 72%)",
        filter: "blur(2px)",
        boxShadow: "0 0 44px 18px rgba(255,220,80,0.38)",
      }} />
      {/* Ring 1 */}
      <div style={{
        ...baseStyle,
        position: "absolute", left: cx, top: cy,
        transform: "translate(-50%,-50%)",
        width: "148px", height: "148px", borderRadius: "50%",
        border: "1.5px solid rgba(255,225,120,0.32)",
      }} />
      {/* Ring 2 */}
      <div style={{
        ...baseStyle,
        position: "absolute", left: cx, top: cy,
        transform: "translate(-50%,-50%)",
        width: "210px", height: "210px", borderRadius: "50%",
        border: "1px solid rgba(255,220,120,0.15)",
      }} />
      {/* Horizontal streak */}
      <div style={{
        ...baseStyle,
        position: "absolute", top: cy, left: 0, right: 0, height: "1px",
        background: "linear-gradient(90deg,transparent 4%,rgba(255,220,120,0.28) 28%,rgba(255,245,185,0.72) 68%,rgba(255,220,120,0.25) 82%,transparent 96%)",
      }} />
      {/* Secondary dot (opposing side) */}
      <div style={{
        ...baseStyle,
        position: "absolute", left: "30%", top: "78%",
        transform: "translate(-50%,-50%)",
        width: "20px", height: "20px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(110,200,255,0.68) 0%, transparent 72%)",
      }} />
    </div>
  );
}

/* ════════════════════════════════════════ Light Leaks ═════════════════════ */
function LightLeaksEffect() {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div style={{
        position: "absolute",
        top: "-20%", left: "-25%",
        width: "62%", height: "145%",
        background: "linear-gradient(132deg,rgba(255,200,60,.72) 0%,rgba(255,110,20,.5) 34%,rgba(200,55,75,.18) 64%,transparent 84%)",
        animationName: "bdv-leak",
        animationDuration: "3.9s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
      }} />
      <div style={{
        position: "absolute",
        top: "-20%", left: "-25%",
        width: "52%", height: "145%",
        background: "linear-gradient(148deg,rgba(100,185,255,.38) 0%,rgba(255,185,60,.28) 42%,transparent 70%)",
        animationName: "bdv-leak",
        animationDuration: "4.6s",
        animationDelay: "-1.9s",
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
      }} />
    </div>
  );
}

/* ════════════════════════════════════════ Animated Waveform ═══════════════ */
function WaveformEffect() {
  const N = 28;
  const BAR = 7;
  const GAP = 3;
  const H = 70;
  const W = N * (BAR + GAP) - GAP;
  return (
    <svg
      width={W}
      height={H}
      style={{
        position: "absolute",
        left: "50%",
        bottom: "6%",
        transform: "translateX(-50%)",
        opacity: 0.84,
        overflow: "visible",
      }}
    >
      {Array.from({ length: N }, (_, i) => {
        const h1 = (10 + dr(i * 7) * 56) / H;
        const h2 = (10 + dr(i * 11 + 3) * 56) / H;
        const x = i * (BAR + GAP);
        const cr = 155 + Math.round(dr(i * 5) * 90);
        const cg = 35 + Math.round(dr(i * 9) * 130);
        return (
          <rect
            key={i}
            x={x}
            y={0}
            width={BAR}
            height={H}
            rx={2}
            fill={`rgba(${cr},${cg},255,0.8)`}
            style={{
              transformBox: "fill-box",
              transformOrigin: "50% 100%",
              animationName: "bdv-bar",
              animationDuration: `${0.26 + dr(i * 13) * 0.56}s`,
              animationDelay: `${-dr(i * 17) * 0.5}s`,
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
              "--h1": String(h1),
              "--h2": String(h2),
            } as React.CSSProperties}
          />
        );
      })}
    </svg>
  );
}

/* ════════════════════════════════════════ Logo / Watermark ════════════════ */
function LogoWatermarkEffect() {
  return (
    <div
      style={{
        position: "absolute",
        bottom: "8%",
        right: "4%",
        background: "rgba(0,0,0,0.55)",
        color: "rgba(201,168,76,0.9)",
        fontSize: "clamp(8px,1.8vw,13px)",
        fontWeight: 900,
        letterSpacing: "0.12em",
        padding: "0.28rem 0.8rem",
        borderRadius: "0.3rem",
        border: "1px solid rgba(201,168,76,0.35)",
        backdropFilter: "blur(4px)",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
      data-testid="watermark-overlay"
    >
      Your Watermark
    </div>
  );
}

/* ════════════════════════════════════════ Root component ══════════════════ */
export interface ActiveOverlayEffectsProps {
  activeOverlays: string[];
  testActive: boolean;
}

export function ActiveOverlayEffects({ activeOverlays, testActive }: ActiveOverlayEffectsProps) {
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
      {show.includes("Rain")               && <RainEffect />}
      {show.includes("Smoke")              && <SmokeEffect />}
      {show.includes("Sparks")             && <SparksEffect />}
      {show.includes("Lens Flare")         && <LensFlareEffect />}
      {show.includes("Dust")               && <DustEffect />}
      {show.includes("Light Leaks")        && <LightLeaksEffect />}
      {show.includes("Animated Waveform")  && <WaveformEffect />}
      {show.includes("Logo / Watermark")   && <LogoWatermarkEffect />}

      {testActive && (
        <div
          data-testid="active-overlay-test-label"
          style={{
            position: "absolute",
            top: "12%",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.88)",
            color: "#C9A84C",
            fontWeight: 900,
            fontSize: "clamp(11px,2.6vw,20px)",
            padding: "0.38rem 1.3rem",
            borderRadius: "0.5rem",
            border: "2px solid #C9A84C",
            letterSpacing: "0.1em",
            whiteSpace: "nowrap",
            boxShadow: "0 0 28px rgba(201,168,76,0.5)",
            zIndex: 30,
          }}
        >
          OVERLAY TEST ACTIVE
        </div>
      )}
    </div>
  );
}
