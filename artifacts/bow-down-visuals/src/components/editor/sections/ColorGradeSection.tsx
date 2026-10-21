import { useCallback, useEffect, useState } from "react";
import {
  Palette, SlidersHorizontal, Loader2, CheckCircle2, XCircle,
  Scissors, Download, Wand2, Film, RotateCcw, Share2, Copy,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";

/* ─── Color Grading — CapCut color parity ─────────────────────────────────
   Docks inside the Video Editor Color panel (rendered from EffectsSection).
   One-tap AI presets (ffmpeg eq/curves/colorbalance server-side) for
   150 Visual Bucs via POST /api/color-grade, plus manual wheels
   (temperature, tint, exposure, contrast, saturation) that live-preview
   via CSS filters on the scene thumbnail. NOTE: the backend only accepts
   preset keys — manual burn-in maps to the closest preset (see
   closestPresetFor); exact manual values cannot be burned server-side. */

const GRADE_COST = 150;

interface ColorPreset {
  key: string;
  label: string;
  blurb: string;
}

interface GradeResult {
  url: string;
  storageRef: string;
  preset: string;
  creditsRemaining: number;
}

interface ManualGrade {
  temperature: number; // -100..100 (warm ↔ cool)
  tint: number;        // -100..100 (green ↔ magenta)
  exposure: number;    // -100..100
  contrast: number;    // -100..100
  saturation: number;  // -100..100
}

const DEFAULT_WHEELS: ManualGrade = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  saturation: 0,
};

/* CSS-filter approximation of each server preset — free client-side
   preview on the swatches. The real render happens in ffmpeg. */
const PRESET_FILTER: Record<string, string> = {
  cinematic: "contrast(1.12) saturate(0.95) brightness(0.97)",
  vibrant: "contrast(1.15) saturate(1.45) brightness(1.03)",
  vintage: "contrast(0.92) saturate(0.65) brightness(1.04) sepia(0.25)",
  noir: "grayscale(1) contrast(1.25) brightness(0.98)",
  warm: "saturate(1.08) sepia(0.2)",
  cool: "saturate(1.05) hue-rotate(-10deg)",
  teal_orange: "contrast(1.08) saturate(1.15) hue-rotate(-8deg) sepia(0.08)",
  golden_hour: "brightness(1.05) saturate(1.18) contrast(1.05) sepia(0.22)",
};

/* Swatch bars for the preset cards. */
const PRESET_SWATCHES: Record<string, string[]> = {
  cinematic: ["#1a1410", "#4a3b28", "#8a6f4a", "#d9b95c"],
  vibrant: ["#ff3d71", "#ffb13d", "#3ddc84", "#3da9ff"],
  vintage: ["#c9a87c", "#a67c52", "#7a5a3a", "#4a3828"],
  noir: ["#0a0a0a", "#3a3a3a", "#7a7a7a", "#e8e8e8"],
  warm: ["#ff9a3d", "#ff6b4a", "#ffd93d", "#8a4a1a"],
  cool: ["#3da9ff", "#6b7fff", "#3ddcdd", "#1a2a4a"],
  teal_orange: ["#14b8a6", "#f97316", "#0f766e", "#fbbf24"],
  golden_hour: ["#fbbf24", "#f59e0b", "#f97316", "#78350f"],
};

function manualFilterCss(m: ManualGrade): string {
  const parts = [
    `brightness(${(1 + m.exposure / 100).toFixed(2)})`,
    `contrast(${(1 + m.contrast / 100).toFixed(2)})`,
    `saturate(${Math.max(0, 1 + m.saturation / 100).toFixed(2)})`,
  ];
  if (m.temperature > 0) parts.push(`sepia(${(m.temperature / 100 * 0.5).toFixed(2)})`);
  if (m.tint !== 0) parts.push(`hue-rotate(${(m.tint / 5).toFixed(1)}deg)`);
  return parts.join(" ");
}

function warmOverlay(m: ManualGrade): React.CSSProperties | null {
  if (m.temperature > 0)
    return { backgroundColor: `rgba(255,170,70,${(m.temperature / 100 * 0.25).toFixed(2)})` };
  if (m.temperature < 0)
    return { backgroundColor: `rgba(90,150,255,${(-m.temperature / 100 * 0.25).toFixed(2)})` };
  return null;
}

