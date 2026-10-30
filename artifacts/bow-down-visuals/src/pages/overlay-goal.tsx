import { useSearch } from "wouter";
import { OverlayGoalBar } from "@/components/overlay/OverlayGoalBar";
import { useOverlayFeed, useTransparentStage } from "@/lib/use-overlay-feed";

/* ─── /overlay/goal (stack900 lane C2) ────────────────────────────────────
   The tip-goal browser source: a transparent page carrying only
   the goal bar (and the latest follower's name). Renders nothing at
   all until the creator has a stream with a goal set — the honest
   empty state is a clean program output. Token-keyed like the
   alerts page: /overlay/goal?token=…  (&style=light for light). */

export default function OverlayGoalPage() {
  useTransparentStage();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token");
  const style = params.get("style") === "light" ? "light" : "dark";
  const { state } = useOverlayFeed(token);

  return (
    <div
      data-testid="overlay-goal-page"
      className="fixed inset-0 flex items-start justify-start bg-transparent p-6"
    >
      <OverlayGoalBar state={state} style={style} />
    </div>
  );
}
