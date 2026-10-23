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
  X, Loader2, Crown, Users, Play, Pause, SkipForward, XCircle,
  Gift, Flame, ListMusic, Plus, LogIn, DoorOpen, AlertTriangle,
  CalendarDays, ArrowUp, ArrowDown,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { PalaceStation } from "@/lib/world/stations";
import {
  resolveStationPanel,
  editorStepthroughSearch,
} from "@/lib/world/station-panel";
import {
  CreateDeskPanel,
  NativePlaceholder,
  TransferFooter,
  ListeningBooth,
  NowPlayingCard,
  ShopStand,
  useShelfPlayer,
  type ShelfPlayerController,
} from "@/components/world/native";
import { ChartsBoard, EarningsBoard, StudioBoard } from "@/components/world/native/boards";
import { PostOfficeDesk, CommunityHallBoard } from "@/components/world/native/SocialDesk";
import { PortraitCard } from "@/components/world/native/PortraitCard";
import {
  CreatorRoomsDirectory,
  CreatorRoomStation,
} from "@/components/world/native/CreatorRooms";
import { creatorSlugFromRoomId } from "@/lib/world/palace-layout";
import { GamesPanel } from "@/components/world/native/GamesPanels";
import { BrandingKitDesk, PressKitDesk, PromoteDesk } from "@/components/world/native/BusinessDesks";
import { jukeboxDeniedCopy } from "@/lib/world/jukebox-sync";
import {
  buildListeningPartyBody,
  listeningPartyErrorCopy,
  movePartyQueueItem,
  normalizeMyParties,
  parsePartyStartInput,
  partyStartInputValue,
  playlistQueueFold,
  togglePartyQueueItem,
  PARTY_DURATION_PRESETS_MIN,
  PARTY_QUEUE_MAX,
  type MyParty,
  type PartyQueueItem,
} from "@/lib/world/listening-party";
import { parseShelfPlaylists, type ShelfPlaylistSummary } from "@/lib/world/shelf";
import { fetchPlaylist } from "@/lib/streaming";
import type { PalaceDirectoryEntry, WorldJukeboxState } from "@/lib/world/world-client";
import { fetchPublicCourt, type CourtMember } from "@/lib/royal-court";
import { DailyDropCard } from "@/components/DailyDropCard";
import { DailyDropCatalog } from "@/components/world/native/DailyDropCatalog";
import { PacksDesk } from "@/components/world/native/PacksDesk";
import { BeatsDesk } from "@/components/world/native/BeatsDesk";
import QuestsWidget from "@/components/QuestsWidget";
import { TreasuryQuestDepths } from "@/components/world/native/TreasuryQuestDepths";
import { KingdomBoardBlocks } from "@/components/world/native/KingdomBoardBlocks";
import { SeasonMarksWall } from "@/components/world/native/SeasonMarksWall";
import { WinnersCirclePanel } from "@/components/world/native/WinnersCirclePanel";
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
 *  kind died with the in-panel router at Step 8.) */
export type StationPanelTarget = { kind: "station"; station: PalaceStation };

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
   *  without it leave quest actions as explicit transfers. */
  onOpenStation?: (stationId: string) => void;
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
          className="rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105"
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
        className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black transition hover:scale-105"
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
        <KingdomBoardBlocks directory={directory} isLight={isLight} isGuest={isGuest} kingLine={kingLine} onJoinPartyTable={onJoinPartyTable} currentRoomId={currentRoomId} onEnterRoom={onEnterRoom} onOpenStation={onOpenStation} />
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
            className={`w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] ${isLight ? "focus-visible:ring-offset-[#FBF6E9]" : "focus-visible:ring-offset-[#070605]"} ${rowClass}`}
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
      <KingdomBoardBlocks directory={directory} isLight={isLight} isGuest={isGuest} kingLine={kingLine} onJoinPartyTable={onJoinPartyTable} currentRoomId={currentRoomId} onEnterRoom={onEnterRoom} onOpenStation={onOpenStation} />
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
      <PortraitCard
        member={selected}
        isLight={isLight}
        isGuest={isGuest}
        onPlayTrack={onPlayTrack}
        onBack={() => setSelected(null)}
      />
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
          className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
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
                className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50"
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
      <DailyDropCard inWorld />
      {/* The whole slate under the day's card (STACK-20 R2 #18):
          use any template, archive the ones you don't want. */}
      <DailyDropCatalog isLight={isLight} onOpenStation={onOpenStation} />
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
        setNote(data.error ?? "The drop slipped away — it may have expired.");
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
              className="ml-auto rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50"
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
              className="ml-auto rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50"
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
      <QuestsWidget
        getToken={getAccessToken}
        onBalanceChange={refreshProfile}
        inWorld
        onGoToStation={onOpenStation}
      />
      {/* Ring 2 depth: the trophy ledger, the full catalog with
          past weeks, and the week's standings — read from the
          retention rails, under the board's live objectives. */}
      <TreasuryQuestDepths isLight={isLight} />
    </div>
  );
}

