import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { CreateDeskRunner, type CreateDeskJobState } from "./CreateDeskRunner";
import {
  AdvancedExpander,
  DeskSelectField,
  DeskTextField,
  saveGeneratedClipToLibrary,
  useDeskAuthHeaders,
} from "./CreateDeskLeaf";
import {
  ClipModelPicker,
  ImageResult,
  PublishedReward,
  QuestProgressChip,
  SongAudioRail,
  TextResult,
  VideoResult,
  useQuestProgressChip,
  type SongAudioState,
} from "./CreateResultLeaf";
import { ResultChips } from "./CreateDeskShared";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useCreditConfirm } from "@/contexts/CreditConfirmContext";
import { StoryboardBench } from "./StoryboardBench";
import { StoryboardPlanner } from "./StoryboardPlanner";
import { VideoTemplateBench } from "./VideoTemplateBench";
import { SongHumBench, SongInspoBench, SongMashupBench } from "./SongDeskTabs";
import type { ShelfPlayerController } from "./ShelfPlayer";
import { ThumbnailBenches } from "./ThumbnailBenches";
import { CreatorProfileCreateCard } from "./CreatorProfileCreate";
import { parseScenes, extractBreakdownContent, type SceneData } from "@/lib/scene-parser";
import { CoverSongModal } from "@/components/song/CoverSongModal";
import { LrcExportModal } from "@/components/song/LrcExportModal";
import { LRC_AI_ALIGN_CREDITS } from "@/lib/lrc";
import {
  AI_EDIT_STYLE_DEFS,
  applyAiTransitionsToClips,
  defaultAiEditSettings,
  defaultEditorSettings,
} from "@/lib/editor-settings";
import { callGenerateApi } from "@/lib/generate-api";
import { generateMusicAudio, type GenerateMusicAudioRequest } from "@/lib/generate-music-audio";
import { extractSongPackage } from "@/lib/hub-song";
import { COVER_ART_RATIOS, COVER_ART_STYLES } from "@/lib/cover-art";
import type { ArtistImageModel } from "@/components/generate-artist-image";
import { ARTIST_IMAGE_MODELS } from "@/components/generate-artist-image";
import {
  aiEditPlanCost,
  analyzeSectionsCost,
  buildAiEditPlanPayload,
  buildArtistImagePayload,
  buildCoverArtPayload,
  buildShowcasePublishPayload,
  buildShareTrackPayload,
  buildSongVideoProjectPayload,
  buildCoverInMotionPayload,
  buildDraftPayload,
  buildEditorProjectPayload,
  buildGeneratedClipSavePayload,
  buildMusicAudioPayload,
  buildPublishTrackPayload,
  clipPlanCost,
  coverSourceForSong,
  DEFAULT_CLIP_SETTINGS,
  lrcSourceForSong,
  packageLyricsOf,
  songCoverCost,
  buildRunwayClipPayload,
  buildSongPayloadAdvanced,
  buildSongPayloadTurbo,
  applySongStarter,
  buildSongVideoPayloadAdvanced,
  buildSongVideoPayloadTurbo,
  buildThumbnailPayload,
  buildVideoPlanPayload,
  COVER_ART_PRESETS,
  pushCoverHistory,
  aiEditPlanOfResponse,
  coverArtCost,
  coverInMotionCost,
  interpretTaskPoll,
  musicAudioCost,
  profileIdOfProfilesResponse,
  publishedTrackIdOfResponse,
  resultExcerpt,
  schedulePrefillForMedia,
  showcaseSlugOfResponse,
  transcribeCostLabel,
  transcriptOfResponse,
  vaultsOfResponse,
  withArtistVault,
  withSceneApproval,
  withSceneClip,
  TRANSCRIBE_FORM_FIELD,
  SONG_AUDIO_LENGTH_SECONDS,
  songDeskTotalCost,
  songVideoDeskCost,
  SONG_VIDEO_TURBO_DEFAULTS,
  SONG_DRAFT_WORKFLOW,
  THUMBNAIL_DRAFT_WORKFLOW,
  thumbnailDeskCost,
  videoPlanCost,
  artistImageCost,
  EMPTY_SONG_ADVANCED,
  type ClipSettings,
  type SongAdvanced,
  type SongVideoAdvanced,
} from "@/lib/world/create-desks";
import { fetchAssetLibrary, libraryAssetsOfKind, type LibraryAsset } from "@/lib/asset-library";
import {
  SONG_PRESET_GROUPS,
  songPresetsByGroup,
  type SongPreset,
} from "@/lib/song-presets";

/* ─── The Create Wing desks (NATIVE-PLAN §3.6) ───────────────────────
   Five of the six quick-create benches live here (the Audio Studio
   bench is AudioDesk.tsx). Each is the shared shape: a Turbo prompt
   card on CreateDeskRunner, Advanced fields behind one expander,
   the Visual Bucs price shown before anything runs (the runner's
   cost gate), the desk's own endpoint + the same polling its page
   uses, the result IN the panel, and real next-step chips. Payloads
   and prices come from lib/world/create-desks — mirrored from the
   pages, never re-invented here. */

export interface CreateDeskProps {
  isLight: boolean;
  onJukeboxAdd: (trackId: string) => void;
  /** The palace's one Shelf player (the StationPanel host's),
   *  threaded so the Audio Desk's tabs can audition pack samples
   *  and play library rows on the same player the Booth uses.
   *  Optional: desks that don't play through it ignore it. */
  shelfPlayer?: ShelfPlayerController;
  /** Step through to the Visual Vibes editor (the host swaps the
   *  panel target to the editor station; its newest-project seed
   *  resolves on open — desks save their result as that project
   *  first, so the editor opens on THIS piece). */
  onOpenEditor?: () => void;
  /** The panel payload this desk was opened with (Stack-100 #2
   *  item 97, lib/world/panel-payload): RAW and untrusted — a desk
   *  that speaks payloads parses it with parsePanelPayloadFor for
   *  its own station id and ignores anything else. Desks that
   *  don't speak payloads never read it. */
  panelPayload?: unknown;
}

function useEditorSeed(props: CreateDeskProps) {
  const authHeaders = useDeskAuthHeaders();
  const [busy, setBusy] = useState(false);
  const send = async (payload: Record<string, unknown>) => {
    if (!props.onOpenEditor || busy) return;
    setBusy(true);
    try {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
    } catch {
      /* The step-through still opens — seeded with whatever project
         is newest, fresh if none. The seed save is best-effort,
         exactly as the pages treat their autosaves. */
    } finally {
      setBusy(false);
      props.onOpenEditor();
    }
  };
  return { busy, send };
}

function useDraftSaver() {
  const authHeaders = useDeskAuthHeaders();
  const [saved, setSaved] = useState(false);
  const save = async (payload: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      if (res.ok) setSaved(true);
    } catch {
      /* draft save is a convenience — a failure never masks the result */
    }
  };
  return { saved, save, reset: () => setSaved(false) };
}

/* ─── The song publish rail (Ring 2, items 2.1 + 2.2) ───────────────
   Shared by the Song Desk and the Song + Video Desk — both packages
   carry the same AI MUSIC PROMPT + lyrics, so the rail applies
   identically: package → real audio (POST /api/generate-music-audio,
   the site's own audio step) → publish to the profile
   (POST /api/publish/track, the /publish page's rail, free) → the
   response's track id lights the ResultChips jukebox chip.
   Honesty rules: audio exists only when the audio call lands;
   "published" exists only when the publish call answers with a
   track the jukebox gate accepts; a published song can never be
   published twice from this card (the chip settles, the publish
   action retires); every failure keeps its state dark + retryable. */
