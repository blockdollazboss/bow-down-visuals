import { Sparkles, SlidersHorizontal, Mic2, BookOpen, CheckCircle2, Circle, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { EditorSettings, MusicStudioSettings } from "@/lib/editor-settings";
import type { ArtistVault } from "@/components/ArtistVaultSelector";
import { AiAutoMix } from "@/components/editor/music/AiAutoMix";
import { ManualDAW } from "@/components/editor/music/ManualDAW";
import { SongWorkflow } from "@/components/editor/music/SongWorkflow";
import { LipSyncStudio } from "@/components/editor/music/LipSyncStudio";
import { useMixPreview } from "@/components/editor/music/useMixPreview";

interface MusicStudioProps {
  settings: EditorSettings;
  onChange: (next: EditorSettings) => void;
  artistName?: string;
  songTitle?: string;
  /** Uploaded song URL from project.input_data */
  audioUrl?: string | null;
  /** Project ID — used when saving transcript */
  projectId?: string | null;
  /** Auth token getter for API calls */
  getAccessToken?: () => Promise<string | null>;
  /** Called when Whisper returns a transcript */
  onTranscriptReady?: (text: string) => void;
  /** Already-saved transcript text (from output_data) */
  transcriptText?: string | null;
  /** Active artist profile for lip sync */
  activeArtist?: ArtistVault | null;
  /** Navigate user to the Captions tab */
  onGoToCaptions?: () => void;
}

const MODES: {
  id: MusicStudioSettings["mode"];
  label: string;
  note: string;
  icon: typeof Sparkles;
}[] = [
  { id: "auto",    label: "AI Auto Mix",   note: "Pick a sound, get a pro mix plan",           icon: Sparkles },
  { id: "manual",  label: "Manual DAW",    note: "Upload stems, mix & export it yourself",      icon: SlidersHorizontal },
  { id: "lipsync", label: "Lip Sync",      note: "Animate artist mouth to uploaded song",       icon: Mic2 },
];

export function MusicStudio({
  settings,
  onChange,
  artistName,
  songTitle,
  audioUrl,
  getAccessToken,
  onTranscriptReady,
  transcriptText,
  activeArtist,
  onGoToCaptions,
}: MusicStudioProps) {
  const ms = settings.musicStudio;
  const preview = useMixPreview(ms.stems, ms.master);
  const [guideOpen, setGuideOpen] = useState(true);

  /*
   * Use the project-level audioUrl if available; otherwise fall back to the
   * first uploaded stem's URL so "Get Lyrics From Song" appears even when
   * the user uploaded their song via the Manual DAW → Stems tab.
   */
  const effectiveAudioUrl: string | null =
    audioUrl ?? ms.stems[0]?.url ?? null;

  function setMode(mode: MusicStudioSettings["mode"]) {
    onChange({ ...settings, musicStudio: { ...ms, mode } });
  }

  const songWorkflow =
    effectiveAudioUrl && getAccessToken && onTranscriptReady ? (
      <SongWorkflow
        audioUrl={effectiveAudioUrl}
        getAccessToken={getAccessToken}
        transcriptText={transcriptText ?? null}
        onTranscriptReady={onTranscriptReady}
        onGoToCaptions={onGoToCaptions ?? (() => undefined)}
        settings={settings}
        onSettingsChange={onChange}
      />
    ) : null;

  /* ── Status hints derived from current settings ── */
  const songUploaded    = !!effectiveAudioUrl;
  const songSetAsVideo  = ms.videoAudio.source !== "none";
  const lyricsFound     = !!transcriptText && transcriptText.trim().length > 10;
  const captionsCreated = settings.captions.lines.length > 0;
  const readyForPreview = songUploaded && songSetAsVideo;

  const STEPS = [
    { label: "Upload your song",                        done: songUploaded },
    { label: "Click \"Use Song In Final Video\"",       done: songSetAsVideo },
    { label: "Click \"Get Lyrics From Song\"",          done: lyricsFound },
    { label: "Click \"Use Lyrics For Captions\"",       done: captionsCreated },
    { label: "Go to Captions tab → Auto Sync",          done: captionsCreated },
    { label: "Press Play on the top master player",     done: false },
  ] as const;

  return (
    <div className="space-y-5">

      {/* ── Bow Down AI Guide ───────────────────────────────────── */}
      <div className="rounded-xl border border-primary/25 bg-primary/[0.04] overflow-hidden">
        <button
          type="button"
          onClick={() => setGuideOpen(o => !o)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/[0.04] transition-colors"
        >
          <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            <BookOpen className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-black text-primary tracking-wide">Bow Down AI Guide</p>
            <p className="text-[11px] text-white/40">Music Mixer — step-by-step setup</p>
          </div>
          {guideOpen
            ? <ChevronUp className="h-4 w-4 text-primary/50 shrink-0" />
            : <ChevronDown className="h-4 w-4 text-primary/50 shrink-0" />}
        </button>

        {guideOpen && (
          <div className="px-4 pb-4 space-y-4 border-t border-primary/10">

            {/* Steps */}
            <div className="pt-3 space-y-2">
              {STEPS.map((step, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  {step.done
                    ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    : <Circle className="h-4 w-4 text-white/20 shrink-0 mt-0.5" />}
                  <span className={`text-[12px] leading-snug ${step.done ? "text-white/70 line-through decoration-primary/40" : "text-white/55"}`}>
                    <span className="font-bold text-white/30 mr-1">Step {i + 1}.</span>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Status hints */}
            <div className="rounded-lg border border-white/[0.07] bg-black/30 px-3 py-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              {([
                ["Song uploaded",          songUploaded],
                ["Song set as video audio",songSetAsVideo],
                ["Lyrics found",           lyricsFound],
                ["Captions created",       captionsCreated],
                ["Ready for preview",      readyForPreview],
              ] as [string, boolean][]).map(([label, ok]) => (
                <div key={label} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="text-[10px] text-white/35 font-mono">{label}</span>
                  <span className={`text-[10px] font-black font-mono ${ok ? "text-primary" : "text-white/20"}`}>
                    {ok ? "yes ✓" : "no"}
                  </span>
                </div>
              ))}
            </div>

            {/* Context tip */}
            <p className="text-[10px] text-white/25 leading-relaxed">
              Your song audio runs continuously through Timeline Preview and is embedded in the final export.
              Captions sync to the song timeline — set the song first, then generate captions so the timing lines up.
            </p>
          </div>
        )}
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = ms.mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              data-testid={`music-mode-${m.id}`}
              className={`flex items-center gap-3 text-left rounded-xl border p-4 transition-all ${
                active
                  ? "border-primary/60 bg-primary/[0.06] shadow-[0_0_24px_rgba(234,179,8,0.08)]"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
              }`}
            >
              <div
                className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                  active ? "bg-primary/15 text-primary" : "bg-white/[0.04] text-white/40"
                }`}
              >
                <Icon className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <p className={`text-sm font-black ${active ? "text-white" : "text-white/70"}`}>
                  {m.label}
                </p>
                <p className="text-[11px] text-white/40">{m.note}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/*
       * Song Workflow — always shown at the top of every mode whenever
       * any audio is available (project audioUrl OR any uploaded stem).
       */}
      {songWorkflow}

      {/* Mode content */}
      {ms.mode === "auto" && (
        <AiAutoMix
          settings={settings}
          onChange={onChange}
          artistName={artistName}
          songTitle={songTitle}
        />
      )}

      {ms.mode === "manual" && (
        <ManualDAW settings={settings} onChange={onChange} preview={preview} />
      )}

      {ms.mode === "lipsync" && (
        <LipSyncStudio
          audioUrl={effectiveAudioUrl}
          transcriptText={transcriptText ?? null}
          activeArtist={activeArtist ?? null}
        />
      )}
    </div>
  );
}
