import { apiErrorMessage } from "../../lib/api-error";
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  X, Loader2, Crown, Users,
  Gift, Flame, LogIn, DoorOpen, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { PalaceStation } from "@/lib/world/stations";
import type { PanelPayload } from "@/lib/world/panel-payload";
import {
  resolveStationPanel,
  editorStepthroughSearch,
} from "@/lib/world/station-panel";
import {
  NativeLoadingState,
  NativePlaceholder,
  TransferFooter,
  NowPlayingCard,
  useShelfPlayer,
  type ShelfPlayerController,
} from "@/components/world/native";
import { creatorSlugFromRoomId } from "@/lib/world/palace-layout";
import type { PalaceDirectoryEntry, WorldJukeboxState } from "@/lib/world/world-client";
import { fetchPublicCourt, type CourtMember } from "@/lib/royal-court";
import { GUEST_SIGN_IN_HREF } from "@/lib/world/guest-honest";

/* ─── StationPanel — the palace's doors, opened ──────────────────────
   A door-station's panel under registry v2 (NATIVE-PLAN §3.0): a
   station NEVER mounts a website page component. Opening a station
   resolves through `resolveStationPanel` to exactly one of: the
   guest pitch (members-only door, guest walker), a native surface
   (its pattern's instrument, framed by the standard transfer
   footer), one of the six world-native custom panels, or (the one
   heavy desk) the step-through. The old in-panel page router is
   GONE (plan Step 8): no target, link, or custom panel can mount a
   website page in here anymore — the website is reachable only
   through the explicit transfer doors (the footer peek, the
   standing switch in the world chrome). Guests at a members-only
   door get the pitch and the sign-in ask — sign-in itself
   deliberately lives on the site, not in a 3D panel (the plan's
   phishing-hygiene refusal). */

/** What the panel is showing: a station. (The bare-page target
 *  kind died with the in-panel router at Step 8.) The optional
 *  payload (Stack-100 #2 item 97, lib/world/panel-payload) is the
 *  handoff context a panel swap carries — a template/state
 *  reference the opening desk defensively parses for its own
 *  station id and prefills from; absent or garbage, the desk
 *  opens blank exactly as it always has. */
export type StationPanelTarget = {
  kind: "station";
  station: PalaceStation;
  payload?: PanelPayload | null;
};

export interface StationPanelProps {
  target: StationPanelTarget;
  isLight: boolean;
  isGuest: boolean;
  onClose: () => void;
  /* The Kingdom Board's data + the room the walker stands in. */
  directory: PalaceDirectoryEntry[];
  currentRoomId: string;
  /** The King's daily moment line (Ring 3) for the Kingdom Board's
   *  "Today at the palace" block — the page builds it from the
   *  hall's standing kingMoment state. Null/absent = no court
   *  stands; the block renders exactly as before. */
  kingLine?: string | null;
  /* The Music Hall jukebox: the room's state, the last refusal in
     plain words, and the transport intents (the client enforces
     the room's rules; the server re-verifies). */
  jukebox: WorldJukeboxState | null;
  jukeboxDenied: string | null;
  myPeerId: string | null;
  isAdmin: boolean;
  /** The creator's most recent editor project, resolved by the
   *  page when the editor door opens: the step-through seeds the
   *  editor's location with ?project=<id> so it opens where they
   *  left off. Null (or still loading) → the editor opens fresh. */
  editorProjectId?: string | null;
  /** A party summons (program 2.23): the walker landed on a
   *  /world?party=CODE invite; the page verified the table against
   *  the server and threads the result here for the Marble Table.
   *  Null when this visit carries no invite. */
  partyInvite?: { code: string; room: import("@/lib/world/games-lobby").PartyOpenRoom | null } | null;
  /** The Kingdom Board's party-tables Join (program 2.23): the
   *  board names a table off the server's open-rooms rail and the
   *  page seats the walker through the same summons machinery a
   *  /world?party=CODE landing uses. Optional — hosts without it
   *  leave the board's tables look-only. */
  onJoinPartyTable?: (room: import("@/lib/world/games-lobby").PartyOpenRoom) => void;
  /** The Create desks' Send-to-the-editor chip: step through to the
   *  Visual Vibes editor station (the page swaps the panel target;
   *  the step-through's newest-project seed resolves on open, and
   *  the desk has just saved its result as that project). Optional —
   *  hosts without an editor door simply don't offer the chip. */
  onOpenEditorStation?: () => void;
  /** World Ring 2 (2.20): open another station's panel in-world by
   *  registry id — the Quest Board's "Go do it" rides this to the
   *  desk that performs the quest (the same panel-swap the Create
   *  desks' editor chip uses, generalized). Optional — hosts
   *  without it leave quest actions as explicit transfers. The
   *  optional payload (Stack-100 #2 item 97) carries a handoff's
   *  template/state reference into the opening desk. */
  onOpenStation?: (stationId: string, payload?: PanelPayload | null) => void;
  /** The Palace Calendar's walk (3.9): carry the walker into the
   *  named room — a palace room id, or a creator room
   *  ("creator:<slug>", which the page walks through its doorway
   *  transfer). Optional — hosts without it leave the Kingdom
   *  Board's calendar look-only. */
  onEnterRoom?: (roomId: string) => void;
  /** Creator Rooms (Ring 2, 3.5): the Courtyard arch panel's pick —
   *  the page registers the room's floor plan, dresses the scene
   *  and runs the doorway transfer. Optional — a host without it
   *  leaves the directory as a look-only board. */
  onEnterCreatorRoom?: (slug: string) => void;
  /** The signed-in walker's own profile slug — the arch panel
   *  pins "Your room" first when it matches a listed room. */
  mySlug?: string | null;
  /** Creator Room dressing (Ring 4): the room's host changed its
   *  dressing from the in-room picker — the page drops its cached
   *  room read and re-dresses the scene. Optional — a host
   *  without it leaves the pick saved server-side, worn on the
   *  next entry. */
  onRoomDressingChanged?: (slug: string) => void;
  onJukeboxAdd: (trackId: string) => void;
  onJukeboxPlayPause: (playing: boolean) => void;
  onJukeboxSkip: () => void;
  onJukeboxRemove: (entryId: string) => void;
  /* The Shelf player (NATIVE-PLAN §3.2): THE one in-world personal
     player, in the jukebox's prop shape — a world page that wants
     playback to survive the panel closing may hoist useShelfPlayer
     and pass its controller in here; otherwise the host owns one
     for the panel's life and every native surface in it (the
     Listening Booth today, the Charts board's Play next) plays
     through the same instance. */
  shelfPlayer?: ShelfPlayerController;
}

/* The King's own Front Row is the Royal Court Chamber's standing
   gallery (the same public court the hall's stage honors read). */
const KING_COURT_SLUG = "thy-cheat-code";

/* The step-through's editor surface — the ONE website workbench
   the palace mounts, full-screen inside /world under the owner's
   step-through ruling (never a panel page; see StepThroughEditor
   below). The old in-panel page router (PANEL_PAGES + PanelRouter
   + the miss card) was deleted at plan Step 8. */
const PanelEditor = lazy(() => import("@/pages/video-editor"));

/* ─── Per-desk lazy doors (world-perf round 2, stack1200) ──────
   Round 1 moved the whole panel behind one lazy door, so a first
   station open fetched every desk at once. The heavy desks now
   ride their OWN chunks behind these doors: opening one station
   fetches only its desk (plus the shared frame that stays in this
   module — the sheet, the in-file boards, the kit). Ranked by
   rendered weight in the round-1 panel chunk and split where a
   desk serves one station (or one station stack) and stands
   independent of the panel's own state. Round 2 left the small
   doors (PacksDesk, SeasonMarksWall) and the frame kit static;
   round 4 (below) re-measured and reversed the two small-door
   calls — PacksDesk's own 8,474 B hid its EmbeddedCheckout +
   react-stripe chain (22,938 raw of frame), and SeasonMarksWall
   carries the CrownsChamber chain — so they take doors too. */
