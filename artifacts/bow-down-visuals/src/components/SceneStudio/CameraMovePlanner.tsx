import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Video, Loader2, ChevronDown, ChevronUp, Send,
  MoveRight, Orbit, ArrowUpFromLine, Hand, Aperture, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import type { SceneData } from "@/lib/scene-parser";

/* ─── Camera Move Planner ────────────────────────────────────────
   PURE PROMPT ENRICHMENT over the existing Scene Studio generation
   pipeline — no generation happens here, no new video model.
   Pick a camera move + intensity; the AI weaves the move into an
   image-to-video prompt which is PREVIEWED first. "Use in Scene Studio"
   injects the enriched prompt into the chosen scene's existing AI Video
   Prompt field (and records the move in its Camera Direction), so the
   existing InlineRunwayGenerator flow picks it up unchanged.

   Note: video-studio.tsx has a STATIC camera-move list that merely
   string-appends to a prompt. This panel adds the genuinely new gap:
   AI weaving of move + intensity with a pre-generation preview, docked
   into Scene Studio scenes.

   DOCKING: mount inside SceneStudio's main return, e.g. right after the
   section heading (next to CharacterDirector):
     <CameraMovePlanner scenes={scenes} onScenesChange={onScenesChange} /> */

const BUILD_CREDITS = 100;

type MoveId = "dolly-in" | "orbit" | "crane-up" | "handheld" | "static-wide";
type Intensity = "subtle" | "natural" | "dramatic";

const MOVES: { id: MoveId; icon: typeof MoveRight; blurb: string }[] = [
  { id: "dolly-in", icon: MoveRight, blurb: "Glide toward the subject" },
  { id: "orbit", icon: Orbit, blurb: "Circle around the subject" },
  { id: "crane-up", icon: ArrowUpFromLine, blurb: "Rise to an epic reveal" },
  { id: "handheld", icon: Hand, blurb: "Intimate, alive, imperfect" },
  { id: "static-wide", icon: Aperture, blurb: "Locked-off master shot" },
];

const INTENSITIES: Intensity[] = ["subtle", "natural", "dramatic"];

/** Base prompt for a scene: the same seed SceneStudio falls back to when
    no AI Video Prompt is set (action + location + camera + lighting + mood). */
function sceneBasePrompt(scene: SceneData): string {
  return (
    (scene.aiVideoPrompt ?? "").trim() ||
    [scene.action, scene.location, scene.cameraMovement, scene.lighting, scene.mood]
      .filter(Boolean)
      .join(", ") ||
    "cinematic music video scene, dramatic lighting, luxury aesthetic"
  );
}

function sceneLabel(scene: SceneData, index: number): string {
  const summary = scene.section || scene.lyricLine || scene.action || scene.location;
  return `Scene ${index + 1}${summary ? ` — ${summary.slice(0, 40)}` : ""}`;
}

interface CameraMovePlannerProps {
  scenes: SceneData[];
  onScenesChange: (scenes: SceneData[]) => void;
}

