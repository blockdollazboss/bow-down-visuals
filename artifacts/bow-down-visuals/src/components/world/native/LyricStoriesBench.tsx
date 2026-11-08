/**
 * LyricStoriesBench — Lyric Stories' native bench at the
 * Hook Desk (Stack 300 world parity, census Lane B item 10 /
 * manifest item 103), stacked under the Hook Desk itself:
 * the Hooks page's "lyrics" tab, in the room.
 *
 * The section's own flow on its own rail (lib/world/
 * lyric-stories-bench.ts): paste lyrics, pick 3–5 cards and
 * an optional style, and the run — priced per card from the
 * registry (200 × cards) behind the spend confirmation —
 * paints a 9:16 story card per lyric moment. A partial run
 * shows the section's own refund note; a decline runs
 * nothing; a 402 lands in the out-of-Bucs state. Copy rides
 * the lyricStories.* namespace.
 */
import { useState } from "react";
import { BookOpen, Download, Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, plainErrorText } from "@/lib/api-error";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { DeskTextField, deskInputCls } from "./CreateDeskLeaf";
import {
  LYRIC_STORIES_DEFAULT_COUNT,
  LYRIC_STORIES_FEATURE,
  LYRIC_STORIES_LYRICS_MAX,
  LYRIC_STORIES_PATH,
  LYRIC_STORY_CARD_COUNTS,
  buildLyricStoriesPayload,
  clampLyricStoryCount,
  lyricStoriesInputReady,
  lyricStoriesResultOf,
  lyricStoriesTotalCost,
  lyricStoryCardCost,
  type LyricStoriesResult,
} from "@/lib/world/lyric-stories-bench";

export function LyricStoriesBench({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [lyrics, setLyrics] = useState("");
  const [count, setCount] = useState<number>(LYRIC_STORIES_DEFAULT_COUNT);
  const [style, setStyle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [result, setResult] = useState<LyricStoriesResult | null>(null);

  const totalCost = lyricStoriesTotalCost(count);
  const ready = lyricStoriesInputReady(lyrics);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const labelCls = `mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;

  async function generate() {
    if (!ready || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    try {
      const res = await confirmedFetch(LYRIC_STORIES_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: totalCost,
        overrideFeature: LYRIC_STORIES_FEATURE,
        body: JSON.stringify(buildLyricStoriesPayload({ lyrics, count, style })),
      });
      if (!res) return; // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      const parsed = lyricStoriesResultOf(data);
      if (!res.ok || !parsed) {
        throw new Error(apiErrorMessage(data, t("lyricStories.failed")));
      }
      setResult(parsed);
      refreshProfile();
    } catch (e) {
      setError(plainErrorText(e, t("lyricStories.failed")));
    } finally {
      setLoading(false);
    }
  }

  const countChipCls = (active: boolean) =>
    `rounded-xl border px-4 py-2 text-sm font-black transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/60 hover:text-white"
    }`;

  return (
    <div className="space-y-3" data-testid="world-lyric-stories-bench">
      <div className="flex items-center gap-2">
        <BookOpen className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
        <p className={`text-base font-black ${strong}`}>{t("lyricStories.title")}</p>
        <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
          {t("lyricStories.cost")}
        </span>
      </div>
      <p className={`text-xs ${muted}`}>{t("lyricStories.desc")}</p>

      <label className="block">
        <span className={labelCls}>{t("lyricStories.lyricsLabel")}</span>
        <textarea
          aria-label={t("lyricStories.lyricsLabel")}
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value.slice(0, LYRIC_STORIES_LYRICS_MAX))}
          placeholder={t("lyricStories.lyricsPh")}
          className={`${deskInputCls(isLight)} min-h-[120px] resize-y`}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className={labelCls}>{t("lyricStories.countLabel")}</span>
          <div className="flex gap-2">
            {LYRIC_STORY_CARD_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                data-testid={`world-lyric-stories-count-${n}`}
                onClick={() => setCount(clampLyricStoryCount(n))}
                className={countChipCls(count === n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <DeskTextField
          isLight={isLight}
          label={t("lyricStories.styleLabel")}
          value={style}
          onChange={setStyle}
          placeholder={t("lyricStories.stylePh")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-xs font-semibold ${muted}`}>
          {lyricStoryCardCost().toLocaleString(i18n.language)} VB × {count}
        </span>
        <button
          type="button"
          data-testid="world-lyric-stories-run"
          onClick={() => void generate()}
          disabled={loading || !ready}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t("lyricStories.generate", { count, cost: totalCost.toLocaleString(i18n.language) })}
        </button>
      </div>
      {loading && <p className={`text-xs ${muted}`}>{t("lyricStories.working")}</p>}
      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldBenches300.outOfBucs", { feature: LYRIC_STORIES_FEATURE })}
        </p>
      )}
      {error && (
        <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
      )}

      {result && (
        <div data-testid="world-lyric-stories-results">
          {result.partial && (
            <p className={`mb-2 text-xs ${isLight ? "text-[#92600a]" : "text-amber-300/80"}`}>
              {t("lyricStories.partial")}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {result.cards.map((card, i) => (
              <div
                key={i}
                className={`overflow-hidden rounded-2xl border ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-black/40"}`}
              >
                <img src={card.imageUrl} alt={card.lyricExcerpt} className="aspect-[9/16] w-full object-cover" />
                <div className="p-2.5">
                  <p className={`text-xs font-bold leading-snug ${strong}`}>“{card.lyricExcerpt}”</p>
                  <a
                    href={card.imageUrl}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"} hover:underline`}
                  >
                    <Download className="h-3 w-3" /> {t("lyricStories.download")}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
