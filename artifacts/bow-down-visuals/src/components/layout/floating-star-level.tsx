import { useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { useUserMode, type StarLevel } from "@/contexts/UserModeContext";
import { useAuth } from "@/contexts/AuthContext";
import { STAR_RANKS } from "@/lib/creator-level";

const POS_KEY = "bdv_star_widget_snap";

/* 12 snap slots: 4 columns × 3 rows. Margin keeps the widget fully on screen. */
const COLS = 4;
const ROWS = 3;
const MARGIN = 12;
const WIDGET_W = 76;
const WIDGET_H = 64;

function snapSlots(): { x: number; y: number }[] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const slots: { x: number; y: number }[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = MARGIN + (c / (COLS - 1)) * (w - MARGIN * 2 - WIDGET_W);
      const y = MARGIN + (r / (ROWS - 1)) * (h - MARGIN * 2 - WIDGET_H);
      slots.push({ x: Math.round(x), y: Math.round(y) });
    }
  }
  return slots;
}

function nearestSlot(x: number, y: number): number {
  const slots = snapSlots();
  let best = 0;
  let bestDist = Infinity;
  slots.forEach((s, i) => {
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

/** Clamp a slot index's position so the widget can never leave the viewport. */
function slotPos(i: number): { x: number; y: number } {
  const s = snapSlots()[Math.min(Math.max(0, i), COLS * ROWS - 1)];
  return {
    x: Math.min(Math.max(MARGIN, s.x), window.innerWidth - WIDGET_W - MARGIN),
    y: Math.min(Math.max(MARGIN, s.y), window.innerHeight - WIDGET_H - MARGIN),
  };
}

/**
 * Floating draggable creator-level widget — admin only.
 * Snaps to one of 12 screen slots, never leaves the viewport, position persists.
 * Tap to expand and switch the creator level (1–6).
 */
export function FloatingStarLevel() {
  const { stars, maxStars, setStars } = useUserMode();
  const { profile } = useAuth();
  const [slot, setSlot] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw !== null) {
        const n = parseInt(raw, 10);
        if (n >= 0 && n < COLS * ROWS) return n;
      }
    } catch { /* ignore */ }
    return 7; /* default: middle-right */
  });
  const [expanded, setExpanded] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);

  /* Only the site owner (admin) sees this. */
  const isAdmin = profile?.plan === "studio";

  useEffect(() => {
    try { localStorage.setItem(POS_KEY, String(slot)); } catch { /* ignore */ }
  }, [slot]);

  /* Keep the widget on screen when the viewport resizes. */
  useEffect(() => {
    const onResize = () => setSlot((s) => Math.min(s, COLS * ROWS - 1));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!isAdmin) return null;

  const p = dragPos ?? slotPos(slot);

  function onPointerDown(e: React.PointerEvent) {
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      origX: p.x, origY: p.y, moved: false,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 8) d.moved = true;
    if (d.moved) {
      /* Free drag, hard-clamped to the viewport — never off screen. */
      setDragPos({
        x: Math.min(Math.max(MARGIN, d.origX + dx), window.innerWidth - WIDGET_W - MARGIN),
        y: Math.min(Math.max(MARGIN, d.origY + dy), window.innerHeight - WIDGET_H - MARGIN),
      });
    }
  }
  function onPointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) {
      setExpanded((v) => !v);
      setDragPos(null);
    } else if (dragPos) {
      /* Snap to the nearest of the 12 slots on release. */
      setSlot(nearestSlot(dragPos.x, dragPos.y));
      setDragPos(null);
    }
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="fixed z-[9999] select-none touch-none"
      style={{
        left: p.x,
        top: p.y,
        transition: dragPos ? "none" : "left 0.18s ease-out, top 0.18s ease-out",
      }}
      data-testid="floating-star-level"
      title="Creator level — drag to move, tap to change level"
    >
      <div className="flex flex-col items-center gap-1 rounded-2xl border border-primary/40 bg-black/90 px-2.5 py-2 shadow-[0_0_20px_rgba(218,165,32,0.4)] backdrop-blur cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-0.5">
          {([1, 2, 3, 4, 5, 6] as const).map((s) => (
            <Star
              key={s}
              className={`h-3.5 w-3.5 ${s <= stars ? "fill-primary text-primary" : "text-white/20"}`}
            />
          ))}
        </div>
        <span className="text-[10px] font-black text-primary uppercase leading-none whitespace-nowrap">
          Lv {stars} · {STAR_RANKS[stars - 1]}
        </span>
        {expanded && (
          <div className="flex items-center gap-1 pt-1" onPointerDown={(e) => e.stopPropagation()}>
            {([1, 2, 3, 4, 5, 6] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { if (s <= maxStars) { setStars(s as StarLevel); setExpanded(false); } }}
                disabled={s > maxStars}
                className={`h-7 w-7 rounded-full text-xs font-black transition-all ${
                  s === stars
                    ? "bg-primary text-black"
                    : s > maxStars
                      ? "text-white/20 cursor-not-allowed"
                      : "text-white/60 hover:bg-white/10"
                }`}
                aria-label={`Set level ${s}`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
