import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Loader2, ArrowLeft, Users, Mic, MicOff, PhoneOff, AlertTriangle,
  RotateCcw, Glasses, Send, Crown, Eye, Sparkles, Tv, Shield, Play, Pause, Gauge,
  Maximize, Minimize, Gamepad2, AudioWaveform, DoorOpen,
  Accessibility, Hand, PartyPopper, Music2, RefreshCw, Armchair,
  Megaphone, Bell, BellOff, X, Coins, Gem, Lock, LockOpen,
} from "lucide-react";
import {
  WORLD_ACTIONS,
  ACTION_BY_ID,
  type WorldActionId,
  type WorldActionDef,
} from "@/lib/world/actions";
import { toggleFullscreen, isFullscreenActive, fullscreenSupported } from "@/lib/world/fullscreen";
import { useAuth } from "@/contexts/AuthContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  evaluateLevel,
  readSeenLevel,
  writeSeenLevel,
} from "@/lib/world/level-watch";
import { formatMomentLine, QUEST_CLAIMED_EVENT } from "@/lib/world/moments";
import {
  ANNOUNCE_TTL_MS,
  announceLine,
  announceSpeaker,
  cleanHeraldText,
  isAnnounceFresh,
  loadAnnounceMuted,
  storeAnnounceMuted,
} from "@/lib/world/announce";
import {
  WorldClient,
  worldOverlay,
  defaultWorldSocketUrl,
  worldGuestSessionId,
  fetchWorldDirectory,
  fetchWorldEvents,
  HALL_ROOM_ID,
  type WorldStatus,
  type WorldSayEvent,
  type WorldPeer,
  type WorldAnnouncement,
  type WorldScreenState,
  type WorldJukeboxState,
  type WorldKingMomentState,
  type WorldDropState,
  type PalaceDirectoryEntry,
} from "@/lib/world/world-client";
import {
  canUseWorldLockVerbs,
  doorLockVerb,
  fetchWorldLocks,
  lockWorldDoor,
  unlockWorldDoor,
  lockWorldPerson,
  unlockWorldPerson,
  type WorldLocksDto,
  type WorldPersonLockDto,
} from "@/lib/world/admin-locks";
import {
  isKingMomentLive,
  kingClaimedLine,
  kingDeniedLine,
  kingMomentHeadline,
  kingMomentLine,
  kingStripLine,
} from "@/lib/world/king-moment";
import { monumentBoardData } from "@/lib/world/monument-board";
import {
  directorySlate,
  mergeSlates,
  normalizeWorldEventSlate,
  type PalaceSlateEvent,
} from "@/lib/world/objective-strip";
import { normalizeLeaderboard, type Leaderboard } from "@/lib/world/treasury-quests";
import {
  STAGE_TIP_PRESETS,
  stageTippedLine,
  stageTipDeniedLine,
} from "@/lib/world/stage-tip";
import {
  EMPTY_DROP_BOOK,
  dropBookClaimSent,
  dropBookClaimed,
  dropBookDenied,
  dropBookForDrop,
  dropClaimInFlight,
  dropClaimView,
  dropClaimedLine,
  dropDeniedLine,
  dropHeadline,
  dropLine,
  type DropClaimBook,
} from "@/lib/world/drop-spectacle";
import {
  parseTutorialStatus,
  tutorialStripLine,
  tutorialGuidance,
  type TutorialStatus,
} from "@/lib/world/tutorial";
import {
  nearestStation,
  STATION_BY_ID,
  type PalaceStation,
} from "@/lib/world/stations";
import {
  jukeboxPlaybackNow,
  jukeboxNeedsSeek,
} from "@/lib/world/jukebox-sync";
import { newestEditorProjectId, type EditorProjectRow } from "@/lib/world/station-panel";
import {
  COURTYARD_ID,
  GAME_ROOMS_ID,
  MUSIC_HALL_ID,
  isCreatorRoomId,
  creatorSlugFromRoomId,
  registerCreatorRoomLayout,
} from "@/lib/world/palace-layout";
import {
  creatorRoomId,
  fetchCreatorRoomDetail,
  parseCreatorRoomParam,
  type CreatorRoomDetail,
} from "@/lib/world/creator-rooms";
import {
  creatorRoomRankLine,
  creatorRoomTierDressing,
} from "@/lib/world/creator-room-tier";
import { creatorRoomDressingSceneParams } from "@/lib/world/creator-room-dressing";
import {
  parsePartyInvite,
  parsePartyRoomSnapshot,
  partySummonsHeadline,
  partyTableSeatState,
  PARTY_GAME_META,
  type PartyOpenRoom,
} from "@/lib/world/games-lobby";
import StationPanel, { type StationPanelTarget } from "@/components/world/StationPanel";
import { LiveStudioDesk, LiveBackstageDesk, LiveGuestJoinDesk } from "@/components/world/native/LiveDesk";
import { EmojiTray, KingTokenText } from "@/components/social/KingEmoji";
import { insertAtCursor } from "@/lib/king-emoji";
import { fetchPublicCourt } from "@/lib/royal-court";
import {
  VoiceMesh,
  createBrowserPeerConnection,
  createBrowserVoiceSink,
  createLocalLevelTap,
  type VoiceSignalData,
} from "@/lib/world/voice";
import {
  loadViewMode,
  storeViewMode,
  toggledViewMode,
  type HallViewMode,
} from "@/lib/world/view-mode";
import {
  loadQualityPreference,
  nextQualityPreference,
  qualityPreferenceLabel,
  type QualityPreference,
} from "@/lib/world/quality";
import {
  initialVoiceToggle,
  reduceVoiceToggle,
  canJoinVoice,
  gainPolicyForMode,
  loadVoiceMode,
  nextVoiceMode,
  storeVoiceMode,
  VOICE_MODES,
  type VoiceMode,
  type VoiceToggleAction,
  type VoiceToggleState,
} from "@/lib/world/voice-toggle";
import {
  CharacterVoiceShaper,
  loadCharacterVoiceEnabled,
  storeCharacterVoiceEnabled,
  resolveCharacterVoiceProfile,
  shapingParamsFor,
  NEUTRAL_VOICE_PROFILE,
  type CharacterVoiceProfile,
} from "@/lib/world/character-voice";
import type { KingsHallScene, HallScreenSource } from "@/lib/world/hall-scene";
import { normalizeHallTheme, type HallTheme } from "@/lib/world/hall-looks";
import {
  fetchVaultCharacters,
  loadStoredCharacterId,
  storeCharacterId,
  reconcileStoredPick,
  renameVaultCharacter,
  removeVaultCharacter,
  type VaultCharacter,
} from "@/lib/world/characters";
import WalkInAsPicker from "@/components/world/WalkInAsPicker";
import { SwitchToWebsite } from "@/components/world/SwitchToWebsite";
import { WorldNotificationsBell } from "@/components/world/WorldNotificationsBell";
import { ObjectiveStrip } from "@/components/world/ObjectiveStrip";
import {
  GUEST_EMOTE_PITCH,
  GUEST_SIGN_IN_HREF,
  GUEST_SPEAK_PITCH,
  memberControlsVisible,
} from "@/lib/world/guest-honest";

/* ─── The World — the palace (/world) ───────────────────────────────────────
   One shared VR palace: the King's Hall (a stage and a big screen —
   the featured reel, or a live stream's picture while one is truly
   live) with the Music Hall, Game Rooms, Create Wing and Courtyard
   off it, walked through real doorways. Presence is room-scoped:
   you see and hear the room you stand in. Creators and fans walk it
   together as named avatars; guests visit look-only. Voice has
   modes — Off, Proximity (walk up to someone to talk), Lobby (the
   whole room), Deafen (hear nobody, mic muted, still in the room).
   The 3D scene (three.js) loads ONLY on this route, behind a dynamic
   import in the init effect.
   The hall wears the visitor's site theme (owner's pick, 2026-10-16):
   light theme → the sunlit Golden Hour Palace; dark theme → the
   candlelit Midnight Throne Room. Flip the theme and the room —
   chrome included — re-skins to match.
   Members can walk in as one of their Creative Vault characters
   (the "Walk in as" row): the character's portrait stands in the
   hall on a gold-framed panel, and its lips move with the speaker's
   live voice. Guests keep the classic visit, unchanged. */

/** The app shell's theme, the same way the toggles read it: the
 *  `light`/`dark` class main.tsx and the theme toggles keep on
 *  <html>. Anything that isn't light is the dark hall. */
function currentHallTheme(): HallTheme {
  return normalizeHallTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
}

interface ScreenInfo {
  mode: "live" | "featured" | "video";
  title: string;
  creatorName: string | null;
  streamId: string | null;
  hlsUrl: string | null;
  videoUrl: string | null;
  stage: { name: string; slug: string | null } | null;
  playback: { playing: boolean; positionSec: number } | null;
  videoId: string | null;
}

/** One pick in the screen remote's catalog (ids only ever identify
 *  content — the server re-verifies and re-derives the URL). */
interface ScreenCatalogItem {
  id: string;
  title: string;
  creatorName: string | null;
  mediaKind: "file" | "hls";
  durationSec: number;
}

const ACTION_ICONS: Record<WorldActionId, typeof Hand> = {
  bow: Accessibility,
  wave: Hand,
  cheer: PartyPopper,
  clap: Sparkles,
  dance: Music2,
  spin: RefreshCw,
  sit: Armchair,
};

/** One button on the action bar. A held toggle (Dance, Sit) wears
 *  the solid-gold active state; one-shots are momentary. */
function ActionButton({
  def,
  active,
  isLight,
  onPerform,
}: {
  def: WorldActionDef;
  active: boolean;
  isLight: boolean;
  onPerform: (id: WorldActionId) => void;
}) {
  const Icon = ACTION_ICONS[def.id];
  return (
    <button
      type="button"
      onClick={() => onPerform(def.id)}
      data-testid={`world-action-${def.id}`}
      aria-pressed={def.kind === "toggle" ? active : undefined}
      title={def.kind === "toggle" ? `${def.label} — stays on until you stop it` : def.label}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
        active
          ? "border-[#d4af37] bg-[#d4af37] text-black"
          : isLight
            ? "border-[#7A5A12]/30 text-[#6B5B36] hover:border-[#7A5A12]/60 hover:text-[#2a1e07]"
            : "border-white/15 text-white/75 hover:border-[#d4af37]/60 hover:text-white"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {def.label}
    </button>
  );
}

