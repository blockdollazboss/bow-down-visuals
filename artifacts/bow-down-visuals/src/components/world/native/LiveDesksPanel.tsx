/* ─── The Screen panel's Go-Live desks, as one lazy unit ───────
   The seven Live desks (Live Wave I + II) plus the Live Shopping
   desk (parity wave 1) render only inside the
   World's Screen panel, yet they rode the /world first-load graph
   statically through pages/world.tsx. This wrapper exists so the
   page can hold them behind the same lazy() door the station
   panel uses (world-perf round 2, stack1200): the desks fetch on
   first Screen-panel open, once — hashed, cached for every later
   open. The desks themselves, their order and their rails are
   untouched; the page passes exactly what it used to pass down. */
import {
  LiveStudioDesk,
  LiveBackstageDesk,
  LiveGuestJoinDesk,
  LiveScheduleDesk,
  LiveControllerDesk,
  LiveWatchDesk,
  LivePremiereDesk,
  LiveSongRequestsDesk,
} from "./LiveDesk";
import { LiveShoppingDesk } from "./LiveShoppingDesk";
import { LiveCopilotDesk } from "./LiveCopilotDesk";
import { GamersDesk } from "./GamersDesk";

export interface LiveDesksPanelProps {
  isLight: boolean;
  screen: { mode: string; streamId: string | null } | null;
  onStreamChange: () => void;
}

export default function LiveDesksPanel({ isLight, screen, onStreamChange }: LiveDesksPanelProps) {
  return (
    /* Live Wave I (stack-100 #85–#87): the Go Live studio,
        its guests & backstage, and the guest door — in-world,
        on the 2D studio's own rails. This panel is members-only
        (!isGuest above), so palace guests never reach these
        desks and gain no voice from them. */
    <div className={`mt-4 space-y-5 border-t pt-4 ${isLight ? "border-[#C9A84C]/40" : "border-[#d4af37]/20"}`} data-testid="world-live-desks">
      <LiveStudioDesk isLight={isLight} onStreamChange={onStreamChange} />
      <LiveBackstageDesk isLight={isLight} />
      <LiveGuestJoinDesk isLight={isLight} />
      {/* Live Wave II (stack-100 #88–#91): scheduling, the
          Stream Controller deck, live-watch parity for the
          stream on the big screen, and premiere scheduling —
          same members-only panel, same real rails. */}
      <LiveScheduleDesk isLight={isLight} />
      <LiveControllerDesk isLight={isLight} />
      <LiveWatchDesk isLight={isLight} screen={screen} />
      <LivePremiereDesk isLight={isLight} />
      {/* Stack100 wave 3, item 17: Song Requests — the creator's
          queue desk (rules + the live queue doors) on the 2D
          surfaces' rails; the fan face rides inside the watch
          desk above. Same members-only panel, same one queue. */}
      <LiveSongRequestsDesk isLight={isLight} />
      {/* World parity wave 1, item 1: Live Shopping — pin products
          to a live selling session, the pinned card + purchase
          alerts + per-stream revenue, on the 2D page's own rails;
          buying is embedded-first with the by-design new-tab
          fallback (see LiveShoppingDesk). Same members-only panel. */}
      <LiveShoppingDesk isLight={isLight} />
      {/* Live Wave IV (stack100 B10): Stream Copilot + Live Stage
          automation — Copilot prep / clip-plan on their own rails
          (100 VB each, registry-priced, confirmed-spend door) and
          the Stage Manager / Auto-Highlights / Classes desk on
          /api/live-prefs + the per-stream stage rails. Same
          members-only panel. */}
      <LiveCopilotDesk isLight={isLight} />
      {/* Stack 100 wave 3, item 20: the Gamers Hub desk (#96) —
          the Home of Gamers idea engine on the Gamers page's own
          rail, registry-priced through confirmedFetch, its toolkit
          carried as a browse shelf (no page pull-ups). Same
          members-only panel. */}
      <GamersDesk isLight={isLight} />
    </div>
  );
}
