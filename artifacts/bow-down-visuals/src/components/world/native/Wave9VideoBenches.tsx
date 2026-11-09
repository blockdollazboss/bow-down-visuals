/**
 * Wave9VideoBenches — the Wave9 editor/director family's
 * native benches at the Video Desk (Stack 400 world parity,
 * census B-18): Beat-Sync Cuts, Timeline Edit Recipes,
 * Background Replace (the delivery charge), Voice-Directed
 * Edits, the Director's Camera Deck, and the Character
 * Director, stacked under the desk they belong to.
 *
 * Each bench is its section's own flow on its own rail (lib/
 * world/wave9-benches.ts): the charged post rides the
 * registry-priced spend confirmation, a declined
 * confirmation runs nothing, and text results land in the
 * hub project as script assets. The editor-canvas halves of
 * the twins (applying ops to a timeline, compositing video
 * on-device) belong to the 2D editor and do not exist in
 * the World — the benches run the rails themselves: the
 * markers, the plan, the charge, the prompt. Copy rides the
 * sections' own catalog namespaces (wave9.*); the few
 * bench-only lines live in worldWave9Bench.*.
 */
import { useEffect, useState } from "react";
import {
  Activity, CheckCircle2, Clapperboard, Image, Mic, Trash2, User, Video, Wand2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@/lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { useDeskAuthHeaders, DeskSelectField, DeskTextField, deskInputCls } from "./CreateDeskLeaf";
import { NativeEmptyState, NativeLoadingState } from "./NativeStates";
import { BenchNotices, BenchRunButton, BenchShell } from "./Wave9SongBenches";
import {
  WAVE9_BG_PRESET_KEYS,
  WAVE9_CAMERA_FALLBACK_MOVES,
  WAVE9_CAMERA_INTENSITIES,
  WAVE9_RECIPE_DESC_KEYS,
  WAVE9_RECIPE_IDS,
  WAVE9_RECIPE_NAME_KEYS,
  WAVE9_RECIPE_NEEDS_AUDIO,
  buildWave9BeatsPayload,
  buildWave9BgChargePayload,
  buildWave9CameraPayload,
  buildWave9DirectPayload,
  buildWave9DirectorPayload,
  buildWave9TemplatesPayload,
  wave9BeatsCost,
  wave9BeatsOf,
  wave9BgChargeCost,
  wave9BgChargeOf,
  wave9CameraCost,
  wave9CameraDeckOf,
  wave9CameraPromptOf,
  wave9CameraStackConflict,
  wave9DirectCost,
  wave9DirectPlanOf,
  wave9DirectorCost,
  wave9DirectorResultOf,
  wave9FormatClock,
  wave9OpsOf,
  wave9TemplatesCost,
  type Wave9BeatsResult,
  type Wave9CameraDeck,
  type Wave9CameraIntensity,
  type Wave9CameraPreset,
  type Wave9DirectOp,
  type Wave9DirectPlan,
  type Wave9DirectorResult,
  type Wave9EditOp,
  type Wave9RecipeId,
} from "@/lib/world/wave9-benches";

/* ─── Beat-Sync Cuts ───────────────────────────────────────── */

export function Wave9BeatsBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const ns = "wave9.beatSync";

  const [audioUrl, setAudioUrl] = useState("");
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [result, setResult] = useState<Wave9BeatsResult | null>(null);
  const [kept, setKept] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = wave9BeatsCost();
  const busy = phase === "working";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const keptTimes = result ? result.beats.filter((_, i) => kept[i]) : [];

  async function detect() {
    if (busy || !audioUrl.trim()) return;
    setPhase("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/wave9b/beats/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        body: JSON.stringify(buildWave9BeatsPayload(audioUrl.trim())),
      });
      if (!res) { setPhase("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("idle");
        return;
      }
      const beats = wave9BeatsOf(data);
      if (!res.ok || !beats) {
        setPhase("idle");
        setError(apiErrorMessage(data, t(`${ns}.errorGeneric`)));
        return;
      }
      setResult(beats);
      setKept(beats.beats.map(() => true));
      setPhase("done");
      try {
        addAsset({
          kind: "script",
          url: "",
          label: "Beat markers",
          detail: beats.beats.map((b) => b.toFixed(2)).join(", "),
        });
      } catch { /* non-fatal */ }
    } catch {
      setPhase("idle");
      setError(t(`${ns}.errorGeneric`));
    }
  }

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave9-beats-bench"
      icon={<Activity className="h-4 w-4" />}
      title={t(`${ns}.title`)}
      cost={cost}
      subtitle={t(`${ns}.subtitle`, { cost })}
    >
      <p className={`text-xs ${muted}`}>{t(`${ns}.intro`)}</p>
      <DeskTextField
        isLight={isLight}
        label={t("worldWave9Bench.audioUrlLabel")}
        value={audioUrl}
        onChange={setAudioUrl}
        placeholder={t("worldWave9Bench.audioUrlPlaceholder")}
      />
      {!audioUrl.trim() && <NativeEmptyState isLight={isLight} message={t(`${ns}.noAudio`)} />}
      <BenchRunButton
        testId="world-wave9-beats-run"
        busy={busy}
        busyLabel={t(`${ns}.detecting`)}
        label={t(`${ns}.detect`, { cost })}
        disabled={!audioUrl.trim()}
        onClick={() => void detect()}
      />
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Beat-Sync Cuts" error={error} />
      {busy && <NativeLoadingState isLight={isLight} message={t(`${ns}.detectingNote`)} />}
      {phase === "done" && result && (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-wave9-beats-result">
          <p className={`flex items-center gap-2 text-sm font-semibold ${strong}`}>
            <CheckCircle2 className="h-4 w-4 text-green-500" /> {t(`${ns}.detectedTitle`)}
          </p>
          <p className={`mt-1 text-xs ${muted}`}>
            {t(`${ns}.markers`, { n: result.beats.length })}
            {result.bpm !== null ? ` · ~${result.bpm} BPM` : ""}
            {result.method ? ` · ${result.method}` : ""}
          </p>
          <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {result.beats.map((b, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setKept((prev) => prev.map((k, j) => (j === i ? !k : k)))}
                aria-pressed={!!kept[i]}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-bold bdv-touch-target ${
                  kept[i]
                    ? isLight
                      ? "border-[#C9A84C] bg-[#F7ECD2] text-[#2a1e07]"
                      : "border-amber-400 bg-amber-400/[0.16] text-amber-200"
                    : isLight
                      ? "border-[#C9A84C]/30 text-[#6B5B36] line-through"
                      : "border-white/10 text-white/40 line-through"
                }`}
              >
                {wave9FormatClock(b)}
              </button>
            ))}
          </div>
          <p className={`mt-2 text-[11px] ${muted}`}>
            {t("worldWave9Bench.beatsKept", { n: keptTimes.length })} {t(`${ns}.planNote`)}
          </p>
          {result.creditsRemaining !== null && (
            <p className={`mt-1 text-[11px] ${muted}`}>{t("worldWave9Bench.creditsRemaining", { n: result.creditsRemaining })}</p>
          )}
        </div>
      )}
    </BenchShell>
  );
}

/* ─── Timeline Edit Recipes ────────────────────────────────── */

export function Wave9TemplatesBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const ns = "wave9.templates";

  const [audioUrl, setAudioUrl] = useState("");
  const [duration, setDuration] = useState("");
  const [beatGridText, setBeatGridText] = useState("");
  const [compiling, setCompiling] = useState<Wave9RecipeId | null>(null);
  const [recipeId, setRecipeId] = useState<Wave9RecipeId | null>(null);
  const [ops, setOps] = useState<Wave9EditOp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = wave9TemplatesCost();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const chipCls = (active: boolean) =>
    `rounded-xl border px-3 py-2 text-left text-xs transition bdv-touch-target ${
      active
        ? isLight
          ? "border-[#C9A84C] bg-[#F7ECD2] text-[#2a1e07]"
          : "border-amber-400 bg-amber-400/[0.16] text-amber-200"
        : isLight
          ? "border-[#C9A84C]/30 text-[#6B5B36] hover:border-[#C9A84C]/60"
          : "border-white/10 text-white/60 hover:border-white/30"
    }`;

  async function compile(id: Wave9RecipeId) {
    if (compiling) return;
    setError(null);
    setOutOfCredits(false);
    if (WAVE9_RECIPE_NEEDS_AUDIO[id] && !audioUrl.trim()) {
      setError(t(`${ns}.errorNoAudio`));
      return;
    }
    setCompiling(id);
    try {
      const beatGrid = beatGridText
        .split(/[\s,]+/)
        .map((s) => parseFloat(s))
        .filter((n) => isFinite(n) && n >= 0);
      const res = await confirmedFetch("/api/wave9b/templates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        body: JSON.stringify(
          buildWave9TemplatesPayload({
            recipeId: id,
            mediaUrl: audioUrl.trim() || null,
            durationSec: parseFloat(duration) || 0,
            beatGrid,
          }),
        ),
      });
      if (!res) { setCompiling(null); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setCompiling(null);
        return;
      }
      const compiled = wave9OpsOf(data);
      if (!res.ok || !compiled) {
        setCompiling(null);
        setError(apiErrorMessage(data, t(`${ns}.errorGeneric`)));
        return;
      }
      setRecipeId(id);
      setOps(compiled);
      try {
        addAsset({
          kind: "script",
          url: "",
          label: `Edit recipe — ${t(`${ns}.${WAVE9_RECIPE_NAME_KEYS[id]}`)}`,
          detail: compiled.map((o) => o.label).join("\n"),
        });
      } catch { /* non-fatal */ }
    } catch {
      setError(t(`${ns}.errorGeneric`));
    } finally {
      setCompiling(null);
    }
  }

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave9-templates-bench"
      icon={<Wand2 className="h-4 w-4" />}
      title={t(`${ns}.title`)}
      cost={cost}
      subtitle={t(`${ns}.subtitle`, { cost })}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <DeskTextField
          isLight={isLight}
          label={t("worldWave9Bench.audioUrlLabel")}
          value={audioUrl}
          onChange={setAudioUrl}
          placeholder={t("worldWave9Bench.audioUrlPlaceholder")}
        />
        <DeskTextField
          isLight={isLight}
          label={t("worldWave9Bench.durationLabel")}
          value={duration}
          onChange={setDuration}
          placeholder="0"
        />
      </div>
      <DeskTextField
        isLight={isLight}
        label={t("worldWave9Bench.beatGridLabel")}
        value={beatGridText}
        onChange={setBeatGridText}
        placeholder={t("worldWave9Bench.beatGridPlaceholder")}
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {WAVE9_RECIPE_IDS.map((id) => (
          <button key={id} type="button" data-testid={`world-wave9-templates-run-${id}`} onClick={() => void compile(id)} className={chipCls(recipeId === id)} disabled={!!compiling}>
            <span className="block text-xs font-bold">{t(`${ns}.${WAVE9_RECIPE_NAME_KEYS[id]}`)}</span>
            <span className={`mt-0.5 block text-[11px] ${muted}`}>{t(`${ns}.${WAVE9_RECIPE_DESC_KEYS[id]}`)}</span>
            <span className={`mt-1 block text-[11px] font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {compiling === id ? t(`${ns}.compiling`) : `${cost} VB`}
            </span>
          </button>
        ))}
      </div>
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Timeline Edit Recipes" error={error} />
      {ops.length > 0 && recipeId && (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-wave9-templates-result">
          <p className={`flex items-center gap-2 text-sm font-semibold ${strong}`}>
            <CheckCircle2 className="h-4 w-4 text-green-500" />{" "}
            {ops.length === 1
              ? t(`${ns}.previewHeadingOne`)
              : t(`${ns}.previewHeading`, { name: t(`${ns}.${WAVE9_RECIPE_NAME_KEYS[recipeId]}`), n: ops.length })}
          </p>
          <div className="mt-2 space-y-1">
            {ops.map((o, i) => (
              <p key={i} className={`text-xs ${muted}`}>
                · {o.label}
                {o.reversible ? ` (${t(`${ns}.undoable`)})` : ""}
              </p>
            ))}
          </div>
          <p className={`mt-2 text-[11px] ${muted}`}>{t(`${ns}.planNote`)}</p>
        </div>
      )}
    </BenchShell>
  );
}

