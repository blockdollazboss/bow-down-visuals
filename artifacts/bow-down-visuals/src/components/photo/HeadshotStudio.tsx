import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Camera,
  Loader2,
  Sparkles,
  Wand2,
  SlidersHorizontal,
  PenLine,
  Download,
  AlertCircle,
  Check,
  Building2,
  MicVocal,
  Flame,
  Gem,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/**
 * AI Headshots — creator profile-pic generator.
 * Difficulty ladder: AI Autopilot (default) → Guided presets → Manual (free prompt).
 * Docks into the Branding Kit tab bar (branding-kit.tsx "headshots" tab).
 * Pure UI is free; only the generation call costs credits (confirmed via overrideCost).
 */

type FlowMode = "autopilot" | "preset" | "manual";
type PresetId = "studio" | "stage" | "street" | "luxury";

/* PLACEHOLDER price — user must approve the real price (see credit-costs.ts report). */
const HEADSHOT_COST = 100;

const PRESETS: { id: PresetId; icon: typeof Building2; blurbKey: string; defaultBlurb: string }[] = [
  { id: "studio", icon: Building2, blurbKey: "headshotStudio.presets.studio", defaultBlurb: "Classic studio portrait — clean backdrop, soft pro lighting." },
  { id: "stage", icon: MicVocal, blurbKey: "headshotStudio.presets.stage", defaultBlurb: "On-stage look — spotlights and crowd energy behind you." },
  { id: "street", icon: Flame, blurbKey: "headshotStudio.presets.street", defaultBlurb: "Street editorial — golden hour, urban, confident." },
  { id: "luxury", icon: Gem, blurbKey: "headshotStudio.presets.luxury", defaultBlurb: "Luxury editorial — marble, gold, high-end fashion." },
];

const MODELS: { id: "nano-banana-2.1" | "ideogram-4.0"; labelKey: string; defaultLabel: string; hintKey: string; defaultHint: string }[] = [
  { id: "nano-banana-2.1", labelKey: "headshotStudio.models.nano", defaultLabel: "Nano Banana", hintKey: "headshotStudio.models.nanoHint", defaultHint: "Fast · locks your face" },
  { id: "ideogram-4.0", labelKey: "headshotStudio.models.ideogram", defaultLabel: "Ideogram", hintKey: "headshotStudio.models.ideogramHint", defaultHint: "Alt render style" },
];

const FLOWS: { id: FlowMode; icon: typeof Wand2; labelKey: string; defaultLabel: string }[] = [
  { id: "autopilot", icon: Wand2, labelKey: "headshotStudio.flows.autopilot", defaultLabel: "AI Autopilot" },
  { id: "preset", icon: SlidersHorizontal, labelKey: "headshotStudio.flows.preset", defaultLabel: "Style presets" },
  { id: "manual", icon: PenLine, labelKey: "headshotStudio.flows.manual", defaultLabel: "Manual prompt" },
];

interface GenerateResponse {
  status?: string;
  url?: string | null;
  path?: string | null;
  taskId?: string;
  error?: string;
  code?: string;
  message?: string;
}

