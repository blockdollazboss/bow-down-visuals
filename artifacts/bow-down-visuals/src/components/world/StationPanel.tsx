import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link, Router, Route, Switch, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  X, Loader2, Crown, Users, Play, Pause, SkipForward, XCircle,
  Gift, Flame, ListMusic, Plus, LogIn, DoorOpen, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { PalaceStation } from "@/lib/world/stations";
import {
  splitPanelPath,
  resolveStationPanel,
  editorStepthroughSearch,
  PANEL_ROUTE_PATHS,
  type PanelRoutePath,
} from "@/lib/world/station-panel";
import {
  NativePlaceholder,
  TransferFooter,
  ListeningBooth,
  NowPlayingCard,
  ShopStand,
  useShelfPlayer,
  type ShelfPlayerController,
} from "@/components/world/native";
import { ChartsBoard, EarningsBoard, StudioBoard } from "@/components/world/native/boards";
import { jukeboxDeniedCopy } from "@/lib/world/jukebox-sync";
import type { PalaceDirectoryEntry, WorldJukeboxState } from "@/lib/world/world-client";
import { fetchPublicCourt, type CourtMember } from "@/lib/royal-court";
import { DailyDropCard } from "@/components/DailyDropCard";
import QuestsWidget from "@/components/QuestsWidget";

/* ─── StationPanel — the palace's doors, opened ──────────────────────
   A door-station's panel under registry v2 (NATIVE-PLAN §3.0): a
   station NEVER mounts a website page component. Opening a station
   resolves through `resolveStationPanel` to exactly one of: the
   guest pitch (members-only door, guest walker), a native surface
   (its pattern's instrument — the honest "being rebuilt"
   placeholder until that pattern ships, framed by the standard
   transfer footer), one of the six world-native custom panels, or
   (the one heavy desk) the step-through. The in-panel router below
   survives ONLY for the bare-page target a custom panel can still
   point at (a Front Row portrait → a creator profile); it is
   unreachable from the station-open path and is deleted at the
   plan's Step 8. Guests at a members-only door get the pitch and
   the sign-in ask — sign-in itself deliberately lives on the site,
   not in a 3D panel (the plan's phishing-hygiene refusal). */

/** What the panel is showing: a station, or a bare page a custom
 *  panel sent the walker to (a Court portrait's profile). */
export type StationPanelTarget =
  | { kind: "station"; station: PalaceStation }
  | { kind: "page"; path: string; title: string };

