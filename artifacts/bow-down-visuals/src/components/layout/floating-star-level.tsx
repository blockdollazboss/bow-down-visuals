import { useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { useUserMode, type StarLevel } from "@/contexts/UserModeContext";
import { useAuth } from "@/contexts/AuthContext";
import { STAR_RANKS } from "@/lib/creator-level";

const POS_KEY = "bdv_star_widget_pos";

/**
 * Floating draggable creator-level widget — admin only.
 * Always shows the current star level, lets the owner tap to switch levels,
 * and can be dragged anywhere on screen. Position persists in localStorage.
 */
export function FloatingStarLevel() {
  const { stars, maxStars, setStars } = useUserMode();
  const { profile } = useAuth();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const elRef = useRef<HTMLDivElement>(null);

  /* Only the site owner (admin) sees this. */
  const isAdmin = profile?.plan === "studio";
  useEffect(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) setPos(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (pos) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
    }
  }, [pos]);

  if (!isAdmin) return null;

  const defaultPos = { x: window.innerWidth - 76, y: window.innerHeight - 180 };
  const p = pos ?? defaultPos;

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
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
    if (d.moved) {
      setPos({
        x: Math.min(Math.max(0, d.origX + dx), window.innerWidth - 60),
        y: Math.min(Math.max(0, d.origY + dy), window.innerHeight - 60),
      });
    }
  }
  function onPointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) setExpanded((v) => !v);
  }

  return (
    <div
      ref={elRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="fixed z-[9999] select-none touch-none"
      style={{ left: p.x, top: p.y }}
      data-testid="floating-star-level"
      title="Creator level — drag to move, tap to change"
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
        <span className="text-[10px] font-black text-primary uppercase leading-none">
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