export function HeadshotStudio() {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [flow, setFlow] = useState<FlowMode>("autopilot");
  const [preset, setPreset] = useState<PresetId>("studio");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<"nano-banana-2.1" | "ideogram-4.0">("nano-banana-2.1");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerDown, setProviderDown] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const flowClass = (active: boolean) =>
    `flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-colors ${
      active
        ? "border-primary/60 bg-primary/15 text-primary"
        : "border-white/10 bg-white/5 text-white/50 hover:text-white/85 hover:border-white/25"
    } disabled:opacity-50`;

  const chipClass = (active: boolean) =>
    `px-3.5 py-1.5 rounded-full border text-xs font-bold transition-colors ${
      active
        ? "border-primary/60 bg-primary/15 text-primary"
        : "border-white/10 bg-white/5 text-white/50 hover:text-white/80"
    } disabled:opacity-50`;

  const canGenerate =
    !generating && (flow !== "manual" || prompt.trim().length > 0);

  async function startGeneration() {
    if (flow === "manual" && !prompt.trim()) {
      setError(t("headshotStudio.errors.describeFirst", { defaultValue: "Describe the headshot look first." }));
      return;
    }
    setGenerating(true);
    setError(null);
    setProviderDown(false);
    setResultUrl(null);
    try {
      const res = await confirmedFetch("/api/generate-headshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: flow,
          preset: flow === "preset" ? preset : undefined,
          promptText: flow === "manual" ? prompt.trim() : undefined,
          model,
          referenceImageUrl: referenceUrl.trim() || null,
        }),
        overrideCost: HEADSHOT_COST,
        overrideFeature: t("headshotStudio.featureName", { defaultValue: "AI Headshot" }) as string,
      });
      if (!res) { setGenerating(false); return; } // user cancelled the credit confirmation
      const data = (await res.json()) as GenerateResponse;
      if (!res.ok || !data.url) {
        if (res.status === 503 || data.code === "provider_not_connected") setProviderDown(true);
        throw new Error(
          data.message ?? data.error ??
            (data.code === "out_of_credits"
              ? t("headshotStudio.errors.outOfCredits", { defaultValue: "Not enough Visual Bucs. Please buy more Visual Bucs to continue." })
              : t("headshotStudio.errors.failed", { defaultValue: "Headshot generation failed. Visual Bucs were not charged." })),
        );
      }
      setGenerating(false);
      refreshProfile();
      setResultUrl(data.url);
    } catch (e) {
      setGenerating(false);
      setError(e instanceof Error ? e.message : t("headshotStudio.errors.failed", { defaultValue: "Headshot generation failed. Visual Bucs were not charged." }));
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4">
      {/* Header */}
      <div className="text-center mb-6">
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-primary">
          <Camera className="h-3.5 w-3.5" />
          {t("headshotStudio.eyebrow", { defaultValue: "Profile pics" })}
        </p>
        <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
          <span className="bg-gradient-to-r from-[#d4af37] via-[#f7e9b8] to-[#d4af37] bg-clip-text text-transparent">
            {t("headshotStudio.title", { defaultValue: "AI Headshots" })}
          </span>
        </h2>
        <p className="mt-2 text-sm text-white/45 max-w-md mx-auto">
          {t("headshotStudio.subtitle", { defaultValue: "A profile pic that looks expensive. Pick a flow — the AI handles the rest." })}
        </p>
      </div>

      {/* Difficulty ladder: autopilot → presets → manual */}
      <div className="flex flex-wrap justify-center gap-2 mb-6">
        {FLOWS.map(({ id, icon: Icon, labelKey, defaultLabel }) => (
          <button
            key={id}
            type="button"
            disabled={generating}
            onClick={() => { setFlow(id); setError(null); }}
            data-testid={`headshot-flow-${id}`}
            className={flowClass(flow === id)}
          >
            <Icon className="h-4 w-4" />
            {t(labelKey, { defaultValue: defaultLabel })}
          </button>
        ))}
      </div>

      {/* Autopilot: zero decisions */}
      {flow === "autopilot" && (
        <div className="rounded-2xl border border-primary/25 bg-primary/[0.06] px-5 py-4 mb-4">
          <p className="text-sm text-white/80 flex items-start gap-2">
            <Wand2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            {t("headshotStudio.autopilot.blurb", {
              defaultValue: "One tap. The AI picks the most flattering studio look automatically — lighting, backdrop, framing, everything.",
            })}
          </p>
        </div>
      )}

      {/* Guided presets */}
      {flow === "preset" && (
        <div className="mb-4">
          <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">
            {t("headshotStudio.styleLabel", { defaultValue: "Style" })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map(({ id, icon: Icon, blurbKey, defaultBlurb }) => {
              const active = preset === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={generating}
                  onClick={() => setPreset(id)}
                  data-testid={`headshot-preset-${id}`}
                  className={`text-left rounded-2xl border px-4 py-3.5 transition-colors ${
                    active
                      ? "border-primary/60 bg-primary/10"
                      : "border-white/10 bg-white/[0.03] hover:border-white/25"
                  } disabled:opacity-50`}
                >
                  <span className={`flex items-center gap-2 text-sm font-black ${active ? "text-primary" : "text-white/85"}`}>
                    <Icon className="h-4 w-4" />
                    {t(`headshotStudio.presetNames.${id}`, { defaultValue: id[0].toUpperCase() + id.slice(1) })}
                    {active && <Check className="h-3.5 w-3.5 ml-auto" />}
                  </span>
                  <span className="block mt-1 text-[11px] text-white/40">
                    {t(blurbKey, { defaultValue: defaultBlurb })}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Manual: free prompt field */}
      {flow === "manual" && (
        <div className="mb-4">
          <label className="text-[10px] font-bold text-white/40 uppercase tracking-wider">
            {t("headshotStudio.manualLabel", { defaultValue: "Your prompt — full control" })}
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={generating}
            rows={4}
            data-testid="headshot-prompt"
            className="mt-1.5 w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 disabled:opacity-50"
            placeholder={t("headshotStudio.manualPlaceholder", {
              defaultValue: "e.g. dramatic black-and-white headshot, hard shadows, film noir mood, looking off-camera…",
            })}
          />
        </div>
      )}

      {/* Face reference (identity lock) — optional for every flow */}
      <div className="mb-4">
        <label className="text-[10px] font-bold text-white/40 uppercase tracking-wider">
          {t("headshotStudio.refLabel", { defaultValue: "Face reference (optional)" })}
        </label>
        <input
          value={referenceUrl}
          onChange={(e) => setReferenceUrl(e.target.value)}
          disabled={generating}
          placeholder={t("headshotStudio.refPlaceholder", { defaultValue: "Paste a photo URL to lock your identity — the headshot keeps your face." })}
          className="mt-1.5 w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 disabled:opacity-50"
        />
      </div>

      {/* Model */}
      <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">
        {t("headshotStudio.modelLabel", { defaultValue: "Engine" })}
      </p>
      <div className="flex gap-2 flex-wrap mb-5">
        {MODELS.map((m) => {
          const active = model === m.id;
          return (
            <button
              key={m.id}
              type="button"
              disabled={generating}
              onClick={() => setModel(m.id)}
              data-testid={`headshot-model-${m.id}`}
              className={`px-3.5 py-2 rounded-xl border text-xs font-bold transition-colors ${
                active
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-white/10 bg-white/5 text-white/50 hover:text-white/80"
              } disabled:opacity-50`}
            >
              {t(m.labelKey, { defaultValue: m.defaultLabel })}
              <span className="block text-[10px] font-medium opacity-70">{t(m.hintKey, { defaultValue: m.defaultHint })}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className={`mb-4 text-xs rounded-xl px-3.5 py-2.5 flex items-start gap-2 ${
          providerDown
            ? "text-amber-300 bg-amber-500/10 border border-amber-500/20"
            : "text-red-400 bg-red-500/10 border border-red-500/20"
        }`}>
          <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
          <span>
            {error}
            {providerDown && (
              <>
                {" "}
                {t("headshotStudio.errors.tryOtherEngine", {
                  defaultValue: "Try the other engine above — or ask the owner to connect the API key.",
                })}
              </>
            )}
          </span>
        </p>
      )}

      {/* Generate */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={startGeneration}
          disabled={!canGenerate}
          data-testid="btn-generate-headshot"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-primary text-black hover:brightness-110 transition-all disabled:opacity-50 gold-glow"
        >
          {generating
            ? (<><Loader2 className="h-4 w-4 animate-spin" /> {t("headshotStudio.generating", { defaultValue: "Generating…" })}</>)
            : (<><Sparkles className="h-4 w-4" /> {t("headshotStudio.generate", { defaultValue: "Generate headshot" })} · {HEADSHOT_COST} {t("headshotStudio.visualBucs", { defaultValue: "Visual Bucs" })}</>)}
        </button>
        <p className="text-[11px] text-white/30">
          {flow === "autopilot"
            ? t("headshotStudio.autopilot.costNote", { defaultValue: "Charged only if the headshot succeeds." })
            : t("headshotStudio.costNote", { defaultValue: "Charged only if the headshot succeeds." })}
        </p>
      </div>

      {/* Result */}
      {resultUrl && (
        <div className="mb-8">
          <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">
            {t("headshotStudio.resultLabel", { defaultValue: "Your headshot" })}
          </p>
          <div className="flex flex-col sm:flex-row items-start gap-4">
            <img
              src={resultUrl}
              alt={t("headshotStudio.resultAlt", { defaultValue: "Generated AI headshot" })}
              className="w-48 h-48 rounded-2xl object-cover border border-primary/30"
            />
            <a
              href={resultUrl}
              download
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border border-primary/60 bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
            >
              <Download className="h-4 w-4" />
              {t("headshotStudio.download", { defaultValue: "Download" })}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
