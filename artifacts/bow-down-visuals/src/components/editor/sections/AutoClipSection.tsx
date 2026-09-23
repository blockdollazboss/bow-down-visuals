import { useRef, useState } from "react";
import { EditorSettings, getClipEdit } from "@/lib/editor-settings";
import { Button } from "@/components/ui/button";
import { Scissors, Loader2, Download, RotateCcw, X } from "lucide-react";

/* ── AutoClipSection ───────────────────────────────────────────────
   The content creator's cheat code for distribution: turn a finished
   music video into N vertical promo clips in one tap.

   How it works: picks N ranges spread across the timeline (snapped to
   scene boundaries), then renders each through the SAME export pipeline
   as a full export — captions, transitions, overlays, effects, branding,
   and audio settings all carry over. Only the aspect ratio is forced to
   9:16 vertical for TikTok / Reels / Shorts.

   Range picking is simple timeline math, not content analysis: it does
   not detect speech, hooks, faces, or "viral moments". ── */

interface SceneData {
  id: string;
  demoClipUrl?: string | null;
  startSec?: number;
  endSec?: number;
}

interface AutoClipSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  projectId: string;
  projectDurationSec: number;
  audioUrl: string | null;
  getAccessToken: () => Promise<string | null>;
}

interface ClipJob {
  id: number;
  startSec: number;
  endSec: number;
  label: string;
  status: "pending" | "rendering" | "done" | "error";
  url?: string;
  error?: string;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* Spread N ranges across the timeline, snapping each start to the nearest
   scene boundary (within 5s) so clips cut cleanly instead of mid-shot. */
function pickClipRanges(
  scenes: SceneData[],
  durationSec: number,
  count: number,
  clipLenSec: number
): { startSec: number; endSec: number }[] {
  const boundaries: number[] = [0];
  for (const s of scenes) {
    if (typeof s.startSec === "number" && s.startSec > 0) boundaries.push(s.startSec);
    if (typeof s.endSec === "number" && s.endSec < durationSec) boundaries.push(s.endSec);
  }
  boundaries.sort((a, b) => a - b);

  const ranges: { startSec: number; endSec: number }[] = [];
  for (let i = 0; i < count; i++) {
    const windowStart = (durationSec * (i + 0.5)) / count - clipLenSec / 2;
    const clamped = Math.max(0, Math.min(durationSec - clipLenSec, windowStart));
    let best = clamped;
    let bestDist = 5;
    for (const b of boundaries) {
      const d = Math.abs(b - clamped);
      if (d < bestDist && b + clipLenSec <= durationSec) {
        best = b;
        bestDist = d;
      }
    }
    ranges.push({
      startSec: Math.round(best * 10) / 10,
      endSec: Math.round((best + clipLenSec) * 10) / 10,
    });
  }
  return ranges;
}

export function AutoClipSection({
  scenes,
  settings,
  projectId,
  projectDurationSec,
  audioUrl,
  getAccessToken,
}: AutoClipSectionProps) {
  const [clipCount, setClipCount] = useState(3);
  const [clipLen, setClipLen] = useState(15);
  const [jobs, setJobs] = useState<ClipJob[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const cancelRef = useRef(false);

  const readyScenes = scenes.filter((s) => s.demoClipUrl);
  const hasContent = readyScenes.length > 0 && projectDurationSec > 0;
  // Don't offer clip lengths longer than the video itself
  const effectiveClipLen = Math.min(clipLen, Math.floor(projectDurationSec));

  const captions = settings.captions;
  const captionExportMode = (settings.export.captionExportMode as string) ?? "burn";

  async function renderOne(job: ClipJob): Promise<string> {
    const token = await getAccessToken();
    const clipUrls = readyScenes.map((s) => s.demoClipUrl!);
    const timelineOrder = readyScenes.map((s) => s.id);
    const hasAudio = !!audioUrl;
    const va = settings.musicStudio.videoAudio;

    const res = await fetch("/api/export-final-video", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        projectId,
        clipUrls,
        audioUrl: hasAudio ? audioUrl : null,
        timelineOrder,
        testMode: false,
        aspectRatio: "9:16", // vertical for TikTok/Reels/Shorts
        fadeAudioInSec: hasAudio ? va.fadeInSec ?? 0 : 0,
        fadeAudioOutSec: hasAudio ? va.fadeOutSec ?? 0 : 0,
        loopAudio: hasAudio ? va.loop ?? false : false,
        audioStartSec: hasAudio ? va.startSec ?? 0 : 0,
        matchVideoLength: false,
        addWatermark: settings.watermarkIncludeInExport,
        customWatermarkUrl: settings.watermarkIncludeInExport ? settings.export.customWatermarkUrl ?? null : null,
        watermarkPosition: settings.watermarkPosition ?? "bottom-right",
        watermarkSize: settings.watermarkSize ?? "medium",
        watermarkMargin: settings.watermarkMargin ?? 16,
        captions: captionExportMode === "burn" && captions && captions.mode !== "none" ? captions : null,
        captionExportMode,
        branding: settings.branding ?? null,
        exportRangeStart: job.startSec,
        exportRangeEnd: job.endSec,
        clipTransitions: readyScenes.map((s) => {
          const clip = getClipEdit(settings, s.id);
          if (!clip.transition || clip.transition === "Cut") return null;
          return { type: clip.transition, duration: clip.transitionDuration ?? 1.0 };
        }),
        effects: settings.effects?.length ? settings.effects : null,
        overlayItems: settings.overlayItems?.length ? settings.overlayItems : null,
        overlayEffects: settings.overlays?.length ? settings.overlays : null,
        overlayEffectIntensity: settings.overlayIntensity ?? null,
        fitMode: settings.export.fitMode ?? "fill",
      }),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Export failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    if (!data.url) throw new Error("Export returned no download URL");
    return data.url as string;
  }

  async function runAutoClip() {
    if (!hasContent || isRunning) return;
    cancelRef.current = false;
    const ranges = pickClipRanges(readyScenes, projectDurationSec, clipCount, effectiveClipLen);
    const initial: ClipJob[] = ranges.map((r, i) => ({
      id: i,
      startSec: r.startSec,
      endSec: r.endSec,
      label: `Clip ${i + 1} · ${formatTime(r.startSec)}–${formatTime(r.endSec)}`,
      status: "pending" as const,
    }));
    setJobs(initial);
    setIsRunning(true);

    // Render sequentially to avoid hammering the backend
    for (let i = 0; i < initial.length; i++) {
      if (cancelRef.current) break;
      setJobs((prev) => prev.map((j) => (j.id === i ? { ...j, status: "rendering" } : j)));
      try {
        const url = await renderOne(initial[i]);
        setJobs((prev) => prev.map((j) => (j.id === i ? { ...j, status: "done", url } : j)));
      } catch (e) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === i ? { ...j, status: "error", error: e instanceof Error ? e.message : "Failed" } : j
          )
        );
      }
    }
    setIsRunning(false);
  }

  async function retryJob(id: number) {
    const job = jobs.find((j) => j.id === id);
    if (!job || isRunning) return;
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: "rendering", error: undefined } : j)));
    try {
      const url = await renderOne(job);
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: "done", url } : j)));
    } catch (e) {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === id ? { ...j, status: "error", error: e instanceof Error ? e.message : "Failed" } : j
        )
      );
    }
  }

  function cancelAll() {
    cancelRef.current = true;
    setIsRunning(false);
    setJobs((prev) => prev.map((j) => (j.status === "pending" ? { ...j, status: "error", error: "Cancelled" } : j)));
  }

  const doneCount = jobs.filter((j) => j.status === "done").length;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-1">
        <Scissors className="w-4 h-4 text-[#C9A84C]" />
        <h3 className="text-white font-bold text-sm">Auto-Clip</h3>
        <span className="text-[9px] font-black uppercase tracking-widest text-[#C9A84C] bg-[#C9A84C]/15 rounded px-1.5 py-0.5">
          Cheat code
        </span>
      </div>
      <p className="text-white/45 text-xs mb-3">
        Turn this video into vertical promo clips for TikTok, Reels &amp; Shorts — same captions, transitions &amp; effects as your full export.
      </p>

      {!hasContent ? (
        <p className="text-white/40 text-xs">Generate clips on your scenes first, then come back here.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 mb-3">
            <div>
              <span className="text-[11px] text-white/45 font-medium block mb-1.5">Number of clips</span>
              <div className="flex gap-1.5">
                {[3, 5, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => setClipCount(n)}
                    disabled={isRunning}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      clipCount === n
                        ? "bg-[#C9A84C]/20 text-[#C9A84C] border border-[#C9A84C]/40"
                        : "bg-white/[0.04] text-white/50 border border-white/[0.08] hover:text-white/75"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-[11px] text-white/45 font-medium block mb-1.5">Clip length</span>
              <div className="flex gap-1.5">
                {[15, 30, 60].map((n) => (
                  <button
                    key={n}
                    onClick={() => setClipLen(n)}
                    disabled={isRunning || n > projectDurationSec}
                    title={n > projectDurationSec ? "Longer than your video" : undefined}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-30 ${
                      clipLen === n
                        ? "bg-[#C9A84C]/20 text-[#C9A84C] border border-[#C9A84C]/40"
                        : "bg-white/[0.04] text-white/50 border border-white/[0.08] hover:text-white/75"
                    }`}
                  >
                    {n}s
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={runAutoClip}
              disabled={isRunning}
              className="flex-1 bg-[#C9A84C] hover:bg-[#b8963f] text-black font-bold text-xs"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  Cutting… {doneCount}/{jobs.length || clipCount}
                </>
              ) : (
                <>
                  <Scissors className="w-3.5 h-3.5 mr-1.5" />
                  Generate {clipCount} vertical clips
                </>
              )}
            </Button>
            {isRunning && (
              <Button onClick={cancelAll} variant="outline" size="sm" className="border-white/15 text-white/60 text-xs">
                <X className="w-3.5 h-3.5 mr-1" /> Cancel
              </Button>
            )}
          </div>

          {jobs.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {jobs.map((j) => (
                <div
                  key={j.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08]"
                >
                  <span className="text-white/70 text-xs">{j.label}</span>
                  {j.status === "pending" && <span className="text-white/40 text-[11px]">Queued</span>}
                  {j.status === "rendering" && (
                    <span className="text-[#C9A84C] text-[11px] flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Cutting…
                    </span>
                  )}
                  {j.status === "done" && j.url && (
                    <a
                      href={j.url}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-bold text-black bg-[#C9A84C] hover:bg-[#b8963f] rounded-lg px-2.5 py-1 flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" /> Download
                    </a>
                  )}
                  {j.status === "error" && (
                    <span className="flex items-center gap-1.5">
                      <span className="text-red-300/80 text-[11px]" title={j.error}>Failed</span>
                      {j.error !== "Cancelled" && (
                        <button
                          onClick={() => retryJob(j.id)}
                          className="text-[11px] text-white/50 hover:text-white/80 flex items-center gap-1"
                          title="Retry this clip"
                        >
                          <RotateCcw className="w-3 h-3" /> Retry
                        </button>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
