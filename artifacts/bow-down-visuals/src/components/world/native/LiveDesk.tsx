import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Radio, Square, Loader2, Video, VideoOff, KeyRound, RefreshCw, Ban, Copy, Check,
  Eye, Trophy, UserPlus, Trash2, ArrowUpCircle, ArrowDownCircle, UserX, Send,
  LogOut, Link2, ShieldCheck, CalendarPlus, CalendarClock, Clapperboard, Pencil,
  Gamepad2, Users, X, ImagePlus, Camera, Mic, Sparkles,
  ListMusic, Music2, Play, SkipForward, XCircle, CircleDollarSign,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";
import { NativeLoadingState, NativeEmptyState } from "@/components/world/native";
import { pendingRedemptionsFromPayload } from "@/lib/reach-watch";
import { apiJson } from "@/lib/social-api";
import { reachApi, type LoyaltyState, type SavedDestination, type PremiereDto } from "@/lib/reach-api";
import LiveChatPanel from "@/components/live/LiveChatPanel";
import { FollowButton, useFollowStates } from "@/components/discovery/FollowButton";
import PushAlertsToggle from "@/components/live/PushAlertsToggle";
import StreamDeck from "@/components/live/StreamDeck";
import {
  ControllerRemoteClient, controllerSocketUrl,
  type ControllerSocketLike, type ControllerCameraSource, type ChromaUpdate,
} from "@/lib/stream-controller";
import { LayoutTemplate } from "lucide-react";
import {
  SCENE_PRESET_OPTIONS, SCENE_PRESET_APPLY_COMMAND,
  scenePresetApplyArgs,
} from "@/lib/world/live-desk";
import { Wand2 } from "lucide-react";
import {
  createStreamTransport, SITE_DESTINATION, WhipTransport, OwnServerTransport,
  TransportError, type StreamTransport,
} from "@/lib/stream-kit/transport";
import {
  BackgroundChanger, BackgroundChangerError,
  type BackgroundMode, type BackgroundQuality, type BackgroundEngineKind, type EngineStatusDetail,
} from "@/lib/stream-kit/background-changer";
import { BACKDROPS } from "@/lib/stream-kit/backdrops";
import {
  loadGreenScreenFineTune, saveGreenScreenFineTune, GREENSCREEN_FINETUNE_DEFAULTS,
  type GreenScreenFineTune,
} from "@/lib/stream-kit/greenscreen-finetune";
import {
  backdropSelectionSource, greenScreenCueVisible, validateBackdropUpload,
  selectionAfterUpload, BACKDROP_UPLOAD_ACCEPT, DEFAULT_BACKDROP_SELECTION,
  type BackdropSelection,
} from "@/lib/stream-kit/backdrop-selection";
import {
  mintGuestInvite, listGuestInvites, revokeGuestInvite, promoteGuest, demoteGuest,
  removeGuest, hostBackstageHistory, hostBackstagePost,
  readInvite, joinAsGuest, guestSession, guestHeartbeat, guestLeave,
  guestBackstageHistory, guestBackstagePost, GuestApiError, publicOnStageGuests,
  type GuestInviteDto, type GuestSessionDto, type BackstageMessageDto, type InviteInfoDto,
} from "@/lib/go-live/guest-api";
import { BackstageClient, type BackstagePeer } from "@/lib/go-live/backstage-client";
import {
  upfrontRuleLines, requestStatusLabel, type SongRequestDto,
} from "@/lib/song-requests";
import { formatBucs } from "@/lib/visual-bucs";
import {
  LIVE_STATUS_PATH, LIVE_STREAM_PATH, LIVE_STREAM_END_PATH,
  INGEST_KEY_PATH, INGEST_KEY_REVEAL_PATH, INGEST_KEY_REGENERATE_PATH, INGEST_KEY_REVOKE_PATH,
  MY_PROFILE_PATH,
  LOYALTY_WATCH_MENU, LOYALTY_CHAT_MENU, LOYALTY_TIP_MENU, LOYALTY_CUSTOM_COST_MENU,
  INVITE_EXPIRY_OPTIONS, BACKSTAGE_SAY_MAX,
  normalizeLiveStatus, streamTitleReady, ingestKeyShownOnce,
  normalizeGuestRoster, inviteShareUrl, backstageDraftReady,
  extractInviteToken, guestStorageKey, guestNameReady, guestSessionActive,
  type LiveStatusView,
  SCHEDULED_STREAMS_PATH, SCHEDULED_STREAM_PATH,
  normalizeScheduledStreams, scheduleDraftReady, scheduleWhenIso, toLocalInputValue,
  type ScheduledStreamRow,
  CONTROLLER_WS_PATH,
  controllerStatusLine, controllerUnavailableNote,
  WATCH_HEARTBEAT_PATH,
  normalizeWatchStream, watchHeartbeatBody, watchStreamIdFromScreen,
  type WatchStreamView,
  GENERATED_CLIPS_PATH, PREMIERE_PAGE_PATH,
  normalizeFinishedClips, premiereDraftReady, isOwnPremiere,
  type FinishedClipOption,
  SONG_REQUESTS_PATH, SONG_REQUEST_PLAY_NEXT_PATH, SONG_REQUEST_CLOSE_PATH,
  SONG_REQUEST_SKIP_PATH, SONG_REQUEST_RULES_PATH,
  normalizeSongRequestQueuePayload, normalizeSongRequestRulesPayload,
  songRequestSubmitBody, songRequestRulesBody,
  songRequestTipReady, songRequestMinTipReady, songRequestMinTipValue,
  songRequestRequestableSongs,
  type SongRequestQueueView, type SongRequestRulesView,
  BACKGROUND_MODE_OPTIONS, BACKGROUND_QUALITY_OPTIONS,
  fineTuneSlidersForMode, engineKindLabel, engineFallbackNote, engineDownFromStatus,
  backdropTileActive,
  CAMERA_EFFECT_OPTIONS, VOICE_EFFECT_OPTIONS, NOISE_CANCELLATION_OPTIONS,
  NOISE_CANCELLATION_DEFAULT,
  noiseHeldNote, voiceEffectHeldNote, noiseStatusLine, deviceSwitchingAvailable,
  SOURCE_CHROMA_UPDATE_COMMAND, CAMERA_MODE_OPTIONS, CHROMA_SLIDERS,
  chromaSettingsFor, chromaWithSlider, chromaUpdateArgs, isChromaUpdateReady,
  type ChromaSettings,
  liveControllerStrings, liveEngineStrings,
} from "@/lib/world/live-desk";
import type { NoiseCancellationLevel } from "@/lib/stream-kit/voice-isolator";

/* ── i18n key maps (stack100 locale unit 44) ────────────────────────
   The seam's option tables keep their English labels as the page
   mirror (the wave-3 pins hold them); the desk renders the catalog
   words for the walker's language, keyed by the option's own id. */
const BG_MODE_LABEL_KEYS: Record<BackgroundMode, string> = {
  green: "worldLivePromo.bgModeGreen",
  blur: "worldLivePromo.bgModeBlur",
  image: "worldLivePromo.bgModeBackdrop",
  none: "worldLivePromo.bgModeOriginal",
};
const BG_QUALITY_LABEL_KEYS: Record<BackgroundQuality, string> = {
  auto: "worldLivePromo.bgQualityAuto",
  pro: "worldLivePromo.bgQualityPro",
  tasks: "worldLivePromo.bgQualityMediaPipe",
};
const EXPIRY_LABEL_KEYS: Record<number, string> = {
  60: "worldLivePromo.expiry60",
  240: "worldLivePromo.expiry240",
  1440: "worldLivePromo.expiry1440",
  10080: "worldLivePromo.expiry10080",
};
const SLIDER_LABEL_KEYS: Record<keyof GreenScreenFineTune, string> = {
  sensitivity: "worldLivePromo.sliderSensitivityLabel",
  edgeShift: "worldLivePromo.sliderEdgeShiftLabel",
  softness: "worldLivePromo.sliderSoftnessLabel",
  smoothing: "worldLivePromo.sliderSmoothingLabel",
  spill: "worldLivePromo.sliderSpillLabel",
  blur: "worldLivePromo.sliderBlurLabel",
  dim: "worldLivePromo.sliderDimLabel",
};
const SLIDER_HINT_KEYS: Record<keyof GreenScreenFineTune, string> = {
  sensitivity: "worldLivePromo.sliderSensitivityHint",
  edgeShift: "worldLivePromo.sliderEdgeShiftHint",
  softness: "worldLivePromo.sliderSoftnessHint",
  smoothing: "worldLivePromo.sliderSmoothingHint",
  spill: "worldLivePromo.sliderSpillHint",
  blur: "worldLivePromo.sliderBlurHint",
  dim: "worldLivePromo.sliderDimHint",
};

/* ─── Live Wave I (stack-100 #85–#87) ───────────────────────────────
   The Go Live studio, its guests & backstage, and the guest door —
   docked in the hall's Screen panel, on the 2D studio's exact rails:
   - LiveStudioDesk (#85): /api/live-streams/status + the stream-kit
     transport (the site's own pipe — WHIP or own-server chunks) for
     go-live/end, the ingest-key doors, the saved destination keys
     (reachApi) and channel loyalty (reachApi) — BroadcastStudio,
     IngestKeyPanel, DestinationKeysPanel and LoyaltySettingsPanel,
     in-world. The camera feed here is the member's own camera,
     published through the same transport; the 2D studio's scene
     compositing/effects kit is not rebuilt (that's #89's deck).
   - LiveBackstageDesk (#86): GuestPanel's host doors via guest-api
     + the BackstageClient socket.
   - LiveGuestJoinDesk (#87): live-guest.tsx's guest doors via
     guest-api + BackstageClient with the guest token, for a
     signed-in member joining a stream as its guest participant.
   The Screen panel itself is members-only, so palace guests never
   reach these desks — no voice is given to them anywhere here.

   Live Wave II (stack-100 #88–#91) docks below:
   - LiveScheduleDesk (#88): GoLiveMain's Schedule section on its
     /api/discord/streams doors — schedule, cancel, recent history,
     and edit as prefill + replacement-first save (no PATCH exists).
   - LiveControllerDesk (#89): the StreamDeck driven by
     ControllerRemoteClient over the per-account controller relay —
     the phone remote's exact surface, in-world.
     Wave IV (#94) adds the scene preset picker under the deck: the
     stream-kit preset registry, relayed as scene.preset.apply to
     the running studio, whose stage applies it through the
     ScenesPanel's own path and frames it in Preview.
   - LiveWatchDesk (#90): for the stream on the big screen — the
     watch page's LiveChatPanel, its follow rail (FollowButton +
     PushAlertsToggle), on-stage guest chips and presence heartbeat.
     Audience chat, distinct from the backstage chat above.
   - LivePremiereDesk (#91): SchedulePremiereForm's flow via
     reachApi — schedule a premiere from finished clips, see the
     upcoming list, cancel your own.

   Live Wave III (parity wave 6, #92) extends the studio desk:
   - Behind me: the 2D studio's green-screen depth. The desk owns
     a BackgroundChanger exactly like BroadcastStudio — the kit
     acquires the camera, its composited output stream is the feed
     the preview shows and the transport publishes, and the mode /
     quality / backdrop / fine-tune controls below move the live
     picture through the kit's own methods. Fine-tune settings
     ride the kit's device store (bdv-greenscreen-finetune), the
     same store the 2D studio reads and writes. The scene kit's
     per-source chroma key is NOT this — it rides the stage
     compositor, which has no in-world instance; wave IV (#95)
     carries it on the controller desk via the relay instead,
     never a second keyer here.

   Live Wave IV (stack-100 #93) extends the studio desk once more:
   - Camera & voice: the changer follow-ons wave III named —
     camera-effect presets, noise cancellation + voice effects,
     camera + mic switching and the mirror — on the SAME changer
     the Behind-me card owns. Picks made before the camera starts
     are held and ride into the kit's construction config exactly
     like BroadcastStudio's; live picks drive the kit's own
     setCameraEffect / setNoiseCancellation / setVoiceEffect /
     switchCamera / switchMicrophone / setMirror. The isolator's
     live status speaks in the card (onNoiseStatus), and device
     switching reads unavailable with its reason when this browser

   Live Wave IV (#95) extends the controller desk:
   - Per-source chroma key: the Stream Controller desk gains the
     running studio's Preview-scene camera sources with
     SourcesPanel's mode pills, key color and Similarity /
     Smoothness sliders, sent as the protocol's scene.chroma.update
     command and executed by the studio through Stage.updateSource
     — the panel's own write. */

function useToken() {
  const { getAccessToken } = useAuth();
  return useCallback(async () => (await getAccessToken()) ?? "", [getAccessToken]);
}

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

function LiveCard({ isLight, testId, children }: { isLight: boolean; testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className={`rounded-2xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
      {children}
    </div>
  );
}

const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const redBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-red-500 px-3.5 py-1.5 text-xs font-bold text-white transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;
const selectCls = (isLight: boolean) =>
  `rounded-lg border px-2 py-1.5 text-sm focus:border-[#d4af37] focus:outline-none bdv-touch-target ${
    isLight ? "border-[#C9A84C]/40 bg-white/70 text-[#2a1e07]" : "border-white/15 bg-black text-white"
  }`;

function RemoteVideo({ stream, label }: { stream: MediaStream; label: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
      <video ref={ref} autoPlay playsInline className="aspect-video w-full object-cover" data-testid="world-live-remote-video" />
      <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">{label}</span>
    </div>
  );
}

function BackstageChat({
  isLight, messages, draft, setDraft, onSend, sending, testid,
}: {
  isLight: boolean;
  messages: BackstageMessageDto[];
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  testid: string;
}) {
  const { t } = useTranslation();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  return (
    <div>
      <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1" data-testid={`${testid}-list`}>
        {messages.length === 0 ? (
          <p className={`text-sm ${muted}`}>{t("worldLivePromo.backstageEmpty")}</p>
        ) : (
          messages.map((m) => (
            <p key={m.id} className={`text-sm ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
              <span className="font-bold text-[#b8912c]">{m.author_name}</span>
              {m.guest ? <span className={`ml-1 text-[10px] font-black uppercase ${muted}`}>{t("worldLivePromo.backstageGuestBadge")}</span> : null}{" "}
              <span className="break-words">{m.body}</span>
            </p>
          ))
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSend(); }}
          placeholder={t("worldLivePromo.backstagePlaceholder")}
          aria-label={t("worldLivePromo.backstageAria")}
          maxLength={BACKSTAGE_SAY_MAX}
          className={inputCls(isLight)}
          data-testid={`${testid}-input`}
        />
        <button type="button" onClick={onSend} disabled={sending || !backstageDraftReady(draft)} className={goldBtn} data-testid={`${testid}-send`}>
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t("worldLivePromo.backstageSend")}
        </button>
      </div>
    </div>
  );
}

/* ═══ #85 The studio ════════════════════════════════════════════════ */

