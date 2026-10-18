import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { Star } from "lucide-react";
import { useUserMode } from "@/contexts/UserModeContext";
import { useAuth } from "@/contexts/AuthContext";
import { STAR_RANKS } from "@/lib/creator-level";
import { DraggableWidget } from "@/components/draggable-widget";

/**
 * Floating draggable creator-rank widget — admin only.
 * Uses the shared 40-position snap grid, position persists.
 * Display only: stars are EARNED rank (server-computed from recorded
 * work) — there is no dial and nothing here can set a level.
 */
export function FloatingStarLevel() {
  const isLight = useIsLightTheme();
  const { stars, rank } = useUserMode();
  const { profile } = useAuth();

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
        className={`flex flex-col items-center gap-1 rounded-2xl border border-primary/40 px-2.5 py-2 shadow-[0_0_20px_rgba(218,165,32,0.4)] backdrop-blur ${isLight ? "bg-[#FBF6E9]/95" : "bg-[#171208]/90"}`}
        data-testid="floating-star-level"
        title="Your earned Creator Rank — stars come from your work, not a dial"
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
        {rank != null && (
          <span className="text-[9px] font-bold text-white/40 leading-none whitespace-nowrap">
            {rank.points} pts earned
          </span>
        )}
      </div>
    </DraggableWidget>
  );
}