const PostOfficeDesk = lazy(() => import("@/components/world/native/SocialDesk").then((m) => ({ default: m.PostOfficeDesk })));
const CommunityHallBoard = lazy(() => import("@/components/world/native/SocialDesk").then((m) => ({ default: m.CommunityHallBoard })));
const ExploreDesk = lazy(() => import("@/components/world/native/SocialWave2").then((m) => ({ default: m.ExploreDesk })));
const MyProfileDesk = lazy(() => import("@/components/world/native/SocialWave2").then((m) => ({ default: m.MyProfileDesk })));
const GroupsDesk = lazy(() => import("@/components/world/native/GroupsDesk").then((m) => ({ default: m.GroupsDesk })));
const EventsDesk = lazy(() => import("@/components/world/native/EventsDesk").then((m) => ({ default: m.EventsDesk })));
const CollabsDesk = lazy(() => import("@/components/world/native/CollabsDesk").then((m) => ({ default: m.CollabsDesk })));
const ScenesDesk = lazy(() => import("@/components/world/native/ScenesDesk").then((m) => ({ default: m.ScenesDesk })));
const GrantsDesk = lazy(() => import("@/components/world/native/GrantsDesk").then((m) => ({ default: m.GrantsDesk })));
const TakeoversDesk = lazy(() => import("@/components/world/native/TakeoversDesk").then((m) => ({ default: m.TakeoversDesk })));
const LlcDesk = lazy(() => import("@/components/world/native/LlcDesk").then((m) => ({ default: m.LlcDesk })));
const CopyrightDesk = lazy(() => import("@/components/world/native/CopyrightDesk").then((m) => ({ default: m.CopyrightDesk })));
const BrandCalculatorDesk = lazy(() => import("@/components/world/native/BrandCalculatorDesk").then((m) => ({ default: m.BrandCalculatorDesk })));
const GamesPanel = lazy(() => import("@/components/world/native/GamesPanels").then((m) => ({ default: m.GamesPanel })));
const CreatorRoomsDirectory = lazy(() => import("@/components/world/native/CreatorRooms").then((m) => ({ default: m.CreatorRoomsDirectory })));
const CreatorRoomStation = lazy(() => import("@/components/world/native/CreatorRooms").then((m) => ({ default: m.CreatorRoomStation })));
const ChartsBoard = lazy(() => import("@/components/world/native/boards/ChartsBoard").then((m) => ({ default: m.ChartsBoard })));
const EarningsBoard = lazy(() => import("@/components/world/native/boards/EarningsBoard").then((m) => ({ default: m.EarningsBoard })));
const StudioBoard = lazy(() => import("@/components/world/native/boards/StudioBoard").then((m) => ({ default: m.StudioBoard })));
const JewelryBench = lazy(() => import("@/components/world/native/JewelryBench").then((m) => ({ default: m.JewelryBench })));
const SmartCardsStand = lazy(() => import("@/components/world/native/SmartCardsStand").then((m) => ({ default: m.SmartCardsStand })));
const MerchBench = lazy(() => import("@/components/world/native/MerchBench").then((m) => ({ default: m.MerchBench })));
const AccountDesk = lazy(() => import("@/components/world/native/TailDesks").then((m) => ({ default: m.AccountDesk })));
const AcademyDesk = lazy(() => import("@/components/world/native/AcademyDesk").then((m) => ({ default: m.AcademyDesk })));
const BriefDesk = lazy(() => import("@/components/world/native/BriefDesk").then((m) => ({ default: m.BriefDesk })));
const SocialProofDesk = lazy(() => import("@/components/world/native/SocialProofDesk").then((m) => ({ default: m.SocialProofDesk })));
const DjDesk = lazy(() => import("@/components/world/native/DjDesk").then((m) => ({ default: m.DjDesk })));
const SavedDesk = lazy(() => import("@/components/world/native/SavedDesk").then((m) => ({ default: m.SavedDesk })));
const SetlistDesk = lazy(() => import("@/components/world/native/SetlistDesk").then((m) => ({ default: m.SetlistDesk })));
const TemplatesDesk = lazy(() => import("@/components/world/native/TemplatesDesk").then((m) => ({ default: m.TemplatesDesk })));
const CatalogImportDesk = lazy(() => import("@/components/world/native/CatalogImportDesk").then((m) => ({ default: m.CatalogImportDesk })));
const TeamDesk = lazy(() => import("@/components/world/native/TeamDesk").then((m) => ({ default: m.TeamDesk })));
const TeamSeatsDesk = lazy(() => import("@/components/world/native/TeamSeatsDesk").then((m) => ({ default: m.TeamSeatsDesk })));
const MoveHomeDesk = lazy(() => import("@/components/world/native/MoveHomeDesk").then((m) => ({ default: m.MoveHomeDesk })));
const IdentitySetsDesk = lazy(() => import("@/components/world/native/IdentitySetsDesk").then((m) => ({ default: m.IdentitySetsDesk })));
const AdminDesk = lazy(() => import("@/components/world/native/AdminDesk").then((m) => ({ default: m.AdminDesk })));
const GiveawayContestsDesk = lazy(() => import("@/components/world/native/TailDesks").then((m) => ({ default: m.GiveawayContestsDesk })));
const JackpotDesk = lazy(() => import("@/components/world/native/TailDesks").then((m) => ({ default: m.JackpotDesk })));
const WinnersCirclePanel = lazy(() => import("@/components/world/native/WinnersCirclePanel").then((m) => ({ default: m.WinnersCirclePanel })));
const CourtGatheringBlock = lazy(() => import("@/components/world/native/CourtGatheringBlock").then((m) => ({ default: m.CourtGatheringBlock })));
const BeatsDesk = lazy(() => import("@/components/world/native/BeatsDesk").then((m) => ({ default: m.BeatsDesk })));
/* The pattern families round 1 believed rode the /world chunk:
   that was bundler homing, not an eager need — in the panel's own
   graph they are the heaviest remaining static web (the Create
   desks, the Shop stands, the Business desks, the Listening
   booth), so they take the same doors. One pattern each, props
   only — as independent as the desks above. */
const CreateDeskPanel = lazy(() => import("@/components/world/native/CreateDeskPanel").then((m) => ({ default: m.CreateDeskPanel })));
const ShopStand = lazy(() => import("@/components/world/native/ShopStands").then((m) => ({ default: m.ShopStand })));
const ListeningBooth = lazy(() => import("@/components/world/native/ListeningBooth").then((m) => ({ default: m.ListeningBooth })));
const BrandingKitDesk = lazy(() => import("@/components/world/native/BusinessDesks").then((m) => ({ default: m.BrandingKitDesk })));
const PressKitDesk = lazy(() => import("@/components/world/native/BusinessDesks").then((m) => ({ default: m.PressKitDesk })));
const PromoteDesk = lazy(() => import("@/components/world/native/BusinessDesks").then((m) => ({ default: m.PromoteDesk })));
const LabelPitchDesk = lazy(() => import("@/components/world/native/LabelPitchDesk").then((m) => ({ default: m.LabelPitchDesk })));
const EmailListDesk = lazy(() => import("@/components/world/native/EmailListDesk").then((m) => ({ default: m.EmailListDesk })));
const InterviewDesk = lazy(() => import("@/components/world/native/InterviewDesk").then((m) => ({ default: m.InterviewDesk })));
const TrendsDesk = lazy(() => import("@/components/world/native/TrendsDesk").then((m) => ({ default: m.TrendsDesk })));

/* ─── Round-4 doors (world-perf round 4, stack1200) ─────────────
   After round 3 the frame still statically carried every block
   that renders for exactly ONE custom panel (or one click inside
   one): the Treasury's drop card + catalog and quest widget +
   depths, the Kingdom Board's blocks (with the calendar block
   and the Pitch & Fix board riding inside), the Front Row's
   portrait card (with its tip rail and the money-desks-2 lib),
   the Packs desk (with the Stripe checkout chain), the Season
   Marks wall (with the Crowns chamber), and the Music Hall
   jukebox panel itself — extracted verbatim to native/
   JukeboxPanel.tsx with its listening-party section and their
   shelf/streaming chains. Each now rides its own chunk behind
   the same DeskDoor; the in-file sections that host them (the
   Treasury, the Kingdom Board, the Front Row gallery) stay in
   the frame, only their one-station blocks moved out. */