export default function WorldPage() {
  usePageTitle("The World — The King's Plaza", "Step into the King's Plaza: the palace's front square — the hall's stage and big screen, and your people, are all right here.");
  const { user, getAccessToken } = useAuth();
  /* My Creator Level, as this device knows it — the input to the
     level-up detection below (the server keeps the record that
     actually gets witnessed; see runLevelCheck). */
  const { stars } = useUserMode();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const roomRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<WorldClient | null>(null);
  const sceneRef = useRef<KingsHallScene | null>(null);
  const meshRef = useRef<VoiceMesh | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const shaperRef = useRef<CharacterVoiceShaper | null>(null);
  const localTapRef = useRef<{ getLevel: () => number; dispose: () => void } | null>(null);
  const spawnedRef = useRef(false);

  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<WorldStatus>("connecting");
  /* The quiet-reconnect interlude: the client stays "inside" while
     it re-enters; the page shows a slim notice, never a card. */
  const [reconnecting, setReconnecting] = useState(false);
  /* A boot failure is NOT a connection failure: the scene chunk
     failed to load or the WebGL2 renderer threw before any socket
     existed — the device couldn't start the hall. It wears its own
     honest card, never the "connection dropped" copy. */
  const [bootFailed, setBootFailed] = useState(false);
  const [peopleCount, setPeopleCount] = useState(0);
  /* The palace: the room I stand in (the header names it) and the
     directory — who's in every room, the front-door signal that
     your people are here. Presence is per-room now; the count in
     the header is THIS room's. */
  /* Admission lands on the King's Plaza (Open World Phase 1), so
     the pre-welcome placeholder names the plaza, not the hall —
     and the status handler below re-names it from the welcome's
     own room the moment it lands. */
  const [roomId, setRoomId] = useState<string>(COURTYARD_ID);
  const [roomName, setRoomName] = useState("The King's Plaza");
  const [directory, setDirectory] = useState<PalaceDirectoryEntry[]>([]);
  const inHall = roomId === HALL_ROOM_ID;
  const [isGuest, setIsGuest] = useState(true);
  const [myName, setMyName] = useState("");
  const [screen, setScreen] = useState<ScreenInfo | null>(null);
  const [sayLog, setSayLog] = useState<WorldSayEvent[]>([]);
  /* A witnessed moment (THE-GAME §5(a)): a win the room just saw —
   * the banner line it reads as in the world chrome, fading on its
   * own timer. The line is built from the server's broadcast
   * (formatMomentLine) — never from anything the achiever claimed. */
  const [momentLine, setMomentLine] = useState<string | null>(null);
  const momentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showMomentLine = useCallback((line: string) => {
    setMomentLine(line);
    if (momentTimerRef.current) clearTimeout(momentTimerRef.current);
    momentTimerRef.current = setTimeout(() => setMomentLine(null), 7_000);
  }, []);
  /* Palace announcements (Ring 3, THE-GAME §5(b)): the palace
   * speaking past one room's walls — a drop landing elsewhere, a
   * show starting, a level rising, the King's moment, the host's
   * herald. The banner stands for ANNOUNCE_TTL_MS; the room log
   * keeps the line either way. The mute is the standing rule made
   * visible (every automated behavior ships with an on/off): it
   * lives on this device, defaults to off, and only ever silences
   * the banner — the log still records what the palace said. */
  const [announce, setAnnounce] = useState<WorldAnnouncement | null>(null);
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [announceMuted, setAnnounceMuted] = useState<boolean>(() => loadAnnounceMuted());
  const announceMutedRef = useRef(announceMuted);
  announceMutedRef.current = announceMuted;
  const showAnnounce = useCallback((a: WorldAnnouncement) => {
    setAnnounce(a);
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    announceTimerRef.current = setTimeout(() => setAnnounce(null), ANNOUNCE_TTL_MS);
  }, []);
  const toggleAnnounceMuted = useCallback(() => {
    setAnnounceMuted((m) => {
      const next = !m;
      storeAnnounceMuted(next);
      if (next) setAnnounce(null);
      return next;
    });
  }, []);
  /* The host's herald compose (host panel): the one announcement
   * whose words are a person's own — the registry verifies the
   * host server-side regardless of what this form allows. */
  const [heraldDraft, setHeraldDraft] = useState("");
  const [heraldNote, setHeraldNote] = useState<string | null>(null);
  /* The King's daily moment (Ring 3): the hall's standing state as
   * the client reports it (hall welcome + king frames) — the hall
   * card, the objective strip's king line and the Kingdom Board's
   * today line all read this one mirror. A refusal of MY claim
   * lands in kingNote, in plain words. */
  const [kingMoment, setKingMoment] = useState<WorldKingMomentState | null>(null);
  const [kingNote, setKingNote] = useState<string | null>(null);
  /* Stage tips (Ring 3, item 3.3): the refusal of MY tip, in plain
   * words, on the tip bar. Landed tips speak for themselves — the
   * room witnesses them (the log + the moment toast). */
  const [tipNote, setTipNote] = useState<string | null>(null);
  /* Drop spectacles (World Events 3.4): the chest standing in THIS
   * room as the client reports it (welcome snapshot + drop frames)
   * — the drop card in the chrome reads this one mirror. The room
   * enforces members-only, in-room, first-come and pays claims
   * from the shared weekly drop pool. My own claim's bookkeeping
   * (which chest my claim is out on, which is already in hand)
   * lives in dropBook — the pure transitions are
   * lib/world/drop-spectacle's. A refusal of MY claim lands in
   * dropNote, in plain words, on the card. */
  const [drop, setDrop] = useState<WorldDropState | null>(null);
  const [dropBook, setDropBook] = useState<DropClaimBook>(EMPTY_DROP_BOOK);
  const [dropNote, setDropNote] = useState<string | null>(null);
  /* "Your First 10 Minutes" (Ring 3, Phase 6): the member's
   * quest-line status from GET /api/world/tutorial — the read
   * reconciles server-side, so this page just refreshes it at the
   * moments a step could have landed (entering, changing rooms,
   * closing a station panel). */
  const [tutorialStatus, setTutorialStatus] = useState<TutorialStatus | null>(null);
  const [tutorialClaimBusy, setTutorialClaimBusy] = useState(false);
  const [tutorialMsg, setTutorialMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const sayInputRef = useRef<HTMLInputElement>(null);
  /* The voice control (owner's order): MODES, not just on/off —
     Off, Proximity, Lobby, Deafen — remembered on this device.
     `inVoice` inside it is the live mesh session; the mode gates
     and shapes it, never replaces the explicit Join-voice act. */
  const [voiceSwitch, setVoiceSwitch] = useState<VoiceToggleState>(() =>
    initialVoiceToggle(loadVoiceMode()),
  );
  const voiceSwitchRef = useRef(voiceSwitch);
  voiceSwitchRef.current = voiceSwitch;
  /* Character voice (owner's order): you talk AS your character, so
     you sound like them — a live shaping profile on your own mic,
     resolved from the character you stand as. The switch is the
     owner's standing law made visible: default on, one tap back to
     your own voice, remembered on this device. The graph fails
     open — a shaping error can only ever hand the mesh your raw
     mic, never silence (lib/world/character-voice). */
  const [charVoiceOn, setCharVoiceOn] = useState<boolean>(() => loadCharacterVoiceEnabled());
  const charVoiceRef = useRef(charVoiceOn);
  charVoiceRef.current = charVoiceOn;
  const [voiceProfile, setVoiceProfile] = useState<CharacterVoiceProfile>(NEUTRAL_VOICE_PROFILE);
  const voiceProfileRef = useRef<CharacterVoiceProfile>(NEUTRAL_VOICE_PROFILE);
  const [voiceBusy, setVoiceBusy] = useState(false);
  /* Camera: first person, or third — pulled behind your figure so
     you can see who you're standing as. Remembered on the device. */
  const [viewMode, setViewMode] = useState<HallViewMode>(() => loadViewMode());
  const [qualityPref, setQualityPref] = useState<QualityPreference>(() => loadQualityPreference());
  /* The avatar action my figure is performing (the action bar's
     state; the scene reports its own endings — a finished bow,
     a walk that ended the dance — through onSelfAction). */
  const [myAction, setMyAction] = useState<WorldActionId | null>(null);
  const myActionRef = useRef<WorldActionId | null>(null);
  /* Perform an avatar action: pressing the toggle I'm already
     holding ends it; anything else starts (or replaces) the
     performance. The client relays it to the room; the scene
     performs it on my figure in the same breath. */
  const performAction = (id: WorldActionId) => {
    /* Guests hold no hand (access law, owner default 3): an emote
       press from a guest — button, controller, any caller — is
       never relayed and never performed locally. The action bar
       itself renders the sign-in pitch for guests, so this guard
       is the backstop, not the message. */
    if (!memberControlsVisible(isGuest)) return;
    const client = clientRef.current;
    const scene = sceneRef.current;
    if (!client || !scene) return;
    const next =
      ACTION_BY_ID.get(id)?.kind === "toggle" && myActionRef.current === id ? null : id;
    client.performAction(next);
    scene.setSelfAction(next);
    setMyAction(next);
    myActionRef.current = next;
  };
  const performActionRef = useRef(performAction);
  performActionRef.current = performAction;
  /* The in-hall character panel (the entry picker, reachable from
     inside — the owner couldn't find character choice from within). */
  const [charPanelOpen, setCharPanelOpen] = useState(false);
  /* The stage + screen remote: the room's own statement of who holds
     the stage and what's playing (broadcasts), the panel, and the
     holder's tools (my live stream, the video catalog). */
  const [stageScreen, setStageScreen] = useState<WorldScreenState | null>(null);
  const [screenPanelOpen, setScreenPanelOpen] = useState(false);
  const [myStream, setMyStream] = useState<{ id: string; title: string } | null>(null);
  const [catalog, setCatalog] = useState<{ mine: ScreenCatalogItem[]; public: ScreenCatalogItem[] } | null>(null);
  const [screenNote, setScreenNote] = useState<string | null>(null);
  /* The doors (the access layer): the station I'm standing at —
     polled off the scene's pose against the same registry the
     scene builds its markers from — and the panel it opened. */
  const [nearStation, setNearStation] = useState<PalaceStation | null>(null);
  const nearStationIdRef = useRef<string | null>(null);
  const [panelTarget, setPanelTarget] = useState<StationPanelTarget | null>(null);
  /* The door-opener behind both the E key and the controller's LB:
   * a prompt must be showing and no panel may be open — one guard,
   * whatever drives it. The scene's pad callbacks bind once at
   * boot, so they reach it through this ref (the performAction
   * pattern). */
  const openStationRef = useRef<() => void>(() => {});
  openStationRef.current = () => {
    if (!panelTarget && nearStation) {
      setPanelTarget({ kind: "station", station: nearStation });
    }
  };
  /* The editor step-through's deep link: when the Visual Vibes
     door opens, resolve the creator's most recent editor project
     so the editor opens where they left off (no project → fresh,
     as before). Re-resolved on every open; a failed read just
     leaves it null. */
  const [editorProjectId, setEditorProjectId] = useState<string | null>(null);
  const editorDoorOpen =
    panelTarget?.kind === "station" && panelTarget.station.panel.kind === "stepthrough";
  useEffect(() => {
    if (!editorDoorOpen || !user) {
      setEditorProjectId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/projects", {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { projects?: EditorProjectRow[] };
        if (!cancelled && Array.isArray(data.projects)) {
          setEditorProjectId(newestEditorProjectId(data.projects));
        }
      } catch {
        /* the step-through opens fresh — never blocked on this */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorDoorOpen, user?.id]);
  /* The Music Hall jukebox: the room's state as last broadcast, the
     anchor (state + when it landed here) the room audio derives
     its position from, and whether the browser is letting the
     room be heard yet (autoplay is the browser's call, not ours). */
  const [jukebox, setJukebox] = useState<WorldJukeboxState | null>(null);
  const [jukeboxDenied, setJukeboxDenied] = useState<string | null>(null);
  const jukeboxAnchorRef = useRef<{ state: WorldJukeboxState | null; at: number }>({
    state: null,
    at: 0,
  });
  /* The drop mirror's anchor: the last drop state the page took
   * from the client. The station tick reconciles against it — a
   * reference change is the room speaking through a welcome (the
   * snapshot path has no frame of its own). */
  const dropAnchorRef = useRef<WorldDropState | null>(null);
  const jukeboxAudioRef = useRef<HTMLAudioElement | null>(null);
  const [jukeboxAudible, setJukeboxAudible] = useState(true);
  /* Host (admin) state: the roster for the host panel, whether the
     host muted ME, and the two-tap remove arm. */
  const [hostPanelOpen, setHostPanelOpen] = useState(false);
  const [roster, setRoster] = useState<WorldPeer[]>([]);
  const [hostMuted, setHostMuted] = useState(false);
  const hostMutedRef = useRef(false);
  const rosterSigRef = useRef("");
  const [removeArm, setRemoveArm] = useState<string | null>(null);
  /* The World's locks (items 92–93): the admin lock verbs' state —
     the two-tap lock-out arm, the standing locks on this room, and
     the honest note the last verb landed with. Admin-only: the
     panel that renders these stands behind isAdmin, the handlers
     re-check canUseWorldLockVerbs, and the server rejects
     non-admin calls regardless (peace law). */
  const [lockArm, setLockArm] = useState<string | null>(null);
  const [worldLocks, setWorldLocks] = useState<WorldLocksDto | null>(null);
  const [lockNote, setLockNote] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  /* Fullscreen + controller presence (view states only — the render
     loop and the session never depend on either). */
  const [isFs, setIsFs] = useState(false);
  const [fsSupported, setFsSupported] = useState(false);
  const [padConnected, setPadConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [xrSupported, setXrSupported] = useState<boolean | null>(null);
  const [xrNote, setXrNote] = useState<string | null>(null);
  /* "Walk in as": the member's Creative Vault characters and the
     pick (remembered on this device; null = the house avatar). */
  const [vaultChars, setVaultChars] = useState<VaultCharacter[] | null>(null);
  const [vaultLoadFailed, setVaultLoadFailed] = useState(false);
  const [walkInAs, setWalkInAs] = useState<string | null>(() => loadStoredCharacterId());
  const walkInAsRef = useRef<string | null>(walkInAs);
  walkInAsRef.current = walkInAs;
  const [siteTheme, setSiteTheme] = useState<HallTheme>(() => currentHallTheme());
  /* A party summons (program 2.23): this visit landed on a
     /world?party=CODE invite link. The code is parsed once on
     entry; the TABLE is verified against the server (never trusted
     from the link alone) once we're inside; the summons card below
     walks the member to the Game Rooms and the Marble Table panel
     opens with the join pre-filled. Guests get the honest pitch:
     party tables are members-only — sign in and the same link
     brings them back to the table. */
  const [partyInviteCode, setPartyInviteCode] = useState<string | null>(() =>
    parsePartyInvite(window.location.search),
  );
  /* A Creator Rooms deep entry (Ring 2, 3.5): /world?creator=<slug>
     lands the walker in that creator's room — the param is the
     contract the profiles' "Visit in the World" door points at.
     The slug is never trusted from the link alone: the room's data
     read enforces publicness from the profile record, and only a
     room that answers gets entered. An unknown/private slug lands
     in the hall with an honest note (the banner below). */
  const [creatorParam] = useState<string | null>(() =>
    parseCreatorRoomParam(window.location.search),
  );
  const [creatorNote, setCreatorNote] = useState<string | null>(null);
  const creatorEntryAttemptedRef = useRef(false);
  /* Room data already read this visit (the dressing source) — a
     room change back into a visited room re-dresses instantly. */
  const creatorDetailsRef = useRef(new Map<string, CreatorRoomDetail>());
  const [mySlug, setMySlug] = useState<string | null>(null);

  /* Dress the template shell as the room's host: their name over
     the door, their accent on the runner, their portrait in the
     frame, their featured video on the room's screen. */
  const dressCreatorRoom = useCallback((detail: CreatorRoomDetail) => {
    creatorDetailsRef.current.set(detail.slug, detail);
    sceneRef.current?.setCreatorRoomDressing({
      displayName: detail.displayName,
      roomName: detail.roomName,
      accentHex: detail.theme.accent,
      primaryHex: detail.theme.primary,
      portraitUrl: detail.bannerUrl ?? detail.avatarUrl,
      screenVideoUrl: detail.featuredVideo?.videoUrl ?? null,
      /* The room's evolution (Ring 3, Phase 5): the rank plate +
       * tier trim ride the same dressing — the stars + rung name
       * off the server DTO, the trim off the tier dressing. */
      rankLine: creatorRoomRankLine(detail.evolution),
      tierTrimHex: detail.evolution
        ? creatorRoomTierDressing(detail.evolution.stars).trimHex
        : null,
      /* The room's dressing choice (Ring 4): the owner's picked
       * template variant, resolved server-side onto the same DTO
       * — its palette / trim / banner parameters ride along; a
       * null dressing wears the classic tuple. */
      ...creatorRoomDressingSceneParams(detail.dressing),
    });
  }, []);

  /* Walk into a creator's room: read the room first (the read is
     what proves the room is open — and it materializes the server
     instance), lay the floor plan under the slug, dress the
     template, then the doorway transfer does the walking. A room
     that doesn't answer leaves the walker where they stand, with
     the honest note. */
  const enterCreatorRoom = useCallback(
    async (slug: string): Promise<boolean> => {
      const cached = creatorDetailsRef.current.get(slug);
      const detail = cached ?? (await fetchCreatorRoomDetail(slug));
      if (!detail) {
        setCreatorNote(
          "That creator's room isn't open — their profile is private or doesn't exist. You're still in the palace.",
        );
        return false;
      }
      registerCreatorRoomLayout(detail.slug, detail.displayName);
      dressCreatorRoom(detail);
      setCreatorNote(null);
      setPanelTarget(null);
      clientRef.current?.enterRoom(creatorRoomId(detail.slug));
      return true;
    },
    [dressCreatorRoom],
  );
  const enterCreatorRoomRef = useRef(enterCreatorRoom);
  enterCreatorRoomRef.current = enterCreatorRoom;

  /* The owner changed their room's dressing (Ring 4): drop the
   * cached read and re-dress the template from a fresh one, so
   * the walls move while the host stands in them. The picker
   * only exists inside that room's own stations, so the walker
   * is by construction standing in the room that changed; the
   * template only ever shows inside a creator room, and entering
   * any room re-dresses it from its own read regardless. */
  const refreshCreatorRoomDressing = useCallback(
    (slug: string) => {
      creatorDetailsRef.current.delete(slug);
      void fetchCreatorRoomDetail(slug).then((detail) => {
        if (detail) dressCreatorRoom(detail);
      });
    },
    [dressCreatorRoom],
  );
  const [inviteRoom, setInviteRoom] = useState<PartyOpenRoom | null>(null);
  const [inviteResolved, setInviteResolved] = useState(false);
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const invitePanelPendingRef = useRef(false);

  /* ── Level-up detection (THE-GAME §5(a)) ───────────────────────
   * On World entry, and again after each quest claim, the level-check
   * rail is consulted and the EARNED level it returns (computed on
   * the server from recorded work — lib/creator-rank.ts) is compared
   * against the last level this device has seen for this user
   * (lib/world/level-watch). A RISE is recorded on the celebrate rail
   * first — the server accepts it only at or below the earned rank —
   * and only then does the bare levelup intent go to the room, which
   * verifies it against the same earned computation before witnessing
   * anything. The first-ever sighting sets the baseline silently: no
   * moment for a level you already had before the game could see it. */
  const runLevelCheck = useCallback(async () => {
    if (!user) return;
    try {
      const token = await getAccessToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const checkRes = await fetch(`/api/retention/level-check`, { headers }).catch(
        () => undefined,
      );
      const checkData = checkRes?.ok
        ? ((await checkRes.json().catch(() => ({}))) as { stars?: unknown })
        : {};
      /* The server's earned stars are the truth; the context value is
         only a fallback for a failed read (it is itself server-fed). */
      const current =
        typeof checkData.stars === "number" ? checkData.stars : stars;
      const verdict = evaluateLevel(readSeenLevel(window.localStorage, user.id), current);
      if (verdict.kind === "baseline") {
        writeSeenLevel(window.localStorage, user.id, verdict.level);
        return;
      }
      if (verdict.kind !== "rise") return;
      await fetch("/api/retention/level-check/celebrate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ level: verdict.level }),
      }).catch(() => undefined);
      writeSeenLevel(window.localStorage, user.id, verdict.level);
      clientRef.current?.celebrateLevelup();
    } catch {
      /* Detection is a courtesy: a failed check announces nothing. */
    }
  }, [user, stars, getAccessToken]);
  const runLevelCheckRef = useRef(runLevelCheck);
  runLevelCheckRef.current = runLevelCheck;

  /* "Your First 10 Minutes" (Phase 6): refresh the quest-line
   * status. The read reconciles server-side against the real
   * rails, so the page refreshes at the moments a step could have
   * landed — entering, changing rooms, closing a station panel.
   * Members only; a failed read keeps the last known status. */
  const refreshTutorial = useCallback(async () => {
    if (!user || isGuest) return;
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/world/tutorial", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => undefined);
      if (!res?.ok) return;
      const parsed = parseTutorialStatus(await res.json().catch(() => null));
      if (parsed) setTutorialStatus(parsed);
    } catch {
      /* The strip keeps its last known line. */
    }
  }, [user, isGuest, getAccessToken]);

  useEffect(() => {
    if (status !== "inside") return;
    void refreshTutorial();
  }, [status, roomId, refreshTutorial]);

  const claimTutorialReward = useCallback(async () => {
    if (tutorialClaimBusy) return;
    setTutorialClaimBusy(true);
    setTutorialMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/world/tutorial/claim", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = (await res.json().catch(() => null)) as
        | { claimed?: boolean; amountVb?: number; error?: string }
        | null;
      if (res.ok && body?.claimed) {
        setTutorialMsg(
          `Quest line complete — ${body.amountVb ?? ""} Visual Bucs added to your balance.`,
        );
      } else {
        setTutorialMsg(body?.error ?? "That claim didn't land — nothing was paid.");
      }
    } catch {
      setTutorialMsg("That claim didn't land — nothing was paid.");
    } finally {
      setTutorialClaimBusy(false);
      void refreshTutorial();
    }
  }, [tutorialClaimBusy, getAccessToken, refreshTutorial]);

  /* The World's locks (items 92–93): read the standing locks for
   * the host panel, and fire the four admin verbs. Every handler
   * re-checks the display gate before the call; the server gates
   * fail-closed on ADMIN_EMAILS regardless. A landed verb refreshes
   * the standing list, and a door verb also takes the fresh
   * directory the server carried back — the Locked pill updates
   * in the same moment, never on a later poll. */
  const refreshWorldLocks = useCallback(async () => {
    if (!canUseWorldLockVerbs({ admin: isAdmin, guest: isGuest })) return;
    try {
      const token = await getAccessToken();
      setWorldLocks(await fetchWorldLocks(token));
    } catch {
      /* The panel keeps its last known locks. */
    }
  }, [isAdmin, isGuest, getAccessToken]);

  useEffect(() => {
    if (hostPanelOpen && status === "inside") void refreshWorldLocks();
  }, [hostPanelOpen, status, roomId, refreshWorldLocks]);

  const runDoorLockVerb = useCallback(async () => {
    if (lockBusy || !canUseWorldLockVerbs({ admin: isAdmin, guest: isGuest })) return;
    const entry = directory.find((r) => r.id === roomId);
    if (!entry) return;
    setLockBusy(true);
    setLockNote(null);
    try {
      const token = await getAccessToken();
      const result =
        doorLockVerb(entry) === "unlock"
          ? await unlockWorldDoor(token, roomId)
          : await lockWorldDoor(token, roomId);
      if (result.rooms) setDirectory(result.rooms);
      setLockNote(
        result.door.locked
          ? `${entry.name}'s door is locked — everyone inside stays, nobody new joins.`
          : `${entry.name}'s door is open again.`,
      );
      await refreshWorldLocks();
    } catch (err) {
      setLockNote(err instanceof Error ? err.message : "That lock didn't land — nothing was changed.");
    } finally {
      setLockBusy(false);
    }
  }, [lockBusy, isAdmin, isGuest, directory, roomId, getAccessToken, refreshWorldLocks]);

  const runPersonLock = useCallback(
    async (peer: WorldPeer) => {
      if (lockBusy || !canUseWorldLockVerbs({ admin: isAdmin, guest: isGuest })) return;
      setLockBusy(true);
      setLockNote(null);
      try {
        const token = await getAccessToken();
        const result = await lockWorldPerson(token, { roomId, peerId: peer.peerId, minutes: 60 });
        setLockNote(
          `${result.person.displayName ?? peer.displayName} is locked out of this room for 1 hour${result.evicted ? " — they're out now" : ""}.`,
        );
        await refreshWorldLocks();
      } catch (err) {
        setLockNote(err instanceof Error ? err.message : "That lock didn't land — nothing was changed.");
      } finally {
        setLockBusy(false);
      }
    },
    [lockBusy, isAdmin, isGuest, roomId, getAccessToken, refreshWorldLocks],
  );

  const runPersonUnlock = useCallback(
    async (lock: WorldPersonLockDto) => {
      if (lockBusy || !canUseWorldLockVerbs({ admin: isAdmin, guest: isGuest })) return;
      setLockBusy(true);
      setLockNote(null);
      try {
        const token = await getAccessToken();
        await unlockWorldPerson(token, { roomId: lock.roomId, userId: lock.userId });
        setLockNote(`${lock.displayName} can walk into this room again, right now.`);
        await refreshWorldLocks();
      } catch (err) {
        setLockNote(err instanceof Error ? err.message : "That unlock didn't land — nothing was changed.");
      } finally {
        setLockBusy(false);
      }
    },
    [lockBusy, isAdmin, isGuest, getAccessToken, refreshWorldLocks],
  );

  /* Entry runs the check (and a mid-visit level change re-runs it —
   * evaluateLevel makes repeats harmless: equal is "none"). */
  useEffect(() => {
    if (status !== "inside" || !user) return;
    void runLevelCheckRef.current();
  }, [status, user, stars]);

  /* A quest claimed anywhere on this page (the Treasury board's
   * QuestsWidget fires bdv:quest-claimed on claim success): the
   * room gets its celebrate intent, and the level is re-checked —
   * a claim is exactly when a level tends to have moved. */
  useEffect(() => {
    const onQuestClaimed = () => {
      clientRef.current?.celebrateQuest();
      void runLevelCheckRef.current();
    };
    window.addEventListener(QUEST_CLAIMED_EVENT, onQuestClaimed);
    return () => window.removeEventListener(QUEST_CLAIMED_EVENT, onQuestClaimed);
  }, []);

  useEffect(() => {
    if (!partyInviteCode || status !== "inside" || isGuest) {
      if (partyInviteCode && status === "inside" && isGuest) setInviteResolved(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(
          `/api/party/rooms/${encodeURIComponent(partyInviteCode)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!cancelled) {
          setInviteRoom(res.ok ? parsePartyRoomSnapshot(await res.json()) : null);
          setInviteResolved(true);
        }
      } catch {
        if (!cancelled) setInviteResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyInviteCode, status, isGuest]);

  /* The summons walk: cross into the Game Rooms if we're not there
     (the transfer's own room-changed handler closes whatever panel
     was open, so the Marble Table opens only once we STAND there —
     the pending flag below), then open the table's panel with the
     invite threaded through. */
  const goToInvitedTable = useCallback(() => {
    const station = STATION_BY_ID.get("marble-table");
    if (!station) return;
    setInviteDismissed(true);
    if (roomId === GAME_ROOMS_ID) {
      setPanelTarget({ kind: "station", station });
    } else {
      invitePanelPendingRef.current = true;
      clientRef.current?.enterRoom(GAME_ROOMS_ID);
    }
  }, [roomId]);

  useEffect(() => {
    if (roomId !== GAME_ROOMS_ID || !invitePanelPendingRef.current) return;
    invitePanelPendingRef.current = false;
    const station = STATION_BY_ID.get("marble-table");
    if (station) setPanelTarget({ kind: "station", station });
  }, [roomId]);

  /* The Kingdom Board's party-tables Join (program 2.23): the
     board named a table off the server's open-rooms rail — the
     summons machinery takes it from there. The invite state names
     the table (the verify effect above re-reads its snapshot, so
     a table that closed on the way over reads closed, honestly),
     and the same walk carries the member to the Marble Table with
     the seat offered. No banner: the board was the surface, the
     panel's summons card is the confirmation. */
  const joinDirectoryTable = useCallback(
    (room: PartyOpenRoom) => {
      setPartyInviteCode(room.code);
      setInviteRoom(room);
      setInviteResolved(true);
      goToInvitedTable();
    },
    [goToInvitedTable],
  );

  /* The palace directory bar's room switch: a pill is a door, and
     it rides the same doors the Kingdom Board's calendar walk
     uses — a palace room takes the plain transfer, a creator room
     goes through its doorway transfer (the read that proves the
     room is open). While we aren't inside the client refuses on
     its own, and the room we already stand in is a quiet no-op
     inside enterRoom, so a tap at the wrong moment never errors. */
  const goToDirectoryRoom = useCallback((entry: PalaceDirectoryEntry) => {
    if (clientRef.current?.status !== "inside") return;
    const slug = creatorSlugFromRoomId(entry.id);
    if (slug) {
      void enterCreatorRoomRef.current(slug);
      return;
    }
    clientRef.current?.enterRoom(entry.id);
  }, []);

  /* The Creator Rooms deep entry, once we're inside: walk the
     param's room in (enterCreatorRoom verifies it against the
     profile record first). Attempted once per visit — a refused
     door (full room) or a closed one leaves the walker in the
     hall with the note enterCreatorRoom set, never a retry loop. */
  useEffect(() => {
    if (!creatorParam || status !== "inside" || creatorEntryAttemptedRef.current) return;
    creatorEntryAttemptedRef.current = true;
    void enterCreatorRoomRef.current(creatorParam);
  }, [creatorParam, status]);

  /* Follow the site theme live — the floating toggle (and every other
     theme control) flips the <html> class; watch it the same way the
     toggles themselves do, and re-skin the hall when it changes. */
  useEffect(() => {
    const sync = () => setSiteTheme(currentHallTheme());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    sceneRef.current?.setTheme(siteTheme);
  }, [siteTheme]);

  useEffect(() => {
    storeViewMode(viewMode);
    sceneRef.current?.setViewMode(viewMode);
  }, [viewMode]);

  /* Quality preference (item 22): the scene persists it itself and
   * pins (or un-pins) the adaptive ladder — the page just carries
   * the choice, exactly like the view mode. */
  useEffect(() => {
    sceneRef.current?.setQualityPreference(qualityPref);
  }, [qualityPref]);

  const toggleViewMode = () => setViewMode((m) => toggledViewMode(m));

  /* Fullscreen: the standard API on the room container. The
     `fullscreenchange` event is the ground truth (it also fires for
     the browser's own Esc exit), so no exit path strands anything —
     the render loop, pointer lock and XR entry are untouched. */
  useEffect(() => {
    const sync = () => setIsFs(isFullscreenActive(document));
    sync();
    setFsSupported(fullscreenSupported(document, document.documentElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFs = () => {
    void toggleFullscreen(document, roomRef.current);
  };

  /* Controller presence: a paired gamepad announces itself; the
     scene polls it for input (left stick walks, right stick looks,
     A steps the voice mode, Y switches view, LB opens the door at
     its prompt — see lib/world/gamepad). */
  useEffect(() => {
    const scan = () => {
      try {
        setPadConnected([...(navigator.getGamepads?.() ?? [])].some(Boolean));
      } catch {
        /* no gamepad API — the line just never shows */
      }
    };
    scan();
    window.addEventListener("gamepadconnected", scan);
    window.addEventListener("gamepaddisconnected", scan);
    return () => {
      window.removeEventListener("gamepadconnected", scan);
      window.removeEventListener("gamepaddisconnected", scan);
    };
  }, []);

  /* The directory at the front door: who's in which room, fetched
     over HTTP before the socket even opens — and only as a prefill
     (the socket's own directory frames own it from the moment they
     land; a slower HTTP answer never overwrites a fresher one). */
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    fetchWorldDirectory(ctrl.signal)
      .then((rooms) => {
        if (!cancelled) setDirectory((prev) => (prev.length > 0 ? prev : rooms));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  /* The Kingdom Board monument's words (item 16): the plate on
     the plaza monument letters the board's real headlines — the
     same reads the Kingdom Board station panel makes (directory
     for who's here, the palace slate for today, the retention
     leaderboard for standings). Refetched on the panel's own
     cadence family: on mount, when the directory's who's-here
     changes the picture, and every two minutes while the walker
     stays; the scene repaints only when the words change.
     Guests get who's-here + today (public reads) and an absent
     leaderboard — the monument letters the standings as
     members' business, exactly as the panel does. */
  const [monumentEvents, setMonumentEvents] = useState<PalaceSlateEvent[]>([]);
  const [monumentLeaderboard, setMonumentLeaderboard] = useState<Leaderboard | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const events = await fetchWorldEvents();
        if (!cancelled) setMonumentEvents(normalizeWorldEventSlate(events));
      } catch {
        /* The directory slate still speaks. */
      }
      if (user && !isGuest) {
        try {
          const token = await getAccessToken().catch(() => null);
          const res = await fetch("/api/retention/leaderboard", {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (res.ok && !cancelled) setMonumentLeaderboard(normalizeLeaderboard(await res.json()));
        } catch {
          /* Standings stay the last honest read. */
        }
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isGuest]);
  useEffect(() => {
    sceneRef.current?.setMonumentBoardData(monumentBoardData({
      directory,
      leaderboard: monumentLeaderboard,
      events: mergeSlates(monumentEvents, directorySlate(directory)),
      nowMs: Date.now(),
    }));
  }, [directory, monumentEvents, monumentLeaderboard, status]);

  /* Front Row honors: while a show runs, the seat arc shows before
     the stage, and the performer's Front Row members (their public
     court) wear the brighter ring + plate line. Visual honor only —
     nobody is moved. */
  const stageSlug = stageScreen?.holder?.slug ?? null;
  const stageHeld = !!stageScreen?.holder;
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!stageHeld) {
      scene.setStageSeatsVisible(false);
      scene.setFrontRowSlugs(new Set());
      return;
    }
    scene.setStageSeatsVisible(true);
    if (!stageSlug) return;
    let cancelled = false;
    fetchPublicCourt(stageSlug)
      .then((members) => {
        if (!cancelled) sceneRef.current?.setFrontRowSlugs(new Set(members.map((m) => m.slug)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [stageSlug, stageHeld, status]);

  /* The Music Hall's room audio: one element, created once, driven
     only by the room's jukebox state (never by the panel — the
     music belongs to the room, panel open or not). The position
     derives from the server's anchor stamp; drift past the
     tolerance is pulled back; leaving the room silences it. */
  useEffect(() => {
    const el = new Audio();
    el.preload = "auto";
    el.volume = 0.85;
    jukeboxAudioRef.current = el;
    return () => {
      el.pause();
      el.removeAttribute("src");
      jukeboxAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = jukeboxAudioRef.current;
    if (!el) return;
    const desired =
      roomId === MUSIC_HALL_ID
        ? jukeboxPlaybackNow(jukeboxAnchorRef.current.state, jukeboxAnchorRef.current.at, Date.now())
        : null;
    if (!desired) {
      el.pause();
      if (el.getAttribute("src")) el.removeAttribute("src");
      return;
    }
    if (el.getAttribute("src") !== desired.url) {
      el.src = desired.url;
      try {
        el.currentTime = desired.positionSec;
      } catch {
        /* no metadata yet — the drift pass seeks once it lands */
      }
    } else if (jukeboxNeedsSeek(desired, el.currentTime)) {
      el.currentTime = desired.positionSec;
    }
    if (desired.playing) {
      if (el.paused) {
        void el
          .play()
          .then(() => setJukeboxAudible(true))
          .catch(() => setJukeboxAudible(false));
      }
    } else if (!el.paused) {
      el.pause();
    }
  }, [jukebox, roomId]);

  /* The drift pass: every couple of seconds in the Music Hall, the
     element is checked against the room's anchor — and a play()
     the browser blocked before the walker's first tap is retried,
     so the first click in the room is what lets it be heard. */
  useEffect(() => {
    if (roomId !== MUSIC_HALL_ID) return;
    const id = setInterval(() => {
      const el = jukeboxAudioRef.current;
      const anchor = jukeboxAnchorRef.current;
      if (!el || !anchor.state?.current) return;
      const desired = jukeboxPlaybackNow(anchor.state, anchor.at, Date.now());
      if (!desired) return;
      if (el.getAttribute("src") === desired.url && jukeboxNeedsSeek(desired, el.currentTime)) {
        el.currentTime = desired.positionSec;
      }
      if (desired.playing && el.paused) {
        void el
          .play()
          .then(() => setJukeboxAudible(true))
          .catch(() => setJukeboxAudible(false));
      }
    }, 2000);
    return () => clearInterval(id);
  }, [roomId]);

  /* Walk-up keys: E opens the door you're standing at. Typing (the
     say box, any field) keeps its letters; an open panel keeps the
     key for itself. The opener + its guard live in openStationRef —
     the controller's LB lands on exactly the same door. */
  useEffect(() => {
    if (status !== "inside") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "e" && e.key !== "E") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (panelTarget || !nearStation) return;
      e.preventDefault();
      openStationRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, nearStation, panelTarget]);

  /* The screen remote's data: my live stream (the existing status
     endpoint — the same one the Go Live studio reads) and the video
     catalog, loaded when the panel opens. */
  const loadStageTools = async () => {
    if (!user) return;
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const [statusRes, catalogRes] = await Promise.all([
        fetch("/api/live-streams/status", { headers }),
        fetch("/api/world/screen-catalog", { headers }),
      ]);
      if (statusRes.ok) {
        const data = (await statusRes.json()) as { live_stream: { id: string; title: string } | null };
        setMyStream(data.live_stream ? { id: data.live_stream.id, title: data.live_stream.title } : null);
      }
      if (catalogRes.ok) {
        const data = (await catalogRes.json()) as { catalog: { mine: ScreenCatalogItem[]; public: ScreenCatalogItem[] } };
        setCatalog(data.catalog);
      }
    } catch {
      /* the panel keeps its honest empty states */
    }
  };

  useEffect(() => {
    if (screenPanelOpen && status === "inside") void loadStageTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenPanelOpen, status]);

  /* Load the member's vault characters for the picker (signed-in
     only — guests never see the row). A remembered pick whose
     character is gone (or lost its portrait) falls back to the house
     avatar instead of being sent off to be refused. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchVaultCharacters(getAccessToken, fetch, user.id)
      .then((chars) => {
        if (cancelled) return;
        setVaultChars(chars);
        setVaultLoadFailed(false);
        const reconciled = reconcileStoredPick(chars, walkInAsRef.current);
        if (reconciled !== walkInAsRef.current) setWalkInAs(reconciled);
      })
      .catch(() => {
        if (!cancelled) setVaultLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /* Vault manage verbs, offered by the picker on the member's OWN
     characters only: rename rides the vault's PUT rail, remove its
     DELETE rail (a soft delete — hidden everywhere, data kept). A
     rename lands in place; a removal drops the row, and if it was
     the standing pick the pick falls back to the house guard rather
     than pointing at a character that no longer stands. Errors
     propagate to the picker's manage strip — never a fake success. */
  const handleRenameVaultCharacter = async (id: string, newName: string) => {
    const renamed = await renameVaultCharacter(getAccessToken, id, newName, user?.id ?? null);
    setVaultChars((prev) => (prev ?? []).map((c) => (c.id === id ? { ...c, name: renamed.name } : c)));
  };
  const handleRemoveVaultCharacter = async (id: string) => {
    await removeVaultCharacter(getAccessToken, id);
    setVaultChars((prev) => (prev ?? []).filter((c) => c.id !== id));
    if (walkInAsRef.current === id) setWalkInAs(null);
  };

  /* The pick: remembered on the device, and handed to the hall
     connection whenever it changes (the client also applies it on
     entry when it was chosen before the door opened). */
  useEffect(() => {
    storeCharacterId(walkInAs);
    clientRef.current?.setCharacter(walkInAs);
  }, [walkInAs]);

  /* Run one voice-mode action through the machine and carry out
     its effects: the mic is hardware (release = stop the tracks and
     tear the mesh down; deafen = mute the track, mesh stays up),
     the announcements are presence frames, the gains are the mesh's
     policy, and the preference is device memory. */
  /* Character voice: whose voice the current presence speaks with,
     resolved from the character it stands as — the same resolution
     the scene dresses the figure by (a guard pick, the dealt guard,
     a vault character). Pure; the shaper diffs its own parameters,
     so syncing costs nothing when nothing changed. */
  const currentVoiceProfile = (): CharacterVoiceProfile => {
    const self = clientRef.current?.self;
    if (!self) return NEUTRAL_VOICE_PROFILE;
    return resolveCharacterVoiceProfile({
      characterId: self.character?.id ?? null,
      presenceKey: self.profileSlug ?? self.peerId,
      /* G4 (0142): a vault character's set voice rides its ref. */
      storedProfile: self.character?.voiceProfile ?? null,
      characterName: self.character?.name ?? null,
    });
  };

  const syncCharVoice = () => {
    const profile = currentVoiceProfile();
    if (profile.id !== voiceProfileRef.current.id) {
      voiceProfileRef.current = profile;
      setVoiceProfile(profile);
    }
    shaperRef.current?.apply(shapingParamsFor(profile, charVoiceRef.current));
  };

  const toggleCharVoice = () => {
    const next = !charVoiceRef.current;
    charVoiceRef.current = next;
    setCharVoiceOn(next);
    storeCharacterVoiceEnabled(next);
    shaperRef.current?.apply(shapingParamsFor(voiceProfileRef.current, next));
  };

  const teardownVoiceSession = () => {
    meshRef.current?.leave();
    meshRef.current = null;
    shaperRef.current?.dispose();
    shaperRef.current = null;
    localTapRef.current?.dispose();
    localTapRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    clientRef.current?.leaveVoice();
    setMuted(false);
  };

  const dispatchVoice = (action: VoiceToggleAction) => {
    const { state, effects } = reduceVoiceToggle(voiceSwitchRef.current, action);
    setVoiceSwitch(state);
    let store = false;
    for (const effect of effects) {
      if (effect === "release-mic") teardownVoiceSession();
      if (effect === "announce-off") {
        clientRef.current?.setVoiceOff(true);
        store = true;
      }
      if (effect === "announce-on") {
        clientRef.current?.setVoiceOff(false);
        store = true;
      }
      if (effect === "announce-deaf") {
        clientRef.current?.setVoiceDeaf(true);
        store = true;
      }
      if (effect === "announce-undeaf") {
        clientRef.current?.setVoiceDeaf(false);
        store = true;
      }
      if (effect === "deafen-mic") {
        meshRef.current?.setMuted(true);
        setMuted(true);
      }
      if (effect === "restore-mic") {
        meshRef.current?.setMuted(state.resumeMuted);
        setMuted(state.resumeMuted);
      }
      if (effect === "apply-mode") {
        meshRef.current?.setGainPolicy(gainPolicyForMode(state.mode));
      }
    }
    if (store) storeVoiceMode(state.mode);
  };

  const setVoiceMode = (mode: VoiceMode) => {
    /* Deafen captures the mic's current mute from the mesh itself —
       the track's own truth — so undeafening restores it exactly. */
    dispatchVoice({ type: "set-mode", mode, micMuted: meshRef.current?.isMuted ?? muted });
  };

  useEffect(() => {
    let cancelled = false;
    let peerSync: ReturnType<typeof setInterval> | null = null;
    let screenPoll: ReturnType<typeof setInterval> | null = null;
    let volumeTick: ReturnType<typeof setInterval> | null = null;
    let lipTick: ReturnType<typeof setInterval> | null = null;
    let stationTick: ReturnType<typeof setInterval> | null = null;

    (async () => {
      /* Boot failures BEFORE the socket exists (the scene chunk fails
         to load, or the WebGL2-only renderer throws on a no-WebGL2
         client) used to escape this IIFE uncaught — status stayed
         "connecting" forever and the page's own error card was
         unreachable. They route to the boot-failure card instead:
         the device couldn't START the hall, which is a different
         story from a dropped connection and wears different copy.
         Only a throw out of client.connect() itself (the socket
         wouldn't even construct) is a connection failure here —
         ordinary connect drops never throw; the client reports
         those through its status, retries included. */
      let bootPhase = true;
      try {
      setBootFailed(false);
      /* A (re-)entry starts from "Entering…" again. The fresh
         client built below never re-emits "connecting" — its own
         status starts there, so its setter sees no change and
         stays silent — so without this reset the previous
         sequence's error card would sit over the new attempt
         until its welcome lands. */
      setStatus("connecting");
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { KingsHallScene } = await import("@/lib/world/hall-scene");
      if (cancelled) return;
      const scene = new KingsHallScene(canvas, currentHallTheme());
      sceneRef.current = scene;
      scene.setViewMode(loadViewMode());
      scene.setQualityPreference(loadQualityPreference());
      void scene.isVrSupported().then((ok) => {
        if (!cancelled) setXrSupported(ok);
      });

      const client = new WorldClient({
        getAccessToken,
        /* Guests carry their tab's session id so a rejoin replaces
         * its own ghost peer — one tab, one presence, an honest
         * headcount. Members are keyed by their account instead. */
        socketUrl: (token) =>
          defaultWorldSocketUrl(window.location, token, token ? null : worldGuestSessionId()),
        openSocket: (url) => new WebSocket(url) as unknown as import("@/lib/world/world-client").WorldSocketLike,
      });
      clientRef.current = client;
      /* The screen loader is defined below (it needs the scene);
         broadcasts reach it through this indirection. */
      const screenApi: { reload: () => Promise<void> } = { reload: async () => undefined };
      // A remembered pick walks in with us (the client holds the
      // want and sends it the moment the welcome lands).
      if (walkInAsRef.current) client.setCharacter(walkInAsRef.current);
      // A remembered voice-off walks in with us too — the room's
      // name plates are right from the first frame. So does a
      // remembered deafen.
      const bootMode = loadVoiceMode();
      if (bootMode === "off") client.setVoiceOff(true);
      if (bootMode === "deafen") client.setVoiceDeaf(true);
      scene.onPose = (x, z, rotY) => client.sendMove(x, z, rotY);
      /* A doorway crossing: the scene already flipped its own room
         (the body is through the door); the presence follows by
         transfer, landing at the crossing point. */
      scene.onRoomEnter = (nextRoomId) => {
        if (cancelled) return;
        const pose = scene.localPose();
        client.enterRoom(nextRoomId, pose);
      };
      /* Controller face buttons land on the same controls the
         footer shows — one behavior, whatever drives it. A steps
         the voice mode; Y flips the view. */
      scene.onPadToggleVoice = () => {
        if (!cancelled) setVoiceMode(nextVoiceMode(voiceSwitchRef.current.mode));
      };
      scene.onPadToggleView = () => {
        if (!cancelled) toggleViewMode();
      };
      /* Controller action buttons perform through the same path as
         the on-screen bar (D-pad + face buttons, see gamepad.ts). */
      scene.onPadAction = (action) => {
        if (!cancelled) performActionRef.current(action);
      };
      /* LB at a door: the station interact — the E key's twin,
         guarded by the same opener (prompt showing, no panel). */
      scene.onPadInteract = () => {
        if (!cancelled) openStationRef.current();
      };
      /* My figure's action ended on its own (a finished one-shot,
         a walk that stopped the dance) — the bar follows. */
      scene.onSelfAction = (action) => {
        if (cancelled) return;
        setMyAction(action);
        myActionRef.current = action;
      };
      /* Peers' actions land on their figures. */
      client.onPeerAction = (peerId, action) => {
        if (cancelled || peerId === client.self?.peerId) return;
        scene.setPeerAction(peerId, action);
      };

      client.onReconnectingChange = (r) => {
        if (!cancelled) setReconnecting(r);
      };
      client.onStatus = (s) => {
        if (cancelled) return;
        setStatus(s);
        if (s === "inside" && client.self) {
          /* The welcome names the room I actually landed in (the
             plaza since Open World Phase 1) — the first welcome
             never fires onRoomChanged, so the header and the
             hall-gated chrome take the room from here. */
          if (client.room) {
            setRoomId(client.room.id);
            setRoomName(client.room.name);
          }
          setIsGuest(client.self.guest);
          setMyName(client.self.displayName);
          setMySlug(client.self.profileSlug);
          setStageScreen(client.screen);
          setHostMuted(client.self.hostMuted);
          hostMutedRef.current = client.self.hostMuted;
          setIsAdmin(client.self.admin);
          setMyPeerId(client.self.peerId);
          jukeboxAnchorRef.current = { state: client.jukebox, at: Date.now() };
          setJukebox(client.jukebox);
          // Your own figure (seen in third person) stands as you.
          scene.setSelfFigure(client.self);
          if (!spawnedRef.current) {
            spawnedRef.current = true;
            /* The scene is born defaulting to the hall; confirm the
               welcome's room BEFORE the spawn is placed, or the
               spawn clamp files a plaza arrival (z 31.5) into the
               hall's floor (z ≤ 11.1) and the body materializes at
               the hall's south doors instead of on the promenade.
               Movement, camera clamp and shell visibility all key
               off the scene's room, so this one confirmation is
               what makes the landing real. */
            if (client.room) scene.setRoom(client.room.id);
            scene.setSpawn(client.self.x, client.self.z);
          }
        }
      };
      client.onDirectory = (rooms) => {
        if (!cancelled) setDirectory(rooms);
      };
      /* A doorway transfer landed: the room is new — its crowd
         replaces the old room's on the next peer sync, the Screen
         panel (the hall's stage) closes, and the voice session
         ends here: the mesh belongs to the room you left, and
         rejoining in the new room is one tap, like joining always
         was. The mode itself is untouched — only the session. */
      client.onRoomChanged = (room) => {
        if (cancelled) return;
        const wasInVoice = voiceSwitchRef.current.inVoice;
        if (wasInVoice) {
          teardownVoiceSession();
          dispatchVoice({ type: "voice-left" });
        }
        setRoomId(room.id);
        setRoomName(room.name);
        /* A creator room dresses the template as its host. The
           pick/deep-entry paths dressed it before the transfer;
           a walk back in through the arch (or a cold landing)
           re-dresses from the cached read, or reads the room now. */
        if (isCreatorRoomId(room.id)) {
          const slug = creatorSlugFromRoomId(room.id);
          const cached = slug ? creatorDetailsRef.current.get(slug) : undefined;
          if (slug && cached) dressCreatorRoom(cached);
          else if (slug) {
            void fetchCreatorRoomDetail(slug).then((detail) => {
              if (detail && !cancelled) dressCreatorRoom(detail);
            });
          }
        }
        // The old room's doors close with it: an open panel and the
        // walk-up prompt belong to the room they stand in.
        setPanelTarget(null);
        nearStationIdRef.current = null;
        setNearStation(null);
        // A doorway starts the figure clean in the new room (the
        // server resets the performed action on transfer too).
        setMyAction(null);
        myActionRef.current = null;
        scene.setRoom(room.id);
        scene.removeAllPeers();
        setScreenPanelOpen(false);
        setSayLog((log) => [
          ...log.slice(-7),
          { peerId: "hall", displayName: "The Palace", body: `You walked into the ${room.name}.` },
        ]);
        if (wasInVoice) {
          setVoiceNote(
            `Voice stayed in the room you left — it's per-room here. Join voice to talk in the ${room.name}.`,
          );
        }
      };
      /* A full room refused the doorway: I never left. The scene
         flips back to the room the server holds me in and steps
         back through the door. */
      client.onRoomUnavailable = ({ name, cap }) => {
        if (cancelled) return;
        scene.setRoom(client.room?.id ?? HALL_ROOM_ID);
        scene.returnThroughDoor();
        setVoiceNote(
          `The ${name} is full right now — ${cap} people inside. You're still in the ${client.room?.name ?? "King's Hall"}.`,
        );
      };
      client.onPeerJoin = (peer) => scene.upsertPeer(peer);
      client.onPeerCharacter = (peerId) => {
        // Your own pick confirmed by the room: re-dress your figure.
        if (client.self && peerId === client.self.peerId) scene.setSelfFigure(client.self);
      };
      client.onPeerLeave = (peerId) => scene.removePeer(peerId);
      client.onSay = (ev) => {
        if (!cancelled) setSayLog((log) => [...log.slice(-7), ev]);
      };
      client.onSignal = (from, data) => {
        void meshRef.current?.handleSignal(from, data as VoiceSignalData).catch(() => undefined);
      };
      client.onVoiceState = (ids) => {
        void meshRef.current?.handleVoiceState(ids).catch(() => undefined);
      };
      client.onVoicePeerLeft = (peerId) => meshRef.current?.dropPeer(peerId);
      client.onVoiceNotice = (notice) => {
        if (cancelled) return;
        if (notice === "full") {
          setVoiceNote("Voice is full right now — 12 people are talking. The hall still hears you in text.");
          dispatchVoice({ type: "voice-left" });
          setVoiceBusy(false);
        }
        if (notice === "denied-host") {
          setVoiceNote("The host muted your voice in this hall — you can listen and use text; voice opens again when the host lifts it.");
          dispatchVoice({ type: "voice-left" });
          setVoiceBusy(false);
        }
      };
      /* The stage: every room statement updates the remote's picture
         and re-reads the screen endpoint (the playback truth), and a
         notice (a takeover, a show ending) is said out loud in the
         hall's log — announced honestly, never silent. */
      client.onScreen = (s) => {
        if (cancelled) return;
        setStageScreen(s);
        if (s.notice) {
          setScreenNote(s.notice);
          setSayLog((log) => [
            ...log.slice(-7),
            { peerId: "hall", displayName: "The Hall", body: s.notice! },
          ]);
        }
        void screenApi.reload();
      };
      client.onScreenDenied = (holderName) => {
        if (cancelled) return;
        setScreenNote(
          holderName
            ? `The stage is held by ${holderName} — one hand on the screen at a time.`
            : "The screen didn't change — the stage isn't yours to drive right now.",
        );
      };
      /* A jukebox refusal (guests / unplayable / queue-full /
         not-yours): the panel says why, in words. */
      client.onJukeboxDenied = (reason) => {
        if (!cancelled) setJukeboxDenied(reason);
      };
      /* A witnessed moment (THE-GAME §5(a)): a win landed in this
         room — a quest completed, a level rose — verified and
         broadcast by the server. The chrome shows the moment
         banner, the room log keeps a line of it, and the
         achiever's nameplate already restarred inside the client
         (the peerSync below repaints it off the record). */
      client.onMoment = (moment) => {
        if (cancelled) return;
        const line = formatMomentLine(moment);
        showMomentLine(line);
        setSayLog((log) => [
          ...log.slice(-7),
          { peerId: "hall", displayName: "The Palace", body: line },
        ]);
      };
      /* A palace-wide announcement (Ring 3 §5(b)): whatever room
       * the moment happened in, this room hears it — the log keeps
       * the line under its speaker (the host for a herald, the King
       * for his moment, the Palace for the rest) and, unless the
       * announcements are muted on this device, the banner rises. */
      client.onAnnounce = (a) => {
        if (cancelled) return;
        setSayLog((log) => [
          ...log.slice(-7),
          { peerId: "hall", displayName: announceSpeaker(a), body: announceLine(a) },
        ]);
        if (!announceMutedRef.current && isAnnounceFresh(a, Date.now())) showAnnounce(a);
      };
      /* My herald was refused (not the host — the server checked —
       * or too soon after the last one): the host panel says why
       * instead of the words just vanishing. */
      client.onAnnounceDenied = () => {
        if (cancelled) return;
        setHeraldNote("The palace didn't take that herald — one at a time; give it a few seconds and try again.");
      };
      /* The King's daily moment (Ring 3): the hall's standing
       * state mirrors into the chrome (the hall card + the strip's
       * king line). A claim landing in the hall is witnessed
       * publicly — the room log keeps the line under the Palace;
       * my own landed claim also raises the moment toast. A
       * refusal of my claim says why, in plain words, on the card. */
      client.onKingMoment = (moment) => {
        if (cancelled) return;
        setKingMoment(moment);
        if (!moment) setKingNote(null);
      };
      client.onKingClaimed = (claim) => {
        if (cancelled) return;
        const line = kingClaimedLine(claim);
        setSayLog((log) => [
          ...log.slice(-7),
          { peerId: "hall", displayName: "The Palace", body: line },
        ]);
        showMomentLine(line);
      };
      client.onKingDenied = (reason) => {
        if (cancelled) return;
        setKingNote(kingDeniedLine(reason));
      };
      /* A stage tip landed in this room (Ring 3, item 3.3) —
       * witnessed publicly: the room log keeps the line under the
       * Palace and the moment toast names it. A refusal of MY tip
       * says why on the tip bar, in plain words. */
      client.onStageTipped = (tip) => {
        if (cancelled) return;
        const line = stageTippedLine(tip);
        setSayLog((log) => [
          ...log.slice(-7),
          { peerId: "hall", displayName: "The Palace", body: line },
        ]);
        showMomentLine(line);
      };
      client.onStageTipDenied = (reason) => {
        if (cancelled) return;
        setTipNote(stageTipDeniedLine(reason));
      };
      /* Drop spectacles (World Events 3.4): the chest standing in
       * THIS room. applyDropState is the one writer of the page's
       * mirror — the drop frames land on it, and the station tick
       * below reconciles the welcome snapshot through it too (a
       * drop already standing when you walk in rides the welcome,
       * with no frame of its own; the chest stays in its room, so
       * a doorway walk reconciles to the new room's truth — none,
       * or that room's own chest). A claim identity change (a new
       * chest, a sweep, a room change) retires the last refusal:
       * the note belonged to the old chest. A landed claim is
       * witnessed by the room — the log + the moment toast carry
       * it; the claim is MINE when the witnessed name is my own
       * (the frame's name + amount are server truth), and only
       * then does my book turn. A refusal of MY claim says why on
       * the card, in plain words. */
      const applyDropState = (d: WorldDropState | null) => {
        const identityChanged = dropAnchorRef.current?.eventId !== d?.eventId;
        dropAnchorRef.current = d;
        if (cancelled) return;
        setDrop(d);
        setDropBook((book) => dropBookForDrop(book, d));
        if (identityChanged) setDropNote(null);
      };
      client.onDropLanded = (landed) => {
        if (cancelled) return;
        /* The herald words ride the palace announcement (the room
         * hears them there); here the landing stands the card up
         * with the fresh bookkeeping. */
        applyDropState(landed);
      };
      client.onDrop = (d) => {
        if (cancelled) return;
        applyDropState(d);
      };
      client.onDropClaimed = (claim, dropState) => {
        if (cancelled) return;
        const line = dropClaimedLine(claim);
        setSayLog((log) => [
          ...log.slice(-7),
          { peerId: "hall", displayName: "The Palace", body: line },
        ]);
        showMomentLine(line);
        const mine = client.self != null && claim.name === client.self.displayName;
        const standing = dropState ?? dropAnchorRef.current;
        setDropBook((book) => dropBookClaimed(book, standing, mine));
      };
      client.onDropDenied = (reason) => {
        if (cancelled) return;
        setDropNote(dropDeniedLine(reason));
        setDropBook((book) => dropBookDenied(book, dropAnchorRef.current, reason));
      };
      client.onHostMuted = (mutedNow) => {
        if (cancelled) return;
        setHostMuted(mutedNow);
        hostMutedRef.current = mutedNow;
        if (mutedNow) {
          /* The room already dropped me from the mesh; the local
             side follows — mic released, session torn down. */
          teardownVoiceSession();
          dispatchVoice({ type: "voice-left" });
          setScreenNote("The host muted your voice in the hall.");
        } else {
          setScreenNote("The host lifted your mute — you can join voice again.");
        }
      };

      /* Keep the scene's avatar targets glued to the client's roster,
         and the headcount honest. */
      peerSync = setInterval(() => {
        for (const peer of client.peers.values()) scene.upsertPeer(peer);
        if (client.self && client.status === "inside") scene.setSelfFigure(client.self);
        /* Character voice follows the same presence: a character
           pick landing mid-session re-voices the live mic. */
        if (client.self && client.status === "inside") syncCharVoice();
        if (!cancelled) setPeopleCount(client.status === "inside" ? client.peers.size + 1 : 0);
        /* The host panel's roster, refreshed only when it actually
           changes (the signature keeps this off the render path). */
        if (client.self) {
          const all = [client.self, ...client.peers.values()];
          const sig = all
            .map((p) => `${p.peerId}:${p.voice ? 1 : 0}:${p.voiceOff ? 1 : 0}:${p.voiceDeaf ? 1 : 0}:${p.hostMuted ? 1 : 0}:${p.admin ? 1 : 0}:${p.displayName}`)
            .join(";");
          if (sig !== rosterSigRef.current) {
            rosterSigRef.current = sig;
            if (!cancelled) setRoster(all);
          }
        }
      }, 120);

      /* The big screen: featured reel, or the live picture while a
         stream is truly live — re-checked so a stream starting
         mid-visit takes the screen, and one ending hands it back. */
      const loadScreen = async () => {
        try {
          const res = await fetch("/api/world/screen");
          if (!res.ok) return;
          const data = (await res.json()) as { screen: ScreenInfo };
          if (cancelled) return;
          setScreen(data.screen);
          await scene.setScreenSource({
            mode: data.screen.mode,
            videoUrl: data.screen.videoUrl,
            hlsUrl: data.screen.hlsUrl,
            playing: data.screen.playback?.playing,
            startAtSec: data.screen.playback?.positionSec,
          });
          /* A watch party already rolling: if the source didn't
             change, setScreenSource is a no-op — the play/pause +
             position still need applying. */
          if (data.screen.mode === "video" && data.screen.playback) {
            scene.setScreenPlayback(data.screen.playback.playing, data.screen.playback.positionSec);
          }
        } catch {
          /* the screen keeps its idle card — the room still works */
        }
      };
      screenApi.reload = loadScreen;
      /* The door starts NOW, not after the screen fetch. Boot used
         to serialize chunk → scene → screen → socket, and the
         screen fetch (an HTTP call with no timeout of its own, on
         the same waking box) could hold the socket hostage for its
         entire wake — the page sat on "Entering…" with no socket
         ever opened. The screen content lands whenever its fetch
         does; the poll below keeps it fresh either way, and the
         socket welcome carries the room's screen state for the
         page in the meantime. A throw out of connect() still
         routes through this boot's catch (bootPhase is already
         false) exactly as when it was awaited at the tail. */
      bootPhase = false;
      const connectPromise = client.connect();
      await loadScreen();
      /* Boot-lifecycle guard: if the effect was cleaned up while
         the screen fetch was in flight, this boot is DEAD — its
         cleanup already ran, reading the interval slots below as
         still-null. Arming them now would leak all four forever,
         ticking against a disposed scene, and the tail would go
         on awaiting a dead client's connect promise. Disconnect
         from the boot's own hand too (the cleanup disconnects via
         clientRef; this makes the boot itself guarantee it), so
         the client this boot started can never hold a socket past
         the boot's end — and arm nothing. A live boot never sees
         cancelled here, so entry behavior is unchanged. */
      if (cancelled) {
        client.disconnect();
        return;
      }
      screenPoll = setInterval(loadScreen, 45_000);

      /* Proximity voice follows the avatars. */
      volumeTick = setInterval(() => {
        const mesh = meshRef.current;
        if (!mesh || !client.self) return;
        const positions = new Map<string, { x: number; z: number }>();
        for (const peer of client.peers.values()) {
          if (peer.voice) positions.set(peer.peerId, { x: peer.x, z: peer.z });
        }
        const pose = scene.localPose();
        mesh.updateVolumes({ x: pose.x, z: pose.z }, positions);
      }, 250);

      /* Character lips: each character figure's mouth follows its
         speaker's live voice level, measured off the very stream
         this client receives from them. (Your own figure is driven
         the same way — on everyone else's screen, from the stream
         they receive from you.) */
      lipTick = setInterval(() => {
        const mesh = meshRef.current;
        if (mesh) {
          for (const peer of client.peers.values()) {
            /* Character portraits and the default guard figure both
               carry landmarked lips; the scene ignores figures
               without a mouth (capsules) on its own. */
            scene.setSpeechLevel(peer.peerId, mesh.levelFor(peer.peerId));
          }
        }
        // Your own lips follow your own mic (third person shows them).
        if (client.self) {
          scene.setSelfSpeechLevel(localTapRef.current?.getLevel() ?? 0);
        }
      }, 66);

      /* The doors: the walk-up prompt follows the walker's pose
         (the nearest station in this room, from the registry the
         scene's markers are built from), and the jukebox mirror
         stays glued to the room's own state — welcome stamps and
         jukebox.state frames both land on client.jukebox first, so
         a reference change here is the room speaking. A landed
         state also clears the last refusal: the action went
         through, the note has done its work. */
      stationTick = setInterval(() => {
        if (client.status !== "inside" || !client.room) {
          if (nearStationIdRef.current !== null) {
            nearStationIdRef.current = null;
            if (!cancelled) setNearStation(null);
          }
        } else {
          const pose = scene.localPose();
          const st = nearestStation(client.room.id, pose.x, pose.z);
          const id = st?.id ?? null;
          if (id !== nearStationIdRef.current) {
            nearStationIdRef.current = id;
            if (!cancelled) setNearStation(st);
          }
        }
        if (client.jukebox !== jukeboxAnchorRef.current.state) {
          jukeboxAnchorRef.current = { state: client.jukebox, at: Date.now() };
          if (!cancelled) {
            setJukebox(client.jukebox);
            setJukeboxDenied(null);
          }
        }
        /* The drop mirror reconciles the same way: welcome stamps
         * (a chest already standing in the room you enter, a sweep
         * while you were quietly reconnecting) land on client.drop
         * with no frame of their own — a reference change here is
         * the room speaking. Live drop frames beat the tick to it
         * through the handlers; applyDropState is the one writer
         * either way. */
        if (client.drop !== dropAnchorRef.current) {
          applyDropState(client.drop);
        }
      }, 200);

      await connectPromise;
      } catch {
        if (!cancelled) {
          if (bootPhase) setBootFailed(true);
          else setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (peerSync) clearInterval(peerSync);
      if (screenPoll) clearInterval(screenPoll);
      if (volumeTick) clearInterval(volumeTick);
      if (lipTick) clearInterval(lipTick);
      if (stationTick) clearInterval(stationTick);
      meshRef.current?.leave();
      meshRef.current = null;
      shaperRef.current?.dispose();
      shaperRef.current = null;
      localTapRef.current?.dispose();
      localTapRef.current = null;
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      clientRef.current?.disconnect();
      clientRef.current = null;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      spawnedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const joinVoice = async () => {
    const client = clientRef.current;
    if (!client || voiceBusy || !canJoinVoice(voiceSwitchRef.current)) return;
    if (hostMutedRef.current) {
      setVoiceNote("The host muted your voice in this hall — voice opens again when the host lifts it.");
      return;
    }
    setVoiceBusy(true);
    setVoiceNote(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      /* Character voice inserts HERE: the shaper wraps the raw mic
         and the mesh sends its output stream instead. create()
         fails open — null (or any error) means the mesh gets the
         raw stream and the hall hears your own voice, never
         silence. The lips tap below still reads the RAW stream:
         your real level, pre-shaping. */
      const shaper = await CharacterVoiceShaper.create(
        stream,
        shapingParamsFor(currentVoiceProfile(), charVoiceRef.current),
      ).catch(() => null);
      shaperRef.current = shaper;
      const mesh = new VoiceMesh({
        sendSignal: (to, data) => client.sendSignal(to, data),
        createPeerConnection: createBrowserPeerConnection,
        createSink: createBrowserVoiceSink,
      });
      meshRef.current = mesh;
      mesh.start(shaper?.outputStream ?? stream);
      /* A fresh mesh hears with the CURRENT mode's policy — joining
         in Lobby hears the hall, joining deafened hears nobody (and
         the machine's deafen-mic mutes the mic on the join). */
      mesh.setGainPolicy(gainPolicyForMode(voiceSwitchRef.current.mode));
      localTapRef.current = createLocalLevelTap(stream);
      setMuted(false);
      client.joinVoice();
      dispatchVoice({ type: "voice-joined" });
    } catch {
      setVoiceNote("Your mic was blocked — voice needs mic permission. You can still walk the hall and use text.");
    } finally {
      setVoiceBusy(false);
    }
  };

  const leaveVoice = () => {
    teardownVoiceSession();
    dispatchVoice({ type: "voice-left" });
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    meshRef.current?.setMuted(next);
  };

  const enterVr = async () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const ok = await scene.enterVr();
    if (!ok) setXrNote("Couldn't start a VR session here — you can still walk the room on this screen.");
  };

  const sendSay = () => {
    const client = clientRef.current;
    if (!client) return;
    if (client.say(draft)) setDraft("");
  };

  /* King tray in the say box: the token joins the draft as text and
     rides the say relay unchanged — the log renders the King's art. */
  const insertSayToken = (token: string) => {
    const el = sayInputRef.current;
    const next = insertAtCursor(draft, token, el?.selectionStart ?? null, el?.selectionEnd ?? null, 300);
    setDraft(next.value);
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      }
    });
  };

  const overlay = worldOverlay(status);
  const isLight = siteTheme === "light";
  /* The stage, from the room's own broadcasts: one holder, one hand
     on the screen — the host outranks the holder, always. */
  const stageHolder = stageScreen?.holder ?? null;
  const iHoldStage = !!stageHolder && stageHolder.peerId === myPeerId;
  /* The drop card's claim state for THIS viewer (guest / claimed /
   * out / open) + whether my claim is still out on the chest —
   * the pure reads are lib/world/drop-spectacle's. */
  const dropView = drop ? dropClaimView(drop, isGuest, dropBook) : null;
  const dropInFlight = drop ? dropClaimInFlight(drop, dropBook) : false;
  const canDriveScreen = !stageHolder || iHoldStage || isAdmin;
  const stageVideoPlaying = stageScreen?.playback?.playing ?? false;
  const panelBtnCls = (active: boolean) =>
    `inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
      active
        ? "border-[#d4af37] bg-[#d4af37]/15 text-[#e8c86a]"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  /* The voice modes in the words the control speaks them. */
  const voiceModeLabels: Record<VoiceMode, string> = {
    off: "Off",
    proximity: "Proximity",
    lobby: "Lobby",
    deafen: "Deafen",
  };

  return (
    <div
      className={`flex min-h-screen flex-col ${isLight ? "bg-[#f3ead3] text-[#2a1e07]" : "bg-black text-white"}`}
      {...(isLight ? {} : { "data-dark-lock": true })}
    >
      {/* ── Chrome ── */}
      <header className={`relative z-20 flex flex-wrap items-center gap-3 border-b px-4 py-3 ${isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9]" : "border-[#d4af37]/25 bg-[#070605]"}`}>
        <Link href="/go-live" className={`inline-flex items-center gap-1.5 text-sm transition ${isLight ? "text-[#6B5B36] hover:text-[#2a1e07]" : "text-white/50 hover:text-white"}`}>
          <ArrowLeft className="h-4 w-4" /> Go Live
        </Link>
        <h1 className="flex items-center gap-2 text-base font-black tracking-wide sm:text-lg">
          <Crown className="h-5 w-5 text-[#d4af37]" />
          The World <span className={`font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>· {roomName}</span>
        </h1>
        {screen?.mode === "live" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            {screen.stage ? (
              <>LIVE — {screen.stage.name} · {screen.title}</>
            ) : (
              <>
                LIVE on the big screen: {screen.title}
                {screen.creatorName ? <span className="text-red-300/60">· {screen.creatorName}</span> : null}
              </>
            )}
          </span>
        ) : screen?.mode === "video" ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${isLight ? "border-[#C9A84C]/40 bg-white/50 text-[#6B5B36]" : "border-[#d4af37]/30 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
            On the big screen: {screen.title}
            {screen.stage ? <span className="opacity-70">· {screen.stage.name}&rsquo;s pick</span> : null}
          </span>
        ) : (
          <span className={`hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold sm:inline-flex ${isLight ? "border-[#C9A84C]/40 bg-white/50 text-[#6B5B36]" : "border-white/10 bg-white/5 text-white/50"}`}>
            On the big screen: The King's Reel
          </span>
        )}
        <span className={`ml-auto inline-flex items-center gap-1.5 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/60"}`}>
          <Users className="h-4 w-4 text-[#d4af37]" />
          {status === "inside" ? `${peopleCount} ${inHall ? "in the hall" : `in the ${roomName}`}` : "—"}
        </span>
        {status === "inside" && (
          <button
            type="button"
            onClick={toggleAnnounceMuted}
            data-testid="world-announce-toggle"
            aria-pressed={!announceMuted}
            title={announceMuted ? "Palace announcements are muted on this device — tap to hear the palace again" : "Palace announcements — tap to mute them on this device"}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}
          >
            {announceMuted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            {announceMuted ? "Announcements off" : "Announcements on"}
          </button>
        )}
        {fsSupported && (
          <button
            type="button"
            onClick={toggleFs}
            data-testid="world-fullscreen"
            aria-pressed={isFs}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}
          >
            {isFs ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            {isFs ? "Exit full screen" : "Full screen"}
          </button>
        )}
        {/* The inbox bell (stack-100 #78): the member's real
            notifications rail in the chrome — unread badge, panel,
            mark-read, and in-world navigation to the group / Post
            Office a notification points at. Members only: the rail
            is requireAuth and a guest holds no inbox. */}
        {status === "inside" && !isGuest && (
          <WorldNotificationsBell
            isLight={isLight}
            onOpenStation={(stationId) => {
              const station = STATION_BY_ID.get(stationId);
              if (station) setPanelTarget({ kind: "station", station });
            }}
          />
        )}
        {/* The standing switch (owner addendum, Oct 17): the plain
            way out of the palace to the 2D website — always in the
            chrome, both themes, guests included. Distinct from the
            panels' "Open on the website ↗" footers, which peek at a
            station's page in a new tab without leaving the room. */}
        <SwitchToWebsite isLight={isLight} />
      </header>

      {/* The Objective Strip (THE-GAME §5(a)): pinned in the chrome
          across every room — your current quest, your streak's next
          milestone, and the palace's next event, each named from
          its server rail. Guests see only the palace slot plus the
          sign-in pitch: they hold no hand, so there is no objective
          and no streak to name for them. */}
      {status === "inside" && (
        <ObjectiveStrip
          isLight={isLight}
          isGuest={isGuest}
          directory={directory}
          kingMoment={kingMoment}
          tutorialLine={tutorialStripLine(tutorialStatus)}
          onTutorialClaim={
            tutorialStatus?.completed && !tutorialStatus.reward.claimed
              ? claimTutorialReward
              : undefined
          }
          tutorialClaimBusy={tutorialClaimBusy}
        />
      )}
      {/* The tutorial's guidance + claim word (Phase 6): one quiet
          line under the strip — where the current step happens, or
          what the claim said. Members on the line only. */}
      {status === "inside" && !isGuest && (tutorialGuidance(tutorialStatus) || tutorialMsg) && (
        <div
          className={`relative z-20 flex items-center gap-2 px-4 py-1 text-[11px] font-medium ${
            isLight ? "bg-[#FBF6E9] text-[#6B5B36]" : "bg-[#070605] text-white/55"
          }`}
          data-testid="world-tutorial-guidance"
        >
          <span>{tutorialMsg ?? tutorialGuidance(tutorialStatus)}</span>
          {tutorialMsg && (
            <button
              type="button"
              onClick={() => setTutorialMsg(null)}
              className="font-bold underline underline-offset-2"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* The palace announcement (Ring 3, THE-GAME §5(b)): the
          palace speaking to every room at once — a drop landed
          somewhere, a show is starting, a level rose, the King is
          holding his moment, or the host heralded. It names the
          room the moment belongs to when it isn't this one, and it
          carries its own off switch (the header toggle is the
          same switch, always in reach). Muted on this device, the
          banner never rises — the room log still keeps the line. */}
      {status === "inside" && announce && !announceMuted && (
        <div
          className={`relative z-20 flex flex-wrap items-center gap-3 border-b px-4 py-2.5 ${
            isLight
              ? "border-[#C9A84C]/60 bg-[#f6ead0]"
              : "border-[#d4af37]/40 bg-[#171106]"
          }`}
          data-testid="world-announce-banner"
          role="status"
        >
          <Megaphone className="h-5 w-5 shrink-0 text-[#d4af37]" />
          <p className={`flex-1 text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
            {announceLine(announce)}
            {announce.roomName && announce.roomId !== roomId && (
              <span className="opacity-75"> — in the {announce.roomName}</span>
            )}
          </p>
          <button
            type="button"
            onClick={toggleAnnounceMuted}
            data-testid="world-announce-mute"
            aria-label="Mute palace announcements on this device"
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}
          >
            <BellOff className="h-3.5 w-3.5" /> Mute
          </button>
          <button
            type="button"
            onClick={() => setAnnounce(null)}
            data-testid="world-announce-dismiss"
            aria-label="Dismiss this announcement"
            className={`inline-flex items-center rounded-full border p-1.5 transition ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* The King's daily moment (Ring 3): while his claim window
          stands in the hall, the court card stands in the chrome —
          members standing here claim today's audience gift (one
          per member, drawn from the week's quest pool; the server
          verifies all of it), guests witness and get the honest
          sign-in line. The card is the hall's: walk out of the
          hall and it goes with the room's state. */}
      {status === "inside" && inHall && isKingMomentLive(kingMoment, Date.now()) && kingMoment && (
        <div
          className={`relative z-20 flex flex-wrap items-center gap-3 border-b px-4 py-2.5 ${
            isLight
              ? "border-[#C9A84C]/60 bg-[#FBF6E9]"
              : "border-[#d4af37]/40 bg-[#0d0a05]"
          }`}
          data-testid="world-king-card"
          role="status"
        >
          <Crown className="h-5 w-5 shrink-0 text-[#d4af37]" />
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white/90"}`}>
              {kingMomentHeadline(kingMoment, isGuest)}
            </p>
            <p className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
              {kingNote ?? kingMomentLine(kingMoment, isGuest)}
            </p>
          </div>
          {!isGuest && !kingMoment.claimed && (
            <button
              type="button"
              onClick={() => {
                setKingNote(null);
                clientRef.current?.claimKingGift();
              }}
              data-testid="world-king-claim"
              className="rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105"
            >
              Claim today&rsquo;s gift
            </button>
          )}
          {!isGuest && kingMoment.claimed && (
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-bold ${isLight ? "border-[#7A5A12]/30 text-[#7A5A12]" : "border-[#d4af37]/40 text-[#e8c86a]"}`}
              data-testid="world-king-claimed"
            >
              Gift claimed
            </span>
          )}
        </div>
      )}

      {/* Drop spectacles (World Events 3.4): while a chest stands
          in THIS room, the drop card stands in the chrome — in
          whatever room the chest fell, since only the room it
          landed in can claim it (you had to BE there). Members
          claim with one tap; the room verifies member + room +
          first-come and the shared weekly pool pays. Guests
          witness and get the honest sign-in line — no claim
          affordance. The card goes with the room's state: walk
          out and it's gone. */}
      {status === "inside" && drop && dropView && (
        <div
          className={`relative z-20 flex flex-wrap items-center gap-3 border-b px-4 py-2.5 ${
            isLight
              ? "border-[#C9A84C]/60 bg-[#FBF6E9]"
              : "border-[#d4af37]/40 bg-[#0d0a05]"
          }`}
          data-testid="world-drop-card"
          role="status"
        >
          <Gem className="h-5 w-5 shrink-0 text-[#d4af37]" />
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white/90"}`}>
              {dropHeadline(drop)}
            </p>
            <p className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
              {dropNote ?? dropLine(drop, dropView)}
            </p>
          </div>
          {dropView === "open" && (
            <button
              type="button"
              disabled={dropInFlight}
              onClick={() => {
                setDropNote(null);
                setDropBook((book) => dropBookClaimSent(book, drop));
                clientRef.current?.claimDrop();
              }}
              data-testid="world-drop-claim"
              className="rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-60 disabled:hover:scale-100"
            >
              {dropInFlight
                ? "Claiming…"
                : `Claim ${drop.amountVb.toLocaleString("en-US")} VB`}
            </button>
          )}
          {dropView === "claimed" && (
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-bold ${isLight ? "border-[#7A5A12]/30 text-[#7A5A12]" : "border-[#d4af37]/40 text-[#e8c86a]"}`}
              data-testid="world-drop-claimed"
            >
              Claimed
            </span>
          )}
          {dropView === "out" && (
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-bold ${isLight ? "border-[#7A5A12]/30 text-[#7A5A12]" : "border-[#d4af37]/40 text-[#e8c86a]"}`}
              data-testid="world-drop-out"
            >
              All claimed
            </span>
          )}
        </div>
      )}

      {/* Stage tips from seats (Ring 3, item 3.3): while someone
          ELSE holds this room's stage, the tip bar stands in the
          chrome — preset Visual Bucs amounts, one tap. The room
          verifies everything (member, held stage, bounds, pace)
          and the transfer moves server-side; a landed tip is
          witnessed by the whole room. Guests get the honest line:
          tipping is members' business. Your own stage never shows
          the bar — you can't tip yourself. */}
      {status === "inside" && stageHolder && !iHoldStage && (
        <div
          className={`relative z-20 flex flex-wrap items-center gap-2 border-b px-4 py-2 ${
            isLight
              ? "border-[#C9A84C]/50 bg-[#FBF6E9]"
              : "border-[#d4af37]/25 bg-[#070605]"
          }`}
          data-testid="world-stage-tip-bar"
        >
          <span className={`inline-flex items-center gap-2 text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white/90"}`}>
            <Coins className="h-4 w-4 text-[#d4af37]" />
            Tip {stageHolder.name}
          </span>
          {isGuest ? (
            <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
              Members tip the stage in Visual Bucs — sign in to tip the show.
            </span>
          ) : (
            <>
              {STAGE_TIP_PRESETS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => {
                    setTipNote(null);
                    clientRef.current?.tipStage(amount);
                  }}
                  data-testid={`world-stage-tip-${amount}`}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition hover:scale-105 ${isLight ? "border-[#7A5A12]/30 text-[#7A5A12] hover:bg-[#d4af37]/15" : "border-[#d4af37]/40 text-[#e8c86a] hover:bg-[#d4af37]/10"}`}
                >
                  {amount.toLocaleString("en-US")} VB
                </button>
              ))}
              {tipNote && (
                <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-stage-tip-note">
                  {tipNote}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Walk in as — members pick a Creative Vault character (or the
          house avatar) as who they stand in the hall as. Guests and
          signed-out visitors never see the row. */}
      {user ? (
        <WalkInAsPicker
          characters={vaultChars}
          loadFailed={vaultLoadFailed}
          selectedId={walkInAs}
          onSelect={setWalkInAs}
          isLight={isLight}
          onRename={handleRenameVaultCharacter}
          onRemove={handleRemoveVaultCharacter}
        />
      ) : null}

      {/* The palace directory — every room, who's inside it, and a
          LIVE mark when a show holds the hall's stage. The front-
          door signal: your people are here, in a room with a name. */}
      {directory.length > 0 && (
        <div
          className={`relative z-20 flex flex-wrap items-center gap-1.5 border-b px-4 py-2 ${isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9]" : "border-[#d4af37]/25 bg-[#070605]"}`}
          data-testid="world-directory"
        >
          <span className={`mr-1 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            The Palace
          </span>
          {directory.map((r) => {
            const here = status === "inside" && r.id === roomId;
            return (
              <button
                key={r.id}
                type="button"
                data-testid="world-directory-room"
                aria-current={here ? "true" : undefined}
                aria-label={`${r.name}, ${r.count} ${r.count === 1 ? "person" : "people"} inside${r.live ? ", live now" : ""}${r.locked ? ", door locked" : ""}${here ? ", you're here" : ""}`}
                onClick={() => goToDirectoryRoom(r)}
                className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] ${
                  isLight ? "focus-visible:ring-offset-[#FBF6E9]" : "focus-visible:ring-offset-[#070605]"
                } ${
                  here
                    ? "border-[#d4af37] bg-[#d4af37]/15 text-[#e8c86a]"
                    : isLight
                      ? "border-[#C9A84C]/40 bg-white/50 text-[#6B5B36]"
                      : "border-white/10 bg-white/5 text-white/55"
                }`}
              >
                {r.live && (
                  <span className="inline-flex items-center gap-1 font-black text-red-400">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> LIVE
                  </span>
                )}
                {r.locked && (
                  <span
                    className={`inline-flex items-center gap-1 font-black uppercase tracking-wide ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}
                    data-testid="world-directory-room-locked"
                  >
                    Locked
                  </span>
                )}
                <span className={here ? "font-black" : ""}>
                  {r.name} · {r.count}
                </span>
                {here ? (
                  <span className="opacity-80">· you&rsquo;re here</span>
                ) : r.members.length > 0 ? (
                  <span className="max-w-[220px] truncate opacity-75">
                    · {r.members.slice(0, 3).join(", ")}
                    {r.count > 3 ? ` +${r.count - 3}` : ""}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {/* The party summons (2.23): a /world?party=CODE landing. The
          table named here is the SERVER's room snapshot, not the
          link's claim — a closed table says so, a FULL table reads
          full and offers the Game Rooms instead of a seat that
          isn't there (partyTableSeatState, the profile block's
          precedent), a guest gets the members-only pitch, and
          nobody is auto-seated: the walk and the seat are the
          walker's own taps. */}
      {partyInviteCode && status === "inside" && !inviteDismissed && (
        <div
          className={`relative z-20 flex flex-wrap items-center gap-3 border-b px-4 py-2.5 ${
            isLight
              ? "border-[#C9A84C]/60 bg-[#f6ead0]"
              : "border-[#d4af37]/40 bg-[#171106]"
          }`}
          data-testid="world-party-summons-banner"
        >
          <PartyPopper className="h-5 w-5 shrink-0 text-[#d4af37]" />
          {isGuest ? (
            <>
              <p className={`flex-1 text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
                A friend summoned you to their party table — but the tables are
                members-only. Sign in, then open this same link and your seat will be
                waiting.
              </p>
              <Link
                href={`/login?next=${encodeURIComponent(`/world?party=${partyInviteCode}`)}`}
                className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-1.5 text-sm font-bold text-black transition hover:scale-105"
              >
                Sign in to join the table
              </Link>
            </>
          ) : !inviteResolved ? (
            <p className={`flex-1 text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
              You&rsquo;ve been summoned to a party table — checking that it&rsquo;s
              still open…
            </p>
          ) : inviteRoom && partyTableSeatState(inviteRoom) === "full" ? (
            <>
              <p className={`flex-1 text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
                {partySummonsHeadline(inviteRoom)} — {inviteRoom.players}/
                {PARTY_GAME_META[inviteRoom.game].seats} seated, and every seat is
                taken. The Game Rooms are open if you want a table of your own.
              </p>
              <button
                type="button"
                data-testid="world-party-summons-go"
                onClick={goToInvitedTable}
                className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-1.5 text-sm font-bold text-black transition hover:scale-105"
              >
                Go to the Game Rooms
              </button>
            </>
          ) : inviteRoom ? (
            <>
              <p className={`flex-1 text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
                {partySummonsHeadline(inviteRoom)} — {inviteRoom.players}/
                {PARTY_GAME_META[inviteRoom.game].seats} seated
                {inviteRoom.profileSlug
                  ? `, playing at @${inviteRoom.profileSlug}`
                  : inviteRoom.streamId
                    ? ", on a live stream"
                    : ""}
                . Join your party?
              </p>
              <button
                type="button"
                data-testid="world-party-summons-go"
                onClick={goToInvitedTable}
                className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-1.5 text-sm font-bold text-black transition hover:scale-105"
              >
                Take me to the table
              </button>
            </>
          ) : (
            <>
              <p className={`flex-1 text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
                That party table has closed — but the Game Rooms are open, and the
                Marble Table keeps the code filled in if it reopens.
              </p>
              <button
                type="button"
                data-testid="world-party-summons-go"
                onClick={goToInvitedTable}
                className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-1.5 text-sm font-bold text-black transition hover:scale-105"
              >
                Go to the Game Rooms
              </button>
            </>
          )}
          <button
            type="button"
            aria-label="Dismiss the summons"
            onClick={() => setInviteDismissed(true)}
            className={`rounded-full border px-2 py-1 text-xs font-bold ${
              isLight
                ? "border-[#7A5A12]/30 text-[#6B5B36]"
                : "border-white/15 text-white/70"
            }`}
          >
            Not now
          </button>
        </div>
      )}

      {/* The Creator Rooms note (3.5): a deep entry or an arch pick
          named a room that isn't open — said plainly, once, with
          the way to a room that is. */}
      {creatorNote && status === "inside" && (
        <div
          className={`relative z-20 flex flex-wrap items-center gap-3 border-b px-4 py-2.5 ${
            isLight
              ? "border-[#C9A84C]/60 bg-[#f6ead0]"
              : "border-[#d4af37]/40 bg-[#171106]"
          }`}
          data-testid="world-creator-note"
        >
          <DoorOpen className="h-5 w-5 shrink-0 text-[#d4af37]" />
          <p className={`flex-1 text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
            {creatorNote}
          </p>
          <button
            type="button"
            onClick={() => setCreatorNote(null)}
            className={`rounded-full border px-2 py-1 text-xs font-bold ${
              isLight
                ? "border-[#7A5A12]/30 text-[#6B5B36]"
                : "border-white/15 text-white/70"
            }`}
          >
            Got it
          </button>
        </div>
      )}

      {/* ── The room ── */}
      <div ref={roomRef} className={`relative flex-1 ${isLight ? "bg-[#e9dcbc]" : "bg-black"}`} style={{ minHeight: "62vh" }}>
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full touch-none" data-testid="world-canvas" />

        {overlay === "connecting" && !bootFailed && (
          <div className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center ${isLight ? "bg-[#f7ecd2]/85" : "bg-black/70"}`}>
            <Loader2 className="h-8 w-8 animate-spin text-[#d4af37]" />
            <p className={`text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>Entering the King's Plaza…</p>
          </div>
        )}
        {reconnecting && overlay === null && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2">
            <p className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-bold shadow-lg ${isLight ? "border-[#C9A84C]/60 bg-[#FCF7EA]/95 text-[#6B5B36]" : "border-[#d4af37]/40 bg-black/85 text-[#e8c86a]"}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Connection dropped — walking you back in…
            </p>
          </div>
        )}
        {bootFailed && (
          <div className={`absolute inset-0 z-10 flex items-center justify-center px-4 ${isLight ? "bg-[#f7ecd2]/85" : "bg-black/80"}`}>
            <div className={`max-w-sm rounded-2xl border p-6 text-center ${isLight ? "border-[#C9A84C]/60 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-[#d4af37]/40 bg-[#0a0908]"}`}>
              <AlertTriangle className="mx-auto h-8 w-8 text-[#d4af37]" />
              <h2 className="mt-3 text-lg font-black">The hall couldn't start on this device</h2>
              <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>The 3D hall needs WebGL2, and this browser didn't hand it over — the hall itself is fine, and so is your connection. A current browser, or hardware acceleration switched on, usually settles it.</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black transition hover:scale-105">
                <RotateCcw className="h-4 w-4" /> Try again
              </button>
            </div>
          </div>
        )}
        {overlay === "room-full" && (
          <div className={`absolute inset-0 z-10 flex items-center justify-center px-4 ${isLight ? "bg-[#f7ecd2]/85" : "bg-black/80"}`}>
            <div className={`max-w-sm rounded-2xl border p-6 text-center ${isLight ? "border-[#C9A84C]/60 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-[#d4af37]/40 bg-[#0a0908]"}`}>
              <Users className="mx-auto h-8 w-8 text-[#d4af37]" />
              <h2 className="mt-3 text-lg font-black">The palace is full</h2>
              <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                Everyone the palace can hold is inside right now. Give it a moment and try the door again.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <button type="button" onClick={() => setAttempt((n) => n + 1)} className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black transition hover:scale-105">
                  <RotateCcw className="h-4 w-4" /> Try again
                </button>
                <Link href="/go-live" className={`rounded-full border px-5 py-2 text-sm font-bold transition ${isLight ? "border-[#7A5A12]/30 text-[#7A5A12] hover:text-[#2a1e07]" : "border-white/15 text-white/80 hover:text-white"}`}>
                  Back to Go Live
                </Link>
              </div>
            </div>
          </div>
        )}
        {overlay === "error" && (
          <div className={`absolute inset-0 z-10 flex items-center justify-center px-4 ${isLight ? "bg-[#f7ecd2]/85" : "bg-black/80"}`}>
            <div className={`max-w-sm rounded-2xl border p-6 text-center ${isLight ? "border-[#C9A84C]/60 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-[#d4af37]/40 bg-[#0a0908]"}`}>
              <AlertTriangle className="mx-auto h-8 w-8 text-[#d4af37]" />
              <h2 className="mt-3 text-lg font-black">The hall wouldn't open</h2>
              <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>The connection dropped or never landed. Your place in line isn't saved — just walk back in.</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black transition hover:scale-105">
                <RotateCcw className="h-4 w-4" /> Re-enter the hall
              </button>
            </div>
          </div>
        )}

        {overlay === "removed" && (
          <div className={`absolute inset-0 z-10 flex items-center justify-center px-4 ${isLight ? "bg-[#f7ecd2]/85" : "bg-black/80"}`}>
            <div className={`max-w-sm rounded-2xl border p-6 text-center ${isLight ? "border-[#C9A84C]/60 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-[#d4af37]/40 bg-[#0a0908]"}`}>
              <Shield className="mx-auto h-8 w-8 text-[#d4af37]" />
              <h2 className="mt-3 text-lg font-black">Removed from the hall</h2>
              <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                The host removed you from the hall. The rest of the site is still yours — the shows, your page, your people.
              </p>
              <Link href="/go-live" className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black transition hover:scale-105">
                Back to Go Live
              </Link>
            </div>
          </div>
        )}

        {overlay === "replaced" && (
          <div className={`absolute inset-0 z-10 flex items-center justify-center px-4 ${isLight ? "bg-[#f7ecd2]/85" : "bg-black/80"}`}>
            <div className={`max-w-sm rounded-2xl border p-6 text-center ${isLight ? "border-[#C9A84C]/60 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-[#d4af37]/40 bg-[#0a0908]"}`}>
              <Users className="mx-auto h-8 w-8 text-[#d4af37]" />
              <h2 className="mt-3 text-lg font-black">You're in the World in another tab</h2>
              <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                This copy stepped aside — one person, one presence, so the headcount never lies. Want this tab instead? Walk back in here and the other copy will step aside.
              </p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black transition hover:scale-105">
                <RotateCcw className="h-4 w-4" /> Re-enter here
              </button>
            </div>
          </div>
        )}

        {/* Say log */}
        {status === "inside" && sayLog.length > 0 && (
          <div className="pointer-events-none absolute bottom-24 left-3 z-10 max-w-xs space-y-1 sm:bottom-20">
            {sayLog.map((ev, i) => (
              <p key={`${ev.peerId}-${i}`} className="rounded-lg bg-black/55 px-2.5 py-1 text-xs text-white/85 backdrop-blur-sm">
                <span className="font-bold text-[#e8c86a]">{ev.displayName}</span>{" "}
                <span className="text-white/70">
                  <KingTokenText body={ev.body} />
                </span>
              </p>
            ))}
          </div>
        )}

        {/* The stage plate, over the room by the big screen: who is
            on stage, in words, the moment a show is on. The stage
            is the hall's — the plate shows only there. */}
        {status === "inside" && inHall && stageScreen?.holder && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2" data-testid="world-stage-plate">
            {stageScreen.mode === "live" ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-red-500/50 bg-black/70 px-4 py-1.5 text-sm font-black tracking-wide text-red-300 backdrop-blur-sm">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                LIVE — {stageScreen.holder.name}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full border border-[#d4af37]/50 bg-black/70 px-4 py-1.5 text-sm font-bold text-[#e8c86a] backdrop-blur-sm">
                {stageScreen.mode === "video"
                  ? `Now showing: ${stageScreen.title ?? "Watch party"} · ${stageScreen.holder.name}'s pick`
                  : `On stage: ${stageScreen.holder.name}`}
              </span>
            )}
          </div>
        )}

        {/* The witnessed-moment banner (§5(a)): a win just landed
            in this room — a quest completed, a level rose — stated
            once, in the palace's voice, then gone. Wins are public;
            the line carries no balance and no progress detail. */}
        {status === "inside" && momentLine && (
          <div
            className="pointer-events-none absolute left-1/2 top-16 z-10 -translate-x-1/2"
            data-testid="world-moment-banner"
            role="status"
          >
            <span className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-black tracking-wide backdrop-blur-sm ${isLight ? "border-[#C9A84C]/70 bg-[#FCF7EA]/90 text-[#7A5A12]" : "border-[#d4af37]/60 bg-black/75 text-[#e8c86a]"}`}>
              {momentLine}
            </span>
          </div>
        )}

        {/* Controls hint */}
        {status === "inside" && (
          <p className="pointer-events-none absolute right-3 top-3 z-10 hidden rounded-full bg-black/50 px-3 py-1 text-[11px] text-white/55 backdrop-blur-sm md:block">
            WASD to walk · drag or click to look · Shift to hurry
          </p>
        )}

        {/* The walk-up prompt: the door you're standing at. The gold
            marker in the scene and this prompt read the same
            registry, so they can never disagree about where a door
            stands. E (or a controller's LB) opens it too; the
            panel's own close is the way
            back to the room. */}
        {status === "inside" && nearStation && !panelTarget && (
          <div
            className="absolute bottom-24 left-1/2 z-10 w-[min(92vw,440px)] -translate-x-1/2 sm:bottom-20"
            data-testid="world-station-prompt"
          >
            <div
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-sm ${
                isLight ? "border-[#C9A84C]/70 bg-[#FCF7EA]/95" : "border-[#d4af37]/50 bg-black/80"
              }`}
            >
              <DoorOpen className="h-5 w-5 shrink-0 text-[#d4af37]" />
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  {nearStation.name}
                </p>
                <p className={`truncate text-xs ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                  {nearStation.tagline}
                </p>
              </div>
              <button
                type="button"
                data-testid="world-station-open"
                onClick={() => setPanelTarget({ kind: "station", station: nearStation })}
                className="shrink-0 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105"
              >
                Open
              </button>
              <kbd
                className={`hidden shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-black md:block ${
                  isLight ? "border-[#7A5A12]/40 text-[#7A5A12]" : "border-white/25 text-white/60"
                }`}
              >
                E
              </kbd>
              {padConnected && (
                <kbd
                  className={`hidden shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-black md:block ${
                    isLight ? "border-[#7A5A12]/40 text-[#7A5A12]" : "border-white/25 text-white/60"
                  }`}
                >
                  LB
                </kbd>
              )}
            </div>
          </div>
        )}

        {/* The Music Hall, muted by the browser: autoplay is the
            browser's call — when it says no, the room says so and
            one tap lets it be heard. Never silent pretending. */}
        {status === "inside" && roomId === MUSIC_HALL_ID && jukebox?.current && !jukeboxAudible && (
          <button
            type="button"
            data-testid="world-jukebox-hear"
            onClick={() => {
              void jukeboxAudioRef.current
                ?.play()
                .then(() => setJukeboxAudible(true))
                .catch(() => undefined);
            }}
            className="absolute bottom-24 right-3 z-10 inline-flex items-center gap-2 rounded-full border border-[#d4af37]/60 bg-black/75 px-4 py-2 text-sm font-bold text-[#e8c86a] backdrop-blur-sm transition hover:bg-black/90 sm:bottom-20"
          >
            <Music2 className="h-4 w-4" /> Tap to hear the Music Hall
          </button>
        )}
      </div>

      {/* In-hall character panel — the same picker as the door,
          opened from inside (the pick rides the same verified
          presence frame; the figure swaps when the room confirms). */}
      {charPanelOpen && user && status === "inside" && (
        <div className={`relative z-20 border-t ${isLight ? "border-[#C9A84C]/50" : "border-[#d4af37]/25"}`}>
          <WalkInAsPicker
            characters={vaultChars}
            loadFailed={vaultLoadFailed}
            selectedId={walkInAs}
            onSelect={setWalkInAs}
            isLight={isLight}
            onRename={handleRenameVaultCharacter}
            onRemove={handleRemoveVaultCharacter}
          />
        </div>
      )}

      {/* The Screen remote — the stage holder's hand on the big
          screen (the host's too, at any moment). One panel, in the
          hall: take the stage live, play a video for everyone,
          park it on the Reel, or end the show. The stage lives in
          the hall, so the panel does too. */}
      {screenPanelOpen && inHall && !isGuest && status === "inside" && (
        <div
          className={`relative z-20 max-h-[46vh] overflow-y-auto border-t px-4 py-3 ${isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9]" : "border-[#d4af37]/25 bg-[#070605]"}`}
          data-testid="world-screen-panel"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-2 text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              <Tv className="h-4 w-4 text-[#d4af37]" /> The Screen
            </span>
            <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              {stageScreen?.mode === "live" && stageHolder
                ? `LIVE — ${stageHolder.name} is on stage`
                : stageScreen?.mode === "video" && stageHolder
                  ? `Watch party — ${stageScreen.title ?? "a video"}, picked by ${stageHolder.name} (${stageVideoPlaying ? "playing" : "paused"})`
                  : stageHolder
                    ? `${stageHolder.name} holds the stage — the screen is on the King's Reel`
                    : "The King's Reel is playing — the stage is free"}
            </span>
            {isAdmin && stageHolder && !iHoldStage && (
              <span className="rounded-full border border-[#d4af37]/50 bg-[#d4af37]/10 px-2.5 py-0.5 text-[11px] font-bold text-[#e8c86a]">
                You&rsquo;re the host — the screen answers to you too
              </span>
            )}
          </div>

          {screenNote && (
            <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{screenNote}</p>
          )}

          {stageHolder && !canDriveScreen ? (
            <p className={`mt-2 max-w-xl text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
              One hand on the screen at a time — {stageHolder.name} is driving it. When the show ends, the stage opens up and anyone signed in can take it.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {myStream ? (
                  stageScreen?.mode === "live" && stageScreen.streamId === myStream.id ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-300">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Your stream is on the screen
                    </span>
                  ) : (
                    <button
                      type="button"
                      data-testid="world-stage-live"
                      onClick={() => clientRef.current?.takeStageLive(myStream.id)}
                      className="inline-flex items-center gap-2 rounded-full bg-red-500 px-4 py-2 text-sm font-bold text-white transition hover:scale-105"
                    >
                      <span className="h-2 w-2 rounded-full bg-white" /> Take the stage — put my stream on the screen
                    </button>
                  )
                ) : (
                  <span className={`inline-flex flex-wrap items-center gap-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                    To perform live, start your stream first — in the Live studio right below, without leaving the hall — then take the stage.
                  </span>
                )}
                {stageScreen?.mode === "video" && (
                  <button
                    type="button"
                    data-testid="world-screen-playpause"
                    onClick={() =>
                      clientRef.current?.screenPlayPause(
                        !stageVideoPlaying,
                        sceneRef.current?.screenPositionSec() ?? stageScreen.playback?.positionSec ?? 0,
                      )
                    }
                    className={panelBtnCls(false)}
                  >
                    {stageVideoPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    {stageVideoPlaying ? "Pause for everyone" : "Play for everyone"}
                  </button>
                )}
                {stageScreen?.mode !== "reel" && stageHolder && (
                  <button type="button" onClick={() => clientRef.current?.screenReel()} className={panelBtnCls(false)}>
                    King&rsquo;s Reel
                  </button>
                )}
                {stageHolder && (
                  <button
                    type="button"
                    data-testid="world-stage-end"
                    onClick={() => clientRef.current?.endStage()}
                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${isLight ? "border-red-800/30 text-red-900/80 hover:text-red-900" : "border-red-400/40 text-red-300 hover:text-red-200"}`}
                  >
                    {iHoldStage ? "End my show" : "End the show"}
                  </button>
                )}
              </div>

              <div>
                <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                  Play a video — a watch party for the whole hall
                </p>
                {catalog === null ? (
                  <p className={`mt-1.5 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>Loading the catalog…</p>
                ) : catalog.mine.length + catalog.public.length === 0 ? (
                  <p className={`mt-1.5 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                    Nothing playable yet — publish a video on your profile or finish a stream with a replay, and it can play here.
                  </p>
                ) : (
                  <div className="mt-1.5 space-y-2">
                    {(
                      [
                        ["Yours", catalog.mine],
                        ["From the hall", catalog.public],
                      ] as const
                    ).map(([label, items]) =>
                      items.length === 0 ? null : (
                        <div key={label}>
                          <p className={`text-[11px] font-bold ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>{label}</p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {items.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                data-testid="world-screen-video"
                                onClick={() => clientRef.current?.playStageVideo(item.id)}
                                className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}
                              >
                                <Play className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
                                <span className="truncate">{item.title}</span>
                                {item.creatorName ? <span className="opacity-60">· {item.creatorName}</span> : null}
                              </button>
                            ))}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}
                <p className={`mt-1.5 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                  Everyone&rsquo;s screen switches together, and play/pause is shared — the room keeps you roughly in step.
                </p>
              </div>
            </div>
          )}

          {/* Live Wave I (stack-100 #85–#87): the Go Live studio,
              its guests & backstage, and the guest door — in-world,
              on the 2D studio's own rails. This panel is members-only
              (!isGuest above), so palace guests never reach these
              desks and gain no voice from them. */}
          <div className={`mt-4 space-y-5 border-t pt-4 ${isLight ? "border-[#C9A84C]/40" : "border-[#d4af37]/20"}`} data-testid="world-live-desks">
            <LiveStudioDesk isLight={isLight} onStreamChange={() => void loadStageTools()} />
            <LiveBackstageDesk isLight={isLight} />
            <LiveGuestJoinDesk isLight={isLight} />
          </div>
        </div>
      )}

      {/* Host controls — the King's own panel. Admins only (the
          server resolved it at the door and re-checks every action):
          the screen and stage above, plus voice and the door here. */}
      {hostPanelOpen && isAdmin && status === "inside" && (
        <div
          className={`relative z-20 max-h-[40vh] overflow-y-auto border-t px-4 py-3 ${isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9]" : "border-[#d4af37]/25 bg-[#070605]"}`}
          data-testid="world-host-panel"
        >
          <p className={`inline-flex items-center gap-2 text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            <Shield className="h-4 w-4 text-[#d4af37]" /> Host controls
            <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              — voice and the door for the room you&rsquo;re in; the screen and stage answer to you in the hall&rsquo;s Screen panel
            </span>
          </p>
          <div className="mt-2 space-y-1.5">
            {roster.map((p) => (
              <div
                key={p.peerId}
                className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
              >
                <span className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{p.displayName}</span>
                {p.peerId === myPeerId && <span className={`text-[11px] font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>you</span>}
                {p.admin && <span className="rounded-full bg-[#d4af37]/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#e8c86a]">Host</span>}
                {p.guest && <span className={`text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>guest</span>}
                {p.voice && <span className={`text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>in voice</span>}
                {p.voiceOff && <span className="text-[11px] font-semibold text-[#e08a6d]">voice off</span>}
                {p.voiceDeaf && <span className={`text-[11px] font-semibold ${isLight ? "text-[#476b8a]" : "text-[#a9c3d9]"}`}>deafened</span>}
                {p.hostMuted && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-red-300">Muted by host</span>}
                {p.peerId !== myPeerId && (
                  <span className="ml-auto inline-flex gap-1.5">
                    {!p.guest && (
                      <button
                        type="button"
                        data-testid="world-host-mute"
                        onClick={() => clientRef.current?.adminMute(p.peerId, !p.hostMuted)}
                        className={`rounded-full border px-3 py-1 text-xs font-bold transition ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}
                      >
                        {p.hostMuted ? "Unmute voice" : "Mute voice"}
                      </button>
                    )}
                    {!p.guest && (
                      <button
                        type="button"
                        data-testid="world-host-lock-person"
                        disabled={lockBusy}
                        onClick={() => {
                          if (lockArm === p.peerId) {
                            setLockArm(null);
                            void runPersonLock(p);
                          } else {
                            setLockArm(p.peerId);
                          }
                        }}
                        className={`rounded-full border px-3 py-1 text-xs font-bold transition disabled:opacity-40 ${
                          lockArm === p.peerId
                            ? "border-red-500 bg-red-500 text-white"
                            : isLight
                              ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                              : "border-white/15 text-white/75 hover:text-white"
                        }`}
                      >
                        {lockArm === p.peerId ? "Tap again to lock out 1h" : "Lock out"}
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="world-host-remove"
                      onClick={() => {
                        if (removeArm === p.peerId) {
                          clientRef.current?.adminRemove(p.peerId);
                          setRemoveArm(null);
                        } else {
                          setRemoveArm(p.peerId);
                        }
                      }}
                      className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
                        removeArm === p.peerId
                          ? "border-red-500 bg-red-500 text-white"
                          : isLight
                            ? "border-red-800/30 text-red-900/80 hover:text-red-900"
                            : "border-red-400/40 text-red-300 hover:text-red-200"
                      }`}
                    >
                      {removeArm === p.peerId ? "Tap again to remove" : "Remove"}
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
          {/* The herald (Ring 3 §5(b)): the host speaks to EVERY
              room at once. The registry verifies the host server-
              side and rate-limits heralds; a refusal lands back
              here as a note instead of silence. */}
          <form
            className="mt-3"
            data-testid="world-herald-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (clientRef.current?.herald(heraldDraft)) {
                setHeraldDraft("");
                setHeraldNote("The palace heard you.");
              }
            }}
          >
            <label
              htmlFor="world-herald-input"
              className={`inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}
            >
              <Megaphone className="h-4 w-4 text-[#d4af37]" /> Herald the palace
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <input
                id="world-herald-input"
                data-testid="world-herald-input"
                value={heraldDraft}
                onChange={(e) => setHeraldDraft(e.target.value)}
                maxLength={140}
                placeholder="Speak to every room at once…"
                className={`min-w-[220px] flex-1 rounded-full border px-4 py-2 text-sm font-semibold outline-none ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60" : "border-white/15 bg-white/5 text-white placeholder:text-white/35"}`}
              />
              <button
                type="submit"
                data-testid="world-herald-send"
                disabled={!cleanHeraldText(heraldDraft)}
                className="rounded-full border border-[#d4af37] bg-[#d4af37]/15 px-4 py-2 text-sm font-black text-[#e8c86a] transition hover:bg-[#d4af37]/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Herald
              </button>
            </div>
            {heraldNote && (
              <p className={`mt-1.5 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`} data-testid="world-herald-note">
                {heraldNote}
              </p>
            )}
          </form>

          {/* The World's locks (items 92–93): the door verb for the
              room the admin stands in, and this room's standing
              person locks with their lift buttons. Admin-only —
              this whole panel stands behind isAdmin, the handlers
              re-check the gate, and the server rejects non-admin
              calls regardless. Results land immediately: a door
              verb carries the fresh directory back (the Locked
              pill moves in the same moment) and the standing list
              is re-read after every verb. */}
          {canUseWorldLockVerbs({ admin: isAdmin, guest: isGuest }) && (
            <div className="mt-3" data-testid="world-host-locks">
              <p
                className={`inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}
              >
                <Lock className="h-4 w-4 text-[#d4af37]" /> The door &amp; the locks
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {(() => {
                  const entry = directory.find((r) => r.id === roomId);
                  const verb = entry ? doorLockVerb(entry) : "lock";
                  return (
                    <button
                      type="button"
                      data-testid="world-host-door-lock"
                      disabled={lockBusy || !entry}
                      onClick={() => void runDoorLockVerb()}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-40 ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-[#d4af37]/40 text-[#e8c86a] hover:bg-[#d4af37]/10"}`}
                    >
                      {verb === "unlock" ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                      {verb === "unlock" ? "Unlock this room's door" : "Lock this room's door"}
                    </button>
                  );
                })()}
                <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                  {directory.find((r) => r.id === roomId)?.locked
                    ? "This door is locked — people inside stay, nobody new joins."
                    : "This door is open."}
                </span>
              </div>
              {worldLocks && worldLocks.persons.filter((l) => l.roomId === roomId).length > 0 && (
                <div className="mt-2 space-y-1.5" data-testid="world-host-person-locks">
                  {worldLocks.persons
                    .filter((l) => l.roomId === roomId)
                    .map((l) => (
                      <div
                        key={`${l.roomId}:${l.userId}`}
                        className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
                      >
                        <span className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                          {l.displayName}
                        </span>
                        <span className={`text-[11px] font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                          locked out until {new Date(l.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </span>
                        <button
                          type="button"
                          data-testid="world-host-unlock-person"
                          disabled={lockBusy}
                          onClick={() => void runPersonUnlock(l)}
                          className={`ml-auto rounded-full border px-3 py-1 text-xs font-bold transition disabled:opacity-40 ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}
                        >
                          Lift lock
                        </button>
                      </div>
                    ))}
                </div>
              )}
              {lockNote && (
                <p className={`mt-1.5 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-host-lock-note">
                  {lockNote}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* The doors, opened: a station's panel (or the page a Court
          portrait pointed at). The step-through kind renders itself
          full-screen from inside this same mount. */}
      {panelTarget && status === "inside" && (
        <StationPanel
          target={panelTarget}
          isLight={isLight}
          isGuest={isGuest}
          onClose={() => {
            setPanelTarget(null);
            /* A station visit is where tutorial steps land (the
               drop claim, the quest claim) — re-read the line. */
            void refreshTutorial();
          }}
          directory={directory}
          currentRoomId={roomId}
          kingLine={kingStripLine(kingMoment, Date.now(), isGuest)}
          jukebox={jukebox}
          jukeboxDenied={jukeboxDenied}
          myPeerId={myPeerId}
          isAdmin={isAdmin}
          editorProjectId={editorProjectId}
          partyInvite={
            partyInviteCode
              ? { code: partyInviteCode, room: inviteRoom }
              : null
          }
          onJoinPartyTable={joinDirectoryTable}
          onOpenEditorStation={() => {
            const editorStation = STATION_BY_ID.get("visual-vibes-editor");
            if (editorStation) setPanelTarget({ kind: "station", station: editorStation });
          }}
          onOpenStation={(stationId) => {
            const station = STATION_BY_ID.get(stationId);
            if (station) setPanelTarget({ kind: "station", station });
          }}
          onEnterRoom={(roomId) => {
            /* The Palace Calendar's walk (3.9): a creator room is
               entered through its doorway transfer (the read that
               proves the room is open); a palace room is a plain
               transfer — the panel closes as the walker leaves. */
            const slug = creatorSlugFromRoomId(roomId);
            if (slug) {
              void enterCreatorRoomRef.current(slug);
              return;
            }
            setPanelTarget(null);
            clientRef.current?.enterRoom(roomId);
          }}
          mySlug={mySlug}
          onEnterCreatorRoom={(slug) => {
            void enterCreatorRoomRef.current(slug);
          }}
          onRoomDressingChanged={refreshCreatorRoomDressing}
          onJukeboxAdd={(trackId) => clientRef.current?.jukeboxAdd(trackId)}
          onJukeboxPlayPause={(playing) => clientRef.current?.jukeboxPlayPause(playing)}
          onJukeboxSkip={() => clientRef.current?.jukeboxSkip()}
          onJukeboxRemove={(entryId) => clientRef.current?.jukeboxRemove(entryId)}
        />
      )}

      {/* ── Bottom bar: say + voice + VR ── */}
      {/* pr-24: the site shell's floating button parks at the
          viewport's bottom-right, over this footer's corner — the
          reserved strip keeps the right-aligned controls (and the
          trailing headset status line) from ever running under it
          and truncating mid-word (owner's screenshot, 2026-10-16). */}
      <footer className={`relative z-20 border-t py-3 pl-4 pr-24 ${isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9]" : "border-[#d4af37]/25 bg-[#070605]"}`}>
        {isGuest && status === "inside" ? (
          <p className={`mb-2 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            You're visiting as a <span className={`font-bold ${isLight ? "text-[#2a1e07]" : "text-white/75"}`}>guest</span> — look around all you like.{" "}
            <Link href={GUEST_SIGN_IN_HREF} className={`font-bold underline underline-offset-2 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Sign in</Link>{" "}
            to walk in with your name, talk, and be heard.
          </p>
        ) : null}
        {padConnected && status === "inside" && (
          <p className={`mb-2 inline-flex items-center gap-2 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`} data-testid="world-pad-line">
            <Gamepad2 className="h-4 w-4 text-[#d4af37]" />
            Controller connected — left stick walks, right stick looks, trigger hurries, {!isGuest && "A steps voice (off · proximity · lobby · deafen), "}Y switches view, LB opens the door you&rsquo;re standing at, D-pad and face buttons perform the actions below.
          </p>
        )}
        {/* The action bar: what your figure can DO, seen by the
            whole room. One-shots play out and settle; Dance and Sit
            hold until pressed again — or until you walk off. */}
        {status === "inside" && !isGuest && (
          <div
            className="mb-2 flex flex-wrap items-center gap-1.5"
            data-testid="world-action-bar"
            role="group"
            aria-label="Avatar actions — everyone in the room sees these"
          >
            {WORLD_ACTIONS.map((def) => (
              <ActionButton
                key={def.id}
                def={def}
                active={myAction === def.id}
                isLight={isLight}
                onPerform={performAction}
              />
            ))}
            {myAction && ACTION_BY_ID.get(myAction)?.kind === "toggle" && (
              <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                {ACTION_BY_ID.get(myAction)?.label} is on — tap it again, or just walk, to stop.
              </span>
            )}
          </div>
        )}
        {/* Guests get no action bar (access law, owner default 3):
            emotes are a member act, so in its place stands the
            honest pitch — never buttons that silently do nothing. */}
        {status === "inside" && isGuest && (
          <p
            className={`mb-2 inline-flex flex-wrap items-center gap-2 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}
            data-testid="world-guest-action-pitch"
          >
            {GUEST_EMOTE_PITCH}
            <Link href={GUEST_SIGN_IN_HREF} className={`font-bold underline underline-offset-2 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Sign in</Link>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {/* The say box's guest state: no composer, no dead input —
              the pitch stands where the composer would, with the
              sign-in action that brings you back here a member. */}
          {isGuest && status === "inside" && (
            <p
              className={`inline-flex min-w-[220px] flex-1 flex-wrap items-center gap-2 text-sm font-semibold sm:max-w-md ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}
              data-testid="world-guest-say-pitch"
            >
              {GUEST_SPEAK_PITCH}
              <Link href={GUEST_SIGN_IN_HREF} className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-1 text-xs font-bold text-black transition hover:scale-105">
                Sign in to speak
              </Link>
            </p>
          )}
          {!isGuest && status === "inside" && (
            <form
              className="flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-md"
              onSubmit={(e) => {
                e.preventDefault();
                sendSay();
              }}
            >
              <EmojiTray
                tone={isLight ? "light" : "dark"}
                onPickToken={insertSayToken}
                buttonClassName={`rounded-full border p-2 transition hover:scale-105 ${isLight ? "border-[#7A5A12]/30 bg-white/60" : "border-white/12 bg-black/50"}`}
              />
              <input
                ref={sayInputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={300}
                placeholder={myName ? `Say something, ${myName.split(" ")[0]}…` : "Say something…"}
                className={`min-w-0 flex-1 rounded-full border px-4 py-2 text-sm outline-none ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/70 focus:border-[#7A5A12]" : "border-white/12 bg-black/50 text-white placeholder:text-white/30 focus:border-[#d4af37]/60"}`}
                data-testid="world-say-input"
              />
              <button type="submit" className="rounded-full bg-[#d4af37] p-2.5 text-black transition hover:scale-105" aria-label="Send to the room">
                <Send className="h-4 w-4" />
              </button>
            </form>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {voiceNote && <span className={`max-w-xs text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{voiceNote}</span>}
            {status === "inside" && (
              <button
                type="button"
                onClick={() => setQualityPref((q) => nextQualityPreference(q))}
                data-testid="world-quality-control"
                aria-label="Graphics quality"
                title="Graphics quality — Auto adapts to your device"
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}
              >
                <Gauge className="h-4 w-4" />
                Quality: {qualityPreferenceLabel(qualityPref)}
              </button>
            )}
            {status === "inside" && (
              <button
                type="button"
                onClick={toggleViewMode}
                data-testid="world-view-toggle"
                aria-pressed={viewMode === "third"}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}
              >
                <Eye className="h-4 w-4" />
                {viewMode === "third" ? "Third person" : "First person"}
              </button>
            )}
            {!isGuest && user && status === "inside" && (
              <button
                type="button"
                onClick={() => setCharPanelOpen((o) => !o)}
                data-testid="world-change-character"
                aria-expanded={charPanelOpen}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${charPanelOpen ? "border-[#d4af37] bg-[#d4af37]/15 text-[#e8c86a]" : isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}
              >
                <Sparkles className="h-4 w-4" />
                Change character
              </button>
            )}
            {!isGuest && inHall && status === "inside" && (
              <button
                type="button"
                onClick={() => setScreenPanelOpen((o) => !o)}
                data-testid="world-screen-button"
                aria-expanded={screenPanelOpen}
                className={panelBtnCls(screenPanelOpen)}
              >
                <Tv className="h-4 w-4" />
                Screen
                {stageHolder ? <span className="opacity-70">· {iHoldStage ? "your stage" : stageHolder.name}</span> : null}
              </button>
            )}
            {isAdmin && status === "inside" && (
              <button
                type="button"
                onClick={() => setHostPanelOpen((o) => !o)}
                data-testid="world-host-button"
                aria-expanded={hostPanelOpen}
                className={panelBtnCls(hostPanelOpen)}
              >
                <Shield className="h-4 w-4" />
                Host controls
              </button>
            )}
            {!isGuest && status === "inside" && (
              <>
                {/* The voice modes — Off · Proximity · Lobby · Deafen,
                    in words, right here, no menu digging. Off releases
                    the mic and marks your name plate voice-off for the
                    whole hall; Deafen keeps you in voice, mutes your
                    mic, and marks you deafened. Switching modes never
                    joins voice by itself — Join is still its own act. */}
                <span className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                  Voice
                </span>
                <div
                  role="radiogroup"
                  aria-label="Voice mode"
                  data-testid="world-voice-modes"
                  className={`inline-flex items-center gap-1 rounded-full border p-1 ${isLight ? "border-[#7A5A12]/40 bg-black/5" : "border-white/20 bg-white/5"}`}
                >
                  {VOICE_MODES.map((mode) => {
                    const active = voiceSwitch.mode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        data-testid={`world-voice-mode-${mode}`}
                        onClick={() => setVoiceMode(mode)}
                        className={`rounded-full px-3 py-1.5 text-sm font-bold transition ${
                          active
                            ? "bg-[#d4af37] text-black"
                            : isLight
                              ? "text-[#6B5B36] hover:text-[#2a1e07]"
                              : "text-white/60 hover:text-white"
                        }`}
                      >
                        {voiceModeLabels[mode]}
                      </button>
                    );
                  })}
                </div>
                {/* Character voice: your mic, shaped live into the
                    voice of the character you stand as. Default on;
                    off is one tap and remembered — speaking as
                    yourself is always available. The shaping fails
                    open to your raw mic, never to silence. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={charVoiceOn}
                  aria-label="Character voice"
                  onClick={toggleCharVoice}
                  data-testid="world-character-voice-switch"
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
                    charVoiceOn
                      ? "border-[#d4af37] bg-[#d4af37] text-black hover:scale-105"
                      : isLight
                        ? "border-[#7A5A12]/40 bg-black/5 text-[#6B5B36] hover:text-[#2a1e07]"
                        : "border-white/20 bg-white/5 text-white/60 hover:text-white"
                  }`}
                >
                  <AudioWaveform className="h-4 w-4" />
                  Character voice
                </button>
                <span className={`max-w-[240px] text-[11px] leading-tight ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                  {charVoiceOn
                    ? voiceProfile.id === "neutral"
                      ? "This character has no set voice yet — you sound like yourself."
                      : `You sound like ${voiceProfile.label}.`
                    : "Character voice is off — you sound like yourself."}
                </span>
                {voiceSwitch.mode === "off" && (
                  <span className={`max-w-[240px] text-[11px] leading-tight ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                    You can't hear or be heard here — your name plate shows it. Text still works.
                  </span>
                )}
                {voiceSwitch.mode === "deafen" && (
                  <span className={`max-w-[240px] text-[11px] leading-tight ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                    Deafened — you hear nobody, and your mic is muted. Your name plate shows it.
                  </span>
                )}
                {hostMuted && !voiceSwitch.inVoice && (
                  <span className="inline-flex items-center gap-2 rounded-full border border-red-400/40 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-300" data-testid="world-host-muted-badge">
                    <MicOff className="h-4 w-4" /> Muted by the host
                  </span>
                )}
                {voiceSwitch.mode !== "off" && !voiceSwitch.inVoice && !hostMuted && (
                  <button type="button" onClick={joinVoice} disabled={voiceBusy} className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50">
                    {voiceBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                    Join voice
                  </button>
                )}
                {voiceSwitch.inVoice && voiceSwitch.mode === "deafen" && (
                  <>
                    <span className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold ${isLight ? "border-[#476b8a]/40 bg-[#476b8a]/10 text-[#476b8a]" : "border-[#a9c3d9]/40 bg-[#a9c3d9]/10 text-[#a9c3d9]"}`} data-testid="world-deafened-chip">
                      <MicOff className="h-4 w-4" /> Deafened — mic muted
                    </span>
                    <button type="button" onClick={leaveVoice} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}>
                      <PhoneOff className="h-4 w-4" /> Leave voice
                    </button>
                  </>
                )}
                {voiceSwitch.inVoice && voiceSwitch.mode !== "deafen" && (
                  <>
                    <button type="button" onClick={toggleMute} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${muted ? "bg-red-500/20 text-red-200 border border-red-400/40" : isLight ? "bg-black/5 text-[#2a1e07] border border-[#7A5A12]/30" : "bg-white/10 text-white border border-white/15"}`}>
                      {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      {muted ? "Muted" : "Mic live"}
                    </button>
                    <button type="button" onClick={leaveVoice} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}>
                      <PhoneOff className="h-4 w-4" /> Leave voice
                    </button>
                    <span className={`hidden text-[11px] lg:inline ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                      {voiceSwitch.mode === "lobby"
                        ? "Lobby voice — everyone in this room, near or far."
                        : "Voice is by distance — walk up to talk."}
                    </span>
                  </>
                )}
              </>
            )}
            {isGuest && status === "inside" && (
              /* Guest honesty (access lockdown Lane 3, AUDIT §3.4): voice
                 enforcement is already total — guests never see the voice
                 controls above — but nothing explained that voice exists
                 and is members-only. This disabled-looking chip sits in
                 the voice row's place and links to sign-in. */
              <Link
                href="/login?next=/world"
                data-testid="world-guest-voice-chip"
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold opacity-70 transition ${isLight ? "border-[#7A5A12]/40 bg-black/5 text-[#6B5B36]" : "border-white/20 bg-white/5 text-white/60"}`}
              >
                <MicOff className="h-4 w-4" />
                Voice is for members — sign in to talk
              </Link>
            )}
            {xrSupported ? (
              <button type="button" onClick={enterVr} className="inline-flex items-center gap-2 rounded-full border border-[#d4af37]/50 bg-[#d4af37]/10 px-4 py-2 text-sm font-bold text-[#e8c86a] transition hover:bg-[#d4af37]/20">
                <Glasses className="h-4 w-4" /> Enter VR
              </button>
            ) : xrSupported === false ? (
              <span className={`text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                {xrNote ?? "No VR headset detected — you can still walk the room on this screen."}
              </span>
            ) : null}
          </div>
        </div>
      </footer>
    </div>
  );
}
