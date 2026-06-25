import { Sparkles, SlidersHorizontal, Mic2 } from "lucide-react";
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

  return (
    <div className="space-y-5">
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
