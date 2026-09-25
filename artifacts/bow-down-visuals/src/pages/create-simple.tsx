import { useState } from "react";
import { useLocation } from "wouter";
import { Sparkles, Loader2, Music, ArrowLeft, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";
import { AudioTranscribe } from "@/components/AudioTranscribe";
import { callGenerateApi } from "@/lib/generate-api";
import { parseScenes, extractBreakdownContent, type SceneData } from "@/lib/scene-parser";
import { runAudioSceneFlow } from "@/lib/generate-scenes-from-audio-flow";
import {
  defaultEditorSettings,
  defaultAiEditSettings,
  applyAiTransitionsToClips,
  AI_EDIT_STYLE_DEFS,
  type AiEditPlan,
} from "@/lib/editor-settings";

/**
 * Simple-mode intake: one field (idea/lyrics), an optional audio upload, one
 * button. AI fills in every other decision (genre, mood, video style, format,
 * caption style, Auto AI Edit) using sensible defaults, generates scenes, and
 * lands the user straight in the streamlined editor. No new AI capabilities
 * are introduced here — this orchestrates the same generation + Auto AI Edit
 * endpoints the Advanced wizards already use.
 */

const DEFAULTS = {
  genre: "Hip Hop",
  mood: "Energetic",
  videoStyle: "Street Cinematic",
  platform: "TikTok / Reels / Shorts - 9:16",
  cleanOrExplicit: "Clean",
  voiceStyle: "Confident, melodic",
  beatStyle: "Modern trap-influenced",
  songLength: "Standard (3 min)",
  aiEditStyle: "viral-tiktok" as const,
};

export default function CreateSimple() {
  const [, setLocation] = useLocation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { activeArtist } = useActiveArtist();
  const { setMode } = useUserMode();
  const { toast } = useToast();

  const [idea, setIdea] = useState("");
  /** Lyrics obtained from auto-transcribing the uploaded audio. */
  const [transcript, setTranscript] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  /* The single "song idea or lyrics" box does double duty: when audio
   * transcription fails (or never ran), whatever the user typed there can
   * also serve as the lyrics, so the manual-paste fallback promised by the
   * error copy actually unblocks submission. Prefer the real transcript
   * when we have one. */
  const effectiveLyrics = transcript.trim().length >= 10 ? transcript : idea;

  const hasEnough = idea.trim().length > 0 || transcript.trim().length > 0 || !!audioUrl;
  /* When audio is uploaded, the audio-driven scene flow is mandatory (per
   * spec — never silently fall back to text-driven generation), so submit
   * must wait until lyrics (from transcription or manual paste) are ready. */
  const audioNeedsTranscript = !!audioUrl && effectiveLyrics.trim().length < 10;
  const canSubmit = hasEnough && !transcribing && !audioNeedsTranscript;

  /** Auto-transcribe immediately on upload so audio-driven projects never
   *  require a manual "Transcribe" click before the primary action works. */
  async function handleAudioFile(file: File | null) {
    setAudioFile(file);
    setTranscribeError(null);
    if (!file) return;
    setTranscribing(true);
    try {
      const token = await getAccessToken();
      const fd = new FormData();
      fd.append("audio", file);
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) throw new Error("Transcription failed");
      const data = (await res.json()) as { transcript: string };
      setTranscript(data.transcript);
    } catch {
      setTranscribeError("We couldn't auto-transcribe this audio. Please paste your lyrics in the box below to continue.");
    } finally {
      setTranscribing(false);
    }
  }

  async function handleCreate() {
    if (!user) { toast({ title: "Sign in required", variant: "destructive" }); return; }
    if (!hasEnough) { setError("Describe your song idea, paste lyrics, or upload a song first."); return; }
    if (audioNeedsTranscript) { setError("Please wait for transcription to finish, or paste your lyrics manually."); return; }
    setError(null);
    setOutOfCredits(false);
    setBusy(true);

    try {
      const token = await getAccessToken();
      let scenes: SceneData[] = [];
      let rawResult = "";
      let songStructure: unknown = null;
      let creditsUsed: string | number | null = null;
      let genHistoryId: string | null = null;

      const artistName = activeArtist?.artist_name ?? "";

      if (audioUrl) {
        /* Audio present — always derive scenes straight from the song via
         * the audio-driven flow, skipping the text-plan step entirely.
         * canSubmit already guarantees a transcript is ready by this point. */
        setStatusMsg("Analyzing your song and building scenes…");
        const flow = await runAudioSceneFlow({
          lyrics: effectiveLyrics,
          audioUrl,
          audioFile,
          songStructure: null,
          getAccessToken,
        });
        scenes = flow.scenes;
        songStructure = flow.songStructure;
        rawResult = effectiveLyrics;
      } else {
        /* No audio uploaded — use the full song+video text-driven
         * generation with AI-picked defaults for every field. */
        setStatusMsg("Writing your song and video plan…");
        const combinedTopic = idea.trim() || "A new song";
        const { rawResult: res, creditsRemaining, genHistoryId: gid } = await callGenerateApi(
          "/api/generate-song-video",
          {
            artistName,
            songTitle: "",
            genre: DEFAULTS.genre,
            mood: DEFAULTS.mood,
            explicit: DEFAULTS.cleanOrExplicit,
            songTopic: combinedTopic,
            voiceStyle: DEFAULTS.voiceStyle,
            beatStyle: DEFAULTS.beatStyle,
            songLength: DEFAULTS.songLength,
            videoStyle: DEFAULTS.videoStyle,
            platform: DEFAULTS.platform,
            artistDescription: "",
            existingLyrics: effectiveLyrics.trim() || undefined,
          },
          token,
        );
        rawResult = res;
        genHistoryId = gid ?? null;
        scenes = parseScenes(extractBreakdownContent(res));
        if (creditsRemaining !== undefined) refreshProfile();
      }

      if (scenes.length === 0) {
        throw new Error("Could not generate scenes from that input. Try adding a bit more detail.");
      }

      /* Auto-apply the Auto AI Edit plan so Simple mode lands the user on an
       * already-edited timeline, not a blank one. */
      setStatusMsg("Applying automatic AI edit…");
      let editorSettings: ReturnType<typeof defaultEditorSettings> = {
        ...defaultEditorSettings(),
        aiEdit: { ...defaultAiEditSettings(), enabled: true, style: DEFAULTS.aiEditStyle, autoApplyTransitions: true },
      };
      try {
        const sceneDescriptions = scenes.map((s, i) =>
          [s.section, s.lyricLine, s.action, s.mood].filter(Boolean).join(" · ") || `Scene ${i + 1}`,
        );
        const planRes = await fetch("/api/generate/ai-edit-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
          body: JSON.stringify({
            style: DEFAULTS.aiEditStyle,
            styleName: AI_EDIT_STYLE_DEFS.find((d) => d.id === DEFAULTS.aiEditStyle)?.name ?? DEFAULTS.aiEditStyle,
            sceneCount: scenes.length,
            sceneDescriptions,
            audioFound: !!audioUrl,
            captionsFound: false,
            captionCount: 0,
            captionStyle: editorSettings.captions.stylePreset,
            currentEffects: editorSettings.effects,
            artistName,
            songTitle: "",
            lyricsText: effectiveLyrics || "",
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (planRes.ok) {
          const data = (await planRes.json()) as { plan: AiEditPlan };
          editorSettings = {
            ...editorSettings,
            aiEdit: { ...editorSettings.aiEdit, plan: data.plan, applied: false },
          };
          editorSettings = applyAiTransitionsToClips(editorSettings, scenes, data.plan);
        }
      } catch {
        /* Non-fatal — user still gets a working project, just without a
         * pre-applied transition plan; Auto AI Edit stays enabled so they
         * can generate/apply it manually in Advanced mode. */
      }

      /* Save the project. */
      setStatusMsg("Saving your project…");
      const saveRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          projectType: "Make Song + Video",
          title: [artistName, "Simple Mode Video"].filter(Boolean).join(" — "),
          artistName: artistName || null,
          songTitle: null,
          genre: DEFAULTS.genre,
          mood: DEFAULTS.mood,
          inputData: { simpleMode: true, idea, lyrics: effectiveLyrics },
          outputData: {
            result: rawResult,
            ...(songStructure ? { songStructure } : {}),
            scenes,
            editorSettings,
          },
          creditsUsed: creditsUsed ?? 2,
          genHistoryId,
        }),
      });
      const saveBody = await saveRes.json() as { id?: string; error?: string; refunded?: boolean };
      if (!saveRes.ok) {
        if (saveBody.error === "out_of_credits") { setOutOfCredits(true); refreshProfile(); return; }
        throw new Error(saveBody.error ?? "Could not save your project.");
      }

      toast({ title: "Your video is ready ✓", description: "AI generated your scenes and applied an automatic edit." });
      setLocation(`/video-editor?project=${saveBody.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      if (msg === "out_of_credits") { setOutOfCredits(true); refreshProfile(); }
      else setError(msg);
    } finally {
      setBusy(false);
      setStatusMsg(null);
    }
  }

  if (outOfCredits) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="max-w-xl mx-auto px-5 py-16">
          <OutOfCredits />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-primary/[0.08] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-5 md:px-8 py-10 md:py-14">
        <button
          type="button"
          onClick={() => setLocation("/dashboard")}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-white/40 hover:text-white/70 transition-colors mb-6"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
        </button>

        <span className="inline-flex items-center gap-1.5 bg-primary text-black text-[10px] font-black tracking-widest uppercase px-2.5 py-1 rounded-full mb-4">
          <Sparkles className="h-3 w-3" /> Simple Mode
        </span>
        <h1 className="text-2xl md:text-3xl font-black tracking-tight leading-tight mb-2">
          What's your song about?
        </h1>
        <p className="text-white/40 text-sm mb-8">
          Upload a song, paste your lyrics, or just describe the idea. AI handles genre, mood, format,
          scene generation, and the edit — one click and you're in the editor.
        </p>

        <div className="space-y-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-white/65 uppercase tracking-wider">
              Upload your song <span className="text-white/25 font-normal normal-case tracking-normal">(optional)</span>
            </label>
            <AudioTranscribe
              onTranscript={setTranscript}
              onFileUrl={setAudioUrl}
              onFile={handleAudioFile}
            />
            {transcribing && (
              <p className="flex items-center gap-1.5 text-xs text-white/40">
                <Loader2 className="h-3 w-3 animate-spin" /> Transcribing your lyrics — this only takes a moment…
              </p>
            )}
            {transcribeError && (
              <p className="text-xs text-amber-400">{transcribeError}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-white/65 uppercase tracking-wider">
              Song idea or lyrics
            </label>
            <Textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. A song about grinding for years before the breakthrough finally hits..."
              rows={5}
              className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/20 focus:border-primary/50 rounded-xl resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 font-medium">{error}</p>
          )}

          <Button
            size="lg"
            className="w-full gold-glow font-black gap-2"
            disabled={busy || !canSubmit}
            onClick={handleCreate}
          >
            {busy ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> {statusMsg ?? "Creating…"}</>
            ) : transcribing ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Waiting for transcription…</>
            ) : (
              <><Music className="h-4 w-4" /> Create My Video</>
            )}
          </Button>

          <button
            type="button"
            onClick={() => setMode("advanced")}
            className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white/35 hover:text-white/65 transition-colors"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Prefer full manual control? Switch to Advanced mode
          </button>
        </div>
      </div>
    </div>
  );
}