function tintOverlay(m: ManualGrade): React.CSSProperties | null {
  if (m.tint > 0)
    return { backgroundColor: `rgba(255,60,160,${(m.tint / 100 * 0.2).toFixed(2)})` };
  if (m.tint < 0)
    return { backgroundColor: `rgba(60,255,130,${(-m.tint / 100 * 0.2).toFixed(2)})` };
  return null;
}

/* Maps manual wheel values to the nearest server-side preset, since the
   backend (/api/color-grade) only accepts preset keys. */
function closestPresetFor(m: ManualGrade): string {
  const { temperature, tint, contrast, saturation, exposure } = m;
  if (saturation <= -50) return "noir";
  if (saturation <= -25 && contrast <= 10) return "vintage";
  if (saturation >= 40) return "vibrant";
  if (temperature >= 40) return "golden_hour";
  if (temperature >= 20) return "warm";
  if (temperature <= -20) return "cool";
  if (Math.abs(tint) >= 30) return "teal_orange";
  if (contrast >= 25) return "cinematic";
  if (exposure >= 25 && temperature >= 10) return "golden_hour";
  return "teal_orange";
}

const wheelsChanged = (m: ManualGrade) =>
  Object.values(m).some((v) => v !== 0);

export function ColorGradeSection({
  scenes,
  onReplaceClipVideo,
  onGoToExport,
}: {
  scenes: SceneData[];
  /** Replaces a scene's clip URL with the graded render. */
  onReplaceClipVideo?: (sceneId: string, url: string) => void;
  /** Handoff: jump to the Export tab with the graded clip queued for multi-ratio export. */
  onGoToExport?: (videoUrl?: string) => void;
}) {
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();

  const [presets, setPresets] = useState<ColorPreset[]>([]);
  const [sceneId, setSceneId] = useState<string>("");
  const [wheels, setWheels] = useState<ManualGrade>(DEFAULT_WHEELS);
  const [grading, setGrading] = useState<string | null>(null); // preset key being burned
  const [result, setResult] = useState<GradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [shared, setShared] = useState(false);

  const clips = scenes.filter((s) => !!s.demoClipUrl);
  const activeScene = clips.find((s) => s.id === sceneId) ?? clips[0] ?? null;

  useEffect(() => {
    if (!sceneId && clips[0]) setSceneId(clips[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips.length]);

  /* ── Load the 8 server presets (free) ── */
  const loadPresets = useCallback(async () => {
    try {
      const res = await confirmedFetch("/api/color-presets", { skipConfirm: true });
      if (res?.ok) {
        const data = (await res.json()) as { presets: ColorPreset[] };
        setPresets(data.presets ?? []);
      }
    } catch { /* non-fatal */ }
  }, [confirmedFetch]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  /* ── Burn a preset into the active clip (150 Visual Bucs) ── */
  async function applyPreset(presetKey: string, opts?: { auto?: boolean; manual?: boolean }) {
    const videoUrl = activeScene?.demoClipUrl;
    if (!videoUrl) return;
    setGrading(presetKey);
    setError(null);
    setResult(null);
    try {
      const res = await confirmedFetch("/api/color-grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, preset: presetKey }),
        overrideCost: GRADE_COST,
        overrideFeature: "Color Grade",
      });
      if (res === null) return; // user cancelled the credit confirm
      const data = (await res.json().catch(() => ({}))) as Partial<GradeResult> & { error?: string; message?: string };
      if (!res.ok || !data.url) {
        setError(data.message ?? data.error ?? "Color grade failed — no Visual Bucs were spent.");
        return;
      }
      const presetLabel = presets.find((p) => p.key === presetKey)?.label ?? presetKey;
      setResult({
        url: data.url!,
        storageRef: data.storageRef ?? "",
        preset: presetKey,
        creditsRemaining: data.creditsRemaining ?? 0,
      });
      toast({
        title: opts?.auto ? "Auto-grade done" : "Grade burned in",
        description: opts?.manual
          ? `Manual wheels → closest preset "${presetLabel}" — ${GRADE_COST} Visual Bucs.`
          : `"${presetLabel}" applied — ${GRADE_COST} Visual Bucs.`,
      });
    } catch {
      setError("Color grade failed — no Visual Bucs were spent.");
    } finally {
      setGrading(null);
    }
  }

  /* ── Auto-grade heuristic ──
     Picks "vibrant": punchy saturation + contrast is the highest
     scroll-stop look on social feeds, where most exports from this editor
     land (mobile-first, sound-off browsing). */
  function handleAutoGrade() {
    void applyPreset("vibrant", { auto: true });
  }

  /* ── Manual burn-in: backend only takes presets, so grade with the
     closest matching preset to the wheel values. ── */
  function handleBurnManual() {
    void applyPreset(closestPresetFor(wheels), { manual: true });
  }

  function setWheel(key: keyof ManualGrade, value: number) {
    setWheels((prev) => ({ ...prev, [key]: value }));
  }

  /* ── Handoff: attach the graded clip to the scene ── */
  function handleUseInEditor() {
    if (!result || !activeScene || !onReplaceClipVideo) return;
    setAttaching(true);
    try {
      onReplaceClipVideo(activeScene.id, result.url);
      const presetLabel = presets.find((p) => p.key === result.preset)?.label ?? result.preset;
      toast({
        title: "In the timeline",
        description: `Scene ${activeScene.sceneNumber} now plays the "${presetLabel}" grade.`,
      });
    } finally {
      setAttaching(false);
    }
  }

  async function handleCopyLink() {
    if (!result) return;
    await navigator.clipboard.writeText(result.url);
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  }

  const thumb = activeScene?.thumbnailUrl ?? null;
  const busy = grading !== null;
  const manualActive = wheelsChanged(wheels);
  const closest = closestPresetFor(wheels);
  const closestLabel = presets.find((p) => p.key === closest)?.label ?? closest;

  if (clips.length === 0) {
    return (
      <EditorCard title="Color Grading" subtitle="AI color grades — one tap, burned into the clip" icon={<Palette className="h-4 w-4" />}>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 text-center">
          <Film className="h-6 w-6 mx-auto text-white/25 mb-2" />
          <p className="text-sm font-semibold text-white/80">No clips on the timeline yet</p>
          <p className="text-xs text-white/40 mt-1">Add a clip to a scene first, then grade it.</p>
        </div>
      </EditorCard>
    );
  }

  const wheelDefs: { key: keyof ManualGrade; label: string; hint: string }[] = [
    { key: "temperature", label: "Temperature", hint: "Cool ↔ Warm" },
    { key: "tint", label: "Tint", hint: "Green ↔ Magenta" },
    { key: "exposure", label: "Exposure", hint: "Dark ↔ Bright" },
    { key: "contrast", label: "Contrast", hint: "Flat ↔ Punchy" },
    { key: "saturation", label: "Saturation", hint: "Muted ↔ Vivid" },
  ];

  return (
    <EditorCard
      title="Color Grading"
      subtitle="AI color grades — one tap, burned into the clip"
      icon={<Palette className="h-4 w-4" />}
      right={
        <span className="text-[10px] font-black uppercase tracking-wider text-[#C9A84C] border border-[#C9A84C]/40 bg-[#C9A84C]/10 rounded-full px-2 py-0.5">
          {GRADE_COST} VB / grade · preview free
        </span>
      }
    >
      <div className="space-y-4">
        {/* ── Scene picker ── */}
        <div>
          <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-2">Clip to grade</p>
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

        {/* ── Manual wheels: live CSS-filter preview on the thumbnail ── */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Manual wheels — live preview
            </p>
            {manualActive && (
              <button
                onClick={() => setWheels(DEFAULT_WHEELS)}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-white/50 hover:text-white transition-colors"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            )}
          </div>
          <div className="grid sm:grid-cols-[1fr_1fr] gap-3">
            {/* Preview frame */}
            <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black min-h-32">
              {thumb ? (
                <img
                  src={thumb}
                  alt="Manual grade live preview"
                  className="w-full h-full object-cover"
                  style={{ filter: manualFilterCss(wheels) }}
                />
              ) : (
                <div
                  className="absolute inset-0 bg-gradient-to-br from-[#2a2118] via-[#3a2c1a] to-[#1a1410]"
                  style={{ filter: manualFilterCss(wheels) }}
                />
              )}
              {warmOverlay(wheels) && (
                <div className="absolute inset-0 pointer-events-none mix-blend-overlay" style={warmOverlay(wheels)!} />
              )}
              {tintOverlay(wheels) && (
                <div className="absolute inset-0 pointer-events-none mix-blend-overlay" style={tintOverlay(wheels)!} />
              )}
              <p className="absolute bottom-1 left-2 text-[10px] font-bold text-white/60 bg-black/50 rounded px-1.5 py-0.5">
                Free preview
              </p>
            </div>
            {/* Sliders */}
            <div className="space-y-2.5">
              {wheelDefs.map(({ key, label, hint }) => (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-white/70">{label}</label>
                    <span className="text-[10px] text-white/40">
                      {hint} · {wheels[key] > 0 ? "+" : ""}{wheels[key]}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={wheels[key]}
                    onChange={(e) => setWheel(key, Number(e.target.value))}
                    className="w-full accent-[#C9A84C]"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              onClick={handleBurnManual}
              disabled={!manualActive || busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-black bg-[#C9A84C] hover:bg-[#d9b95c] disabled:opacity-40 transition-colors"
            >
              {grading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />}
              {grading ? "Burning…" : `Burn in manual look · ${GRADE_COST} VB`}
            </button>
            <p className="text-[11px] text-white/40">
              Burns the closest AI preset ("{closestLabel}") — the server renders presets only, so exact
              wheel values stay as preview.
            </p>
          </div>
        </div>

        {/* ── Auto-grade ── */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleAutoGrade}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black border border-[#C9A84C]/50 text-[#C9A84C] hover:bg-[#C9A84C]/10 disabled:opacity-50 transition-colors"
          >
            {grading === "vibrant" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            {grading === "vibrant" ? "Grading…" : `Auto-grade · ${GRADE_COST} VB`}
          </button>
          <p className="text-[11px] text-white/40">Picks the best look for the feed — Vibrant pops on social.</p>
        </div>

        {/* ── One-tap preset grid ── */}
        <div>
          <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-2">One-tap grades — burned on tap</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {presets.map((p) => {
              const isGrading = grading === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => void applyPreset(p.key)}
                  disabled={busy}
                  className={`rounded-xl border p-2.5 text-left transition-all disabled:opacity-60 ${
                    isGrading ? "border-[#C9A84C] bg-[#C9A84C]/10" : "border-white/10 bg-white/[0.02] hover:border-white/25"
                  }`}
                  title={`${p.blurb} — ${GRADE_COST} Visual Bucs`}
                >
                  <div
                    className="h-12 rounded-md overflow-hidden mb-1.5 border border-black/40"
                    style={{ filter: PRESET_FILTER[p.key] ?? "none" }}
                  >
                    <div className="flex h-full">
                      {(PRESET_SWATCHES[p.key] ?? ["#3a3a3a", "#6a6a6a"]).map((c) => (
                        <span key={c} className="flex-1" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                  <p className="text-xs font-black text-white flex items-center gap-1">
                    {isGrading && <Loader2 className="h-3 w-3 animate-spin" />}
                    {p.label}
                  </p>
                  <p className="text-[10px] text-white/40 leading-tight mt-0.5 line-clamp-2">{p.blurb}</p>
                </button>
              );
            })}
          </div>
          {presets.length === 0 && (
            <p className="text-xs text-white/40 py-2">Loading presets…</p>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-200">{error}</p>
          </div>
        )}

        {/* ── Graded result + handoffs ── */}
        {result && (
          <div className="rounded-xl border border-[#C9A84C]/40 bg-[#C9A84C]/[0.05] p-3 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#C9A84C]" />
              <p className="text-sm font-black text-white">
                Graded — "{presets.find((p) => p.key === result.preset)?.label ?? result.preset}"
              </p>
            </div>
            <video src={result.url} controls playsInline className="w-full rounded-lg border border-white/10 max-h-64 bg-black" />
            <div className="flex flex-wrap gap-2">
              {onGoToExport && (
                <button
                  onClick={() => onGoToExport(result.url)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-black bg-[#C9A84C] hover:bg-[#d9b95c] transition-colors"
                >
                  <Film className="h-3.5 w-3.5" />
                  Use in export
                </button>
              )}
              {onReplaceClipVideo && activeScene && (
                <button
                  onClick={handleUseInEditor}
                  disabled={attaching}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black border border-white/15 text-white hover:bg-white/10 disabled:opacity-50 transition-colors"
                >
                  {attaching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
                  {attaching ? "Attaching…" : "Replace scene clip"}
                </button>
              )}
              <a
                href={result.url}
                download={`color-graded-${result.preset}.mp4`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-white/15 text-white hover:bg-white/10 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
              <button
                onClick={() => void handleCopyLink()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-white/15 text-white hover:bg-white/10 transition-colors"
              >
                {shared ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                {shared ? "Link copied" : "Copy link"}
              </button>
            </div>
            <div className="flex items-center gap-1.5 pt-1 border-t border-white/[0.06]">
              <Share2 className="h-3 w-3 text-white/30" />
              <p className="text-[10px] text-white/30">
                One-click sharing built to travel — Bow Down Visuals attribution rides along on every output.
              </p>
            </div>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
