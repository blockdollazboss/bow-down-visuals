import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Captions, Check, Zap, Clapperboard, ArrowRight, Sparkles,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import {
  CAPTION_ANIMATIONS,
  CAPTION_STYLE_PRESET_DEFS,
  getValidCaptionWords,
  type CaptionAnimation,
  type CaptionStylePreset,
  type EditorSettings,
} from "@/lib/editor-settings";
import { EditorCard } from "@/components/editor/controls";
import { Button } from "@/components/ui/button";

/* ── Animated Caption Templates ──────────────────────────────────────────
 * One-tap gallery of NEW animated word-by-word caption styles. This fills
 * the gap left by the existing caption surfaces:
 *   - CaptionsSection: 14 STATIC style presets + 7 LINE-level entry
 *     animations (fade/pop/bounce/slide-up/typewriter/word-pop animate the
 *     whole line on entry — none are per-word).
 *   - The single per-word behavior in the master player is the
 *     "karaoke-word" preset (gold sweep + scale pop on the active word).
 *   - AiCaptionSuite: server-burned wordsync/transcript styles
 *     (hormozi, minimal, karaoke, neon, luxury-gold / karaoke, word-by-word,
 *     minimal, bold-outline, neon).
 * None of those offer per-word bounce-in, per-word typewriter reveal,
 * per-word highlight-box, per-word scale-punch, or one-tap style packs.
 * That's what this gallery adds.
 *
 * Each template is demonstrated live in its card with CSS-animated word
 * highlighting driven by the project's REAL per-word timing data
 * (CaptionWord[] — seconds relative to line start — via
 * getValidCaptionWords; falls back to evenly-spread demo timings when the
 * project has no word-timed lines yet).
 *
 * One-tap apply writes the template's export-safe base
 * (stylePreset × animation × position × fontSize — all values the master
 * player and the export ASS renderer already honor) into
 * settings.captions, so what you apply is exactly what previews and
 * exports. The card's "Applies as" line names that base explicitly.
 *
 * DOCK: video-editor.tsx captions rail (coordinator wires the mount).
 * Props follow the sibling-section convention (scenes + settings +
 * setSettings, like CaptionsSection / TimelineTemplatesSection).
 */

export type CaptionWordFx =
  | "bounce-words"
  | "typewriter-words"
  | "highlight-box"
  | "punch-words"
  | "glow-sweep"
  | "neon-pulse"
  | "slide-words"
  | "pop-words";

export interface CaptionTemplateBase {
  stylePreset: CaptionStylePreset;
  animation: CaptionAnimation;
  position: string;
  fontSize: string;
}

export interface CaptionTemplateDef {
  id: string;
  /** i18n: captionTemplates.tpl.<id>.name */
  nameKey: string;
  /** i18n: captionTemplates.tpl.<id>.desc */
  descKey: string;
  wordFx: CaptionWordFx;
  /** Export-safe base applied to settings.captions on one-tap apply. */
  base: CaptionTemplateBase;
  accent: string;
}

