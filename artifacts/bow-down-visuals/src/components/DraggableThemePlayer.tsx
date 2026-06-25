import { useRef, useState, useEffect } from "react";
import { GripHorizontal } from "lucide-react";
import { NavThemePlayer } from "@/components/HomepageThemePlayer";

const GOLD_GLOW    = "rgba(218,165,32,";
const SNAP_MARGIN  = 20;

type SnapPoint = "TL" | "TC" | "TR" | "RC" | "BR" | "BC" | "BL" | "LC";
const VALID_POINTS: SnapPoint[] = ["TL","TC","TR","RC","BR","BC","BL","LC"];

/** Convert a snap-point id to an absolute {x, y} pixel position */
function snapToPos(pt: SnapPoint, w: number, h: number): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m  = SNAP_MARGIN;
  const cx = Math.round((vw - w) / 2); // center-x
  const cy = Math.round((vh - h) / 2); // center-y
  const map: Record<SnapPoint, { x: number; y: number }> = {
    TL: { x: m,          y: m          },  // top-left
    TC: { x: cx,         y: m          },  // top-center
    TR: { x: vw - w - m, y: m          },  // top-right
    RC: { x: vw - w - m, y: cy         },  // right-center
    BR: { x: vw - w - m, y: vh - h - m },  // bottom-right
    BC: { x: cx,         y: vh - h - m },  // bottom-center
    BL: { x: m,          y: vh - h - m },  // bottom-left
    LC: { x: m,          y: cy         },  // left-center
  };
  return map[pt];
}

/** Find the snap point whose anchor is closest to the element's current center */
function nearestSnap(x: number, y: number, w: number, h: number): SnapPoint {
  const cx = x + w / 2;
  const cy = y + h / 2;
  let best: SnapPoint = "BR";
  let bestDist = Infinity;
  for (const pt of VALID_POINTS) {
    const anchor = snapToPos(pt, w, h);
    const ax = anchor.x + w / 2;
    const ay = anchor.y + h / 2;
    const dist = (cx - ax) ** 2 + (cy - ay) ** 2;
    if (dist < bestDist) { bestDist = dist; best = pt; }
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

export function DraggableThemePlayer() {
  const elRef    = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startPtr = useRef({ px: 0, py: 0, ex: 0, ey: 0 });
  const posRef   = useRef({ x: 0, y: 0 });

  const [pos, rawSetPos] = useState<{ x: number; y: number }>(() =>
    snapToPos(getSavedSnap(), 210, 52),
  );
  const [isSnapping, setIsSnapping] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  function updatePos(p: { x: number; y: number }) {
    posRef.current = p;
    rawSetPos(p);
  }

  function snapTo(pt: SnapPoint, w: number, h: number) {
    try { localStorage.setItem("bdv-player-snap", pt); } catch { /* ignore */ }
    setIsSnapping(true);
    updatePos(snapToPos(pt, w, h));
    setTimeout(() => setIsSnapping(false), 400);
  }

  // After mount: measure real element size → re-snap to saved point
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    updatePos(snapToPos(getSavedSnap(), el.offsetWidth, el.offsetHeight));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-snap on window resize so the player stays in place
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
    const pt = nearestSnap(posRef.current.x, posRef.current.y, el.offsetWidth, el.offsetHeight);
    snapTo(pt, el.offsetWidth, el.offsetHeight);
  }

  return (
    <div
      ref={elRef}
      style={{
        position:         "fixed",
        left:             pos.x,
        top:              pos.y,
        zIndex:           9999,
        transition:       isSnapping
          ? "left 0.30s cubic-bezier(0.34,1.56,0.64,1), top 0.30s cubic-bezier(0.34,1.56,0.64,1)"
          : "none",
        touchAction:      "none",
        userSelect:       "none",
        WebkitUserSelect: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Drag-grip handle */}
      <div
        style={{
          display:        "flex",
          justifyContent: "center",
          alignItems:     "center",
          paddingBottom:  3,
          cursor:         isDragging ? "grabbing" : "grab",
        }}
        title="Drag to move"
      >
        <GripHorizontal
          size={14}
          style={{ color: `${GOLD_GLOW}0.50)` }}
        />
      </div>

      {/* Player */}
      <div style={{ cursor: isDragging ? "grabbing" : "grab" }}>
        <NavThemePlayer />
      </div>
    </div>
  );
}