/* ─── The Music Hall jukebox ───────────────────────────────────────── */

interface JukeboxCatalogItem {
  id: string;
  title: string;
  creatorName: string | null;
  durationSec: number;
  artworkUrl: string | null;
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function JukeboxPanel(props: StationPanelProps) {
  const { jukebox, jukeboxDenied, isGuest, isLight, myPeerId, isAdmin } = props;
  const authHeaders = useAuthHeaders();
  const [catalog, setCatalog] = useState<{ mine: JukeboxCatalogItem[]; public: JukeboxCatalogItem[] } | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [tick, setTick] = useState(0);
  /* The displayed position advances locally from the last state
     stamp (the same derivation the room audio mirrors). */
  const [anchor, setAnchor] = useState<{ state: WorldJukeboxState | null; at: number }>({
    state: jukebox,
    at: Date.now(),
  });
  useEffect(() => {
    setAnchor({ state: jukebox, at: Date.now() });
  }, [jukebox]);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/world/jukebox-catalog", { headers: await authHeaders() });
        if (!res.ok) throw new Error("catalog");
        const data = (await res.json()) as { catalog: { mine: JukeboxCatalogItem[]; public: JukeboxCatalogItem[] } };
        if (!cancelled) setCatalog(data.catalog);
      } catch {
        if (!cancelled) setCatalogFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  const cur = jukebox?.current ?? null;
  const positionNow = cur
    ? cur.playback.positionSec +
      (cur.playback.playing ? Math.max(0, (Date.now() - anchor.at) / 1000) : 0)
    : 0;
  void tick;
  const canDrive = !!cur && (isAdmin || cur.entry.addedByPeerId === myPeerId);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const rowCls = `flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
    isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
  }`;
  const chipBtn = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;

  const catalogSection = (label: string, items: JukeboxCatalogItem[]) =>
    items.length === 0 ? null : (
      <div key={label}>
        <p className={`text-[11px] font-bold ${muted}`}>{label}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid="world-jukebox-add"
              onClick={() => props.onJukeboxAdd(item.id)}
              className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                isLight
                  ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                  : "border-white/15 text-white/75 hover:text-white"
              }`}
            >
              <Plus className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
              <span className="truncate">{item.title}</span>
              {item.creatorName ? <span className="opacity-60">· {item.creatorName}</span> : null}
              {item.durationSec > 0 ? <span className="opacity-50">{fmtClock(item.durationSec)}</span> : null}
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-3">
      {jukebox?.party ? (
        <div
          data-testid="world-jukebox-party"
          className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
            isLight ? "border-[#C9A84C]/60 bg-[#d4af37]/15" : "border-[#d4af37]/40 bg-[#d4af37]/10"
          }`}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#d4af37]/20">
            <CalendarDays className="h-5 w-5 text-[#d4af37]" />
          </span>
          <div className="min-w-0">
            <p className={`truncate text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              Listening party: {jukebox.party.title}
            </p>
            <p className={`truncate text-xs ${muted}`}>
              Hosted by {jukebox.party.hostName} — the queue below is the party&rsquo;s program until it ends.
            </p>
          </div>
        </div>
      ) : null}

      {cur ? (
        <div className={rowCls}>
          {cur.entry.track.artworkUrl ? (
            <img src={cur.entry.track.artworkUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#d4af37]/15">
              <ListMusic className="h-5 w-5 text-[#d4af37]" />
            </span>
          )}
          <div className="min-w-0">
            <p className={`truncate text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              {cur.entry.track.title}
            </p>
            <p className={`truncate text-xs ${muted}`}>
              {cur.entry.track.creatorName ? `${cur.entry.track.creatorName} · ` : ""}put on by {cur.entry.addedByName}
              {" · "}
              {cur.playback.playing ? "playing" : "paused"} at {fmtClock(positionNow)}
              {cur.entry.track.durationSec > 0 ? ` of ${fmtClock(cur.entry.track.durationSec)}` : ""}
            </p>
          </div>
          {canDrive ? (
            <span className="ml-auto inline-flex gap-1.5">
              <button
                type="button"
                data-testid="world-jukebox-playpause"
                onClick={() => props.onJukeboxPlayPause(!cur.playback.playing)}
                className={chipBtn}
              >
                {cur.playback.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {cur.playback.playing ? "Pause for the room" : "Play for the room"}
              </button>
              <button
                type="button"
                data-testid="world-jukebox-skip"
                onClick={() => props.onJukeboxSkip()}
                className={chipBtn}
              >
                <SkipForward className="h-3.5 w-3.5" /> Skip
              </button>
            </span>
          ) : (
            <span className={`ml-auto text-[11px] font-semibold ${muted}`}>
              The transport answers to {cur.entry.addedByName}
              {isAdmin ? "" : " — or the host"}.
            </span>
          )}
        </div>
      ) : (
        <p className={`px-1 text-sm ${muted}`}>
          The jukebox is quiet — no song on. Put the first one on and the whole room hears it together.
        </p>
      )}

