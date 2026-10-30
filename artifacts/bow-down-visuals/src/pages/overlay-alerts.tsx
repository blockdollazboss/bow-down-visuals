import { useSearch } from "wouter";
import { OverlayAlertCard } from "@/components/overlay/OverlayAlertCard";
import { useOverlayFeed, useTransparentStage } from "@/lib/use-overlay-feed";

/* ─── /overlay/alerts (stack900 lane C2) ──────────────────────────────────
   The browser source a creator pastes into OBS / Streamlabs: a
   transparent page that pops a card when a tip lands, a fan
   follows, or a member joins their channel. Routed OUTSIDE the app
   shell (App.tsx) — no sidebar, no chat, no furniture; the page is
   the program output. The token in the URL is the only credential:
   /overlay/alerts?token=…  (&style=light for the light card). */

export default function OverlayAlertsPage() {
  useTransparentStage();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token");
  const style = params.get("style") === "light" ? "light" : "dark";
  const { currentAlert, currentKey } = useOverlayFeed(token);

  return (
    <div
      data-testid="overlay-alerts-page"
      className="fixed inset-0 flex items-end justify-center bg-transparent p-6"
    >
      {currentAlert && (
        <OverlayAlertCard key={currentKey} alert={currentAlert} style={style} />
      )}
    </div>
  );
}
