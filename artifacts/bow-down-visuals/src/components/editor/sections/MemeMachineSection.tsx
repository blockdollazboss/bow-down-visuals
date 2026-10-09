import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Laugh, Loader2, Sparkles, Check } from "lucide-react";
import type { CaptionStylePreset, EditorSettings } from "@/lib/editor-settings";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── Meme Machine ─────────────────────────────────────────────────────────
   Visual Vibes editor rail tab. Describe the clip moment, pick a meme
   format — AI writes punchy meme captions (1 VB). One-click applies the
   winner to the timeline via the EXISTING caption system (bold meme style,
   timed to the opening seconds). Format presets tune caption style +
   suggested clip length; cutting stays manual on the timeline. */

const COST = 1;

interface MemeFormat {
  id: string;
  captionStyle: CaptionStylePreset;
  clipSecs: number;
  hint: string;
}

const MEME_FORMATS: MemeFormat[] = [
  { id: "top-bottom", captionStyle: "brutalist", clipSecs: 7, hint: "Classic top/bottom text" },
  { id: "reaction", captionStyle: "boxed", clipSecs: 5, hint: "Reaction zoom + punchline" },
  { id: "caption-pop", captionStyle: "viral-shorts", clipSecs: 8, hint: "Pop-word captions" },
  { id: "narrator", captionStyle: "clean-white", clipSecs: 10, hint: "Dry narrator voice" },
];

interface MemeMachineSectionProps {
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export function MemeMachineSection({ settings, setSettings }: MemeMachineSectionProps) {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [formatId, setFormatId] = useState("top-bottom");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [captions, setCaptions] = useState<string[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [applied, setApplied] = useState(false);

  const format = MEME_FORMATS.find((f) => f.id === formatId) ?? MEME_FORMATS[0];

  async function generate() {
    if (!context.trim() || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setPicked(null);
    setApplied(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/meme-machine/captions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: COST,
        overrideFeature: "Meme Machine",
        body: JSON.stringify({ context: context.trim(), format: format.hint }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as {
        captions?: string[]; error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.captions?.length) throw new Error(data.message || "Caption generation failed.");
      setCaptions(data.captions.slice(0, 5));
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Caption generation failed.");
    } finally {
      setLoading(false);
    }
  }

  function applyMeme() {
    if (picked === null) return;
    const text = captions[picked];
    const line = {
      id: `meme-${Date.now().toString(36)}`,
      startSec: 0,
      endSec: format.clipSecs,
      text,
    };
    setSettings({
      ...settings,
      captions: {
        ...settings.captions,
        enabled: true,
        stylePreset: format.captionStyle,
        lines: [line, ...settings.captions.lines],
      },
    });
    setApplied(true);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-black text-white flex items-center gap-2">
          <Laugh className="h-4 w-4 text-primary" />
          {t("videoEditor.memeMachineTitle", { defaultValue: "Meme Machine" })}
        </h3>
        <p className="text-[11px] text-white/50 mt-1 leading-relaxed">
          {t("videoEditor.memeMachineDesc", {
            defaultValue: "Describe the moment, pick a meme format — AI writes the punchlines (1 VB). Apply drops the winner onto your timeline as styled captions.",
          })}
        </p>
      </div>

      <div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-white/40 mb-1.5">
          {t("videoEditor.memeMachineFormat", { defaultValue: "Meme format" })}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {MEME_FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFormatId(f.id)}
              className={`rounded-xl border px-3 py-2 text-left transition ${formatId === f.id ? "border-primary bg-primary/10" : "border-white/10 hover:border-white/30"}`}
            >
              <p className={`text-xs font-black ${formatId === f.id ? "text-primary" : "text-white"}`}>
                {t(`videoEditor.memeFormat_${f.id}`, { defaultValue: f.hint })}
              </p>
              <p className="text-[10px] text-white/40 mt-0.5">~{f.clipSecs}s · {f.captionStyle}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
          {t("videoEditor.memeMachineContext", { defaultValue: "Describe the clip moment *" })}
        </label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder={t("videoEditor.memeMachinePh", { defaultValue: "e.g. Me realizing the take was muted the whole time…" })}
          className={`${inputClass} mt-1 min-h-[70px] resize-y`}
          maxLength={500}
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {outOfCredits && <OutOfCredits />}

      <button
        type="button"
        onClick={generate}
        disabled={loading || !context.trim()}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {t("videoEditor.memeMachineGenerate", { defaultValue: "Write Meme Captions" })}
      </button>

      {captions.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
            {t("videoEditor.memeMachinePick", { defaultValue: "Pick your punchline" })}
          </p>
          {captions.map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setPicked(i); setApplied(false); }}
              className={`w-full rounded-xl border px-3.5 py-2.5 text-left text-sm transition ${picked === i ? "border-primary bg-primary/10 text-white" : "border-white/10 text-white/75 hover:border-white/30"}`}
            >
              {c}
            </button>
          ))}
          <button
            type="button"
            onClick={applyMeme}
            disabled={picked === null || applied}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 py-2 text-xs font-black text-primary transition hover:bg-primary/20 disabled:opacity-50"
          >
            {applied ? <Check className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {applied
              ? t("videoEditor.memeMachineApplied", { defaultValue: "On your timeline" })
              : t("videoEditor.memeMachineApply", { defaultValue: "Apply to timeline" })}
          </button>
        </div>
      )}
    </div>
  );
}