const DailyDropCard = lazy(() => import("@/components/DailyDropCard").then((m) => ({ default: m.DailyDropCard })));
const DailyDropCatalog = lazy(() => import("@/components/world/native/DailyDropCatalog").then((m) => ({ default: m.DailyDropCatalog })));
const QuestsWidget = lazy(() => import("@/components/QuestsWidget"));
const TreasuryQuestDepths = lazy(() => import("@/components/world/native/TreasuryQuestDepths").then((m) => ({ default: m.TreasuryQuestDepths })));
const KingdomBoardBlocks = lazy(() => import("@/components/world/native/KingdomBoardBlocks").then((m) => ({ default: m.KingdomBoardBlocks })));
const PortraitCard = lazy(() => import("@/components/world/native/PortraitCard").then((m) => ({ default: m.PortraitCard })));
const PacksDesk = lazy(() => import("@/components/world/native/PacksDesk").then((m) => ({ default: m.PacksDesk })));
const SeasonMarksWall = lazy(() => import("@/components/world/native/SeasonMarksWall").then((m) => ({ default: m.SeasonMarksWall })));
const JukeboxPanel = lazy(() => import("@/components/world/native/JukeboxPanel"));

/* The Suspense door a lazy desk renders behind: while its chunk
   lands, the desk's own loading state stands in its place — the
   house "Opening the desk…" line, never a blank hole or a fake
   empty (the empty-lie rule). */
function DeskDoor({ isLight, children }: { isLight: boolean; children: ReactNode }) {
  return <Suspense fallback={<NativeLoadingState isLight={isLight} />}>{children}</Suspense>;
}

/** A panel page that failed to load or render: said plainly, with
 *  a retry — never a blank frame dressed as a door. */
class PanelBoundary extends Component<
  { isLight: boolean; resetKey: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const isLight = this.props.isLight;
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <AlertTriangle className="h-7 w-7 text-[#d4af37]" />
        <p className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
          This desk wouldn&rsquo;t open in the palace
        </p>
        <p className={`max-w-sm text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          The feature itself is fine — the panel couldn&rsquo;t bring it in. Try the door again.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 bdv-touch-target"
        >
          Try again
        </button>
      </div>
    );
  }
}

/* The step-through editor, seeded with its deep link: inside the
   palace there is no real /video-editor URL, so the editor mounts
   under a memory router standing at /video-editor — its useSearch
   reads the seeded ?project= exactly as it reads the site's. When
   the resolved project lands a beat after the door opens, the seed
   updates in place and the editor's own load effect picks it up. */
function StepThroughEditor({ projectId }: { projectId: string | null }) {
  const search = editorStepthroughSearch(projectId);
  const loc = useMemo(
    () => memoryLocation({ path: "/video-editor", searchPath: search }),
    [search],
  );
  return (
    <Router hook={loc.hook}>
      <PanelEditor />
    </Router>
  );
}

/* ─── The guest pitch ────────────────────────────────────────────────
   A members-only door, met by a guest: the name, the pitch, and
   the sign-in ask. Sign-in itself is never rendered inside the
   palace (plan §3 — phishing hygiene), so the ask points at the
   site's own door. */
function GuestPitch({ station, isLight }: { station: PalaceStation; isLight: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <LogIn className="h-7 w-7 text-[#d4af37]" />
      <p className={`max-w-md text-sm ${isLight ? "text-[#6B5B36]" : "text-white/60"}`}>
        {station.tagline} This door is for members — it works with your own account, your own work,
        your own name on it.
      </p>
      <Link
        href={GUEST_SIGN_IN_HREF}
        className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black transition hover:scale-105 bdv-touch-target"
      >
        <LogIn className="h-4 w-4" /> Sign in to open it
      </Link>
      <p className={`max-w-sm text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        Signing in always happens on the site itself, never inside a palace panel — that&rsquo;s
        deliberate. You&rsquo;ll come back through the same door.
      </p>
    </div>
  );
}

/* ─── Custom panels: world-native, real data ───────────────────────── */

