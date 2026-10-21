import { useEffect, useState } from "react";
import {
  Film, Loader2, CheckCircle2, XCircle, Scissors, Download, Video, Gauge, Waves,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";

/* ─── Stabilize — CapCut-style video stabilization ────────────────────
   One-tap "Stabilize" with sensible defaults (shakiness 10, smoothing 30)
   plus manual sliders up top. POST /api/stabilize → ffmpeg vidstab two-pass
   (detect + transform). 300 Visual Bucs per stabilize. */

const STABILIZE_COST = 300;
const DEFAULT_SHAKINESS = 10;
const DEFAULT_SMOOTHING = 30;

interface StabilizeResult {
  url: string;
  storageRef: string;
  creditsRemaining: number;
}

export function StabilizeSection({
  scenes,
  onReplaceClipVideo,
  onGoToExport,
}: {
  scenes: SceneData[];
  /** Replaces a scene's clip URL with the stabilized render. */
  onReplaceClipVideo?: (sceneId: string, url: string) => void;
  /** Handoff: jump to the Export tab with the stabilized clip queued. */
  onGoToExport?: (videoUrl?: string) => void;
}) {
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();

  const [sceneId, setSceneId] = useState<string>("");
  const [shakiness, setShakiness] = useState(DEFAULT_SHAKINESS);
  const [smoothing, setSmoothing] = useState(DEFAULT_SMOOTHING);
  const [stabilizing, setStabilizing] = useState(false);
  const [using, setUsing] = useState(false);
  const [result, setResult] = useState<StabilizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clips = scenes.filter((s) => !!s.demoClipUrl);
  const activeScene = clips.find((s) => s.id === sceneId) ?? clips[0] ?? null;

  useEffect(() => {
    if (!sceneId && clips[0]) setSceneId(clips[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips.length]);

  function handleResetDefaults() {
    setShakiness(DEFAULT_SHAKINESS);
    setSmoothing(DEFAULT_SMOOTHING);
  }

  async function handleStabilize() {
    if (!activeScene?.demoClipUrl || stabilizing) return;
    setStabilizing(true);
    setError(null);
    setResult(null);
    try {
      const res = await confirmedFetch("/api/stabilize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: activeScene.demoClipUrl,
          shakiness,
          smoothing,
        }),
        overrideCost: STABILIZE_COST,
        overrideFeature: "Video Stabilization",
      });
      if (res === null) return; // user cancelled the credit confirm
      const data = (await res.json().catch(() => ({}))) as Partial<StabilizeResult> & { error?: string; message?: string };
      if (!res.ok || !data.url) {
        setError(data.message ?? data.error ?? "Stabilization failed — no Visual Bucs were spent.");
        return;
      }
      setResult({ url: data.url!, storageRef: data.storageRef ?? "", creditsRemaining: data.creditsRemaining ?? 0 });
      toast({ title: "Clip stabilized", description: `Shake smoothed out — ${STABILIZE_COST} Visual Bucs.` });
    } catch {
      setError("Stabilization failed — no Visual Bucs were spent.");
    } finally {
      setStabilizing(false);
    }
  }

  function handleUseInEditor() {
    if (!result || !activeScene || !onReplaceClipVideo) return;
    setUsing(true);
    try {
      onReplaceClipVideo(activeScene.id, result.url);
      toast({ title: "In the timeline", description: `Scene ${activeScene.sceneNumber} now plays the stabilized clip.` });
    } finally {
      setUsing(false);
    }
  }

  if (clips.length === 0) {
    return (
      <EditorCard title="Stabilize" subtitle="Smooth shaky footage — vidstab two-pass, one tap" icon={<Video className="h-4 w-4" />}>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 text-center">
          <Film className="h-6 w-6 mx-auto text-white/25 mb-2" />
          <p className="text-sm font-semibold text-white/80">No clips on the timeline yet</p>
          <p className="text-xs text-white/40 mt-1">Add a clip to a scene first, then smooth out the shake.</p>
        </div>
      </EditorCard>
    );
  }

  const isDefaults = shakiness === DEFAULT_SHAKINESS && smoothing === DEFAULT_SMOOTHING;

  return (
    <EditorCard
      title="Stabilize"
      subtitle="Smooth shaky footage — vidstab two-pass, one tap"
      icon={<Video className="h-4 w-4" />}
      right={
        <span className="text-[10px] font-black uppercase tracking-wider text-[#C9A84C] border border-[#C9A84C]/40 bg-[#C9A84C]/10 rounded-full px-2 py-0.5">
          {STABILIZE_COST} VB / stabilize
        </span>
      }
    >
      <div className="space-y-4">
        {/* ── Scene picker ── */}
        <div>
          <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-2">Clip to stabilize</p>
          <div className="flex flex-wrap gap-2">
            {clips.map((s) => (
              <button
                key={s.id}
                onClick={() => { setSceneId(s.id); setResult(null); setError(null); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  s.id === activeScene?.id
                    ? "bg-[#C9A84C] text-black border-[#C9A84C]"
                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                Scene {s.sceneNumber}
              </button>
            ))}
          </div>
        </div>

        {/* ── Manual controls ── */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Fine-tune (optional)</p>
            {!isDefaults && (
              <button
                onClick={handleResetDefaults}
                className="text-[11px] font-bold text-[#C9A84C] hover:underline"
              >
                Reset defaults
              </button>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-white flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5 text-[#C9A84C]" />
                Shake handling
              </label>
              <span className="text-xs font-black text-[#C9A84C] tabular-nums">{shakiness}/10</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={shakiness}
              onChange={(e) => setShakiness(Number(e.target.value))}
              className="w-full accent-[#C9A84C]"
              aria-label="Shake handling"
            />
            <p className="text-[11px] text-white/40 mt-1">
              Higher handles more shake. {shakiness >= 8 ? "Maximum shake detection." : shakiness >= 4 ? "Balanced — mild to moderate shake." : "Light touch — barely shaky footage."}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-white flex items-center gap-1.5">
                <Waves className="h-3.5 w-3.5 text-[#C9A84C]" />
                Smoothness
              </label>
              <span className="text-xs font-black text-[#C9A84C] tabular-nums">{smoothing}/100</span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={smoothing}
              onChange={(e) => setSmoothing(Number(e.target.value))}
              className="w-full accent-[#C9A84C]"
              aria-label="Smoothness"
            />
            <p className="text-[11px] text-white/40 mt-1">
              Smoother but more crop. {smoothing >= 50 ? "Very smooth — expect noticeable edge crop." : smoothing >= 20 ? "Natural steady-cam feel." : "Subtle — keeps almost the full frame."}
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-200">{error}</p>
          </div>
        )}

        {/* ── One-tap stabilize ── */}
        <button
          onClick={() => void handleStabilize()}
          disabled={stabilizing}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black text-black bg-[#C9A84C] hover:bg-[#d9b95c] disabled:opacity-50 transition-colors"
        >
          {stabilizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
          {stabilizing ? "Stabilizing…" : `Stabilize · ${STABILIZE_COST} VB`}
        </button>
        {stabilizing && (
          <p className="text-[11px] text-white/40 -mt-2">Two-pass stabilization can take a minute on longer clips.</p>
        )}

        {/* ── Result + handoffs ── */}
        {result && (
          <div className="rounded-xl border border-[#C9A84C]/40 bg-[#C9A84C]/[0.05] p-3 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#C9A84C]" />
              <p className="text-sm font-black text-white">Stabilized</p>
            </div>
            <video src={result.url} controls playsInline className="w-full rounded-lg border border-white/10 max-h-64 bg-black" />
            <div className="flex flex-wrap gap-2">
              {onReplaceClipVideo && activeScene && (
                <button
                  onClick={handleUseInEditor}
                  disabled={using}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-black bg-[#C9A84C] hover:bg-[#d9b95c] disabled:opacity-50 transition-colors"
                >
                  {using ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
                  {using ? "Attaching…" : "Use in editor"}
                </button>
              )}
              {onGoToExport && (
                <button
                  onClick={() => onGoToExport(result.url)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-white/15 text-white hover:bg-white/10 transition-colors"
                >
                  Use in export
                </button>
              )}
              <a
                href={result.url}
                download={`stabilized-scene-${activeScene?.sceneNumber ?? "clip"}.mp4`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-white/15 text-white hover:bg-white/10 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            </div>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
