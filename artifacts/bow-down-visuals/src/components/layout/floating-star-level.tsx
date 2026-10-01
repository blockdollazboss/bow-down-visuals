import { useState } from "react";
import { Star } from "lucide-react";
import { useUserMode, type StarLevel } from "@/contexts/UserModeContext";
import { useAuth } from "@/contexts/AuthContext";
import { STAR_RANKS } from "@/lib/creator-level";
import { DraggableWidget } from "@/components/draggable-widget";

/**
 * Floating draggable creator-level widget — admin only.
 * Uses the shared 40-position snap grid, position persists.
 * Tap to expand and switch the creator level (1–6).
 */
export function FloatingStarLevel() {
  const { stars, maxStars, setStars } = useUserMode();
  const { profile } = useAuth();
  const [expanded, setExpanded] = useState(false);

  /* Only the site owner (admin) sees this. */
  const isAdmin = profile?.plan === "studio";
  if (!isAdmin) return null;

  return (
    <DraggableWidget
      id="star-level"
      defaultAnchor={{ x: 0.88, y: 0.5 }}
      zIndex={9999}
    >
      <div
        className="flex flex-col items-center gap-1 rounded-2xl border border-primary/40 bg-black/90 px-2.5 py-2 shadow-[0_0_20px_rgba(218,165,32,0.4)] backdrop-blur"
        data-testid="floating-star-level"
        title="Creator level — drag to move, tap to change level"
        onClick={() => setExpanded((v) => !v)}
      >
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
          <div
            className="flex items-center gap-1 pt-1"
            onClick={(e) => e.stopPropagation()}
          >
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
    </DraggableWidget>
  );
}
