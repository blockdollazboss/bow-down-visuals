/**
 * OverlayLayer — renders timed visual overlays above the master video.
 * Overlays are shown/hidden based on `currentTime` relative to each item's
 * startTime / endTime.  Captions are rendered above this layer (higher z-index).
 */
import type { OverlayItem, OverlayPosition } from "@/lib/editor-settings";

/* ── Position helper ── */
function posStyle(p: OverlayPosition): React.CSSProperties {
  const S: Record<OverlayPosition, React.CSSProperties> = {
    "top-left":      { top: "8%",  left: "8%",  transform: "none" },
    "top-center":    { top: "8%",  left: "50%", transform: "translateX(-50%)" },
    "top-right":     { top: "8%",  right: "8%", transform: "none" },
    "center-left":   { top: "50%", left: "8%",  transform: "translateY(-50%)" },
    "center":        { top: "50%", left: "50%", transform: "translate(-50%,-50%)" },
    "center-right":  { top: "50%", right: "8%", transform: "translateY(-50%)" },
    "bottom-left":   { bottom: "14%", left: "8%",  transform: "none" },
    "bottom-center": { bottom: "14%", left: "50%", transform: "translateX(-50%)" },
    "bottom-right":  { bottom: "14%", right: "8%", transform: "none" },
  };
  return S[p] ?? S["center"]!;
}

/* ── Noise SVG for film-grain ── */
const GRAIN_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E")`;

export interface TestOverlaySpec {
  content: string;
  color: string;
  textColor: string;
}

interface OverlayLayerProps {
  items: OverlayItem[];
  currentTime: number;
  testOverlay?: TestOverlaySpec | null;
}

export function OverlayLayer({ items, currentTime, testOverlay }: OverlayLayerProps) {
  const active = items.filter(
    (it) => it.startTime <= currentTime && currentTime < it.endTime,
  );

  if (active.length === 0 && !testOverlay) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 15 }}
      data-testid="overlay-layer"
    >
      {/* Test overlay — gold "OVERLAY TEST" box */}
      {testOverlay && (
        <div
          className="absolute"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            background: testOverlay.color,
            color: testOverlay.textColor,
            fontWeight: 900,
            fontSize: "clamp(20px,5vw,38px)",
            padding: "0.7rem 2.2rem",
            borderRadius: "0.5rem",
            border: `3px solid ${testOverlay.textColor}`,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            boxShadow: `0 0 40px ${testOverlay.color}99, inset 0 0 20px rgba(0,0,0,0.2)`,
            whiteSpace: "nowrap",
          }}
          data-testid="test-overlay-box"
        >
          {testOverlay.content}
        </div>
      )}

      {/* Structured overlay items */}
      {active.map((item) => renderItem(item))}
    </div>
  );
}

function renderItem(item: OverlayItem) {
  const opacity = Math.max(0, Math.min(1, item.opacity / 100));
  const z = item.zIndex || 15;
  const ps = posStyle(item.position);

  switch (item.type) {
    case "text":
      return (
        <div
          key={item.id}
          className="absolute"
          style={{
            ...ps,
            zIndex: z,
            opacity,
            color: item.textColor || "#ffffff",
            fontSize: `clamp(12px, ${Math.round(item.size * 0.3)}px, ${Math.max(14, item.size)}px)`,
            fontWeight: 900,
            textShadow: "2px 2px 6px rgba(0,0,0,0.95)",
            whiteSpace: "pre-wrap",
            textAlign: "center",
          }}
        >
          {item.content}
        </div>
      );

    case "lower-third":
      return (
        <div
          key={item.id}
          className="absolute left-0 right-0"
          style={{
            bottom: "14%",
            zIndex: z,
            opacity,
            background: "rgba(0,0,0,0.72)",
            color: item.textColor || "#ffffff",
            fontSize: `clamp(12px, ${Math.round(item.size * 0.28)}px, 32px)`,
            fontWeight: 900,
            padding: "0.45rem 1.4rem",
            textShadow: "1px 1px 3px rgba(0,0,0,0.8)",
            borderTop: `2px solid ${item.textColor || "#C9A84C"}`,
          }}
        >
          {item.content}
        </div>
      );

    case "color":
      return (
        <div
          key={item.id}
          className="absolute inset-0"
          style={{
            zIndex: z,
            background: item.color || "rgba(255,0,0,0.3)",
            opacity,
          }}
        />
      );

    case "vignette":
      return (
        <div
          key={item.id}
          className="absolute inset-0"
          style={{
            zIndex: z,
            opacity,
            background:
              "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.85) 100%)",
          }}
        />
      );

    case "film-grain":
      return (
        <div
          key={item.id}
          className="absolute inset-0"
          style={{
            zIndex: z,
            opacity,
            backgroundImage: GRAIN_SVG,
            backgroundRepeat: "repeat",
            backgroundSize: "200px 200px",
            mixBlendMode: "overlay",
          }}
        />
      );

    case "light-leak":
      return (
        <div
          key={item.id}
          className="absolute inset-0"
          style={{
            zIndex: z,
            opacity,
            background:
              "linear-gradient(135deg, rgba(255,200,60,0.65) 0%, rgba(255,100,20,0.45) 40%, transparent 70%)",
          }}
        />
      );

    case "particles":
      return (
        <div
          key={item.id}
          className="absolute inset-0"
          style={{
            zIndex: z,
            opacity,
            backgroundImage:
              "radial-gradient(2px 2px at 20% 30%, rgba(255,255,255,0.8) 0%, transparent 100%)," +
              "radial-gradient(2px 2px at 70% 20%, rgba(255,255,255,0.6) 0%, transparent 100%)," +
              "radial-gradient(1px 1px at 50% 60%, rgba(255,255,255,0.7) 0%, transparent 100%)," +
              "radial-gradient(1px 1px at 30% 80%, rgba(255,255,255,0.5) 0%, transparent 100%)," +
              "radial-gradient(2px 2px at 80% 70%, rgba(255,220,100,0.6) 0%, transparent 100%)",
          }}
        />
      );

    case "image":
    case "watermark":
      if (!item.source) return null;
      return (
        <img
          key={item.id}
          src={item.source}
          alt="overlay"
          style={{
            position: "absolute",
            ...ps,
            zIndex: z,
            opacity,
            width: `${Math.max(5, Math.min(90, item.size))}%`,
            objectFit: "contain",
            maxWidth: "80%",
          }}
        />
      );

    default:
      return null;
  }
}
