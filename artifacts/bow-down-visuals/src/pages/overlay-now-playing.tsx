import { useSearch } from "wouter";
import { NowPlayingCard } from "@/components/overlay/NowPlayingCard";
import { useNowPlayingFeed } from "@/lib/use-now-playing-feed";
import { useTransparentStage } from "@/lib/use-overlay-feed";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── /overlay/now-playing (stack900 lane D3) ─────────────────────────────
   The browser source a creator pastes into OBS / Streamlabs to show
   the track playing on their stream: a transparent page carrying
   only the now-playing card, fed by the studio's own reports
   through GET /api/overlay/now-playing. Renders nothing at all when
   no track is playing (or its reported window has lapsed) — the
   honest empty state is a clean program output. Token-keyed like
   the rest of the overlay family: /overlay/now-playing?token=…
   (&style=light for the light card). Routed OUTSIDE the app shell
   (App.tsx), like /overlay/alerts and /overlay/goal. */

export default function OverlayNowPlayingPage() {
  useTransparentStage();
  usePageTitle(
    "Stream now-playing overlay",
    "The Bow Down Visuals overlay for OBS and Streamlabs: the track playing on the creator's stream right now, shown as their studio reports it — title, artist, and progress.",
  );
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token");
  const style = params.get("style") === "light" ? "light" : "dark";
  const { nowPlaying, nowMs } = useNowPlayingFeed(token);

  return (
    <div
      data-testid="overlay-now-playing-page"
      className="fixed inset-0 flex items-end justify-start bg-transparent p-6"
    >
      <NowPlayingCard nowPlaying={nowPlaying} style={style} nowMs={nowMs} />
    </div>
  );
}
