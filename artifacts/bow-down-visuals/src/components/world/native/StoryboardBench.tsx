import { useEffect, useRef, useState } from "react";
import { Check, Clapperboard, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { callGenerateApi } from "@/lib/generate-api";
import { extractBreakdownContent, parseScenes, type SceneData } from "@/lib/scene-parser";
import type { SongStructure } from "@/lib/song-structure";
import { runAudioSceneFlow } from "@/lib/generate-scenes-from-audio-flow";
import {
  analyzeSectionsCost,
  buildAnalyzeSectionsPayload,
  buildRunwayClipPayload,
  buildStoryboardDraftPayload,
  buildStoryboardProjectPayload,
  buildVideoPlanPayload,
  interpretTaskPoll,
  storyboardStepOf,
  transcribeCost,
  videoClipCost,
  videoPlanCost,
  withSceneApproval,
  withSceneClip,
} from "@/lib/world/create-desks";
import {
  QuestProgressChip,
  useDeskAuthHeaders,
  useQuestProgressChip,
} from "./CreateDeskShared";

/* ─── Ring 2 (2.3) — the storyboard bench ───────────────────────────
   make-video.tsx's storyboard machinery docked at the Video Desk
   (and reused by the Song + Video wizard's scene step): lyrics →
   section analysis (POST /api/analyze-sections) → scenes (from the
   audio flow or the video plan's parsed breakdown) → per-scene
   review + approval → per-scene clips (POST
   /api/generate-runway-clip, polled like the page) → autosave
   (POST /api/drafts, workflow "make-video") → saved project
   (POST /api/projects, make-video's performSave shape) that the
   editor step-through seeds from. Every price is shown before its
   step runs, from the registry via lib/world/create-desks. */

export function StoryboardBench(props: {
  isLight: boolean;
  /** Save-as-project + step through to the seeded editor. */
  onSendToEditor?: (payload: Record<string, unknown>) => void;
  editorBusy?: boolean;
  /** Extra scenes source for the Song+Video wizard: the finished
   *  package's raw text, parsed into scenes on demand. */
  packageResult?: string | null;
  onScenesReady?: (scenes: SceneData[]) => void;
}) {
  const { isLight } = props;
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const quest = useQuestProgressChip();
  const [lyrics, setLyrics] = useState("");
  const [structure, setStructure] = useState<SongStructure | null>(null);
  const [scenes, setScenes] = useState<SceneData[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [savedProject, setSavedProject] = useState(false);
  const [clipBusy, setClipBusy] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const approvedScenes = scenes.filter((s) => s.approved);
  const clipped = approvedScenes.filter((s) => s.demoClipUrl).length;
  /* Approval is an explicit per-scene checkbox (default off = decided
     "don't film"), so every scene present counts as decided and the
     machine's review step is "scenes exist, none approved yet". */
  const step = storyboardStepOf({
    hasLyrics: lyrics.trim().length >= 10,
    hasStructure: structure !== null,
    sceneCount: scenes.length,
    decidedCount: scenes.length,
    approvedCount: approvedScenes.length,
    clippedApprovedCount: clipped,
  });

  /* Autosave — the page's server draft, debounced, whenever the
     storyboard's truth changes. Best-effort like the page's. */
  useEffect(() => {
    if (scenes.length === 0 && !structure) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (async () => {
        try {
          await fetch("/api/drafts", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(await authHeaders()) },
            body: JSON.stringify(
              buildStoryboardDraftPayload({
                title: "Storyboard — Video Desk",
                formValues: { lyrics },
                rawResult: "",
                scenes: scenes as unknown as unknown[],
                songStructure: structure,
              }),
            ),
          });
        } catch {
          /* autosave is a convenience — never mask the work */
        }
      })();
    }, 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, structure]);

  const analyze = async () => {
    if (busy || lyrics.trim().length < 10) return;
    setBusy("analyze");
    setError(null);
    void quest.snapshot();
    try {
      const res = await fetch("/api/analyze-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildAnalyzeSectionsPayload(lyrics)),
      });
      if (!res.ok) throw new Error("Section analysis didn't land — nothing was charged for a failed analysis.");
      setStructure((await res.json()) as SongStructure);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Section analysis failed.");
    } finally {
      setBusy(null);
    }
  };

  const scenesFromAudio = async () => {
    if (busy || !audioUrl) return;
    setBusy("audio-scenes");
    setError(null);
    try {
      const flow = await runAudioSceneFlow({
        lyrics,
        audioUrl,
        audioFile,
        songStructure: structure,
        getAccessToken,
      });
      if (!flow) return;
      setStructure(flow.songStructure);
      setScenes(flow.scenes);
      props.onScenesReady?.(flow.scenes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scenes from your song didn't land.");
    } finally {
      setBusy(null);
    }
  };

  const scenesFromPlan = async () => {
    if (busy) return;
    setBusy("plan-scenes");
    setError(null);
    try {
      const token = await getAccessToken();
      const source = props.packageResult ?? lyrics;
      const result = await callGenerateApi("/api/generate-video-plan", buildVideoPlanPayload(source), token);
      if (!result) throw new Error("The video plan didn't start.");
      const parsed = parseScenes(extractBreakdownContent(result.rawResult));
      if (parsed.length === 0) throw new Error("The plan came back without scenes — try again with more detail.");
      setScenes(parsed);
      props.onScenesReady?.(parsed);
      if (result.creditsRemaining !== undefined) refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scene building failed.");
    } finally {
      setBusy(null);
    }
  };

  const makeClip = (scene: SceneData) => {
    if (clipBusy) return;
    setClipBusy(scene.id);
    setError(null);
    void (async () => {
      try {
        const res = await fetch("/api/generate-runway-clip", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify(buildRunwayClipPayload(scene.aiVideoPrompt || scene.action || `Scene ${scene.sceneNumber}`, scene.negativePrompt ?? "")),
        });
        const data = (await res.json().catch(() => ({}))) as { taskId?: string; error?: string };
        if (!res.ok || !data.taskId) throw new Error(data.error ?? "The clip make didn't start.");
        const taskId = data.taskId;
        pollRef.current = setInterval(async () => {
          try {
            const poll = await fetch(`/api/generate-runway-clip/${taskId}`, { headers: await authHeaders() });
            const pdata = (await poll.json()) as Parameters<typeof interpretTaskPoll>[0];
            const read = interpretTaskPoll(pdata);
            if (read.done) {
              if (pollRef.current) clearInterval(pollRef.current);
              setClipBusy(null);
              if (read.failed || !read.url) {
                setError(read.error ?? "Clip generation failed.");
              } else {
                setScenes((prev) => withSceneClip(prev, scene.id, read.url!));
                refreshProfile();
              }
            }
          } catch {
            if (pollRef.current) clearInterval(pollRef.current);
            setClipBusy(null);
            setError("Network error while the clip was making.");
          }
        }, 5000);
      } catch (err) {
        setClipBusy(null);
        setError(err instanceof Error ? err.message : "Clip generation failed.");
      }
    })();
  };

  const saveProject = async () => {
    if (busy) return;
    setBusy("save");
    setError(null);
    const payload = buildStoryboardProjectPayload({
      title: "Video Desk storyboard",
      inputData: { lyrics },
      resultText: "",
      songStructure: structure,
      scenes: scenes as unknown as unknown[],
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
        if (!res.ok) throw new Error("Saving the project didn't land — your storyboard is still autosaved as a draft.");
      }
      setSavedProject(true);
      void quest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saving the project failed.");
    } finally {
      setBusy(null);
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const chipCls = `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;

  return (
    <div data-testid="world-storyboard-bench" className={`space-y-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
      <p className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        <Clapperboard className="h-3.5 w-3.5" /> Storyboard — build the whole video
      </p>
      <label className="block">
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Lyrics / song words</span>
        <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={3} className={`w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-[#d4af37] ${isLight ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]" : "border-white/10 bg-white/5 text-white"}`} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`cursor-pointer ${chipCls}`}>
          {audioFile ? `Song file: ${audioFile.name}` : "Upload the song (for scenes from audio)"}
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setAudioFile(f);
                setAudioUrl(URL.createObjectURL(f));
              }
            }}
          />
        </label>
        <button type="button" data-testid="world-storyboard-analyze" onClick={() => void analyze()} disabled={busy !== null || lyrics.trim().length < 10} className={chipCls}>
          {busy === "analyze" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Analyze the sections · {analyzeSectionsCost().toLocaleString("en-US")} Visual Bucs
        </button>
        {structure ? (
          <span className={`text-xs font-semibold ${muted}`}>
            {structure.sections.length} sections found — hook: {structure.promo15?.section ?? "—"}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="world-storyboard-scenes-audio" onClick={() => void scenesFromAudio()} disabled={busy !== null || !audioUrl || lyrics.trim().length < 10} className={chipCls}>
          {busy === "audio-scenes" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Build scenes from my song{structure ? " · free, analysis done" : ` · includes analysis ${analyzeSectionsCost().toLocaleString("en-US")} Visual Bucs`}
        </button>
        <button type="button" data-testid="world-storyboard-scenes-plan" onClick={() => void scenesFromPlan()} disabled={busy !== null || (!props.packageResult && lyrics.trim().length < 3)} className={chipCls}>
          {busy === "plan-scenes" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Build scenes from a video plan · {videoPlanCost().toLocaleString("en-US")} Visual Bucs
        </button>
      </div>
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      {scenes.length > 0 ? (
        <div className="space-y-2" data-testid="world-storyboard-scenes">
          <p className={`text-xs font-semibold ${muted}`}>
            Review each scene — approve the ones to film. Step: {step}. Autosaved as you go.
          </p>
          {scenes.map((scene) => (
            <div key={scene.id} className={`rounded-xl border p-2.5 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-black">Scene {scene.sceneNumber}</span>
                <span className={`text-[11px] ${muted}`}>{scene.section} · {scene.timestamp}</span>
                <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold">
                  <input
                    type="checkbox"
                    data-testid="world-storyboard-approve"
                    checked={scene.approved}
                    onChange={(e) => setScenes((prev) => withSceneApproval(prev, scene.id, e.target.checked))}
                  />
                  Approve
                </label>
              </div>
              <p className={`mt-1 text-xs ${muted}`}>{scene.lyricLine || scene.action}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {scene.demoClipUrl ? (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-500"><Check className="h-3.5 w-3.5" /> Clip made</span>
                ) : scene.approved ? (
                  <button type="button" data-testid="world-storyboard-make-clip" onClick={() => makeClip(scene)} disabled={clipBusy !== null} className={chipCls}>
                    {clipBusy === scene.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Make this clip · {videoClipCost().toLocaleString("en-US")} Visual Bucs
                  </button>
                ) : (
                  <span className={`text-[11px] ${muted}`}>Approve it to film it.</span>
                )}
              </div>
              {scene.demoClipUrl ? <video src={scene.demoClipUrl} controls playsInline className="mt-2 max-h-[200px] w-full rounded-lg" /> : null}
            </div>
          ))}
          <button type="button" data-testid="world-storyboard-save" onClick={() => void saveProject()} disabled={busy !== null || props.editorBusy} className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50">
            {props.onSendToEditor ? "Save + open in the editor" : "Save as a project"}
          </button>
          {savedProject ? <p className={`text-xs font-semibold ${muted}`}>Saved — the editor step-through opens on this storyboard.</p> : null}
        </div>
      ) : null}
      <QuestProgressChip isLight={isLight} lines={quest.lines} />
      <p className={`text-[11px] ${muted}`}>Transcription for uploaded songs rides the Song + Video wizard ({transcribeCost().toLocaleString("en-US")} Visual Bucs) — paste or transcribe lyrics, then build scenes here.</p>
    </div>
  );
}