export function CameraMovePlanner({ scenes, onScenesChange }: CameraMovePlannerProps) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const ns = "wave9.cameraMovePlanner";

  const [expanded, setExpanded] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [move, setMove] = useState<MoveId>("dolly-in");
  const [intensity, setIntensity] = useState<Intensity>("natural");
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [used, setUsed] = useState(false);

  const target = scenes[Math.min(sceneIndex, Math.max(scenes.length - 1, 0))] ?? null;
  const moveLabel = t(`${ns}.moves.${move}`);

  async function handleBuild() {
    setError(null);
    if (!target) {
      setError(t(`${ns}.noScenes`));
      return;
    }
    setBuilding(true);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/wave9d/camera/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          move,
          intensity,
          basePrompt: sceneBasePrompt(target),
          sceneContext: [target.location, target.mood].filter(Boolean).join(" — "),
        }),
        overrideCost: BUILD_CREDITS,
        overrideFeature: "Camera Move Planner",
      });
      if (!res) return; /* user cancelled the credit confirm */
      const data = (await res.json()) as { enrichedPrompt?: string; error?: string };
      if (!res.ok || !data.enrichedPrompt) throw new Error(data.error ?? "Build failed");
      setPreview(data.enrichedPrompt);
      setUsed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t(`${ns}.errorGeneric`));
    } finally {
      setBuilding(false);
    }
  }

  function handleUseInStudio() {
    if (!target || !preview) return;
    const next = scenes.map((s, i) =>
      i === Math.min(sceneIndex, Math.max(scenes.length - 1, 0))
        ? {
            ...s,
            aiVideoPrompt: preview,
            cameraMovement: `${moveLabel} — ${t(`${ns}.intensity.${intensity}`)}`,
          }
        : s,
    );
    onScenesChange(next);
    setUsed(true);
    toast({
      title: t(`${ns}.usedTitle`),
      description: t(`${ns}.usedDetail`, { scene: sceneIndex + 1 }),
    });
  }

  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.025] overflow-hidden"
      data-testid="camera-move-planner"
    >
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Video className="h-4.5 w-4.5 text-primary" style={{ width: "1.125rem", height: "1.125rem" }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-white uppercase tracking-wider">
            {t(`${ns}.title`)}
          </h3>
          <p className="text-xs text-white/30 mt-0.5 truncate">{t(`${ns}.subtitle`)}</p>
        </div>
        <span className="text-[10px] font-black text-primary/80 uppercase tracking-widest border border-primary/30 bg-primary/10 rounded-full px-2.5 py-1 shrink-0">
          {t(`${ns}.buildCost`, { cost: BUILD_CREDITS })}
        </span>
        {expanded ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}
      </button>

      {expanded && (
        <div className="px-5 py-4 space-y-5 border-t border-white/[0.06]">
          {/* ── Scene picker ── */}
          <div>
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1.5">
              {t(`${ns}.sceneLabel`)}
            </p>
            {scenes.length === 0 ? (
              <p className="text-xs text-white/40">{t(`${ns}.noScenes`)}</p>
            ) : (
              <div className="relative">
                <select
                  value={Math.min(sceneIndex, scenes.length - 1)}
                  onChange={(e) => { setSceneIndex(Number(e.target.value)); setPreview(null); setUsed(false); }}
                  className="h-10 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 pr-8 text-sm focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
                  data-testid="camera-scene-select"
                >
                  {scenes.map((s, i) => (
                    <option key={s.id} value={i} className="bg-zinc-900">
                      {sceneLabel(s, i)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="h-4 w-4 text-white/40 absolute right-3 top-3 pointer-events-none" />
              </div>
            )}
          </div>

          {/* ── Move presets ── */}
          <div>
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1.5">
              {t(`${ns}.moveLabel`)}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid="camera-move-grid">
              {MOVES.map((m) => {
                const Icon = m.icon;
                const selected = move === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => { setMove(m.id); setPreview(null); setUsed(false); }}
                    data-testid={`move-pick-${m.id}`}
                    className={`rounded-xl border px-2.5 py-3 text-left transition-all ${
                      selected
                        ? "border-primary/60 bg-primary/10"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/25"
                    }`}
                  >
                    <Icon className={`h-4.5 w-4.5 mb-1.5 ${selected ? "text-primary" : "text-white/50"}`} style={{ width: "1.125rem", height: "1.125rem" }} />
                    <p className={`text-[11px] font-black uppercase tracking-wide ${selected ? "text-primary" : "text-white/70"}`}>
                      {t(`${ns}.moves.${m.id}`)}
                    </p>
                    <p className="text-[10px] text-white/30 mt-0.5 leading-snug">
                      {t(`${ns}.moveBlurbs.${m.id}`)}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Intensity ── */}
          <div>
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1.5">
              {t(`${ns}.intensityLabel`)}
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {INTENSITIES.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => { setIntensity(lvl); setPreview(null); setUsed(false); }}
                  data-testid={`intensity-pick-${lvl}`}
                  className={`text-[11px] font-bold px-3 py-1.5 rounded-full border transition-colors capitalize ${
                    intensity === lvl
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-white/10 bg-white/5 text-white/40 hover:text-white/70"
                  }`}
                >
                  {t(`${ns}.intensity.${lvl}`)}
                </button>
              ))}
            </div>
          </div>

          {/* ── Errors ── */}
          {error && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl border border-red-500/30 bg-red-500/5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* ── Build ── */}
          <Button
            size="sm"
            onClick={handleBuild}
            disabled={building || scenes.length === 0}
            className="bg-primary text-black hover:bg-primary/90 font-bold text-xs h-9 gap-1.5"
            data-testid="btn-build-camera-prompt"
          >
            {building
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t(`${ns}.building`)}</>
              : <><Video className="h-3.5 w-3.5" /> {t(`${ns}.buildButton`, { cost: BUILD_CREDITS })}</>}
          </Button>

          {/* ── Preview (BEFORE any generation) ── */}
          {preview && (
            <div className="space-y-2.5">
              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                {t(`${ns}.previewHeading`)}
              </p>
              <pre
                className="text-[11px] text-white/60 leading-relaxed whitespace-pre-wrap bg-white/[0.025] border border-primary/20 rounded-xl px-3.5 py-3 font-mono max-h-48 overflow-y-auto"
                data-testid="camera-prompt-preview"
              >
                {preview}
              </pre>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={handleUseInStudio}
                  className="bg-primary text-black hover:bg-primary/90 font-bold text-xs h-9 gap-1.5"
                  data-testid="btn-use-camera-prompt"
                >
                  <Send className="h-3.5 w-3.5" /> {t(`${ns}.useButton`)}
                </Button>
                <Button
                  size="sm" variant="outline"
                  onClick={handleBuild}
                  disabled={building}
                  className="h-9 text-xs gap-1.5 border-white/10 bg-white/5 text-white/70 hover:text-white"
                >
                  {t(`${ns}.regenerate`)}
                </Button>
                {used && (
                  <span className="text-[11px] font-bold text-green-400">
                    {t(`${ns}.usedConfirm`)}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-white/30">{t(`${ns}.previewHint`)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