/* ─── Background Replace — the delivery charge ─────────────── */

export function Wave9BgChargeBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const ns = "wave9.bgReplace";

  const [presetKey, setPresetKey] = useState<(typeof WAVE9_BG_PRESET_KEYS)[number]>("presetStudio");
  const [sceneId, setSceneId] = useState("");
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  const cost = wave9BgChargeCost();
  const busy = phase === "working";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";

  async function collect() {
    if (busy) return;
    setPhase("working");
    setError(null);
    setOutOfCredits(false);
    setCancelled(false);
    try {
      const res = await confirmedFetch("/api/wave9b/bg/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        body: JSON.stringify(buildWave9BgChargePayload(sceneId.trim())),
      });
      if (!res) {
        // The twin's cancel semantics: discard, no charge.
        setPhase("idle");
        setCancelled(true);
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("idle");
        setError(t(`${ns}.topUpToKeep`));
        return;
      }
      const charged = wave9BgChargeOf(data);
      if (!res.ok || !charged) {
        setPhase("idle");
        setError(apiErrorMessage(data, t(`${ns}.errorGeneric`)));
        return;
      }
      setRemaining(charged.remaining);
      setPhase("done");
    } catch {
      setPhase("idle");
      setError(t(`${ns}.errorGeneric`));
    }
  }

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave9-bg-bench"
      icon={<Image className="h-4 w-4" />}
      title={t(`${ns}.title`)}
      cost={cost}
      subtitle={t(`${ns}.subtitle`, { cost })}
    >
      <p className={`text-xs ${muted}`}>{t("worldWave9Bench.bgDeskNote")}</p>
      <DeskSelectField
        isLight={isLight}
        label={t(`${ns}.presetLabel`)}
        value={presetKey}
        onChange={(v) => setPresetKey(v as (typeof WAVE9_BG_PRESET_KEYS)[number])}
        options={WAVE9_BG_PRESET_KEYS.map((k) => ({ value: k, label: t(`${ns}.${k}`) }))}
      />
      <p className={`text-xs ${muted}`}>{t(`${ns}.${presetKey}Desc`)}</p>
      <DeskTextField
        isLight={isLight}
        label={t("worldWave9Bench.sceneIdLabel")}
        value={sceneId}
        onChange={setSceneId}
        placeholder={t("worldWave9Bench.sceneIdPlaceholder")}
      />
      <BenchRunButton
        testId="world-wave9-bg-run"
        busy={busy}
        busyLabel={t(`${ns}.confirming`)}
        label={t(`${ns}.replace`, { cost })}
        onClick={() => void collect()}
      />
      {cancelled && <p className={`text-xs font-semibold ${muted}`}>{t(`${ns}.cancelled`)}</p>}
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Background Replace" error={error} />
      {phase === "done" && (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-wave9-bg-result">
          <p className={`flex items-center gap-2 text-sm font-semibold ${strong}`}>
            <CheckCircle2 className="h-4 w-4 text-green-500" /> {t(`${ns}.replacedTitle`)}
          </p>
          <p className={`mt-1 text-xs ${muted}`}>{t(`${ns}.doneToast`, { preset: t(`${ns}.${presetKey}`) })}</p>
          {remaining !== null && (
            <p className={`mt-1 text-[11px] ${muted}`}>{t("worldWave9Bench.creditsRemaining", { n: remaining })}</p>
          )}
        </div>
      )}
    </BenchShell>
  );
}

