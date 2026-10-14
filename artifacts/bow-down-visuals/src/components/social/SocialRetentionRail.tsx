import ContestHubWidget from "@/components/challenges/ContestHubWidget";
import { DailyDropCard } from "@/components/DailyDropCard";
import FomoFeed from "@/components/FomoFeed";
import LeaderboardWidget from "@/components/retention/LeaderboardWidget";

/* ─── SocialRetentionRail ────────────────────────────────────────────────
   The community retention stack for the Social feed (/home): the weekly
   challenge hub first (the deadline lives where the community scrolls),
   then the daily drop, the live activity feed, and the weekly leaderboard — the surfaces
   that used to live only on the private dashboard, now where the people
   are. Every widget keeps its own data loading and its own off switch
   (Settings → Retention, or the in-widget toggles): this wrapper adds no
   pref logic of its own, it only places them. Mounted once per page —
   unmounting (e.g. switching to the Drops view) stops FomoFeed's polling. */
export function SocialRetentionRail({
  getToken,
}: {
  getToken: () => Promise<string | null>;
}) {
  return (
    <div className="space-y-4" data-testid="social-retention-rail">
      <ContestHubWidget />
      <DailyDropCard />
      <FomoFeed getToken={getToken} />
      <LeaderboardWidget />
    </div>
  );
}
