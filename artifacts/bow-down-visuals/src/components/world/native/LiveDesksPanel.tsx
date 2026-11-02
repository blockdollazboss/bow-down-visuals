/* ─── The Screen panel's Go-Live desks, as one lazy unit ───────
   The seven Live desks (Live Wave I + II) render only inside the
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
} from "./LiveDesk";

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
    </div>
  );
}
