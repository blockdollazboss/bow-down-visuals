import { useEffect, useState } from "react";
import {
  Sparkles, Loader2, Copy, Check, MonitorPlay, Music2, Camera,
  RotateCcw, History, ChevronDown, Flame, Briefcase, Laugh,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  scoreColor,
  scoreBar,
  TITLE_STUDIO_HISTORY_KEY,
  TITLE_STUDIO_HISTORY_LIMIT,
  parseTitleStudioHistory,
  pushTitleStudioHistory,
  tagsCopyString,
} from "@/lib/title-studio";
import type { RankedTitle, TitleStudioHistoryEntry } from "@/lib/title-studio";

/* ─── Thy Cheat Code's Title & Description Studio ─────────────────────────
   One paid AI tool: type your video topic, pick a platform + tone, and GPT-6
   writes 10 click-ranked titles, a full description with timestamps/CTA
   template, and 15 platform-optimized tags — 1 credit per generation.
   History lives in localStorage (free, pure UI) so past runs are always
   reviewable without spending again. */

type PlatformKey = "youtube" | "tiktok" | "instagram";
type ToneKey = "hype" | "professional" | "funny";

interface PlatformOpt { key: PlatformKey; label: string; icon: LucideIcon; blurb: string }
interface ToneOpt { key: ToneKey; label: string; icon: LucideIcon; blurb: string }

const PLATFORMS: PlatformOpt[] = [
  { key: "youtube", label: "YouTube", icon: MonitorPlay, blurb: "Longer titles, long-form descriptions + timestamps" },
  { key: "tiktok", label: "TikTok", icon: Music2, blurb: "Short punchy packaging, hashtag-driven discovery" },
  { key: "instagram", label: "Instagram", icon: Camera, blurb: "Aesthetic short titles, Explore-ready hashtags" },
];

const TONES: ToneOpt[] = [
  { key: "hype", label: "Hype", icon: Flame, blurb: "High energy, bold claims" },
  { key: "professional", label: "Professional", icon: Briefcase, blurb: "Polished, confident, clean" },
  { key: "funny", label: "Funny", icon: Laugh, blurb: "Witty, playful, meme-aware" },
];

const CREDIT_COST = 1;

interface StudioResponse {
  titles?: RankedTitle[];
  description?: string;
  tags?: string[];
  note?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary hover:text-black"
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? "Copied" : `Copy ${label}`}
    </button>
  );
}

