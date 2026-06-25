import { useRef, useState, useEffect, useCallback } from "react";
import { GripHorizontal } from "lucide-react";
import { NavThemePlayer } from "@/components/HomepageThemePlayer";

const GOLD_GLOW   = "rgba(218,165,32,";
const SNAP_MARGIN = 20;
const HIDE_DELAY  = 3500;   // ms idle before auto-hiding
const PEEK_PX     = 6;      // pixels of player left visible at the screen edge

type SnapPoint = "TL" | "TC" | "TR" | "RC" | "BR" | "BC" | "BL" | "LC";
const VALID_POINTS: SnapPoint[] = ["TL","TC","TR","RC","BR","BC","BL","LC"];

function snapToPos(pt: SnapPoint, w: number, h: number): { x: number; y: number } {
  const vw = window.innerWidth, vh = window.innerHeight, m = SNAP_MARGIN;
  const cx = Math.round((vw - w) / 2), cy = Math.round((vh - h) / 2);
  const map: Record<SnapPoint, { x: number; y: number }> = {
    TL: { x: m,          y: m          },
    TC: { x: cx,         y: m          },
    TR: { x: vw - w - m, y: m          },
    RC: { x: vw - w - m, y: cy         },
    BR: { x: vw - w - m, y: vh - h - m },
    BC: { x: cx,         y: vh - h - m },
    BL: { x: m,          y: vh - h - m },
    LC: { x: m,          y: cy         },
  };
  return map[pt];
}

function nearestSnap(x: number, y: number, w: number, h: number): SnapPoint {
  const cx = x + w / 2, cy = y + h / 2;
  let best: SnapPoint = "BR", bestDist = Infinity;
  for (const pt of VALID_POINTS) {
    const a = snapToPos(pt, w, h);
    const d = (cx - a.x - w / 2) ** 2 + (cy - a.y - h / 2) ** 2;
    if (d < bestDist) { bestDist = d; best = pt; }
  }
  return best;
}

function getSavedSnap(): SnapPoint {
  try {
    const v = localStorage.getItem("bdv-player-snap") as SnapPoint | null;
    if (v && (VALID_POINTS as string[]).includes(v)) return v;
  } catch { /* ignore */ }
  return "BR";
}

function helpSide(pt: SnapPoint): "left" | "right" {
  return (pt === "TL" || pt === "BL" || pt === "LC" || pt === "TC") ? "left" : "right";
}

/**
 * CSS transform that slides the player off its nearest screen edge,
 * leaving PEEK_PX pixels visible as a hover target.
 *
 * Math: snap margin places the outer edge SNAP_MARGIN px from the viewport edge.
 * To leave PEEK_PX px visible we shift by (element size + SNAP_MARGIN - PEEK_PX).
 * Using calc(100% + Npx) avoids needing to know the element size at call time.
 */
function slideTransform(pt: SnapPoint): string {
  const off = `${SNAP_MARGIN - PEEK_PX}px`;      // 14 px
  if (pt === "TR" || pt === "RC" || pt === "BR") return `translateX(calc(100% + ${off}))`;
  if (pt === "TL" || pt === "LC" || pt === "BL") return `translateX(calc(-100% - ${off}))`;
  if (pt === "TC")                                return `translateY(calc(-100% - ${off}))`;
  /* BC */                                        return `translateY(calc(100% + ${off}))`;
}

/**
 * Style for the thin gold tab that peeks out at the screen edge.
 * It is positioned at the *inside* edge of the player — the slice
 * that remains visible after the slide-off transform.
 *
 *   right-side snaps → player slides right → left edge peeks out
 *   left-side  snaps → player slides left  → right edge peeks out
 *   top snap         → player slides up    → bottom edge peeks out
 *   bottom snap      → player slides down  → top edge peeks out
 */
function peekTabStyle(pt: SnapPoint): React.CSSProperties {
  const base: React.CSSProperties = {
    position:     "absolute",
    borderRadius: 2,
    background:   `linear-gradient(135deg, rgba(155,117,21,0.9), rgba(218,165,32,0.9))`,
    boxShadow:    `0 0 8px ${GOLD_GLOW}0.60)`,
    pointerEvents:"none",        // the parent div is the real hit-target
  };
  if (pt === "TR" || pt === "RC" || pt === "BR")
    return { ...base, left: 0,   top: "10%", bottom: "10%", width: PEEK_PX };
  if (pt === "TL" || pt === "LC" || pt === "BL")
    return { ...base, right: 0,  top: "10%", bottom: "10%", width: PEEK_PX };
  if (pt === "TC")
    return { ...base, bottom: 0, left: "20%", right: "20%", height: PEEK_PX };
  /* BC */
  return { ...base, top: 0,    left: "20%", right: "20%", height: PEEK_PX };
}