/* ─── Voice-Directed Edits ─────────────────────────────────── */

interface BenchClipRow {
  key: number;
  id: string;
  section: string;
  durationSec: string;
  volume: string;
}

let benchClipKey = 0;
function newBenchClip(): BenchClipRow {
  benchClipKey += 1;
  return { key: benchClipKey, id: `clip-${benchClipKey}`, section: "", durationSec: "10", volume: "100" };
}

function directOpLabel(op: Wave9DirectOp, clipLabel: (id: string) => string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const ns = "wave9.directEdit.opLabel";
  switch (op.op) {
    case "split":
      return t(`${ns}.split`, { clip: clipLabel(op.sceneId), time: wave9FormatClock(op.atSec) });
    case "trim": {
      const bits: string[] = [];
      if (op.trimStart > 0) bits.push(t(`${ns}.trimStart`, { s: op.trimStart }));
      if (op.trimEnd > 0) bits.push(t(`${ns}.trimEnd`, { s: op.trimEnd }));
      return t(`${ns}.trim`, {
        clip: clipLabel(op.sceneId),
        bits: bits.join(t(`${ns}.trimJoin`)) || t(`${ns}.trimNone`),
      });
    }
    case "delete-range":
      return t(`${ns}.deleteRange`, { from: wave9FormatClock(op.startSec), to: wave9FormatClock(op.endSec) });
    case "add-marker":
      return t(`${ns}.addMarker`, { title: op.title, time: wave9FormatClock(op.atSec) });
    case "move-clip":
      return t(`${ns}.moveClip`, { clip: clipLabel(op.sceneId), n: op.toIndex + 1 });
    case "set-volume":
      return t(`${ns}.setVolume`, { clip: clipLabel(op.sceneId), volume: op.volume });
  }
}

