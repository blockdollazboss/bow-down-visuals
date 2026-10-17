import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { CreateDeskRunner, type CreateDeskJobState } from "./CreateDeskRunner";
import {
  AdvancedExpander,
  DeskSelectField,
  DeskTextField,
  ImageResult,
  PublishedReward,
  ResultChips,
  SongAudioRail,
  TextResult,
  VideoResult,
  useDeskAuthHeaders,
  type SongAudioState,
} from "./CreateDeskShared";
import { callGenerateApi } from "@/lib/generate-api";
import { generateMusicAudio, type GenerateMusicAudioRequest } from "@/lib/generate-music-audio";
import { extractSongPackage } from "@/lib/hub-song";
import { COVER_ART_RATIOS, COVER_ART_STYLES } from "@/lib/cover-art";
import type { ArtistImageModel } from "@/components/generate-artist-image";
import { ARTIST_IMAGE_MODELS } from "@/components/generate-artist-image";
import {
  buildArtistImagePayload,
  buildCoverArtPayload,
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
  coverArtCost,
  coverInMotionCost,
  distributeHrefForCover,
  interpretTaskPoll,
  musicAudioCost,
  profileIdOfProfilesResponse,
  publishedTrackIdOfResponse,
  resultExcerpt,
  scheduleHrefForMedia,
  SONG_AUDIO_LENGTH_SECONDS,
  songDeskCost,
  songVideoDeskCost,
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

  const run = async () => {
    if (state === "running" || !prompt.trim()) return;
    setState("running");
    setError(null);
    setRawResult(null);
    draft.reset();
    rail.reset();
    try {
      const token = await getAccessToken();
      const payload = useAdvanced ? buildSongPayloadAdvanced(prompt, adv) : buildSongPayloadTurbo(prompt);
      const result = await callGenerateApi("/api/generate-song", payload, token);
      if (!result) throw new Error("The song make didn't start.");
      setRawResult(result.rawResult);
      setGenHistoryId(result.genHistoryId ?? null);
      if (result.creditsRemaining !== undefined) refreshProfile();
      setState("done");
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

  return (
    <div className="space-y-3" data-testid="world-create-song-desk">
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

  const useAdvanced = Object.values(adv).some((v) => v.trim().length > 0);
  const set = (k: keyof SongVideoAdvanced) => (v: string) => setAdv((a) => ({ ...a, [k]: v }));

  const run = async () => {
    if (state === "running" || !prompt.trim()) return;
    setState("running");
    setError(null);
    setRawResult(null);
    rail.reset();
    try {
      const token = await getAccessToken();
      const payload = useAdvanced ? buildSongVideoPayloadAdvanced(prompt, adv) : buildSongVideoPayloadTurbo(prompt);
      const result = await callGenerateApi("/api/generate-song-video", payload, token);
      if (!result) throw new Error("The song + video make didn't start.");
      setRawResult(result.rawResult);
      setGenHistoryId(result.genHistoryId ?? null);
      if (result.creditsRemaining !== undefined) refreshProfile();
      setState("done");
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
    try {
      const res = await fetch("/api/cover-art", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildCoverArtPayload(prompt, { songTitle, artistName, style, aspectRatio, tier })),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Cover art generation failed.");
      setCoverUrl(data.url);
      refreshProfile();
      setState("done");
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

  return (
    <div className="space-y-3" data-testid="world-create-cover-desk">
      <div className="grid gap-3 sm:grid-cols-2">
        <DeskTextField isLight={isLight} label="Song title" value={songTitle} onChange={setSongTitle} />
        <DeskTextField isLight={isLight} label="Artist name" value={artistName} onChange={setArtistName} />
      </div>
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
            </div>
          ) : undefined
        }
      />
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