export interface StationPanelProps {
  target: StationPanelTarget;
  isLight: boolean;
  isGuest: boolean;
  onClose: () => void;
  /** Open a bare page in the panel (Court portraits → profiles). */
  onOpenPage: (path: string, title: string) => void;
  /* The Kingdom Board's data + the room the walker stands in. */
  directory: PalaceDirectoryEntry[];
  currentRoomId: string;
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

/* ─── The in-panel router (LEGACY — plan Step 8 deletes this) ───────
   The site's own pages, mounted under a memory-location router.
   Registry v2: NO station opens through here anymore — stations
   resolve natively (see the host below). This router remains only
   for the bare-page target (`StationPanelTarget` kind "page") that
   a custom panel can still point at — today, a Front Row portrait
   opening a creator's profile — and the deeper links inside such
   a page. The route set is the shared table in
   lib/world/station-panel; anything beyond it lands on the honest
   miss card. The record below is keyed by the table, so a path
   added there without a page here won't compile. */
const PANEL_PAGES: Record<PanelRoutePath, ReturnType<typeof lazy>> = {
  "/messages": lazy(() => import("@/pages/messages")),
  "/my-music": lazy(() => import("@/pages/my-music")),
  "/charts": lazy(() => import("@/pages/discovery/charts")),
  "/arcade": lazy(() => import("@/pages/arcade")),
  "/party": lazy(() => import("@/pages/party")),
  "/dashboard": lazy(() => import("@/pages/dashboard")),
  "/create": lazy(() => import("@/pages/create")),
  "/audio-studio": lazy(() => import("@/pages/audio-studio")),
  "/thumbnail-studio": lazy(() => import("@/pages/thumbnail-studio")),
  "/memberships": lazy(() => import("@/pages/memberships")),
  "/branding-kit": lazy(() => import("@/pages/branding-kit")),
  "/press-kit": lazy(() => import("@/pages/press-kit")),
  "/storefronts": lazy(() => import("@/pages/storefronts")),
  "/community": lazy(() => import("@/pages/community")),
  "/promote": lazy(() => import("@/pages/promote")),
  "/earnings": lazy(() => import("@/pages/earnings")),
  "/post/:id": lazy(() => import("@/pages/post")),
  "/track/:id": lazy(() => import("@/pages/stream/track")),
  "/watch/:id": lazy(() => import("@/pages/stream/watch")),
  "/shop/:slug": lazy(() => import("@/pages/shop")),
  "/coach": lazy(() => import("@/pages/coach")),
  "/my-projects": lazy(() => import("@/pages/my-projects")),
  "/credit-history": lazy(() => import("@/pages/credit-history")),
  "/distribute": lazy(() => import("@/pages/distribute")),
  "/scheduler": lazy(() => import("@/pages/scheduler")),
  "/artist/:slug": lazy(() => import("@/pages/artist-public")),
};
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

function PanelMiss({ homePath, isLight }: { homePath: string; isLight: boolean }) {
  const [path, setLocation] = useLocation();
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <DoorOpen className="h-7 w-7 text-[#d4af37]" />
      <p className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
        That door isn&rsquo;t hung in the palace yet
      </p>
      <p className={`max-w-sm text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
        <span className="font-semibold">{path}</span> lives on the site — the palace&rsquo;s doors
        reach the rooms off this one, and this path isn&rsquo;t among them yet.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => setLocation(homePath)}
          className="rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105"
        >
          Back to this door
        </button>
        <a
          href={path}
          className={`rounded-full border px-4 py-2 text-sm font-bold transition ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}
        >
          Open it on the site
        </a>
      </div>
    </div>
  );
}

function PanelRouter({ initialPath, isLight }: { initialPath: string; isLight: boolean }) {
  const loc = useMemo(() => {
    const { pathname, search } = splitPanelPath(initialPath);
    return memoryLocation({ path: pathname, searchPath: search });
  }, [initialPath]);
  const fallback = (
    <div className="flex items-center justify-center gap-2 px-4 py-12">
      <Loader2 className="h-5 w-5 animate-spin text-[#d4af37]" />
      <span className={`text-sm font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        Opening the door…
      </span>
    </div>
  );
  return (
    <Router hook={loc.hook}>
      <PanelBoundary isLight={isLight} resetKey={initialPath}>
        <Suspense fallback={fallback}>
          <Switch>
            {PANEL_ROUTE_PATHS.map((path) => {
              const Page = PANEL_PAGES[path];
              return (
                <Route key={path} path={path}>
                  <Page />
                </Route>
              );
            })}
            <Route><PanelMiss homePath={initialPath} isLight={isLight} /></Route>
          </Switch>
        </Suspense>
      </PanelBoundary>
    </Router>
  );
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
        href="/login"
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
}: {
  directory: PalaceDirectoryEntry[];
  currentRoomId: string;
  isLight: boolean;
}) {
  if (directory.length === 0) {
    return (
      <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        The board is quiet — the directory hasn&rsquo;t spoken yet.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {directory.map((r) => {
        const here = r.id === currentRoomId;
        return (
          <div
            key={r.id}
            className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
              here
                ? "border-[#d4af37] bg-[#d4af37]/10"
                : isLight
                  ? "border-[#C9A84C]/40 bg-white/50"
                  : "border-white/10 bg-white/5"
            }`}
          >
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
          </div>
        );
      })}
      <p className={`px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        The board follows the palace live — walk through a door and your name moves with you. Shows play on the
        hall&rsquo;s big screen; the Front Row sits in the Royal Court Chamber, east front door.
      </p>
    </div>
  );
}

function FrontRowGallery({
  isLight,
  onOpenPage,
}: {
  isLight: boolean;
  onOpenPage: (path: string, title: string) => void;
}) {
  const [members, setMembers] = useState<CourtMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

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
            onClick={() => onOpenPage(`/artist/${m.slug}`, m.displayName)}
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
              Open their profile door →
            </span>
          </button>
        ))}
      </div>
      <p className={`px-1 pt-2 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        The King&rsquo;s Front Row — the honored creators, portrait by portrait. A portrait opens that
        creator&rsquo;s real profile, right here in the palace.
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
}

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

