/**
 * /studio/:projectId — Standalone Bow Down Studio Editor
 *
 * Full-screen, dedicated studio page that owns its own audio/video elements.
 * Reads real project data from the API and renders a CapCut-style music
 * video editor: audio clock drives clip playback, timeline, trim, lock and export.
 *
 * This is a NEW page — it does not modify or replace any existing features.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft, Loader2, AlertTriangle, Play, Pause, SkipBack,
  Volume2, VolumeX, SkipForward, Film, Music2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import { parseScenesWithMode, extractBreakdownContent, type SceneData } from "@/lib/scene-parser";
import {
  normalizeEditorSettings, getClipEdit,
  type EditorSettings,
} from "@/lib/editor-settings";
import { StudioEditorSection } from "@/components/editor/sections/StudioEditorSection";

/* ─── Helpers ───────────────────────────────────────────────────────── */

function parseDur(ts: string | null | undefined): number {
  if (!ts) return 5;
  const m = ts.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (m) {
    const s = +m[1]! * 60 + +m[2]!;
    const e = +m[3]! * 60 + +m[4]!;
    return e > s ? e - s : 5;
  }
  return 5;
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/* ─── Types ─────────────────────────────────────────────────────────── */

interface LoadedProject {
  id: string;
  title: string;
  artist_name: string | null;
  song_title: string | null;
  input_data: Record<string, unknown> | null;
  output_data: {
    result?: string;
    scenes?: SceneData[];
    editorSettings?: Partial<EditorSettings>;
  } | null;
}

/* ─── Studio Page ────────────────────────────────────────────────────── */

export default function StudioPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user, getAccessToken } = useAuth();

  /* ── Loading state ── */
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [project, setProject] = useState<LoadedProject | null>(null);
  const [scenes, setScenes] = useState<SceneData[]>([]);
  const [settings, setSettings] = useState<EditorSettings>(normalizeEditorSettings(null));

  /* ── Audio state ── */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);

  /* ── Video state ── */
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);

  /* ── Derived ── */
  const audioUrl: string | null =
    (project?.input_data?.["audioUrl"] as string | undefined) ??
    (project?.input_data?.["audio_url"] as string | undefined) ??
    null;

  /* ── Load project ── */
  useEffect(() => {
    if (!user || !projectId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/projects/${projectId}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (!res.ok) throw new Error(res.status === 404 ? "Project not found" : "Failed to load project");
        const data = (await res.json()) as { project: LoadedProject };
        if (cancelled) return;
        setProject(data.project);

        const saved = data.project.output_data?.scenes ?? [];
        if (saved.length > 0) {
          setScenes(saved);
        } else if (data.project.output_data?.result) {
          const { scenes: parsed } = parseScenesWithMode(
            extractBreakdownContent(data.project.output_data.result) ?? data.project.output_data.result
          );
          setScenes(parsed);
        }
        setSettings(normalizeEditorSettings(data.project.output_data?.editorSettings));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load project");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, projectId, getAccessToken]);

  /* ── Clip durations ── */
  const rawDurs = useMemo(() => scenes.map(s => parseDur(s.timestamp)), [scenes]);
  const allDefault = rawDurs.length > 0 && rawDurs.every(d => d === 5);
  const durs = useMemo((): number[] => {
    if (allDefault && audioDuration && audioDuration > 0)
      return scenes.map(() => audioDuration / scenes.length);
    return rawDurs;
  }, [allDefault, audioDuration, rawDurs, scenes]);

  const offsets = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const d of durs) { out.push(acc); acc += d; }
    return out;
  }, [durs]);

  /* ── Active scene from playhead ── */
  useEffect(() => {
    let idx = 0;
    for (let i = 0; i < scenes.length; i++) {
      const start = offsets[i] ?? 0;
      const dur = durs[i] ?? 5;
      if (currentTime >= start && currentTime < start + dur) { idx = i; break; }
      if (currentTime >= start + dur && i === scenes.length - 1) idx = i;
    }
    setActiveSceneIdx(idx);
  }, [currentTime, scenes, offsets, durs]);

  /* ── Video follows active scene ── */
  useEffect(() => {
    const scene = scenes[activeSceneIdx];
    if (!scene || !videoRef.current) return;
    const ce = getClipEdit(settings, scene.id);
    const useLipSync = !!(ce.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl);
    const url = useLipSync ? ce.lipSyncUrl! : scene.demoClipUrl ?? null;
    if (url && videoRef.current.src !== url) {
      videoRef.current.src = url;
      videoRef.current.muted = true;
      if (isPlaying) videoRef.current.play().catch(() => {});
    }
  }, [activeSceneIdx, scenes, settings, isPlaying]);

  /* ── Audio event handlers ── */
  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  }, []);
  const handleDurationChange = useCallback(() => {
    if (audioRef.current) setAudioDuration(audioRef.current.duration || null);
  }, []);
  const handleEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);

  /* ── Transport controls ── */
  const seekTo = useCallback((sec: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(audioDuration ?? sec, sec));
    setCurrentTime(audioRef.current.currentTime);
  }, [audioDuration]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      videoRef.current?.pause();
    } else {
      void audioRef.current.play();
      videoRef.current?.muted !== false && (videoRef.current ? videoRef.current.muted = true : null);
      videoRef.current?.play().catch(() => {});
    }
  }, [isPlaying]);

  const restart = useCallback(() => {
    seekTo(0);
    if (audioRef.current && isPlaying) void audioRef.current.play();
  }, [seekTo, isPlaying]);

  const skipToNext = useCallback(() => {
    const nextOffset = offsets[activeSceneIdx + 1];
    if (nextOffset !== undefined) seekTo(nextOffset);
  }, [activeSceneIdx, offsets, seekTo]);

  const toggleMute = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.muted = !muted;
    setMuted(!muted);
  }, [muted]);

  /* ── Loading/error states ── */
  if (!user) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <p className="text-white/50">Please log in to use the Studio Editor.</p>
    </div>
  );

  if (loading) return (
    <div className="min-h-screen bg-black flex flex-col">
      <TopBar />
      <div className="flex-1 flex items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-white/50">Loading project…</p>
      </div>
    </div>
  );

  if (loadError) return (
    <div className="min-h-screen bg-black flex flex-col">
      <TopBar />
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
        <AlertTriangle className="h-8 w-8 text-red-400" />
        <p className="text-white/70 text-center">{loadError}</p>
        <Link href="/my-projects">
          <Button variant="outline" className="border-white/10">← Back to Projects</Button>
        </Link>
      </div>
    </div>
  );

  const artistName = project?.artist_name ?? "";
  const songTitle = project?.song_title ?? "";
  const displayTitle = [artistName, songTitle].filter(Boolean).join(" — ") || project?.title || "Studio Editor";

  /* ── Active clip URL for video player ── */
  const activeScene = scenes[activeSceneIdx];
  const activeCe = activeScene ? getClipEdit(settings, activeScene.id) : null;
  const activeClipUrl = activeCe
    ? (activeCe.useLipSync && activeCe.lipSyncStatus === "done" && activeCe.lipSyncUrl
        ? activeCe.lipSyncUrl
        : activeScene?.demoClipUrl ?? null)
    : null;

  /* ── Render ── */
  return (
    <div className="min-h-screen bg-black flex flex-col">

      {/* ── Hidden audio element — master clock ── */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={handleDurationChange}
          onEnded={handleEnded}
          onPlay={handlePlay}
          onPause={handlePause}
          preload="metadata"
          crossOrigin="anonymous"
        />
      )}

      {/* ── Top bar ── */}
      <div className="border-b border-white/[0.07] bg-[#080808] sticky top-0 z-30 px-4 py-3 flex items-center gap-4">
        <Link href="/my-projects">
          <button type="button" className="flex items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors text-sm">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-primary/60 font-bold uppercase tracking-widest">Bow Down Studio Editor</p>
          <h1 className="text-sm font-black text-white truncate">{displayTitle}</h1>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Link href={`/video-editor?project=${projectId}`}>
            <Button variant="outline" size="sm" className="border-white/10 text-white/60 hover:text-white text-xs h-7">
              Open Legacy Editor
            </Button>
          </Link>
        </div>
      </div>

      {/* ── Main two-column layout ── */}
      <div className="flex-1 flex overflow-hidden min-h-0" style={{ height: "calc(100vh - 57px)" }}>

        {/* ── LEFT: Video player ── */}
        <div className="w-72 shrink-0 bg-[#050505] border-r border-white/[0.06] flex flex-col items-center gap-4 p-4 overflow-y-auto">

          {/* 9:16 video canvas */}
          <div className="w-full" style={{ aspectRatio: "9/16", maxWidth: 220, maxHeight: 390 }}>
            <div className="relative w-full h-full rounded-xl border border-white/[0.08] bg-black overflow-hidden">
              {activeClipUrl ? (
                <video
                  ref={videoRef}
                  key={activeClipUrl}
                  src={activeClipUrl}
                  muted
                  playsInline
                  autoPlay={isPlaying}
                  loop
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-white/15">
                  <Film className="h-6 w-6" />
                  <p className="text-[9px] text-center px-2">
                    {scenes.length === 0 ? "No scenes loaded" : "Clip missing for this scene"}
                  </p>
                </div>
              )}
              {/* Section label overlay */}
              {activeScene && (
                <div className="absolute bottom-2 left-0 right-0 flex justify-center pointer-events-none">
                  <span className="text-[8px] font-bold text-white/60 bg-black/60 rounded px-1.5 py-0.5 backdrop-blur-sm">
                    {activeScene.section || `Scene ${activeSceneIdx + 1}`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Transport */}
          <div className="w-full space-y-3">
            {/* Timecode */}
            <div className="flex items-center justify-between text-[10px] font-mono text-white/40">
              <span>{fmt(currentTime)}</span>
              <span>{audioDuration ? fmt(audioDuration) : "--:--"}</span>
            </div>

            {/* Progress bar */}
            <div
              className="w-full h-1.5 bg-white/[0.08] rounded-full cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const frac = (e.clientX - rect.left) / rect.width;
                seekTo(frac * (audioDuration ?? 0));
              }}
            >
              <div
                className="h-full bg-primary/70 rounded-full transition-none"
                style={{ width: audioDuration && audioDuration > 0 ? `${Math.min(100, (currentTime / audioDuration) * 100)}%` : "0%" }}
              />
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-3">
              <button type="button" onClick={restart}
                className="p-1.5 rounded-lg text-white/35 hover:text-white/80 hover:bg-white/[0.05] transition-colors">
                <SkipBack className="h-4 w-4" />
              </button>
              <button type="button" onClick={togglePlay}
                className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-colors">
                {isPlaying
                  ? <Pause className="h-4 w-4" />
                  : <Play className="h-4 w-4 ml-0.5" />}
              </button>
              <button type="button" onClick={skipToNext} disabled={activeSceneIdx >= scenes.length - 1}
                className="p-1.5 rounded-lg text-white/35 hover:text-white/80 hover:bg-white/[0.05] transition-colors disabled:opacity-25">
                <SkipForward className="h-4 w-4" />
              </button>
              <button type="button" onClick={toggleMute}
                className="p-1.5 rounded-lg text-white/35 hover:text-white/80 hover:bg-white/[0.05] transition-colors">
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>

            {/* Audio status */}
            {!audioUrl && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.06]">
                <Music2 className="h-3 w-3 text-amber-400 shrink-0" />
                <p className="text-[8px] text-amber-400">No audio in this project</p>
              </div>
            )}
            {audioUrl && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-green-500/20 bg-green-500/[0.04]">
                <Volume2 className="h-3 w-3 text-green-400 shrink-0" />
                <p className="text-[8px] text-green-400/80 truncate">Audio loaded ✓</p>
              </div>
            )}
          </div>

          {/* Scene list */}
          <div className="w-full">
            <p className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-2">Scenes</p>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {scenes.map((scene, i) => {
                const ce = getClipEdit(settings, scene.id);
                const useLipSync = !!(ce.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl);
                const hasUrl = useLipSync || !!scene.demoClipUrl;
                const isActive = i === activeSceneIdx;
                return (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => seekTo(offsets[i] ?? 0)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                      isActive
                        ? "bg-primary/15 border border-primary/30"
                        : "border border-white/[0.04] hover:bg-white/[0.03]"
                    }`}
                  >
                    <span className={`text-[7px] font-mono shrink-0 ${isActive ? "text-primary" : "text-white/25"}`}>
                      {fmt(offsets[i] ?? 0)}
                    </span>
                    <span className={`text-[9px] truncate flex-1 ${isActive ? "text-white font-bold" : "text-white/50"}`}>
                      {scene.section || `Scene ${i + 1}`}
                    </span>
                    <span className={`text-[7px] shrink-0 ${hasUrl ? "text-green-400/60" : "text-amber-400/60"}`}>
                      {hasUrl ? "✓" : "⚠"}
                    </span>
                  </button>
                );
              })}
              {scenes.length === 0 && (
                <p className="text-[9px] text-white/20 px-2">No scenes loaded</p>
              )}
            </div>
          </div>

        </div>

        {/* ── RIGHT: Studio Editor controls ── */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-0">
          <StudioEditorSection
            scenes={scenes}
            settings={settings}
            setSettings={setSettings}
            setScenes={setScenes}
            projectId={projectId ?? undefined}
            getAccessToken={getAccessToken}
            currentTime={currentTime}
            audioDuration={audioDuration}
            isPlaying={isPlaying}
            audioUrl={audioUrl}
            onSeek={seekTo}
            onTogglePlay={togglePlay}
            onRestart={restart}
            onGoToExport={() => {}}
            onGoToMusic={() => {}}
          />
        </div>

      </div>
    </div>
  );
}
