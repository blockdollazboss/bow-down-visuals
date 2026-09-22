import { useState, useCallback, useEffect, useRef } from "react";
import {
  Film,
  Eye,
  AlertCircle,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Clapperboard,
  CheckCircle2,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";

interface ClipSequencePlayerProps {
  /** Scenes to source clips from. Any scene with a video URL is played, in order. */
  scenes: SceneData[];
  /** All scenes — used only to compute the original scene number labels. Defaults to `scenes`. */
  allScenes?: SceneData[];
  title?: string;
  emptyTitle?: string;
  emptyHint?: string;
}

/**
 * This helper fixes the blank-player problem.
 * Some parts of the app may save the clip URL under different names.
 */
function getSceneVideoUrl(scene: SceneData | null | undefined): string | null {
  if (!scene) return null;

  const s = scene as SceneData & {
    videoUrl?: string | null;
    clipUrl?: string | null;
    generatedClipUrl?: string | null;
    finalVideoUrl?: string | null;
    final_video_url?: string | null;
    url?: string | null;
  };

  return (
    scene.demoClipUrl ||
    s.videoUrl ||
    s.clipUrl ||
    s.generatedClipUrl ||
    s.finalVideoUrl ||
    s.final_video_url ||
    s.url ||
    null
  );
}

/** Sequential, muted clip player. Plays each generated clip back-to-back.
 *  Clips are silent previews — audio is added during final export. */
export function ClipSequencePlayer({
  scenes,
  allScenes,
  title = "Music Video Preview",
  emptyTitle = "No clips generated yet.",
  emptyHint = "Generate Runway clips on the scene cards — they'll appear here in sequence.",
}: ClipSequencePlayerProps) {
  const numberSource = allScenes ?? scenes;

  /**
   * OLD BUG:
   * const clips = scenes.filter((s) => !!s.demoClipUrl);
   *
   * That only works if every clip URL is stored as demoClipUrl.
   * This version checks all possible URL fields.
   */
  const clips = scenes.filter((s) => !!getSceneVideoUrl(s));

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [urlError, setUrlError] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = clips[idx] ?? clips[0] ?? null;
  const currentVideoUrl = getSceneVideoUrl(current);

  /* React does NOT always propagate the `muted` prop to the DOM video element —
     use a callback ref to set it imperatively. */
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) el.muted = true;
  }, []);

  /* Reset to first clip when clip list changes. */
  useEffect(() => {
    setIdx(0);
    setPlaying(false);
    setUrlError(false);
  }, [clips.length]);

  /* Keep idx safe if clips change and current index is now too high. */
  useEffect(() => {
    if (clips.length > 0 && idx > clips.length - 1) {
      setIdx(0);
    }
  }, [clips.length, idx]);

  /* Re-mute, clear error, load correct URL, and auto-play when idx/url changes. */
  useEffect(() => {
    setUrlError(false);

    const v = videoRef.current;
    if (!v || !currentVideoUrl) return;

    v.muted = true;
    v.src = currentVideoUrl;
    v.load();

    if (playing) {
      v.play().catch(() => setPlaying(false));
    }
  }, [idx, currentVideoUrl, playing]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    };
  }, []);

  function revealControls() {
    setShowControls(true);

    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }

    hideTimer.current = setTimeout(() => setShowControls(false), 2500);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v || !currentVideoUrl) return;

    v.muted = true;

    if (playing) {
      v.pause();
    } else {
      v.play().catch(() => setPlaying(false));
    }

    revealControls();
  }

  function handleEnded() {
    if (idx < clips.length - 1) {
      setIdx((i) => i + 1);
    } else {
      setPlaying(false);
      setShowControls(true);
    }
  }

  function jumpTo(i: number) {
    const safeIndex = Math.max(0, Math.min(clips.length - 1, i));
    setIdx(safeIndex);
    setUrlError(false);

    const nextClip = clips[safeIndex];
    const nextUrl = getSceneVideoUrl(nextClip);

    if (videoRef.current && nextUrl) {
      videoRef.current.muted = true;
      videoRef.current.src = nextUrl;
      videoRef.current.load();

      if (playing) {
        videoRef.current.play().catch(() => {});
      }
    }

    revealControls();
  }

  /* ── No clips yet: show placeholder ── */
  if (clips.length === 0) {
    return (
      <div
        className="rounded-xl border border-white/[0.07] bg-[#080808] overflow-hidden"
        data-testid="final-video-preview"
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.05] bg-white/[0.02]">
          <Eye className="h-4 w-4 text-primary/60" />
          <span className="text-xs font-black text-white/70 uppercase tracking-widest">
            {title}
          </span>
        </div>

        <div className="relative aspect-video flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-[#0f0a00] via-[#080808] to-[#000]">
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />

          <div className="relative z-10 flex flex-col items-center gap-4">
            <div className="h-20 w-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Clapperboard className="h-8 w-8 text-primary/40" />
            </div>

            <div className="text-center space-y-1 px-6">
              <p className="text-white/60 font-semibold text-sm">
                {emptyTitle}
              </p>
              <p className="text-white/25 text-xs">{emptyHint}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Clips ready: sequential player ── */
  return (
    <div
      className="rounded-xl border border-primary/20 bg-[#080808] overflow-hidden shadow-[0_0_40px_rgba(234,179,8,0.04)]"
      data-testid="final-video-preview"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.05] bg-primary/[0.03]">
        <Eye className="h-4 w-4 text-primary/60" />
        <span className="text-xs font-black text-primary/70 uppercase tracking-widest">
          {title}
        </span>

        <span className="ml-auto text-[10px] text-white/30 font-mono">
          {idx + 1} / {clips.length} clip{clips.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Video player */}
      <div
        className="relative aspect-video bg-black cursor-pointer group"
        onClick={togglePlay}
        onMouseMove={revealControls}
        data-testid="preview-player"
      >
        {currentVideoUrl ? (
          <video
            ref={setVideoRef}
            key={currentVideoUrl}
            src={currentVideoUrl}
            onEnded={handleEnded}
            onPlay={() => {
              setPlaying(true);
              revealControls();
            }}
            onPause={() => setPlaying(false)}
            onError={() => {
              console.error("Preview clip failed to load:", currentVideoUrl);
              setUrlError(true);
              setPlaying(false);
            }}
            playsInline
            muted
            preload="metadata"
            className="w-full h-full object-contain"
            data-testid="preview-video"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black">
            <AlertCircle className="h-10 w-10 text-amber-400" />
            <p className="text-sm text-white/80 text-center px-6">
              No video URL saved for this clip.
            </p>
          </div>
        )}

        {/* Expired / broken URL overlay */}
        {urlError && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm"
            data-testid="preview-url-error"
          >
            <AlertCircle className="h-10 w-10 text-amber-400" />
            <p className="text-sm text-white/80 text-center px-6">
              Clip URL failed to load or expired.
              <br />
              <span className="text-amber-400 font-semibold">Regenerate</span>{" "}
              the clip on the scene card to get a fresh link.
            </p>
            {currentVideoUrl && (
              <p className="text-[10px] text-white/30 font-mono max-w-[90%] break-all text-center">
                {currentVideoUrl}
              </p>
            )}
          </div>
        )}

        {/* Big play button when paused and no error */}
        {!playing && !urlError && currentVideoUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-16 w-16 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center backdrop-blur-sm hover:bg-primary/30 transition-colors">
              <Play className="h-7 w-7 text-primary ml-1" />
            </div>
          </div>
        )}

        {/* Scene info badge */}
        <div
          className={`absolute top-3 left-3 transition-opacity duration-300 ${
            showControls ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 border border-white/10 backdrop-blur-sm">
            <Film className="h-3 w-3 text-primary/70" />
            <span className="text-[10px] font-bold text-white/80">
              Scene {numberSource.indexOf(current!) + 1}
              {current?.section ? ` · ${current.section}` : ""}
            </span>

            {current?.approved && (
              <span className="text-[9px] font-bold text-primary ml-0.5">
                ★ Approved
              </span>
            )}
          </div>
        </div>

        {/* Bottom playback controls */}
        <div
          className={`absolute bottom-0 left-0 right-0 transition-opacity duration-300 ${
            showControls || !playing ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="bg-gradient-to-t from-black/80 to-transparent px-4 py-3 flex items-center gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                jumpTo(Math.max(0, idx - 1));
              }}
              disabled={idx === 0}
              className="text-white/60 hover:text-white disabled:opacity-20 transition-colors"
              data-testid="preview-prev"
            >
              <SkipBack className="h-4 w-4" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="text-white hover:text-primary transition-colors"
              data-testid="preview-play-pause"
              aria-label={playing ? "Pause preview" : "Play preview"}
            >
              {playing ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                jumpTo(Math.min(clips.length - 1, idx + 1));
              }}
              disabled={idx === clips.length - 1}
              className="text-white/60 hover:text-white disabled:opacity-20 transition-colors"
              data-testid="preview-next"
            >
              <SkipForward className="h-4 w-4" />
            </button>

            <div className="flex-1 flex items-center gap-1.5 overflow-x-auto">
              {clips.map((clip, i) => (
                <button
                  key={clip.id ?? `${i}-${getSceneVideoUrl(clip)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpTo(i);
                  }}
                  className={`shrink-0 h-1 rounded-full transition-all ${
                    i === idx
                      ? "bg-primary w-8"
                      : "bg-white/25 w-4 hover:bg-white/50"
                  }`}
                  title={`Scene ${numberSource.indexOf(clip) + 1}`}
                />
              ))}
            </div>

            <span className="text-[10px] text-white/40 font-mono shrink-0">
              {idx + 1}/{clips.length}
            </span>
          </div>
        </div>
      </div>

      {/* Scene pills */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.04] overflow-x-auto">
        <span className="text-[9px] font-black text-white/20 uppercase tracking-widest shrink-0">
          Scenes
        </span>

        {clips.map((clip, i) => {
          const sceneNum = numberSource.indexOf(clip) + 1;
          const clipUrl = getSceneVideoUrl(clip);

          return (
            <button
              key={clip.id ?? `${i}-${clipUrl}`}
              onClick={() => jumpTo(i)}
              data-testid={`preview-scene-pill-${i}`}
              className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-bold transition-all ${
                i === idx
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-white/10 bg-white/[0.03] text-white/35 hover:border-primary/20 hover:text-primary/50"
              }`}
            >
              {clip.approved && <CheckCircle2 className="h-2.5 w-2.5" />}
              <span>Scene {sceneNum}</span>
              {clip.section && (
                <span className="text-[9px] opacity-60">· {clip.section}</span>
              )}
            </button>
          );
        })}

        {clips.length > 0 && (
          <span className="ml-auto shrink-0 text-[9px] text-white/20">
            {clips.filter((c) => c.approved).length}/{clips.length} approved
          </span>
        )}
      </div>
    </div>
  );
}