      {jukebox && jukebox.queue.length > 0 && (
        <div className="space-y-1.5">
          <p className={`px-1 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            Up next
          </p>
          {jukebox.queue.map((entry, i) => (
            <div
              key={entry.entryId}
              className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
              }`}
            >
              <span className={`text-xs font-black ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{i + 1}</span>
              <span className={`min-w-0 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {entry.track.title}
              </span>
              <span className={`truncate text-xs ${muted}`}>
                {entry.track.creatorName ? `${entry.track.creatorName} · ` : ""}by {entry.addedByName}
              </span>
              {(isAdmin || entry.addedByPeerId === myPeerId) && (
                <button
                  type="button"
                  data-testid="world-jukebox-remove"
                  onClick={() => props.onJukeboxRemove(entry.entryId)}
                  className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                    isLight
                      ? "border-red-800/30 text-red-900/80 hover:text-red-900"
                      : "border-red-400/40 text-red-300 hover:text-red-200"
                  }`}
                >
                  <XCircle className="h-3 w-3" /> Pull it
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {jukeboxDenied && (
        <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {jukeboxDeniedCopy(jukeboxDenied)}
        </p>
      )}

      <div>
        <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          Put a song on
        </p>
        {isGuest ? (
          <p className={`mt-1.5 text-sm ${muted}`}>
            Guests listen in — <Link href={GUEST_SIGN_IN_HREF} className="font-bold text-[#d4af37] underline underline-offset-2">sign in</Link>{" "}
            to feed the jukebox. The queue is published songs only: yours, and everyone&rsquo;s on a public profile.
          </p>
        ) : catalogFailed ? (
          <p className={`mt-1.5 text-sm ${muted}`}>The song catalog wouldn&rsquo;t open — the jukebox itself still plays what&rsquo;s queued.</p>
        ) : catalog === null ? (
          <p className={`mt-1.5 inline-flex items-center gap-2 text-sm ${muted}`}>
            <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> Opening the catalog…
          </p>
        ) : catalog.mine.length + catalog.public.length === 0 ? (
          <p className={`mt-1.5 text-sm ${muted}`}>
            Nothing published to feed it yet — publish a song on a profile and it can play for the whole room.
          </p>
        ) : (
          <div className="mt-1.5 space-y-2">
            {catalogSection("Yours", catalog.mine)}
            {catalogSection("From the palace", catalog.public)}
          </div>
        )}
      </div>

      <ListeningPartySection
        isLight={isLight}
        isGuest={isGuest}
        catalog={catalog}
        authHeaders={authHeaders}
      />
    </div>
  );
}

/* ─── Listening parties (World Events 3.2) ──────────────────────────
   The booking door for the backbone the server already runs: a
   member books the Music Hall with a queue (their published songs —
   picked here one by one, or folded in from one of their site
   playlists), the palace board carries it, and at the hour the
   scheduler hands the queue to this room's jukebox under the host's
   name. All rules (window, queue cap, one event per room) are the
   server's; lib/world/listening-party mirrors them so the form
   refuses a bad booking in the same words before it round-trips. */

function fmtPartyWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function ListeningPartySection(props: {
  isLight: boolean;
  isGuest: boolean;
  catalog: { mine: JukeboxCatalogItem[]; public: JukeboxCatalogItem[] } | null;
  authHeaders: () => Promise<Record<string, string>>;
}) {
  const { isLight, isGuest, catalog, authHeaders } = props;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [startValue, setStartValue] = useState(() => partyStartInputValue(Date.now()));
  const [durationMin, setDurationMin] = useState<number>(60);
  const [queue, setQueue] = useState<PartyQueueItem[]>([]);
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<ShelfPlaylistSummary[] | null>(null);
  const [pickedPlaylist, setPickedPlaylist] = useState("");
  const [playlistNote, setPlaylistNote] = useState<string | null>(null);
  const [mine, setMine] = useState<MyParty[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const headingCls = `text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;
  const chipBtn = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;
  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]"
      : "border-white/10 bg-white/5 text-white [color-scheme:dark]"
  }`;

  const refreshMine = async () => {
    try {
      const res = await fetch("/api/world/events/mine", { headers: await authHeaders() });
      if (!res.ok) return;
      setMine(normalizeMyParties(await res.json(), Date.now()));
    } catch {
      /* The list is a courtesy read — a failure leaves the last one. */
    }
  };

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    void refreshMine();
    (async () => {
      try {
        const res = await fetch("/api/playlists/mine", { headers: await authHeaders() });
        if (!res.ok) return;
        const parsed = parseShelfPlaylists(await res.json());
        if (!cancelled) setPlaylists(parsed);
      } catch {
        if (!cancelled) setPlaylists([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  if (isGuest) {
    return (
      <div>
        <p className={headingCls}>Listening parties</p>
        <p className={`mt-1.5 text-sm ${muted}`}>
          Members book this hall for an hour and the room hears their queue together —{" "}
          <Link href={GUEST_SIGN_IN_HREF} className="font-bold text-[#d4af37] underline underline-offset-2">sign in</Link>{" "}
          to host one. Tonight&rsquo;s parties are on the palace board.
        </p>
      </div>
    );
  }

  const pickFromCatalog = (item: JukeboxCatalogItem) => {
    const result = togglePartyQueueItem(queue, {
      id: item.id,
      title: item.title,
      creatorName: item.creatorName,
      durationSec: item.durationSec,
    });
    if (result.outcome === "full") {
      setError(`The queue is full — ${PARTY_QUEUE_MAX} songs is a party's whole program.`);
      return;
    }
    setError(null);
    setQueue(result.queue);
  };