function useSongPublishRail(args: {
  rawResult: string | null;
  artistName: string;
  title: string;
  genre: string;
  onJukeboxAdd: (trackId: string) => void;
}) {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const [audioState, setAudioState] = useState<SongAudioState>("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  /* Stack-100 #48: no creator profile yet is not an error and never
     an exit — the desk opens the in-world profile creation card and
     the publish retries from the same spot once it exists. */
  const [needsProfile, setNeedsProfile] = useState(false);
  const [publishedTrackId, setPublishedTrackId] = useState<string | null>(null);
  const [jukeboxSent, setJukeboxSent] = useState(false);

  const reset = () => {
    setAudioState("idle");
    setAudioUrl(null);
    setAudioError(null);
    setPublishBusy(false);
    setPublishError(null);
    setNeedsProfile(false);
    setPublishedTrackId(null);
    setJukeboxSent(false);
  };

  const makeAudio = async () => {
    if (audioState === "running" || !args.rawResult) return;
    const payload = buildMusicAudioPayload({
      rawResult: args.rawResult,
      artistName: args.artistName,
      songTitle: args.title,
    });
    if (!payload) {
      setAudioError(t("worldCreateDesk.audioNoPrompt"));
      setAudioState("failed");
      return;
    }
    setAudioState("running");
    setAudioError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(t("worldCreateDesk.audioSignIn"));
      const resp = await generateMusicAudio(token, payload as unknown as GenerateMusicAudioRequest);
      if (!resp) return; // a confirmation was declined — nothing ran
      setAudioUrl(resp.url);
      setAudioState("done");
      refreshProfile();
    } catch (err) {
      const msg = plainErrorText(err, t("worldCreateDesk.audioFailed"));
      setAudioError(
        msg === "out_of_credits" ? t("worldCreateDesk.audioOutOfBucs") : msg,
      );
      setAudioState("failed");
    }
  };

  const publish = async () => {
    if (!audioUrl || publishBusy || publishedTrackId) return;
    setPublishBusy(true);
    setPublishError(null);
    try {
      const headers = await authHeaders();
      const profRes = await fetch("/api/creator-profiles", { headers });
      if (!profRes.ok) throw new Error(t("worldCreateDesk.publishProfileCheckFailed"));
      const profileId = profileIdOfProfilesResponse(await profRes.json().catch(() => null));
      if (!profileId) {
        /* #48: the creation card opens right here (rendered by the
           desk below) — no profile page, no leaving the World. */
        setNeedsProfile(true);
        return;
      }
      const res = await fetch("/api/publish/track", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(
          buildPublishTrackPayload({
            profileId,
            title: args.title,
            audioUrl,
            genre: args.genre,
            durationSec: SONG_AUDIO_LENGTH_SECONDS,
          }),
        ),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(apiErrorMessage(json, t("worldCreateDesk.publishFailed")));
      const trackId = publishedTrackIdOfResponse(json);
      if (!trackId) {
        throw new Error(t("worldCreateDesk.publishNoTrack"));
      }
      setPublishedTrackId(trackId);
    } catch (err) {
      setPublishError(plainErrorText(err, t("worldCreateDesk.publishFailed")));
    } finally {
      setPublishBusy(false);
    }
  };

  const queueToJukebox = (trackId: string) => {
    args.onJukeboxAdd(trackId);
    setJukeboxSent(true);
  };

  return {
    audioState,
    audioUrl,
    audioError,
    audioCost: musicAudioCost(),
    makeAudio,
    publish,
    publishBusy,
    publishError,
    needsProfile,
    profileCreated: () => setNeedsProfile(false),
    published: publishedTrackId !== null,
    publishedTrackId,
    jukeboxSent,
    queueToJukebox,
    reset,
  };
}

const GENRE_OPTIONS = ["", "Hip Hop", "Drill", "Trap", "R&B", "Pop", "Afrobeats", "Dancehall", "Gospel", "Kids Music", "Rock", "Country", "Other"];
const MOOD_OPTIONS = ["", "Luxury", "Dark", "Emotional", "Street", "Romantic", "Energetic", "Pain", "Victory", "Party", "Inspirational", "Funny", "Kid-Friendly"];
const LENGTH_OPTIONS = ["", "30 seconds", "60 seconds", "2 minutes", "Full song"];

/* ─── Song Desk ────────────────────────────────────────────────────── */

export function SongDesk(props: CreateDeskProps) {
  const { t, i18n } = useTranslation();
  const { isLight } = props;
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmSpend } = useCreditConfirm();
  const authHeaders = useDeskAuthHeaders();
  const quest = useQuestProgressChip();
  const [tab, setTab] = useState<"create" | "inspo" | "mashup" | "hum">("create");
  const [vaults, setVaults] = useState<Array<{ id: string; artistName: string }>>([]);
  const [vaultRaw, setVaultRaw] = useState<Record<string, unknown> | null>(null);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [intakeNote, setIntakeNote] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [adv, setAdv] = useState<SongAdvanced>(EMPTY_SONG_ADVANCED);
  /* Org wave #4: the make-song starter shelf's active pick. A starter
     is a prefill only (see applyStarter) — the marker clears the
     moment the creator edits the prompt or any Advanced field by
     hand, so it never claims a starter the form no longer matches. */
  const [activeStarterId, setActiveStarterId] = useState<string | null>(null);
  const [state, setState] = useState<CreateDeskJobState>("idle");
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [genHistoryId, setGenHistoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Stack-100 #49: the finished-song finishers (cover + .lrc). */
  const [coverOpen, setCoverOpen] = useState(false);
  const [lrcOpen, setLrcOpen] = useState(false);
  const editor = useEditorSeed(props);
  const draft = useDraftSaver();

  const useAdvanced = Object.values(adv).some((v) => v.trim().length > 0);
  const set = (k: keyof SongAdvanced) => (v: string) => { setActiveStarterId(null); setAdv((a) => ({ ...a, [k]: v })); };
  /* A starter tap ONLY prefills — the prompt takes the preset's
     description text and the Advanced fields take its real form
     patch (lib/world/create-desks applySongStarter, off the page's
     own registry). Nothing submits, nothing charges: making the song
     is still the desk's own tap below, at the price shown there. */
  const applyStarter = (preset: SongPreset) => {
    const next = applySongStarter(preset, { prompt, adv });
    setPrompt(next.prompt);
    setAdv(next.adv);
    setActiveStarterId(preset.id);
  };
  const editPrompt = (v: string) => { setActiveStarterId(null); setPrompt(v); };
  /* Audit #5: the package leg prices by the chosen length tier, so
     the desk's one up-front total follows the Advanced length pick
     (Turbo posts no length and prices at the base tier). */
  const deskTotalCost = songDeskTotalCost(useAdvanced ? adv.songLength : "");

  /* Ring 2 (2.5): Artist Vault preset loading — the selector's own
     rail (GET /api/artist-vaults); picking one posts the whole
     vault object as artistVault, exactly as make-song posts it. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/artist-vaults", { headers: await authHeaders() });
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as unknown;
        if (cancelled) return;
        setVaults(vaultsOfResponse(json));
      } catch {
        /* vault presets are a nicety — the desk works without them */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadVault = async (id: string) => {
    if (!id) {
      setVaultRaw(null);
      return;
    }
    try {
      const res = await fetch("/api/artist-vaults", { headers: await authHeaders() });
      const json = (await res.json().catch(() => null)) as { vaults?: Array<Record<string, unknown>> } | Array<Record<string, unknown>> | null;
      const list = Array.isArray(json) ? json : (json?.vaults ?? []);
      const found = list.find((v) => v["id"] === id) ?? null;
      setVaultRaw(found);
      if (found && typeof found["artist_name"] === "string" && !adv.artistName) {
        setAdv((a) => ({ ...a, artistName: found["artist_name"] as string }));
      }
    } catch {
      /* keep the current preset state */
    }
  };

  /* Ring 2 (2.5): upload + auto-transcribe intake — the file rides
     POST /api/transcribe (form field "audio") and the transcript
     becomes the song's topic/lyrics seed in the prompt. */
  const intakeFile = async (file: File) => {
    setIntakeBusy(true);
    setIntakeNote(null);
    void quest.snapshot();
    try {
      const form = new FormData();
      form.append(TRANSCRIBE_FORM_FIELD, file);
      const res = await fetch("/api/transcribe", { method: "POST", headers: await authHeaders(), body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreateDesk.transcriptionFailed")));
      const transcript = transcriptOfResponse(data);
      if (!transcript) throw new Error(t("worldCreateDesk.transcriptionEmpty"));
      setActiveStarterId(null);
      setPrompt(transcript.slice(0, 2000));
      setIntakeNote(t("worldCreateDesk.transcribedNote"));
      refreshProfile();
    } catch (err) {
      setIntakeNote(plainErrorText(err, t("worldCreateDesk.transcriptionFailed")));
    } finally {
      setIntakeBusy(false);
    }
  };

  const run = async () => {
    if (state === "running" || !prompt.trim()) return;
    setState("running");
    setError(null);
    setRawResult(null);
    draft.reset();
    rail.reset();
    void quest.snapshot();
    try {
      /* ONE confirmation for the whole song — the package plus the
         real audio, priced by the chosen length and named up front
         (800 Visual Bucs total at the default length). Each leg
         still charges exactly once on its own rail, only when that
         leg actually runs: decline here and nothing moves at all;
         make the package and skip the audio and only the package
         leg ever charged. */
      const confirmed = await confirmSpend({
        cost: deskTotalCost,
        feature: t("worldCreateDesk.confirmSongFeature"),
      });
      if (!confirmed) {
        setState("idle");
        return;
      }
      const token = await getAccessToken();
      const base = useAdvanced ? buildSongPayloadAdvanced(prompt, adv) : buildSongPayloadTurbo(prompt);
      const payload = vaultRaw ? withArtistVault(base, vaultRaw) : base;
      const result = await callGenerateApi("/api/generate-song", payload, token);
      if (!result) throw new Error(t("worldCreateDesk.songStartFailed"));
      setRawResult(result.rawResult);
      setGenHistoryId(result.genHistoryId ?? null);
      if (result.creditsRemaining !== undefined) refreshProfile();
      setState("done");
      void quest.checkAfter();
    } catch (err) {
      setError(plainErrorText(err, t("worldCreateDesk.songFailed")));
      setState("failed");
    }
  };

  const pkg = rawResult ? extractSongPackage(rawResult) : null;
  const title = adv.songTitle || pkg?.bestTitle || t("worldCreateDesk.yourSong");
  const rail = useSongPublishRail({
    rawResult,
    artistName: adv.artistName,
    title,
    genre: adv.genre,
    onJukeboxAdd: props.onJukeboxAdd,
  });

  const songTabBtn = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;

  if (tab !== "create") {
    return (
      <div className="space-y-3" data-testid="world-create-song-desk">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("worldCreateDesk.tabsAria")}>
          <button type="button" role="tab" aria-selected={false} onClick={() => setTab("create")} className={songTabBtn(false)}>{t("worldCreateDesk.tabCreate")}</button>
          <button type="button" role="tab" aria-selected={tab === "inspo"} onClick={() => setTab("inspo")} className={songTabBtn(tab === "inspo")}>{t("worldCreateDesk.tabInspo")}</button>
          <button type="button" role="tab" aria-selected={tab === "mashup"} onClick={() => setTab("mashup")} className={songTabBtn(tab === "mashup")}>{t("worldCreateDesk.tabMashup")}</button>
          <button type="button" role="tab" aria-selected={tab === "hum"} onClick={() => setTab("hum")} className={songTabBtn(tab === "hum")}>{t("worldCreateDesk.tabHum")}</button>
        </div>
        {tab === "inspo" ? <SongInspoBench isLight={isLight} /> : tab === "mashup" ? <SongMashupBench isLight={isLight} /> : <SongHumBench isLight={isLight} />}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="world-create-song-desk">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("worldCreateDesk.tabsAria")}>
        <button type="button" role="tab" aria-selected={true} onClick={() => setTab("create")} className={songTabBtn(true)}>{t("worldCreateDesk.tabCreate")}</button>
        <button type="button" role="tab" aria-selected={false} onClick={() => setTab("inspo")} className={songTabBtn(false)}>{t("worldCreateDesk.tabInspo")}</button>
        <button type="button" role="tab" aria-selected={false} onClick={() => setTab("mashup")} className={songTabBtn(false)}>{t("worldCreateDesk.tabMashup")}</button>
        <button type="button" role="tab" aria-selected={false} onClick={() => setTab("hum")} className={songTabBtn(false)}>{t("worldCreateDesk.tabHum")}</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {vaults.length > 0 ? (
          <DeskSelectField
            isLight={isLight}
            label={t("worldCreateDesk.vaultPresetLabel")}
            value={typeof vaultRaw?.["id"] === "string" ? (vaultRaw["id"] as string) : ""}
            onChange={(v) => void loadVault(v)}
            options={[{ value: "", label: t("worldCreateDesk.noPreset") }, ...vaults.map((v) => ({ value: v.id, label: v.artistName }))]}
          />
        ) : null}
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold bdv-touch-target ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"}`}>
          {intakeBusy ? t("worldCreateDesk.transcribing") : `Upload a song + transcribe · ${transcribeCostLabel()}`}
          <input type="file" accept="audio/*" className="hidden" data-testid="world-song-intake-upload" onChange={(e) => { const f = e.target.files?.[0]; if (f) void intakeFile(f); }} />
        </label>
        {intakeNote ? <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>{intakeNote}</span> : null}
      </div>
      {/* Org wave #4: the song starter shelf — the make-song page's
          own registry (lib/song-presets), grouped the page's way.
          A tap prefills the prompt + the Advanced fields and nothing
          else; the desk's price line below still prices the run. */}
      <div className="space-y-2" data-testid="world-song-starters">
        <p className={`text-[11px] font-black uppercase tracking-wider ${isLight ? "text-[#7A5A12]" : "text-[#d4af37]"}`}>
          {t("worldCreateDesk.startersHeading")}
        </p>
        {SONG_PRESET_GROUPS.map((group) => (
          <div key={group.id} className="space-y-1.5">
            <p className={`text-[11px] font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/45"}`}>{group.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {songPresetsByGroup(group.id).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`world-song-starter-${preset.id}`}
                  aria-pressed={activeStarterId === preset.id}
                  onClick={() => applyStarter(preset)}
                  className={songTabBtn(activeStarterId === preset.id)}
                >
                  {preset.emoji} {preset.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className={`text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/45"}`}>
          {t("worldCreateDesk.startersNote")}
        </p>
      </div>
      <AdvancedExpander isLight={isLight}>
        <div className="grid gap-3 sm:grid-cols-2">
          <DeskTextField isLight={isLight} label={t("worldCreateDesk.artistNameLabel")} value={adv.artistName} onChange={set("artistName")} />
          <DeskTextField isLight={isLight} label={t("worldCreateDesk.songTitleLabel")} value={adv.songTitle} onChange={set("songTitle")} />
          <DeskSelectField isLight={isLight} label={t("worldCreateDesk.genreLabel")} value={adv.genre} onChange={set("genre")} options={GENRE_OPTIONS.map((g) => ({ value: g, label: g || t("worldCreateDesk.turboPicks") }))} />
          <DeskSelectField isLight={isLight} label={t("worldCreateDesk.moodLabel")} value={adv.mood} onChange={set("mood")} options={MOOD_OPTIONS.map((m) => ({ value: m, label: m || t("worldCreateDesk.turboPicks") }))} />
          <DeskSelectField isLight={isLight} label={t("worldCreateDesk.cleanExplicitLabel")} value={adv.cleanOrExplicit} onChange={set("cleanOrExplicit")} options={[{ value: "", label: t("worldCreateDesk.turboPicks") }, { value: "Clean", label: t("worldCreateDesk.cleanLabel") }, { value: "Explicit", label: t("worldCreateDesk.explicitLabel") }]} />
          <DeskSelectField isLight={isLight} label={t("worldCreateDesk.songLengthLabel")} value={adv.songLength} onChange={set("songLength")} options={LENGTH_OPTIONS.map((l) => ({ value: l, label: l || t("worldCreateDesk.turboPicks") }))} />
          <DeskTextField isLight={isLight} label={t("worldCreateDesk.voiceStyleLabel")} value={adv.voiceStyle} onChange={set("voiceStyle")} />
          <DeskTextField isLight={isLight} label={t("worldCreateDesk.beatStyleLabel")} value={adv.beatStyle} onChange={set("beatStyle")} />
        </div>
        <DeskTextField isLight={isLight} label={t("worldCreateDesk.specialInstructionsLabel")} value={adv.specialInstructions} onChange={set("specialInstructions")} />
      </AdvancedExpander>
      <p className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        {t("worldCreateDesk.songOnePrice", { total: deskTotalCost.toLocaleString(i18n.language) })}
      </p>
      <CreateDeskRunner
        isLight={isLight}
        promptLabel={t("worldCreateDesk.describeSong")}
        prompt={prompt}
        onPromptChange={editPrompt}
        costVisualBucs={deskTotalCost}
        state={state}
        errorMessage={error}
        onRun={run}
        runLabel={t("worldCreateDesk.makeSong")}
        result={
          rawResult ? (
            <div>
              <TextResult isLight={isLight} title={title} text={resultExcerpt(rawResult)} />
              <SongAudioRail
                isLight={isLight}
                state={rail.audioState}
                error={rail.audioError}
                audioUrl={rail.audioUrl}
                title={title}
                costVisualBucs={rail.audioCost}
                onMakeAudio={() => void rail.makeAudio()}
                includedInTotal={deskTotalCost}
              />
              {/* Stack-100 #49 — the finished-song finishers: the
                  site's OWN CoverSongModal + LrcExportModal docked
                  on this result (same rails, prices and credit
                  confirmation as make-song: cover 400 VB on
                  /api/song-cover; .lrc tap-to-sync free or AI
                  align 200 VB). They open only once the desk holds
                  the real hosted audio both modals require. */}
              {rail.audioUrl ? (
                <div className="mt-3 flex flex-wrap gap-1.5" data-testid="world-song-finishers">
                  <button
                    type="button"
                    data-testid="world-song-finisher-cover"
                    onClick={() => setCoverOpen(true)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
                      isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
                    }`}
                  >
                    {t("worldCreateDesk.makeCoverCost", { cost: songCoverCost().toLocaleString(i18n.language) })}
                  </button>
                  {lrcSourceForSong({ audioUrl: rail.audioUrl, title, artistName: adv.artistName, rawResult }) ? (
                    <button
                      type="button"
                      data-testid="world-song-finisher-lrc"
                      onClick={() => setLrcOpen(true)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
                        isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
                      }`}
                    >
                      {t("worldCreateDesk.lrcButton", { cost: LRC_AI_ALIGN_CREDITS })}
                    </button>
                  ) : null}
                  <CoverSongModal
                    open={coverOpen}
                    onClose={() => setCoverOpen(false)}
                    source={coverSourceForSong({ audioUrl: rail.audioUrl, title, artistName: adv.artistName })}
                    initialLyrics={packageLyricsOf(rawResult)}
                  />
                  <LrcExportModal
                    open={lrcOpen}
                    onClose={() => setLrcOpen(false)}
                    source={lrcSourceForSong({ audioUrl: rail.audioUrl, title, artistName: adv.artistName, rawResult })}
                  />
                </div>
              ) : null}
              <ResultChips
                isLight={isLight}
                onSendToEditor={
                  props.onOpenEditor
                    ? () =>
                        void editor.send(
                          buildEditorProjectPayload({
                            projectType: "Make a Song",
                            title: [adv.artistName, title].filter(Boolean).join(" - ") || title,
                            artistName: adv.artistName,
                            songTitle: title,
                            genre: adv.genre,
                            mood: adv.mood,
                            inputData: { songTopic: prompt, ...adv },
                            resultText: rawResult,
                            genHistoryId,
                          }),
                        )
                    : undefined
                }
                editorBusy={editor.busy}
                onPublish={rail.audioUrl && !rail.published ? () => void rail.publish() : undefined}
                publishBusy={rail.publishBusy}
                published={rail.published}
                jukeboxTrackId={rail.publishedTrackId}
                onJukeboxAdd={rail.queueToJukebox}
                onSaveDraft={() =>
                  void draft.save(
                    buildDraftPayload(SONG_DRAFT_WORKFLOW, title, {
                      formValues: { ...adv, songTopic: prompt },
                      rawResult,
                      timestamp: Date.now(),
                    }),
                  )
                }
                draftSaved={draft.saved}
                onMakeAnother={() => {
                  setState("idle");
                  setRawResult(null);
                  setPrompt("");
                  rail.reset();
                }}
              />
              {rail.publishError ? (
                <p data-testid="world-create-publish-error" className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                  {rail.publishError}
                </p>
              ) : null}
              {rail.needsProfile ? (
                <div className="mt-3" data-testid="world-create-profile-gate">
                  <CreatorProfileCreateCard isLight={isLight} compact onCreated={() => rail.profileCreated()} />
                  <p className={`mt-2 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                    {t("worldCreateDesk.profileGateNote")}
                  </p>
                </div>
              ) : null}
              {rail.published ? (
                <PublishedReward isLight={isLight} title={title} jukeboxSent={rail.jukeboxSent} />
              ) : (
                <p className={`mt-2 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                  {t("worldCreateDesk.fullPackageNote")}
                </p>
              )}
              <QuestProgressChip isLight={isLight} lines={quest.lines} />
            </div>
          ) : undefined
        }
      />
    </div>
  );
}

/* ─── Song + Video Desk ────────────────────────────────────────────── */

export function SongVideoDesk(props: CreateDeskProps) {
  const { t } = useTranslation();
  const { isLight } = props;
  const { getAccessToken, refreshProfile } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [adv, setAdv] = useState<SongVideoAdvanced>({ ...EMPTY_SONG_ADVANCED, videoStyle: "", platform: "" });
  const [state, setState] = useState<CreateDeskJobState>("idle");
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [genHistoryId, setGenHistoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editor = useEditorSeed(props);
  const quest = useQuestProgressChip();

  const useAdvanced = Object.values(adv).some((v) => v.trim().length > 0);
  const set = (k: keyof SongVideoAdvanced) => (v: string) => setAdv((a) => ({ ...a, [k]: v }));

  const run = async () => {
    if (state === "running" || !prompt.trim()) return;
    setState("running");
    setError(null);
    setRawResult(null);
    rail.reset();
    void quest.snapshot();
    try {
      const token = await getAccessToken();
      const payload = useAdvanced ? buildSongVideoPayloadAdvanced(prompt, adv) : buildSongVideoPayloadTurbo(prompt);
      const result = await callGenerateApi("/api/generate-song-video", payload, token);
      if (!result) throw new Error(t("worldCreateDesk.songVideoStartFailed"));
      setRawResult(result.rawResult);
      setGenHistoryId(result.genHistoryId ?? null);
      if (result.creditsRemaining !== undefined) refreshProfile();
      setState("done");
      void quest.checkAfter();
    } catch (err) {
      setError(plainErrorText(err, t("worldCreateDesk.songVideoFailed")));
      setState("failed");
    }
  };

  const pkg = rawResult ? extractSongPackage(rawResult) : null;
  const title = adv.songTitle || pkg?.bestTitle || t("worldCreateDesk.yourSongVideo");
  /* The song+video package carries the same AI MUSIC PROMPT + lyrics
     as a Song Desk package, so the publish rail applies identically:
     make the audio, publish the song to the profile, light the
     jukebox chip. The package's video side still rides the editor
     seed exactly as before. */
  const rail = useSongPublishRail({
    rawResult,
    artistName: adv.artistName,
    title,
    genre: adv.genre,
    onJukeboxAdd: props.onJukeboxAdd,
  });

  return (
    <div className="space-y-3" data-testid="world-create-song-video-desk">
      <AdvancedExpander isLight={isLight}>
        <div className="grid gap-3 sm:grid-cols-2">
          <DeskTextField isLight={isLight} label={t("worldCreateDesk.artistNameLabel")} value={adv.artistName} onChange={set("artistName")} />
          <DeskTextField isLight={isLight} label={t("worldCreateDesk.songTitleLabel")} value={adv.songTitle} onChange={set("songTitle")} />
          <DeskSelectField isLight={isLight} label={t("worldCreateDesk.genreLabel")} value={adv.genre} onChange={set("genre")} options={GENRE_OPTIONS.map((g) => ({ value: g, label: g || t("worldCreateDesk.turboPicks") }))} />
          <DeskSelectField isLight={isLight} label={t("worldCreateDesk.moodLabel")} value={adv.mood} onChange={set("mood")} options={MOOD_OPTIONS.map((m) => ({ value: m, label: m || t("worldCreateDesk.turboPicks") }))} />
          <DeskTextField isLight={isLight} label={t("worldCreateDesk.videoStyleLabel")} value={adv.videoStyle} onChange={set("videoStyle")} />
          <DeskTextField isLight={isLight} label={t("worldCreateDesk.platformLabel")} value={adv.platform} onChange={set("platform")} placeholder="TikTok / Reels / Shorts - 9:16" />
          <DeskTextField isLight={isLight} label={t("worldCreateDesk.voiceStyleLabel")} value={adv.voiceStyle} onChange={set("voiceStyle")} />
          <DeskTextField isLight={isLight} label={t("worldCreateDesk.beatStyleLabel")} value={adv.beatStyle} onChange={set("beatStyle")} />
        </div>
        <DeskTextField isLight={isLight} label={t("worldCreateDesk.specialInstructionsLabel")} value={adv.specialInstructions} onChange={set("specialInstructions")} />
      </AdvancedExpander>
      <CreateDeskRunner
        isLight={isLight}
        promptLabel={t("worldCreateDesk.describeSongVideo")}
        prompt={prompt}
        onPromptChange={setPrompt}
        costVisualBucs={songVideoDeskCost()}
        state={state}
        errorMessage={error}
        onRun={run}
        runLabel={t("worldCreateDesk.makeSongVideo")}
        result={
          rawResult ? (
            <div>
              <TextResult isLight={isLight} title={title} text={resultExcerpt(rawResult)} />
              <SongAudioRail
                isLight={isLight}
                state={rail.audioState}
                error={rail.audioError}
                audioUrl={rail.audioUrl}
                title={title}
                costVisualBucs={rail.audioCost}
                onMakeAudio={() => void rail.makeAudio()}
              />
              <ResultChips
                isLight={isLight}
                onSendToEditor={
                  props.onOpenEditor
                    ? () =>
                        void editor.send(
                          buildEditorProjectPayload({
                            projectType: "Make Song + Video",
                            title: [adv.artistName, title].filter(Boolean).join(" - ") || title,
                            artistName: adv.artistName,
                            songTitle: title,
                            genre: adv.genre,
                            mood: adv.mood,
                            inputData: { songTopic: prompt, ...adv },
                            resultText: rawResult,
                            genHistoryId,
                          }),
                        )
                    : undefined
                }
                editorBusy={editor.busy}
                onPublish={rail.audioUrl && !rail.published ? () => void rail.publish() : undefined}
                publishBusy={rail.publishBusy}
                published={rail.published}
                jukeboxTrackId={rail.publishedTrackId}
                onJukeboxAdd={rail.queueToJukebox}
                onMakeAnother={() => {
                  setState("idle");
                  setRawResult(null);
                  setPrompt("");
                  rail.reset();
                }}
              />
              {rail.publishError ? (
                <p data-testid="world-create-publish-error" className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                  {rail.publishError}
                </p>
              ) : null}
              {rail.needsProfile ? (
                <div className="mt-3" data-testid="world-create-profile-gate">
                  <CreatorProfileCreateCard isLight={isLight} compact onCreated={() => rail.profileCreated()} />
                  <p className={`mt-2 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                    {t("worldCreateDesk.profileGateNote")}
                  </p>
                </div>
              ) : null}
              {rail.published ? (
                <PublishedReward isLight={isLight} title={title} jukeboxSent={rail.jukeboxSent} />
              ) : null}
            </div>
          ) : undefined
        }
      />
      <SongVideoWizard
        isLight={isLight}
        packageResult={rawResult}
        artistName={adv.artistName}
        editorBusy={editor.busy}
        onSendToEditor={
          props.onOpenEditor
            ? (payload) => {
                void editor.send(payload);
              }
            : undefined
        }
      />
      <QuestProgressChip isLight={isLight} lines={quest.lines} />
    </div>
  );
}


/* ─── Ring 2 (2.4) — the Song + Video wizard's later steps ──────────
   song-and-video.tsx's Simple flow steps docked under the desk's
   package: upload + auto-transcribe intake (POST /api/transcribe),
   scene review (the audio scene flow or the package's parsed
   scenes, approved per scene), the auto-edit plan applied
   (POST /api/generate/ai-edit-plan → applyAiTransitionsToClips,
   the page's own application), and the finished package saved as
   a project (POST /api/projects, the page's save shape).
   Creation Desk lane: the wizard's scenes now GENERATE here —
   per-scene clips on the same clip rail as the Video Desk
   (confirmedFetch at the picked model's plan price) with
   SceneStudio's library save on success, so a finished scene
   clip lands in My Clips without leaving the World. Saving the
   package is a plain project save; the editor step-through is
   an optional extra beside it, never the finish line. */

function SongVideoWizard(props: {
  isLight: boolean;
  packageResult: string | null;
  artistName: string;
  onSendToEditor?: (payload: Record<string, unknown>) => void;
  editorBusy?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { isLight } = props;
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();
  const quest = useQuestProgressChip();
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [scenes, setScenes] = useState<SceneData[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planApplied, setPlanApplied] = useState(false);
  const [editorSettings, setEditorSettings] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [clipSettings, setClipSettings] = useState<ClipSettings>(DEFAULT_CLIP_SETTINGS);
  const [clipBusy, setClipBusy] = useState<string | null>(null);
  const clipPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (clipPollRef.current) clearInterval(clipPollRef.current);
  }, []);

  const lyrics = transcript.trim();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const chipCls = `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;

  const intake = async (file: File) => {
    setAudioFile(file);
    setAudioUrl(URL.createObjectURL(file));
    setTranscribing(true);
    setError(null);
    try {
      const form = new FormData();
      form.append(TRANSCRIBE_FORM_FIELD, file);
      const res = await fetch("/api/transcribe", { method: "POST", headers: await authHeaders(), body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreateDesk.transcriptionFailed")));
      const text = transcriptOfResponse(data);
      if (!text) throw new Error(t("worldCreateDesk.wizardTranscribeEmpty"));
      setTranscript(text);
      refreshProfile();
    } catch (err) {
      setError(plainErrorText(err, t("worldCreateDesk.transcriptionFailed")));
    } finally {
      setTranscribing(false);
    }
  };

  const buildScenes = async () => {
    if (busy) return;
    setBusy("scenes");
    setError(null);
    void quest.snapshot();
    try {
      if (audioUrl) {
        const { runAudioSceneFlow } = await import("@/lib/generate-scenes-from-audio-flow");
        const flow = await runAudioSceneFlow({
          lyrics,
          audioUrl,
          audioFile,
          songStructure: null,
          getAccessToken,
        });
        if (!flow) return;
        setScenes(flow.scenes);
      } else if (props.packageResult) {
        const parsed = parseScenes(extractBreakdownContent(props.packageResult));
        if (parsed.length === 0) throw new Error(t("worldCreateDesk.scenesNone"));
        setScenes(parsed);
      } else {
        throw new Error(t("worldCreateDesk.scenesNeedSource"));
      }
    } catch (err) {
      setError(plainErrorText(err, t("worldCreateDesk.sceneBuildingFailed")));
    } finally {
      setBusy(null);
    }
  };

  const applyPlan = async () => {
    if (busy || scenes.length === 0) return;
    setBusy("plan");
    setError(null);
    try {
      const token = await getAccessToken();
      const style = "viral-tiktok";
      let settings: ReturnType<typeof defaultEditorSettings> = {
        ...defaultEditorSettings(),
        aiEdit: { ...defaultAiEditSettings(), enabled: true, style, autoApplyTransitions: true },
      };
      const res = await fetch("/api/generate/ai-edit-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(
          buildAiEditPlanPayload({
            style,
            styleName: AI_EDIT_STYLE_DEFS.find((d) => d.id === style)?.name ?? style,
            scenes,
            audioFound: !!audioUrl,
            captionStyle: settings.captions.stylePreset,
            currentEffects: settings.effects,
            artistName: props.artistName,
            lyricsText: lyrics,
          }),
        ),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreateDesk.editPlanFailed")));
      const plan = aiEditPlanOfResponse(data);
      if (plan) {
        settings = {
          ...settings,
          aiEdit: { ...settings.aiEdit, plan: plan as never, applied: false },
        };
        settings = applyAiTransitionsToClips(settings, scenes, plan as never);
        setPlanApplied(true);
      }
      setEditorSettings(settings);
      refreshProfile();
      void token;
    } catch (err) {
      setError(plainErrorText(err, t("worldCreateDesk.editPlanFailedSave")));
    } finally {
      setBusy(null);
    }
  };

  /* Generate one scene's clip HERE — the Video Desk's rail and
     rules: the picked model's price is on the button, the member
     confirms, the rail charges on success only, and the finished
     clip saves to My Clips (SceneStudio's save) as it lands. */
  const makeSceneClip = (scene: SceneData) => {
    if (clipBusy) return;
    setClipBusy(scene.id);
    setError(null);
    void (async () => {
      try {
        const scenePrompt = scene.aiVideoPrompt || scene.action || `Scene ${scene.sceneNumber}`;
        const res = await confirmedFetch("/api/generate-runway-clip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildRunwayClipPayload(scenePrompt, scene.negativePrompt ?? "", clipSettings)),
          overrideCost: clipPlanCost(clipSettings),
          overrideFeature: t("worldCreateDesk.confirmClipFeature"),
        });
        if (!res) {
          /* The member declined the price — nothing ran. */
          setClipBusy(null);
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { taskId?: string; error?: string; message?: string };
        if (!res.ok || !data.taskId) throw new Error(apiErrorMessage(data, t("worldCreateDesk.clipMakeStartFailed")));
        const taskId = data.taskId;
        clipPollRef.current = setInterval(async () => {
          try {
            const poll = await fetch(`/api/generate-runway-clip/${taskId}`, { headers: await authHeaders() });
            const pdata = (await poll.json()) as Parameters<typeof interpretTaskPoll>[0];
            const read = interpretTaskPoll(pdata);
            if (read.done) {
              if (clipPollRef.current) clearInterval(clipPollRef.current);
              setClipBusy(null);
              if (read.failed || !read.url) {
                setError(apiErrorMessage(read, t("worldCreateDesk.clipFailed")));
              } else {
                setScenes((prev) => withSceneClip(prev, scene.id, read.url!));
                refreshProfile();
                void saveGeneratedClipToLibrary(
                  authHeaders,
                  buildGeneratedClipSavePayload({
                    title: `Scene ${scene.sceneNumber}${scene.section ? ` — ${scene.section}` : ""}`,
                    prompt: scenePrompt,
                    videoUrl: read.url,
                    runwayJobId: taskId,
                    sceneId: scene.id,
                  }),
                );
              }
            }
          } catch {
            if (clipPollRef.current) clearInterval(clipPollRef.current);
            setClipBusy(null);
            setError(t("worldCreateDesk.clipNetworkError"));
          }
        }, 5000);
      } catch (err) {
        setClipBusy(null);
        setError(plainErrorText(err, t("worldCreateDesk.clipFailed")));
      }
    })();
  };

  const packagePayload = () =>
    buildSongVideoProjectPayload({
      title: [props.artistName, "Song + Video"].filter(Boolean).join(" — ") || "Song + Video",
      artistName: props.artistName,
      genre: SONG_VIDEO_TURBO_DEFAULTS.genre,
      mood: SONG_VIDEO_TURBO_DEFAULTS.mood,
      inputData: { idea: "", lyrics, audioUrl: audioUrl ? "uploaded" : null },
      resultText: props.packageResult ?? lyrics,
      scenes: scenes as unknown as unknown[],
      editorSettings: editorSettings ?? {
        ...defaultEditorSettings(),
        aiEdit: { ...defaultAiEditSettings(), enabled: true, style: "viral-tiktok", autoApplyTransitions: true },
      },
    });

  /* The finish is a plain project save — no step-through. The
     scenes' clips already live in My Clips; this saves the whole
     package (song + scenes + clips + edit plan) as one project. */
  const savePackage = async () => {
    if (busy) return;
    setBusy("save");
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(packagePayload()),
      });
      if (!res.ok) throw new Error(t("worldCreateDesk.savePackageFailed"));
      setSaved(true);
      void quest.checkAfter();
    } catch (err) {
      setError(plainErrorText(err, t("worldCreateDesk.savePackageFailedFallback")));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="world-song-video-wizard" className={`space-y-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
      <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {t("worldCreateDesk.wizardHeading")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className={chipCls}>
          {audioFile ? t("worldCreateDesk.wizardSongFile", { name: audioFile.name }) : `Upload the song — auto-transcribes · ${transcribeCostLabel()}`}
          <input type="file" accept="audio/*" className="hidden" data-testid="world-song-video-intake" onChange={(e) => { const f = e.target.files?.[0]; if (f) void intake(f); }} />
        </label>
        {transcribing ? <span className={`text-xs font-semibold ${muted}`}>{t("worldCreateDesk.transcribing")}</span> : null}
      </div>
      <label className="block">
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("worldCreateDesk.lyricsLabel")}</span>
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={3} className={`w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-[#d4af37] bdv-touch-target ${isLight ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]" : "border-white/10 bg-white/5 text-white"}`} />
      </label>
      <button type="button" data-testid="world-song-video-build-scenes" onClick={() => void buildScenes()} disabled={busy !== null || (!audioUrl && !props.packageResult)} className={chipCls}>
        {busy === "scenes" ? t("worldCreateDesk.buildScenesBusy") : audioUrl ? t("worldCreateDesk.buildScenesCost", { cost: analyzeSectionsCost().toLocaleString(i18n.language) }) : t("worldCreateDesk.buildScenesFree")}
      </button>
      {scenes.length > 0 ? (
        <div className="space-y-2" data-testid="world-song-video-scene-review">
          <ClipModelPicker isLight={isLight} settings={clipSettings} onChange={setClipSettings} />
          {scenes.map((scene) => (
            <div key={scene.id} className={`rounded-xl border p-2.5 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-black">{t("worldCreateDesk.sceneLabel", { number: scene.sceneNumber })}</span>
                <span className={`text-[11px] ${muted}`}>{scene.section} · {scene.lyricLine || scene.action}</span>
                <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold bdv-touch-target">
                  <input type="checkbox" checked={scene.approved} onChange={(e) => setScenes((prev) => withSceneApproval(prev, scene.id, e.target.checked))} />
                  {t("worldCreateDesk.keepLabel")}
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {scene.demoClipUrl ? (
                  <span className="text-xs font-bold text-emerald-500">{t("worldCreateDesk.clipMade")}</span>
                ) : scene.approved ? (
                  <button type="button" data-testid="world-song-video-make-clip" onClick={() => makeSceneClip(scene)} disabled={clipBusy !== null} className={chipCls}>
                    {clipBusy === scene.id ? t("worldCreateDesk.makingClip") : t("worldCreateDesk.makeClipCost", { cost: clipPlanCost(clipSettings).toLocaleString(i18n.language) })}
                  </button>
                ) : (
                  <span className={`text-[11px] ${muted}`}>{t("worldCreateDesk.keepToFilm")}</span>
                )}
              </div>
              {scene.demoClipUrl ? <video src={scene.demoClipUrl} controls playsInline className="mt-2 max-h-[200px] w-full rounded-lg" /> : null}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="world-song-video-apply-plan" onClick={() => void applyPlan()} disabled={busy !== null} className={chipCls}>
              {busy === "plan" ? t("worldCreateDesk.applyingPlan") : planApplied ? t("worldCreateDesk.planApplied") : t("worldCreateDesk.applyPlanCost", { cost: aiEditPlanCost().toLocaleString(i18n.language) })}
            </button>
            <button type="button" data-testid="world-song-video-save" onClick={() => void savePackage()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target">
              {busy === "save" ? t("worldCreateDesk.saving") : t("worldCreateDesk.savePackage")}
            </button>
            {props.onSendToEditor ? (
              <button type="button" data-testid="world-song-video-editor" onClick={() => props.onSendToEditor?.(packagePayload())} disabled={busy !== null || props.editorBusy} className={chipCls}>
                {t("worldCreateDesk.openInEditor")}
              </button>
            ) : null}
          </div>
          {saved ? <p className={`text-xs font-semibold ${muted}`}>{planApplied ? t("worldCreateDesk.savedNoteWithPlan") : t("worldCreateDesk.savedNote")}</p> : null}
        </div>
      ) : null}
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      <QuestProgressChip isLight={isLight} lines={quest.lines} />
    </div>
  );
}

/* ─── Video Desk ───────────────────────────────────────────────────── */

export function VideoDesk(props: CreateDeskProps) {
  const { t, i18n } = useTranslation();
  const { isLight } = props;
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  /* The model shelf: one picker governs the desk's clip AND the
     storyboard bench's per-scene clips below it. */
  const [clipSettings, setClipSettings] = useState<ClipSettings>(DEFAULT_CLIP_SETTINGS);
  const [librarySaved, setLibrarySaved] = useState<boolean | null>(null);
  const [state, setState] = useState<CreateDeskJobState>("idle");
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planState, setPlanState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [planText, setPlanText] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editor = useEditorSeed(props);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => stopPolling, []);

  const startPolling = (taskId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/generate-runway-clip/${taskId}`, { headers: await authHeaders() });
        const data = (await res.json()) as Parameters<typeof interpretTaskPoll>[0];
        const read = interpretTaskPoll(data);
        if (typeof data.progress === "number") setProgress(data.progress);
        if (read.done) {
          stopPolling();
          if (read.failed || !read.url) {
            setError(apiErrorMessage(read, t("worldCreateDesk.clipFailed")));
            setState("failed");
          } else {
            setClipUrl(read.url);
            refreshProfile();
            setState("done");
            /* The library save SceneStudio makes the moment a clip
               lands: a desk-made clip goes to My Clips, not just
               this panel. Best-effort — the note under the result
               says honestly whether the library copy landed. */
            void saveGeneratedClipToLibrary(
              authHeaders,
              buildGeneratedClipSavePayload({
                title: prompt.slice(0, 80) || "Video Desk clip",
                prompt,
                videoUrl: read.url,
                runwayJobId: taskId,
              }),
            ).then((ok) => setLibrarySaved(ok));
          }
        }
      } catch {
        stopPolling();
        setError(t("worldCreateDesk.clipNetworkErrorLong"));
        setState("failed");
      }
    }, 5000);
  };

  const run = async () => {
    if (state === "running" || !prompt.trim()) return;
    setState("running");
    setError(null);
    setClipUrl(null);
    setProgress(null);
    setLibrarySaved(null);
    try {
      /* The UGC Ads station's proven pattern: the price is shown,
         the member confirms, and the rail itself charges only on
         success — a failed generation charges nothing. */
      const res = await confirmedFetch("/api/generate-runway-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRunwayClipPayload(prompt, negativePrompt, clipSettings)),
        overrideCost: clipPlanCost(clipSettings),
        overrideFeature: t("worldCreateDesk.confirmClipFeature"),
      });
      if (!res) {
        /* The member declined the price — nothing ran. */
        setState("idle");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { taskId?: string; error?: string; message?: string };
      if (!res.ok || !data.taskId) throw new Error(apiErrorMessage(data, t("worldCreateDesk.clipMakeStartFailed")));
      startPolling(data.taskId);
    } catch (err) {
      setError(plainErrorText(err, t("worldCreateDesk.clipFailed")));
      setState("failed");
    }
  };

  const runPlan = async () => {
    if (planState === "running" || !prompt.trim()) return;
    setPlanState("running");
    setPlanError(null);
    try {
      const token = await getAccessToken();
      const result = await callGenerateApi("/api/generate-video-plan", buildVideoPlanPayload(prompt), token);
      if (!result) throw new Error(t("worldCreateDesk.planStartFailed"));
      setPlanText(result.rawResult);
      if (result.creditsRemaining !== undefined) refreshProfile();
      setPlanState("done");
    } catch (err) {
      setPlanError(plainErrorText(err, t("worldCreateDesk.videoPlanFailed")));
      setPlanState("failed");
    }
  };

  return (
    <div className="space-y-3" data-testid="world-create-video-desk">
      <AdvancedExpander isLight={isLight}>
        <DeskTextField isLight={isLight} label={t("worldCreateDesk.negativePromptLabel")} value={negativePrompt} onChange={setNegativePrompt} />
        <div className="space-y-2">
          <button
            type="button"
            data-testid="world-create-video-plan"
            onClick={runPlan}
            disabled={planState === "running" || !prompt.trim()}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
              isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
            }`}
          >
            {planState === "running" ? t("worldCreateDesk.planning") : t("worldCreateDesk.draftPlanCost", { cost: videoPlanCost().toLocaleString(i18n.language) })}
          </button>
          {planState === "failed" && planError ? (
            <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{planError}</p>
          ) : null}
          {planText ? <TextResult isLight={isLight} title={t("worldCreateDesk.yourVideoPlan")} text={resultExcerpt(planText)} /> : null}
        </div>
      </AdvancedExpander>
      <ClipModelPicker isLight={isLight} settings={clipSettings} onChange={setClipSettings} />
      <CreateDeskRunner
        isLight={isLight}
        promptLabel={t("worldCreateDesk.describeClip")}
        prompt={prompt}
        onPromptChange={setPrompt}
        costVisualBucs={clipPlanCost(clipSettings)}
        state={state}
        errorMessage={error}
        onRun={run}
        runLabel={t("worldCreateDesk.makeClip")}
        result={
          clipUrl ? (
            <div>
              <VideoResult url={clipUrl} title={t("worldCreateDesk.yourClip")} />
              {librarySaved !== null ? (
                <p
                  data-testid="world-create-clip-library-note"
                  className={`mt-2 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}
                >
                  {librarySaved
                    ? t("worldCreateDesk.clipLibrarySaved")
                    : t("worldCreateDesk.clipLibraryFailed")}
                </p>
              ) : null}
              <ResultChips
                isLight={isLight}
                onSendToEditor={
                  props.onOpenEditor
                    ? () =>
                        void editor.send(
                          buildEditorProjectPayload({
                            projectType: "Make a Music Video",
                            title: prompt.slice(0, 80) || "Video Desk clip",
                            inputData: { promptText: prompt, negativePrompt },
                            resultText: clipUrl,
                          }),
                        )
                    : undefined
                }
                editorBusy={editor.busy}
                schedulePrefill={schedulePrefillForMedia(clipUrl, "video", t("worldCreateDesk.scheduleClipCaption"))}
                onMakeAnother={() => {
                  setState("idle");
                  setClipUrl(null);
                  setPrompt("");
                }}
              />
            </div>
          ) : undefined
        }
      />
      {state === "running" && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          {progress !== null
            ? t("worldCreateDesk.clipMakingPct", { pct: Math.round(progress) })
            : t("worldCreateDesk.clipMaking")}
        </p>
      )}
      <StoryboardBench
        isLight={isLight}
        editorBusy={editor.busy}
        clipSettings={clipSettings}
        onSendToEditor={
          props.onOpenEditor
            ? (payload) => {
                void editor.send(payload);
              }
            : undefined
        }
      />
      <StoryboardPlanner
        isLight={isLight}
        editorBusy={editor.busy}
        onSendToEditor={
          props.onOpenEditor
            ? (payload) => {
                void editor.send(payload);
              }
            : undefined
        }
      />
      {/* Video Templates bench (Stack-100 wave 4, item 27 /
          desk #100): the video-template payload's receiving end —
          the rail's catalog, slot filling and the registry-priced
          apply on /api/video-template, stacked under the
          storyboard pair like its Create Wing neighbours. */}
      <VideoTemplateBench isLight={isLight} panelPayload={props.panelPayload ?? null} />
    </div>
  );
}

/* ─── Cover Art Desk ───────────────────────────────────────────────── */

export function CoverArtDesk(props: CreateDeskProps) {
  const { t, i18n } = useTranslation();
  const { isLight } = props;
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const [prompt, setPrompt] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [style, setStyle] = useState("luxury-gold");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [tier, setTier] = useState<"standard" | "premium">("standard");
  const [attribution, setAttribution] = useState(false);
  const [coverHistory, setCoverHistory] = useState<string[]>([]);
  const [showcaseSlug, setShowcaseSlug] = useState<string | null>(null);
  const [showcaseBusy, setShowcaseBusy] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const coverQuest = useQuestProgressChip();
  const [state, setState] = useState<CreateDeskJobState>("idle");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [motionState, setMotionState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [motionUrl, setMotionUrl] = useState<string | null>(null);
  const [motionError, setMotionError] = useState<string | null>(null);
  const [imageState, setImageState] = useState<CreateDeskJobState>("idle");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageModel, setImageModel] = useState<ArtistImageModel>("gen4_image");
  const [artistImageUrl, setArtistImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const imagePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editor = useEditorSeed(props);

  useEffect(() => () => {
    if (imagePollRef.current) clearInterval(imagePollRef.current);
  }, []);

  const run = async () => {
    if (state === "running" || !prompt.trim()) return;
    if (!songTitle.trim() || !artistName.trim()) {
      setError(t("worldCreateDesk.coverNeedsTitleArtist"));
      setState("failed");
      return;
    }
    setState("running");
    setError(null);
    setCoverUrl(null);
    setMotionUrl(null);
    setMotionState("idle");
    setShowcaseSlug(null);
    setShareNote(null);
    void coverQuest.snapshot();
    try {
      const res = await fetch("/api/cover-art", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildCoverArtPayload(prompt, { songTitle, artistName, style, aspectRatio, tier, attribution })),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(apiErrorMessage(data, t("worldCreateDesk.coverFailed")));
      setCoverUrl(data.url);
      setCoverHistory((h) => pushCoverHistory(h, data.url!));
      refreshProfile();
      setState("done");
      void coverQuest.checkAfter();
    } catch (err) {
      setError(plainErrorText(err, t("worldCreateDesk.coverFailed")));
      setState("failed");
    }
  };

  /* Session history restore (2.11): an earlier cover becomes the
     current work again — WITHOUT the previous cover's attachments.
     The motion video and the showcase slug belong to the cover they
     were made/published from, so restoring a different cover clears
     both (a restored cover must never wear another cover's "Live on
     the showcase" link, and it gets its own Publish button back). */
  const restoreCover = (url: string) => {
    if (url === coverUrl) return;
    setCoverUrl(url);
    setState("done");
    setError(null);
    setMotionUrl(null);
    setMotionState("idle");
    setMotionError(null);
    setShowcaseSlug(null);
    setShareNote(null);
  };

  const runMotion = async () => {
    if (!coverUrl || motionState === "running") return;
    setMotionState("running");
    setMotionError(null);
    try {
      const res = await fetch("/api/cover-in-motion/animate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildCoverInMotionPayload(coverUrl)),
      });
      const data = (await res.json().catch(() => ({}))) as { videoUrl?: string; error?: string; message?: string };
      if (!res.ok || !data.videoUrl) throw new Error(apiErrorMessage(data, t("worldCreateDesk.animationFailed")));
      setMotionUrl(data.videoUrl);
      refreshProfile();
      setMotionState("done");
    } catch (err) {
      setMotionError(plainErrorText(err, t("worldCreateDesk.animationFailed")));
      setMotionState("failed");
    }
  };

  const runArtistImage = async () => {
    if (imageState === "running" || !imagePrompt.trim()) return;
    setImageState("running");
    setImageError(null);
    setArtistImageUrl(null);
    try {
      const res = await fetch("/api/generate-artist-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildArtistImagePayload(imagePrompt, imageModel)),
      });
      const data = (await res.json().catch(() => ({}))) as { taskId?: string; status?: string; url?: string | null; error?: string; message?: string };
      if (!res.ok || !data.taskId) throw new Error(apiErrorMessage(data, t("worldCreateDesk.imageStartFailed")));
      if (data.status === "succeeded" && data.url) {
        setArtistImageUrl(data.url);
        refreshProfile();
        setImageState("done");
        return;
      }
      imagePollRef.current = setInterval(async () => {
        try {
          const poll = await fetch(`/api/generate-artist-image/${data.taskId}`, { headers: await authHeaders() });
          const pdata = (await poll.json()) as Parameters<typeof interpretTaskPoll>[0];
          const read = interpretTaskPoll(pdata);
          if (read.done) {
            if (imagePollRef.current) clearInterval(imagePollRef.current);
            if (read.failed || !read.url) {
              setImageError(apiErrorMessage(read, t("worldCreateDesk.imageFailed")));
              setImageState("failed");
            } else {
              setArtistImageUrl(read.url);
              refreshProfile();
              setImageState("done");
            }
          }
        } catch {
          if (imagePollRef.current) clearInterval(imagePollRef.current);
          setImageError(t("worldCreateDesk.imageNetworkError"));
          setImageState("failed");
        }
      }, 5000);
    } catch (err) {
      setImageError(plainErrorText(err, t("worldCreateDesk.imageFailed")));
      setImageState("failed");
    }
  };

  /* Ring 2 (2.11): publish-to-showcase on the cover page's own rail
     (POST /api/showcase/publish, free) and the share menu's tracking
     rail (POST /api/shares) under a copy-link share. */
  const publishToShowcase = async () => {
    if (!coverUrl || showcaseBusy) return;
    setShowcaseBusy(true);
    try {
      const res = await fetch("/api/showcase/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(
          buildShowcasePublishPayload({
            title: songTitle || "Cover art",
            mediaType: "image",
            mediaUrl: coverUrl,
            thumbnailUrl: coverUrl,
            creatorName: artistName,
          }),
        ),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreateDesk.showcasePublishFailed")));
      const slug = showcaseSlugOfResponse(data);
      if (!slug) throw new Error(t("worldCreateDesk.showcaseNoPage"));
      setShowcaseSlug(slug);
    } catch (err) {
      setShareNote(plainErrorText(err, t("worldCreateDesk.showcaseFailed")));
    } finally {
      setShowcaseBusy(false);
    }
  };

  const shareCover = async () => {
    if (!coverUrl) return;
    const text = t("worldCreateDesk.shareCoverText", { title: songTitle || t("worldCreateDesk.mySongLower") });
    try {
      const nav = typeof navigator !== "undefined" ? navigator : null;
      if (nav && typeof nav.share === "function") {
        await nav.share({ title: t("worldCreateDesk.shareCoverTitle"), text, url: coverUrl });
      } else if (nav && nav.clipboard) {
        await nav.clipboard.writeText(`${text}\n${coverUrl}`);
        setShareNote(t("worldCreateDesk.shareLinkCopied"));
      }
      await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildShareTrackPayload({ contentType: "image", channel: "copy" })),
      }).catch(() => {});
    } catch {
      /* sharing dismissed — tracking must never break the desk */
    }
  };

  return (
    <div className="space-y-3" data-testid="world-create-cover-desk">
      <div>
        <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("worldCreateDesk.oneTapVibes")}</p>
        <div className="flex flex-wrap gap-1.5" data-testid="world-cover-preset-grid">
          {COVER_ART_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setStyle(preset.style);
                setPrompt(preset.mood);
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
                style === preset.style
                  ? "border-[#d4af37] bg-[#d4af37] text-black"
                  : isLight
                    ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                    : "border-white/15 text-white/75 hover:text-white"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DeskTextField isLight={isLight} label={t("worldCreateDesk.songTitleLabel")} value={songTitle} onChange={setSongTitle} />
        <DeskTextField isLight={isLight} label={t("worldCreateDesk.artistNameLabel")} value={artistName} onChange={setArtistName} />
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold bdv-touch-target">
        <input type="checkbox" data-testid="world-cover-attribution-toggle" checked={attribution} onChange={(e) => setAttribution(e.target.checked)} />
        {t("worldCreateDesk.attributionLabel")}
      </label>
      <AdvancedExpander isLight={isLight}>
        <div className="grid gap-3 sm:grid-cols-2">
          <DeskSelectField isLight={isLight} label={t("worldCreateDesk.styleLabel")} value={style} onChange={setStyle} options={COVER_ART_STYLES.map((s) => ({ value: s.key, label: s.label }))} />
          <DeskSelectField isLight={isLight} label={t("worldCreateDesk.formatLabel")} value={aspectRatio} onChange={setAspectRatio} options={COVER_ART_RATIOS.map((r) => ({ value: r.key, label: r.label }))} />
          <DeskSelectField
            isLight={isLight}
            label={t("worldCreateDesk.detailLevelLabel")}
            value={tier}
            onChange={(v) => setTier(v as "standard" | "premium")}
            options={[
              { value: "standard", label: t("worldCreateDesk.tierStandard", { cost: coverArtCost("standard") }) },
              { value: "premium", label: t("worldCreateDesk.tierPremium", { cost: coverArtCost("premium") }) },
            ]}
          />
        </div>
        <div className="space-y-2 border-t border-dashed border-[#d4af37]/30 pt-3">
          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("worldCreateDesk.artistImageBench")}
          </p>
          <DeskTextField isLight={isLight} label={t("worldCreateDesk.describeArtistImage")} value={imagePrompt} onChange={setImagePrompt} />
          <DeskSelectField
            isLight={isLight}
            label={t("worldCreateDesk.renderLabel")}
            value={imageModel}
            onChange={(v) => setImageModel(v as ArtistImageModel)}
            options={ARTIST_IMAGE_MODELS.map((m) => ({ value: m.id, label: t("worldCreateDesk.renderOption", { label: m.label, credits: m.credits }) }))}
          />
          <button
            type="button"
            data-testid="world-create-artist-image-run"
            onClick={runArtistImage}
            disabled={imageState === "running" || !imagePrompt.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
          >
            {imageState === "running" ? t("worldCreateDesk.runnerMaking") : t("worldCreateDesk.makeImageCost", { cost: artistImageCost(imageModel).toLocaleString(i18n.language) })}
          </button>
          {imageState === "failed" && imageError ? (
            <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{imageError}</p>
          ) : null}
          {artistImageUrl ? <ImageResult url={artistImageUrl} title={t("worldCreateDesk.yourArtistImage")} /> : null}
        </div>
      </AdvancedExpander>
      <CreateDeskRunner
        isLight={isLight}
        promptLabel={t("worldCreateDesk.describeCover")}
        prompt={prompt}
        onPromptChange={setPrompt}
        costVisualBucs={coverArtCost(tier)}
        state={state}
        errorMessage={error}
        onRun={run}
        runLabel={t("worldCreateDesk.makeCover")}
        result={
          coverUrl ? (
            <div>
              <ImageResult url={coverUrl} title={t("worldCreateDesk.coverFor", { title: songTitle || t("worldCreateDesk.yourSongLower") })} />
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  data-testid="world-create-cover-motion"
                  onClick={runMotion}
                  disabled={motionState === "running"}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
                    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
                  }`}
                >
                  {motionState === "running"
                    ? t("worldCreateDesk.animating")
                    : t("worldCreateDesk.animateCoverCost", { cost: coverInMotionCost().toLocaleString(i18n.language) })}
                </button>
              </div>
              {motionState === "failed" && motionError ? (
                <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{motionError}</p>
              ) : null}
              {motionUrl ? (
                <div className="mt-3">
                  <VideoResult url={motionUrl} title={t("worldCreateDesk.yourCoverInMotion")} />
                </div>
              ) : null}
              <ResultChips
                isLight={isLight}
                onSendToEditor={
                  props.onOpenEditor
                    ? () =>
                        void editor.send(
                          buildEditorProjectPayload({
                            projectType: "Cover Art",
                            title: songTitle || "Cover art",
                            artistName,
                            songTitle,
                            inputData: { mood: prompt, style, aspectRatio, tier },
                            resultText: coverUrl,
                          }),
                        )
                    : undefined
                }
                editorBusy={editor.busy}
                releasePrefill={{ coverUrl, title: songTitle }}
                schedulePrefill={motionUrl ? schedulePrefillForMedia(motionUrl, "video", t("worldCreateDesk.scheduleCoverCaption")) : undefined}
                onMakeAnother={() => {
                  setState("idle");
                  setCoverUrl(null);
                  setMotionUrl(null);
                  setMotionState("idle");
                  setPrompt("");
                }}
              />
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button type="button" data-testid="world-cover-share" onClick={() => void shareCover()} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}>
                  {t("worldCreateDesk.shareCover")}
                </button>
                {showcaseSlug ? (
                  <a data-testid="world-cover-showcase-link" href={`/showcase/${showcaseSlug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 px-3 py-1.5 text-xs font-bold text-emerald-500">
                    {t("worldCreateDesk.showcaseLive")}
                  </a>
                ) : (
                  <button type="button" data-testid="world-cover-showcase" onClick={() => void publishToShowcase()} disabled={showcaseBusy} className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target">
                    {showcaseBusy ? t("worldCreateDesk.chipPublishing") : t("worldCreateDesk.showcasePublish")}
                  </button>
                )}
              </div>
              {shareNote ? <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>{shareNote}</p> : null}
              <QuestProgressChip isLight={isLight} lines={coverQuest.lines} />
            </div>
          ) : undefined
        }
      />
      {coverHistory.length > 1 ? (
        <div data-testid="world-cover-history">
          <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("worldCreateDesk.thisSession")}</p>
          <div className="flex flex-wrap gap-2">
            {coverHistory.map((url) => (
              <button key={url} type="button" onClick={() => restoreCover(url)} className={`overflow-hidden rounded-lg border ${coverUrl === url ? "border-[#d4af37]" : isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
                <img src={url} alt={t("worldCreateDesk.coverFromSessionAlt")} className="h-12 w-12 object-cover" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Thumbnail Desk ───────────────────────────────────────────────── */

export function ThumbnailDesk(props: CreateDeskProps) {
  const { t, i18n } = useTranslation();
  const { isLight } = props;
  const { getAccessToken, refreshProfile } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [artistName, setArtistName] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [platform, setPlatform] = useState("YouTube");
  const [artStyle, setArtStyle] = useState("");
  const [colorTheme, setColorTheme] = useState("");
  const [mood, setMood] = useState("");
  const [featuredText, setFeaturedText] = useState("");
  const [state, setState] = useState<CreateDeskJobState>("idle");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageNote, setImageNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<LibraryAsset[]>([]);
  const editor = useEditorSeed(props);
  const draft = useDraftSaver();
  const thumbQuest = useQuestProgressChip();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const assets = await fetchAssetLibrary(getAccessToken);
        if (!cancelled) setRecent(libraryAssetsOfKind(assets, "image").slice(0, 6));
      } catch {
        /* the recent strip is a nicety — never block the maker on it */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    if (state === "running" || !prompt.trim()) return;
    if (!artistName.trim()) {
      setError(t("worldCreateDesk.thumbnailNeedsArtist"));
      setState("failed");
      return;
    }
    setState("running");
    setError(null);
    setImageUrl(null);
    setImageNote(null);
    draft.reset();
    void thumbQuest.snapshot();
    try {
      const token = await getAccessToken();
      const result = await callGenerateApi(
        "/api/generate-thumbnail",
        buildThumbnailPayload(prompt, { artistName, songTitle, platform, artStyle, colorTheme, mood, featuredText }),
        token,
      );
      if (!result) throw new Error(t("worldCreateDesk.thumbnailStartFailed"));
      setImageUrl(result.thumbnailImageUrl ?? null);
      if (result.imageError) setImageNote(result.imageError);
      if (result.creditsRemaining !== undefined) refreshProfile();
      setState("done");
      void thumbQuest.checkAfter();
    } catch (err) {
      setError(plainErrorText(err, t("worldCreateDesk.thumbnailFailed")));
      setState("failed");
    }
  };

  return (
    <div className="space-y-3" data-testid="world-create-thumbnail-desk">
      <div className="grid gap-3 sm:grid-cols-2">
        <DeskTextField isLight={isLight} label={t("worldCreateDesk.artistNameLabel")} value={artistName} onChange={setArtistName} />
        <DeskTextField isLight={isLight} label={t("worldCreateDesk.songVideoTitleLabel")} value={songTitle} onChange={setSongTitle} />
      </div>
      <AdvancedExpander isLight={isLight}>
        <div className="grid gap-3 sm:grid-cols-2">
          <DeskSelectField
            isLight={isLight}
            label={t("worldCreateDesk.platformLabel")}
            value={platform}
            onChange={setPlatform}
            options={["YouTube", "Spotify", "Apple Music", "SoundCloud", "All Platforms"].map((p) => ({ value: p, label: p }))}
          />
          <DeskSelectField
            isLight={isLight}
            label={t("worldCreateDesk.artStyleLabel")}
            value={artStyle}
            onChange={setArtStyle}
            options={["", "Photo-Realistic", "Illustrated", "Minimalist", "Bold Graphic", "Vintage", "Futuristic", "Cinematic Dark", "Street Art", "Anime", "3D Render"].map((s) => ({ value: s, label: s || t("worldCreateDesk.turboPicks") }))}
          />
          <DeskTextField isLight={isLight} label={t("worldCreateDesk.colorThemeLabel")} value={colorTheme} onChange={setColorTheme} />
          <DeskSelectField isLight={isLight} label={t("worldCreateDesk.moodLabel")} value={mood} onChange={setMood} options={MOOD_OPTIONS.map((m) => ({ value: m, label: m || t("worldCreateDesk.turboPicks") }))} />
        </div>
        <DeskTextField isLight={isLight} label={t("worldCreateDesk.featuredTextLabel")} value={featuredText} onChange={setFeaturedText} />
      </AdvancedExpander>
      <CreateDeskRunner
        isLight={isLight}
        promptLabel={t("worldCreateDesk.describeThumbnail")}
        prompt={prompt}
        onPromptChange={setPrompt}
        costVisualBucs={thumbnailDeskCost()}
        state={state}
        errorMessage={error}
        onRun={run}
        runLabel={t("worldCreateDesk.makeThumbnail")}
        result={
          state === "done" ? (
            <div>
              {imageUrl ? (
                <ImageResult url={imageUrl} title={t("worldCreateDesk.yourThumbnail")} />
              ) : (
                <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                  {imageNote
                    ? t("worldCreateDesk.thumbnailPackageMadeNote", { note: imageNote })
                    : t("worldCreateDesk.thumbnailPackageMade")}
                </p>
              )}
              <ResultChips
                isLight={isLight}
                onSendToEditor={
                  props.onOpenEditor
                    ? () =>
                        void editor.send(
                          buildEditorProjectPayload({
                            projectType: "Thumbnail",
                            title: songTitle || "Thumbnail",
                            artistName,
                            songTitle,
                            inputData: { requests: prompt, platform, artStyle, colorTheme, mood, featuredText },
                            resultText: imageUrl ?? prompt,
                          }),
                        )
                    : undefined
                }
                editorBusy={editor.busy}
                schedulePrefill={imageUrl ? schedulePrefillForMedia(imageUrl, "image", t("worldCreateDesk.scheduleThumbCaption")) : undefined}
                onSaveDraft={() =>
                  void draft.save(
                    buildDraftPayload(THUMBNAIL_DRAFT_WORKFLOW, songTitle || "Thumbnail draft", {
                      formValues: { artistName, songTitle, platform, artStyle, colorTheme, mood, featuredText, requests: prompt },
                      thumbnailImageUrl: imageUrl,
                      timestamp: Date.now(),
                    }),
                  )
                }
                draftSaved={draft.saved}
                onMakeAnother={() => {
                  setState("idle");
                  setImageUrl(null);
                  setPrompt("");
                }}
              />
              <p className={`mt-2 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                {t("worldCreateDesk.thumbnailPriceNote", { cost: thumbnailDeskCost().toLocaleString(i18n.language) })}
              </p>
            </div>
          ) : undefined
        }
      />
      <QuestProgressChip isLight={isLight} lines={thumbQuest.lines} />
      <ThumbnailBenches isLight={isLight} panelPayload={props.panelPayload ?? null} />
      {recent.length > 0 && (
        <div>
          <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("worldCreateDesk.fromLibrary")}
          </p>
          <div className="flex flex-wrap gap-2">
            {recent.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setImageUrl(a.url)}
                className={`overflow-hidden rounded-lg border ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}
                title={a.label}
              >
                <img src={a.url} alt={a.label} className="h-12 w-20 object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