export function DraggableThemePlayer() {
  const elRef     = useRef<HTMLDivElement>(null);
  const dragging  = useRef(false);
  const startPtr  = useRef({ px: 0, py: 0, ex: 0, ey: 0 });
  const posRef    = useRef({ x: 0, y: 0 });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pos, rawSetPos]          = useState(() => snapToPos(getSavedSnap(), 210, 52));
  const [isSnapping, setIsSnapping]   = useState(false);
  const [isDragging, setIsDragging]   = useState(false);
  const [currentSnap, setCurrentSnap] = useState<SnapPoint>(getSavedSnap);
  const [isCollapsed, setIsCollapsed] = useState(false);

  function updatePos(p: { x: number; y: number }) {
    posRef.current = p;
    rawSetPos(p);
  }

  function snapTo(pt: SnapPoint, w: number, h: number) {
    try { localStorage.setItem("bdv-player-snap", pt); } catch { /* ignore */ }
    setCurrentSnap(pt);
    setIsSnapping(true);
    updatePos(snapToPos(pt, w, h));
    setTimeout(() => setIsSnapping(false), 400);
  }

  const startHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setIsCollapsed(true), HIDE_DELAY);
  }, []);

  const cancelHideTimer = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    updatePos(snapToPos(getSavedSnap(), el.offsetWidth, el.offsetHeight));
    startHideTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onResize = () => {
      const el = elRef.current;
      if (!el || dragging.current) return;
      updatePos(snapToPos(getSavedSnap(), el.offsetWidth, el.offsetHeight));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button, input")) return;
    dragging.current = true;
    setIsDragging(true);
    cancelHideTimer();
    setIsCollapsed(false);
    const el = elRef.current!;
    const rect = el.getBoundingClientRect();
    startPtr.current = { px: e.clientX, py: e.clientY, ex: rect.left, ey: rect.top };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const el = elRef.current!;
    const w = el.offsetWidth, h = el.offsetHeight;
    const { px, py, ex, ey } = startPtr.current;
    const half = SNAP_MARGIN / 2;
    updatePos({
      x: Math.max(half, Math.min(window.innerWidth  - w - half, ex + e.clientX - px)),
      y: Math.max(half, Math.min(window.innerHeight - h - half, ey + e.clientY - py)),
    });
  }

  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    const el = elRef.current!;
    const pt = nearestSnap(posRef.current.x, posRef.current.y, el.offsetWidth, el.offsetHeight);
    snapTo(pt, el.offsetWidth, el.offsetHeight);
    startHideTimer();
  }

  function onMouseEnter() {
    cancelHideTimer();
    setIsCollapsed(false);
  }

  function onMouseLeave() {
    if (!dragging.current) startHideTimer();
  }

  /* Build the CSS transition string.
     - Position snapping uses left/top with a spring easing.
     - Collapse/expand uses transform with the same spring.
     Both can fire simultaneously, so combine them. */
  const transition = [
    isSnapping
      ? "left 0.30s cubic-bezier(0.34,1.56,0.64,1), top 0.30s cubic-bezier(0.34,1.56,0.64,1)"
      : "",
    "transform 0.32s cubic-bezier(0.34,1.56,0.64,1)",
    "opacity 0.20s ease",
  ].filter(Boolean).join(", ");

  return (
    <div
      ref={elRef}
      style={{
        position:         "fixed",
        left:             pos.x,
        top:              pos.y,
        zIndex:           9999,
        transform:        isCollapsed ? slideTransform(currentSnap) : "none",
        transition,
        touchAction:      "none",
        userSelect:       "none",
        WebkitUserSelect: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Gold peek tab — stays at the inside edge; visible only when collapsed */}
      <div
        style={{
          ...peekTabStyle(currentSnap),
          opacity:    isCollapsed ? 1 : 0,
          transition: "opacity 0.20s ease",
        }}
        aria-hidden="true"
      />

      {/* Drag-grip handle */}
      <div
        style={{
          display:        "flex",
          justifyContent: "center",
          alignItems:     "center",
          paddingBottom:  3,
          cursor:         isDragging ? "grabbing" : "grab",
          opacity:        isCollapsed ? 0 : 1,
          transition:     "opacity 0.15s ease",
        }}
        title="Drag to move"
      >
        <GripHorizontal size={14} style={{ color: `${GOLD_GLOW}0.50)` }} />
      </div>

      {/* Player pill */}
      <div
        style={{
          cursor:     isDragging ? "grabbing" : "grab",
          opacity:    isCollapsed ? 0 : 1,
          transition: "opacity 0.15s ease",
        }}
      >
        <NavThemePlayer
          onHelpClick={() =>
            window.dispatchEvent(
              new CustomEvent("open-help-panel", { detail: { side: helpSide(currentSnap) } }),
            )
          }
        />
      </div>
    </div>
  );
}
