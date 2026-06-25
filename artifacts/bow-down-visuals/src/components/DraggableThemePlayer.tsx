import { useRef, useState, useEffect } from "react";
import { GripHorizontal } from "lucide-react";
import { NavThemePlayer } from "@/components/HomepageThemePlayer";

const GOLD_GLOW = "rgba(218,165,32,";
const SNAP_MARGIN = 20;

type SnapCorner = "TL" | "TR" | "BL" | "BR";

function cornerToPos(
  corner: SnapCorner,
  w: number,
  h: number,
): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = SNAP_MARGIN;
  const map: Record<SnapCorner, { x: number; y: number }> = {
    TL: { x: m,         y: m },
    TR: { x: vw - w - m, y: m },
    BL: { x: m,         y: vh - h - m },
    BR: { x: vw - w - m, y: vh - h - m },
  };
  return map[corner];
}

function nearestCorner(x: number, y: number, w: number, h: number): SnapCorner {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const right  = cx > window.innerWidth  / 2;
  const bottom = cy > window.innerHeight / 2;
  if (right  && bottom)  return "BR";
  if (right  && !bottom) return "TR";
  if (!right && bottom)  return "BL";
  return "TL";
}

function getSavedCorner(): SnapCorner {
  try {
    const v = localStorage.getItem("bdv-player-corner");
    if (v === "TL" || v === "TR" || v === "BL" || v === "BR") return v;
  } catch { /* ignore */ }
  return "BR";
}

export function DraggableThemePlayer() {
  const elRef    = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startPtr = useRef({ px: 0, py: 0, ex: 0, ey: 0 });
  const posRef   = useRef({ x: 0, y: 0 });

  const [pos, rawSetPos] = useState<{ x: number; y: number }>(() =>
    cornerToPos(getSavedCorner(), 210, 52),
  );
  const [isSnapping,  setIsSnapping]  = useState(false);
  const [isDragging,  setIsDragging]  = useState(false);

  function updatePos(p: { x: number; y: number }) {
    posRef.current = p;
    rawSetPos(p);
  }

  // After mount: measure real size → re-snap to saved corner
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    updatePos(cornerToPos(getSavedCorner(), el.offsetWidth, el.offsetHeight));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep snapped to correct corner on window resize
  useEffect(() => {
    const onResize = () => {
      const el = elRef.current;
      if (!el || dragging.current) return;
      updatePos(cornerToPos(getSavedCorner(), el.offsetWidth, el.offsetHeight));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Let button / input clicks propagate normally
    if ((e.target as HTMLElement).closest("button, input")) return;
    dragging.current = true;
    setIsDragging(true);
    const el = elRef.current!;
    const rect = el.getBoundingClientRect();
    startPtr.current = { px: e.clientX, py: e.clientY, ex: rect.left, ey: rect.top };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const el = elRef.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const { px, py, ex, ey } = startPtr.current;
    const half = SNAP_MARGIN / 2;
    const newX = Math.max(half, Math.min(window.innerWidth  - w - half, ex + e.clientX - px));
    const newY = Math.max(half, Math.min(window.innerHeight - h - half, ey + e.clientY - py));
    updatePos({ x: newX, y: newY });
  }

  function onPointerUp(_e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    const el = elRef.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const corner  = nearestCorner(posRef.current.x, posRef.current.y, w, h);
    const snapped = cornerToPos(corner, w, h);
    try { localStorage.setItem("bdv-player-corner", corner); } catch { /* ignore */ }
    setIsSnapping(true);
    updatePos(snapped);
    setTimeout(() => setIsSnapping(false), 400);
  }

  return (
    <div
      ref={elRef}
      style={{
        position:   "fixed",
        left:       pos.x,
        top:        pos.y,
        zIndex:     9999,
        transition: isSnapping
          ? "left 0.30s cubic-bezier(0.34,1.56,0.64,1), top 0.30s cubic-bezier(0.34,1.56,0.64,1)"
          : "none",
        touchAction:    "none",
        userSelect:     "none",
        WebkitUserSelect: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* ── Drag grip ── */}
      <div
        style={{
          display:        "flex",
          justifyContent: "center",
          alignItems:     "center",
          paddingBottom:  3,
          cursor:         isDragging ? "grabbing" : "grab",
          pointerEvents:  "auto",
        }}
        title="Drag to move"
      >
        <GripHorizontal
          size={14}
          style={{ color: `${GOLD_GLOW}0.50)`, transition: "color 0.15s" }}
        />
      </div>

      {/* ── Player shell — cursor reflects drag state ── */}
      <div style={{ cursor: isDragging ? "grabbing" : "grab" }}>
        <NavThemePlayer />
      </div>
    </div>
  );
}