export function LiveStudioDesk({ isLight, onStreamChange }: { isLight: boolean; onStreamChange?: () => void }) {
  const { t, i18n } = useTranslation();
  const token = useToken();
  const authHeaders = useAuthHeaders();
  const { getAccessToken } = useAuth();
  const [status, setStatus] = useState<LiveStatusView | null>(null);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<"off" | "camera" | "connecting" | "live">("off");
  const [liveId, setLiveId] = useState<string | null>(null);
  const [viewers, setViewers] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [endingLeftover, setEndingLeftover] = useState(false);
  const camRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const transportRef = useRef<StreamTransport | null>(null);

  /* ── #92 Behind me — BroadcastStudio's panel on the same kit ──────
     The desk owns a BackgroundChanger exactly like the 2D studio:
     the kit acquires the camera and its composited output stream
     becomes camRef — the feed the preview shows and goLive
     publishes — so every control below moves the live picture
     through the kit's own methods, never a parallel pipeline.
     Fresh sessions start on Original (raw), like the page. */
  const [bgMode, setBgMode] = useState<BackgroundMode>("none");
  const [bgQuality, setBgQuality] = useState<BackgroundQuality>("auto");
  const [engineKind, setEngineKind] = useState<BackgroundEngineKind>("off");
  const [engineDetail, setEngineDetail] = useState<EngineStatusDetail | null>(null);
  const [engineDown, setEngineDown] = useState(false);
  const [bgNote, setBgNote] = useState<string | null>(null);
  const [fineTune, setFineTuneState] = useState<GreenScreenFineTune>(() => loadGreenScreenFineTune());
  const [backdropSel, setBackdropSel] = useState<BackdropSelection>(DEFAULT_BACKDROP_SELECTION);
  const [customBackdrop, setCustomBackdrop] = useState<{ source: File | string; thumb: string; name: string } | null>(null);
  const changerRef = useRef<BackgroundChanger | null>(null);
  const fineTuneRef = useRef<GreenScreenFineTune>(fineTune);
  const bgModeRef = useRef<BackgroundMode>("none");
  const backdropSelRef = useRef<BackdropSelection>(DEFAULT_BACKDROP_SELECTION);
  const customBackdropRef = useRef<{ source: File | string; thumb: string; name: string } | null>(null);

  /* BroadcastStudio's fine-tune hand, verbatim: ref + state + the
     kit's device store + the running changer, on every move. */
  const applyFineTune = useCallback((patch: Partial<GreenScreenFineTune>) => {
    const next = { ...fineTuneRef.current, ...patch };
    fineTuneRef.current = next;
    setFineTuneState(next);
    saveGreenScreenFineTune(next);
    changerRef.current?.setFineTune(next);
  }, []);

  const resetFineTune = useCallback(() => {
    const next = { ...GREENSCREEN_FINETUNE_DEFAULTS };
    fineTuneRef.current = next;
    saveGreenScreenFineTune(next);
    setFineTuneState(next);
    changerRef.current?.setFineTune(next);
  }, []);

  const chooseBackdrop = useCallback((sel: BackdropSelection) => {
    backdropSelRef.current = sel;
    setBackdropSel(sel);
  }, []);

  const holdCustomBackdrop = useCallback((held: { source: File | string; thumb: string; name: string } | null) => {
    const prev = customBackdropRef.current;
    if (prev && prev.thumb.startsWith("blob:") && prev.thumb !== held?.thumb) URL.revokeObjectURL(prev.thumb);
    customBackdropRef.current = held;
    setCustomBackdrop(held);
  }, []);

  /* Apply the held background choice to a changer — the ONE
     selection resolved the same way at every call site, exactly
     like BroadcastStudio's. False when the source couldn't load
     (the changer keeps its previous backdrop). */
  const applyBackdropSelection = useCallback(async (changer: BackgroundChanger): Promise<boolean> => {
    const source = backdropSelectionSource(backdropSelRef.current, customBackdropRef.current?.source ?? null);
    if (source === null) return false;
    try {
      await changer.setImage(source);
      return true;
    } catch {
      return false;
    }
  }, []);

  /* Pick a background tile: held first, then applied; a source
     that fails to load restores the previous choice — a bad pick
     never costs the creator the background they already had. */
  const pickBackdrop = useCallback(
    async (sel: BackdropSelection) => {
      const previous = backdropSelRef.current;
      chooseBackdrop(sel);
      setBgMode("image");
      bgModeRef.current = "image";
      const changer = changerRef.current;
      if (!changer) {
        setBgNote(t("worldLivePromo.bgNoteStartCamera"));
        return;
      }
      changer.setMode("image");
      const applied = await applyBackdropSelection(changer);
      if (!applied) {
        chooseBackdrop(previous);
        setBgNote(t("worldLivePromo.bgNoteLoadFailed"));
      } else {
        setBgNote(null);
      }
    },
    [applyBackdropSelection, chooseBackdrop],
  );

  /* Upload your own photo — validated by the app's image rules; a
     refused or unreadable file is announced and the previous
     background stays. With the camera off the photo is HELD and
     applied the moment the camera starts. */
  const handleBackdropUpload = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const refusal = validateBackdropUpload(file);
      if (refusal) {
        setBgNote(refusal);
        return;
      }
      const changer = changerRef.current;
      if (changer) {
        changer.setMode("image");
        try {
          await changer.setImage(file);
        } catch (err) {
          setBgNote(err instanceof BackgroundChangerError ? err.message : t("worldLivePromo.bgNoteLoadFailed"));
          return;
        }
      }
      holdCustomBackdrop({ source: file, thumb: URL.createObjectURL(file), name: file.name });
      chooseBackdrop(selectionAfterUpload(backdropSelRef.current, { ok: true, name: file.name }));
      setBgMode("image");
      bgModeRef.current = "image";
      setBgNote(changer ? null : t("worldLivePromo.bgNotePhotoHeld"));
    },
    [chooseBackdrop, holdCustomBackdrop],
  );

  /* A pasted image link is the same custom choice, held the same way. */
  const handleBackdropUrl = useCallback(
    async (url: string) => {
      const changer = changerRef.current;
      if (changer) {
        changer.setMode("image");
        try {
          await changer.setImage(url);
        } catch (err) {
          setBgNote(err instanceof BackgroundChangerError ? err.message : t("worldLivePromo.bgNoteLoadFailed"));
          return;
        }
      }
      holdCustomBackdrop({ source: url, thumb: url, name: t("worldLivePromo.bgPastedLinkName") });
      chooseBackdrop(selectionAfterUpload(backdropSelRef.current, { ok: true, name: t("worldLivePromo.bgPastedLinkName") }));
      setBgMode("image");
      bgModeRef.current = "image";
      setBgNote(changer ? null : t("worldLivePromo.bgNoteImageHeld"));
    },
    [chooseBackdrop, holdCustomBackdrop],
  );

  function pickBgMode(m: BackgroundMode) {
    setBgMode(m);
    bgModeRef.current = m;
    const changer = changerRef.current;
    if (!changer) return;
    changer.setMode(m);
    if (m === "image" && !changer.hasBackdrop()) void applyBackdropSelection(changer);
  }

  async function pickBgQuality(q: BackgroundQuality) {
    setBgQuality(q);
    /* Live switch when the camera is running; before the first
       start it simply rides into the kit's config. */
    await changerRef.current?.setQuality(q).catch(() => undefined);
  }

  /* ── #93 Camera & voice — the changer's follow-ons, carried ───────
     BroadcastStudio's rack on the SAME changer the desk owns: the
     held picks below are state first (they ride into the kit's
     construction config at start, exactly like the page's), and
     every live pick drives the kit's own method — setCameraEffect,
     setNoiseCancellation / setVoiceEffect on its VoiceIsolator
     chain, switchCamera / switchMicrophone, setMirror. No World-
     only shadow setting exists anywhere here. */
  const [camFx, setCamFx] = useState<string>("none");
  const [ncLevel, setNcLevel] = useState<NoiseCancellationLevel>(NOISE_CANCELLATION_DEFAULT);
  const [voiceFx, setVoiceFx] = useState<string>("none");
  const [mirror, setMirror] = useState(false);
  const [cvNote, setCvNote] = useState<string>(() => t("worldDeskRemainder.liveCvOpeningNote"));
  const [cameraId, setCameraId] = useState("");
  const [micId, setMicId] = useState("");
  const [cameras, setCameras] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [mics, setMics] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);

  /* The device lists ride the kit's own enumeration. Labels are
     populated after permission, so the lists load on mount AND
     again once the camera starts. When this browser exposes no
     device lists at all, the kit says UNSUPPORTED — the card then
     shows the reason and no selects (deviceSwitchingAvailable). */
  const loadDevices = useCallback(async () => {
    try {
      const [cams, microphones] = await Promise.all([
        BackgroundChanger.listCameras(),
        BackgroundChanger.listMicrophones(),
      ]);
      setCameras(cams);
      setMics(microphones);
      setDevicesError(null);
    } catch (err) {
      setDevicesError(
        err instanceof BackgroundChangerError
          ? err.message
          : t("worldDeskRemainder.liveErrNoMediaDevices"),
      );
    }
  }, [t]);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  function pickCamFx(id: string) {
    setCamFx(id);
    changerRef.current?.setCameraEffect(id);
  }

  async function pickNcLevel(level: NoiseCancellationLevel) {
    setNcLevel(level);
    const changer = changerRef.current;
    if (!changer) { setCvNote(noiseHeldNote(level, { off: t("worldDeskRemainder.liveNoiseHeldIdle"), on: t("worldDeskRemainder.liveNoiseHeldLive") })); return; }
    await changer.setNoiseCancellation(level).catch((err) => {
      setCvNote(err instanceof BackgroundChangerError ? err.message : t("worldDeskRemainder.liveErrNoiseChange"));
    });
  }

  async function pickVoiceFx(id: string) {
    setVoiceFx(id);
    const changer = changerRef.current;
    if (!changer) { setCvNote(voiceEffectHeldNote(id, { off: t("worldDeskRemainder.liveVoiceHeldPlain"), willBeOn: t("worldDeskRemainder.liveVoiceHeldPending") })); return; }
    await changer.setVoiceEffect(id).catch((err) => {
      setCvNote(err instanceof BackgroundChangerError ? err.message : t("worldDeskRemainder.liveErrVoiceApply"));
    });
  }

  async function pickCamera(deviceId: string) {
    setCameraId(deviceId);
    const changer = changerRef.current;
    if (!changer) return;
    await changer.switchCamera(deviceId || undefined).catch((err) => {
      setCvNote(err instanceof BackgroundChangerError ? err.message : t("worldDeskRemainder.liveErrCameraSwitch"));
    });
  }

  async function pickMic(deviceId: string) {
    setMicId(deviceId);
    const changer = changerRef.current;
    if (!changer) return;
    await changer.switchMicrophone(deviceId || undefined).catch((err) => {
      setCvNote(err instanceof BackgroundChangerError ? err.message : t("worldDeskRemainder.liveErrMicSwitch"));
    });
  }

  function pickMirror() {
    const next = !mirror;
    setMirror(next);
    changerRef.current?.setMirror(next);
  }

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(LIVE_STATUS_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("status");
      setStatus(normalizeLiveStatus(await res.json(), t("worldLivePromo.liveStreamFallback")));
      setFailed(false);
    } catch {
      setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    WhipTransport.api.getAccessToken = getAccessToken;
    OwnServerTransport.api.getAccessToken = getAccessToken;
    void loadStatus();
  }, [getAccessToken, loadStatus]);

  /* Viewer count while broadcasting from here — BroadcastStudio's
     10-second poll of the public stream DTO. */
  useEffect(() => {
    if (phase !== "live" || !liveId) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(LIVE_STREAM_PATH(liveId));
        if (res.ok) {
          const d = (await res.json()) as { stream?: { viewer_count?: number } };
          if (typeof d.stream?.viewer_count === "number") setViewers(d.stream.viewer_count);
        }
      } catch { /* next poll retries */ }
    }, 10_000);
    return () => clearInterval(id);
  }, [phase, liveId]);

  useEffect(
    () => () => {
      camRef.current?.getTracks().forEach((t) => t.stop());
      void changerRef.current?.stop().catch(() => undefined);
      changerRef.current = null;
    },
    [],
  );

  /* BroadcastStudio's camera start, carried: construct the kit
     once with the desk's held choices, start it (raw-first — the
     camera is live before any engine settles), and take its
     composited output stream as the feed. An engine error already
     on the kit is the only engine-down truth at this point; a
     still-warming engine is NOT down, and an Original session is
     not a failure. */
  async function startCamera() {
    setNote(null);
    try {
      if (!changerRef.current) {
        changerRef.current = new BackgroundChanger({
          mode: bgMode,
          quality: bgQuality,
          fineTune,
          audio: true,
          /* #93: the Camera & voice picks held in the card ride
             into the kit's config, exactly like BroadcastStudio's —
             a pick made with the camera off is live from the first
             frame, and the isolator's status speaks into the card. */
          noiseCancellation: ncLevel,
          voiceEffect: voiceFx,
          cameraEffect: camFx,
          mirror,
          onNoiseStatus: (s) => { const line = noiseStatusLine(s); if (line) setCvNote(line); },
          onEngineStatus: (kind) => {
            setEngineKind(kind);
            const c = changerRef.current;
            setEngineDown(engineDownFromStatus(kind, c?.mode ?? bgModeRef.current, !!c?.engineError));
            /* Raw-first: when the engine lands after a backdrop was
               already picked, load the chosen backdrop now. */
            if (kind !== "off" && bgModeRef.current === "image" && c && !c.hasBackdrop()) {
              void applyBackdropSelection(c);
            }
          },
          onEngineStatusDetail: (detail) => setEngineDetail(detail),
        });
      }
      const changer = changerRef.current;
      await changer.start(cameraId || undefined);
      const feed = changer.getStream();
      if (!feed) throw new Error(t("worldDeskRemainder.liveErrNoFeed"));
      camRef.current = feed;
      if (videoRef.current) videoRef.current.srcObject = feed;
      setEngineDown(bgMode !== "none" && !!changer.engineError);
      setEngineKind(changer.getEngineKind());
      setEngineDetail(changer.getEngineStatusDetail());
      if (changer.segmentationAvailable && bgMode === "image" && !changer.hasBackdrop()) {
        /* A held photo that can't load must not take the camera
           down with it: fall back to the default built-in, say
           so, and keep the creator's pick held for the next try. */
        const applied = await applyBackdropSelection(changer);
        if (!applied) {
          chooseBackdrop(DEFAULT_BACKDROP_SELECTION);
          await changer.setImage(backdropSelectionSource(DEFAULT_BACKDROP_SELECTION, null)).catch(() => undefined);
          setBgNote(t("worldLivePromo.bgNoteFallback"));
        }
      }
      /* #93: permission is granted now, so the device lists carry
         their real labels; and the voice chain's live truth (the
         isolator's own status — Max's ML fallback included) is the
         card's note, never the wanted level dressed up. */
      void loadDevices();
      const nsLine = noiseStatusLine(changer.getNoiseStatus());
      if (nsLine) setCvNote(nsLine);
      setPhase("camera");
    } catch (err) {
      setNote(
        err instanceof BackgroundChangerError
          ? err.message
          : t("worldLivePromo.studioNoteCameraFailed"),
      );
    }
  }

  async function stopCamera() {
    if (phase === "live" || phase === "connecting") return;
    await changerRef.current?.stop().catch(() => undefined);
    changerRef.current = null;
    camRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setEngineDown(false);
    setPhase("off");
  }

  async function goLive() {
    const cam = camRef.current;
    if (!cam) { setNote(t("worldLivePromo.studioNoteStartCamera")); return; }
    if (!streamTitleReady(title)) { setNote(t("worldLivePromo.studioNoteTitle")); return; }
    setPhase("connecting");
    setNote(null);
    const transport = createStreamTransport(status?.transport ?? "own");
    transportRef.current = transport;
    try {
      await transport.start(cam, { title: title.trim(), destinations: [{ ...SITE_DESTINATION }] });
      setLiveId(transport.streamId ?? null);
      setViewers(0);
      setPhase("live");
      setNote(t("worldLivePromo.studioNoteLive"));
      await loadStatus();
      onStreamChange?.();
    } catch (err) {
      setPhase("camera");
      const msg = err instanceof TransportError && (err.code === "NOT_CONFIGURED" || err.code === "STREAM_NOT_CONFIGURED")
        ? t("worldLivePromo.studioNoteNotSwitchedOn")
        : plainErrorText(err, t("worldLivePromo.studioNoteGoLiveFailed"));
      setNote(msg);
    }
  }

  async function endLive() {
    const transport = transportRef.current;
    if (!transport) return;
    await transport.stop();
    transportRef.current = null;
    setLiveId(null);
    setPhase("camera");
    setNote(t("worldLivePromo.studioNoteOffAir"));
    await loadStatus();
    onStreamChange?.();
  }

  async function endLeftover() {
    if (!status?.liveStream) return;
    setEndingLeftover(true);
    try {
      await fetch(LIVE_STREAM_END_PATH(status.liveStream.id), { method: "POST", headers: await authHeaders() });
      await loadStatus();
      onStreamChange?.();
    } finally {
      setEndingLeftover(false);
    }
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const engineStrings = liveEngineStrings(t);
  const broadcastingHere = phase === "live" || phase === "connecting";
  const leftover = !broadcastingHere ? status?.liveStream ?? null : null;

  return (
    <div className="space-y-4" data-testid="world-live-studio">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
          <Radio className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.studioTitle")}
        </span>
        {phase === "live" && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> {t("worldLivePromo.liveWatchingBadge", { count: viewers })}
          </span>
        )}
      </div>

      {failed ? (
        <p className={`text-sm ${muted}`}>{t("worldLivePromo.studioStatusFailed")} <button type="button" className="font-bold underline" onClick={() => void loadStatus()}>{t("worldLivePromo.tryAgain")}</button></p>
      ) : status === null ? (
        <NativeLoadingState isLight={isLight} message={t("worldLivePromo.studioChecking")} />
      ) : (
        <>
          {!status.configured && (
            <p className={`text-sm ${muted}`}>
              {t("worldLivePromo.studioNotConfigured")}
            </p>
          )}
          {leftover && (
            <div className="flex flex-wrap items-center gap-2" data-testid="world-live-leftover">
              <span className={`text-sm ${strong}`}>{t("worldLivePromo.studioLeftoverPrefix")} <b>{leftover.title}</b>{t("worldLivePromo.studioLeftoverSuffix", { viewers: leftover.viewerCount, since: leftover.startedAt ? t("worldLivePromo.studioLeftoverSince", { time: new Date(leftover.startedAt).toLocaleTimeString(i18n.language) }) : "" })}</span>
              <button type="button" onClick={() => void endLeftover()} disabled={endingLeftover} className={redBtn} data-testid="world-live-end-leftover">
                {endingLeftover ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} {t("worldLivePromo.studioEndThatStream")}
              </button>
              <span className={`text-xs ${muted}`}>{t("worldLivePromo.studioLeftoverGuests")}</span>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-[1fr_240px]">
            <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full object-cover" data-testid="world-live-camera" />
              {phase === "off" && (
                <span className={`absolute inset-0 flex items-center justify-center text-sm ${muted}`}>{t("worldLivePromo.studioCameraOff")}</span>
              )}
            </div>
            <div className="space-y-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("worldLivePromo.studioTitlePlaceholder")}
                maxLength={200}
                className={inputCls(isLight)}
                data-testid="world-live-title"
                aria-label={t("worldLivePromo.streamTitleField")}
              />
              {phase === "off" ? (
                <button type="button" onClick={() => void startCamera()} className={goldBtn} data-testid="world-live-camera-start">
                  <Video className="h-3.5 w-3.5" /> {t("worldLivePromo.studioStartCamera")}
                </button>
              ) : (
                <button type="button" onClick={() => void stopCamera()} disabled={broadcastingHere} className={chipBtn(isLight)} data-testid="world-live-camera-stop">
                  <VideoOff className="h-3.5 w-3.5" /> {t("worldLivePromo.studioStopCamera")}
                </button>
              )}
              {phase === "camera" && (
                <button type="button" onClick={() => void goLive()} disabled={!status.configured} className={redBtn} data-testid="world-live-go">
                  <Radio className="h-3.5 w-3.5" /> {t("worldLivePromo.studioGoLive")}
                </button>
              )}
              {phase === "connecting" && (
                <span className={`inline-flex items-center gap-2 text-sm ${muted}`}><Loader2 className="h-4 w-4 animate-spin" /> {t("worldLivePromo.studioConnecting")}</span>
              )}
              {phase === "live" && (
                <button type="button" onClick={() => void endLive()} className={redBtn} data-testid="world-live-end">
                  <Square className="h-3.5 w-3.5" /> {t("worldLivePromo.studioEndStream")}
                </button>
              )}
              <p className={`text-xs ${muted}`}>{t("worldLivePromo.studioBroadcastingTo")}</p>
            </div>
          </div>
          {note && <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-live-note">{note}</p>}

          {/* #92 Behind me — the 2D studio's green-screen panel, on
              the same kit: modes, quality, the ONE backdrop
              selection, and the fine-tune sliders over the shared
              device settings. */}
          <LiveCard isLight={isLight} testId="world-live-behind-me">
            <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
              <ImagePlus className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.behindTitle")}
            </p>
            <p className={`mt-1 text-xs ${muted}`}>
              {t("worldLivePromo.behindIntro")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("worldLivePromo.bgModeAria")}>
              {BACKGROUND_MODE_OPTIONS.map(({ mode: m }) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={bgMode === m}
                  disabled={engineDown && m !== "none"}
                  onClick={() => pickBgMode(m)}
                  className={bgMode === m ? goldBtn : chipBtn(isLight)}
                  data-testid={`world-live-bg-mode-${m}`}
                >
                  {t(BG_MODE_LABEL_KEYS[m])}
                </button>
              ))}
            </div>
            {engineDown && (
              <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-live-bg-engine-down">
                {t("worldLivePromo.bgEngineDown")}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label={t("worldLivePromo.bgQualityAria")}>
              <span className={`text-xs font-bold uppercase tracking-wider ${muted}`}>{t("worldLivePromo.bgQualityLabel")}</span>
              {BACKGROUND_QUALITY_OPTIONS.map(({ quality: q }) => (
                <button
                  key={q}
                  type="button"
                  aria-pressed={bgQuality === q}
                  onClick={() => void pickBgQuality(q)}
                  className={bgQuality === q ? goldBtn : chipBtn(isLight)}
                  data-testid={`world-live-bg-quality-${q}`}
                >
                  {t(BG_QUALITY_LABEL_KEYS[q])}
                </button>
              ))}
            </div>
            <p className={`mt-1 text-xs ${muted}`}>
              {t("worldLivePromo.bgQualityExplainer")}
            </p>
            {phase !== "off" && (
              <p className={`mt-2 text-xs font-semibold ${muted}`} data-testid="world-live-bg-engine-status">
                {t("worldLivePromo.bgEngineStatus", { kind: engineKindLabel(engineKind, engineStrings) })}
              </p>
            )}
            {phase !== "off" && engineFallbackNote(engineDetail, engineStrings) && (
              <p className={`mt-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-live-bg-engine-fallback">
                {engineFallbackNote(engineDetail, engineStrings)}
              </p>
            )}
            {greenScreenCueVisible(bgMode) && (
              <p className={`mt-4 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-live-bg-cue">
                {t("worldLivePromo.bgCue")}
              </p>
            )}
            <p className={`mt-4 text-xs font-bold uppercase tracking-wider ${muted}`}>{t("worldLivePromo.bgYourBackground")}</p>
            <div className="mt-2 grid max-h-56 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" role="group" aria-label={t("worldLivePromo.bgYourBackground")}>
              {BACKDROPS.map((b) => {
                const active = backdropTileActive(backdropSel, { kind: "builtin", id: b.id }, bgMode);
                return (
                  <button
                    key={b.id}
                    type="button"
                    disabled={engineDown}
                    onClick={() => void pickBackdrop({ kind: "builtin", id: b.id })}
                    className={`overflow-hidden rounded-lg border p-1 text-center transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      active
                        ? "border-transparent bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C]"
                        : isLight
                          ? "border-[#C9A84C]/30 hover:border-[#C9A84C]"
                          : "border-white/10 hover:border-white/30"
                    }`}
                    data-testid={`world-live-bg-backdrop-${b.id}`}
                  >
                    <img src={b.uri} alt="" className="aspect-video w-full rounded object-cover" />
                    <span className={`mt-1 block text-[11px] font-bold leading-tight ${active ? "text-black" : muted}`}>{b.label}</span>
                  </button>
                );
              })}
              {customBackdrop && (
                <button
                  type="button"
                  disabled={engineDown}
                  onClick={() => void pickBackdrop({ kind: "custom", name: customBackdrop.name })}
                  className={`overflow-hidden rounded-lg border p-1 text-center transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    backdropTileActive(backdropSel, { kind: "custom", name: customBackdrop.name }, bgMode)
                      ? "border-transparent bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C]"
                      : isLight
                        ? "border-[#C9A84C]/30 hover:border-[#C9A84C]"
                        : "border-white/10 hover:border-white/30"
                  }`}
                  data-testid="world-live-bg-backdrop-custom"
                >
                  <img src={customBackdrop.thumb} alt="" className="aspect-video w-full rounded object-cover" />
                  <span className={`mt-1 block truncate text-[11px] font-bold leading-tight ${backdropTileActive(backdropSel, { kind: "custom", name: customBackdrop.name }, bgMode) ? "text-black" : muted}`}>
                    {customBackdrop.name}
                  </span>
                </button>
              )}
              <label
                className={`cursor-pointer overflow-hidden rounded-lg border border-dashed p-1 text-center transition ${
                  isLight ? "border-[#C9A84C]/50 hover:border-[#C9A84C]" : "border-white/25 hover:border-white/50"
                } ${engineDown ? "pointer-events-none opacity-40" : ""}`}
                data-testid="world-live-bg-upload"
              >
                <span className={`flex aspect-video w-full flex-col items-center justify-center gap-1 rounded ${muted}`}>
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-[11px] font-bold leading-tight">{t("worldLivePromo.bgUploadPhoto")}</span>
                </span>
                <span className={`mt-1 block text-[11px] leading-tight ${muted}`}>{t("worldLivePromo.bgUploadFormats")}</span>
                <input
                  type="file"
                  accept={BACKDROP_UPLOAD_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    void handleBackdropUpload(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="text"
                aria-label={t("worldLivePromo.bgUrlAria")}
                placeholder={t("worldLivePromo.bgUrlPlaceholder")}
                className={`${inputCls(isLight)} min-w-[220px] flex-1`}
                data-testid="world-live-bg-url"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const url = (e.target as HTMLInputElement).value.trim();
                  if (!url) return;
                  void handleBackdropUrl(url);
                }}
              />
            </div>
            {bgNote && (
              <p className={`mt-2 text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-live-bg-note">{bgNote}</p>
            )}
            {bgMode !== "none" && (
              <div className="mt-5 border-t border-dashed border-[#C9A84C]/25 pt-4" data-testid="world-live-bg-finetune">
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-xs font-bold uppercase tracking-wider ${muted}`}>{t("worldLivePromo.fineTuneTitle")}</p>
                  <button
                    type="button"
                    onClick={resetFineTune}
                    className={`text-xs font-bold underline underline-offset-2 ${isLight ? "text-[#92600a]" : "text-amber-300"}`}
                    data-testid="world-live-bg-finetune-reset"
                  >
                    {t("worldLivePromo.fineTuneReset")}
                  </button>
                </div>
                <p className={`mt-1 text-xs ${muted}`}>
                  {t("worldLivePromo.fineTuneIntro")}
                </p>
                <div className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2">
                  {fineTuneSlidersForMode(bgMode).map((s) => (
                    <label key={s.key} className="block">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`text-xs font-bold ${muted}`}>{t(SLIDER_LABEL_KEYS[s.key])}</span>
                        <span className={`text-xs font-black tabular-nums ${isLight ? "text-[#7A5A12]" : "text-[#fbbf24]"}`}>
                          {s.format(fineTune[s.key])}
                        </span>
                      </span>
                      <input
                        type="range"
                        min={s.min}
                        max={s.max}
                        step={s.step}
                        value={fineTune[s.key]}
                        aria-label={t(SLIDER_LABEL_KEYS[s.key])}
                        onChange={(e) => applyFineTune({ [s.key]: Number(e.target.value) })}
                        className="mt-1 w-full accent-[#d4af37] bdv-touch-target"
                        data-testid={`world-live-bg-finetune-${s.key}`}
                      />
                      <span className={`mt-0.5 block text-[11px] leading-snug ${muted}`}>{t(SLIDER_HINT_KEYS[s.key])}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </LiveCard>

          {/* #93 Camera & voice — BroadcastStudio's rack on the same
              changer: effects on the picture, cleaning + effects on
              the voice, the camera + mic you choose, and the mirror.
              Every control drives the kit the Behind-me card owns. */}
          <LiveCard isLight={isLight} testId="world-live-camera-voice">
            <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
              <Sparkles className="h-4 w-4 text-[#d4af37]" /> {t("worldDeskRemainder.liveCvTitle")}
            </p>
            <p className={`mt-1 text-xs ${muted}`}>
              {t("worldDeskRemainder.liveCvIntro")}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("worldDeskRemainder.liveCvAriaDevices")}>
              {deviceSwitchingAvailable(devicesError !== null) ? (
                <>
                  <label className="flex min-w-[160px] flex-1 items-center gap-2 text-xs">
                    <Camera className="h-4 w-4 shrink-0 opacity-50" />
                    <select
                      value={cameraId}
                      onChange={(e) => void pickCamera(e.target.value)}
                      className={`${selectCls(isLight)} w-auto flex-1`}
                      aria-label={t("worldDeskRemainder.liveCvAriaCamera")}
                      data-testid="world-live-camera-select"
                    >
                      <option value="">{t("worldDeskRemainder.liveCvDefaultCamera")}</option>
                      {cameras.map((c) => (
                        <option key={c.deviceId} value={c.deviceId}>{c.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-[160px] flex-1 items-center gap-2 text-xs">
                    <Mic className="h-4 w-4 shrink-0 opacity-50" />
                    <select
                      value={micId}
                      onChange={(e) => void pickMic(e.target.value)}
                      className={`${selectCls(isLight)} w-auto flex-1`}
                      aria-label={t("worldDeskRemainder.liveCvAriaMic")}
                      data-testid="world-live-mic-select"
                    >
                      <option value="">{t("worldDeskRemainder.liveCvDefaultMic")}</option>
                      {mics.map((m) => (
                        <option key={m.deviceId} value={m.deviceId}>{m.label}</option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-live-devices-unavailable">
                  {t("worldDeskRemainder.liveCvUnavailable", { error: devicesError })}
                </p>
              )}
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <button
                  type="button"
                  role="switch"
                  aria-checked={mirror}
                  aria-label={t("worldDeskRemainder.liveCvMirrorAria")}
                  onClick={pickMirror}
                  className={`relative h-6 w-10 shrink-0 rounded-full transition-colors bdv-touch-target ${mirror ? "bg-[#d4af37]" : isLight ? "bg-[#7A5A12]/30" : "bg-white/15"}`}
                  data-testid="world-live-mirror"
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-all ${mirror ? "left-[18px]" : "left-0.5"}`} />
                </button>
                {t("worldDeskRemainder.liveCvMirrorLabel")}
              </label>
            </div>
            <p className={`mt-4 text-xs font-bold uppercase tracking-wider ${muted}`}>{t("worldDeskRemainder.liveCvCameraEffects")}</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t("worldDeskRemainder.liveCvAriaCameraPresets")}>
              {CAMERA_EFFECT_OPTIONS.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  aria-pressed={camFx === e.id}
                  onClick={() => pickCamFx(e.id)}
                  className={camFx === e.id ? goldBtn : chipBtn(isLight)}
                  data-testid={`world-live-camfx-${e.id}`}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label={t("worldDeskRemainder.liveCvAriaNoise")}>
              <span className={`text-xs font-bold uppercase tracking-wider ${muted}`}>{t("worldDeskRemainder.liveCvNoiseCanc")}</span>
              {NOISE_CANCELLATION_OPTIONS.map(({ level, label }) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={ncLevel === level}
                  onClick={() => void pickNcLevel(level)}
                  className={ncLevel === level ? goldBtn : chipBtn(isLight)}
                  data-testid={`world-live-nc-${level}`}
                >
                  {level === "off" ? t("worldDeskRemainder.liveNoiseOff") : level === "on" ? t("worldDeskRemainder.liveNoiseOn") : t("worldDeskRemainder.liveNoiseMax")}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("worldDeskRemainder.liveCvAriaVoicePresets")}>
              <span className={`text-xs font-bold uppercase tracking-wider ${muted}`}>{t("worldDeskRemainder.liveCvVoiceEffects")}</span>
              {VOICE_EFFECT_OPTIONS.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  aria-pressed={voiceFx === e.id}
                  onClick={() => void pickVoiceFx(e.id)}
                  className={voiceFx === e.id ? goldBtn : chipBtn(isLight)}
                  data-testid={`world-live-fx-${e.id}`}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <p className={`mt-3 text-sm ${muted}`} role="status" data-testid="world-live-cv-note">{cvNote}</p>
          </LiveCard>

          <IngestKeySection isLight={isLight} />
          <DestinationKeysSection isLight={isLight} />
          <LoyaltySection isLight={isLight} token={token} />
        </>
      )}
    </div>
  );
}

/* ── #85 ingest key (IngestKeyPanel's doors) ─────────────────────── */

interface IngestDto {
  enabled: boolean;
  ingest_url: string | null;
  has_key: boolean;
  key_hint: string | null;
  stream_title: string | null;
  revoked: boolean;
}

function IngestKeySection({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const [ingest, setIngest] = useState<IngestDto | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [notReshown, setNotReshown] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<{ ingest: IngestDto }>(getAccessToken, INGEST_KEY_PATH);
      setIngest(res.ingest);
      setTitle(res.ingest.stream_title ?? "");
    } catch {
      setNote(t("worldLivePromo.ingestLoadFailed"));
    }
  }, [getAccessToken]);

  useEffect(() => { void load(); }, [load]);

  const run = async (action: string, fn: () => Promise<void>) => {
    setBusy(action);
    setNote(null);
    try { await fn(); } catch (err) {
      setNote(plainErrorText(err, t("worldLivePromo.ingestSomethingWrong")));
    } finally { setBusy(null); }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  return (
    <LiveCard isLight={isLight} testId="world-live-ingest">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <KeyRound className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.ingestTitle")}
      </p>
      {ingest === null ? (
        <p className={`mt-1 text-sm ${muted}`}>{t("worldLivePromo.ingestLoading")}</p>
      ) : !ingest.enabled ? (
        <p className={`mt-1 text-sm ${muted}`}>
          {t("worldLivePromo.ingestNotOpen")}
          {ingest.has_key ? t("worldLivePromo.ingestNotOpenHasKey", { hint: ingest.key_hint ?? "" }) : ""}
        </p>
      ) : (
        <p className={`mt-1 text-sm ${muted}`}>
          {t("worldLivePromo.ingestPointAtBefore")} <span className="font-mono">{ingest.ingest_url ?? t("worldLivePromo.ingestAddressFallback")}</span> {t("worldLivePromo.ingestPointAtAfter")}
          {ingest.has_key ? t("worldLivePromo.ingestCurrentKey", { hint: ingest.key_hint ?? "" }) : t("worldLivePromo.ingestNoKey")}
        </p>
      )}
      {/* Stream-key honesty (Stack-100 #2 item 79): nothing here has
          proven the key works — there is no handshake test on this
          surface, so the key is labelled untested until a broadcast
          actually connects. Never a silent "ready". */}
      {ingest?.enabled && ingest.has_key ? (
        <p className={`mt-1 text-xs ${muted}`} data-testid="world-live-ingest-untested">
          {t("worldLivePromo.ingestUntested")}
        </p>
      ) : null}
      {ingest && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy !== null || !ingest.enabled}
            onClick={() => void run("reveal", async () => {
              const res = await apiJson<{ stream_key: string | null; ingest: IngestDto }>(getAccessToken, INGEST_KEY_REVEAL_PATH, { method: "POST" });
              setIngest(res.ingest);
              if (ingestKeyShownOnce(res.stream_key)) { setRevealedKey(res.stream_key); setNotReshown(false); }
              else setNotReshown(true);
            })}
            className={chipBtn(isLight)}
            data-testid="world-live-ingest-reveal"
          >
            {busy === "reveal" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            {ingest.has_key ? t("worldLivePromo.ingestShowKey") : t("worldLivePromo.ingestCreateKey")}
          </button>
          {ingest.has_key && !confirmingRegen && (
            <button type="button" disabled={busy !== null || !ingest.enabled} onClick={() => setConfirmingRegen(true)} className={chipBtn(isLight)} data-testid="world-live-ingest-regen-ask">
              <RefreshCw className="h-3.5 w-3.5" /> {t("worldLivePromo.ingestRegenerate")}
            </button>
          )}
          {ingest.has_key && confirmingRegen && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("regenerate", async () => {
                const res = await apiJson<{ stream_key: string | null; ingest: IngestDto }>(getAccessToken, INGEST_KEY_REGENERATE_PATH, { method: "POST" });
                setIngest(res.ingest);
                setRevealedKey(res.stream_key);
                setNotReshown(false);
                setConfirmingRegen(false);
                setNote(t("worldLivePromo.ingestRegenNote"));
              })}
              className={redBtn}
              data-testid="world-live-ingest-regen-confirm"
            >
              {busy === "regenerate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {t("worldLivePromo.ingestRegenConfirm")}
            </button>
          )}
          {ingest.has_key && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("revoke", async () => {
                const res = await apiJson<{ ingest: IngestDto }>(getAccessToken, INGEST_KEY_REVOKE_PATH, { method: "POST" });
                setIngest(res.ingest);
                setRevealedKey(null);
                setNotReshown(false);
                setConfirmingRegen(false);
                setNote(t("worldLivePromo.ingestRevokeNote"));
              })}
              className={chipBtn(isLight)}
              data-testid="world-live-ingest-revoke"
            >
              {busy === "revoke" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} {t("worldLivePromo.revoke")}
            </button>
          )}
        </div>
      )}
      {revealedKey && (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="world-live-ingest-key">
          <code className={`rounded-lg px-3 py-1.5 font-mono text-xs ${isLight ? "bg-[#C9A84C]/15 text-[#2a1e07]" : "bg-white/10 text-white"}`}>{revealedKey}</code>
          <button
            type="button"
            className={chipBtn(isLight)}
            onClick={() => { void navigator.clipboard?.writeText(revealedKey).then(() => setCopied(true)).catch(() => undefined); }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? t("worldLivePromo.copied") : t("worldLivePromo.copy")}
          </button>
          <span className={`text-xs ${muted}`}>{t("worldLivePromo.ingestShownOnce")}</span>
        </div>
      )}
      {notReshown && (
        <p className={`mt-2 text-sm ${muted}`}>{t("worldLivePromo.ingestNotReshown")}</p>
      )}
      {ingest?.has_key && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("worldLivePromo.ingestTitlePlaceholder")} maxLength={120} className={`${inputCls(isLight)} max-w-sm`} data-testid="world-live-ingest-title" aria-label={t("worldLivePromo.ingestTitleAria")} />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("title", async () => {
              const res = await apiJson<{ ingest: IngestDto }>(getAccessToken, INGEST_KEY_PATH, { method: "PATCH", body: JSON.stringify({ stream_title: title.trim() || null }) });
              setIngest(res.ingest);
              setNote(t("worldLivePromo.ingestTitleSaved"));
            })}
            className={chipBtn(isLight)}
            data-testid="world-live-ingest-title-save"
          >
            {t("worldLivePromo.ingestSaveTitle")}
          </button>
        </div>
      )}
      {note && <p className={`mt-2 text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
    </LiveCard>
  );
}

/* ── #85 destination keys (DestinationKeysPanel's doors) ─────────── */

function DestinationKeysSection({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const [destinations, setDestinations] = useState<SavedDestination[] | null>(null);
  const [platform, setPlatform] = useState("");
  const [ingestUrl, setIngestUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await reachApi.listDestinations(getAccessToken);
      setDestinations(res.destinations);
    } catch {
      setDestinations([]);
      setNote(t("worldLivePromo.destLoadFailed"));
    }
  }, [getAccessToken]);

  useEffect(() => { void load(); }, [load]);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  return (
    <LiveCard isLight={isLight} testId="world-live-destinations">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <Link2 className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.destTitle")}
      </p>
      <p className={`mt-1 text-sm ${muted}`}>{t("worldLivePromo.destIntro")}</p>
      {destinations === null ? (
        <p className={`mt-2 text-sm ${muted}`}>{t("worldLivePromo.destLoading")}</p>
      ) : destinations.length === 0 ? (
        <p className={`mt-2 text-sm ${muted}`}>{t("worldLivePromo.destEmpty")}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {destinations.map((d) => (
            <li key={d.platform} className="flex flex-wrap items-center gap-2 text-sm" data-testid="world-live-destination-row">
              <b className={`capitalize ${strong}`}>{d.platform}</b>
              <span className={`font-mono text-xs ${muted}`}>{d.ingestUrl}</span>
              <span className={`text-xs ${muted}`}>{d.hasKey ? t("worldLivePromo.destKeySaved") : t("worldLivePromo.destNoKey")}</span>
              <button
                type="button"
                className={chipBtn(isLight)}
                onClick={() => { void reachApi.deleteDestination(getAccessToken, d.platform).then(() => load()).catch(() => undefined); }}
                data-testid={`world-live-destination-delete-${d.platform}`}
              >
                <Trash2 className="h-3.5 w-3.5" /> {t("worldLivePromo.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder={t("worldLivePromo.destPlatformPlaceholder")} className={inputCls(isLight)} data-testid="world-live-dest-platform" aria-label={t("worldLivePromo.destPlatformAria")} />
        <input value={ingestUrl} onChange={(e) => setIngestUrl(e.target.value)} placeholder={t("worldLivePromo.destUrlPlaceholder")} className={inputCls(isLight)} data-testid="world-live-dest-url" aria-label={t("worldLivePromo.destUrlAria")} />
        <input value={streamKey} onChange={(e) => setStreamKey(e.target.value)} placeholder={t("worldLivePromo.destKeyPlaceholder")} type="password" className={inputCls(isLight)} data-testid="world-live-dest-key" aria-label={t("worldLivePromo.destKeyAria")} />
      </div>
      <button
        type="button"
        disabled={busy || !platform.trim() || !ingestUrl.trim() || !streamKey.trim()}
        onClick={async () => {
          setBusy(true);
          setNote(null);
          try {
            await reachApi.saveDestination(getAccessToken, platform.trim().toLowerCase(), ingestUrl.trim(), streamKey.trim());
            setPlatform(""); setIngestUrl(""); setStreamKey("");
            setNote(t("worldLivePromo.destSavedNote"));
            await load();
          } catch (err) {
            setNote(plainErrorText(err, t("worldLivePromo.destSaveFailed")));
          } finally { setBusy(false); }
        }}
        className={`${goldBtn} mt-2`}
        data-testid="world-live-dest-save"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {t("worldLivePromo.destSave")}
      </button>
      {note && <p className={`mt-2 text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
    </LiveCard>
  );
}

/* ── #85 loyalty (LoyaltySettingsPanel's doors) ──────────────────── */

function LoyaltySection({ isLight, token }: { isLight: boolean; token: () => Promise<string> }) {
  void token;
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<LoyaltyState | null>(null);
  const [queue, setQueue] = useState<Array<{ id: string; perkLabel: string; pointsCost: number; status: string }>>([]);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState({ enabled: true, watch: 10, chat: 2, tip: 5, customLabel: "", customCost: 1000 });

  const load = useCallback(async (pid: string) => {
    const [s, q] = await Promise.all([
      reachApi.loyalty(getAccessToken, pid),
      reachApi.redemptionQueue(getAccessToken, pid).catch(() => ({ redemptions: [] as Array<{ id: string; perkLabel: string; pointsCost: number; status: string }> })),
    ]);
    setState(s);
    setForm({
      enabled: s.enabled,
      watch: s.watchPointsPer10Min,
      chat: s.chatPoints,
      tip: s.tipPointsPer100Vb,
      customLabel: s.customRewardLabel ?? "",
      customCost: s.customRewardCost ?? 1000,
    });
    setQueue(pendingRedemptionsFromPayload(q));
  }, [getAccessToken]);

  useEffect(() => {
    (async () => {
      try {
        const me = await apiJson<{ id?: string }>(getAccessToken, MY_PROFILE_PATH).catch(() => null);
        const pid = me?.id ?? null;
        setProfileId(pid);
        if (pid) await load(pid);
      } catch { /* no profile → the card explains itself */ }
      setLoaded(true);
    })();
  }, [getAccessToken, load]);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const rowCls = `flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm bdv-touch-target ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`;

  return (
    <LiveCard isLight={isLight} testId="world-live-loyalty">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <Trophy className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.loyaltyTitle")}
      </p>
      {!loaded ? (
        <p className={`mt-1 text-sm ${muted}`}>{t("worldLivePromo.loyaltyLoading")}</p>
      ) : !profileId ? (
        <p className={`mt-1 text-sm ${muted}`}>{t("worldLivePromo.loyaltyNoProfile")}</p>
      ) : (
        <>
          <p className={`mt-1 text-sm ${muted}`}>{t("worldLivePromo.loyaltyIntro")}</p>
          <form
            className="mt-3 grid gap-2 md:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setNote(null);
              try {
                await reachApi.saveLoyaltySettings(getAccessToken, profileId, {
                  enabled: form.enabled,
                  watchPointsPer10Min: form.watch,
                  chatPoints: form.chat,
                  tipPointsPer100Vb: form.tip,
                  customRewardLabel: form.customLabel.trim() || null,
                  customRewardCost: form.customLabel.trim() ? form.customCost : null,
                });
                setNote(t("worldLivePromo.loyaltySavedNote"));
                await load(profileId);
              } catch (err) {
                setNote(plainErrorText(err, t("worldLivePromo.loyaltySaveFailed")));
              }
            }}
          >
            <label className={rowCls}>{t("worldLivePromo.loyaltyProgramOn")}
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 accent-[#d4af37]" data-testid="world-live-loyalty-enabled" />
            </label>
            <label className={rowCls}>{t("worldLivePromo.loyaltyWatchLabel")}
              <select value={form.watch} onChange={(e) => setForm({ ...form, watch: Number(e.target.value) })} className={selectCls(isLight)} data-testid="world-live-loyalty-watch">
                {LOYALTY_WATCH_MENU.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className={rowCls}>{t("worldLivePromo.loyaltyChatLabel")}
              <select value={form.chat} onChange={(e) => setForm({ ...form, chat: Number(e.target.value) })} className={selectCls(isLight)} data-testid="world-live-loyalty-chat">
                {LOYALTY_CHAT_MENU.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className={rowCls}>{t("worldLivePromo.loyaltyTipLabel")}
              <select value={form.tip} onChange={(e) => setForm({ ...form, tip: Number(e.target.value) })} className={selectCls(isLight)} data-testid="world-live-loyalty-tip">
                {LOYALTY_TIP_MENU.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className={`${rowCls} md:col-span-2`}>{t("worldLivePromo.loyaltyCustomLabel")}
              <input value={form.customLabel} onChange={(e) => setForm({ ...form, customLabel: e.target.value })} placeholder={t("worldLivePromo.loyaltyCustomPlaceholder")} className={`${inputCls(isLight)} min-w-0 flex-1`} data-testid="world-live-loyalty-custom-label" />
              <select value={form.customCost} onChange={(e) => setForm({ ...form, customCost: Number(e.target.value) })} className={selectCls(isLight)} data-testid="world-live-loyalty-custom-cost">
                {LOYALTY_CUSTOM_COST_MENU.map((v) => <option key={v} value={v}>{t("worldLivePromo.loyaltyCustomCost", { cost: v })}</option>)}
              </select>
            </label>
            <button type="submit" className={goldBtn} data-testid="world-live-loyalty-save">{t("worldLivePromo.loyaltySave")}</button>
          </form>
          {note && <p className={`mt-2 text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
          {state && <p className={`mt-2 text-xs ${muted}`}>{t("worldLivePromo.loyaltyPerksLine", { list: state.perks.map((p) => t("worldLivePromo.loyaltyPerkItem", { label: p.label, cost: p.cost })).join(" · ") })}</p>}

          <p className={`mt-4 text-xs font-black uppercase tracking-wider ${muted}`}>{t("worldLivePromo.loyaltyQueueTitle")}</p>
          {queue.length === 0 ? (
            <p className={`mt-1 text-sm ${muted}`}>{t("worldLivePromo.loyaltyQueueEmpty")}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {queue.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="world-live-redemption-row">
                  <span className={strong}>{r.perkLabel} <span className={muted}>{t("worldLivePromo.loyaltyRowCost", { cost: r.pointsCost })}</span></span>
                  <span className="flex gap-1.5">
                    {(["fulfilled", "declined"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={d === "fulfilled" ? goldBtn : chipBtn(isLight)}
                        onClick={async () => {
                          await reachApi.resolveRedemption(getAccessToken, r.id, d).catch(() => undefined);
                          await load(profileId);
                        }}
                        data-testid={`world-live-redemption-${d}`}
                      >
                        {d === "fulfilled" ? t("worldLivePromo.loyaltyFulfilled") : t("worldLivePromo.loyaltyDecline")}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </LiveCard>
  );
}

/* ═══ #86 Guests & backstage (host) ═════════════════════════════════ */

export function LiveBackstageDesk({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const token = useToken();
  const authHeaders = useAuthHeaders();
  const [stream, setStream] = useState<{ id: string; title: string } | null>(null);
  const [invites, setInvites] = useState<GuestInviteDto[]>([]);
  const [guests, setGuests] = useState<GuestSessionDto[]>([]);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState<string>("240");
  const [maxJoins, setMaxJoins] = useState<string>("");
  const [minting, setMinting] = useState(false);
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [inBackstage, setInBackstage] = useState(false);
  const [peers, setPeers] = useState<BackstagePeer[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [messages, setMessages] = useState<BackstageMessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const clientRef = useRef<BackstageClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamIdRef = useRef<string | null>(null);

  /* GuestPanel's status poll: invites attach to the live stream. */
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(LIVE_STATUS_PATH, { headers: await authHeaders() });
        if (!res.ok) return;
        const data = (await res.json()) as { live_stream: { id: string; title: string } | null };
        if (cancelled) return;
        setStream(data.live_stream ? { id: data.live_stream.id, title: data.live_stream.title } : null);
      } catch { /* best-effort; next tick retries */ }
    };
    void check();
    const id = setInterval(check, 15_000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshRoster = useCallback(async () => {
    const sid = streamIdRef.current;
    if (!sid) return;
    try {
      const data = await listGuestInvites(sid, await token());
      setInvites(data.invites);
      setGuests(data.guests.filter((g) => g.state === "backstage" || g.state === "on_stage"));
    } catch { /* best-effort refresh */ }
  }, [token]);

  useEffect(() => {
    streamIdRef.current = stream?.id ?? null;
    if (!stream) { setInvites([]); setGuests([]); return; }
    void refreshRoster();
    const id = setInterval(refreshRoster, 20_000);
    return () => clearInterval(id);
  }, [stream, refreshRoster]);

  const leaveBackstage = useCallback(() => {
    clientRef.current?.close();
    clientRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setInBackstage(false);
    setPeers([]);
    setRemoteStreams(new Map());
  }, []);

  useEffect(() => {
    if (!stream) leaveBackstage();
  }, [stream, leaveBackstage]);

  useEffect(() => () => {
    clientRef.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  async function handleMint() {
    if (!stream) return;
    setMinting(true);
    setNote(null);
    try {
      const data = await mintGuestInvite(stream.id, await token(), {
        label: label.trim() || undefined,
        expires_in_minutes: expiry ? Number(expiry) : undefined,
        max_joins: maxJoins ? Number(maxJoins) : undefined,
      });
      setFreshLink(inviteShareUrl(window.location.origin, data.invite_path));
      setCopied(false);
      setLabel("");
      await refreshRoster();
      setNote(t("worldLivePromo.inviteReadyNote"));
    } catch (e) {
      setNote(plainErrorText(e, t("worldLivePromo.inviteMintFailed")));
    } finally { setMinting(false); }
  }

  async function handleRevoke(invite: GuestInviteDto) {
    if (!stream) return;
    try {
      const data = await revokeGuestInvite(stream.id, invite.id, await token());
      setFreshLink(null);
      await refreshRoster();
      setNote(data.sessions_ended ? t("worldLivePromo.inviteRevokeEnded", { count: data.sessions_ended }) : t("worldLivePromo.inviteRevokeDone"));
    } catch (e) {
      setNote(plainErrorText(e, t("worldLivePromo.inviteRevokeFailed")));
    }
  }

  async function handlePromote(guest: GuestSessionDto) {
    if (!stream) return;
    try {
      const data = await promoteGuest(stream.id, guest.id, await token());
      setGuests((gs) => gs.map((g) => (g.id === guest.id ? data.guest : g)));
    } catch (e) { setNote(plainErrorText(e, t("worldLivePromo.guestPromoteFailed"))); }
  }

  async function handleDemote(guest: GuestSessionDto) {
    if (!stream) return;
    try {
      const data = await demoteGuest(stream.id, guest.id, await token());
      setGuests((gs) => gs.map((g) => (g.id === guest.id ? data.guest : g)));
    } catch (e) { setNote(plainErrorText(e, t("worldLivePromo.guestDemoteFailed"))); }
  }

  async function handleRemove(guest: GuestSessionDto) {
    if (!stream) return;
    try {
      await removeGuest(stream.id, guest.id, await token());
      setGuests((gs) => gs.filter((g) => g.id !== guest.id));
    } catch (e) { setNote(plainErrorText(e, t("worldLivePromo.guestRemoveFailed"))); }
  }

  async function enterBackstage() {
    if (!stream || clientRef.current) return;
    let local: MediaStream | null = null;
    try {
      local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      setNote(t("worldLivePromo.backstageCameraNote"));
    }
    localStreamRef.current = local;
    if (localVideoRef.current && local) localVideoRef.current.srcObject = local;
    const tok = await token();
    const client = new BackstageClient({
      streamId: stream.id,
      token: tok,
      events: {
        onPeers: (next) => { setPeers(next); void refreshRoster(); },
        onChat: (message) => setMessages((ms) => (ms.some((m) => m.id === message.id) ? ms : [...ms, message])),
        onRemoteStream: (sessionId, peerId, mediaStream) => {
          setRemoteStreams((prev) => new Map(prev).set(sessionId ?? peerId, mediaStream));
        },
        onRemoteGone: (sessionId, peerId) => {
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.delete(sessionId ?? peerId);
            return next;
          });
        },
        onBackstageClosed: () => setNote(t("worldLivePromo.backstageClosedNote")),
      },
    });
    clientRef.current = client;
    client.connect(local);
    if (local) client.joinMedia();
    setInBackstage(true);
    try {
      const data = await hostBackstageHistory(stream.id, tok);
      setMessages(data.messages);
    } catch { /* live frames still land */ }
  }

  async function handleSend() {
    if (!stream || !backstageDraftReady(draft)) return;
    setSending(true);
    try {
      const data = await hostBackstagePost(stream.id, await token(), draft.trim());
      setMessages((ms) => (ms.some((m) => m.id === data.message.id) ? ms : [...ms, data.message]));
      setDraft("");
    } catch (e) {
      setNote(plainErrorText(e, t("worldLivePromo.backstageSendFailed")));
    } finally { setSending(false); }
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const roster = normalizeGuestRoster(guests);

  return (
    <div className="space-y-3" data-testid="world-live-backstage">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <ShieldCheck className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.backstageTitle")}
      </p>
      {!stream ? (
        <NativeEmptyState
          isLight={isLight}
          message={t("worldLivePromo.backstageNoStream")}
          detail={t("worldLivePromo.backstageNoStreamDetail")}
        />
      ) : (
        <>
          <p className={`text-sm ${muted}`}>{t("worldLivePromo.backstageLiveNowBefore")} <b className={strong}>{stream.title}</b>{t("worldLivePromo.backstageLiveNowAfter")}</p>

          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-40 flex-1">
              <span className={`text-xs font-bold ${muted}`}>{t("worldLivePromo.inviteLabelLabel")}</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("worldLivePromo.inviteLabelPlaceholder")} maxLength={60} className={inputCls(isLight)} data-testid="world-live-invite-label" />
            </label>
            <label>
              <span className={`text-xs font-bold ${muted}`}>{t("worldLivePromo.inviteExpiresLabel")}</span>
              <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className={`${selectCls(isLight)} block`} data-testid="world-live-invite-expiry">
                {INVITE_EXPIRY_OPTIONS.map((o) => <option key={o.minutes} value={o.minutes}>{t(EXPIRY_LABEL_KEYS[o.minutes] ?? "worldLivePromo.expiry240")}</option>)}
              </select>
            </label>
            <label className="w-28">
              <span className={`text-xs font-bold ${muted}`}>{t("worldLivePromo.inviteMaxJoinsLabel")}</span>
              <input value={maxJoins} onChange={(e) => setMaxJoins(e.target.value.replace(/[^0-9]/g, ""))} placeholder={t("worldLivePromo.inviteMaxJoinsPlaceholder")} inputMode="numeric" className={inputCls(isLight)} data-testid="world-live-invite-maxjoins" />
            </label>
            <button type="button" onClick={() => void handleMint()} disabled={minting} className={goldBtn} data-testid="world-live-invite-mint">
              {minting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} {t("worldLivePromo.inviteMint")}
            </button>
          </div>

          {freshLink && (
            <div className="flex flex-wrap items-center gap-2" data-testid="world-live-invite-fresh">
              <code className={`max-w-full truncate rounded-lg px-3 py-1.5 font-mono text-xs ${isLight ? "bg-[#C9A84C]/15 text-[#2a1e07]" : "bg-white/10 text-white"}`}>{freshLink}</code>
              <button
                type="button"
                className={chipBtn(isLight)}
                onClick={() => { void navigator.clipboard?.writeText(freshLink).then(() => setCopied(true)).catch(() => undefined); }}
                data-testid="world-live-invite-copy"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? t("worldLivePromo.copied") : t("worldLivePromo.copyLink")}
              </button>
            </div>
          )}

          {invites.filter((i) => !i.revoked_at).length > 0 && (
            <ul className="space-y-1.5">
              {invites.filter((i) => !i.revoked_at).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="world-live-invite-row">
                  <span className={strong}>{i.label ?? t("worldLivePromo.inviteFallbackLabel")}</span>
                  <span className={muted}>{t("worldLivePromo.inviteMeta", { hint: i.token_hint, count: i.join_count })}{i.max_joins ? t("worldLivePromo.inviteMetaOf", { max: i.max_joins }) : ""}{i.expires_at ? t("worldLivePromo.inviteMetaExpires", { date: new Date(i.expires_at).toLocaleString(i18n.language) }) : ""}</span>
                  <button type="button" className={chipBtn(isLight)} onClick={() => void handleRevoke(i)} data-testid="world-live-invite-revoke">
                    <Ban className="h-3.5 w-3.5" /> {t("worldLivePromo.revoke")}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div>
            <p className={`text-xs font-black uppercase tracking-wider ${muted}`}>{t("worldLivePromo.roomTitle", { count: roster.length })}</p>
            {roster.length === 0 ? (
              <p className={`mt-1 text-sm ${muted}`}>{t("worldLivePromo.roomEmpty")}</p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {roster.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="world-live-guest-row">
                    <span className={strong}>{g.displayName}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${g.onStage ? "bg-red-500/15 text-red-300" : "bg-white/10 text-white/60"}`}>
                      {g.onStage ? t("worldLivePromo.guestOnStageBadge") : t("worldLivePromo.guestBackstageBadge")}
                    </span>
                    {g.onStage ? (
                      <button type="button" className={chipBtn(isLight)} onClick={() => void handleDemote(guests.find((x) => x.id === g.id)!)} data-testid="world-live-guest-demote">
                        <ArrowDownCircle className="h-3.5 w-3.5" /> {t("worldLivePromo.guestDemote")}
                      </button>
                    ) : (
                      <button type="button" className={chipBtn(isLight)} onClick={() => void handlePromote(guests.find((x) => x.id === g.id)!)} data-testid="world-live-guest-promote">
                        <ArrowUpCircle className="h-3.5 w-3.5" /> {t("worldLivePromo.guestPromote")}
                      </button>
                    )}
                    <button type="button" className={chipBtn(isLight)} onClick={() => void handleRemove(guests.find((x) => x.id === g.id)!)} data-testid="world-live-guest-remove">
                      <UserX className="h-3.5 w-3.5" /> {t("worldLivePromo.remove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            {!inBackstage ? (
              <button type="button" onClick={() => void enterBackstage()} className={goldBtn} data-testid="world-live-backstage-enter">
                <Video className="h-3.5 w-3.5" /> {t("worldLivePromo.backstageEnter")}
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm ${muted}`}>{peers.length === 1 ? t("worldLivePromo.backstagePeersOne", { count: peers.length }) : t("worldLivePromo.backstagePeersMany", { count: peers.length })}</span>
                  <button type="button" onClick={leaveBackstage} className={chipBtn(isLight)} data-testid="world-live-backstage-leave">
                    <LogOut className="h-3.5 w-3.5" /> {t("worldLivePromo.backstageLeave")}
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
                    <video ref={localVideoRef} autoPlay playsInline muted className="aspect-video w-full object-cover" data-testid="world-live-backstage-local" />
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">{t("worldLivePromo.youHost")}</span>
                  </div>
                  {[...remoteStreams.entries()].map(([key, s]) => (
                    <RemoteVideo key={key} stream={s} label={peers.find((p) => p.guestSessionId === key)?.displayName ?? t("worldLivePromo.guestFallbackName")} />
                  ))}
                </div>
                <BackstageChat isLight={isLight} messages={messages} draft={draft} setDraft={setDraft} onSend={() => void handleSend()} sending={sending} testid="world-live-backstage-chat" />
              </div>
            )}
            {!inBackstage && (
              <div className="mt-2">
                <BackstageChat isLight={isLight} messages={messages} draft={draft} setDraft={setDraft} onSend={() => void handleSend()} sending={sending} testid="world-live-backstage-chat" />
              </div>
            )}
          </div>
          {note && <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
        </>
      )}
    </div>
  );
}

/* ═══ #87 Join a stream as a guest ══════════════════════════════════ */

export function LiveGuestJoinDesk({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const [pasted, setPasted] = useState("");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [info, setInfo] = useState<InviteInfoDto | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [session, setSession] = useState<GuestSessionDto | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [peers, setPeers] = useState<BackstagePeer[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [messages, setMessages] = useState<BackstageMessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const clientRef = useRef<BackstageClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const sessionTokenRef = useRef<string | null>(null);

  const joined = session !== null && guestSessionActive(session.state);

  const endWith = useCallback((reason: string) => {
    clientRef.current?.close();
    clientRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    sessionTokenRef.current = null;
    setSessionToken(null);
    setSession(null);
    setEndedReason(reason);
  }, []);

  const startBackstage = useCallback(async (sessToken: string, sess: GuestSessionDto) => {
    sessionTokenRef.current = sessToken;
    setSessionToken(sessToken);
    setSession(sess);
    setEndedReason(null);
    let local: MediaStream | null = null;
    try {
      local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setMediaNote(null);
    } catch {
      setMediaNote(t("worldLivePromo.guestMediaNote"));
    }
    localStreamRef.current = local;
    if (localVideoRef.current && local) localVideoRef.current.srcObject = local;
    const client = new BackstageClient({
      streamId: sess.stream_id,
      guestToken: sessToken,
      events: {
        onPeers: (next) => setPeers(next),
        onChat: (message) => setMessages((ms) => (ms.some((m) => m.id === message.id) ? ms : [...ms, message])),
        onRemoteStream: (_sessionId, peerId, stream) => {
          setRemoteStreams((prev) => new Map(prev).set(peerId, stream));
        },
        onRemoteGone: (_sessionId, peerId) => {
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          });
        },
        onGuestState: (_sessionId, state) => {
          setSession((s) => (s ? { ...s, state } : s));
        },
        onSessionEnded: (reason) => {
          if (inviteToken) {
            try { sessionStorage.removeItem(guestStorageKey(inviteToken)); } catch { /* private mode */ }
          }
          endWith(reason);
        },
        onBackstageClosed: (reason) => endWith(reason),
      },
    });
    clientRef.current = client;
    client.connect(local);
    if (local) client.joinMedia();
    try {
      const data = await guestBackstageHistory(sessToken);
      setMessages(data.messages);
    } catch { /* live frames still land */ }
  }, [endWith, inviteToken]);

  /* Heartbeat — live-guest.tsx's 25-second beat, verbatim purpose:
     keeps the pass warm and learns the end fast. */
  useEffect(() => {
    if (!joined) return;
    const id = setInterval(async () => {
      const tok = sessionTokenRef.current;
      if (!tok) return;
      try {
        const beat = await guestHeartbeat(tok);
        if (beat.stream_status !== "live") endWith(t("worldLivePromo.guestHeartbeatEnded"));
        else setSession((s) => (s ? { ...s, state: beat.state } : s));
      } catch (e) {
        if (e instanceof GuestApiError && (e.status === 401 || e.status === 404)) endWith(e.message);
      }
    }, 25_000);
    return () => clearInterval(id);
  }, [joined, endWith]);

  useEffect(() => () => {
    clientRef.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  async function checkInvite() {
    const tok = extractInviteToken(pasted);
    if (!tok) { setCheckError(t("worldLivePromo.guestPasteError")); return; }
    setChecking(true);
    setCheckError(null);
    setInfo(null);
    setEndedReason(null);
    try {
      const data = await readInvite(tok);
      setInviteToken(tok);
      setInfo(data);
      if (data.stream.status !== "live") {
        setEndedReason(t("worldLivePromo.guestStreamEnded"));
        return;
      }
      /* Resume a stored pass after a refresh, like the guest page. */
      let stored: string | null = null;
      try { stored = sessionStorage.getItem(guestStorageKey(tok)); } catch { /* private mode */ }
      if (stored) {
        try {
          const resumed = await guestSession(stored);
          if (guestSessionActive(resumed.session.state)) {
            await startBackstage(stored, resumed.session);
          }
        } catch { /* a dead stored pass just means joining fresh */ }
      }
    } catch (e) {
      setCheckError(plainErrorText(e, t("worldLivePromo.guestCheckFailed")));
    } finally { setChecking(false); }
  }

  async function handleJoin() {
    if (!inviteToken || !guestNameReady(name)) return;
    setJoining(true);
    setNote(null);
    try {
      const data = await joinAsGuest(inviteToken, name.trim());
      try { sessionStorage.setItem(guestStorageKey(inviteToken), data.session_token); } catch { /* private mode */ }
      await startBackstage(data.session_token, data.session);
    } catch (e) {
      setNote(plainErrorText(e, t("worldLivePromo.guestJoinFailed")));
    } finally { setJoining(false); }
  }

  async function handleLeave() {
    const tok = sessionTokenRef.current;
    if (inviteToken) {
      try { sessionStorage.removeItem(guestStorageKey(inviteToken)); } catch { /* private mode */ }
    }
    if (tok) await guestLeave(tok).catch(() => undefined);
    endWith(t("worldLivePromo.guestLeft"));
  }

  async function handleSend() {
    const tok = sessionTokenRef.current;
    if (!tok || !backstageDraftReady(draft)) return;
    setSending(true);
    try {
      const data = await guestBackstagePost(tok, draft.trim());
      setMessages((ms) => (ms.some((m) => m.id === data.message.id) ? ms : [...ms, data.message]));
      setDraft("");
    } catch (e) {
      setNote(plainErrorText(e, t("worldLivePromo.backstageSendFailed")));
    } finally { setSending(false); }
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  return (
    <div className="space-y-3" data-testid="world-live-guest-join">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <UserPlus className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.guestTitle")}
      </p>
      <p className={`text-sm ${muted}`}>
        {t("worldLivePromo.guestIntro")}
      </p>

      {!joined && (
        <>
          <div className="flex flex-wrap gap-2">
            <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={t("worldLivePromo.guestPastePlaceholder")} className={`${inputCls(isLight)} min-w-56 flex-1`} data-testid="world-live-join-paste" aria-label={t("worldLivePromo.guestPasteAria")} />
            <button type="button" onClick={() => void checkInvite()} disabled={checking || !pasted.trim()} className={goldBtn} data-testid="world-live-join-check">
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} {t("worldLivePromo.guestCheck")}
            </button>
          </div>
          {checkError && <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{checkError}</p>}
          {endedReason && !info && <p className={`text-sm ${muted}`}>{endedReason}</p>}
          {info && !endedReason && (
            <div className="space-y-2" data-testid="world-live-join-info">
              <p className={`text-sm ${strong}`}>
                <b>{info.host.display_name}</b> {t("worldLivePromo.guestInvitedMiddle")} <b>“{info.stream.title}”</b>
                {info.invite.label ? <span className={muted}>{t("worldLivePromo.guestInvitedLabel", { label: info.invite.label })}</span> : null}
              </p>
              <div className="flex flex-wrap gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("worldLivePromo.guestNameField")} maxLength={40} className={`${inputCls(isLight)} min-w-48 flex-1`} data-testid="world-live-join-name" aria-label={t("worldLivePromo.guestNameField")} />
                <button type="button" onClick={() => void handleJoin()} disabled={joining || !guestNameReady(name)} className={goldBtn} data-testid="world-live-join-join">
                  {joining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />} {t("worldLivePromo.backstageEnter")}
                </button>
              </div>
            </div>
          )}
          {info && endedReason && <p className={`text-sm ${muted}`}>{endedReason}</p>}
        </>
      )}

      {joined && session && (
        <div className="space-y-2" data-testid="world-live-guest-room">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase ${session.state === "on_stage" ? "bg-red-500/15 text-red-300" : "bg-white/10 text-white/60"}`}>
              {session.state === "on_stage" ? t("worldLivePromo.guestOnStageBadgeLong") : t("worldLivePromo.guestBackstageBadgeLong")}
            </span>
            <span className={`text-sm ${muted}`}>{peers.length === 1 ? t("worldLivePromo.guestPeersOne", { count: peers.length }) : t("worldLivePromo.guestPeersMany", { count: peers.length })}</span>
            <button type="button" onClick={() => void handleLeave()} className={chipBtn(isLight)} data-testid="world-live-guest-leave">
              <LogOut className="h-3.5 w-3.5" /> {t("worldLivePromo.backstageLeave")}
            </button>
          </div>
          {mediaNote && <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{mediaNote}</p>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
              <video ref={localVideoRef} autoPlay playsInline muted className="aspect-video w-full object-cover" data-testid="world-live-guest-local" />
              <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">{t("worldLivePromo.youGuest")}</span>
            </div>
            {[...remoteStreams.entries()].map(([peerId, s]) => (
              <RemoteVideo key={peerId} stream={s} label={peers.find((p) => p.peerId === peerId)?.displayName ?? t("worldLivePromo.guestBackstageBadge")} />
            ))}
          </div>
          <BackstageChat isLight={isLight} messages={messages} draft={draft} setDraft={setDraft} onSend={() => void handleSend()} sending={sending} testid="world-live-guest-chat" />
        </div>
      )}
      {note && <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
      {sessionToken && !joined && endedReason && <p className={`text-sm ${muted}`}>{endedReason}</p>}
    </div>
  );
}

/* ═══ #88 Stream scheduling / management ══════════════════════════ */

export function LiveScheduleDesk({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const authHeaders = useAuthHeaders();
  const [view, setView] = useState<{ upcoming: ScheduledStreamRow[]; recent: ScheduledStreamRow[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [game, setGame] = useState("");
  const [when, setWhen] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(SCHEDULED_STREAMS_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("streams");
      setView(normalizeScheduledStreams(await res.json()));
      setFailed(false);
    } catch {
      setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  function startEdit(row: ScheduledStreamRow) {
    setEditingId(row.id);
    setTitle(row.title);
    setGame(row.game ?? "");
    setWhen(toLocalInputValue(row.scheduledFor));
    setNote(t("worldLivePromo.schedEditNote"));
  }

  function clearForm() {
    setEditingId(null);
    setTitle("");
    setGame("");
    setWhen("");
  }

  async function handleSave() {
    if (!scheduleDraftReady(title, game)) {
      setNote(t("worldLivePromo.schedTitleNeeded"));
      return;
    }
    setSaving(true);
    setNote(null);
    try {
      const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
      const res = await fetch(SCHEDULED_STREAMS_PATH, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: title.trim(),
          game: game.trim() || undefined,
          scheduled_for: scheduleWhenIso(when),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldLivePromo.schedSaveFailed")));
      if (editingId) {
        const delRes = await fetch(SCHEDULED_STREAM_PATH(editingId), { method: "DELETE", headers: await authHeaders() });
        /* The updated note claims the old plan is cancelled — it
           may only be said when the delete actually landed; when
           it didn't, the note says both plans are on the schedule
           (and the reload below shows exactly that). */
        setNote(delRes.ok ? t("worldLivePromo.schedUpdatedNote") : t("worldLivePromo.schedOldStillThere"));
      } else {
        setNote(t("worldLivePromo.schedCreatedNote"));
      }
      clearForm();
      await load();
    } catch (e) {
      setNote(plainErrorText(e, t("worldLivePromo.schedSaveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(row: ScheduledStreamRow) {
    setCancellingId(row.id);
    setNote(null);
    try {
      const res = await fetch(SCHEDULED_STREAM_PATH(row.id), { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) throw new Error("cancel");
      if (editingId === row.id) clearForm();
      setNote(t("worldLivePromo.streamCancelledNote", { title: row.title }));
      await load();
    } catch {
      setNote(t("worldLivePromo.schedCancelFailed"));
    } finally {
      setCancellingId(null);
    }
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  return (
    <div className="space-y-3" data-testid="world-live-schedule">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <CalendarPlus className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.schedTitle")}
      </p>
      <p className={`text-sm ${muted}`}>{t("worldLivePromo.schedIntro")}</p>
      <div className="grid gap-2 md:grid-cols-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("worldLivePromo.streamTitleField")} maxLength={200} className={inputCls(isLight)} data-testid="world-live-sched-title" aria-label={t("worldLivePromo.streamTitleField")} />
        <input value={game} onChange={(e) => setGame(e.target.value)} placeholder={t("worldLivePromo.schedGamePlaceholder")} maxLength={100} className={inputCls(isLight)} data-testid="world-live-sched-game" aria-label={t("worldLivePromo.schedGameAria")} />
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={inputCls(isLight)} data-testid="world-live-sched-when" aria-label={t("worldLivePromo.schedWhenAria")} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void handleSave()} disabled={saving || !scheduleDraftReady(title, game)} className={goldBtn} data-testid="world-live-sched-save">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
          {editingId ? t("worldLivePromo.schedSaveEdit") : t("worldLivePromo.schedSaveNew")}
        </button>
        {editingId && (
          <button type="button" onClick={clearForm} className={chipBtn(isLight)} data-testid="world-live-sched-edit-cancel">
            <X className="h-3.5 w-3.5" /> {t("worldLivePromo.schedStopEditing")}
          </button>
        )}
      </div>
      {note && <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-live-sched-note">{note}</p>}

      {failed ? (
        <p className={`text-sm ${muted}`}>{t("worldLivePromo.schedLoadFailed")} <button type="button" className="font-bold underline" onClick={() => void load()}>{t("worldLivePromo.tryAgain")}</button></p>
      ) : view === null ? (
        <NativeLoadingState isLight={isLight} message={t("worldLivePromo.schedLoading")} />
      ) : (
        <>
          <p className={`text-xs font-black uppercase tracking-wider ${muted}`}>{t("worldLivePromo.schedUpcoming")}</p>
          {view.upcoming.length === 0 ? (
            <p className={`text-sm ${muted}`}>{t("worldLivePromo.schedEmpty")}</p>
          ) : (
            <ul className="space-y-1.5">
              {view.upcoming.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="world-live-sched-row">
                  <span className={strong}>{s.title}</span>
                  <span className={muted}>
                    {s.scheduledFor ? new Date(s.scheduledFor).toLocaleString(i18n.language) : t("worldLivePromo.schedNoDate")}
                    {s.game ? ` · ${s.game}` : ""}
                  </span>
                  <button type="button" className={chipBtn(isLight)} onClick={() => startEdit(s)} data-testid="world-live-sched-edit">
                    <Pencil className="h-3.5 w-3.5" /> {t("worldLivePromo.schedEdit")}
                  </button>
                  <button type="button" className={chipBtn(isLight)} disabled={cancellingId === s.id} onClick={() => void handleCancel(s)} data-testid="world-live-sched-cancel">
                    {cancellingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} {t("worldLivePromo.schedCancel")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {view.recent.length > 0 && (
            <>
              <p className={`text-xs font-black uppercase tracking-wider ${muted}`}>{t("worldLivePromo.schedRecent")}</p>
              <ul className="space-y-1.5">
                {view.recent.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="world-live-sched-recent-row">
                    <span className={strong}>{s.title}</span>
                    <span className={muted}>
                      {s.endedAt ? new Date(s.endedAt).toLocaleDateString(i18n.language) : ""}
                      {s.game ? ` · ${s.game}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ═══ #89 Stream Controller deck ════════════════════════════════════ */

export function LiveControllerDesk({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [, setTick] = useState(0);
  const clientRef = useRef<ControllerRemoteClient | null>(null);

  useEffect(() => {
    if (!user) return;
    const client = new ControllerRemoteClient(
      {
        getAccessToken,
        socketUrl: controllerSocketUrl(window.location, "remote"),
        openSocket: (url) => new WebSocket(url) as unknown as ControllerSocketLike,
      },
      () => setTick((n) => n + 1),
    );
    clientRef.current = client;
    void client.start();
    /* Sweep expired ack beats even when the studio goes quiet —
       the phone remote's own rhythm. Item 98 / D-89c justification:
       this 1s interval is NOT status polling — the deck's state
       arrives over the controller SOCKET (presence + state.sync
       frames, ControllerRemoteClient) and nothing here fetches on
       a timer. The sweeper only expires LOCAL pending-ack beats so
       a press the studio never confirmed stops showing as pending;
       it makes no network call and fabricates no liveness. */
    const sweeper = window.setInterval(() => client.sweepPending(), 1000);
    return () => {
      window.clearInterval(sweeper);
      client.stop();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const client = clientRef.current;
  const state = client?.state ?? null;
  const stageConnected = !!client?.presence.stageConnected;
  const socketUp = !!client?.socketUp;

  /* #95 per-source chroma drafts: the desk edits a local copy of a
     source's mode + settings and sends on commit (pointer/key
     release, blur, pill press) — a slider dragged through twenty
     values must not queue twenty relay presses that supersede each
     other into false "didn't go through" notices. A draft retires
     when the studio's confirmed state already matches it, so after
     a press lands it is the publish doing the showing. */
  const [chromaDrafts, setChromaDrafts] = useState<
    Record<string, { cameraMode: "kit" | "chroma"; chroma: ChromaSettings }>
  >({});
  useEffect(() => {
    const sources = state?.cameraSources;
    if (!sources) return;
    setChromaDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const source of sources) {
        const draft = next[source.sourceId];
        if (!draft) continue;
        const settings = chromaSettingsFor(source);
        if (
          draft.cameraMode === source.cameraMode &&
          draft.chroma.color === settings.color &&
          draft.chroma.similarity === settings.similarity &&
          draft.chroma.smoothness === settings.smoothness
        ) {
          delete next[source.sourceId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [state]);
  const chromaShown = (source: ControllerCameraSource) =>
    chromaDrafts[source.sourceId] ?? { cameraMode: source.cameraMode, chroma: chromaSettingsFor(source) };
  const sendChroma = (
    source: ControllerCameraSource,
    next: { cameraMode: "kit" | "chroma"; chroma: ChromaSettings },
  ) => {
    const update: ChromaUpdate = {
      sceneId: source.sceneId,
      sourceId: source.sourceId,
      cameraMode: next.cameraMode,
      chroma: next.cameraMode === "chroma" ? next.chroma : null,
    };
    if (!isChromaUpdateReady(update)) return;
    setChromaDrafts((prev) => ({ ...prev, [source.sourceId]: next }));
    void client?.send(SOURCE_CHROMA_UPDATE_COMMAND, chromaUpdateArgs(update));
  };
  const editChroma = (source: ControllerCameraSource, chroma: ChromaSettings) => {
    setChromaDrafts((prev) => ({ ...prev, [source.sourceId]: { cameraMode: "chroma", chroma } }));
  };
  const commitChroma = (source: ControllerCameraSource) => {
    const draft = chromaDrafts[source.sourceId];
    if (draft) sendChroma(source, draft);
  };
  const view = {
    started: !!client,
    socketUp,
    stageConnected,
    live: !!state?.live,
    label: state?.label ?? null,
  };
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const ctrlStrings = liveControllerStrings(t);

  return (
    <div className="space-y-3" data-testid="world-live-controller">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
          <Gamepad2 className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.ctrlTitle")}
        </span>
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${muted}`} role="status">
          <span className={`inline-block h-2 w-2 rounded-full ${stageConnected && socketUp ? (state?.live ? "animate-pulse bg-red-500" : "bg-emerald-500") : "bg-white/30"}`} />
          {controllerStatusLine(view, ctrlStrings)}
        </span>
      </div>
      <p className={`text-sm ${muted}`}>
        {t("worldLivePromo.ctrlIntro", { path: CONTROLLER_WS_PATH })}
      </p>
      <div className={`rounded-2xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-[#14100a]" : "border-white/10 bg-[#14100a]"}`}>
        <StreamDeck
          state={state}
          canControl={stageConnected && socketUp}
          unavailableNote={controllerUnavailableNote(view, ctrlStrings)}
          isPending={(cmd, sceneId) => client?.isPending(cmd, sceneId) ?? false}
          notice={client?.notice ?? null}
          onCommand={(cmd, args) => { client?.send(cmd, args); }}
        />
        {/* ── #94 Scene presets — the registry, relayed ──────────────
            The picker IS the stream-kit registry (the seam's
            SCENE_PRESET_OPTIONS — the array ScenesPanel renders).
            There is no Stage in the World: a pick sends
            scene.preset.apply over the same relay and the running
            studio's stage applies it through applyScenePreset, the
            panel's own path — the built scene lands in the studio's
            Preview, Program untouched, and the deck learns it from
            the studio's confirmed state like every other button.
            The panel below rides the deck box's dark-lock styling. */}
        <div className="mt-4 border-t border-white/10 pt-3" data-testid="world-live-scene-presets">
          <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-[#fbbf24]/80">
            <LayoutTemplate className="h-3.5 w-3.5" /> {t("worldDeskRemainder.liveSceneHeading")}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {SCENE_PRESET_OPTIONS.map((preset) => {
              const isP = client?.isPending(SCENE_PRESET_APPLY_COMMAND, preset.id) ?? false;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={!(stageConnected && socketUp) || !state}
                  onClick={() => { client?.send(SCENE_PRESET_APPLY_COMMAND, scenePresetApplyArgs(preset.id)); }}
                  data-testid={`world-live-preset-${preset.id}`}
                  className={`relative rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                    !(stageConnected && socketUp) || !state
                      ? "cursor-not-allowed border-white/10 bg-white/[0.04] opacity-40"
                      : "border-white/10 bg-white/[0.04] hover:border-[#C9A84C]/70 hover:bg-[#C9A84C]/10"
                  }`}
                >
                  <span className="block pr-5 text-sm font-bold leading-tight text-white/90">{preset.name}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-white/50">{preset.blurb}</span>
                  <span className="mt-1 block text-[10px] font-black uppercase tracking-widest text-white/40">
                    {isP ? t("worldDeskRemainder.liveSceneSending") : t("worldDeskRemainder.liveSceneAdds")}
                  </span>
                  {isP && <Loader2 className="absolute right-2.5 top-2.5 h-3.5 w-3.5 animate-spin text-white/70" />}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-white/50">{t("worldDeskRemainder.liveScenePickerNote")}</p>
        </div>
        {/* #95 — per-source chroma key: the running studio's
            Preview-scene camera sources with SourcesPanel's mode
            pills, key color and tuning sliders, over the relay.
            The studio executes Stage.updateSource (the panel's own
            write); the deck confirms on the exact signature in its
            published state — nothing optimistic, no keyer here. */}
        <div className="mt-4 border-t border-white/10 pt-3" data-testid="world-live-source-chroma">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
            <Wand2 className="h-3.5 w-3.5" /> {t("worldDeskRemainder.liveChromaHeading")}
          </div>
          {state?.cameraSources === undefined ? (
            <p className="mt-2 text-xs leading-relaxed text-white/60" data-testid="world-live-chroma-unavailable">
              {state
                ? t("worldDeskRemainder.liveChromaUnavailable")
                : t("worldDeskRemainder.liveChromaWaiting")}
            </p>
          ) : state.cameraSources.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-white/60" data-testid="world-live-chroma-empty">
              {t("worldDeskRemainder.liveChromaEmpty")}
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {state.cameraSources.map((source) => {
                const shown = chromaShown(source);
                const sending = client?.isPending(SOURCE_CHROMA_UPDATE_COMMAND, source.sourceId) ?? false;
                return (
                  <div key={source.sourceId} data-testid={`world-live-chroma-${source.sourceId}`}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/85">{source.name}</span>
                      {sending ? (
                        <span className="flex items-center gap-1 text-[11px] text-white/50">
                          <Loader2 className="h-3 w-3 animate-spin" /> {t("worldDeskRemainder.liveSceneSending")}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-1">
                      {CAMERA_MODE_OPTIONS.map((option) => (
                        <button
                          key={option.mode}
                          type="button"
                          disabled={!stageConnected || !socketUp || sending}
                          onClick={() => sendChroma(source, { cameraMode: option.mode, chroma: shown.chroma })}
                          className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition disabled:opacity-40 ${
                            shown.cameraMode === option.mode
                              ? "bg-[#d4af37] text-black"
                              : "bg-white/10 text-white/80 hover:bg-white/15"
                          }`}
                          data-testid={`world-live-chroma-mode-${option.mode}-${source.sourceId}`}
                        >
                          {option.mode === "kit" ? t("worldDeskRemainder.liveModeBackdrop") : t("worldDeskRemainder.liveModeGreen")}
                        </button>
                      ))}
                    </div>
                    {shown.cameraMode === "chroma" ? (
                      <div className="mt-2 space-y-2">
                        <label className="flex items-center justify-between gap-2 text-[11px] text-white/60">
                          {t("worldDeskRemainder.liveChromaKeyColor")}
                          <input
                            type="color"
                            value={shown.chroma.color.toLowerCase()}
                            disabled={!stageConnected || !socketUp}
                            onChange={(e) => editChroma(source, { ...shown.chroma, color: e.target.value })}
                            onBlur={() => commitChroma(source)}
                            className="h-6 w-10 cursor-pointer rounded bg-transparent disabled:opacity-40"
                            data-testid={`world-live-chroma-color-${source.sourceId}`}
                          />
                        </label>
                        {CHROMA_SLIDERS.map((slider) => (
                          <label key={slider.key} className="block text-[11px] text-white/60">
                            <span className="flex items-center justify-between">
                              <span>{slider.key === "similarity" ? t("worldDeskRemainder.liveChromaSimilarity") : t("worldDeskRemainder.liveChromaSmoothness")}</span>
                              <span>{Math.round(shown.chroma[slider.key] * 100)}</span>
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={slider.max}
                              value={Math.round(shown.chroma[slider.key] * 100)}
                              disabled={!stageConnected || !socketUp}
                              onChange={(e) =>
                                editChroma(source, chromaWithSlider(shown.chroma, slider.key, Number(e.target.value) / 100))
                              }
                              onPointerUp={() => commitChroma(source)}
                              onKeyUp={() => commitChroma(source)}
                              onBlur={() => commitChroma(source)}
                              className="w-full accent-amber-400 disabled:opacity-40"
                              data-testid={`world-live-chroma-${slider.key}-${source.sourceId}`}
                            />
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-white/45">{t("worldDeskRemainder.liveChromaNote")}</p>
        </div>
      </div>
    </div>
  );
}

/* ═══ #90 Live-watch parity — the audience side of the hall ═════════ */

export function LiveWatchDesk({ isLight, screen }: { isLight: boolean; screen: { mode: string; streamId: string | null } | null }) {
  const { t } = useTranslation();
  const streamId = watchStreamIdFromScreen(screen);
  const [stream, setStream] = useState<WatchStreamView | null>(null);
  const [failed, setFailed] = useState(false);
  const [onStage, setOnStage] = useState<string[]>([]);
  const sessionRef = useRef<string>("");
  if (!sessionRef.current) {
    sessionRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `viewer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const load = useCallback(async () => {
    if (!streamId) return;
    try {
      const res = await fetch(LIVE_STREAM_PATH(streamId));
      if (!res.ok) throw new Error("watch");
      setStream(normalizeWatchStream(await res.json(), t("worldLivePromo.liveStreamFallback"), t("worldLivePromo.creatorFallback")));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [streamId]);

  useEffect(() => {
    setStream(null);
    setFailed(false);
    void load();
  }, [load]);

  const isLive = stream?.status === "live";

  /* live-watch.tsx's presence beat: while the stream is live, this
     viewer counts — a POST every 15s, plus a 15s status poll so the
     desk learns the moment the show ends. */
  useEffect(() => {
    if (!isLive || !streamId) return;
    const beat = async () => {
      try {
        await fetch(WATCH_HEARTBEAT_PATH(streamId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(watchHeartbeatBody(sessionRef.current)),
        });
      } catch { /* presence is best-effort */ }
    };
    void beat();
    const beatTimer = setInterval(beat, 15_000);
    const pollTimer = setInterval(() => void load(), 15_000);
    return () => {
      clearInterval(beatTimer);
      clearInterval(pollTimer);
    };
  }, [isLive, streamId, load]);

  /* The public on-stage roster — the audience only ever sees who is
     ON stage; backstage stays invisible, here as on the watch page. */
  useEffect(() => {
    if (!streamId) { setOnStage([]); return; }
    let cancelled = false;
    const loadGuests = async () => {
      try {
        const data = await publicOnStageGuests(streamId);
        if (!cancelled) setOnStage(data.on_stage.map((g) => g.display_name));
      } catch { /* best-effort chips */ }
    };
    void loadGuests();
    const id = setInterval(loadGuests, 20_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [streamId]);

  const followStates = useFollowStates(stream?.creator ? [stream.creator.id] : []);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  if (!streamId) {
    return (
      <div className="space-y-2" data-testid="world-live-watch">
        <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
          <Users className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.watchTitle")}
        </p>
        <NativeEmptyState
          isLight={isLight}
          message={t("worldLivePromo.watchEmpty")}
          detail={t("worldLivePromo.watchEmptyDetail")}
        />
      </div>
    );
  }

  const creator = stream?.creator ?? null;

  return (
    <div className="space-y-3" data-testid="world-live-watch">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
          <Users className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.watchWatching", { title: stream?.title ?? t("worldLivePromo.watchDefaultTitle") })}
        </span>
        {isLive && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> {t("worldLivePromo.liveWatchingBadge", { count: stream?.viewerCount ?? 0 })}
          </span>
        )}
      </div>
      {failed ? (
        <p className={`text-sm ${muted}`}>{t("worldLivePromo.watchLoadFailed")} <button type="button" className="font-bold underline" onClick={() => void load()}>{t("worldLivePromo.tryAgain")}</button></p>
      ) : stream && !isLive ? (
        <p className={`text-sm ${muted}`}>{t("worldLivePromo.watchEnded")}</p>
      ) : null}

      {creator && (
        <div className="flex flex-wrap items-center gap-3" data-testid="world-live-watch-creator">
          {creator.avatarUrl ? (
            <img src={creator.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#e8c86a]/20 text-lg font-bold text-[#e8c86a]">
              {creator.displayName[0] ?? "?"}
            </span>
          )}
          <span className="min-w-0">
            <span className={`block font-bold ${strong}`}>{creator.displayName}</span>
            <span className={`block text-xs ${muted}`}>{t("worldLivePromo.watchStreamerCaption")}</span>
          </span>
          <FollowButton profileId={creator.id} initialFollowing={followStates[creator.id]} />
          <PushAlertsToggle />
        </div>
      )}

      {onStage.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="world-live-watch-onstage">
          <span className={`text-xs font-bold uppercase tracking-wider ${muted}`}>{t("worldLivePromo.watchOnStage")}</span>
          {onStage.map((name) => (
            <span key={name} className="inline-flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
              {t("worldLivePromo.watchGuestChip", { name })}
            </span>
          ))}
        </div>
      )}

      {/* Song Requests (stack100 item 17): the watch page's fan
          panel, in-world — the up-front rules, the live queue and
          the tipped request form, on the same queue rails the
          creator's desk below runs. Defined under the Song
          Requests section further down this file. */}
      <LiveSongRequestPanel isLight={isLight} streamId={streamId} isLive={isLive} />

      {/* The dedicated stream chat — the watch page's own panel, so
          its rules (sign-in, slow mode, mutes, moderation) are the
          site's, enforced by the same server rails. */}
      <LiveChatPanel streamId={streamId} className="h-[380px]" />
    </div>
  );
}

/* ── Song Requests (stack100 wave 3, item 17) ─────────────────────
   The 2D Song Requests surfaces (components/live/SongRequests.tsx),
   in-world on their exact rails — one queue, two faces:
   - LiveSongRequestPanel: the fan face, docked into the watch desk
     above (the stream on the big screen), mirroring the panel the
     live-watch page docks. Rules and the refund deal print UP
     FRONT, before anyone tips — the words are built only from
     what the server sent (lib/song-requests' upfrontRuleLines).
   - LiveSongRequestsDesk: the creator face, docked in the panel
     under LiveDesksPanel — rules are set here BEFORE the stream
     (persisted per creator on the rules rail), and while live
     the same desk runs the queue (play-next / skip / close).
   A request placed on either face is the same row on the same
   rail: the desk and the 2D surfaces read and move one queue. */

/** Consecutive queue-load failures before a World face says the
 *  queue couldn't load (C-30): silent for a blip, honest for an
 *  outage — a down endpoint must never dress up as an empty queue. */
const SONG_REQUEST_QUEUE_FAILURE_LIMIT = 3;

/** The queue rows both faces render — the 2D QueueList's rows,
 *  word for word: title, requester, the tip, the honest status
 *  label (refunds stated), and — on the creator face only — the
 *  skip door for queued rows. */
function SongRequestQueueRows({
  isLight, queue, myUserId, onSkip, skippingId,
}: {
  isLight: boolean;
  queue: SongRequestDto[];
  myUserId?: string | null;
  onSkip?: (r: SongRequestDto) => void;
  skippingId?: string | null;
}) {
  const { t } = useTranslation();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  if (queue.length === 0) {
    return <p className={`text-sm ${muted}`}>{t("worldDeskRemainder.liveSrQueueEmpty")}</p>;
  }
  return (
    <ol className="space-y-2" data-testid="world-live-songreq-queue">
      {queue.map((r) => {
        const mine = !!myUserId && r.fanUserId === myUserId;
        return (
          <li
            key={r.id}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
              r.status === "playing"
                ? isLight
                  ? "border-[#C9A84C]/60 bg-[#C9A84C]/15"
                  : "border-[#C9A84C]/50 bg-[#C9A84C]/10"
                : isLight
                  ? "border-[#C9A84C]/25 bg-white/40"
                  : "border-white/10 bg-black/30"
            }`}
            data-testid="world-live-songreq-row"
          >
            <Music2 className={`h-4 w-4 shrink-0 ${r.status === "playing" ? "text-[#b8912c]" : "opacity-40"}`} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm font-bold ${strong}`}>
                {r.songTitle}
                {mine && <span className="ml-2 text-xs font-black uppercase tracking-wider text-[#b8912c]">{t("worldDeskRemainder.liveSrYours")}</span>}
              </span>
              <span className={`block text-xs ${muted}`}>
                {t("worldDeskRemainder.liveSrRequestedBy", { name: r.fan.displayName, amount: formatBucs(r.amountVb) })}
              </span>
            </span>
            <span className={`shrink-0 text-xs font-bold ${r.status === "playing" ? "text-[#b8912c]" : muted}`}>
              {requestStatusLabel(r, { playing: t("worldDeskRemainder.liveSrStatusPlaying"), inLinePosition: t("worldDeskRemainder.liveSrStatusInLinePosition"), inLine: t("worldDeskRemainder.liveSrStatusInLine"), played: t("worldDeskRemainder.liveSrStatusPlayed"), skippedRefunded: t("worldDeskRemainder.liveSrStatusSkippedRefunded"), skipped: t("worldDeskRemainder.liveSrStatusSkipped"), endedRefunded: t("worldDeskRemainder.liveSrStatusEndedRefunded"), ended: t("worldDeskRemainder.liveSrStatusEnded") })}
            </span>
            {onSkip && r.status === "queued" && (
              <button
                type="button"
                onClick={() => onSkip(r)}
                disabled={skippingId === r.id}
                className={chipBtn(isLight)}
                data-testid="world-live-songreq-skip"
              >
                {skippingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                {t("worldDeskRemainder.liveSrSkipRefund")}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ── The fan face (the watch desk's request panel) ───────────────── */

export function LiveSongRequestPanel({ isLight, streamId, isLive }: { isLight: boolean; streamId: string; isLive: boolean }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const authHeaders = useAuthHeaders();
  const [view, setView] = useState<SongRequestQueueView | null>(null);
  const [songId, setSongId] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intentKeyRef = useRef("");
  /* The queue load's failure count (C-30, twin of the 2D panel's):
     silent for a blip, honest for an outage — after
     SONG_REQUEST_QUEUE_FAILURE_LIMIT consecutive failures the panel
     says the queue couldn't load instead of rendering nothing (or a
     stale queue) forever. Any success resets it. */
  const [queueLoadFailures, setQueueLoadFailures] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(SONG_REQUESTS_PATH(streamId));
      if (!res.ok) throw new Error("queue load");
      setView(normalizeSongRequestQueuePayload(await res.json()));
      setQueueLoadFailures(0);
    } catch {
      setQueueLoadFailures((n) => n + 1);
    }
  }, [streamId]);

  useEffect(() => {
    void load();
    if (!isLive) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load, isLive]);

  /* Sustained queue-load failure with nothing ever loaded: the panel
     says the queue couldn't load (still retrying on the poll) instead
     of rendering nothing at all. */
  if (!view && queueLoadFailures >= SONG_REQUEST_QUEUE_FAILURE_LIMIT) {
    return (
      <div className="space-y-2" data-testid="world-live-songreq-panel">
        <p className={`inline-flex items-center gap-2 text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
          <ListMusic className="h-4 w-4 text-[#d4af37]" /> {t("worldDeskRemainder.liveSrPanelHeading")}
        </p>
        <p className="text-xs font-semibold text-red-400" role="alert">
          {t("worldDeskRemainder.liveSrQueueLoadFailed")}
        </p>
      </div>
    );
  }

  if (!view) return null;

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const heading = (
    <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
      <ListMusic className="h-4 w-4 text-[#d4af37]" /> {t("worldDeskRemainder.liveSrPanelHeading")}
    </p>
  );

  /* A sustained outage with a stale queue on screen: the rows below
     may be out of date — say so instead of letting them pose as the
     live queue. */
  const queueStaleNote = queueLoadFailures >= SONG_REQUEST_QUEUE_FAILURE_LIMIT ? (
    <p className="text-xs font-semibold text-red-400" role="alert">
      {t("worldDeskRemainder.liveSrQueueStale")}
    </p>
  ) : null;

  if (!view.available) {
    return (
      <div className="space-y-2" data-testid="world-live-songreq-panel">
        {heading}
        <p className={`text-sm ${muted}`}>{t("worldDeskRemainder.liveSrDeskOff")}</p>
      </div>
    );
  }

  const requestable = songRequestRequestableSongs(view);
  const amountReady = songRequestTipReady(amount, view.rules, view.tipBounds);
  const canSubmit = isLive && view.rules.requestsOpen && !!songId && amountReady && !submitting;

  async function submit() {
    if (!user || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    setNote(null);
    try {
      if (!intentKeyRef.current) {
        intentKeyRef.current =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `song-request-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
      const res = await fetch(SONG_REQUESTS_PATH(streamId), {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(songRequestSubmitBody(songId, Number(amount), intentKeyRef.current)),
      });
      const d = (await res.json().catch(() => null)) as { error?: string; request?: SongRequestDto } | null;
      if (!res.ok) {
        setError(apiErrorMessage(d, t("worldDeskRemainder.liveSrRequestFailed")));
        return;
      }
      intentKeyRef.current = "";
      setNote(
        d?.request?.position
          ? t("worldDeskRemainder.liveSrInLineNote", { position: d.request.position, title: d.request.songTitle })
          : t("worldDeskRemainder.liveSrQueuedNote"),
      );
      setAmount("");
      await load();
    } catch {
      setError(t("worldDeskRemainder.liveSrRequestFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="world-live-songreq-panel">
      {heading}

      {/* The rules + the refund deal, up front — before anyone tips. */}
      <div
        className={`rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${
          isLight ? "border-[#C9A84C]/30 bg-white/50" : "border-white/10 bg-black/30"
        }`}
        data-testid="world-live-songreq-rules-upfront"
      >
        {view.rules.requestsOpen ? (
          <>
            {view.tipBounds && upfrontRuleLines(view.rules, view.tipBounds, { catalogOnly: t("worldDeskRemainder.liveSrRuleCatalogOnly"), anySong: t("worldDeskRemainder.liveSrRuleAnySong"), minTip: t("worldDeskRemainder.liveSrRuleMinTip"), tipsRun: t("worldDeskRemainder.liveSrRuleTipsRun"), notRequestable: t("worldDeskRemainder.liveSrRuleNotRequestable") }).map((line) => <p key={line}>{line}</p>)}
            {view.refundCopy && <p className="mt-1 font-semibold">{view.refundCopy}</p>}
          </>
        ) : (
          <p>{t("worldDeskRemainder.liveSrClosedLine")}</p>
        )}
      </div>

      {queueStaleNote}

      <SongRequestQueueRows isLight={isLight} queue={view.queue} myUserId={user?.id ?? null} />

      {isLive && view.rules.requestsOpen && (
        <div data-testid="world-live-songreq-form">
          {view.catalog.length === 0 ? (
            <p className={`text-sm ${muted}`}>
              {t("worldDeskRemainder.liveSrCatalogEmpty")}
            </p>
          ) : requestable.length === 0 ? (
            <p className={`text-sm ${muted}`}>{t("worldDeskRemainder.liveSrCatalogAllOut")}</p>
          ) : !user ? (
            <p className={`text-sm ${muted}`}>{t("worldDeskRemainder.liveSrSignedIn")}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[180px] flex-1">
                <span className={`mb-1 block text-xs font-bold uppercase tracking-wider ${muted}`}>{t("worldDeskRemainder.liveSrSongLabel")}</span>
                <select
                  value={songId}
                  onChange={(e) => setSongId(e.target.value)}
                  className={`${selectCls(isLight)} w-full`}
                  data-testid="world-live-songreq-song"
                  aria-label={t("worldDeskRemainder.liveSrAriaSong")}
                >
                  <option value="">{t("worldDeskRemainder.liveSrPickSong")}</option>
                  {view.catalog.map((s) => (
                    <option key={s.id} value={s.id} disabled={s.excluded}>
                      {s.title}
                      {s.excluded ? t("worldDeskRemainder.liveSrNotRequestableSuffix") : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="w-32">
                <span className={`mb-1 block text-xs font-bold uppercase tracking-wider ${muted}`}>{t("worldDeskRemainder.liveSrTipLabel")}</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder={
                    view.rules.minTipVb !== null
                      ? t("worldDeskRemainder.liveSrTipPlaceholderMin", { min: view.rules.minTipVb.toLocaleString(i18n.language) })
                      : view.tipBounds
                        ? t("worldDeskRemainder.liveSrTipPlaceholderFrom", { min: view.tipBounds.minVb.toLocaleString(i18n.language) })
                        : t("worldDeskRemainder.liveSrTipPlaceholder")
                  }
                  className={inputCls(isLight)}
                  data-testid="world-live-songreq-amount"
                  aria-label={t("worldDeskRemainder.liveSrAriaTip")}
                />
              </label>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
                className={goldBtn}
                data-testid="world-live-songreq-submit"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleDollarSign className="h-3.5 w-3.5" />}
                {t("worldDeskRemainder.liveSrRequestIt")}
              </button>
            </div>
          )}
          {note && (
            <p className="mt-2 text-xs font-semibold text-emerald-500" role="status" data-testid="world-live-songreq-panel-note">
              {note}
            </p>
          )}
          {error && (
            <p className="mt-2 text-xs font-semibold text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── The creator face (the queue desk) ───────────────────────────── */

export function LiveSongRequestsDesk({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const authHeaders = useAuthHeaders();
  const [view, setView] = useState<SongRequestRulesView | null>(null);
  const [failed, setFailed] = useState(false);
  const [queueView, setQueueView] = useState<SongRequestQueueView | null>(null);
  const [open, setOpen] = useState(true);
  const [catalogOnly, setCatalogOnly] = useState(true);
  const [minTip, setMinTip] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [deskError, setDeskError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [skippingId, setSkippingId] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    try {
      const res = await fetch(SONG_REQUEST_RULES_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("rules");
      const v = normalizeSongRequestRulesPayload(await res.json());
      setView(v);
      setOpen(v.rules.requestsOpen);
      setCatalogOnly(v.rules.catalogOnly);
      setMinTip(v.rules.minTipVb !== null ? String(v.rules.minTipVb) : "");
      setExcluded(v.rules.excludedSongIds);
      setFailed(false);
    } catch {
      setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadRules(); }, [loadRules]);

  const liveStreamId = view?.liveStreamId ?? null;
  /* The live queue's failure count (C-30, same rule as the fan
     faces): silent for a blip, honest for an outage — after
     SONG_REQUEST_QUEUE_FAILURE_LIMIT consecutive failures the desk
     says the queue couldn't load instead of showing "No requests
     yet" (or a stale queue) while the endpoint is down. */
  const [queueLoadFailures, setQueueLoadFailures] = useState(0);
  const loadQueue = useCallback(async () => {
    if (!liveStreamId) return;
    try {
      const res = await fetch(SONG_REQUESTS_PATH(liveStreamId));
      if (!res.ok) throw new Error("queue load");
      setQueueView(normalizeSongRequestQueuePayload(await res.json()));
      setQueueLoadFailures(0);
    } catch {
      setQueueLoadFailures((n) => n + 1);
    }
  }, [liveStreamId]);

  useEffect(() => {
    void loadQueue();
    if (!liveStreamId) return;
    const t = setInterval(loadQueue, 8_000);
    return () => clearInterval(t);
  }, [loadQueue, liveStreamId]);

  async function saveRules() {
    if (!songRequestMinTipReady(minTip, view?.tipBounds ?? null)) {
      setDeskError(t("worldDeskRemainder.liveSrMinTipRangeError"));
      return;
    }
    setSaving(true);
    setSavedNote(null);
    setDeskError(null);
    try {
      const res = await fetch(SONG_REQUEST_RULES_PATH, {
        method: "PUT",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(songRequestRulesBody({
          requestsOpen: open,
          catalogOnly,
          excludedSongIds: excluded,
          minTipVb: songRequestMinTipValue(minTip),
        })),
      });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setDeskError(apiErrorMessage(d, t("worldDeskRemainder.liveSrSaveFailed")));
        return;
      }
      setSavedNote(t("worldDeskRemainder.liveSrRulesSaved"));
      await loadRules();
    } catch {
      setDeskError(t("worldDeskRemainder.liveSrSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function queueAction(path: string, key: string) {
    if (!liveStreamId) return;
    setBusy(key);
    setDeskError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) setDeskError(apiErrorMessage(d, t("worldDeskRemainder.liveSrQueueActionFailed")));
      await loadQueue();
    } catch {
      setDeskError(t("worldDeskRemainder.liveSrQueueActionFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function skip(r: SongRequestDto) {
    if (!liveStreamId) return;
    setSkippingId(r.id);
    try {
      const res = await fetch(SONG_REQUEST_SKIP_PATH(liveStreamId, r.id), {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) setDeskError(apiErrorMessage(d, t("worldDeskRemainder.liveSrSkipFailed")));
      await loadQueue();
    } catch {
      setDeskError(t("worldDeskRemainder.liveSrSkipFailed"));
    } finally {
      setSkippingId(null);
    }
  }

  const toggleExcluded = (id: string) =>
    setExcluded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  return (
    <div className="space-y-3" data-testid="world-live-song-requests">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <ListMusic className="h-4 w-4 text-[#d4af37]" /> {t("worldDeskRemainder.liveSrDeskHeading")}
      </p>
      <p className={`text-sm ${muted}`}>
        {t("worldDeskRemainder.liveSrDeskIntro")}{" "}
        {view?.refundCopy}
      </p>

      {failed ? (
        <p className={`text-sm ${muted}`}>
          {t("worldDeskRemainder.liveSrRulesLoadFailed")}{" "}
          <button type="button" className="font-bold underline" onClick={() => void loadRules()}>
            {t("worldDeskRemainder.liveSrTryAgain")}
          </button>
        </p>
      ) : view === null ? (
        <NativeLoadingState isLight={isLight} message={t("worldDeskRemainder.liveSrLoadingRules")} />
      ) : (
        <>
          {!view.available && (
            <p className={`text-sm font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
              {t("worldDeskRemainder.liveSrDeskOffLong")}
            </p>
          )}

          {/* Rules — set before the stream, editable between streams. */}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2.5 text-sm font-semibold select-none">
              <input
                type="checkbox"
                checked={open}
                onChange={(e) => setOpen(e.target.checked)}
                className="h-4 w-4 accent-[#d4af37]"
                data-testid="world-live-songreq-rules-open"
                aria-label={t("worldDeskRemainder.liveSrRequestsOpenLabel")}
              />
              {t("worldDeskRemainder.liveSrRequestsOpenLabel")}
            </label>
            <label className="flex items-center gap-2.5 text-sm font-semibold select-none">
              <input
                type="checkbox"
                checked={catalogOnly}
                onChange={(e) => setCatalogOnly(e.target.checked)}
                className="h-4 w-4 accent-[#d4af37]"
                data-testid="world-live-songreq-rules-catalog-only"
                aria-label={t("worldDeskRemainder.liveSrCatalogOnlyLabel")}
              />
              {t("worldDeskRemainder.liveSrCatalogOnlyLabel")}
            </label>
            <label className="block">
              <span className={`mb-1 block text-xs font-bold uppercase tracking-wider ${muted}`}>
                {t("worldDeskRemainder.liveSrMinTipLabel")}
              </span>
              <input
                value={minTip}
                onChange={(e) => setMinTip(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                placeholder={t("worldDeskRemainder.liveSrMinTipPlaceholder")}
                className={inputCls(isLight)}
                data-testid="world-live-songreq-rules-min-tip"
                aria-label={t("worldDeskRemainder.liveSrMinTipAria")}
              />
            </label>
          </div>

          {view.catalog.length > 0 ? (
            <fieldset>
              <legend className={`text-xs font-bold uppercase tracking-wider ${muted}`}>{t("worldDeskRemainder.liveSrExcludeLegend")}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {view.catalog.map((s) => (
                  <label
                    key={s.id}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold select-none ${
                      excluded.includes(s.id)
                        ? isLight
                          ? "border-red-400/50 bg-red-500/10 text-red-700"
                          : "border-red-400/40 bg-red-500/10 text-red-200"
                        : isLight
                          ? "border-[#C9A84C]/30 bg-white/40"
                          : "border-white/10 bg-black/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={excluded.includes(s.id)}
                      onChange={() => toggleExcluded(s.id)}
                      className="h-3.5 w-3.5 accent-red-400"
                      data-testid={`world-live-songreq-exclude-${s.id}`}
                      aria-label={t("worldDeskRemainder.liveSrExcludeAria", { title: s.title })}
                    />
                    {s.title}
                    {excluded.includes(s.id) ? t("worldDeskRemainder.liveSrOutSuffix") : ""}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className={`text-sm ${muted}`}>
              {t("worldDeskRemainder.liveSrYourCatalogEmpty")}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void saveRules()} disabled={saving} className={goldBtn} data-testid="world-live-songreq-rules-save">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t("worldDeskRemainder.liveSrSaveRules")}
            </button>
            {savedNote && (
              <span className="text-xs font-semibold text-emerald-500" role="status">
                {savedNote}
              </span>
            )}
          </div>

          {/* The live queue controls — only while this creator is live. */}
          {liveStreamId ? (
            <div className="border-t border-[#C9A84C]/20 pt-4" data-testid="world-live-songreq-live-controls">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className={`mr-auto text-sm font-black uppercase tracking-wider ${strong}`}>{t("worldDeskRemainder.liveSrLiveQueueHeading")}</h3>
                <button
                  type="button"
                  onClick={() => void queueAction(SONG_REQUEST_PLAY_NEXT_PATH(liveStreamId), "play")}
                  disabled={busy === "play"}
                  className={goldBtn}
                  data-testid="world-live-songreq-play-next"
                >
                  {busy === "play" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {t("worldDeskRemainder.liveSrPlayNext")}
                </button>
                <button
                  type="button"
                  onClick={() => void queueAction(SONG_REQUEST_CLOSE_PATH(liveStreamId), "close")}
                  disabled={busy === "close"}
                  className={chipBtn(isLight)}
                  data-testid="world-live-songreq-close"
                >
                  {busy === "close" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SkipForward className="h-3.5 w-3.5" />}
                  {t("worldDeskRemainder.liveSrCloseQueueRefund")}
                </button>
              </div>
              <div className="mt-3">
                {queueLoadFailures >= SONG_REQUEST_QUEUE_FAILURE_LIMIT ? (
                  <p className="text-xs font-semibold text-red-400" role="alert">
                    {queueView === null
                      ? t("worldDeskRemainder.liveSrQueueLoadFailed")
                      : t("worldDeskRemainder.liveSrQueueStale")}
                  </p>
                ) : (
                  <SongRequestQueueRows
                    isLight={isLight}
                    queue={queueView?.queue ?? []}
                    onSkip={(r) => void skip(r)}
                    skippingId={skippingId}
                  />
                )}
              </div>
            </div>
          ) : (
            <p className={`border-t border-[#C9A84C]/20 pt-4 text-sm ${muted}`}>
              {t("worldDeskRemainder.liveSrNotLiveNote")}
            </p>
          )}
          {deskError && (
            <p className="text-xs font-semibold text-red-400" role="alert">
              {deskError}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ═══ #91 Premiere / broadcast scheduling ═══════════════════════════ */

export function LivePremiereDesk({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const { getAccessToken } = useAuth();
  const authHeaders = useAuthHeaders();
  const [clips, setClips] = useState<FinishedClipOption[] | null>(null);
  const [clipsFailed, setClipsFailed] = useState(false);
  const [upcoming, setUpcoming] = useState<PremiereDto[] | null>(null);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [clipId, setClipId] = useState("");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("180");
  const [when, setWhen] = useState("");
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [copiedPremiereId, setCopiedPremiereId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const loadUpcoming = useCallback(async () => {
    try {
      const res = await reachApi.upcomingPremieres(getAccessToken);
      setUpcoming(res.premieres);
    } catch {
      setUpcoming([]);
    }
  }, [getAccessToken]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(GENERATED_CLIPS_PATH, { headers: await authHeaders() });
        if (!res.ok) throw new Error("clips");
        setClips(normalizeFinishedClips(await res.json(), t("worldLivePromo.untitledVideo")));
      } catch {
        setClipsFailed(true);
        setClips([]);
      }
      try {
        const me = await apiJson<{ id?: string }>(getAccessToken, MY_PROFILE_PATH).catch(() => null);
        setMyProfileId(me?.id ?? null);
      } catch { /* no profile → no cancel doors, the create rail says why */ }
      await loadUpcoming();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAccessToken, loadUpcoming]);

  async function handleSchedule() {
    setSaving(true);
    setNote(null);
    try {
      await reachApi.createPremiere(getAccessToken, {
        clipId,
        title: title.trim(),
        durationSeconds: Number(duration),
        scheduledAt: new Date(when).toISOString(),
      });
      setNote(t("worldLivePromo.premiereScheduledNote"));
      setTitle("");
      setWhen("");
      await loadUpcoming();
    } catch (err) {
      setNote(plainErrorText(err, t("worldLivePromo.premiereSaveFailed")));
    } finally {
      setSaving(false);
    }
  }

  /* The share door: every upcoming row can copy its premiere page's
     address — the only way the URL leaves the building, since no
     surface built a /premiere/<id> link before. */
  async function handleCopyPremiereLink(p: PremiereDto) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${PREMIERE_PAGE_PATH(p.id)}`);
      setCopiedPremiereId(p.id);
      setTimeout(() => setCopiedPremiereId((c) => (c === p.id ? null : c)), 2000);
    } catch {
      /* Clipboard unavailable — no fake "copied" state. */
    }
  }

  async function handleCancel(p: PremiereDto) {
    setCancellingId(p.id);
    setNote(null);
    try {
      await reachApi.cancelPremiere(getAccessToken, p.id);
      setNote(t("worldLivePromo.streamCancelledNote", { title: p.title }));
      await loadUpcoming();
    } catch (err) {
      setNote(plainErrorText(err, t("worldLivePromo.premiereCancelFailed")));
    } finally {
      setCancellingId(null);
    }
  }

  const draftReady = premiereDraftReady(
    { clipId, title, durationSeconds: Number(duration), whenLocal: when },
    Date.now(),
  );
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  return (
    <div className="space-y-3" data-testid="world-live-premiere">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <Clapperboard className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.premiereTitle")}
      </p>
      <p className={`text-sm ${muted}`}>{t("worldLivePromo.premiereIntro")}</p>
      {clipsFailed && (
        <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{t("worldLivePromo.premiereClipsFailed")}</p>
      )}
      <div className="grid gap-2 md:grid-cols-2">
        <select value={clipId} onChange={(e) => setClipId(e.target.value)} className={selectCls(isLight)} data-testid="world-live-premiere-clip" aria-label={t("worldLivePromo.premiereClipAria")}>
          <option value="">{t("worldLivePromo.premiereClipPlaceholder")}</option>
          {(clips ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("worldLivePromo.premiereTitleField")} maxLength={200} className={inputCls(isLight)} data-testid="world-live-premiere-title" aria-label={t("worldLivePromo.premiereTitleField")} />
        <label className={`text-xs ${muted}`}>
          {t("worldLivePromo.premiereDurationLabel")}
          <input type="number" min={10} max={14400} value={duration} onChange={(e) => setDuration(e.target.value)} className={`${inputCls(isLight)} mt-1`} data-testid="world-live-premiere-duration" />
        </label>
        <label className={`text-xs ${muted}`}>
          {t("worldLivePromo.premiereStartsLabel")}
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={`${inputCls(isLight)} mt-1`} data-testid="world-live-premiere-when" />
        </label>
      </div>
      <button type="button" onClick={() => void handleSchedule()} disabled={saving || !draftReady} className={goldBtn} data-testid="world-live-premiere-save">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />} {t("worldLivePromo.premiereSave")}
      </button>
      {note && <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-live-premiere-note">{note}</p>}

      <p className={`text-xs font-black uppercase tracking-wider ${muted}`}>{t("worldLivePromo.premiereUpcoming")}</p>
      {upcoming === null ? (
        <NativeLoadingState isLight={isLight} message={t("worldLivePromo.premiereLoading")} />
      ) : upcoming.length === 0 ? (
        <p className={`text-sm ${muted}`}>{t("worldLivePromo.premiereEmpty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {upcoming.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="world-live-premiere-row">
              <span className={strong}>{p.title}</span>
              <span className={muted}>
                {p.phase === "live" ? t("worldLivePromo.premierePlayingNow") : p.scheduledAt ? new Date(p.scheduledAt).toLocaleString(i18n.language) : ""}
                {p.creator ? t("worldLivePromo.premiereBy", { name: p.creator.displayName }) : ""}
              </span>
              <button type="button" className={chipBtn(isLight)} onClick={() => void handleCopyPremiereLink(p)} data-testid="world-live-premiere-copy-link">
                {copiedPremiereId === p.id ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />} {copiedPremiereId === p.id ? t("worldLivePromo.copied") : t("worldLivePromo.copyLink")}
              </button>
              {isOwnPremiere(p, myProfileId) && p.phase === "scheduled" && (
                <button type="button" className={chipBtn(isLight)} disabled={cancellingId === p.id} onClick={() => void handleCancel(p)} data-testid="world-live-premiere-cancel">
                  {cancellingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} {t("worldLivePromo.premiereCancel")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
