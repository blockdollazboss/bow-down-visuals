import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Loader2, Sparkles, Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── Lyric Stories ────────────────────────────────────────────────────────
   Content hub (/hooks) tab. Paste song lyrics — AI splits them into
   story-card moments and generates 9:16 images for each via the existing
   image pipeline. 2 VB per card (3–5 cards). */

const COST_PER_CARD = 2;

interface StoryCard {
  lyricExcerpt: string;
  imageUrl: string;
  visualDescription: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export default function LyricStoriesSection() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [lyrics, setLyrics] = useState("");
  const [count, setCount] = useState("4");
  const [style, setStyle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [cards, setCards] = useState<StoryCard[]>([]);
  const [partial, setPartial] = useState(false);

  const totalCost = COST_PER_CARD * Math.max(3, Math.min(5, parseInt(count, 10) || 4));

  async function generate() {
    if (!lyrics.trim() || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setPartial(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/lyric-stories/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: totalCost,
        overrideFeature: "Lyric Stories",
        body: JSON.stringify({
          lyrics: lyrics.trim(),
          count: Math.max(3, Math.min(5, parseInt(count, 10) || 4)),
          style: style.trim(),
        }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as {
        cards?: StoryCard[]; partial?: boolean; error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.cards?.length) throw new Error(data.message || "Generation failed.");
      setCards(data.cards);
      setPartial(!!data.partial);
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-black text-white">{t("lyricStories.title", { defaultValue: "Lyric Stories" })}</h3>
          <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
            {t("lyricStories.cost", { defaultValue: "2 VB / card" })}
          </span>
        </div>
        <p className="text-sm text-white/50 mb-6">
          {t("lyricStories.desc", { defaultValue: "Turn your lyrics into a visual story-card series — 9:16 images sized for IG/TikTok stories." })}
        </p>

        <div className="mb-4">
          <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("lyricStories.lyricsLabel", { defaultValue: "Song lyrics *" })}
          </label>
          <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)}
            placeholder={t("lyricStories.lyricsPh", { defaultValue: "Paste your lyrics…" })}
            className={`${inputClass} mt-1.5 min-h-[140px] resize-y`} maxLength={3000} />
        </div>

        <div className="grid gap-4 md:grid-cols-2 mb-2">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("lyricStories.countLabel", { defaultValue: "Cards (3–5)" })}
            </label>
            <div className="flex gap-2 mt-1.5">
              {[3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setCount(String(n))}
                  className={`rounded-xl border px-5 py-2 text-sm font-black transition ${count === String(n) ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-white/55 hover:text-white"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("lyricStories.styleLabel", { defaultValue: "Visual style (optional)" })}
            </label>
            <input value={style} onChange={(e) => setStyle(e.target.value)}
              placeholder={t("lyricStories.stylePh", { defaultValue: "e.g. cinematic gold, anime…" })}
              className={`${inputClass} mt-1.5`} maxLength={120} />
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}

        <button type="button" onClick={generate} disabled={loading || !lyrics.trim()}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t("lyricStories.generate", { defaultValue: `Generate ${count} Cards (${totalCost} VB)` })}
        </button>
        {loading && (
          <p className="mt-3 text-xs text-white/40">{t("lyricStories.working", { defaultValue: "Painting your story cards — this takes a minute…" })}</p>
        )}
      </div>

      {cards.length > 0 && (
        <div>
          {partial && (
            <p className="mb-3 text-xs text-amber-300/80">
              {t("lyricStories.partial", { defaultValue: "Some cards failed and were refunded — showing what succeeded." })}
            </p>
          )}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {cards.map((card, i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                {card.imageUrl && <img src={card.imageUrl} alt={card.lyricExcerpt} className="aspect-[9/16] w-full object-cover" />}
                <div className="p-3">
                  <p className="text-xs font-bold text-white leading-snug">“{card.lyricExcerpt}”</p>
                  <a href={card.imageUrl} download target="_blank" rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline">
                    <Download className="h-3 w-3" /> {t("lyricStories.download", { defaultValue: "Save" })}
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
