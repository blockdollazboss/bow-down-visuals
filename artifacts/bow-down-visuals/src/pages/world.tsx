import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Loader2, ArrowLeft, Users, Mic, MicOff, PhoneOff, AlertTriangle,
  RotateCcw, Glasses, Send, Crown, Eye, Sparkles, Tv, Shield, Play, Pause,
  Maximize, Minimize, Gamepad2, AudioWaveform, DoorOpen,
  Accessibility, Hand, PartyPopper, Music2, RefreshCw, Armchair,
} from "lucide-react";
import {
  WORLD_ACTIONS,
  ACTION_BY_ID,
  type WorldActionId,
  type WorldActionDef,
} from "@/lib/world/actions";
import { toggleFullscreen, isFullscreenActive, fullscreenSupported } from "@/lib/world/fullscreen";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  WorldClient,
  worldOverlay,
  defaultWorldSocketUrl,
  fetchWorldDirectory,
  HALL_ROOM_ID,
  type WorldStatus,
  type WorldSayEvent,
  type WorldPeer,
  type WorldScreenState,
  type WorldJukeboxState,
  type PalaceDirectoryEntry,
} from "@/lib/world/world-client";
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
import { MUSIC_HALL_ID } from "@/lib/world/palace-layout";
import StationPanel, { type StationPanelTarget } from "@/components/world/StationPanel";
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
  type VaultCharacter,
} from "@/lib/world/characters";
import WalkInAsPicker from "@/components/world/WalkInAsPicker";
import { SwitchToWebsite } from "@/components/world/SwitchToWebsite";

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
  usePageTitle("The World — The King's Hall", "Step into the King's Hall: one shared hall with a stage, a big screen, and your people in it.");
  const { user, getAccessToken } = useAuth();

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
  const [roomId, setRoomId] = useState<string>(HALL_ROOM_ID);
  const [roomName, setRoomName] = useState("The King's Hall");
  const [directory, setDirectory] = useState<PalaceDirectoryEntry[]>([]);
  const inHall = roomId === HALL_ROOM_ID;
  const [isGuest, setIsGuest] = useState(true);
  const [myName, setMyName] = useState("");
  const [screen, setScreen] = useState<ScreenInfo | null>(null);
  const [sayLog, setSayLog] = useState<WorldSayEvent[]>([]);
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
    fetchVaultCharacters(getAccessToken)
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
      void scene.isVrSupported().then((ok) => {
        if (!cancelled) setXrSupported(ok);
      });

      const client = new WorldClient({
        getAccessToken,
        socketUrl: (token) => defaultWorldSocketUrl(window.location, token),
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
          setIsGuest(client.self.guest);
          setMyName(client.self.displayName);
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
        {/* The standing switch (owner addendum, Oct 17): the plain
            way out of the palace to the 2D website — always in the
            chrome, both themes, guests included. Distinct from the
            panels' "Open on the website ↗" footers, which peek at a
            station's page in a new tab without leaving the room. */}
        <SwitchToWebsite isLight={isLight} />
      </header>

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
              <span
                key={r.id}
                data-testid="world-directory-room"
                className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
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
              </span>
            );
          })}
        </div>
      )}

      {/* ── The room ── */}
      <div ref={roomRef} className={`relative flex-1 ${isLight ? "bg-[#e9dcbc]" : "bg-black"}`} style={{ minHeight: "62vh" }}>
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full touch-none" data-testid="world-canvas" />

        {overlay === "connecting" && !bootFailed && (
          <div className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center ${isLight ? "bg-[#f7ecd2]/85" : "bg-black/70"}`}>
            <Loader2 className="h-8 w-8 animate-spin text-[#d4af37]" />
            <p className={`text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>Entering the King's Hall…</p>
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
              <h2 className="mt-3 text-lg font-black">The hall is full</h2>
              <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                30 people are inside right now — that's everyone the hall holds at once. Give it a moment and try the door again.
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
                    To perform live, start your stream first —{" "}
                    <Link href="/go-live" className={`font-bold underline underline-offset-2 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                      open the Go Live studio
                    </Link>{" "}
                    — then come back and take the stage.
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
          onClose={() => setPanelTarget(null)}
          directory={directory}
          currentRoomId={roomId}
          jukebox={jukebox}
          jukeboxDenied={jukeboxDenied}
          myPeerId={myPeerId}
          isAdmin={isAdmin}
          editorProjectId={editorProjectId}
          onOpenEditorStation={() => {
            const editorStation = STATION_BY_ID.get("visual-vibes-editor");
            if (editorStation) setPanelTarget({ kind: "station", station: editorStation });
          }}
          onOpenStation={(stationId) => {
            const station = STATION_BY_ID.get(stationId);
            if (station) setPanelTarget({ kind: "station", station });
          }}
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
            <Link href="/login" className={`font-bold underline underline-offset-2 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Sign in</Link>{" "}
            to walk in with your name, talk, and be heard.
          </p>
        ) : null}
        {padConnected && status === "inside" && (
          <p className={`mb-2 inline-flex items-center gap-2 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`} data-testid="world-pad-line">
            <Gamepad2 className="h-4 w-4 text-[#d4af37]" />
            Controller connected — left stick walks, right stick looks, trigger hurries, A steps voice (off · proximity · lobby · deafen), Y switches view, LB opens the door you&rsquo;re standing at, D-pad and face buttons perform the actions below.
          </p>
        )}
        {/* The action bar: what your figure can DO, seen by the
            whole room. One-shots play out and settle; Dance and Sit
            hold until pressed again — or until you walk off. */}
        {status === "inside" && (
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
        <div className="flex flex-wrap items-center gap-2">
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
