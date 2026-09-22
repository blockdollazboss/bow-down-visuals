import { Sparkles, SlidersHorizontal, Mic2, BookOpen, CheckCircle2, Circle, ChevronDown, ChevronUp, Play, Pause, Music2, Upload, Plus, Clock3, Disc3, ListMusic } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import type { EditorSettings, MusicStudioSettings } from "@/lib/editor-settings";
import type { ArtistVault } from "@/components/ArtistVaultSelector";
import { AiAutoMix } from "@/components/editor/music/AiAutoMix";
import { ManualDAW } from "@/components/editor/music/ManualDAW";
import { SongWorkflow } from "@/components/editor/music/SongWorkflow";
import { LipSyncStudio } from "@/components/editor/music/LipSyncStudio";
import { GenerateAudio } from "@/components/editor/music/GenerateAudio";
import { useMixPreview } from "@/components/editor/music/useMixPreview";
import type { AudioExportType, DirectAudioExportStatus } from "@/lib/audio-export";

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
  /** Simple mode: hide the Manual DAW / Lip Sync mode switcher and force AI Auto Mix. */
  isSimple?: boolean;
  /** Edge-triggered request from the video-audio fallback warning. */
  requestedExport?: AudioExportType | null;
  onExportRequestHandled?: () => void;
  onDirectExportStatusChange?: (status: DirectAudioExportStatus) => void;
}

const MODES: {
  id: MusicStudioSettings["mode"];
  label: string;
  note: string;
  icon: typeof Sparkles;
}[] = [
  { id: "auto",    label: "Create",   note: "Generate + AI mix",                  icon: Sparkles },
  { id: "manual",  label: "Library",  note: "Stems, mix & export",               icon: SlidersHorizontal },
  { id: "lipsync", label: "Lip Sync", note: "Animate artist mouth to song",      icon: Mic2 },
];