export function Wave9DirectBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const ns = "wave9.directEdit";

  const [command, setCommand] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [clips, setClips] = useState<BenchClipRow[]>(() => [newBenchClip(), newBenchClip()]);
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [plan, setPlan] = useState<Wave9DirectPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = wave9DirectCost();
  const busy = phase === "working";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const clipLabel = (id: string): string => {
    const idx = clips.findIndex((c) => c.id === id);
    return idx >= 0 ? t(`${ns}.clipLabel`, { n: idx + 1 }) : t(`${ns}.clipFallback`);
  };

  async function direct() {
    if (busy || !command.trim()) return;
    if (clips.length === 0) {
      setError(t(`${ns}.noScenes`));
      return;
    }
    setPhase("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/wave9c/direct/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        overrideFeature: "Voice-Directed Edits",
        body: JSON.stringify(
          buildWave9DirectPayload({
            command,
            clips: clips.map((c) => ({
              id: c.id,
              section: c.section,
              durationSec: parseFloat(c.durationSec) || 0,
              volume: Math.round(parseFloat(c.volume) || 100),
            })),
            projectTitle,
          }),
        ),
      });
      if (!res) { setPhase("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402 || (data as { error?: string } | null)?.error === "out_of_credits") {
        setOutOfCredits(true);
        setPhase("idle");
        if (res.status === 402) setError(t(`${ns}.outOfCredits`));
        return;
      }
      const planned = wave9DirectPlanOf(data);
      if (!res.ok || !planned) {
        setPhase("idle");
        setError(apiErrorMessage(data, t(`${ns}.errorGeneric`)));
        return;
      }
      setPlan(planned);
      setPhase("done");
      try {
        addAsset({
          kind: "script",
          url: "",
          label: `Edit plan — ${command.trim().slice(0, 60)}`,
          detail: planned.ops.map((o) => directOpLabel(o, clipLabel, t)).join("\n"),
        });
      } catch { /* non-fatal */ }
    } catch {
      setPhase("idle");
      setError(t(`${ns}.errorGeneric`));
    }
  }

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave9-direct-bench"
      icon={<Mic className="h-4 w-4" />}
      title={t(`${ns}.title`)}
      cost={cost}
      subtitle={t(`${ns}.subtitle`)}
    >
      <p className={`text-xs ${muted}`}>{t(`${ns}.intro`)}</p>
      <label className="block">
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t(`${ns}.direct`)}
        </span>
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={t(`${ns}.placeholder`)}
          rows={2}
          className={deskInputCls(isLight)}
        />
      </label>
      <DeskTextField
        isLight={isLight}
        label={t("worldWave9Bench.projectTitleLabel")}
        value={projectTitle}
        onChange={setProjectTitle}
      />
      <div className="space-y-2">
        <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("worldWave9Bench.timelineLabel")}
        </p>
        {clips.map((c, i) => (
          <div key={c.key} className={`flex items-end gap-2 rounded-xl border p-2 ${cardCls}`}>
            <span className={`pb-2 text-xs font-bold ${strong}`}>{t(`${ns}.clipLabel`, { n: i + 1 })}</span>
            <div className="min-w-0 flex-1">
              <DeskTextField
                isLight={isLight}
                label={t("worldWave9Bench.clipSectionLabel")}
                value={c.section}
                onChange={(v) => setClips((prev) => prev.map((p, j) => (j === i ? { ...p, section: v } : p)))}
              />
            </div>
            <div className="w-20">
              <DeskTextField
                isLight={isLight}
                label={t("worldWave9Bench.durationLabel")}
                value={c.durationSec}
                onChange={(v) => setClips((prev) => prev.map((p, j) => (j === i ? { ...p, durationSec: v } : p)))}
              />
            </div>
            <div className="w-20">
              <DeskTextField
                isLight={isLight}
                label={t("worldWave9Bench.volumeLabel")}
                value={c.volume}
                onChange={(v) => setClips((prev) => prev.map((p, j) => (j === i ? { ...p, volume: v } : p)))}
              />
            </div>
            <button
              type="button"
              aria-label={t("worldWave9Bench.removeClip")}
              onClick={() => setClips((prev) => prev.filter((_, j) => j !== i))}
              className={`pb-2 ${isLight ? "text-[#92600a]" : "text-white/50"} bdv-touch-target`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setClips((prev) => [...prev, newBenchClip()])}
          className={`rounded-full border px-3 py-1.5 text-xs font-bold bdv-touch-target ${
            isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 text-[#e8c86a]"
          }`}
        >
          {t("worldWave9Bench.addClip")}
        </button>
      </div>
      {clips.length === 0 && <NativeEmptyState isLight={isLight} message={t(`${ns}.noScenes`)} />}
      <BenchRunButton
        testId="world-wave9-direct-run"
        busy={busy}
        busyLabel={t(`${ns}.planning`)}
        label={`${t(`${ns}.direct`)} · ${cost} VB`}
        disabled={!command.trim() || clips.length === 0}
        onClick={() => void direct()}
      />
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Voice-Directed Edits" error={error} />
      {busy && <NativeLoadingState isLight={isLight} message={t(`${ns}.planning`)} />}
      {phase === "done" && plan && (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-wave9-direct-result">
          <p className={`flex items-center gap-2 text-sm font-semibold ${strong}`}>
            <CheckCircle2 className="h-4 w-4 text-green-500" /> {t(`${ns}.reviewTitle`)}
          </p>
          <p className={`mt-1 text-xs ${muted}`}>{plan.planSummary}</p>
          <div className="mt-2 space-y-1">
            {plan.ops.map((o, i) => (
              <p key={i} className={`text-xs ${muted}`}>
                · {directOpLabel(o, clipLabel, t)}
                {o.reason ? ` — ${o.reason}` : ""}
              </p>
            ))}
          </div>
        </div>
      )}
    </BenchShell>
  );
}

/* ─── Director's Camera Deck ───────────────────────────────── */

export function Wave9CameraBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const authHeaders = useDeskAuthHeaders();
  const ns = "wave9.cameraMovePlanner";

  const [deck, setDeck] = useState<Wave9CameraDeck | null>(null);
  const [deckFailed, setDeckFailed] = useState(false);
  const [stack, setStack] = useState<Array<{ preset: string; intensity: Wave9CameraIntensity | null }>>([]);
  const [intensity, setIntensity] = useState<Wave9CameraIntensity>("natural");
  const [basePrompt, setBasePrompt] = useState("");
  const [sceneContext, setSceneContext] = useState("");
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = wave9CameraCost();
  const busy = phase === "working";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";

  /* The free deck read — plain fetch on purpose: it charges
     nothing, so it never rides the credit-confirm rail. */
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/wave9d/camera/presets", { headers: await authHeaders() });
        const data: unknown = await res.json().catch(() => null);
        const parsed = res.ok ? wave9CameraDeckOf(data) : null;
        if (!live) return;
        if (parsed) setDeck(parsed);
        else setDeckFailed(true);
      } catch {
        if (live) setDeckFailed(true);
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const presets: Wave9CameraPreset[] = deck
    ? deck.presets
    : WAVE9_CAMERA_FALLBACK_MOVES.map((id) => ({
        id,
        name: t(`${ns}.moves.${id}`),
        category: "",
        blurb: t(`${ns}.moveBlurbs.${id}`),
        locked: false,
        conflictsWith: [],
      }));
  const maxStack = deck?.maxStack ?? 3;
  const presetName = (id: string) => presets.find((p) => p.id === id)?.name ?? id;

  function toggleMove(id: string) {
    setError(null);
    setStack((prev) => {
      if (prev.some((s) => s.preset === id)) return prev.filter((s) => s.preset !== id);
      if (prev.length >= maxStack) return prev;
      return [...prev, { preset: id, intensity: null }];
    });
  }

  function cycleIntensity(preset: string) {
    setStack((prev) =>
      prev.map((s) => {
        if (s.preset !== preset) return s;
        const next: Wave9CameraIntensity | null =
          s.intensity === null ? "subtle" : s.intensity === "subtle" ? "natural" : s.intensity === "natural" ? "dramatic" : null;
        return { ...s, intensity: next };
      }),
    );
  }

  async function build() {
    if (busy) return;
    if (stack.length === 0) {
      setError(t(`${ns}.noMove`));
      return;
    }
    const conflict = wave9CameraStackConflict(stack, presets);
    if (conflict) {
      setError(conflict.locked ? t(`${ns}.conflictLocked`, { a: conflict.a }) : t(`${ns}.conflictOpposite`, { a: conflict.a, b: conflict.b }));
      return;
    }
    setPhase("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/wave9d/camera/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        overrideFeature: "Camera Move Planner",
        body: JSON.stringify(buildWave9CameraPayload({ stack, intensity, basePrompt, sceneContext })),
      });
      if (!res) { setPhase("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("idle");
        return;
      }
      const prompt = wave9CameraPromptOf(data);
      if (!res.ok || !prompt) {
        setPhase("idle");
        setError(apiErrorMessage(data, t(`${ns}.errorGeneric`)));
        return;
      }
      setPreview(prompt);
      setPhase("done");
      try {
        addAsset({
          kind: "script",
          url: "",
          label: "Camera prompt",
          detail: prompt,
        });
      } catch { /* non-fatal */ }
    } catch {
      setPhase("idle");
      setError(t(`${ns}.errorGeneric`));
    }
  }

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave9-camera-bench"
      icon={<Video className="h-4 w-4" />}
      title={t(`${ns}.title`)}
      cost={cost}
      subtitle={t(`${ns}.subtitle`)}
    >
      {!deck && !deckFailed && <NativeLoadingState isLight={isLight} message={t(`${ns}.deckLoading`)} />}
      {deckFailed && <p className={`text-xs ${muted}`}>{t(`${ns}.deckFallback`)}</p>}
      <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {t(`${ns}.deckLabel`)}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const active = stack.some((s) => s.preset === p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggleMove(p.id)}
              title={p.blurb}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold bdv-touch-target ${
                active
                  ? isLight
                    ? "border-[#C9A84C] bg-[#F7ECD2] text-[#2a1e07]"
                    : "border-amber-400 bg-amber-400/[0.16] text-amber-200"
                  : isLight
                    ? "border-[#C9A84C]/30 text-[#6B5B36] hover:border-[#C9A84C]/60"
                    : "border-white/10 text-white/60 hover:border-white/30"
              }`}
            >
              {p.name}
            </button>
          );
        })}
      </div>
      <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {t(`${ns}.stackLabel`)}
      </p>
      {stack.length === 0 ? (
        <NativeEmptyState isLight={isLight} message={t(`${ns}.stackEmpty`)} />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {stack.map((s, i) => (
            <span key={s.preset} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${cardCls}`}>
              {i + 1}. {presetName(s.preset)}
              <button
                type="button"
                title={t(`${ns}.slotIntensityTitle`)}
                onClick={() => cycleIntensity(s.preset)}
                className={`rounded-full px-1.5 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"} bdv-touch-target`}
              >
                {s.intensity ? t(`${ns}.intensity.${s.intensity}`) : "—"}
              </button>
              <button
                type="button"
                aria-label={t("worldBenches300.removeLabel")}
                onClick={() => toggleMove(s.preset)}
                className="bdv-touch-target"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <p className={`text-[11px] ${muted}`}>{t(`${ns}.stackRule`)}</p>
      <DeskSelectField
        isLight={isLight}
        label={t(`${ns}.intensityLabel`)}
        value={intensity}
        onChange={(v) => setIntensity(v as Wave9CameraIntensity)}
        options={WAVE9_CAMERA_INTENSITIES.map((i) => ({ value: i, label: t(`${ns}.intensity.${i}`) }))}
      />
      <label className="block">
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("worldWave9Bench.basePromptLabel")}
        </span>
        <textarea
          value={basePrompt}
          onChange={(e) => setBasePrompt(e.target.value)}
          placeholder={t("worldWave9Bench.basePromptPlaceholder")}
          rows={2}
          className={deskInputCls(isLight)}
        />
      </label>
      <DeskTextField
        isLight={isLight}
        label={t("worldWave9Bench.sceneContextLabel")}
        value={sceneContext}
        onChange={setSceneContext}
        placeholder={t("worldWave9Bench.sceneContextPlaceholder")}
      />
      <BenchRunButton
        testId="world-wave9-camera-run"
        busy={busy}
        busyLabel={t(`${ns}.building`)}
        label={t(`${ns}.buildButton`, { cost })}
        disabled={stack.length === 0}
        onClick={() => void build()}
      />
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Camera Move Planner" error={error} />
      {phase === "done" && preview && (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-wave9-camera-result">
          <p className={`flex items-center gap-2 text-sm font-semibold ${strong}`}>
            <CheckCircle2 className="h-4 w-4 text-green-500" /> {t(`${ns}.previewHeading`)}
          </p>
          <p className={`mt-2 whitespace-pre-wrap text-xs ${muted}`}>{preview}</p>
          <p className={`mt-2 text-[11px] ${muted}`}>{t(`${ns}.previewHint`)}</p>
        </div>
      )}
    </BenchShell>
  );
}