export const CAPTION_TEMPLATE_DEFS: CaptionTemplateDef[] = [
  {
    id: "bounce-words",
    nameKey: "captionTemplates.tpl.bounce-words.name",
    descKey: "captionTemplates.tpl.bounce-words.desc",
    wordFx: "bounce-words",
    base: { stylePreset: "karaoke-word", animation: "bounce", position: "Bottom", fontSize: "Large" },
    accent: "from-yellow-500/20 to-amber-600/10 border-yellow-500/30",
  },
  {
    id: "typewriter-words",
    nameKey: "captionTemplates.tpl.typewriter-words.name",
    descKey: "captionTemplates.tpl.typewriter-words.desc",
    wordFx: "typewriter-words",
    base: { stylePreset: "clean-white", animation: "typewriter", position: "Bottom", fontSize: "Large" },
    accent: "from-white/10 to-white/5 border-white/20",
  },
  {
    id: "highlight-box",
    nameKey: "captionTemplates.tpl.highlight-box.name",
    descKey: "captionTemplates.tpl.highlight-box.desc",
    wordFx: "highlight-box",
    base: { stylePreset: "karaoke-word", animation: "pop", position: "Center", fontSize: "Large" },
    accent: "from-fuchsia-500/20 to-yellow-400/10 border-fuchsia-400/30",
  },
  {
    id: "punch-words",
    nameKey: "captionTemplates.tpl.punch-words.name",
    descKey: "captionTemplates.tpl.punch-words.desc",
    wordFx: "punch-words",
    base: { stylePreset: "viral-shorts", animation: "word-pop", position: "Bottom", fontSize: "Large" },
    accent: "from-red-500/20 to-pink-500/10 border-red-500/30",
  },
  {
    id: "glow-sweep",
    nameKey: "captionTemplates.tpl.glow-sweep.name",
    descKey: "captionTemplates.tpl.glow-sweep.desc",
    wordFx: "glow-sweep",
    base: { stylePreset: "karaoke-word", animation: "fade", position: "Bottom", fontSize: "Large" },
    accent: "from-amber-400/20 to-yellow-600/10 border-amber-400/30",
  },
  {
    id: "neon-pulse",
    nameKey: "captionTemplates.tpl.neon-pulse.name",
    descKey: "captionTemplates.tpl.neon-pulse.desc",
    wordFx: "neon-pulse",
    base: { stylePreset: "neon-glow", animation: "pop", position: "Bottom", fontSize: "Large" },
    accent: "from-cyan-400/20 to-fuchsia-500/10 border-cyan-400/30",
  },
  {
    id: "slide-words",
    nameKey: "captionTemplates.tpl.slide-words.name",
    descKey: "captionTemplates.tpl.slide-words.desc",
    wordFx: "slide-words",
    base: { stylePreset: "boxed", animation: "slide-up", position: "Bottom", fontSize: "Medium" },
    accent: "from-white/10 to-black/20 border-white/15",
  },
  {
    id: "pop-words",
    nameKey: "captionTemplates.tpl.pop-words.name",
    descKey: "captionTemplates.tpl.pop-words.desc",
    wordFx: "pop-words",
    base: { stylePreset: "pill-pop", animation: "word-pop", position: "Center", fontSize: "Large" },
    accent: "from-yellow-500/25 to-amber-600/10 border-yellow-500/40",
  },
];

interface CaptionTemplatesSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  /** Preferred: coordinator wires these to switch rail tabs without reload. */
  onGoToExport?: (videoUrl?: string) => void;
  onGoToPromoClips?: () => void;
}

interface DemoWord { word: string; start: number; end: number }
interface DemoLine { words: DemoWord[]; dur: number; live: boolean }

const DEMO_SAMPLE = "Bow down to the visual vibes";
const SYNTH_DEMO_SEC = 4.2;

function synthWords(text: string, total = SYNTH_DEMO_SEC): DemoWord[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return synthWords(DEMO_SAMPLE, total);
  return words.map((word, i) => ({
    word,
    start: parseFloat(((i / words.length) * total).toFixed(2)),
    end: parseFloat((((i + 1) / words.length) * total).toFixed(2)),
  }));
}

type WordState = "upcoming" | "active" | "sung";

