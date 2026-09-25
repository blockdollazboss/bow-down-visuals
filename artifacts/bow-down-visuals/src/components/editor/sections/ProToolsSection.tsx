import { useMemo, useRef, useState } from "react";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import {
  SlidersHorizontal, Sparkles, RotateCw, FlipHorizontal2, FlipVertical2,
  Gauge, Scissors, Droplets, Pipette, RefreshCw, Loader2, Wand2,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import {
  getClipEdit,
  defaultColorCorrection,
  defaultProTools,
  proToolsActive,
  GRADE_PRESET_CORRECTIONS,
  SPEED_PRESETS,
  CROP_ASPECTS,
  type ClipEdit,
  type EditorSettings,
  type ProToolsSettings,
  type ColorCorrectionSettings,
  type CropAspect,
} from "@/lib/editor-settings";
import {
  autoLevelsFromFrame,
  detectChromaColor,
  captureFrameDataUrl,
  samplePixelHex,
} from "@/lib/pro-tools-preview";
import { EditorCard, Collapsible, Chip } from "@/components/editor/controls";
import { useToast } from "@/hooks/use-toast";

/* ── Pro Tools tab ───────────────────────────────────────────────────────
 * Per-clip professional tools: color correction, chroma key, speed, reverse,
 * rotate/flip, crop. Every card follows the standing directive: a prominent
 * ✨ AI/auto one-tap button as the DEFAULT surface, with manual controls
 * behind an "Advanced" toggle (Collapsible). Never manual-only.
 *
 * Every control writes into ClipEdit.proTools, which flows to the real
 * server-side FFmpeg export via FinalVideoExport → clipProTools →
 * buildProToolsFilterChain() (api-server: pro-tools-ffmpeg.ts).
 */

const SLIDERS: { key: keyof ColorCorrectionSettings; label: string }[] = [
  { key: "brightness", label: "Brightness" },
  { key: "contrast", label: "Contrast" },
  { key: "saturation", label: "Saturation" },
  { key: "temperature", label: "Warmth" },
  { key: "tint", label: "Tint" },
  { key: "highlights", label: "Highlights" },
  { key: "shadows", label: "Shadows" },
  { key: "vibrance", label: "Vibrance" },
  { key: "exposure", label: "Exposure" },
];

function SliderRow({
  label, value, onChange,
}: {
  label: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 w-full min-w-0 py-0.5">
      <span className="text-[11px] font-semibold text-white/60 w-24 shrink-0 truncate">{label}</span>
      <input
        type="range" min={-100} max={100} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 min-w-0 cursor-pointer"
        style={{ accentColor: "#C9A84C" }}
        data-testid={`pro-slider-${label.toLowerCase().replace(/\s+/g, "-")}`}
      />
      <span className="text-[10px] font-mono text-white/40 w-10 text-right shrink-0">
        {value > 0 ? `+${value}` : value}
      </span>
    </div>
  );
}

function AiButton({
  onClick, loading, children, testId, title,
}: {
  onClick: () => void; loading?: boolean; children: React.ReactNode;
  testId: string; title?: string;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={loading} title={title}
      data-testid={testId}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm
        bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
        hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20
        disabled:opacity-50 disabled:cursor-wait"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function ProToolsSection({
  scenes,
  settings,
  setSettings,
  videoRef,
}: {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  /** Master player video element — used to capture the current frame for AI analysis. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);
  const [keying, setKeying] = useState(false);
  const [look, setLook] = useState("");
  const [eyedropperOn, setEyedropperOn] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const clips = useMemo(() => scenes.filter((s) => s.demoClipUrl), [scenes]);
  const activeScene = clips.find((s) => s.id === sceneId) ?? clips[0] ?? null;
  const clip: ClipEdit | null = activeScene ? getClipEdit(settings, activeScene.id) : null;
  const pt: ProToolsSettings = clip?.proTools ?? defaultProTools();

  function patchProTools(patch: Partial<ProToolsSettings>) {
    if (!activeScene || !clip) return;
    setSettings({
      ...settings,
      clips: {
        ...settings.clips,
        [activeScene.id]: { ...clip, proTools: { ...pt, ...patch } },
      },
    });
  }

  function patchColor(patch: Partial<ColorCorrectionSettings>) {
    patchProTools({ colorCorrection: { ...pt.colorCorrection, ...patch } });
  }

  /* ── AI Auto-Grade (1 credit, backend vision) ── */
  async function handleAutoGrade() {
    const video = videoRef.current;
    const frame = video ? captureFrameDataUrl(video) : null;
    if (!frame && !look.trim()) {
      toast({
        title: "No frame to analyze",
        description: "Play the clip so a frame is loaded, or describe the look you want.",
        variant: "destructive",
      });
      return;
    }
    setGrading(true);
    try {
      const res = await confirmedFetch("/api/pro-tools/auto-grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameDataUrl: frame ?? "", look: look.trim() }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const body = await res.json().catch(() => ({}));
      if (res.status === 402) {
        toast({ title: "Out of credits", description: "Top up to use AI Auto-Grade.", variant: "destructive" });
        return;
      }
      if (!res.ok || !body.correction) throw new Error(body.error ?? "Auto-grade failed");
      patchColor(body.correction);
      toast({
        title: "✨ AI Auto-Grade applied",
        description: body.usedVision
          ? "Vision AI analyzed your frame and set the correction."
          : "AI set the correction from your look description (frame analysis unavailable).",
      });
    } catch (err) {
      toast({
        title: "Auto-grade failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setGrading(false);
    }
  }

  /* ── Free Auto-Levels (client-side histogram, no credits) ── */
  function handleAutoLevels() {
    const video = videoRef.current;
    if (!video) {
      toast({ title: "No frame", description: "Play the clip first.", variant: "destructive" });
      return;
    }
    const levels = autoLevelsFromFrame(video);
    if (!levels) {
      toast({ title: "Couldn't sample frame", description: "The video source blocks frame sampling.", variant: "destructive" });
      return;
    }
    patchColor(levels);
    toast({ title: "Auto-Levels applied", description: "Free instant histogram correction — no credits used." });
  }

  /* ── AI Auto-Key (client-side dominant-color detection, free) ── */
  function handleAutoKey() {
    const video = videoRef.current;
    if (!video) {
      toast({ title: "No frame", description: "Play the clip first.", variant: "destructive" });
      return;
    }
    setKeying(true);
    try {
      const found = detectChromaColor(video);
      if (!found) {
        toast({
          title: "No green/blue backdrop found",
          description: "Point the camera at a solid green or blue background, or pick the color manually in Advanced.",
          variant: "destructive",
        });
        return;
      }
      patchProTools({
        chromaKey: { ...pt.chromaKey, enabled: true, color: found.color, similarity: found.similarity },
      });
      toast({ title: "✨ Auto-Key applied", description: `Detected backdrop ${found.color} — free, no credits used.` });
    } finally {
      setKeying(false);
    }
  }

  function handleEyedropperPick(e: React.MouseEvent<HTMLVideoElement>) {
    const video = previewVideoRef.current;
    if (!video) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const hex = samplePixelHex(video, nx, ny);
    if (hex) {
      patchProTools({ chromaKey: { ...pt.chromaKey, enabled: true, color: hex } });
      toast({ title: "Color picked", description: hex });
    }
    setEyedropperOn(false);
  }

  function resetAll() {
    if (!activeScene || !clip) return;
    setSettings({
      ...settings,
      clips: { ...settings.clips, [activeScene.id]: { ...clip, proTools: defaultProTools() } },
    });
    toast({ title: "Pro Tools reset", description: "All tools back to neutral for this clip." });
  }

  if (!activeScene) {
    return (
      <EditorCard title="Pro Tools" subtitle="Color, keying, speed, geometry" icon={<SlidersHorizontal className="h-4 w-4" />}>
        <p className="text-white/40 text-sm">Add a video clip to a scene to unlock Pro Tools.</p>
      </EditorCard>
    );
  }

  const ccActive = proToolsActive({ ...defaultProTools(), colorCorrection: pt.colorCorrection });

  return (
    <div className="space-y-4">
      {/* Scene picker */}
      <div className="flex items-center gap-3">
        <select
          value={activeScene.id}
          onChange={(e) => setSceneId(e.target.value)}
          data-testid="pro-tools-scene-picker"
          className="bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-primary/40 transition-colors"
          style={{ colorScheme: "dark" }}
        >
          {clips.map((s, i) => (
            <option key={s.id} value={s.id}>Scene {i + 1}</option>
          ))}
        </select>
        {proToolsActive(pt) && (
          <button
            type="button" onClick={resetAll}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white/40 hover:text-white/70 transition-colors"
            data-testid="pro-tools-reset"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Reset clip
          </button>
        )}
      </div>

      {/* ── 1. Color correction ── */}
      <EditorCard
        title="Color Correction"
        subtitle="AI grades the frame — or dial it in by hand"
        icon={<Droplets className="h-4 w-4" />}
        data-testid="pro-card-color"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <AiButton onClick={handleAutoGrade} loading={grading} testId="pro-ai-auto-grade"
              title="1 credit — AI analyzes the frame and sets every slider">
              AI Auto-Grade · 1 credit
            </AiButton>
            <button
              type="button" onClick={handleAutoLevels}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:border-white/25 transition-colors"
              data-testid="pro-auto-levels" title="Free — instant histogram-based levels, no credits"
            >
              <Wand2 className="h-3.5 w-3.5" /> Auto-Levels · Free
            </button>
          </div>
          <input
            type="text" value={look} onChange={(e) => setLook(e.target.value)}
            placeholder='Describe the look — e.g. "warm cinematic", "cold drill night" (optional)'
            className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C9A84C]/50"
            data-testid="pro-look-input"
          />
          <div>
            <p className="text-[11px] font-black text-white/40 uppercase tracking-widest mb-2">Grade presets — starting points</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(GRADE_PRESET_CORRECTIONS).map((name) => (
                <Chip
                  key={name}
                  active={pt.colorGradePreset === name}
                  onClick={() => {
                    const preset = GRADE_PRESET_CORRECTIONS[name];
                    if (preset) patchProTools({ colorCorrection: { ...preset }, colorGradePreset: name });
                  }}
                >
                  {name}
                </Chip>
              ))}
              {pt.colorGradePreset && (
                <Chip active={false} onClick={() => patchProTools({ colorGradePreset: null })}>
                  ✕ Clear preset
                </Chip>
              )}
            </div>
          </div>
          <Collapsible title={`Advanced — manual sliders${ccActive ? " ●" : ""}`}>
            <div className="space-y-1">
              {SLIDERS.map(({ key, label }) => (
                <SliderRow key={key} label={label} value={pt.colorCorrection[key]}
                  onChange={(v) => patchColor({ [key]: v } as Partial<ColorCorrectionSettings>)} />
              ))}
              <button
                type="button"
                onClick={() => patchProTools({ colorCorrection: defaultColorCorrection(), colorGradePreset: null })}
                className="text-[11px] font-bold text-white/35 hover:text-white/60 transition-colors pt-1"
                data-testid="pro-color-reset"
              >
                Reset sliders
              </button>
            </div>
          </Collapsible>
        </div>
      </EditorCard>

      {/* ── 2. Chroma key ── */}
      <EditorCard
        title="Chroma Key"
        subtitle="Remove green/blue backdrops"
        icon={<Pipette className="h-4 w-4" />}
        data-testid="pro-card-chroma"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <AiButton onClick={handleAutoKey} loading={keying} testId="pro-ai-auto-key"
              title="Free — detects the dominant green/blue backdrop and sets tolerance automatically">
              AI Auto-Key · Free
            </AiButton>
            <label className="inline-flex items-center gap-2 text-xs font-bold text-white/60 cursor-pointer ml-1">
              <input
                type="checkbox" checked={pt.chromaKey.enabled}
                onChange={(e) => patchProTools({ chromaKey: { ...pt.chromaKey, enabled: e.target.checked } })}
                className="h-4 w-4" style={{ accentColor: "#C9A84C" }}
                data-testid="pro-chroma-enabled"
              />
              Enabled
            </label>
          </div>
          <Collapsible title={`Advanced — color picker & edges${pt.chromaKey.enabled ? " ●" : ""}`}>
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="color" value={pt.chromaKey.color}
                  onChange={(e) => patchProTools({ chromaKey: { ...pt.chromaKey, enabled: true, color: e.target.value } })}
                  className="h-9 w-12 rounded cursor-pointer bg-transparent"
                  data-testid="pro-chroma-color"
                />
                {["#00ff00", "#0000ff", "#00b140", "#0a84ff"].map((c) => (
                  <button
                    key={c} type="button" title={c}
                    onClick={() => patchProTools({ chromaKey: { ...pt.chromaKey, enabled: true, color: c } })}
                    className="h-7 w-7 rounded-full border border-white/20"
                    style={{ backgroundColor: c }}
                    data-testid={`pro-chroma-swatch-${c.replace("#", "")}`}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setEyedropperOn((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                    eyedropperOn ? "border-[#C9A84C]/60 bg-[#C9A84C]/15 text-[#C9A84C]" : "border-white/10 text-white/50 hover:text-white/80"
                  }`}
                  data-testid="pro-chroma-eyedropper"
                >
                  <Pipette className="h-3.5 w-3.5" />
                  {eyedropperOn ? "Click the frame…" : "Eyedropper"}
                </button>
              </div>
              {eyedropperOn && activeScene.demoClipUrl && (
                <video
                  ref={previewVideoRef}
                  src={activeScene.demoClipUrl}
                  muted playsInline
                  onClick={handleEyedropperPick}
                  className="w-full max-h-44 object-contain rounded-xl border border-[#C9A84C]/40 cursor-crosshair"
                  data-testid="pro-chroma-eyedropper-video"
                />
              )}
              <SliderRow label="Tolerance" value={pt.chromaKey.similarity}
                onChange={(v) => patchProTools({ chromaKey: { ...pt.chromaKey, similarity: v } })} />
              <SliderRow label="Edge blend" value={pt.chromaKey.blend}
                onChange={(v) => patchProTools({ chromaKey: { ...pt.chromaKey, blend: v } })} />
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-white/60 w-24 shrink-0">Backdrop</span>
                <input
                  type="color" value={pt.chromaKey.bgColor}
                  onChange={(e) => patchProTools({ chromaKey: { ...pt.chromaKey, bgColor: e.target.value } })}
                  className="h-8 w-11 rounded cursor-pointer bg-transparent"
                  data-testid="pro-chroma-bg"
                />
                <span className="text-[11px] text-white/35">Color behind the keyed subject on export</span>
              </div>
            </div>
          </Collapsible>
        </div>
      </EditorCard>

      {/* ── 3. Speed & reverse ── */}
      <EditorCard
        title="Speed & Reverse"
        subtitle="One-tap motion presets"
        icon={<Gauge className="h-4 w-4" />}
        data-testid="pro-card-speed"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {SPEED_PRESETS.map((p) => (
              <Chip key={p.value} active={pt.speed === p.value}
                onClick={() => patchProTools({ speed: p.value })}>
                {p.label}
              </Chip>
            ))}
          </div>
          <Collapsible title={`Advanced — precise speed & reverse${pt.speed !== 1 || pt.reverse ? " ●" : ""}`}>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-white/60 w-24 shrink-0">Speed</span>
                <input
                  type="range" min={0.25} max={4} step={0.05} value={pt.speed}
                  onChange={(e) => patchProTools({ speed: Number(e.target.value) })}
                  className="flex-1 h-1 cursor-pointer" style={{ accentColor: "#C9A84C" }}
                  data-testid="pro-speed-slider"
                />
                <span className="text-[10px] font-mono text-white/40 w-12 text-right">{pt.speed.toFixed(2)}×</span>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-bold text-white/60 cursor-pointer">
                <input
                  type="checkbox" checked={pt.reverse}
                  onChange={(e) => patchProTools({ reverse: e.target.checked })}
                  className="h-4 w-4" style={{ accentColor: "#C9A84C" }}
                  data-testid="pro-reverse-toggle"
                />
                Reverse clip
                <span className="font-normal text-white/30">(applies on export)</span>
              </label>
            </div>
          </Collapsible>
        </div>
      </EditorCard>

      {/* ── 4. Rotate & flip ── */}
      <EditorCard
        title="Rotate & Flip"
        subtitle="One-tap geometry"
        icon={<RotateCw className="h-4 w-4" />}
        data-testid="pro-card-rotate"
      >
        <div className="flex flex-wrap gap-1.5">
          {([90, 180, 270] as const).map((deg) => (
            <Chip key={deg} active={pt.rotation === deg}
              onClick={() => patchProTools({ rotation: pt.rotation === deg ? 0 : deg })}>
              <RotateCw className="h-3 w-3 inline mr-1" />{deg}°
            </Chip>
          ))}
          <Chip active={pt.flipH} onClick={() => patchProTools({ flipH: !pt.flipH })}>
            <FlipHorizontal2 className="h-3 w-3 inline mr-1" />Flip H
          </Chip>
          <Chip active={pt.flipV} onClick={() => patchProTools({ flipV: !pt.flipV })}>
            <FlipVertical2 className="h-3 w-3 inline mr-1" />Flip V
          </Chip>
          {(pt.rotation !== 0 || pt.flipH || pt.flipV) && (
            <Chip active={false} onClick={() => patchProTools({ rotation: 0, flipH: false, flipV: false })}>
              ✕ Reset
            </Chip>
          )}
        </div>
      </EditorCard>

      {/* ── 5. Crop ── */}
      <EditorCard
        title="Crop"
        subtitle="Smart reframe for any platform"
        icon={<Scissors className="h-4 w-4" />}
        data-testid="pro-card-crop"
      >
        <div className="space-y-4">
          <div>
            <p className="text-[11px] font-black text-white/40 uppercase tracking-widest mb-2">
              ✨ Smart Reframe — one tap
            </p>
            <div className="flex flex-wrap gap-1.5">
              {CROP_ASPECTS.filter((a) => a.value !== "free").map((a) => (
                <Chip
                  key={a.value}
                  active={pt.crop.enabled && pt.crop.aspect === a.value}
                  onClick={() => patchProTools({
                    crop: { ...pt.crop, enabled: !(pt.crop.enabled && pt.crop.aspect === a.value), aspect: a.value },
                  })}
                >
                  {a.label}
                </Chip>
              ))}
              {pt.crop.enabled && (
                <Chip active={false} onClick={() => patchProTools({ crop: { ...pt.crop, enabled: false } })}>
                  ✕ No crop
                </Chip>
              )}
            </div>
          </div>
          <Collapsible title={`Advanced — free crop${pt.crop.enabled && pt.crop.aspect === "free" ? " ●" : ""}`}>
            <div className="space-y-1">
              <div className="flex flex-wrap gap-1.5 pb-2">
                <Chip active={pt.crop.aspect === "free"}
                  onClick={() => patchProTools({ crop: { ...pt.crop, enabled: true, aspect: "free" } })}>
                  Free crop
                </Chip>
              </div>
              {(["x", "y", "w", "h"] as const).map((k) => (
                <div key={k} className="flex items-center gap-2 py-0.5">
                  <span className="text-[11px] font-semibold text-white/60 w-24 shrink-0 capitalize">
                    {k === "x" ? "Left" : k === "y" ? "Top" : k === "w" ? "Width" : "Height"}
                  </span>
                  <input
                    type="range" min={0} max={100} value={Math.round(pt.crop[k] * 100)}
                    onChange={(e) => {
                      const v = Number(e.target.value) / 100;
                      const next = { ...pt.crop, [k]: v };
                      // Keep the rect inside the frame.
                      if (k === "x") next.w = Math.min(next.w, 1 - v);
                      if (k === "y") next.h = Math.min(next.h, 1 - v);
                      if (k === "w") next.w = Math.min(v, 1 - next.x);
                      if (k === "h") next.h = Math.min(v, 1 - next.y);
                      patchProTools({ crop: { ...next, enabled: true, aspect: "free" as CropAspect } });
                    }}
                    className="flex-1 h-1 cursor-pointer" style={{ accentColor: "#C9A84C" }}
                    data-testid={`pro-crop-${k}`}
                  />
                  <span className="text-[10px] font-mono text-white/40 w-10 text-right">
                    {Math.round(pt.crop[k] * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </Collapsible>
        </div>
      </EditorCard>
    </div>
  );
}
