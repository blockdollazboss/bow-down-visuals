import { useState } from "react";

/* ── AutoClipSection ───────────────────────────────────────────────
   The content creator's cheat code for distribution: turn a finished
   music video into N vertical promo clips in one tap. Uses the existing
   export API with ranges — no new backend needed.
   Smart moment detection: prefers scene boundaries, spreads clips
   across the timeline, and favors the middle (where hooks live). ── */

interface Scene {
  id: string;
  startSec?: number;
  endSec?: number;
  durationSec?: number;
}

interface AutoClipSectionProps {
  scenes: Scene[];
  projectId: string;
  projectDurationSec: number;
  clipUrls: string[];
  audioUrl: string | null;
  aspectRatio?: string;
  getAccessToken: () => Promise<string | null>;
  effectiveWatermark: boolean;
  customWatermarkUrl?: string | null;
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

/* Pick N smart ranges across the timeline.
   Strategy: divide the video into N equal windows, then snap each
   window's start to the nearest scene boundary so clips cut cleanly. */
function pickClipRanges(
  scenes: Scene[],
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
    // Spread windows across the video, biasing toward the middle 80%
    const windowStart = (durationSec * (i + 0.5)) / count - clipLenSec / 2;
    const clamped = Math.max(0, Math.min(durationSec - clipLenSec, windowStart));
    // Snap to nearest scene boundary within ±5s
    let best = clamped;
    let bestDist = 5;
    for (const b of boundaries) {
      const d = Math.abs(b - clamped);
      if (d < bestDist && b + clipLenSec <= durationSec) {
        best = b;
        bestDist = d;
      }
    }
    ranges.push({ startSec: Math.round(best * 10) / 10, endSec: Math.round((best + clipLenSec) * 10) / 10 });
  }
  return ranges;
}

export function AutoClipSection({
  scenes,
  projectId,
  projectDurationSec,
  clipUrls,
  audioUrl,
  aspectRatio = "16:9",
  getAccessToken,
  effectiveWatermark,
  customWatermarkUrl,
}: AutoClipSectionProps) {
  const [clipCount, setClipCount] = useState(3);
  const [clipLen, setClipLen] = useState(15);
  const [jobs, setJobs] = useState<ClipJob[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const hasContent = clipUrls.length > 0 && projectDurationSec > 0;

  async function runAutoClip() {
    if (!hasContent || isRunning) return;
    const ranges = pickClipRanges(scenes, projectDurationSec, clipCount, clipLen);
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
      setJobs((prev) => prev.map((j) => (j.id === i ? { ...j, status: "rendering" } : j)));
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/generate/export-video", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            projectId,
            clipUrls,
            audioUrl,
            timelineOrder: scenes.map((s) => s.id),
            testMode: false,
            aspectRatio: "9:16", // vertical for TikTok/Reels/Shorts
            addWatermark: effectiveWatermark,
            customWatermarkUrl: effectiveWatermark ? (customWatermarkUrl ?? null) : null,
            exportRangeStart: initial[i].startSec,
            exportRangeEnd: initial[i].endSec,
            fitMode: "fill",
          }),
          signal: AbortSignal.timeout(10 * 60 * 1000),
        });
        if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
        const data = await res.json();
        setJobs((prev) => prev.map((j) => (j.id === i ? { ...j, status: "done", url: data.url } : j)));
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

  const doneCount = jobs.filter((j) => j.status === "done").length;

  return (
    <div className="rounded-2xl border border-white/[0.12] bg-white/[0.03] p-5">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="text-xl">✂️</span>
        <h3 className="text-white/90 font-semibold text-base">Auto-Clip</h3>
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/90 bg-amber-400/10 border border-amber-300/20 rounded-full px-2 py-0.5">
          Cheat code
        </span>
      </div>
      <p className="text-white/50 text-sm mb-4">
        Turn this video into vertical promo clips for TikTok, Reels &amp; Shorts — in one tap.
      </p>

      {!hasContent ? (
        <p className="text-white/45 text-sm">Add clips to your timeline first, then come back here.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4 mb-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-white/50 text-xs font-medium">Number of clips</span>
              <div className="flex gap-1.5">
                {[3, 5, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => setClipCount(n)}
                    disabled={isRunning}
                    className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition ${
                      clipCount === n
                        ? "bg-amber-400/20 text-amber-200 border border-amber-300/40"
                        : "bg-white/[0.04] text-white/50 border border-white/[0.12] hover:text-white/70"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-white/50 text-xs font-medium">Clip length</span>
              <div className="flex gap-1.5">
                {[15, 30, 60].map((n) => (
                  <button
                    key={n}
                    onClick={() => setClipLen(n)}
                    disabled={isRunning}
                    className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition ${
                      clipLen === n
                        ? "bg-amber-400/20 text-amber-200 border border-amber-300/40"
                        : "bg-white/[0.04] text-white/50 border border-white/[0.12] hover:text-white/70"
                    }`}
                  >
                    {n}s
                  </button>
                ))}
              </div>
            </label>
          </div>

          <button
            onClick={runAutoClip}
            disabled={isRunning}
            className="w-full py-3 rounded-xl font-semibold text-black bg-gradient-to-r from-amber-300 to-yellow-500 hover:from-amber-200 hover:to-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isRunning
              ? `Cutting clips… ${doneCount}/${jobs.length || clipCount}`
              : `✂️ Generate ${clipCount} vertical clips`}
          </button>

          {jobs.length > 0 && (
            <div className="mt-4 space-y-2">
              {jobs.map((j) => (
                <div
                  key={j.id}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.12]"
                >
                  <span className="text-white/70 text-sm">{j.label}</span>
                  {j.status === "pending" && <span className="text-white/45 text-xs">Queued</span>}
                  {j.status === "rendering" && (
                    <span className="text-amber-300/90 text-xs animate-pulse">Cutting…</span>
                  )}
                  {j.status === "done" && j.url && (
                    <a
                      href={j.url}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-black bg-amber-300 hover:bg-amber-200 rounded-lg px-3 py-1.5 transition"
                    >
                      Download
                    </a>
                  )}
                  {j.status === "error" && (
                    <span className="text-red-300/80 text-xs" title={j.error}>
                      Failed
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