function TreasuryDaily({ isLight }: { isLight: boolean }) {
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
      setStatus((await res.json()) as BonusStatus);
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

function TreasuryQuests() {
  const { getAccessToken, refreshProfile } = useAuth();
  return <QuestsWidget getToken={getAccessToken} onBalanceChange={refreshProfile} inWorld />;
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
            Guests listen in — <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">sign in</Link>{" "}
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

  const name = target.kind === "station" ? target.station.name : target.title;
  const tagline = target.kind === "station" ? target.station.tagline : null;

  /* Registry v2: a station target resolves ONCE, here, and every
     render below follows the resolution. Its union has no page
     variant — a station can never mount a website page component
     again. Bare-page targets (kind "page") carry no resolution;
     they are the legacy router's last job (see PanelRouter). */
  const station = target.kind === "station" ? target.station : null;
  const resolution = station ? resolveStationPanel(station, isGuest) : null;

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
    /* Bare-page targets are the legacy router's only remaining
       caller — a custom panel (a Front Row portrait) pointed here.
       No station target can reach this branch: station targets
       carry a resolution, and the resolution union has no page. */
    if (target.kind === "page") {
      return <PanelRouter initialPath={target.path} isLight={isLight} />;
    }
    if (!station || !resolution) return null;
    switch (resolution.type) {
      case "guest-pitch":
        return <GuestPitch station={station} isLight={isLight} />;
      case "native":
        /* The station's pattern surface, framed below by the
           standard transfer footer. Each pattern lane's shipped
           surface renders here; a native station whose pattern
           hasn't shipped keeps the honest migration placeholder —
           never a silent pull-up, never a dead end. */
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
        return (
          <PanelBoundary isLight={isLight} resetKey={station.id}>
            {resolution.pattern === "shop" ? (
              <ShopStand station={station} isLight={isLight} isGuest={isGuest} />
            ) : resolution.pattern === "board" && station.id === "charts-desk" ? (
              <ChartsBoard
                isLight={isLight}
                isGuest={isGuest}
                jukeboxDenied={props.jukeboxDenied}
                onPlayTrack={props.onJukeboxAdd}
              />
            ) : resolution.pattern === "board" && station.id === "get-paid-room" ? (
              <EarningsBoard isLight={isLight} />
            ) : resolution.pattern === "board" && station.id === "my-studio" ? (
              <StudioBoard isLight={isLight} onContinueProject={(projectId) => setBoardProjectId(projectId)} />
            ) : (
              <NativePlaceholder station={station} isLight={isLight} />
            )}
          </PanelBoundary>
        );
      case "custom":
        switch (resolution.id) {
          case "kingdom-board":
            return (
              <KingdomBoard directory={props.directory} currentRoomId={props.currentRoomId} isLight={isLight} />
            );
          case "front-row":
            return <FrontRowGallery isLight={isLight} onOpenPage={props.onOpenPage} />;
          case "treasury-daily":
            return <TreasuryDaily isLight={isLight} />;
          case "treasury-shark":
            return <TreasuryShark isLight={isLight} />;
          case "treasury-quests":
            return <TreasuryQuests />;
          case "jukebox":
            return <JukeboxPanel {...props} />;
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
          whichever native surface set the player (the Booth, the
          Charts board's Play) — one player, one card, above the
          station's own body. */}
      {resolution?.type === "native" && shelfPlayer.current && (
        <NowPlayingCard player={shelfPlayer} isLight={isLight} />
      )}
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
