/**
 * RandomizerBench — the Content Randomizer's native bench
 * at the Hook Desk (Stack 300 world parity, census Lane B
 * item 8 / manifest item 101), stacked under the Hook Desk
 * itself: the Hooks page's "dice" tab, in the room. (Not the
 * TailDesks giveaway draw — a different feature entirely.)
 *
 * The page's two rolls on the page's own terms (lib/world/
 * randomizer-bench.ts): the FREE roll picks from the page's
 * own idea lists client-side and never touches the seam;
 * the AI roll posts { category } to /api/randomizer behind
 * the registry-priced spend confirmation (100 VB), a decline
 * rolls nothing, a 402 lands in the out-of-Bucs state. Copy
 * rides the page's catalog namespace (randomizer.*).
 */
import { useState } from "react";
import { Check, Clapperboard, Compass, Copy, Dices, Flame, Image as ImageIcon, Loader2, Music, Sparkles, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, plainErrorText } from "@/lib/api-error";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import {
  RANDOMIZER_CATEGORIES,
  RANDOMIZER_FEATURE,
  RANDOMIZER_PATH,
  buildRandomizerPayload,
  freeRollIdea,
  randomizerCost,
  randomizerIdeasOf,
  type RandomizerCategory,
} from "@/lib/world/randomizer-bench";

const CATEGORY_ICONS: Record<RandomizerCategory, LucideIcon> = {
  "video-ideas": Clapperboard,
  hooks: Zap,
  thumbnails: ImageIcon,
  "song-concepts": Music,
  "niche-picker": Compass,
  challenges: Flame,
};

function CopyLine({ text, isLight }: { text: string; isLight: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-start gap-2">
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        aria-label={t("worldBenches300.copyLabel")}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }).catch(() => {});
        }}
        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold bdv-touch-box ${
          isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/70"
        }`}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

export function RandomizerBench({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const { user, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [category, setCategory] = useState<RandomizerCategory>("video-ideas");
  const [freeIdea, setFreeIdea] = useState<string | null>(null);
  const [aiIdeas, setAiIdeas] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = randomizerCost();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";

  function selectCategory(key: RandomizerCategory) {
    setCategory(key);
    setFreeIdea(null);
    setAiIdeas([]);
    setError(null);
    setOutOfCredits(false);
  }

  function freeRoll() {
    setFreeIdea(freeRollIdea(category, freeIdea ?? undefined));
  }

  async function aiRoll() {
    if (aiLoading || !user) return;
    setAiLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(RANDOMIZER_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRandomizerPayload(category)),
      });
      if (!res) return; // spend confirmation declined — nothing rolled
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      const ideas = randomizerIdeasOf(data);
      if (!res.ok || !ideas) {
        throw new Error(apiErrorMessage(data, t("randomizer.error.aiRollFailed")));
      }
      setAiIdeas(ideas);
      refreshProfile();
    } catch (err) {
      setError(plainErrorText(err, t("randomizer.error.aiRollFailed")));
    } finally {
      setAiLoading(false);
    }
  }

  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;

  return (
    <div className="space-y-3" data-testid="world-randomizer-bench">
      <div className="flex items-center gap-2">
        <Dices className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
        <p className={`text-base font-black ${strong}`}>
          {t("randomizer.titlePrefix")} {t("randomizer.titleSuffix")}
        </p>
        <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
          {t("randomizer.badge")}
        </span>
      </div>
      <p className={`text-xs ${muted}`}>{t("randomizer.hero")}</p>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("randomizer.categoriesLabel")}>
        {RANDOMIZER_CATEGORIES.map((key) => {
          const Icon = CATEGORY_ICONS[key];
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={category === key}
              data-testid={`world-randomizer-cat-${key}`}
              onClick={() => selectCategory(key)}
              className={chipCls(category === key)}
            >
              <Icon className="h-3.5 w-3.5" /> {t(`randomizer.categories.${key}.label`)}
            </button>
          );
        })}
      </div>
      <p className={`text-xs ${muted}`}>{t(`randomizer.categories.${category}.blurb`)}</p>

      {/* The free roll — client-side, as ever. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="world-randomizer-free-roll"
          onClick={freeRoll}
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition bdv-touch-target ${
            isLight ? "border-[#7A5A12]/40 text-[#7A5A12] hover:bg-[#F7ECD2]" : "border-white/20 text-white hover:border-[#d4af37]/60"
          }`}
        >
          <Dices className="h-4 w-4" /> {t("randomizer.rollDice")}
        </button>
        <span className={`text-[11px] ${muted}`}>{t("randomizer.freeForever")}</span>
      </div>
      {freeIdea && (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-randomizer-free-result">
          <p className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>{t("randomizer.yourRoll")}</p>
          <p className={`mt-1 text-sm ${strong}`}><CopyLine text={freeIdea} isLight={isLight} /></p>
        </div>
      )}

      {/* The AI roll — confirmed spend, the registry's price. */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-xs font-semibold ${muted}`}>
          {t("randomizer.costPerRoll", { cost: cost.toLocaleString(i18n.language) })}
        </span>
        <button
          type="button"
          data-testid="world-randomizer-ai-roll"
          onClick={() => void aiRoll()}
          disabled={aiLoading || !user}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
        >
          {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {aiLoading
            ? t("randomizer.cooking")
            : aiIdeas.length > 0
              ? t("randomizer.reroll", { cost: cost.toLocaleString(i18n.language) })
              : t("randomizer.generateAi")}
        </button>
      </div>
      {!user && <p className={`text-xs ${muted}`}>{t("randomizer.signInToGenerate")}</p>}
      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldBenches300.outOfBucs", { feature: RANDOMIZER_FEATURE })}
        </p>
      )}
      {error && (
        <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
      )}

      {aiIdeas.length > 0 && (
        <div className="space-y-2" data-testid="world-randomizer-ai-result">
          <p className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>{t("randomizer.freshFromAi")}</p>
          {aiIdeas.map((idea, i) => (
            <p key={i} className={`rounded-xl border px-3 py-2 text-sm ${cardCls}`}>
              <CopyLine text={idea} isLight={isLight} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