/* ─── Character Director ───────────────────────────────────── */

interface BenchCastRow {
  key: number;
  name: string;
  description: string;
}
interface BenchShotRow {
  key: number;
  charactersText: string;
  action: string;
  cameraNote: string;
}

let benchDirectorKey = 0;
function nextDirectorKey(): number {
  benchDirectorKey += 1;
  return benchDirectorKey;
}

export function Wave9DirectorBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const ns = "wave9.characterDirector";

  const [cast, setCast] = useState<BenchCastRow[]>(() => [
    { key: nextDirectorKey(), name: "", description: "" },
    { key: nextDirectorKey(), name: "", description: "" },
  ]);
  const [shots, setShots] = useState<BenchShotRow[]>(() => [
    { key: nextDirectorKey(), charactersText: "", action: "", cameraNote: "" },
  ]);
  const [planName, setPlanName] = useState("");
  const [sceneStyle, setSceneStyle] = useState("");
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [result, setResult] = useState<Wave9DirectorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = wave9DirectorCost();
  const busy = phase === "working";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const namedCast = cast.filter((c) => c.name.trim().length > 0);

  async function plan() {
    if (busy) return;
    if (namedCast.length < 2) {
      setError(t(`${ns}.needTwoCharacters`));
      return;
    }
    for (const s of shots) {
      if (!s.charactersText.trim() || !s.action.trim()) {
        setError(t(`${ns}.needShot`));
        return;
      }
    }
    setPhase("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/wave9d/director/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        overrideFeature: "Character Director — Shot Plan",
        body: JSON.stringify(
          buildWave9DirectorPayload({
            name: planName,
            sceneStyle,
            cast: namedCast.map((c) => ({ vaultId: "", name: c.name.trim(), description: c.description.trim() })),
            shots: shots.map((s) => ({
              characters: s.charactersText.split(",").map((x) => x.trim()).filter(Boolean),
              action: s.action,
              cameraNote: s.cameraNote,
            })),
          }),
        ),
      });
      if (!res) { setPhase("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("idle");
        return;
      }
      const planned = wave9DirectorResultOf(data);
      if (!res.ok || !planned) {
        setPhase("idle");
        setError(apiErrorMessage(data, t(`${ns}.errorGeneric`)));
        return;
      }
      setResult(planned);
      setPhase("done");
      try {
        addAsset({
          kind: "script",
          url: "",
          label: planName.trim() ? `Director plan — ${planName.trim()}` : "Director plan",
          detail: planned.shots.map((s) => `Shot ${s.index}: ${s.generatedPrompt}`).join("\n"),
        });
      } catch { /* non-fatal */ }
    } catch {
      setPhase("idle");
      setError(t(`${ns}.errorGeneric`));
    }
  }

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave9-director-bench"
      icon={<Clapperboard className="h-4 w-4" />}
      title={t(`${ns}.title`)}
      cost={cost}
      subtitle={t(`${ns}.subtitle`)}
    >
      <DeskTextField
        isLight={isLight}
        label={t(`${ns}.title`)}
        value={planName}
        onChange={setPlanName}
        placeholder={t(`${ns}.planNamePlaceholder`)}
      />
      <DeskTextField
        isLight={isLight}
        label={t("worldWave9Bench.sceneStyleLabel")}
        value={sceneStyle}
        onChange={setSceneStyle}
        placeholder={t(`${ns}.sceneStylePlaceholder`)}
      />
      <div className="space-y-2">
        <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t(`${ns}.castHeading`)}
        </p>
        {cast.map((c, i) => (
          <div key={c.key} className={`flex items-end gap-2 rounded-xl border p-2 ${cardCls}`}>
            <User className={`mb-2 h-4 w-4 ${muted}`} />
            <div className="min-w-0 flex-1">
              <DeskTextField
                isLight={isLight}
                label={t("worldWave9Bench.castNameLabel")}
                value={c.name}
                onChange={(v) => setCast((prev) => prev.map((p, j) => (j === i ? { ...p, name: v } : p)))}
                placeholder={t("worldWave9Bench.castNamePlaceholder")}
              />
            </div>
            <div className="min-w-0 flex-1">
              <DeskTextField
                isLight={isLight}
                label={t("worldWave9Bench.castDescLabel")}
                value={c.description}
                onChange={(v) => setCast((prev) => prev.map((p, j) => (j === i ? { ...p, description: v } : p)))}
              />
            </div>
            <button
              type="button"
              aria-label={t("worldBenches300.removeLabel")}
              onClick={() => setCast((prev) => prev.filter((_, j) => j !== i))}
              className={`pb-2 ${isLight ? "text-[#92600a]" : "text-white/50"} bdv-touch-target`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setCast((prev) => [...prev, { key: nextDirectorKey(), name: "", description: "" }])}
          className={`rounded-full border px-3 py-1.5 text-xs font-bold bdv-touch-target ${
            isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 text-[#e8c86a]"
          }`}
        >
          {t("worldWave9Bench.addCast")}
        </button>
        <p className={`text-[11px] ${muted}`}>{t(`${ns}.castHint`)}</p>
      </div>
      <div className="space-y-2">
        <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t(`${ns}.shotsHeading`)}
        </p>
        {shots.map((s, i) => (
          <div key={s.key} className={`space-y-2 rounded-xl border p-2 ${cardCls}`}>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold ${strong}`}>{t(`${ns}.shotLabel`, { n: i + 1 })}</span>
              <button
                type="button"
                aria-label={t(`${ns}.removeShot`)}
                onClick={() => setShots((prev) => prev.filter((_, j) => j !== i))}
                className={`ml-auto ${isLight ? "text-[#92600a]" : "text-white/50"} bdv-touch-target`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <DeskTextField
              isLight={isLight}
              label={t("worldWave9Bench.shotCharactersLabel")}
              value={s.charactersText}
              onChange={(v) => setShots((prev) => prev.map((p, j) => (j === i ? { ...p, charactersText: v } : p)))}
              placeholder={t("worldWave9Bench.shotCharactersPlaceholder")}
            />
            <DeskTextField
              isLight={isLight}
              label={t("worldWave9Bench.shotActionLabel")}
              value={s.action}
              onChange={(v) => setShots((prev) => prev.map((p, j) => (j === i ? { ...p, action: v } : p)))}
              placeholder={t(`${ns}.actionPlaceholder`)}
            />
            <DeskTextField
              isLight={isLight}
              label={t("worldWave9Bench.shotCameraLabel")}
              value={s.cameraNote}
              onChange={(v) => setShots((prev) => prev.map((p, j) => (j === i ? { ...p, cameraNote: v } : p)))}
              placeholder={t(`${ns}.cameraNotePlaceholder`)}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => setShots((prev) => [...prev, { key: nextDirectorKey(), charactersText: "", action: "", cameraNote: "" }])}
          className={`rounded-full border px-3 py-1.5 text-xs font-bold bdv-touch-target ${
            isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 text-[#e8c86a]"
          }`}
        >
          {t(`${ns}.addShot`)}
        </button>
      </div>
      <BenchRunButton
        testId="world-wave9-director-run"
        busy={busy}
        busyLabel={t(`${ns}.planning`)}
        label={t(`${ns}.planButton`, { cost })}
        onClick={() => void plan()}
      />
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Character Director" error={error} />
      {busy && <NativeLoadingState isLight={isLight} message={t(`${ns}.planning`)} />}
      {phase === "done" && result && (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-wave9-director-result">
          <p className={`flex items-center gap-2 text-sm font-semibold ${strong}`}>
            <CheckCircle2 className="h-4 w-4 text-green-500" /> {t(`${ns}.resultsHeading`)}
          </p>
          <div className="mt-2 space-y-2">
            {result.shots.map((s) => (
              <div key={s.index}>
                <p className={`text-xs font-bold ${strong}`}>
                  {t(`${ns}.shotLabel`, { n: s.index })} — {s.characters.join(", ")}
                </p>
                <p className={`text-xs ${muted}`}>{s.action}</p>
                {s.cameraNote && <p className={`text-xs ${muted}`}>{s.cameraNote}</p>}
                {s.generatedPrompt && <p className={`mt-0.5 whitespace-pre-wrap text-xs ${muted}`}>{s.generatedPrompt}</p>}
              </div>
            ))}
          </div>
          {result.creditsRemaining !== null && (
            <p className={`mt-2 text-[11px] ${muted}`}>{t("worldWave9Bench.creditsRemaining", { n: result.creditsRemaining })}</p>
          )}
        </div>
      )}
    </BenchShell>
  );
}