function KingdomBoard({
  directory,
  currentRoomId,
  isLight,
  isGuest,
  kingLine,
  onJoinPartyTable,
  onEnterRoom,
  onOpenStation,
}: {
  directory: PalaceDirectoryEntry[];
  currentRoomId: string;
  isLight: boolean;
  isGuest: boolean;
  kingLine?: string | null;
  onJoinPartyTable?: (room: import("@/lib/world/games-lobby").PartyOpenRoom) => void;
  onEnterRoom?: (roomId: string) => void;
  onOpenStation?: (stationId: string) => void;
}) {
  if (directory.length === 0) {
    return (
      <div>
        <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          The board is quiet — the directory hasn&rsquo;t spoken yet.
        </p>
        <DeskDoor isLight={isLight}><KingdomBoardBlocks directory={directory} isLight={isLight} isGuest={isGuest} kingLine={kingLine} onJoinPartyTable={onJoinPartyTable} currentRoomId={currentRoomId} onEnterRoom={onEnterRoom} onOpenStation={onOpenStation} /></DeskDoor>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {directory.map((r) => {
        const here = r.id === currentRoomId;
        const rowClass = `flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
          here
            ? "border-[#d4af37] bg-[#d4af37]/10"
            : isLight
              ? "border-[#C9A84C]/40 bg-white/50"
              : "border-white/10 bg-white/5"
        }`;
        const rowLabel = `${r.name}, ${r.count} ${r.count === 1 ? "person" : "people"}${r.live ? ", live now" : ""}${here ? ", you're here" : ""}`;
        const rowInner = (
          <>
            <span className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{r.name}</span>
            {r.live && (
              <span className="inline-flex items-center gap-1 text-[11px] font-black text-red-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> LIVE
              </span>
            )}
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              <Users className="h-3.5 w-3.5 text-[#d4af37]" />
              {r.count} {r.count === 1 ? "person" : "people"}
            </span>
            {here ? (
              <span className="text-[11px] font-black uppercase tracking-wide text-[#e8c86a]">You&rsquo;re here</span>
            ) : r.members.length > 0 ? (
              <span className={`max-w-[280px] truncate text-xs ${isLight ? "text-[#6B5B36]" : "text-white/45"}`}>
                {r.members.slice(0, 4).join(", ")}
                {r.count > 4 ? ` +${r.count - 4} more` : ""}
              </span>
            ) : null}
          </>
        );
        /* A row is a door when the host wires the walk (the same
           onEnterRoom the calendar's Walk button rides); without a
           host the board stays the look-only directory it was. */
        return onEnterRoom ? (
          <button
            key={r.id}
            type="button"
            data-testid="world-board-room"
            aria-current={here ? "true" : undefined}
            aria-label={rowLabel}
            onClick={() => onEnterRoom(r.id)}
            className={`w-full cursor-pointer text-left bdv-touch-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] ${isLight ? "focus-visible:ring-offset-[#FBF6E9]" : "focus-visible:ring-offset-[#070605]"} ${rowClass}`}
          >
            {rowInner}
          </button>
        ) : (
          <div key={r.id} data-testid="world-board-room" aria-current={here ? "true" : undefined} className={rowClass}>
            {rowInner}
          </div>
        );
      })}
      <p className={`px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        The board follows the palace live — {onEnterRoom ? "tap a room, or walk through a door, and your name moves with you" : "walk through a door and your name moves with you"}. Shows play on the
        hall&rsquo;s big screen; the Front Row sits in the Royal Court Chamber, east front door.
      </p>
      <DeskDoor isLight={isLight}><KingdomBoardBlocks directory={directory} isLight={isLight} isGuest={isGuest} kingLine={kingLine} onJoinPartyTable={onJoinPartyTable} currentRoomId={currentRoomId} onEnterRoom={onEnterRoom} onOpenStation={onOpenStation} /></DeskDoor>
    </div>
  );
}

function FrontRowGallery({
  isLight,
  isGuest,
  onPlayTrack,
}: {
  isLight: boolean;
  isGuest: boolean;
  /** Portrait Card Play seam: the host's jukebox.add intent. */
  onPlayTrack: (trackId: string) => void;
}) {
  const [members, setMembers] = useState<CourtMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  /* The Portrait Card (NATIVE-PLAN §3.4): a portrait click opens the
     creator's CARD in-world — never their profile page. The card
     carries its own /artist/:slug transfer footer. */
  const [selected, setSelected] = useState<CourtMember | null>(null);

  if (selected) {
    return (
      <DeskDoor isLight={isLight}>
        <PortraitCard
          member={selected}
          isLight={isLight}
          isGuest={isGuest}
          onPlayTrack={onPlayTrack}
          onBack={() => setSelected(null)}
        />
      </DeskDoor>
    );
  }

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchPublicCourt(KING_COURT_SLUG)
      .then((court) => {
        if (!cancelled) setMembers(court);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  if (failed) {
    return (
      <div className="flex flex-col items-start gap-2 px-1 py-3">
        <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          The gallery wouldn&rsquo;t load — the portraits are fine, the frame slipped.
        </p>
        <button
          type="button"
          onClick={() => setTick((n) => n + 1)}
          className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
        >
          Try again
        </button>
      </div>
    );
  }
  if (members === null) {
    return (
      <p className={`inline-flex items-center gap-2 px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> Hanging the portraits…
      </p>
    );
  }
  if (members.length === 0) {
    return (
      <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        The King&rsquo;s Front Row is unseated right now — the chairs are here, the portraits come with the court.
      </p>
    );
  }
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {members.map((m) => (
          <button
            key={m.profileId}
            type="button"
            data-testid="world-court-portrait"
            onClick={() => setSelected(m)}
            className={`group flex flex-col items-center gap-1.5 rounded-2xl border px-3 py-3 text-center transition ${
              isLight
                ? "border-[#C9A84C]/50 bg-white/60 hover:border-[#7A5A12]"
                : "border-[#d4af37]/25 bg-white/5 hover:border-[#d4af37]/70"
            }`}
          >
            {m.avatarUrl ? (
              <img
                src={m.avatarUrl}
                alt={m.displayName}
                className="h-14 w-14 rounded-full border-2 border-[#d4af37] object-cover"
              />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#d4af37] bg-gradient-to-br from-amber-300 to-amber-600 text-xl font-black text-black">
                {m.displayName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className={`w-full truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              {m.displayName}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-[#e8c86a]">
              <Crown className="h-3 w-3" /> Seat #{m.position}
            </span>
            <span className={`text-[11px] font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]/80"}`}>
              See their card →
            </span>
          </button>
        ))}
      </div>
      <p className={`px-1 pt-2 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        The King&rsquo;s Front Row — the honored creators, portrait by portrait. A portrait opens that
        creator&rsquo;s card, right here in the palace — their full profile waits on the card&rsquo;s
        own website link, only if you choose it.
      </p>
    </div>
  );
}

/* ─── The Treasury: the real drop rails (routes/bonus, retention) ──── */

interface BonusStatus {
  streak: number;
  canClaimDaily: boolean;
  dailyBonusBase: number;
  dailyBonusMilestone: number;
  bonusCredits: number;
  /* GET /api/bonus/status degradation flag: present when one store
     behind the endpoint is down and that side's fields are null. */
  degraded?: "profile" | "crates" | null;
}

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

function TreasuryDaily({
  isLight,
  onOpenStation,
}: {
  isLight: boolean;
  onOpenStation?: (stationId: string) => void;
}) {
  const authHeaders = useAuthHeaders();
  const { refreshProfile } = useAuth();
  const [status, setStatus] = useState<BonusStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/bonus/status", { headers: await authHeaders() });
      if (!res.ok) throw new Error("status");
      const s = (await res.json()) as BonusStatus;
      /* Profile-side degradation: everything this panel renders
         (streak, drop size, claim state, bonus balance) comes from
         the profile read — with it down there is nothing truthful to
         show, so the panel takes its failure state below. A
         crate-side degradation doesn't touch this panel at all. */
      if (s.degraded === "profile" || typeof s.streak !== "number") throw new Error("status");
      setStatus(s);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const claim = async () => {
    if (claiming) return;
    setClaiming(true);
    setNote(null);
    try {
      const res = await fetch("/api/bonus/claim-daily", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      });
      const data = (await res.json().catch(() => ({}))) as {
        claimed?: boolean;
        bonusGranted?: number;
        streak?: number;
        isStreakMilestone?: boolean;
      };
      if (data.claimed) {
        setNote(
          `Claimed — ${data.bonusGranted?.toLocaleString("en-US") ?? ""} Visual Bucs` +
            `${data.isStreakMilestone ? ", a streak milestone" : ""}. Day ${data.streak} of your streak.`,
        );
        refreshProfile();
        void load();
      } else {
        setNote("Today's drop is already claimed — the chest refills at midnight UTC.");
        void load();
      }
    } catch {
      setNote("The claim didn't land — the chest is untouched. Try again.");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        className={`rounded-2xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
      >
        {failed ? (
          <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
            The vault ledger wouldn&rsquo;t open — your streak and drops are safe on the real rails.
          </p>
        ) : status === null ? (
          <p className={`inline-flex items-center gap-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
            <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> Opening the vault ledger…
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 text-sm font-black">
              <Flame className="h-4 w-4 text-[#d4af37]" />
              {status.streak}-day streak
            </span>
            <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              Today&rsquo;s drop: {status.dailyBonusBase.toLocaleString("en-US")} Visual Bucs
              {(status.streak + 1) % 7 === 0 && status.canClaimDaily
                ? ` — and today is a milestone day (${status.dailyBonusMilestone.toLocaleString("en-US")})`
                : ""}
            </span>
            {status.bonusCredits > 0 && (
              <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                Bonus balance: {status.bonusCredits.toLocaleString("en-US")} VB
              </span>
            )}
            {status.canClaimDaily ? (
              <button
                type="button"
                data-testid="world-treasury-claim-daily"
                onClick={claim}
                disabled={claiming}
                className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
              >
                {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
                Claim today&rsquo;s drop
              </button>
            ) : (
              <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-4 py-2 text-sm font-bold text-[#e8c86a]">
                <Gift className="h-4 w-4" /> Claimed today — back tomorrow
              </span>
            )}
          </div>
        )}
        {note && (
          <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>
        )}
      </div>
      {/* The day's content drop rides the same rail it always has —
          the real card, in the vault. inWorld: its CTA is an
          explicit new-tab transfer, never a same-tab walk-out. */}
      <DeskDoor isLight={isLight}>
        <DailyDropCard inWorld />
      </DeskDoor>
      {/* The whole slate under the day's card (STACK-20 R2 #18):
          use any template, archive the ones you don't want. */}
      <DeskDoor isLight={isLight}>
        <DailyDropCatalog isLight={isLight} onOpenStation={onOpenStation} />
      </DeskDoor>
    </div>
  );
}

interface SharkDropDto {
  id: string;
  amount: number;
  droppedAt: string;
  expiresAt: string;
}

function TreasuryShark({ isLight }: { isLight: boolean }) {
  const authHeaders = useAuthHeaders();
  const { refreshProfile } = useAuth();
  const [crate, setCrate] = useState<{ available: boolean; nextHourIn: number } | null>(null);
  const [drop, setDrop] = useState<SharkDropDto | null>(null);
  const [dropState, setDropState] = useState<"loading" | "ready" | "failed">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    try {
      const [crateRes, dropRes] = await Promise.all([
        fetch("/api/bonus/hourly-crate-status", { headers: await authHeaders() }),
        fetch("/api/retention/shark-drop", { headers: await authHeaders() }),
      ]);
      if (crateRes.ok) setCrate((await crateRes.json()) as { available: boolean; nextHourIn: number });
      if (dropRes.ok) {
        const data = (await dropRes.json()) as { drop: SharkDropDto | null };
        setDrop(data.drop ?? null);
        setDropState("ready");
      } else {
        setDropState("failed");
      }
    } catch {
      setDropState("failed");
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const claimCrate = async () => {
    if (busy) return;
    setBusy("crate");
    setNote(null);
    try {
      const res = await fetch("/api/bonus/spin-wheel", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      });
      const data = (await res.json().catch(() => ({}))) as {
        spun?: boolean;
        prize?: number;
        label?: string;
        isJackpot?: boolean;
        nextHourIn?: number;
      };
      if (data.spun) {
        setNote(
          `The crate is yours — ${data.prize?.toLocaleString("en-US") ?? ""} Visual Bucs${data.isJackpot ? " — the JACKPOT" : ""}.`,
        );
        refreshProfile();
      } else {
        setNote("Someone in the kingdom beat you to this hour's crate — the next one drops at the top of the hour.");
      }
      void load();
    } catch {
      setNote("The crate didn't open — nothing was claimed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const claimDrop = async () => {
    if (busy || !drop) return;
    setBusy("drop");
    setNote(null);
    try {
      const res = await fetch("/api/retention/shark-drop/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ dropId: drop.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { claimed?: boolean; amount?: number; error?: string };
      if (res.ok && data.claimed) {
        setNote(`Shark drop claimed — ${(data.amount ?? drop.amount).toLocaleString("en-US")} Visual Bucs.`);
        setDrop(null);
        refreshProfile();
      } else {
        setNote(apiErrorMessage(data, "The drop slipped away — it may have expired."));
        void load();
      }
    } catch {
      setNote("The claim didn't land. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const mins = crate ? Math.max(1, Math.ceil(crate.nextHourIn / 60)) : null;
  return (
    <div className="space-y-2">
      <div
        className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
      >
        <span className="inline-flex items-center gap-2 text-sm font-black">
          <Gift className="h-4 w-4 text-[#d4af37]" /> The hourly crate
        </span>
        {crate === null ? (
          <span className={`inline-flex items-center gap-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
            <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> Checking the vault…
          </span>
        ) : crate.available ? (
          <>
            <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              Unclaimed — one per hour, for the whole kingdom. First hand takes it.
            </span>
            <button
              type="button"
              data-testid="world-treasury-claim-crate"
              onClick={claimCrate}
              disabled={busy !== null}
              className="ml-auto rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
            >
              {busy === "crate" ? "Opening…" : "Claim the crate"}
            </button>
          </>
        ) : (
          <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            Claimed this hour — the next crate lands in about {mins} min.
          </span>
        )}
      </div>

      <div
        className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
      >
        <span className="inline-flex items-center gap-2 text-sm font-black">
          <Crown className="h-4 w-4 text-[#d4af37]" /> Your shark drop
        </span>
        {dropState === "loading" ? (
          <span className={`inline-flex items-center gap-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
            <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> Listening for fins…
          </span>
        ) : dropState === "failed" ? (
          <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            The drop rail wouldn&rsquo;t answer — your drops are safe; the King&rsquo;s dice roll on their own schedule.
          </span>
        ) : drop ? (
          <>
            <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              {drop.amount.toLocaleString("en-US")} Visual Bucs, dropped for you — it slips away if it expires unclaimed.
            </span>
            <button
              type="button"
              data-testid="world-treasury-claim-drop"
              onClick={claimDrop}
              disabled={busy !== null}
              className="ml-auto rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
            >
              {busy === "drop" ? "Claiming…" : "Claim it"}
            </button>
          </>
        ) : (
          <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            No drop waiting right now — shark drops land on their own tide, at most two a week.
          </span>
        )}
      </div>
      {note && <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
    </div>
  );
}

function TreasuryQuests({
  isLight,
  onOpenStation,
}: {
  isLight: boolean;
  onOpenStation?: (stationId: string) => void;
}) {
  const { getAccessToken, refreshProfile } = useAuth();
  return (
    <div>
      <DeskDoor isLight={isLight}>
        <QuestsWidget
          getToken={getAccessToken}
          onBalanceChange={refreshProfile}
          inWorld
          onGoToStation={onOpenStation}
        />
      </DeskDoor>
      {/* Ring 2 depth: the trophy ledger, the full catalog with
          past weeks, and the week's standings — read from the
          retention rails, under the board's live objectives. */}
      <DeskDoor isLight={isLight}>
        <TreasuryQuestDepths isLight={isLight} />
      </DeskDoor>
    </div>
  );
}

/* ─── The host ─────────────────────────────────────────────────────── */

export default function StationPanel(props: StationPanelProps) {
  const { target, isLight, isGuest, onClose } = props;

  /* The Shelf player: one instance for the panel's whole life (or
     the caller's hoisted one, when passed) — see the prop note. */
  const internalShelfPlayer = useShelfPlayer();
  const shelfPlayer = props.shelfPlayer ?? internalShelfPlayer;

  /* Escape closes the door (the panel pattern, house-wide). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* The Studio Board's Continue: stepping through into the editor
     seeded with the CHOSEN project (not just the newest — that is
     the editor door's own seed, resolved by the page). Local to
     this host: the step-through frame below renders the same
     StepThroughEditor the editor door uses, and Return lands back
     on the board. Cleared whenever the panel's target changes. */
  const [boardProjectId, setBoardProjectId] = useState<string | null>(null);
  useEffect(() => {
    setBoardProjectId(null);
  }, [target]);

  const name = target.station.name;
  const tagline = target.station.tagline;

  /* Registry v2: a station target resolves ONCE, here, and every
     render below follows the resolution. Its union has no page
     variant — a station can never mount a website page component
     again. */
  const station = target.station;
  const resolution = resolveStationPanel(station, isGuest);

  /* The step-through: the one heavy desk (the Visual Vibes editor)
     opens full-screen INSIDE /world — no new tab, no lost place;
     the bar at the top is the way back to your exact spot. */
  if (resolution?.type === "stepthrough") {
    return (
      <div className="fixed inset-0 z-[70] flex flex-col bg-black" data-testid="world-station-stepthrough">
        <div
          className={`relative z-10 flex flex-wrap items-center gap-3 border-b px-4 py-2.5 ${
            isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9] text-[#2a1e07]" : "border-[#d4af37]/25 bg-[#070605] text-white"
          }`}
        >
          <span className="inline-flex items-center gap-2 text-sm font-black">
            <DoorOpen className="h-4 w-4 text-[#d4af37]" /> {name}
            <span className={`hidden text-xs font-semibold sm:inline ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              — stepped through, still in the palace
            </span>
          </span>
          <button
            type="button"
            data-testid="world-station-return"
            onClick={onClose}
            className="bdv-touch-target ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105"
          >
            <X className="h-4 w-4" /> Return to the palace
          </button>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <PanelBoundary isLight={isLight} resetKey={resolution.station.id}>
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center gap-2 text-white/60">
                  <Loader2 className="h-5 w-5 animate-spin text-[#d4af37]" />
                  <span className="text-sm font-semibold">Opening the editor…</span>
                </div>
              }
            >
              <StepThroughEditor projectId={props.editorProjectId ?? null} />
            </Suspense>
          </PanelBoundary>
        </div>
      </div>
    );
  }

  /* The Studio Board's step-through: the same full-screen editor
     frame as the editor door's, seeded with the board's chosen
     project; Return goes back to the board (the sheet below). */
  if (boardProjectId !== null && resolution?.type === "native" && station?.id === "my-studio") {
    return (
      <div className="fixed inset-0 z-[70] flex flex-col bg-black" data-testid="world-studio-stepthrough">
        <div
          className={`relative z-10 flex flex-wrap items-center gap-3 border-b px-4 py-2.5 ${
            isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9] text-[#2a1e07]" : "border-[#d4af37]/25 bg-[#070605] text-white"
          }`}
        >
          <span className="inline-flex items-center gap-2 text-sm font-black">
            <DoorOpen className="h-4 w-4 text-[#d4af37]" /> Visual Vibes Editor
            <span className={`hidden text-xs font-semibold sm:inline ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              — stepped through from {name}, still in the palace
            </span>
          </span>
          <button
            type="button"
            data-testid="world-studio-return"
            onClick={() => setBoardProjectId(null)}
            className="bdv-touch-target ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105"
          >
            <X className="h-4 w-4" /> Back to My Studio
          </button>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <PanelBoundary isLight={isLight} resetKey={`studio-${boardProjectId}`}>
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center gap-2 text-white/60">
                  <Loader2 className="h-5 w-5 animate-spin text-[#d4af37]" />
                  <span className="text-sm font-semibold">Opening the editor…</span>
                </div>
              }
            >
              <StepThroughEditor projectId={boardProjectId} />
            </Suspense>
          </PanelBoundary>
        </div>
      </div>
    );
  }

  const body = (() => {
    if (!station || !resolution) return null;
    switch (resolution.type) {
      case "guest-pitch":
        return <GuestPitch station={station} isLight={isLight} />;
      case "native":
        /* The station's pattern surface, framed below by the
           standard transfer footer (rendered once, by the host).
           Each shipped pattern surface renders here; a native
           station whose pattern hasn't shipped keeps the honest
           migration placeholder — never a silent pull-up, never
           a dead end. */
        if (resolution.pattern === "shelf") {
          return (
            <PanelBoundary isLight={isLight} resetKey={station.id}>
              <DeskDoor isLight={isLight}>
                <ListeningBooth
                  isLight={isLight}
                  shelfPlayer={shelfPlayer}
                  onJukeboxAdd={props.onJukeboxAdd}
                />
              </DeskDoor>
            </PanelBoundary>
          );
        }
        if (resolution.pattern === "social") {
          return (
            <PanelBoundary isLight={isLight} resetKey={station.id}>
              {station.id === "post-office" ? (
                <DeskDoor isLight={isLight}>
                  <PostOfficeDesk isLight={isLight} />
                </DeskDoor>
              ) : station.id === "community-hall" ? (
                <div className="flex flex-col gap-6">
                  <DeskDoor isLight={isLight}>
                    <CommunityHallBoard isLight={isLight} isGuest={isGuest} />
                  </DeskDoor>
                  {/* Explore + creator/work search (stack-100 #81):
                      the blended scene and the discovery box, on the
                      /api/explore + /api/discovery/search rails. */}
                  <DeskDoor isLight={isLight}>
                    <ExploreDesk isLight={isLight} />
                  </DeskDoor>
                  {/* Groups + forums (stack-100 #76/#77): the Hall's
                      promised crews, on the /api/groups rails. */}
                  <DeskDoor isLight={isLight}>
                    <GroupsDesk isLight={isLight} isGuest={isGuest} />
                  </DeskDoor>
                  {/* Events (stack1100 parity): the Hall slate's
                      promised third — browse / RSVP / host on the
                      /api/events rails, in the room. */}
                  <DeskDoor isLight={isLight}>
                    <EventsDesk isLight={isLight} isGuest={isGuest} />
                  </DeskDoor>
                  {/* Collabs (stack1100 parity): creator cards, the
                      100-Buc match report and requests on the
                      /api/collabs rails, in the room. */}
                  <DeskDoor isLight={isLight}>
                    <CollabsDesk isLight={isLight} isGuest={isGuest} />
                  </DeskDoor>
                  {/* Local Scenes (stack1500 parity wave #3): the
                      declared-city directory + each city's page —
                      creators, shows, scene chart — on the public
                      /api/discovery/scenes rails, in the room for
                      members and guests alike. */}
                  <DeskDoor isLight={isLight}>
                    <ScenesDesk isLight={isLight} />
                  </DeskDoor>
                  {/* Community Grants (stack1500 parity wave #3):
                      the monthly VB pool — read rounds, submit,
                      vote, report back — on the
                      /api/community-grants rails, in the room. */}
                  <DeskDoor isLight={isLight}>
                    <GrantsDesk isLight={isLight} isGuest={isGuest} />
                  </DeskDoor>
                </div>
              ) : (
                <NativePlaceholder station={station} isLight={isLight} />
              )}
            </PanelBoundary>
          );
        }
        if (resolution.pattern === "games") {
          return (
            <PanelBoundary isLight={isLight} resetKey={station.id}>
              <DeskDoor isLight={isLight}>
                <GamesPanel stationId={station.id} isLight={isLight} partyInvite={props.partyInvite ?? null} />
              </DeskDoor>
            </PanelBoundary>
          );
        }
        return (
          <PanelBoundary isLight={isLight} resetKey={station.id}>
            {resolution.pattern === "create" ? (
              <DeskDoor isLight={isLight}>
                <CreateDeskPanel
                  station={station}
                  isLight={isLight}
                  onJukeboxAdd={props.onJukeboxAdd}
                  onOpenEditor={props.onOpenEditorStation}
                  shelfPlayer={shelfPlayer}
                  panelPayload={target.payload ?? null}
                />
              </DeskDoor>
            ) : resolution.pattern === "shop" ? (
              <DeskDoor isLight={isLight}>
                <ShopStand station={station} isLight={isLight} isGuest={isGuest} />
              </DeskDoor>
            ) : resolution.pattern === "board" && station.id === "charts-desk" ? (
              <div className="flex flex-col gap-6">
                <DeskDoor isLight={isLight}>
                  <ChartsBoard
                    isLight={isLight}
                    isGuest={isGuest}
                    jukeboxDenied={props.jukeboxDenied}
                    onPlayTrack={props.onJukeboxAdd}
                    shelfPlayer={shelfPlayer}
                  />
                </DeskDoor>
                {/* Takeovers (stack1500 parity wave #3): the
                    Spotlight + Loading Screen offers with their
                    inquiry forms on the public offer/inquire
                    rails — inquiries, never purchases — stacked
                    at the Charts board. */}
                <DeskDoor isLight={isLight}>
                  <TakeoversDesk isLight={isLight} />
                </DeskDoor>
              </div>
            ) : resolution.pattern === "board" && station.id === "get-paid-room" ? (
              <div className="flex flex-col gap-6">
                <DeskDoor isLight={isLight}>
                  <EarningsBoard isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
                {/* LLC Guide (stack1500 parity wave #3): ask +
                    filing plan on the /api/llc-guide rails at
                    the registry's 100 Bucs each, stacked at the
                    Get Paid board under Earnings. */}
                <DeskDoor isLight={isLight}>
                  <LlcDesk isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
                {/* Copyright Assistant (stack1500 parity wave
                    #3): registration draft + Q&A on the
                    /api/copyright rails at the registry's 100
                    Bucs each, stacked at the Get Paid board. */}
                <DeskDoor isLight={isLight}>
                  <CopyrightDesk isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
                {/* Brand Deal Calculator (stack1500 parity wave
                    #3): the rate card on the
                    /api/brand-calculator rail at the registry's
                    200 Bucs, stacked at the Get Paid board. */}
                <DeskDoor isLight={isLight}>
                  <BrandCalculatorDesk isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
              </div>
            ) : resolution.pattern === "board" && station.id === "my-studio" ? (
              <div className="flex flex-col gap-6">
                <DeskDoor isLight={isLight}>
                  <StudioBoard isLight={isLight} onContinueProject={(projectId) => setBoardProjectId(projectId)} />
                </DeskDoor>
                {/* Morning Brief (stack1500 parity wave #3): the
                    Command Center's written brief — summary + the
                    one drafted next move — on the free
                    /api/command/brief rail, stacked at the My
                    Studio board under the digest's raw halves. */}
                <DeskDoor isLight={isLight}>
                  <BriefDesk isLight={isLight} />
                </DeskDoor>
                {/* My public page (stack-100 #83/#84): view as a
                    visitor + the profile editor, on the creator-
                    profile rails. Members only — a guest never
                    reaches the board pattern (guest-pitch instead). */}
                <DeskDoor isLight={isLight}>
                  <MyProfileDesk isLight={isLight} />
                </DeskDoor>
                {/* Account settings (stack-100 #94): fields, cursor,
                    preference switches and the danger zone — export
                    completes here; deletion hands off to the 2D
                    settings confirmations by design. */}
                <DeskDoor isLight={isLight}>
                  <AccountDesk isLight={isLight} />
                </DeskDoor>
                {/* Social Proof (stack1500 parity wave #3): the
                    verified audience figures + their off switches
                    on the free /api/social-proof rails, stacked
                    at the My Studio board beside the account desk. */}
                <DeskDoor isLight={isLight}>
                  <SocialProofDesk isLight={isLight} />
                </DeskDoor>
                {/* Creator Academy (stack1400 parity wave #2): the
                    Academy family — the course catalog + AI learning
                    path / lessons / coach on the /api/academy rails,
                    the How-To Videos on the /api/tutorials rails, the
                    guides index read in-desk, and My Courses on the
                    /api/courses rails — stacked at the My Studio
                    board like the Hall's and Promote Room's stacked
                    desks. Members only, like the board itself and
                    like the locked /academy route on the website. */}
                <DeskDoor isLight={isLight}>
                  <AcademyDesk isLight={isLight} />
                </DeskDoor>
                {/* DJ Set Prep (stack1500 parity wave #3): tempo +
                    key analysis, crates, the harmonic order
                    proposal and Rekordbox/M3U export on the free
                    /api/dj rails, stacked at the My Studio board. */}
                <DeskDoor isLight={isLight}>
                  <DjDesk isLight={isLight} />
                </DeskDoor>
                {/* Saved (stack1500 parity wave #3): the bookmark
                    shelf — posts, tracks, videos, profiles — on
                    the /api/saves rails, stacked at the My Studio
                    board. */}
                <DeskDoor isLight={isLight}>
                  <SavedDesk isLight={isLight} />
                </DeskDoor>
                {/* Setlist Builder (stack1500 parity wave #3):
                    the free hand builder + the 100-Buc AI flow on
                    the /api/setlist/flow rail, stacked at the My
                    Studio board beside DJ Set Prep. */}
                <DeskDoor isLight={isLight}>
                  <SetlistDesk isLight={isLight} />
                </DeskDoor>
                {/* Templates (Stack-100 wave 4, item 27 / desk
                    #100): one browse desk for all four template
                    galleries (videos, hooks, captions, thumbnails)
                    folded from the site's own data libraries — a
                    card's Use rides the panel payload to the
                    owning desk (videos land on the Video Desk's
                    template bench through the video-template
                    payload kind), stacked at the My Studio board
                    in the Create Wing. */}
                <DeskDoor isLight={isLight}>
                  <TemplatesDesk isLight={isLight} onOpenStation={props.onOpenStation} />
                </DeskDoor>
                {/* Catalog Import (stack1500 parity wave #3):
                    bring your catalog home — scan, fetch,
                    rebuild, approve — on the free
                    /api/catalog-import rails, stacked at the My
                    Studio board. */}
                <DeskDoor isLight={isLight}>
                  <CatalogImportDesk isLight={isLight} />
                </DeskDoor>
                {/* Team Workspace (stack1500 parity wave #4a): the
                    Team family — my teams + invites, the shared
                    credit pool with funding, member roles, pool
                    spending and the duo/group public profile on the
                    /api/teams rails, in the room — stacked at the My
                    Studio board like its neighbours. Members only,
                    like the board itself and like the locked /team
                    route on the website; under Shot Caller the desk
                    renders the rail's own tier gate. */}
                <DeskDoor isLight={isLight}>
                  <TeamDesk isLight={isLight} />
                </DeskDoor>
                {/* Team Seats (stack1500 parity, wave 4a follow-on):
                    the Settings team-seats surface — account-level
                    collaborator seats (manager / collaborator /
                    viewer) on the /api/team-seats rails: permission
                    matrix, invite by email + the shareable link,
                    in-desk invite acceptance, role changes, revoke,
                    and the seats held on other accounts read-only.
                    FREE, like the 2D surface. COMPOSITION AT JOIN:
                    the wave-4a TeamDesk (stack1500/parity-team) mounts
                    at this same anchor on its branch; at join it lands
                    immediately before this door, so the Team Workspace
                    and Team Seats stand side by side in the My Studio
                    stack. Members only, like the board itself and
                    like the sign-in-gated /settings home. */}
                <DeskDoor isLight={isLight}>
                  <TeamSeatsDesk isLight={isLight} />
</DeskDoor>
                {/* Move Home (stack1500 parity wave #4b, census
                    item 31): the guided five-step setup — answers,
                    the free draft run, per-step previews + typed
                    editors, approve / skip / reopen — on the
                    /api/move-home rails, stacked at the My Studio
                    board. Members only, like the board itself. */}
                <DeskDoor isLight={isLight}>
                  <MoveHomeDesk isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
                {/* Identity sets (stack1500 parity wave #4b,
                    census item 38): each vault character's photo
                    set — coverage, add / relabel / remove (owner
                    only), and the pick-for-a-shot rail — on the
                    /api/artist-vaults identity rails, stacked at
                    the My Studio board. */}
                <DeskDoor isLight={isLight}>
                  <IdentitySetsDesk isLight={isLight} isGuest={isGuest} />
</DeskDoor>
                {/* Admin benches (stack1500 parity wave #5, census
                    item 46): the website's /admin benches native in
                    the palace — reports, DMCA, content removal,
                    Pitch & Fix, payment reversals, operator actions,
                    studio gear, challenges, community grants, Remix
                    King, the Bow Challenge, palace drops, spotlight,
                    contact, member admin and store orders — riding
                    the existing /api/admin rails. The desk probes the
                    same /admin/status answer the site enforces with
                    and every rail re-checks the ADMIN_EMAILS
                    allowlist server-side, fail-closed: a non-admin
                    session sees only the gate's own "Not authorized."
                    state, never a bench. */}
                <DeskDoor isLight={isLight}>
                  <AdminDesk isLight={isLight} />
                </DeskDoor>
              </div>
            ) : resolution.pattern === "business" && station.id === "branding-kit-desk" ? (
              <DeskDoor isLight={isLight}>
                <BrandingKitDesk isLight={isLight} isGuest={isGuest} />
              </DeskDoor>
            ) : resolution.pattern === "business" && station.id === "press-kit-desk" ? (
              <DeskDoor isLight={isLight}>
                <PressKitDesk isLight={isLight} isGuest={isGuest} />
              </DeskDoor>
            ) : resolution.pattern === "business" && station.id === "jewelry-bench" ? (
              <DeskDoor isLight={isLight}>
                <JewelryBench isLight={isLight} isGuest={isGuest} />
              </DeskDoor>
            ) : resolution.pattern === "business" && station.id === "smart-cards-stand" ? (
              <DeskDoor isLight={isLight}>
                <SmartCardsStand isLight={isLight} isGuest={isGuest} />
              </DeskDoor>
            ) : resolution.pattern === "business" && station.id === "merch-bench" ? (
              <DeskDoor isLight={isLight}>
                <MerchBench isLight={isLight} isGuest={isGuest} />
              </DeskDoor>
            ) : resolution.pattern === "business" && station.id === "promote-room" ? (
              <div className="flex flex-col gap-6">
                <DeskDoor isLight={isLight}>
                  <PromoteDesk isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
                {/* Label Pitch (stack1400 parity wave #1): the
                    label-pitch family — demo kit + directory +
                    tracker, playlist kit + curators + tracker, and
                    the release pitch packet + deadlines — on the
                    /api/label-pitch + /api/playlist-pitch rails,
                    stacked in the Promote Room like the Hall's and
                    Studio's stacked desks. */}
                <DeskDoor isLight={isLight}>
                  <LabelPitchDesk isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
                {/* Email List (stack1400 parity wave #2): the
                    email-list family — subscriber lists + stats,
                    segments, campaigns, the newsletter writer, the
                    four automations, and the read-only Fan Graph —
                    on the /api/email-list rails, stacked in the
                    Promote Room like the Hall's and Studio's
                    stacked desks. */}
                <DeskDoor isLight={isLight}>
                  <EmailListDesk isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
                {/* Interview Prep (stack1500 parity wave #3): the
                    media coach — practice sessions on the
                    /api/interview-prep rails (200 the session, 100
                    a scored answer), stacked in the Promote Room
                    like the desks above it. */}
                <DeskDoor isLight={isLight}>
                  <InterviewDesk isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
                {/* Trend Predictor (stack1500 parity wave #3):
                    the forecast + content ideas on the
                    /api/trend-predictor rails (200 / 100 via
                    the registry), stacked in the Promote Room;
                    the watchlist is the page's own local list. */}
                <DeskDoor isLight={isLight}>
                  <TrendsDesk isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
              </div>
            ) : (
              <NativePlaceholder station={station} isLight={isLight} />
            )}
          </PanelBoundary>
        );
      case "custom":
        switch (resolution.id) {
          case "kingdom-board":
            return (
              <KingdomBoard directory={props.directory} currentRoomId={props.currentRoomId} isLight={isLight} isGuest={isGuest} kingLine={props.kingLine} onJoinPartyTable={props.onJoinPartyTable} onEnterRoom={props.onEnterRoom} onOpenStation={props.onOpenStation} />
            );
          case "front-row":
            return (
              <div className="flex flex-col gap-6">
                <FrontRowGallery
                  isLight={isLight}
                  isGuest={isGuest}
                  onPlayTrack={props.onJukeboxAdd}
                />
                {/* Court gatherings (UPGRADE-PROGRAM 3.6): the
                    calling door stands in the Chamber itself,
                    under the portraits the gathering presents —
                    the winners-circle stacked-desks shape. */}
                <DeskDoor isLight={isLight}>
                  <CourtGatheringBlock isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
              </div>
            );
          case "season-marks":
            return (
              <DeskDoor isLight={isLight}>
                <SeasonMarksWall isLight={isLight} />
              </DeskDoor>
            );
          case "winners-circle":
            return (
              <div className="flex flex-col gap-6">
                <DeskDoor isLight={isLight}>
                  <WinnersCirclePanel isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
                {/* Giveaway contests (stack-100 #95): the 2D fan
                    giveaways (/api/contests) — a separate system from
                    World Contests above — on their own rails. */}
                <DeskDoor isLight={isLight}>
                  <GiveawayContestsDesk isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
                {/* The cheat-code jackpot (stack-100 #96): player
                    entry on the attempt rail + the admin creation
                    surface, fail-closed, on the cheat-code rails. */}
                <DeskDoor isLight={isLight}>
                  <JackpotDesk isLight={isLight} isGuest={isGuest} />
                </DeskDoor>
              </div>
            );
          case "treasury-daily":
            return <TreasuryDaily isLight={isLight} onOpenStation={props.onOpenStation} />;
          case "treasury-shark":
            return <TreasuryShark isLight={isLight} />;
          case "treasury-quests":
            return <TreasuryQuests isLight={isLight} onOpenStation={props.onOpenStation} />;
          case "treasury-packs":
            return (
              <DeskDoor isLight={isLight}>
                <PacksDesk isLight={isLight} />
              </DeskDoor>
            );
          case "beats-desk":
            return (
              <DeskDoor isLight={isLight}>
                <BeatsDesk isLight={isLight} isGuest={isGuest} />
              </DeskDoor>
            );
          case "jukebox":
            return (
              <DeskDoor isLight={isLight}>
                <JukeboxPanel {...props} />
              </DeskDoor>
            );
          case "creator-rooms":
            return (
              <DeskDoor isLight={isLight}>
                <CreatorRoomsDirectory
                  isLight={isLight}
                  mySlug={props.mySlug ?? null}
                  onEnterCreatorRoom={props.onEnterCreatorRoom ?? (() => undefined)}
                />
              </DeskDoor>
            );
          case "creator-music":
          case "creator-screen":
          case "creator-store":
          case "creator-front-row": {
            /* Inside a creator's room (3.5): the room the walker
             * stands in names the host — the slug rides the room
             * id itself. */
            const slug = creatorSlugFromRoomId(props.currentRoomId);
            if (!slug) {
              return (
                <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                  This door belongs to a creator&rsquo;s room — step through the King&rsquo;s Plaza
                  arch and pick whose place you&rsquo;re visiting.
                </p>
              );
            }
            return (
              <DeskDoor isLight={isLight}>
                <CreatorRoomStation
                  stationId={resolution.id}
                  slug={slug}
                  isLight={isLight}
                  isGuest={isGuest}
                  isOwnRoom={(props.mySlug ?? null) === slug}
                  onDressingChanged={props.onRoomDressingChanged}
                  mySlug={props.mySlug ?? null}
                  shelfPlayer={shelfPlayer}
                  onPlayTrack={props.onJukeboxAdd}
                />
              </DeskDoor>
            );
          }
          default:
            return (
              <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                This door isn&rsquo;t hung yet — the room is here, the feature is still on its way in.
              </p>
            );
        }
      default:
        /* "stepthrough" is narrowed out here — it returned
           full-screen above, before the sheet ever renders. */
        return null;
    }
  })();

  /* The sheet is anchored to the VIEWPORT, not the page: fixed at
     the bottom of the screen, capped in dvh, scrolling internally.
     It used to mount in page flow below the room box, where a desk
     opened half below the fold (owner's screenshot, 2026-10-27 —
     audit §B5); now it presents over the room the walker is
     standing in, the 3D world still visible above it, and because
     the cap + internal scroll are structural, async desk content
     growing the sheet can never push it off-screen — the clamp is
     the layout, not a scroll that has to be re-run. On desktop the
     sheet floats with a margin and rounded corners; on a phone it
     docks to the screen's bottom edge. The step-throughs above
     keep their own full-screen frame (z-[70], above this sheet). */
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 max-h-[86dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-16px_48px_rgba(0,0,0,0.45)] md:inset-x-6 md:bottom-4 md:rounded-2xl md:border ${
        isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9]" : "border-[#d4af37]/25 bg-[#070605]"
      }`}
      data-testid="world-station-panel"
      role="dialog"
      aria-label={name}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-2 text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
          <DoorOpen className="h-4 w-4 text-[#d4af37]" /> {name}
        </span>
        {tagline && (
          <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>{tagline}</span>
        )}
        <button
          type="button"
          data-testid="world-station-close"
          onClick={onClose}
          aria-label={`Close ${name}`}
          className={`bdv-touch-target ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
            isLight
              ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
              : "border-white/15 text-white/75 hover:text-white"
          }`}
        >
          <X className="h-3.5 w-3.5" /> Back to the room
        </button>
      </div>
      {/* The Shelf's Now Playing card: rendered by the host for
          whichever surface set the player (the Booth, the Charts
          board's Play, a creator room's music rail and screen) —
          one player, one card, above the station's own body. */}
      {(resolution?.type === "native" ||
        (resolution?.type === "custom" && resolution.id.startsWith("creator-"))) &&
        shelfPlayer.current && <NowPlayingCard player={shelfPlayer} isLight={isLight} />}
      {body}
      {/* The standard transfer footer — native panels only, exactly
          one, always the frame's last row (NATIVE-PLAN §3.0). The
          guest pitch carries its own sign-in transfer by design,
          and the customs keep the frames they have always had. */}
      {resolution?.type === "native" && (
        <TransferFooter
          context={resolution.station.tagline}
          websitePath={resolution.websitePath}
          isLight={isLight}
        />
      )}
    </div>
  );
}
