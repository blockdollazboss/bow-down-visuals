import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { CreateDeskRunner, type CreateDeskJobState } from "./CreateDeskRunner";
import {
  AdvancedExpander,
  DeskSelectField,
  DeskTextField,
  ImageResult,
  PublishedReward,
  QuestProgressChip,
  ResultChips,
  SongAudioRail,
  TextResult,
  VideoResult,
  useDeskAuthHeaders,
  useQuestProgressChip,
  type SongAudioState,
} from "./CreateDeskShared";
import { StoryboardBench } from "./StoryboardBench";
import { StoryboardPlanner } from "./StoryboardPlanner";
import { SongHumBench, SongInspoBench, SongMashupBench } from "./SongDeskTabs";
import type { ShelfPlayerController } from "./ShelfPlayer";
import { ThumbnailBenches } from "./ThumbnailBenches";
import { parseScenes, extractBreakdownContent, type SceneData } from "@/lib/scene-parser";
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
  buildMusicAudioPayload,
  buildPublishTrackPayload,
  buildRunwayClipPayload,
  buildSongPayloadAdvanced,
  buildSongPayloadTurbo,
  buildSongVideoPayloadAdvanced,
  buildSongVideoPayloadTurbo,
  buildThumbnailPayload,
  buildVideoPlanPayload,
  COVER_ART_PRESETS,
  aiEditPlanOfResponse,
  coverArtCost,
  coverInMotionCost,
  distributeHrefForCover,
  interpretTaskPoll,
  musicAudioCost,
  profileIdOfProfilesResponse,
  publishedTrackIdOfResponse,
  resultExcerpt,
  scheduleHrefForMedia,
  showcaseSlugOfResponse,
  transcribeCost,
  transcriptOfResponse,
  vaultsOfResponse,
  withArtistVault,
  withSceneApproval,
  TRANSCRIBE_FORM_FIELD,
  SONG_AUDIO_LENGTH_SECONDS,
  songDeskCost,
  songVideoDeskCost,
  SONG_VIDEO_TURBO_DEFAULTS,
  SONG_DRAFT_WORKFLOW,
  THUMBNAIL_DRAFT_WORKFLOW,
  thumbnailDeskCost,
  videoClipCost,
  videoPlanCost,
  artistImageCost,
  EMPTY_SONG_ADVANCED,
  type SongAdvanced,
  type SongVideoAdvanced,
} from "@/lib/world/create-desks";
import { fetchAssetLibrary, libraryAssetsOfKind, type LibraryAsset } from "@/lib/asset-library";

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
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const [audioState, setAudioState] = useState<SongAudioState>("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedTrackId, setPublishedTrackId] = useState<string | null>(null);
  const [jukeboxSent, setJukeboxSent] = useState(false);

  const reset = () => {
    setAudioState("idle");
    setAudioUrl(null);
    setAudioError(null);
    setPublishBusy(false);
    setPublishError(null);
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
      setAudioError("This package has no music prompt to make audio from — make the song again.");
      setAudioState("failed");
      return;
    }
    setAudioState("running");
    setAudioError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to make the audio.");
      const resp = await generateMusicAudio(token, payload as unknown as GenerateMusicAudioRequest);
      if (!resp) return; // a confirmation was declined — nothing ran
      setAudioUrl(resp.url);
      setAudioState("done");
      refreshProfile();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Audio generation failed.";
      setAudioError(
        msg === "out_of_credits" ? "You're out of Visual Bucs — top up, then make the audio." : msg,
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
      if (!profRes.ok) throw new Error("Couldn't check your creator profile — try publishing again.");
      const profileId = profileIdOfProfilesResponse(await profRes.json().catch(() => null));
      if (!profileId) {
        throw new Error(
          "You don't have a creator profile yet — create one on your profile page, then publish from here.",
        );
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
      if (!res.ok) throw new Error(json.message ?? json.error ?? "Publishing didn't land — try again.");
      const trackId = publishedTrackIdOfResponse(json);
      if (!trackId) {
        throw new Error("Publishing came back without your track — check your profile before trying again.");
      }
      setPublishedTrackId(trackId);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Publishing didn't land — try again.");
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
  const { isLight } = props;
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const quest = useQuestProgressChip();
  const [tab, setTab] = useState<"create" | "inspo" | "mashup" | "hum">("create");
  const [vaults, setVaults] = useState<Array<{ id: string; artistName: string }>>([]);
  const [vaultRaw, setVaultRaw] = useState<Record<string, unknown> | null>(null);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [intakeNote, setIntakeNote] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [adv, setAdv] = useState<SongAdvanced>(EMPTY_SONG_ADVANCED);
  const [state, setState] = useState<CreateDeskJobState>("idle");
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [genHistoryId, setGenHistoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editor = useEditorSeed(props);
  const draft = useDraftSaver();

  const useAdvanced = Object.values(adv).some((v) => v.trim().length > 0);
  const set = (k: keyof SongAdvanced) => (v: string) => setAdv((a) => ({ ...a, [k]: v }));

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
      if (!res.ok) throw new Error(data.error ?? "Transcription failed.");
      const transcript = transcriptOfResponse(data);
      if (!transcript) throw new Error("The transcription came back empty — paste the words instead.");
      setPrompt(transcript.slice(0, 2000));
      setIntakeNote("Transcribed — the words are in the prompt below, ready to make the song.");
      refreshProfile();
    } catch (err) {
      setIntakeNote(err instanceof Error ? err.message : "Transcription failed.");
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
      const token = await getAccessToken();
      const base = useAdvanced ? buildSongPayloadAdvanced(prompt, adv) : buildSongPayloadTurbo(prompt);
      const payload = vaultRaw ? withArtistVault(base, vaultRaw) : base;
      const result = await callGenerateApi("/api/generate-song", payload, token);
      if (!result) throw new Error("The song make didn't start.");
      setRawResult(result.rawResult);
      setGenHistoryId(result.genHistoryId ?? null);
      if (result.creditsRemaining !== undefined) refreshProfile();
      setState("done");
      void quest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Song generation failed.");
      setState("failed");
    }
  };

  const pkg = rawResult ? extractSongPackage(rawResult) : null;
  const title = adv.songTitle || pkg?.bestTitle || "Your song";
  const rail = useSongPublishRail({
    rawResult,
    artistName: adv.artistName,
    title,
    genre: adv.genre,
    onJukeboxAdd: props.onJukeboxAdd,
  });

  const songTabBtn = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-bold transition ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;

  if (tab !== "create") {
    return (
      <div className="space-y-3" data-testid="world-create-song-desk">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Song Desk tabs">
          <button type="button" role="tab" aria-selected={false} onClick={() => setTab("create")} className={songTabBtn(false)}>Create</button>
          <button type="button" role="tab" aria-selected={tab === "inspo"} onClick={() => setTab("inspo")} className={songTabBtn(tab === "inspo")}>Inspo</button>
          <button type="button" role="tab" aria-selected={tab === "mashup"} onClick={() => setTab("mashup")} className={songTabBtn(tab === "mashup")}>Mashup</button>
          <button type="button" role="tab" aria-selected={tab === "hum"} onClick={() => setTab("hum")} className={songTabBtn(tab === "hum")}>Hum to Song</button>
        </div>
        {tab === "inspo" ? <SongInspoBench isLight={isLight} /> : tab === "mashup" ? <SongMashupBench isLight={isLight} /> : <SongHumBench isLight={isLight} />}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="world-create-song-desk">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Song Desk tabs">
        <button type="button" role="tab" aria-selected={true} onClick={() => setTab("create")} className={songTabBtn(true)}>Create</button>
        <button type="button" role="tab" aria-selected={false} onClick={() => setTab("inspo")} className={songTabBtn(false)}>Inspo</button>
        <button type="button" role="tab" aria-selected={false} onClick={() => setTab("mashup")} className={songTabBtn(false)}>Mashup</button>
        <button type="button" role="tab" aria-selected={false} onClick={() => setTab("hum")} className={songTabBtn(false)}>Hum to Song</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {vaults.length > 0 ? (
          <DeskSelectField
            isLight={isLight}
            label="Artist Vault preset"
            value={typeof vaultRaw?.["id"] === "string" ? (vaultRaw["id"] as string) : ""}
            onChange={(v) => void loadVault(v)}
            options={[{ value: "", label: "No preset" }, ...vaults.map((v) => ({ value: v.id, label: v.artistName }))]}
          />
        ) : null}
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"}`}>
          {intakeBusy ? "Transcribing…" : `Upload a song + transcribe · ${transcribeCost().toLocaleString("en-US")} Visual Bucs`}
          <input type="file" accept="audio/*" className="hidden" data-testid="world-song-intake-upload" onChange={(e) => { const f = e.target.files?.[0]; if (f) void intakeFile(f); }} />
        </label>
        {intakeNote ? <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>{intakeNote}</span> : null}
      </div>
      <AdvancedExpander isLight={isLight}>
        <div className="grid gap-3 sm:grid-cols-2">
          <DeskTextField isLight={isLight} label="Artist name" value={adv.artistName} onChange={set("artistName")} />
          <DeskTextField isLight={isLight} label="Song title" value={adv.songTitle} onChange={set("songTitle")} />
          <DeskSelectField isLight={isLight} label="Genre" value={adv.genre} onChange={set("genre")} options={GENRE_OPTIONS.map((g) => ({ value: g, label: g || "Turbo picks" }))} />
          <DeskSelectField isLight={isLight} label="Mood" value={adv.mood} onChange={set("mood")} options={MOOD_OPTIONS.map((m) => ({ value: m, label: m || "Turbo picks" }))} />
          <DeskSelectField isLight={isLight} label="Clean or explicit" value={adv.cleanOrExplicit} onChange={set("cleanOrExplicit")} options={[{ value: "", label: "Turbo picks" }, { value: "Clean", label: "Clean" }, { value: "Explicit", label: "Explicit" }]} />
          <DeskSelectField isLight={isLight} label="Song length" value={adv.songLength} onChange={set("songLength")} options={LENGTH_OPTIONS.map((l) => ({ value: l, label: l || "Turbo picks" }))} />
          <DeskTextField isLight={isLight} label="Voice style" value={adv.voiceStyle} onChange={set("voiceStyle")} />
          <DeskTextField isLight={isLight} label="Beat style" value={adv.beatStyle} onChange={set("beatStyle")} />
        </div>
        <DeskTextField isLight={isLight} label="Special instructions" value={adv.specialInstructions} onChange={set("specialInstructions")} />
      </AdvancedExpander>
      <CreateDeskRunner
        isLight={isLight}
        promptLabel="Describe the song"
        prompt={prompt}
        onPromptChange={setPrompt}
        costVisualBucs={songDeskCost()}
        state={state}
        errorMessage={error}
        onRun={run}
        runLabel="Make the song"
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
              {rail.published ? (
                <PublishedReward isLight={isLight} title={title} jukeboxSent={rail.jukeboxSent} />
              ) : (
                <p className={`mt-2 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                  The full package — lyrics, hook, video idea and cover prompt — rides the draft and the editor seed.
                  Make the audio, publish it to your profile right here, and the jukebox chip lights up.
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
      if (!result) throw new Error("The song + video make didn't start.");
      setRawResult(result.rawResult);
      setGenHistoryId(result.genHistoryId ?? null);
      if (result.creditsRemaining !== undefined) refreshProfile();
      setState("done");
      void quest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Song + video generation failed.");
      setState("failed");
    }
  };

  const pkg = rawResult ? extractSongPackage(rawResult) : null;
  const title = adv.songTitle || pkg?.bestTitle || "Your song + video";
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
          <DeskTextField isLight={isLight} label="Artist name" value={adv.artistName} onChange={set("artistName")} />
          <DeskTextField isLight={isLight} label="Song title" value={adv.songTitle} onChange={set("songTitle")} />
          <DeskSelectField isLight={isLight} label="Genre" value={adv.genre} onChange={set("genre")} options={GENRE_OPTIONS.map((g) => ({ value: g, label: g || "Turbo picks" }))} />
          <DeskSelectField isLight={isLight} label="Mood" value={adv.mood} onChange={set("mood")} options={MOOD_OPTIONS.map((m) => ({ value: m, label: m || "Turbo picks" }))} />
          <DeskTextField isLight={isLight} label="Video style" value={adv.videoStyle} onChange={set("videoStyle")} />
          <DeskTextField isLight={isLight} label="Platform" value={adv.platform} onChange={set("platform")} placeholder="TikTok / Reels / Shorts - 9:16" />
          <DeskTextField isLight={isLight} label="Voice style" value={adv.voiceStyle} onChange={set("voiceStyle")} />
          <DeskTextField isLight={isLight} label="Beat style" value={adv.beatStyle} onChange={set("beatStyle")} />
        </div>
        <DeskTextField isLight={isLight} label="Special instructions" value={adv.specialInstructions} onChange={set("specialInstructions")} />
      </AdvancedExpander>
      <CreateDeskRunner
        isLight={isLight}
        promptLabel="Describe the song and its video"
        prompt={prompt}
        onPromptChange={setPrompt}
        costVisualBucs={songVideoDeskCost()}
        state={state}
        errorMessage={error}
        onRun={run}
        runLabel="Make song + video"
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
   a project (POST /api/projects, the page's save shape). */

function SongVideoWizard(props: {
  isLight: boolean;
  packageResult: string | null;
  artistName: string;
  onSendToEditor?: (payload: Record<string, unknown>) => void;
  editorBusy?: boolean;
}) {
  const { isLight } = props;
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
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

  const lyrics = transcript.trim();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const chipCls = `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
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
      if (!res.ok) throw new Error(data.error ?? "Transcription failed.");
      const text = transcriptOfResponse(data);
      if (!text) throw new Error("We couldn't auto-transcribe this audio — paste the lyrics below to continue.");
      setTranscript(text);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed.");
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
        if (parsed.length === 0) throw new Error("The package came back without scenes — add more detail and make it again.");
        setScenes(parsed);
      } else {
        throw new Error("Upload a song or make the package above first — scenes come from one of those.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scene building failed.");
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
      if (!res.ok) throw new Error(data.error ?? "The edit plan didn't land.");
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
      setError(err instanceof Error ? err.message : "The edit plan didn't land — the package still saves without it.");
    } finally {
      setBusy(null);
    }
  };

  const savePackage = async () => {
    if (busy) return;
    setBusy("save");
    setError(null);
    const payload = buildSongVideoProjectPayload({
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
    try {
      if (props.onSendToEditor) {
        props.onSendToEditor(payload);
      } else {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Saving the package didn't land — try again.");
      }
      setSaved(true);
      void quest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saving the package failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="world-song-video-wizard" className={`space-y-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
      <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        Finish the package — upload, scenes, auto-edit
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className={chipCls}>
          {audioFile ? `Song file: ${audioFile.name}` : `Upload the song — auto-transcribes · ${transcribeCost().toLocaleString("en-US")} Visual Bucs`}
          <input type="file" accept="audio/*" className="hidden" data-testid="world-song-video-intake" onChange={(e) => { const f = e.target.files?.[0]; if (f) void intake(f); }} />
        </label>
        {transcribing ? <span className={`text-xs font-semibold ${muted}`}>Transcribing…</span> : null}
      </div>
      <label className="block">
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Lyrics (from the transcription, or paste your own)</span>
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={3} className={`w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-[#d4af37] ${isLight ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]" : "border-white/10 bg-white/5 text-white"}`} />
      </label>
      <button type="button" data-testid="world-song-video-build-scenes" onClick={() => void buildScenes()} disabled={busy !== null || (!audioUrl && !props.packageResult)} className={chipCls}>
        {busy === "scenes" ? "Building scenes…" : audioUrl ? `Build scenes from my song · includes analysis ${analyzeSectionsCost().toLocaleString("en-US")} Visual Bucs` : "Review the package's scenes · Free"}
      </button>
      {scenes.length > 0 ? (
        <div className="space-y-2" data-testid="world-song-video-scene-review">
          {scenes.map((scene) => (
            <div key={scene.id} className={`flex flex-wrap items-center gap-2 rounded-xl border p-2.5 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}>
              <span className="text-xs font-black">Scene {scene.sceneNumber}</span>
              <span className={`text-[11px] ${muted}`}>{scene.section} · {scene.lyricLine || scene.action}</span>
              <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold">
                <input type="checkbox" checked={scene.approved} onChange={(e) => setScenes((prev) => withSceneApproval(prev, scene.id, e.target.checked))} />
                Keep
              </label>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="world-song-video-apply-plan" onClick={() => void applyPlan()} disabled={busy !== null} className={chipCls}>
              {busy === "plan" ? "Applying…" : planApplied ? "Auto-edit plan applied ✓" : `Apply the auto-edit plan · ${aiEditPlanCost().toLocaleString("en-US")} Visual Bucs`}
            </button>
            <button type="button" data-testid="world-song-video-save" onClick={() => void savePackage()} disabled={busy !== null || props.editorBusy} className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50">
              {props.onSendToEditor ? "Save + open in the editor" : "Save the finished package"}
            </button>
          </div>
          {saved ? <p className={`text-xs font-semibold ${muted}`}>Saved — the finished package is a project now{planApplied ? ", auto-edit plan riding inside it" : ""}.</p> : null}
        </div>
      ) : null}
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      <QuestProgressChip isLight={isLight} lines={quest.lines} />
    </div>
  );
}

/* ─── Video Desk ───────────────────────────────────────────────────── */

export function VideoDesk(props: CreateDeskProps) {
  const { isLight } = props;
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
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
            setError(read.error ?? "Clip generation failed.");
            setState("failed");
          } else {
            setClipUrl(read.url);
            refreshProfile();
            setState("done");
          }
        }
      } catch {
        stopPolling();
        setError("Network error while the clip was making — check the desk again in a moment.");
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
    try {
      const res = await fetch("/api/generate-runway-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildRunwayClipPayload(prompt, negativePrompt)),
      });
      const data = (await res.json().catch(() => ({}))) as { taskId?: string; error?: string };
      if (!res.ok || !data.taskId) throw new Error(data.error ?? "The clip make didn't start.");
      startPolling(data.taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clip generation failed.");
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
      if (!result) throw new Error("The plan didn't start.");
      setPlanText(result.rawResult);
      if (result.creditsRemaining !== undefined) refreshProfile();
      setPlanState("done");
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Video plan failed.");
      setPlanState("failed");
    }
  };

  return (
    <div className="space-y-3" data-testid="world-create-video-desk">
      <AdvancedExpander isLight={isLight}>
        <DeskTextField isLight={isLight} label="Keep out of the clip (negative prompt)" value={negativePrompt} onChange={setNegativePrompt} />
        <div className="space-y-2">
          <button
            type="button"
            data-testid="world-create-video-plan"
            onClick={runPlan}
            disabled={planState === "running" || !prompt.trim()}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
              isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
            }`}
          >
            {planState === "running" ? "Planning…" : `Draft a video plan first · ${videoPlanCost().toLocaleString("en-US")} Visual Bucs`}
          </button>
          {planState === "failed" && planError ? (
            <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{planError}</p>
          ) : null}
          {planText ? <TextResult isLight={isLight} title="Your video plan" text={resultExcerpt(planText)} /> : null}
        </div>
      </AdvancedExpander>
      <CreateDeskRunner
        isLight={isLight}
        promptLabel="Describe the clip"
        prompt={prompt}
        onPromptChange={setPrompt}
        costVisualBucs={videoClipCost()}
        state={state}
        errorMessage={error}
        onRun={run}
        runLabel="Make the clip"
        result={
          clipUrl ? (
            <div>
              <VideoResult url={clipUrl} title="Your clip" />
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
                scheduleHref={scheduleHrefForMedia(clipUrl, "video", "My new clip — made with Bow Down Visuals")}
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
          Making your clip{progress !== null ? ` — ${Math.round(progress)}%` : ""}…
        </p>
      )}
      <StoryboardBench
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
    </div>
  );
}

/* ─── Cover Art Desk ───────────────────────────────────────────────── */

export function CoverArtDesk(props: CreateDeskProps) {
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
      setError("The cover maker needs the song title and artist name — both are just above the prompt.");
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
      if (!res.ok || !data.url) throw new Error(data.error ?? "Cover art generation failed.");
      setCoverUrl(data.url);
      setCoverHistory((h) => [data.url!, ...h].slice(0, 12));
      refreshProfile();
      setState("done");
      void coverQuest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cover art generation failed.");
      setState("failed");
    }
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
      if (!res.ok || !data.videoUrl) throw new Error(data.message || data.error || "Animation failed.");
      setMotionUrl(data.videoUrl);
      refreshProfile();
      setMotionState("done");
    } catch (err) {
      setMotionError(err instanceof Error ? err.message : "Animation failed.");
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
      if (!res.ok || !data.taskId) throw new Error(data.message ?? data.error ?? "The image make didn't start.");
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
              setImageError(read.error ?? "Image generation failed.");
              setImageState("failed");
            } else {
              setArtistImageUrl(read.url);
              refreshProfile();
              setImageState("done");
            }
          }
        } catch {
          if (imagePollRef.current) clearInterval(imagePollRef.current);
          setImageError("Network error while the image was making.");
          setImageState("failed");
        }
      }, 5000);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Image generation failed.");
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
      if (!res.ok) throw new Error(data.error ?? "Publishing to the showcase didn't land.");
      const slug = showcaseSlugOfResponse(data);
      if (!slug) throw new Error("The showcase came back without your page — check the showcase before trying again.");
      setShowcaseSlug(slug);
    } catch (err) {
      setShareNote(err instanceof Error ? err.message : "Showcase publishing failed.");
    } finally {
      setShowcaseBusy(false);
    }
  };

  const shareCover = async () => {
    if (!coverUrl) return;
    const text = `Cover art for "${songTitle || "my song"}" — made with Bow Down Visuals`;
    try {
      const nav = typeof navigator !== "undefined" ? navigator : null;
      if (nav && typeof nav.share === "function") {
        await nav.share({ title: "Bow Down Visuals — Cover Art", text, url: coverUrl });
      } else if (nav && nav.clipboard) {
        await nav.clipboard.writeText(`${text}\n${coverUrl}`);
        setShareNote("Share link copied.");
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
        <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>One-tap vibes</p>
        <div className="flex flex-wrap gap-1.5" data-testid="world-cover-preset-grid">
          {COVER_ART_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setStyle(preset.style);
                setPrompt(preset.mood);
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
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
        <DeskTextField isLight={isLight} label="Song title" value={songTitle} onChange={setSongTitle} />
        <DeskTextField isLight={isLight} label="Artist name" value={artistName} onChange={setArtistName} />
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold">
        <input type="checkbox" data-testid="world-cover-attribution-toggle" checked={attribution} onChange={(e) => setAttribution(e.target.checked)} />
        Made-with credit on the cover (attribution)
      </label>
      <AdvancedExpander isLight={isLight}>
        <div className="grid gap-3 sm:grid-cols-2">
          <DeskSelectField isLight={isLight} label="Style" value={style} onChange={setStyle} options={COVER_ART_STYLES.map((s) => ({ value: s.key, label: s.label }))} />
          <DeskSelectField isLight={isLight} label="Format" value={aspectRatio} onChange={setAspectRatio} options={COVER_ART_RATIOS.map((r) => ({ value: r.key, label: r.label }))} />
          <DeskSelectField
            isLight={isLight}
            label="Detail level"
            value={tier}
            onChange={(v) => setTier(v as "standard" | "premium")}
            options={[
              { value: "standard", label: `Standard · ${coverArtCost("standard")} Visual Bucs` },
              { value: "premium", label: `Premium Detail · ${coverArtCost("premium")} Visual Bucs` },
            ]}
          />
        </div>
        <div className="space-y-2 border-t border-dashed border-[#d4af37]/30 pt-3">
          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            Artist image bench
          </p>
          <DeskTextField isLight={isLight} label="Describe the artist image" value={imagePrompt} onChange={setImagePrompt} />
          <DeskSelectField
            isLight={isLight}
            label="Render"
            value={imageModel}
            onChange={(v) => setImageModel(v as ArtistImageModel)}
            options={ARTIST_IMAGE_MODELS.map((m) => ({ value: m.id, label: `${m.label} · ${m.credits} Visual Bucs` }))}
          />
          <button
            type="button"
            data-testid="world-create-artist-image-run"
            onClick={runArtistImage}
            disabled={imageState === "running" || !imagePrompt.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50"
          >
            {imageState === "running" ? "Making it…" : `Make the image · ${artistImageCost(imageModel).toLocaleString("en-US")} Visual Bucs`}
          </button>
          {imageState === "failed" && imageError ? (
            <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{imageError}</p>
          ) : null}
          {artistImageUrl ? <ImageResult url={artistImageUrl} title="Your artist image" /> : null}
        </div>
      </AdvancedExpander>
      <CreateDeskRunner
        isLight={isLight}
        promptLabel="Describe the cover — mood and art direction"
        prompt={prompt}
        onPromptChange={setPrompt}
        costVisualBucs={coverArtCost(tier)}
        state={state}
        errorMessage={error}
        onRun={run}
        runLabel="Make the cover"
        result={
          coverUrl ? (
            <div>
              <ImageResult url={coverUrl} title={`Cover for ${songTitle || "your song"}`} />
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  data-testid="world-create-cover-motion"
                  onClick={runMotion}
                  disabled={motionState === "running"}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
                  }`}
                >
                  {motionState === "running"
                    ? "Animating…"
                    : `Animate this cover · ${coverInMotionCost().toLocaleString("en-US")} Visual Bucs`}
                </button>
              </div>
              {motionState === "failed" && motionError ? (
                <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{motionError}</p>
              ) : null}
              {motionUrl ? (
                <div className="mt-3">
                  <VideoResult url={motionUrl} title="Your cover, in motion" />
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
                releaseHref={distributeHrefForCover(coverUrl, songTitle)}
                scheduleHref={motionUrl ? scheduleHrefForMedia(motionUrl, "video", "My cover visualizer — made with Bow Down Visuals") : undefined}
                onMakeAnother={() => {
                  setState("idle");
                  setCoverUrl(null);
                  setMotionUrl(null);
                  setMotionState("idle");
                  setPrompt("");
                }}
              />
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button type="button" data-testid="world-cover-share" onClick={() => void shareCover()} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"}`}>
                  Share this cover
                </button>
                {showcaseSlug ? (
                  <a data-testid="world-cover-showcase-link" href={`/showcase/${showcaseSlug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 px-3 py-1.5 text-xs font-bold text-emerald-500">
                    Live on the showcase — view it
                  </a>
                ) : (
                  <button type="button" data-testid="world-cover-showcase" onClick={() => void publishToShowcase()} disabled={showcaseBusy} className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50">
                    {showcaseBusy ? "Publishing…" : "Publish to the showcase · Free"}
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
          <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>This session</p>
          <div className="flex flex-wrap gap-2">
            {coverHistory.map((url) => (
              <button key={url} type="button" onClick={() => setCoverUrl(url)} className={`overflow-hidden rounded-lg border ${coverUrl === url ? "border-[#d4af37]" : isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
                <img src={url} alt="Cover from this session" className="h-12 w-12 object-cover" />
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
      setError("The thumbnail maker needs your artist name — it's just above the prompt.");
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
      if (!result) throw new Error("The thumbnail make didn't start.");
      setImageUrl(result.thumbnailImageUrl ?? null);
      if (result.imageError) setImageNote(result.imageError);
      if (result.creditsRemaining !== undefined) refreshProfile();
      setState("done");
      void thumbQuest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thumbnail generation failed.");
      setState("failed");
    }
  };

  return (
    <div className="space-y-3" data-testid="world-create-thumbnail-desk">
      <div className="grid gap-3 sm:grid-cols-2">
        <DeskTextField isLight={isLight} label="Artist name" value={artistName} onChange={setArtistName} />
        <DeskTextField isLight={isLight} label="Song / video title" value={songTitle} onChange={setSongTitle} />
      </div>
      <AdvancedExpander isLight={isLight}>
        <div className="grid gap-3 sm:grid-cols-2">
          <DeskSelectField
            isLight={isLight}
            label="Platform"
            value={platform}
            onChange={setPlatform}
            options={["YouTube", "Spotify", "Apple Music", "SoundCloud", "All Platforms"].map((p) => ({ value: p, label: p }))}
          />
          <DeskSelectField
            isLight={isLight}
            label="Art style"
            value={artStyle}
            onChange={setArtStyle}
            options={["", "Photo-Realistic", "Illustrated", "Minimalist", "Bold Graphic", "Vintage", "Futuristic", "Cinematic Dark", "Street Art", "Anime", "3D Render"].map((s) => ({ value: s, label: s || "Turbo picks" }))}
          />
          <DeskTextField isLight={isLight} label="Color theme" value={colorTheme} onChange={setColorTheme} />
          <DeskSelectField isLight={isLight} label="Mood" value={mood} onChange={setMood} options={MOOD_OPTIONS.map((m) => ({ value: m, label: m || "Turbo picks" }))} />
        </div>
        <DeskTextField isLight={isLight} label="Featured text" value={featuredText} onChange={setFeaturedText} />
      </AdvancedExpander>
      <CreateDeskRunner
        isLight={isLight}
        promptLabel="What should the thumbnail shout?"
        prompt={prompt}
        onPromptChange={setPrompt}
        costVisualBucs={thumbnailDeskCost()}
        state={state}
        errorMessage={error}
        onRun={run}
        runLabel="Make the thumbnail"
        result={
          state === "done" ? (
            <div>
              {imageUrl ? (
                <ImageResult url={imageUrl} title="Your thumbnail" />
              ) : (
                <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                  The thumbnail package is made{imageNote ? ` — the image itself didn't land: ${imageNote}` : ""}. Its art
                  direction rides the draft and the editor seed below.
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
                scheduleHref={imageUrl ? scheduleHrefForMedia(imageUrl, "image", "My new thumbnail — made with Bow Down Visuals") : undefined}
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
                Price is up to {thumbnailDeskCost().toLocaleString("en-US")} Visual Bucs — the text package plus the
                image when it lands, exactly as the Thumbnail Studio quotes it.
              </p>
            </div>
          ) : undefined
        }
      />
      <QuestProgressChip isLight={isLight} lines={thumbQuest.lines} />
      <ThumbnailBenches isLight={isLight} />
      {recent.length > 0 && (
        <div>
          <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            From your library
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