export function CaptionTemplatesSection({
  scenes,
  settings,
  setSettings,
  onGoToExport,
  onGoToPromoClips,
}: CaptionTemplatesSectionProps) {
  const { t } = useTranslation();
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => performance.now());

  /* Demo clock — drives every card's word-by-word animation. */
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(performance.now()), 120);
    return () => window.clearInterval(id);
  }, []);

  /* Demo line: prefer the project's REAL per-word timings; otherwise
     synthesize even timings from the first caption line / scene lyric /
     built-in sample so the gallery always animates. */
  const demo: DemoLine = useMemo(() => {
    const lines = settings.captions?.lines ?? [];
    for (const l of lines) {
      const valid = getValidCaptionWords(l);
      if (valid && valid.length > 0) {
        const words = valid.map((w) => ({ word: w.word, start: w.start, end: w.end }));
        const dur = Math.max(...words.map((w) => w.end), 1);
        return { words, dur, live: true };
      }
    }
    const text =
      lines.find((l) => l.text.trim())?.text.trim() ||
      scenes.find((s) => s.lyricLine?.trim())?.lyricLine?.trim() ||
      DEMO_SAMPLE;
    return { words: synthWords(text), dur: SYNTH_DEMO_SEC, live: false };
  }, [settings.captions?.lines, scenes]);

  const loopDur = demo.dur + 1.4;
  const loopT = (nowMs / 1000) % loopDur;
  const loopIdx = Math.floor(nowMs / 1000 / loopDur);

  function wordState(w: DemoWord): WordState {
    if (loopT < w.start) return "upcoming";
    if (loopT < w.end) return "active";
    return "sung";
  }

  function applyTemplate(tpl: CaptionTemplateDef) {
    const c = settings.captions;
    setSettings({
      ...settings,
      captions: {
        ...c,
        mode: c.mode === "none" ? "auto" : c.mode,
        stylePreset: tpl.base.stylePreset,
        animation: tpl.base.animation,
        position: tpl.base.position,
        fontSize: tpl.base.fontSize,
      },
    });
    setAppliedId(tpl.id);
  }

  function isApplied(tpl: CaptionTemplateDef) {
    const c = settings.captions;
    return (
      appliedId === tpl.id ||
      (c.stylePreset === tpl.base.stylePreset &&
        c.animation === tpl.base.animation &&
        c.position === tpl.base.position &&
        c.fontSize === tpl.base.fontSize)
    );
  }

  function appliesAsLabel(tpl: CaptionTemplateDef) {
    const preset = CAPTION_STYLE_PRESET_DEFS.find((p) => p.id === tpl.base.stylePreset)?.name ?? tpl.base.stylePreset;
    const anim = CAPTION_ANIMATIONS.find((a) => a.id === tpl.base.animation)?.label ?? tpl.base.animation;
    return `${preset} · ${anim} · ${tpl.base.position}`;
  }

  /* ── Handoffs: captions → promo clips / export ── */
  function goPromoClips() {
    if (onGoToPromoClips) {
      onGoToPromoClips();
      return;
    }
    // Fallback deep link — /promo-clip redirects to /video-editor?tab=promo-clips (App.tsx).
    window.location.assign("/video-editor?tab=promo-clips");
  }

  function goExport() {
    if (onGoToExport) {
      onGoToExport();
      return;
    }
    window.location.assign("/video-editor?tab=export");
  }

  return (
    <EditorCard
      title={t("captionTemplates.title")}
      subtitle={t("captionTemplates.subtitle")}
      icon={<Captions className="h-4 w-4" />}
      right={
        <span className="text-[10px] font-black uppercase tracking-widest text-[#e8c86a] border border-[#E8C468]/30 bg-[#E8C468]/10 rounded-full px-2.5 py-1">
          {t("captionTemplates.badge")}
        </span>
      }
      className="border-[#E8C468]/20"
    >
      <div className="space-y-5">
        {/* Timing source note */}
        <p className="text-[11px] text-white/35 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#e8c86a]" />
          {demo.live ? t("captionTemplates.demoTimingLive") : t("captionTemplates.demoTimingSynth")}
        </p>

        {/* ── Template gallery ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CAPTION_TEMPLATE_DEFS.map((tpl) => {
            const applied = isApplied(tpl);
            return (
              <div
                key={tpl.id}
                data-testid={`caption-template-${tpl.id}`}
                className={`rounded-xl border bg-gradient-to-br p-3.5 transition-all ${tpl.accent} ${
                  applied ? "ring-2 ring-[#E8C468]/70" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-white">{t(tpl.nameKey)}</p>
                    <p className="text-[11px] text-white/45 mt-0.5 leading-snug">{t(tpl.descKey)}</p>
                  </div>
                  {applied && (
                    <span className="shrink-0 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-black bg-[#E8C468] rounded-full px-2 py-0.5">
                      <Check className="h-3 w-3" />
                      {t("captionTemplates.applied")}
                    </span>
                  )}
                </div>

                {/* Live animated word-by-word demo — a video-frame simulation:
                    stays dark in both themes (data-dark-lock) so the burned-in
                    caption styling previews exactly as it exports. */}
                <div className="mt-3 rounded-lg bg-black/60 border border-white/10 px-3 py-4 overflow-hidden" data-dark-lock>
                  <p className={`ct-demo-line ct-fx-${tpl.wordFx}`} aria-hidden>
                    {demo.words.map((w, i) => (
                      <span key={`${loopIdx}-${i}`} className={`ct-w ct-${wordState(w)}`}>
                        {w.word}
                        {i < demo.words.length - 1 ? " " : ""}
                      </span>
                    ))}
                  </p>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[10px] text-white/35 font-semibold">
                    <span className="uppercase tracking-widest text-white/25">{t("captionTemplates.appliesAs")} </span>
                    {appliesAsLabel(tpl)}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => applyTemplate(tpl)}
                    data-testid={`caption-template-apply-${tpl.id}`}
                    className={applied ? "bg-white/10 text-white hover:bg-white/10" : "bg-[#E8C468] text-black font-black hover:bg-[#f0d47e]"}
                  >
                    <Zap className="h-3.5 w-3.5 mr-1.5" />
                    {applied ? t("captionTemplates.applied") : t("captionTemplates.apply")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Captions → clips handoff ── */}
        <div className="rounded-xl border border-[#E8C468]/25 bg-[#E8C468]/[0.05] p-4 space-y-3">
          <p className="text-[10px] font-black text-white/45 uppercase tracking-widest">
            {t("captionTemplates.handoffTitle")}
          </p>
          <p className="text-xs text-white/50 leading-relaxed">{t("captionTemplates.handoffDesc")}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              size="sm"
              onClick={goPromoClips}
              data-testid="caption-template-goto-clips"
              className="bg-[#E8C468] text-black font-black hover:bg-[#f0d47e]"
            >
              <Clapperboard className="h-3.5 w-3.5 mr-1.5" />
              {t("captionTemplates.gotoClips")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={goExport}
              data-testid="caption-template-goto-export"
            >
              {t("captionTemplates.gotoExport")}
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Per-word animation treatments (scoped to this gallery) ── */}
      <style>{`
        .ct-demo-line { font-weight: 900; font-size: 1.05rem; line-height: 1.6; color: #fff; text-align: center; text-shadow: 2px 2px 0 #000, -1px -1px 0 #000; }
        .ct-demo-line .ct-w { display: inline-block; white-space: pre; }

        /* 1 — bounce-words: each word bounces in as it's spoken */
        .ct-fx-bounce-words .ct-upcoming { opacity: 0; transform: translateY(10px); }
        .ct-fx-bounce-words .ct-active { opacity: 1; color: #FFD700; animation: ct-bounce-in 0.45s cubic-bezier(0.34,1.56,0.64,1); }
        .ct-fx-bounce-words .ct-sung { opacity: 1; color: #fff; }
        @keyframes ct-bounce-in { 0% { opacity: 0; transform: translateY(14px) scale(0.6); } 60% { opacity: 1; transform: translateY(-4px) scale(1.18); } 100% { opacity: 1; transform: none; } }

        /* 2 — typewriter-words: words reveal one at a time, caret on the live word */
        .ct-fx-typewriter-words .ct-upcoming { visibility: hidden; }
        .ct-fx-typewriter-words .ct-active { visibility: visible; color: #fff; position: relative; }
        .ct-fx-typewriter-words .ct-active::after { content: ""; display: inline-block; width: 0.12em; height: 1em; margin-left: 0.08em; vertical-align: -0.12em; background: #E8C468; animation: ct-caret-blink 0.7s steps(2) infinite; }
        .ct-fx-typewriter-words .ct-sung { visibility: visible; color: rgba(255,255,255,0.92); }
        @keyframes ct-caret-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

        /* 3 — highlight-box: the spoken word gets a gold pill behind it */
        .ct-fx-highlight-box .ct-upcoming { opacity: 0.38; color: #fff; }
        .ct-fx-highlight-box .ct-active { color: #111; text-shadow: none; background: linear-gradient(180deg, #FFD700, #E0A800); border-radius: 999px; padding: 0 0.45em; box-shadow: 0 2px 14px rgba(255,215,0,0.45); animation: ct-box-pop 0.25s cubic-bezier(0.34,1.56,0.64,1); }
        .ct-fx-highlight-box .ct-sung { opacity: 1; color: #fff; }
        @keyframes ct-box-pop { 0% { transform: scale(0.7); } 100% { transform: scale(1); } }

        /* 4 — punch-words: the spoken word scale-punches with spring */
        .ct-fx-punch-words .ct-upcoming { opacity: 0.35; color: #fff; }
        .ct-fx-punch-words .ct-active { opacity: 1; color: #FFD700; animation: ct-punch 0.38s cubic-bezier(0.34,1.8,0.64,1); text-shadow: 0 0 16px rgba(255,215,0,0.8), 2px 2px 0 #000; }
        .ct-fx-punch-words .ct-sung { opacity: 1; color: #fff; }
        @keyframes ct-punch { 0% { transform: scale(0.5); } 55% { transform: scale(1.35); } 100% { transform: scale(1.12); } }

        /* 5 — glow-sweep: a gold glow washes across words as they're sung */
        .ct-fx-glow-sweep .ct-upcoming { opacity: 0.4; color: #fff; }
        .ct-fx-glow-sweep .ct-active { opacity: 1; color: #FFE9A3; animation: ct-glow-wash 0.5s ease; text-shadow: 0 0 18px rgba(255,215,0,0.95), 0 0 42px rgba(255,180,0,0.5), 2px 2px 0 #000; }
        .ct-fx-glow-sweep .ct-sung { opacity: 1; color: #FFF3D6; }
        @keyframes ct-glow-wash { 0% { text-shadow: 0 0 4px rgba(255,215,0,0.2), 2px 2px 0 #000; } 100% { text-shadow: 0 0 18px rgba(255,215,0,0.95), 0 0 42px rgba(255,180,0,0.5), 2px 2px 0 #000; } }

        /* 6 — neon-pulse: the spoken word pulses cyan/magenta neon */
        .ct-fx-neon-pulse .ct-upcoming { opacity: 0.35; color: #fff; }
        .ct-fx-neon-pulse .ct-active { opacity: 1; color: #A5F3FC; animation: ct-neon-pulse 0.8s ease-in-out infinite; }
        .ct-fx-neon-pulse .ct-sung { opacity: 1; color: rgba(255,255,255,0.85); }
        @keyframes ct-neon-pulse { 0%, 100% { text-shadow: 0 0 10px rgba(34,211,238,0.9), 0 0 28px rgba(34,211,238,0.45), 1px 1px 0 #000; transform: scale(1); } 50% { text-shadow: 0 0 16px rgba(232,103,219,0.95), 0 0 40px rgba(232,103,219,0.5), 1px 1px 0 #000; transform: scale(1.08); } }

        /* 7 — slide-words: words rise into place as they're spoken */
        .ct-fx-slide-words .ct-upcoming { opacity: 0; transform: translateY(12px); }
        .ct-fx-slide-words .ct-active { opacity: 1; color: #fff; background: rgba(0,0,0,0.72); border-radius: 0.4rem; padding: 0 0.4em; animation: ct-rise 0.32s ease; }
        .ct-fx-slide-words .ct-sung { opacity: 1; color: #fff; background: rgba(0,0,0,0.72); border-radius: 0.4rem; padding: 0 0.4em; }
        @keyframes ct-rise { 0% { opacity: 0; transform: translateY(12px); } 100% { opacity: 1; transform: none; } }

        /* 8 — pop-words: words pop in with overshoot spring */
        .ct-fx-pop-words .ct-upcoming { opacity: 0; transform: scale(0); }
        .ct-fx-pop-words .ct-active { opacity: 1; color: #111; text-shadow: none; background: linear-gradient(180deg, #FFD700, #E0A800); border-radius: 999px; padding: 0 0.45em; animation: ct-popcorn 0.4s cubic-bezier(0.34,1.8,0.64,1); box-shadow: 0 4px 18px rgba(0,0,0,0.55); }
        .ct-fx-pop-words .ct-sung { opacity: 1; color: #111; text-shadow: none; background: linear-gradient(180deg, #FFD700, #E0A800); border-radius: 999px; padding: 0 0.45em; box-shadow: 0 4px 18px rgba(0,0,0,0.55); }
        @keyframes ct-popcorn { 0% { opacity: 0; transform: scale(0); } 60% { opacity: 1; transform: scale(1.25); } 100% { opacity: 1; transform: scale(1); } }

        @media (prefers-reduced-motion: reduce) {
          .ct-demo-line .ct-w { animation: none !important; }
          .ct-demo-line .ct-upcoming { opacity: 0.5 !important; transform: none !important; visibility: visible !important; }
        }
      `}</style>
    </EditorCard>
  );
}