function formatTime(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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
  isSimple = false,
  requestedExport = null,
  onExportRequestHandled,
  onDirectExportStatusChange,
}: MusicStudioProps) {
  const ms = settings.musicStudio;
  const preview = useMixPreview(ms.stems, ms.master);
  const [guideOpen, setGuideOpen] = useState(false);
  const [studioTab, setStudioTab] = useState<"create" | "library">("create");

  // Simple mode is AI-Auto-Mix only — Manual DAW / Lip Sync are advanced
  // surfaces (stem mixing, EQ, sync tools) hidden behind the mode toggle.
  // Force the setting back to "auto" if it somehow drifted (e.g. user
  // started in Advanced, picked Manual, then switched to Simple).
  useEffect(() => {
    if (isSimple && ms.mode !== "auto") {
      onChange({ ...settings, musicStudio: { ...ms, mode: "auto" } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSimple, ms.mode]);

  /* A direct fallback render should use the mature Manual DAW export path,
     even if the user currently has AI Auto Mix selected. */
  useEffect(() => {
    if (requestedExport && !isSimple && ms.mode !== "manual") {
      onChange({ ...settings, musicStudio: { ...ms, mode: "manual" } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedExport, isSimple, ms.mode]);

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

  const STEPS = [
    { label: "Upload your song",                        done: songUploaded },
    { label: "Click \"Use Song In Final Video\"",       done: songSetAsVideo },
    { label: "Click \"Get Lyrics From Song\"",          done: lyricsFound },
    { label: "Click \"Use Lyrics For Captions\"",       done: captionsCreated },
    { label: "Go to Captions tab → Auto Sync",          done: captionsCreated },
    { label: "Press Play on the top master player",     done: false },
  ] as const;

  /* ── Suno-style player header data ── */
  const displayTitle = songTitle?.trim() || ms.stems[0]?.name || "Untitled Track";
  const displayArtist = artistName?.trim() || activeArtist?.artist_name || "Unknown Artist";
  const durationSec =
    ms.videoAudio.duration ?? (preview.duration > 0 ? preview.duration : (ms.stems[0]?.durationSec ?? null));
  const isPlaying = preview.playState === "playing";

  /* Deterministic waveform bars (Suno-style) */
  const bars = useMemo(() => {
    const arr: number[] = [];
    let seed = 7;
    for (let i = 0; i < 48; i++) {
      seed = (seed * 16807) % 2147483647;
      const v = (seed % 100) / 100;
      arr.push(0.25 + v * 0.75);
    }
    return arr;
  }, []);

  const progress = preview.duration > 0 ? Math.min(1, preview.position / preview.duration) : 0;

  return (
    <div className="space-y-4">
      {/* ── Suno-style Now Playing / Song workspace header ── */}
      <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] overflow-hidden">
        <div className="p-4 flex items-center gap-4">
          {/* Cover art */}
          <div className="h-16 w-16 rounded-xl shrink-0 bg-gradient-to-br from-primary/40 via-[#1a1a1a] to-black border border-primary/25 flex items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(234,179,8,0.25),transparent_60%)]" />
            <Music2 className="h-7 w-7 text-primary relative z-10" />
          </div>

          {/* Track info */}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/70 mb-1">Now Playing</p>
            <h3 className="text-[15px] font-black text-white truncate leading-tight">{displayTitle}</h3>
            <p className="text-xs text-white/45 truncate mt-0.5">{displayArtist}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-bold text-white/60">
                <Clock3 className="h-3 w-3" /> {formatTime(durationSec)}
              </span>
              {songUploaded && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-[10px] font-bold text-emerald-300">Audio ready</span>
              )}
              {songSetAsVideo && (
                <span className="px-2 py-0.5 rounded-full bg-primary/10 border border-primary/25 text-[10px] font-bold text-primary">In video</span>
              )}
              {!songUploaded && (
                <span className="px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/10 text-[10px] font-bold text-white/35">No audio yet</span>
              )}
            </div>
          </div>

          {/* Play button */}
          <button
            type="button"
            onClick={() => preview.toggle()}
            disabled={!preview.hasStems && !effectiveAudioUrl}
            data-testid="musicstudio-play"
            className="h-12 w-12 rounded-full bg-primary text-black flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0 shadow-[0_0_24px_rgba(234,179,8,0.25)]"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current ml-0.5" />}
          </button>
        </div>

        {/* Waveform — Suno-style timeline */}
        <div className="px-4 pb-3">
          <div className="flex items-center gap-[3px] h-14" aria-hidden="true">
            {bars.map((h, i) => {
              const played = i / bars.length <= progress;
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-full transition-colors ${played ? "bg-primary" : "bg-white/15"}`}
                  style={{ height: `${Math.round(h * 100)}%`, opacity: played ? 1 : 0.7 }}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] font-mono text-white/35 tabular-nums">{formatTime(preview.position)}</span>
            <span className="text-[10px] font-mono text-white/35 tabular-nums">{formatTime(preview.duration || durationSec)}</span>
          </div>
        </div>
      </div>

      {/* ── Create / Upload action hierarchy (Suno-style) ── */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => { setStudioTab("create"); if (!isSimple) setMode("auto"); }}
          className={`flex items-center justify-center gap-2 h-11 rounded-xl text-[13px] font-black transition-colors border ${
            studioTab === "create"
              ? "bg-primary text-black border-primary hover:bg-primary/90"
              : "bg-white/[0.03] text-white/70 border-white/10 hover:bg-white/[0.06]"
          }`}
          data-testid="musicstudio-tab-create"
        >
          <Plus className="h-4 w-4" /> Create
        </button>
        <button
          type="button"
          onClick={() => { setStudioTab("library"); if (!isSimple) setMode("manual"); }}
          className={`flex items-center justify-center gap-2 h-11 rounded-xl text-[13px] font-black transition-colors border ${
            studioTab === "library"
              ? "bg-primary text-black border-primary hover:bg-primary/90"
              : "bg-white/[0.03] text-white/70 border-white/10 hover:bg-white/[0.06]"
          }`}
          data-testid="musicstudio-tab-library"
        >
          <Upload className="h-4 w-4" /> Upload
        </button>
      </div>

      {/* ── Track library strip (Suno-style rows) ── */}
      {ms.stems.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
            <ListMusic className="h-4 w-4 text-primary" />
            <p className="text-xs font-black uppercase tracking-widest text-white/70">Tracks</p>
            <span className="ml-auto text-[10px] font-bold text-white/30">{ms.stems.length} track{ms.stems.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="divide-y divide-white/[0.05] max-h-56 overflow-y-auto">
            {ms.stems.slice(0, 8).map((stem) => (
              <div key={stem.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                <div className="h-9 w-9 rounded-lg bg-white/[0.05] border border-white/10 flex items-center justify-center shrink-0">
                  <Disc3 className="h-4 w-4 text-white/40" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">{stem.name}</p>
                  <p className="text-[10px] text-white/35 truncate">{stem.type} · {formatTime(stem.durationSec)}</p>
                </div>
                {ms.videoAudio.source !== "none" && stem.id === ms.stems[0]?.id && (
                  <span className="text-[9px] font-black uppercase tracking-wider text-primary">In video</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Mode tabs — Suno-style segmented ── */}
      {!isSimple && (
        <div className="flex p-1 rounded-xl bg-black border border-white/10 gap-1">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = ms.mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => { setMode(m.id); setStudioTab(m.id === "manual" ? "library" : "create"); }}
                data-testid={`music-mode-${m.id}`}
                className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-[11px] font-black transition-colors ${
                  active ? "bg-primary/15 text-primary border border-primary/30" : "text-white/40 hover:text-white/70 border border-transparent"
                }`}
                title={m.note}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{m.label}</span>
                <span className="sm:hidden">{m.label.split(" ")[0]}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Bow Down AI Guide — collapsible ── */}
      <div className="rounded-xl border border-white/10 bg-[#0c0c0c] overflow-hidden">
        <button
          type="button"
          onClick={() => setGuideOpen(o => !o)}
          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
        >
          <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <BookOpen className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-xs font-black text-white/80">Setup checklist</p>
          </div>
          <span className="text-[10px] font-bold text-white/30">
            {STEPS.filter(s => s.done).length}/{STEPS.length} done
          </span>
          {guideOpen
            ? <ChevronUp className="h-4 w-4 text-white/30 shrink-0" />
            : <ChevronDown className="h-4 w-4 text-white/30 shrink-0" />}
        </button>

        {guideOpen && (
          <div className="px-4 pb-3 space-y-3 border-t border-white/[0.06]">
            <div className="pt-2.5 space-y-1.5">
              {STEPS.map((step, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  {step.done
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                    : <Circle className="h-3.5 w-3.5 text-white/20 shrink-0 mt-0.5" />}
                  <span className={`text-[11px] leading-snug ${step.done ? "text-white/50 line-through decoration-primary/40" : "text-white/55"}`}>
                    <span className="font-bold text-white/25 mr-1">{i + 1}.</span>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-white/25 leading-relaxed">
              Your song audio runs through Timeline Preview and is embedded in the final export.
              Set the song first, then generate captions so timing lines up.
            </p>
          </div>
        )}
      </div>

      {/* ── Generate — Suno-style create card ── */}
      {(studioTab === "create" || ms.stems.length === 0) && (
        <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-1">
          <GenerateAudio settings={settings} onChange={onChange} artistName={artistName} songTitle={songTitle} />
        </div>
      )}

      {/* ── Song workflow: lyrics / transcript / video audio ── */}
      {songWorkflow}

      {/* ── Mode content — organized sections ── */}
      {ms.mode === "auto" && (
        <AiAutoMix
          settings={settings}
          onChange={onChange}
          artistName={artistName}
          songTitle={songTitle}
        />
      )}

      {!isSimple && ms.mode === "manual" && (
        <ManualDAW
          settings={settings}
          onChange={onChange}
          preview={preview}
          requestedExport={requestedExport}
          onExportRequestHandled={onExportRequestHandled}
          onDirectExportStatusChange={onDirectExportStatusChange}
        />
      )}

      {!isSimple && ms.mode === "lipsync" && (
        <LipSyncStudio
          audioUrl={effectiveAudioUrl}
          transcriptText={transcriptText ?? null}
          activeArtist={activeArtist ?? null}
        />
      )}

      {/* ── Branding footer ── */}
      <p className="text-center text-[10px] text-white/20 pt-1">
        Bow Down Visuals · Music Studio
      </p>
    </div>
  );
}