  const applyPlaylist = async () => {
    if (!pickedPlaylist) return;
    setBusy(true);
    setError(null);
    try {
      const got = await fetchPlaylist(pickedPlaylist);
      if (!got) {
        setError("That playlist wouldn't open — pick songs by hand instead.");
        return;
      }
      const fold = playlistQueueFold(got.playlist);
      if (fold.items.length === 0) {
        setError("None of that playlist's songs can ride the jukebox — it plays published tracks only.");
        return;
      }
      setQueue(fold.items);
      setPlaylistId(pickedPlaylist);
      setPlaylistNote(
        `${fold.items.length} song${fold.items.length === 1 ? "" : "s"} from “${got.playlist.title}” are in the queue.` +
          (fold.skipped > 0
            ? ` ${fold.skipped} item${fold.skipped === 1 ? "" : "s"} couldn't come along (videos and unpublished tracks stay behind).`
            : ""),
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setError(null);
    setNotice(null);
    const startsAtMs = parsePartyStartInput(startValue);
    if (startsAtMs === null) {
      setError("Pick a start time for the party.");
      return;
    }
    const built = buildListeningPartyBody(
      { title, startsAtMs, durationMin, queue, playlistId },
      Date.now(),
    );
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/world/events", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(built.body),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(listeningPartyErrorCopy(res.status, data));
        return;
      }
      setNotice(`Booked — the Music Hall is yours ${fmtPartyWhen(built.body.startsAt)}. It's on the palace board now.`);
      setOpen(false);
      setTitle("");
      setQueue([]);
      setPlaylistId(null);
      setPlaylistNote(null);
      await refreshMine();
    } catch {
      setError("The booking didn't land — nothing was scheduled. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (party: MyParty) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/world/events/${encodeURIComponent(party.id)}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        setError("That party wouldn't cancel — try again.");
        return;
      }
      setNotice(`“${party.title}” is cancelled — the slot is open again.`);
      await refreshMine();
    } catch {
      setError("That party wouldn't cancel — try again.");
    } finally {
      setBusy(false);
    }
  };