export default function TitleStudio() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState<PlatformKey>("youtube");
  const [tone, setTone] = useState<ToneKey>("hype");
  const [keywords, setKeywords] = useState("");
  const [result, setResult] = useState<StudioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [history, setHistory] = useState<TitleStudioHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setHistory(parseTitleStudioHistory(localStorage.getItem(TITLE_STUDIO_HISTORY_KEY)));
  }, []);

  function pushHistory(entry: Omit<TitleStudioHistoryEntry, "id" | "when">) {
    setHistory((prev) => {
      const next = pushTitleStudioHistory(prev, entry);
      try {
        localStorage.setItem(TITLE_STUDIO_HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* storage full — keep in-memory only */
      }
      return next;
    });
  }

  function handlePaidFailure(res: Response, data: { error?: string }): boolean {
    if (res.status === 402 || data.error === "out_of_credits") {
      setOutOfCredits(true);
      refreshProfile();
      return true;
    }
    return false;
  }

  async function generate() {
    if (loading || !user) return;
    if (!topic.trim()) {
      setError("Tell us what the video is about first.");
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/title-studio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          topic: topic.trim(),
          platform,
          tone,
          keywords: keywords.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as StudioResponse;
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || !Array.isArray(data.titles) || data.titles.length === 0 || !data.description) {
        throw new Error(data.message || data.error || "Packaging generation failed — try again.");
      }
      setResult(data);
      pushHistory({
        topic: topic.trim(),
        platform,
        tone,
        titles: data.titles,
        description: data.description,
        tags: data.tags ?? [],
      });
      refreshProfile();
      setTimeout(() => {
        document.getElementById("titles-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Packaging generation failed — try again.");
    } finally {
      setLoading(false);
    }
  }

  function loadFromHistory(entry: TitleStudioHistoryEntry) {
    setTopic(entry.topic);
    setPlatform(entry.platform);
    setTone(entry.tone);
    setResult({ titles: entry.titles, description: entry.description, tags: entry.tags });
    setShowHistory(false);
    setTimeout(() => {
      document.getElementById("titles-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  const selectedPlatform = PLATFORMS.find((p) => p.key === platform)!;
  const selectedTone = TONES.find((t) => t.key === tone)!;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="relative mx-auto max-w-4xl px-4 pb-24 pt-28 md:pt-32">
        <div className="text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            AI Packaging · {CREDIT_COST} credit
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Title <span className="text-primary">&amp;</span> Description Studio
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/55">
            Stop guessing what to name the video. Thy Cheat Code writes 10 click-ranked
            titles, a full description with timestamps and CTA, and 15 tags — tuned
            for the platform you're posting on.
          </p>
        </div>

        {/* history toggle */}
        {history.length > 0 && (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-white"
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              {history.length} past generation{history.length === 1 ? "" : "s"}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showHistory ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {showHistory && (
              <div className="mx-auto mt-3 max-w-xl space-y-2 text-left">
                {history.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => loadFromHistory(entry)}
                    className="block w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:border-primary/40"
                  >
                    <p className="truncate text-sm font-semibold text-white/90">{entry.topic}</p>
                    <p className="mt-0.5 text-[11px] uppercase tracking-widest text-white/35">
                      {entry.platform} · {entry.tone} · {new Date(entry.when).toLocaleDateString()}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* input card */}
        <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-black">What's the video about?</h2>
              <p className="text-xs text-white/45">One topic in, full packaging out.</p>
            </div>
          </div>

          <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/50" htmlFor="ts-topic">
            Video topic
          </label>
          <textarea
            id="ts-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            placeholder='e.g. "my new single about grinding at 3am" or "behind the scenes of my first studio session"'
            className={inputClass}
          />

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/50">Platform</p>
              <div className="grid gap-2">
                {PLATFORMS.map(({ key, label, icon: Icon, blurb }) => {
                  const selected = platform === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPlatform(key)}
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                        selected
                          ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                          : "border-white/10 bg-white/[0.03] hover:border-primary/40"
                      }`}
                    >
                      <Icon className={`h-5 w-5 shrink-0 ${selected ? "text-primary" : "text-white/50"}`} aria-hidden="true" />
                      <span>
                        <span className="block text-sm font-bold text-white/90">{label}</span>
                        <span className="block text-xs text-white/40">{blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/50">Tone</p>
              <div className="grid gap-2">
                {TONES.map(({ key, label, icon: Icon, blurb }) => {
                  const selected = tone === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTone(key)}
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                        selected
                          ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                          : "border-white/10 bg-white/[0.03] hover:border-primary/40"
                      }`}
                    >
                      <Icon className={`h-5 w-5 shrink-0 ${selected ? "text-primary" : "text-white/50"}`} aria-hidden="true" />
                      <span>
                        <span className="block text-sm font-bold text-white/90">{label}</span>
                        <span className="block text-xs text-white/40">{blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/50" htmlFor="ts-keywords">
              Keywords <span className="font-normal normal-case text-white/30">(optional)</span>
            </label>
            <input
              id="ts-keywords"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="e.g. shark king, new music, studio vlog"
              className={inputClass}
            />
          </div>

          <div className="mt-7 text-center">
            <button
              type="button"
              onClick={generate}
              disabled={loading || !user || !topic.trim()}
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  Cooking up titles…
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                  Generate Packaging · {CREDIT_COST} credit
                </>
              )}
            </button>
            {!user && (
              <p className="mt-3 text-xs text-white/40">Sign in to generate — browsing past runs is free.</p>
            )}
          </div>
        </div>

        {outOfCredits && (
          <div className="mt-6">
            <OutOfCredits />
          </div>
        )}

        {error && (
          <p className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
            {error}
          </p>
        )}

        {/* results */}
        {result && result.titles && result.titles.length > 0 && (
          <div id="titles-results" className="mt-8 space-y-8">
            {/* titles */}
            <section className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-black">
                  10 Titles <span className="text-sm font-semibold text-white/40">— ranked by clickability</span>
                </h2>
                <button
                  type="button"
                  onClick={generate}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Regenerate · {CREDIT_COST} credit
                </button>
              </div>
              <ol className="space-y-3">
                {result.titles.map((t, i) => (
                  <li
                    key={`title-${i}`}
                    className="flex items-start gap-3.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-primary/40"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-bold leading-snug text-white/95">{t.title}</p>
                      {t.why && <p className="mt-1 text-xs leading-relaxed text-white/45">{t.why}</p>}
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${scoreBar(t.score)}`}
                            style={{ width: `${t.score}%` }}
                          />
                        </div>
                        <span className={`text-xs font-black ${scoreColor(t.score)}`}>{t.score}</span>
                      </div>
                    </div>
                    <CopyButton text={t.title} label="title" />
                  </li>
                ))}
              </ol>
            </section>

            {/* description */}
            {result.description && (
              <section className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-black">
                    Description <span className="text-sm font-semibold text-white/40">— {selectedPlatform.label} ready</span>
                  </h2>
                  <CopyButton text={result.description} label="description" />
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed text-white/75">{result.description}</p>
              </section>
            )}

            {/* tags */}
            {result.tags && result.tags.length > 0 && (
              <section className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-black">
                    Tags <span className="text-sm font-semibold text-white/40">— {result.tags.length} optimized</span>
                  </h2>
                  <CopyButton text={tagsCopyString(result.tags)} label="all tags" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {result.tags.map((tag, i) => (
                    <button
                      key={`tag-${i}`}
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(`#${tag}`);
                      }}
                      title="Click to copy"
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-primary"
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {result.note && (
              <p className="text-center text-xs italic text-white/30">{result.note}</p>
            )}
          </div>
        )}

        {/* cross-link */}
        <p className="relative mt-8 text-center text-sm text-white/40">
          Titles locked in? Run them through the{" "}
          <span className="font-semibold text-primary">Hook Studio</span>{" "}
          pre-flight check before you post.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
