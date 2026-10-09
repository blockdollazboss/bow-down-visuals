import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Fingerprint, Loader2, Sparkles, Link2, Check } from "lucide-react";
import type { CaptionStylePreset, EditorSettings } from "@/lib/editor-settings";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── Style Stealer ────────────────────────────────────────────────────────
   Visual Vibes editor rail tab. Paste a viral video URL + describe what you
   saw; AI reverse-engineers the formula (hook, pacing, cut pattern — TEXT
   analysis, we never download or watch the video) and produces an edit
   recipe. One-click Apply maps the machine-actionable hints (caption style,
   effects, overlays) onto the timeline via setSettings. 2 credits. */

const COST = 2;

const KNOWN_CAPTION_STYLES: CaptionStylePreset[] = [
  "clean-white", "gold-hiphop", "karaoke", "boxed", "viral-shorts",
  "minimal", "neon-glow", "pill-pop", "brutalist",
];
const KNOWN_EFFECTS = ["Film Grain", "Vignette", "Glow", "Neon Glow", "Vibrant Pop", "Cinematic Bars", "VHS", "Warm Grade", "Cool Grade"];
const KNOWN_OVERLAYS = ["Smoke", "Rain", "Sparks", "Lens Flare", "Dust", "Light Leaks"];

interface ApplyHints {
  captionStyle?: string;
  effects?: string[];
  overlays?: string[];
}

interface StealResponse {
  formula?: {
    hook: string;
    pacing: string;
    cutPattern: string;
    captionStyle: string;
    audioCues: string;
    whyItWorks: string;
  };
  editRecipe?: { name: string; steps: string[] };
  applyHints?: ApplyHints;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface StyleStealerSectionProps {
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  /** When true, skips the internal header (a shell provides it). */
  bare?: boolean;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export function StyleStealerSection({ settings, setSettings, bare }: StyleStealerSectionProps) {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [videoUrl, setVideoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [niche, setNiche] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [result, setResult] = useState<StealResponse | null>(null);
  const [applied, setApplied] = useState(false);

  async function analyze() {
    if (!description.trim() || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setApplied(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/style-stealer/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: COST,
        overrideFeature: "Style Stealer",
        body: JSON.stringify({
          videoUrl: videoUrl.trim(),
          description: description.trim(),
          niche: niche.trim(),
        }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as StealResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.formula) throw new Error(data.message || "Analysis failed.");
      setResult(data);
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  function applyRecipe() {
    const hints = result?.applyHints;
    if (!hints) return;
    const captionStyle = KNOWN_CAPTION_STYLES.includes(hints.captionStyle as CaptionStylePreset)
      ? (hints.captionStyle as CaptionStylePreset)
      : settings.captions.stylePreset;
    const effects = (hints.effects ?? []).filter((e) => KNOWN_EFFECTS.includes(e));
    const overlays = (hints.overlays ?? []).filter((o) => KNOWN_OVERLAYS.includes(o));
    setSettings({
      ...settings,
      captions: { ...settings.captions, stylePreset: captionStyle },
      effects: effects.length > 0 ? effects : settings.effects,
      overlays: overlays.length > 0 ? overlays : settings.overlays,
    });
    setApplied(true);
  }

  const f = result?.formula;

  return (
    <div className="space-y-4">
      {!bare && (
      <div>
        <h3 className="text-sm font-black text-white flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-primary" />
          {t("videoEditor.styleStealerTitle", { defaultValue: "Style Stealer" })}
        </h3>
        <p className="text-[11px] text-white/50 mt-1 leading-relaxed">
          {t("videoEditor.styleStealerDesc", {
            defaultValue: "Paste a viral video link and describe what you saw. AI reverse-engineers its formula — hook, pacing, cuts — into an edit recipe for your timeline. 2 VB.",
          })}
        </p>
      </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("videoEditor.styleStealerUrl", { defaultValue: "Viral video URL" })}
          </label>
          <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://…" className={`${inputClass} mt-1`} maxLength={500} />
        </div>
        <div>
          <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("videoEditor.styleStealerDescLabel", { defaultValue: "Describe what you saw *" })}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("videoEditor.styleStealerDescPh", { defaultValue: "e.g. Opens with a freeze-frame + bold text, jump cuts every 2 sec on the beat, captions pop word-by-word…" })}
            className={`${inputClass} mt-1 min-h-[90px] resize-y`}
            maxLength={2000}
          />
        </div>
        <div>
          <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("videoEditor.styleStealerNiche", { defaultValue: "Your niche (optional)" })}
          </label>
          <input value={niche} onChange={(e) => setNiche(e.target.value)} className={`${inputClass} mt-1`} maxLength={120} />
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {outOfCredits && <OutOfCredits />}

      <button
        type="button"
        onClick={analyze}
        disabled={loading || !description.trim()}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {t("videoEditor.styleStealerAnalyze", { defaultValue: "Steal This Style" })}
      </button>

      {f && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
            {t("videoEditor.styleStealerFormula", { defaultValue: "The formula" })}
          </p>
          {[
            [t("videoEditor.styleStealerHook", { defaultValue: "Hook" }), f.hook],
            [t("videoEditor.styleStealerPacing", { defaultValue: "Pacing" }), f.pacing],
            [t("videoEditor.styleStealerCuts", { defaultValue: "Cut pattern" }), f.cutPattern],
            [t("videoEditor.styleStealerCaptions", { defaultValue: "Captions" }), f.captionStyle],
            [t("videoEditor.styleStealerAudio", { defaultValue: "Audio cues" }), f.audioCues],
            [t("videoEditor.styleStealerWhy", { defaultValue: "Why it works" }), f.whyItWorks],
          ].map(([label, val], i) => (
            <div key={i}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">{label}</p>
              <p className="text-xs text-white/80 leading-relaxed mt-0.5">{val}</p>
            </div>
          ))}

          {result?.editRecipe && (
            <div className="pt-2 border-t border-white/10">
              <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1.5">
                {result.editRecipe.name}
              </p>
              <ol className="list-decimal list-inside space-y-1 text-xs text-white/75">
                {result.editRecipe.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          )}

          {result?.applyHints && (
            <button
              type="button"
              onClick={applyRecipe}
              disabled={applied}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 py-2 text-xs font-black text-primary transition hover:bg-primary/20 disabled:opacity-50"
            >
              {applied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
              {applied
                ? t("videoEditor.styleStealerApplied", { defaultValue: "Applied to timeline" })
                : t("videoEditor.styleStealerApply", { defaultValue: "Apply style to my timeline" })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