  const queueIndex = new Map(queue.map((q, i) => [q.id, i]));
  const pickSection = (label: string, items: JukeboxCatalogItem[]) =>
    items.length === 0 ? null : (
      <div key={label}>
        <p className={`text-[11px] font-bold ${muted}`}>{label}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {items.map((item) => {
            const at = queueIndex.get(item.id);
            const picked = at !== undefined;
            return (
              <button
                key={item.id}
                type="button"
                data-testid="world-party-pick"
                onClick={() => pickFromCatalog(item)}
                className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  picked
                    ? "border-[#d4af37] bg-[#d4af37]/20 text-[#d4af37]"
                    : isLight
                      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                      : "border-white/15 text-white/75 hover:text-white"
                }`}
              >
                {picked ? (
                  <span className="text-[10px] font-black">{at + 1}</span>
                ) : (
                  <Plus className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
                )}
                <span className="truncate">{item.title}</span>
                {item.durationSec > 0 ? <span className="opacity-50">{fmtClock(item.durationSec)}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className={headingCls}>Listening parties</p>
        {!open && (
          <button
            type="button"
            data-testid="world-party-open"
            onClick={() => {
              setOpen(true);
              setError(null);
              setNotice(null);
            }}
            className={`${chipBtn} ml-auto`}
          >
            <CalendarDays className="h-3.5 w-3.5 text-[#d4af37]" /> Book the hall
          </button>
        )}
      </div>

      {notice && (
        <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{notice}</p>
      )}

      {mine && mine.length > 0 && (
        <div className="space-y-1.5">
          {mine.map((party) => (
            <div
              key={party.id}
              data-testid="world-party-mine"
              className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
              }`}
            >
              <span className={`min-w-0 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {party.title}
              </span>
              <span className={`truncate text-xs ${muted}`}>
                {party.status === "live" ? "Live now" : fmtPartyWhen(party.startsAt)} · {party.trackCount} song
                {party.trackCount === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                data-testid="world-party-cancel"
                disabled={busy}
                onClick={() => void cancel(party)}
                className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                  isLight
                    ? "border-red-800/30 text-red-900/80 hover:text-red-900"
                    : "border-red-400/40 text-red-300 hover:text-red-200"
                }`}
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="space-y-3">
          <div>
            <label className={`text-[11px] font-bold ${muted}`} htmlFor="party-title">Party name</label>
            <input
              id="party-title"
              data-testid="world-party-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Album Night"
              className={`${inputCls} mt-1`}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="min-w-44 flex-1">
              <label className={`text-[11px] font-bold ${muted}`} htmlFor="party-start">Starts</label>
              <input
                id="party-start"
                data-testid="world-party-start"
                type="datetime-local"
                value={startValue}
                onChange={(e) => setStartValue(e.target.value)}
                className={`${inputCls} mt-1`}
              />
            </div>
            <div>
              <p className={`text-[11px] font-bold ${muted}`}>Length</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {PARTY_DURATION_PRESETS_MIN.map((min) => (
                  <button
                    key={min}
                    type="button"
                    data-testid="world-party-duration"
                    onClick={() => setDurationMin(min)}
                    className={`${chipBtn} ${durationMin === min ? "border-[#d4af37] bg-[#d4af37]/20 text-[#d4af37]" : ""}`}
                  >
                    {min >= 60 ? `${min / 60} hr` : `${min} min`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {playlists && playlists.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-44 flex-1">
                <label className={`text-[11px] font-bold ${muted}`} htmlFor="party-playlist">
                  Start from one of your playlists
                </label>
                <select
                  id="party-playlist"
                  data-testid="world-party-playlist"
                  value={pickedPlaylist}
                  onChange={(e) => setPickedPlaylist(e.target.value)}
                  className={`${inputCls} mt-1`}
                >
                  <option value="">Choose a playlist…</option>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.itemCount})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                data-testid="world-party-playlist-use"
                disabled={busy || !pickedPlaylist}
                onClick={() => void applyPlaylist()}
                className={chipBtn}
              >
                Use its songs
              </button>
            </div>
          )}
          {playlistNote && <p className={`px-1 text-xs ${muted}`}>{playlistNote}</p>}

          <div>
            <p className={`text-[11px] font-bold ${muted}`}>
              The queue — plays in order ({queue.length}/{PARTY_QUEUE_MAX})
            </p>
            {queue.length === 0 ? (
              <p className={`mt-1 text-sm ${muted}`}>Nothing picked yet — tap songs below to line them up.</p>
            ) : (
              <div className="mt-1 space-y-1.5">
                {queue.map((item, i) => (
                  <div
                    key={item.id}
                    className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                      isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                    }`}
                  >
                    <span className={`text-xs font-black ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{i + 1}</span>
                    <span className={`min-w-0 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                      {item.title}
                    </span>
                    {item.durationSec > 0 && <span className={`text-xs ${muted}`}>{fmtClock(item.durationSec)}</span>}
                    <span className="ml-auto inline-flex gap-1">
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={i === 0}
                        onClick={() => setQueue(movePartyQueueItem(queue, i, -1))}
                        className={chipBtn}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={i === queue.length - 1}
                        onClick={() => setQueue(movePartyQueueItem(queue, i, 1))}
                        className={chipBtn}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Remove"
                        onClick={() => setQueue(queue.filter((q) => q.id !== item.id))}
                        className={chipBtn}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {catalog === null ? (
              <p className={`inline-flex items-center gap-2 text-sm ${muted}`}>
                <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> Opening the catalog…
              </p>
            ) : (
              <>
                {pickSection("Yours", catalog.mine)}
                {pickSection("From the palace", catalog.public)}
              </>
            )}
          </div>

          {error && (
            <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p>
          )}

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid="world-party-submit"
              disabled={busy}
              onClick={() => void submit()}
              className={`inline-flex items-center gap-1.5 rounded-full border border-[#d4af37] bg-[#d4af37]/20 px-4 py-2 text-xs font-black text-[#d4af37] transition hover:bg-[#d4af37]/30 disabled:opacity-50`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="h-3.5 w-3.5" />}
              Book this party
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={chipBtn}
            >
              Not now
            </button>
          </div>
        </div>
      )}
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
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105"
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
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105"
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
              <ListeningBooth
                isLight={isLight}
                shelfPlayer={shelfPlayer}
                onJukeboxAdd={props.onJukeboxAdd}
              />
            </PanelBoundary>
          );
        }
        if (resolution.pattern === "social") {
          return (
            <PanelBoundary isLight={isLight} resetKey={station.id}>
              {station.id === "post-office" ? (
                <PostOfficeDesk isLight={isLight} />
              ) : station.id === "community-hall" ? (
                <CommunityHallBoard isLight={isLight} isGuest={isGuest} />
              ) : (
                <NativePlaceholder station={station} isLight={isLight} />
              )}
            </PanelBoundary>
          );
        }
        if (resolution.pattern === "games") {
          return (
            <PanelBoundary isLight={isLight} resetKey={station.id}>
              <GamesPanel stationId={station.id} isLight={isLight} partyInvite={props.partyInvite ?? null} />
            </PanelBoundary>
          );
        }
        return (
          <PanelBoundary isLight={isLight} resetKey={station.id}>
            {resolution.pattern === "create" ? (
              <CreateDeskPanel
                station={station}
                isLight={isLight}
                onJukeboxAdd={props.onJukeboxAdd}
                onOpenEditor={props.onOpenEditorStation}
                shelfPlayer={shelfPlayer}
              />
            ) : resolution.pattern === "shop" ? (
              <ShopStand station={station} isLight={isLight} isGuest={isGuest} />
            ) : resolution.pattern === "board" && station.id === "charts-desk" ? (
              <ChartsBoard
                isLight={isLight}
                isGuest={isGuest}
                jukeboxDenied={props.jukeboxDenied}
                onPlayTrack={props.onJukeboxAdd}
                shelfPlayer={shelfPlayer}
              />
            ) : resolution.pattern === "board" && station.id === "get-paid-room" ? (
              <EarningsBoard isLight={isLight} isGuest={isGuest} />
            ) : resolution.pattern === "board" && station.id === "my-studio" ? (
              <StudioBoard isLight={isLight} onContinueProject={(projectId) => setBoardProjectId(projectId)} />
            ) : resolution.pattern === "business" && station.id === "branding-kit-desk" ? (
              <BrandingKitDesk isLight={isLight} isGuest={isGuest} />
            ) : resolution.pattern === "business" && station.id === "press-kit-desk" ? (
              <PressKitDesk isLight={isLight} isGuest={isGuest} />
            ) : resolution.pattern === "business" && station.id === "promote-room" ? (
              <PromoteDesk isLight={isLight} isGuest={isGuest} />
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
              <FrontRowGallery
                isLight={isLight}
                isGuest={isGuest}
                onPlayTrack={props.onJukeboxAdd}
              />
            );
          case "season-marks":
            return <SeasonMarksWall isLight={isLight} />;
          case "winners-circle":
            return <WinnersCirclePanel isLight={isLight} isGuest={isGuest} />;
          case "treasury-daily":
            return <TreasuryDaily isLight={isLight} onOpenStation={props.onOpenStation} />;
          case "treasury-shark":
            return <TreasuryShark isLight={isLight} />;
          case "treasury-quests":
            return <TreasuryQuests isLight={isLight} onOpenStation={props.onOpenStation} />;
          case "treasury-packs":
            return <PacksDesk isLight={isLight} />;
          case "beats-desk":
            return <BeatsDesk isLight={isLight} isGuest={isGuest} />;
          case "jukebox":
            return <JukeboxPanel {...props} />;
          case "creator-rooms":
            return (
              <CreatorRoomsDirectory
                isLight={isLight}
                mySlug={props.mySlug ?? null}
                onEnterCreatorRoom={props.onEnterCreatorRoom ?? (() => undefined)}
              />
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

  return (
    <div
      className={`relative z-20 max-h-[62vh] overflow-y-auto border-t px-4 py-3 ${
        isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9]" : "border-[#d4af37]/25 bg-[#070605]"
      }`}
      data-testid="world-station-panel"
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
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
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
