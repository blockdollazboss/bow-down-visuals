import { Target } from "lucide-react";
import { formatVb, goalPercent, type OverlayStateData } from "@/lib/stream-overlay-client";

/* ─── Overlay tip-goal bar (stack900 lane C2) ─────────────────────────────
   The goal bar a creator's OBS / Streamlabs overlay shows. Same
   honesty rule as the in-studio widget: when no goal is set (or the
   creator has never streamed), this renders NOTHING — the program
   output stays clean rather than showing an invented bar. Explicit
   hex colors, like the alert card: a browser source doesn't carry
   the site's theme. */

export function OverlayGoalBar({
  state,
  style,
}: {
  state: OverlayStateData | null;
  style: "dark" | "light";
}) {
  if (!state) return null;
  const percent = goalPercent(state.goal);
  if (percent === null || state.goal.goalVb === null) return null;
  const light = style === "light";
  return (
    <div
      data-testid="overlay-goal-bar"
      className="pointer-events-none w-[min(92vw,430px)] rounded-2xl border-2 px-5 py-4 shadow-2xl"
      style={{
        backgroundColor: light ? "#FBF6E9" : "#12100C",
        borderColor: light ? "#C9A84C" : "#D4AF37",
        color: light ? "#2A1E07" : "#F7EFDB",
      }}
    >
      <div className="flex items-center gap-2">
        <Target
          className="h-5 w-5"
          style={{ color: light ? "#7A5A12" : "#E8C86A" }}
          aria-hidden
        />
        <span
          className="text-[11px] font-black uppercase tracking-[0.18em]"
          style={{ color: light ? "#7A5A12" : "#E8C86A" }}
        >
          Tip goal
        </span>
        <span data-testid="overlay-goal-percent" className="ml-auto text-sm font-black">
          {percent}%
        </span>
      </div>
      <div
        className="mt-3 h-3.5 overflow-hidden rounded-full"
        style={{ backgroundColor: light ? "#E7DCC0" : "#2A251B" }}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Tip goal progress"
      >
        <div
          data-testid="overlay-goal-fill"
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${percent}%`,
            backgroundColor: light ? "#7A5A12" : "#D4AF37",
          }}
        />
      </div>
      <p className="mt-2 text-sm font-bold">
        {formatVb(state.goal.totalVb)} / {formatVb(state.goal.goalVb)} Visual Bucs
      </p>
      {state.latestFollower && (
        <p
          data-testid="overlay-goal-latest-follower"
          className="mt-1 text-xs font-semibold"
          style={{ color: light ? "#6B5B36" : "#CFC4A5" }}
        >
          Latest follower — {state.latestFollower.displayName}
        </p>
      )}
    </div>
  );
}
