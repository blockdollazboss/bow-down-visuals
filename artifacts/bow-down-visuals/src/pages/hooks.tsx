import { useState, useEffect } from "react";
import { Link } from "wouter";
import CommentToVideoSection from "@/components/hooks/CommentToVideoSection";
import {
 Zap, Gauge, Loader2, Sparkles, ArrowRight, Megaphone,
 Clapperboard, Film, GraduationCap, Wrench, CheckCircle2, AlertTriangle,
 MousePointerClick, Copy, Check, PenLine, Type, MonitorPlay, Music2,
 Camera, RotateCcw, History, ChevronDown, Flame, Briefcase, Laugh,
 CalendarDays, Dices, Lightbulb, Image as ImageIcon, Music, Compass, Captions,
 MessageSquareReply,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import ScriptWriter from "@/pages/script-writer";
import CaptionStyler from "@/pages/caption-styler";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";
import { useHubProject } from "@/lib/hub-project";
import { getHookTemplate } from "@/data/hook-templates";
import { getCaptionPack } from "@/data/caption-templates";
import HookRewriter from "@/components/wave8/HookRewriter";
import {
 scoreColor as titleScoreColor,
 scoreBar as titleScoreBar,
 TITLE_STUDIO_HISTORY_KEY,
 parseTitleStudioHistory,
 pushTitleStudioHistory,
 tagsCopyString,
} from "@/lib/title-studio";
import type { RankedTitle, TitleStudioHistoryEntry } from "@/lib/title-studio";

/* ─── Thy Cheat Code's Hook Studio ────────────────────────────────────────
 Two money tools on one page: the Hook Generator (first-3-second openers)
 and the Virality Pre-flight (honest viral-READINESS scorecard — never a
 virality guarantee). Both POST to /api/hook-studio at 1 credit per
 generation on GPT-6 Sol. Video-type keys must stay in sync with the
 backend route's VIDEO_TYPES enum. */

type TabKey = "hooks" | "preflight" | "captions" | "cta" | "titles" | "dice" | "scripts" | "styler" | "comments";

type CtaGoalKey = "subscribe" | "comment" | "share" | "follow" | "buy" | "stream";

const CTA_GOALS: CtaGoalKey[] = ["subscribe", "comment", "share", "follow", "buy", "stream"];

const CTA_PLATFORMS = ["tiktok", "instagram", "youtube", "twitter", "facebook"] as const;

type PlacementKey = "opener" | "mid-roll" | "closer" | "pinned-comment";

interface CtaVariant {
 text: string;
 placement: PlacementKey;
 strength: number;
}

const CTA_CREDIT_COST = 50;

type VideoTypeKey = "music-promo" | "behind-the-scenes" | "tutorial" | "announcement";

interface VideoType {
 key: VideoTypeKey;
 icon: LucideIcon;
}

const VIDEO_TYPES: VideoType[] = [
 { key: "music-promo", icon: Megaphone },
 { key: "behind-the-scenes", icon: Film },
 { key: "tutorial", icon: GraduationCap },
 { key: "announcement", icon: Clapperboard },
];

const CREDIT_COST = 1;

interface HooksResponse {
 hooks?: string[];
 creditsUsed?: number;
 creditsRemaining?: number;
 error?: string;
 message?: string;
}

interface ScoreCheck {
 label: string;
 score: number;
 fix: string;
}

interface PreflightResponse {
 score?: number;
 verdict?: string;
 disclaimer?: string;
 checks?: ScoreCheck[];
 creditsUsed?: number;
 creditsRemaining?: number;
 error?: string;
 message?: string;
}

interface CaptionsResponse {
 captions?: string[];
 hashtags?: { niche?: string[]; broad?: string[]; trending?: string[] };
 cta?: string;
 creditsUsed?: number;
 creditsRemaining?: number;
 error?: string;
 message?: string;
}

interface CtaResponse {
 ctas?: CtaVariant[];
 creditsUsed?: number;
 creditsRemaining?: number;
 error?: string;
 message?: string;
}

function scoreColor(score: number): string {
 if (score >= 75) return "text-emerald-400";
 if (score >= 50) return "text-amber-400";
 return "text-red-400";
}

function scoreBar(score: number): string {
 if (score >= 75) return "from-emerald-500 to-emerald-300";
 if (score >= 50) return "from-amber-500 to-amber-300";
 return "from-red-500 to-red-300";
}

const inputClass =
 "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

/* ─── Titles tab (merged from the Title & Description Studio page) ──────
   One paid AI tool: type a video topic, pick a platform + tone, and GPT-6
   writes 10 click-ranked titles, a full description with timestamps/CTA
   template, and 15 platform-optimized tags — 1 credit per generation
   (POST /api/title-studio; registry key "/api/title-studio").
   History lives in localStorage (free, pure UI). Keeps its → /scheduler
   handoff. The Hook Rewriter (Wave 8) stays fully intact elsewhere on
   this page — nothing there was touched. */

type TitlePlatformKey = "youtube" | "tiktok" | "instagram";
type TitleToneKey = "hype" | "professional" | "funny";

interface TitlePlatformOpt { key: TitlePlatformKey; labelKey: string; icon: LucideIcon; blurbKey: string }
interface TitleToneOpt { key: TitleToneKey; labelKey: string; icon: LucideIcon; blurbKey: string }

const TITLE_PLATFORMS: TitlePlatformOpt[] = [
 { key: "youtube", labelKey: "titles.platformYouTube", icon: MonitorPlay, blurbKey: "titles.platformYouTubeBlurb" },
 { key: "tiktok", labelKey: "titles.platformTikTok", icon: Music2, blurbKey: "titles.platformTikTokBlurb" },
 { key: "instagram", labelKey: "titles.platformInstagram", icon: Camera, blurbKey: "titles.platformInstagramBlurb" },
];

const TITLE_TONES: TitleToneOpt[] = [
 { key: "hype", labelKey: "titles.toneHype", icon: Flame, blurbKey: "titles.toneHypeBlurb" },
 { key: "professional", labelKey: "titles.toneProfessional", icon: Briefcase, blurbKey: "titles.toneProfessionalBlurb" },
 { key: "funny", labelKey: "titles.toneFunny", icon: Laugh, blurbKey: "titles.toneFunnyBlurb" },
];

const TITLE_CREDIT_COST = 1;

interface TitleStudioResponse {
 titles?: RankedTitle[];
 description?: string;
 tags?: string[];
 note?: string;
 creditsUsed?: number;
 creditsRemaining?: number;
 error?: string;
 message?: string;
}

function TitleCopyButton({ text, label }: { text: string; label: string }) {
 const { t } = useTranslation();
 const [copied, setCopied] = useState(false);
 return (
 <button
 type="button"
 aria-label={t("titles.copyAria", { label })}
 onClick={() => {
 void navigator.clipboard.writeText(text).then(() => {
 setCopied(true);
 setTimeout(() => setCopied(false), 1400);
 });
 }}
 className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary hover:text-black"
 >
 {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
 {copied ? t("titles.copied") : t("titles.copyButton", { label })}
 </button>
 );
}

function TitlesTab() {
 const { t } = useTranslation();
 const { user, getAccessToken, refreshProfile } = useAuth();
 const { confirmedFetch } = useConfirmedApi();
 const { addAsset } = useHubProject();
 const [topic, setTopic] = useState("");
 const [platform, setPlatform] = useState<TitlePlatformKey>("youtube");
 const [tone, setTone] = useState<TitleToneKey>("hype");
 const [keywords, setKeywords] = useState("");
 const [result, setResult] = useState<TitleStudioResponse | null>(null);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [outOfCredits, setOutOfCredits] = useState(false);
 const [history, setHistory] = useState<TitleStudioHistoryEntry[]>([]);
 const [showHistory, setShowHistory] = useState(false);

 useEffect(() => {
 setHistory(parseTitleStudioHistory(localStorage.getItem(TITLE_STUDIO_HISTORY_KEY)));
 /* Deep-link: ?tab=titles&topic=<text> prefills the topic. */
 try {
 const params = new URLSearchParams(window.location.search);
 const topicParam = params.get("topic")?.trim().slice(0, 300);
 if (topicParam) setTopic(topicParam);
 } catch {
 /* non-browser or malformed URL — ignore */
 }
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
 setError(t("titles.topicRequired"));
 return;
 }
 setLoading(true);
 setError(null);
 setOutOfCredits(false);
 try {
 const token = await getAccessToken();
 const res = await confirmedFetch("/api/title-studio", {
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
 if (!res) return; // user cancelled the credit confirmation (finally resets state)
 const data = (await res.json().catch(() => ({}))) as TitleStudioResponse;
 if (handlePaidFailure(res, data)) return;
 if (!res.ok || !Array.isArray(data.titles) || data.titles.length === 0 || !data.description) {
 throw new Error(data.message || data.error || t("titles.generationFailed"));
 }
 setResult(data);
 /* The title pack flows into the hub project — scheduler and hooks pick it up. */
 try {
 addAsset({
 kind: "other",
 url: `data:text/plain;charset=utf-8,${encodeURIComponent(data.titles.join("\n"))}`,
 label: `Title pack — ${topic.trim().slice(0, 50)}`,
 detail: `${platform} · ${data.titles.length} titles`,
 meta: { titles: data.titles.join("\n"), description: data.description, tags: (data.tags ?? []).join(" "), topic: topic.trim() },
 });
 } catch { /* hub unavailable — non-fatal */ }
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
 setError(err instanceof Error ? err.message : t("titles.generationFailed"));
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

 const selectedPlatform = TITLE_PLATFORMS.find((p) => p.key === platform)!;

 return (
 <div className="relative mt-8">
 {/* history toggle */}
 {history.length > 0 && (
 <div className="text-center">
 <button
 type="button"
 onClick={() => setShowHistory((v) => !v)}
 className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-white"
 >
 <History className="h-3.5 w-3.5" aria-hidden="true" />
 {t("titles.pastGenerations", { count: history.length })}
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
 <div className="relative mt-6 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
 <div className="mb-6 flex items-center gap-3">
 <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
 <Sparkles className="h-5 w-5" aria-hidden="true" />
 </span>
 <div>
 <h2 className="text-lg font-black">{t("titles.topicHeading")}</h2>
 <p className="text-xs text-white/45">{t("titles.topicSub")}</p>
 </div>
 </div>

 <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/50" htmlFor="ts-topic">{t("titles.topicLabel")}</label>
 <textarea
 id="ts-topic"
 value={topic}
 onChange={(e) => setTopic(e.target.value)}
 rows={3}
 placeholder={t("titles.topicPlaceholder")}
 className={inputClass}
 />

 <div className="mt-5 grid gap-5 md:grid-cols-2">
 <div>
 <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/50">{t("titles.platformLabel")}</p>
 <div className="grid gap-2">
 {TITLE_PLATFORMS.map(({ key, labelKey, icon: Icon, blurbKey }) => {
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
 <span className="block text-sm font-bold text-white/90">{t(labelKey)}</span>
 <span className="block text-xs text-white/40">{t(blurbKey)}</span>
 </span>
 </button>
 );
 })}
 </div>
 </div>

 <div>
 <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/50">{t("titles.toneLabel")}</p>
 <div className="grid gap-2">
 {TITLE_TONES.map(({ key, labelKey, icon: Icon, blurbKey }) => {
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
 <span className="block text-sm font-bold text-white/90">{t(labelKey)}</span>
 <span className="block text-xs text-white/40">{t(blurbKey)}</span>
 </span>
 </button>
 );
 })}
 </div>
 </div>
 </div>

 <div className="mt-5">
 <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/50" htmlFor="ts-keywords">{t("titles.keywordsLabel")}<span className="font-normal normal-case text-white/30">{t("titles.optionalNote")}</span>
 </label>
 <input
 id="ts-keywords"
 value={keywords}
 onChange={(e) => setKeywords(e.target.value)}
 placeholder={t("titles.keywordsPlaceholder")}
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
 <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />{t("titles.cooking")}</>
 ) : (
 <>
 <Sparkles className="h-5 w-5" aria-hidden="true" />
 {t("titles.generateButton", { cost: TITLE_CREDIT_COST })}
 </>
 )}
 </button>
 {!user && (
 <p className="mt-3 text-xs text-white/40">{t("titles.signInPrompt")}</p>
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
 {t("titles.titlesHeading")} <span className="text-sm font-semibold text-white/40">{t("titles.titlesSub")}</span>
 </h2>
 <button
 type="button"
 onClick={generate}
 disabled={loading}
 className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
 >
 <RotateCcw className="h-4 w-4" aria-hidden="true" />
 {t("titles.regenerateButton", { cost: TITLE_CREDIT_COST })}
 </button>
 <Link
 href="/scheduler"
 className="inline-flex items-center gap-2 rounded-2xl border border-white/15 px-5 py-2.5 text-sm font-bold text-white/70 transition hover:border-white/30 hover:text-white"
 >
 <CalendarDays className="h-4 w-4" aria-hidden="true" />
 {t("titles.sendToScheduler", { defaultValue: "Send to scheduler" })}
 </Link>
 </div>
 <ol className="space-y-3">
 {result.titles.map((item, i) => (
 <li
 key={`title-${i}`}
 className="flex items-start gap-3.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-primary/40"
 >
 <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
 {i + 1}
 </span>
 <div className="min-w-0 flex-1">
 <p className="text-[15px] font-bold leading-snug text-white/95">{item.title}</p>
 {item.why && <p className="mt-1 text-xs leading-relaxed text-white/45">{item.why}</p>}
 <div className="mt-2 flex items-center gap-2">
 <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
 <div
 className={`h-full rounded-full bg-gradient-to-r ${titleScoreBar(item.score)}`}
 style={{ width: `${item.score}%` }}
 />
 </div>
 <span className={`text-xs font-black ${titleScoreColor(item.score)}`}>{item.score}</span>
 </div>
 </div>
 <TitleCopyButton text={item.title} label={t("titles.titleCopyLabel")} />
 </li>
 ))}
 </ol>
 </section>

 {/* description */}
 {result.description && (
 <section className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
 <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
 <h2 className="text-lg font-black">
 {t("titles.descriptionHeading")} <span className="text-sm font-semibold text-white/40">{t("titles.descriptionReady", { platform: t(selectedPlatform.labelKey) })}</span>
 </h2>
 <TitleCopyButton text={result.description} label={t("titles.descriptionCopyLabel")} />
 </div>
 <p className="whitespace-pre-line text-sm leading-relaxed text-white/75">{result.description}</p>
 </section>
 )}

 {/* tags */}
 {result.tags && result.tags.length > 0 && (
 <section className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
 <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
 <h2 className="text-lg font-black">
 {t("titles.tagsHeading")} <span className="text-sm font-semibold text-white/40">{t("titles.tagsOptimized", { count: result.tags.length })}</span>
 </h2>
 <TitleCopyButton text={tagsCopyString(result.tags)} label={t("titles.allTagsCopyLabel")} />
 </div>
 <div className="flex flex-wrap gap-2">
 {result.tags.map((tag, i) => (
 <button
 key={`tag-${i}`}
 type="button"
 onClick={() => {
 void navigator.clipboard.writeText(`#${tag}`);
 }}
 title={t("titles.clickToCopy")}
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
 {t("titles.crossLinkBefore")}{" "}
 <span className="font-semibold text-primary">{t("titles.crossLinkHook")}</span>{" "}
 {t("titles.crossLinkAfter")}
 </p>
 </div>
 );
}

/* ─── Dice tab (merged from the Content Randomizer page) ─────────────────
   Thy Cheat Code's Content Randomizer: the free dice roll is 100% client-side
   (zero server cost). The "Generate 5 fresh with AI" button POSTs to
   /api/randomizer (1 credit per roll, GPT-6 Sol). Category keys must stay in
   sync with the backend route's CATEGORIES enum. */
/* ─── Thy Cheat Code's Content Randomizer ─────────────────────────────────
 Public teaser page: the free dice roll is 100% client-side (zero server
 cost). The "Generate 5 fresh with AI" button POSTs to /api/randomizer
 (1 credit per roll, GPT-6 Sol). Category keys must stay in sync with the
 backend route's CATEGORIES enum. */

type CategoryKey =
 | "video-ideas"
 | "hooks"
 | "thumbnails"
 | "song-concepts"
 | "niche-picker"
 | "challenges";

interface Category {
 key: CategoryKey;
 icon: LucideIcon;
 freeIdeas: string[];
}

const CATEGORIES: Category[] = [
 {
 key: "video-ideas",
 icon: Clapperboard,
 freeIdeas: [
 "Day in the life of your artist persona — but every scene is a different music video set",
 "React to your own old songs and roast your past self",
 "Turn your song's lyrics into a 30-second movie trailer",
 "Film the same chorus in 5 wildly different locations, cut on the beat",
 "Behind-the-scenes of your AI video generation — show the prompts, show the magic",
 "POV: your song plays as the villain walks in slow motion",
 "Teach one bar of your verse, then challenge fans to flip it",
 "Green-screen yourself into famous album covers while your track plays",
 "Speedrun: write, record, and shoot a hook in 60 minutes",
 "Your song + a trending meme format = instant promo clip",
 "Acoustic-to-anthem: start stripped down, drop into the full mix",
 "Ask fans to pick your next single's cover art — then reveal the AI options",
 ],
 },
 {
 key: "hooks",
 icon: Zap,
 freeIdeas: [
 "Stop scrolling — this took 47 tries to get right",
 "POV: you just found your new favorite artist",
 "I bet you can't name this sample",
 "This song was made entirely by AI… or was it?",
 "Wait for the drop at 0:07",
 "Nobody talks about this part of being an independent artist",
 "I asked AI to finish my verse — here's what happened",
 "Your playlist is missing this",
 "This is what heartbreak sounds like in 2026",
 "One take. No edits. Full song.",
 "The label said no, so I did it myself",
 "Comment 'FIRE' and I'll drop the full version",
 ],
 },
 {
 key: "thumbnails",
 icon: ImageIcon,
 freeIdeas: [
 "Split face: calm on the left, full performance energy on the right",
 "Giant gold text over a dark stage — 3 words max",
 "Your artist portrait with a glowing crown, black background",
 "Before/after: rough demo vs. final master waveform",
 "Close-up of hands on the mic, dramatic side lighting",
 "Red circle + arrow pointing at the wildest frame of your video",
 "You vs. the AI: side-by-side portrait showdown",
 "Neon city backdrop, you silhouetted in the center",
 "Freeze the exact frame the beat drops — add shockwave lines",
 "Stacked polaroids of every look from the shoot",
 "Dark room, single spotlight, gold jewelry catching the light",
 "Big shocked expression + the song title in bold condensed type",
 ],
 },
 {
 key: "song-concepts",
 icon: Music,
 freeIdeas: [
 "An anthem about quitting your 9-to-5 to chase the dream",
 "A late-night R&B confession recorded like a voicemail",
 "Trap banger about your hometown finally getting its shine",
 "A diss track aimed at your own self-doubt",
 "Love song for the grind — romance between you and the hustle",
 "Drill track narrated like a nature documentary",
 "Gospel-tinged hook about making it out, verses pure street poetry",
 "A breakup song where the 'ex' is your old sound",
 "Party starter built around a viral dance challenge",
 "Storytelling rap: one verse, one night, one decision that changed everything",
 "Afrobeats fusion celebrating your roots",
 "Cinematic intro track for your alter ego's origin story",
 ],
 },
 {
 key: "niche-picker",
 icon: Compass,
 freeIdeas: [
 "AI music video director — you make other artists' visuals",
 "The sample detective — you find and flip obscure samples on camera",
 "One-song-a-day challenger — relentless output niche",
 "Genre-blender — you fuse two genres nobody combined before",
 "The hook doctor — you fix weak choruses live",
 "Behind-the-beat educator — you teach production with personality",
 "Character artist — every release is a new persona with lore",
 "Hometown hero documentarian — you put your city on the map",
 "AI vs. human collaborator — every song is a man-vs-machine duel",
 "The remix royalty — you flip trending sounds weekly",
 "Lyric breakdown analyst — you decode bars like film theory",
 "Tiny-desk-style intimate performer — raw, no production hiding",
 ],
 },
 {
 key: "challenges",
 icon: Flame,
 freeIdeas: [
 "Post one clip every day for 30 days — no excuses",
 "Make a song using only sounds from your kitchen",
 "Let your comments pick your next beat — then deliver in 48 hours",
 "Recreate a viral video shot-for-shot with your own twist",
 "Go live and write a verse with chat voting on every bar",
 "Drop a 15-second teaser every day for a week before release",
 "Collab with a creator you've never met — full song in one stream",
 "Perform your song in the weirdest location you can find",
 "Flip the same sample 3 different ways in 3 videos",
 "Teach a fan your chorus over video call, post their attempt",
 "No-face challenge: promote a song for a week without showing your face",
 "Speedrun your entire release rollout in 24 hours",
 ],
 },
];

const AI_CREDIT_COST = 1;

interface RandomizerResponse {
 ideas?: string[];
 creditsUsed?: number;
 creditsRemaining?: number;
 error?: string;
 message?: string;
}

function pickRandom<T>(items: T[], except?: T): T {
 if (items.length === 1) return items[0];
 let pick = items[Math.floor(Math.random() * items.length)];
 let guard = 0;
 while (pick === except && guard++ < 10) {
 pick = items[Math.floor(Math.random() * items.length)];
 }
 return pick;
}

function RandomizerDice() {
 const { t } = useTranslation();
 const { user, getAccessToken, refreshProfile } = useAuth();
 const { confirmedFetch } = useConfirmedApi();
 const [activeKey, setActiveKey] = useState<CategoryKey>("video-ideas");
 const [freeIdea, setFreeIdea] = useState<string | null>(null);
 const [aiIdeas, setAiIdeas] = useState<string[]>([]);
 const [aiLoading, setAiLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [outOfCredits, setOutOfCredits] = useState(false);

 const active = CATEGORIES.find((c) => c.key === activeKey)!;
 const ActiveIcon = active.icon;

 function selectCategory(key: CategoryKey) {
 setActiveKey(key);
 setFreeIdea(null);
 setAiIdeas([]);
 setError(null);
 setOutOfCredits(false);
 }

 function freeRoll() {
 const cat = CATEGORIES.find((c) => c.key === activeKey)!;
 setFreeIdea(pickRandom(cat.freeIdeas, freeIdea ?? undefined));
 }

 async function aiRoll() {
 if (aiLoading || !user) return;
 setAiLoading(true);
 setError(null);
 setOutOfCredits(false);
 try {
 const token = await getAccessToken();
 const res = await confirmedFetch("/api/randomizer", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 ...(token ? { Authorization: `Bearer ${token}` } : {}),
 },
 body: JSON.stringify({ category: activeKey }),
 });
 if (!res) return; // user cancelled the credit confirmation (finally resets state)
 const data = (await res.json().catch(() => ({}))) as RandomizerResponse;
 if (res.status === 402 || data.error === "out_of_credits") {
 setOutOfCredits(true);
 refreshProfile();
 return;
 }
 if (!res.ok || !Array.isArray(data.ideas) || data.ideas.length === 0) {
 throw new Error(data.message || data.error || t("randomizer.error.aiRollFailed"));
 }
 setAiIdeas(data.ideas);
 refreshProfile();
 setTimeout(() => {
 document.getElementById("ai-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
 }, 100);
 } catch (err) {
 setError(err instanceof Error ? err.message : t("randomizer.error.aiRollFailed"));
 } finally {
 setAiLoading(false);
 }
 }

 return (
 <div className="relative mt-8">
 {/* glow */}
 <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 flex justify-center" aria-hidden="true">
 <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
 </div>

 {/* hero */}
 <div className="relative text-center">
 <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
 <Dices className="h-3 w-3" aria-hidden="true" /> {t("randomizer.badge")}
 </p>
 <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
 {t("randomizer.titlePrefix")} <span className="text-primary">{t("randomizer.titleSuffix")}</span>
 </h1>
 <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
 {t("randomizer.hero")}
 </p>
 </div>

 {/* category tabs */}
 <div className="relative mt-10 flex flex-wrap justify-center gap-2" role="tablist" aria-label={t("randomizer.categoriesLabel")}>
 {CATEGORIES.map((c) => {
 const Icon = c.icon;
 const selected = c.key === activeKey;
 return (
 <button
 key={c.key}
 role="tab"
 aria-selected={selected}
 onClick={() => selectCategory(c.key)}
 className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
 selected
 ? "bg-primary text-black shadow-[0_0_18px_rgba(212,175,55,0.35)]"
 : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
 }`}
 >
 <Icon className="h-4 w-4" aria-hidden="true" />
 {t(`randomizer.categories.${c.key}.label`)}
 </button>
 );
 })}
 </div>

 {/* main panel */}
 <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
 <div className="flex items-center gap-3">
 <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
 <ActiveIcon className="h-5 w-5" aria-hidden="true" />
 </span>
 <div>
 <h2 className="text-xl font-bold">{t(`randomizer.categories.${active.key}.label`)}</h2>
 <p className="text-sm text-white/45">{t(`randomizer.categories.${active.key}.blurb`)}</p>
 </div>
 </div>

 {/* free roll */}
 <div className="mt-8 text-center">
 <button
 onClick={freeRoll}
 className="group inline-flex items-center gap-2.5 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95"
 >
 <Dices className="h-6 w-6 transition group-hover:rotate-12" aria-hidden="true" />
 {t("randomizer.rollDice")}
 </button>
 <p className="mt-2.5 text-xs text-white/35">{t("randomizer.freeForever")}</p>

 {freeIdea && (
 <div className="mx-auto mt-6 max-w-xl rounded-2xl border border-primary/30 bg-black/60 p-5 text-left">
 <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
 <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> {t("randomizer.yourRoll")}
 </p>
 <p className="text-[15px] leading-relaxed text-white/90">{freeIdea}</p>
 </div>
 )}
 </div>

 {/* divider */}
 <div className="my-8 flex items-center gap-4" aria-hidden="true">
 <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
 <span className="text-[11px] font-bold uppercase tracking-widest text-white/30">{t("randomizer.orDeeper")}</span>
 <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
 </div>

 {/* AI roll */}
 <div className="text-center">
 {user ? (
 <button
 onClick={aiRoll}
 disabled={aiLoading}
 className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-6 py-3.5 text-base font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
 >
 {aiLoading ? (
 <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
 ) : (
 <Sparkles className="h-5 w-5" aria-hidden="true" />
 )}
 {aiLoading ? t("randomizer.cooking") : t("randomizer.generateAi")}
 </button>
 ) : (
 <Link
 href="/login"
 className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-6 py-3.5 text-base font-bold text-primary transition hover:bg-primary hover:text-black"
 >
 <Sparkles className="h-5 w-5" aria-hidden="true" />
 {t("randomizer.signInToGenerate")}
 <ArrowRight className="h-4 w-4" aria-hidden="true" />
 </Link>
 )}
 <p className="mt-2.5 text-xs text-white/35">
 {t("randomizer.costPerRoll", { cost: AI_CREDIT_COST })}
 </p>
 {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
 {error && !outOfCredits && (
 <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
 {error}
 </p>
 )}
 </div>

 {/* AI results */}
 {aiIdeas.length > 0 && (
 <div id="ai-results" className="mt-8">
 <div className="mb-4 flex items-center justify-between">
 <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
 <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t("randomizer.freshFromAi")}
 </p>
 {user && (
 <button
 onClick={aiRoll}
 disabled={aiLoading}
 className="flex items-center gap-1.5 rounded-full border border-primary/40 px-3.5 py-1.5 text-xs font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
 >
 <Dices className="h-3.5 w-3.5" aria-hidden="true" />
 {t("randomizer.reroll", { cost: AI_CREDIT_COST })}
 </button>
 )}
 </div>
 <div className="grid gap-3 sm:grid-cols-2">
 {aiIdeas.map((idea, i) => (
 <div
 key={`${activeKey}-${i}`}
 className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/40"
 >
 <p className="mb-1.5 text-[11px] font-black text-primary/70">#{i + 1}</p>
 <p className="text-sm leading-relaxed text-white/85">{idea}</p>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>

 {/* cross-link */}
 <p className="relative mt-8 text-center text-sm text-white/40">
 {t("randomizer.crossLink.p1")}{" "}
 <span className="font-semibold text-primary">{t("randomizer.crossLink.name")}</span>{" "}
 {t("randomizer.crossLink.p2")}
 </p>
 </div>
 );
}

export default function HookStudio() {
 const { t } = useTranslation();
 const { user, getAccessToken, refreshProfile } = useAuth();
 const { confirmedFetch } = useConfirmedApi();
 const [tab, setTab] = useState<TabKey>("hooks");
 const [mode, setMode] = useState<"simple" | "custom">("simple");

 /* hook generator state */
 const [videoType, setVideoType] = useState<VideoTypeKey>("music-promo");
 const [topic, setTopic] = useState("");

 /* One-click hook presets */
 const HOOK_PRESETS = [
   { label: "🎵 Song Promo", topic: "my new song", type: "music-promo" as VideoTypeKey },
   { label: "🎙️ Podcast Clip", topic: "podcast episode", type: "behind-the-scenes" as VideoTypeKey },
   { label: "📚 Tutorial", topic: "how to", type: "tutorial" as VideoTypeKey },
   { label: "📢 Announcement", topic: "big news", type: "announcement" as VideoTypeKey },
 ];
 const { project, addAsset } = useHubProject();
 useEffect(() => {
 if (!topic && project.name) setTopic(project.name);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [project.name]);

 /* Template deep-link: ?template=<slug> preloads the hook generator;
    ?tab=captions&template=<slug> preloads the caption writer.
    Used by the public template galleries (/templates/hooks, /templates/captions).
    Round-trip deep-link: ?topic=<text> on the hooks tab prefills the hook
    generator topic — used by the Competitor Tracker / Content Intelligence
    "generate ideas from this gap" handoffs so the gap travels with the creator. */
 useEffect(() => {
 try {
 const params = new URLSearchParams(window.location.search);
 const tabParam = params.get("tab");
 if (tabParam === "captions" || tabParam === "cta" || tabParam === "titles" || tabParam === "dice" || tabParam === "scripts" || tabParam === "styler" || tabParam === "comments") setTab(tabParam);
 const topicParam = params.get("topic")?.trim().slice(0, 300);
 /* Multi-ratio export handoff: ?tab=captions&platform=tiktok&topic=…
    pre-selects the platform and topic on the caption writer. */
 if (tabParam === "captions") {
 const platformParam = (params.get("platform") ?? "").toLowerCase();
 if (["tiktok", "instagram", "youtube", "twitter"].includes(platformParam)) {
 setCapPlatform(platformParam as "tiktok" | "instagram" | "youtube" | "twitter");
 }
 if (topicParam) setCapTopic(topicParam);
 } else if (topicParam) {
 setTopic(topicParam);
 }
 const slug = params.get("template");
 if (!slug) return;
 if (tabParam === "captions") {
 const pack = getCaptionPack(slug);
 if (!pack) return;
 setCapTopic(pack.topic);
 setCapPlatform(pack.platform);
 setCapTone(pack.tone);
 } else {
 const tpl = getHookTemplate(slug);
 if (!tpl) return;
 setVideoType(tpl.videoType);
 setTopic(tpl.topic);
 }
 } catch {
 /* non-browser or malformed URL — ignore */
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);
 const [hooks, setHooks] = useState<string[]>([]);
 const [hooksLoading, setHooksLoading] = useState(false);

 /* pre-flight state */
 const [title, setTitle] = useState("");
 const [caption, setCaption] = useState("");
 const [hashtags, setHashtags] = useState("");
 const [description, setDescription] = useState("");
 const [scorecard, setScorecard] = useState<PreflightResponse | null>(null);
 const [preflightLoading, setPreflightLoading] = useState(false);

 /* captions state */
 const [capTopic, setCapTopic] = useState("");
 const [capPlatform, setCapPlatform] = useState<"tiktok" | "instagram" | "youtube" | "twitter">("tiktok");
 const [capTone, setCapTone] = useState("");
 const [capResult, setCapResult] = useState<CaptionsResponse | null>(null);
 const [capLoading, setCapLoading] = useState(false);

 /* cta generator state */
 const [ctaTopic, setCtaTopic] = useState("");
 const [ctaGoal, setCtaGoal] = useState<CtaGoalKey>("subscribe");
 const [ctaPlatform, setCtaPlatform] = useState<(typeof CTA_PLATFORMS)[number]>("tiktok");
 const [ctaTone, setCtaTone] = useState("");
 const [ctas, setCtas] = useState<CtaVariant[]>([]);
 const [ctaLoading, setCtaLoading] = useState(false);
 const [scriptAdded, setScriptAdded] = useState<Record<number, boolean>>({});

 /* shared */
 const [error, setError] = useState<string | null>(null);
 const [outOfCredits, setOutOfCredits] = useState(false);

 function switchTab(next: TabKey) {
 setTab(next);
 setError(null);
 setOutOfCredits(false);
 }

 async function authedPost(endpoint: string, body: Record<string, unknown>) {
 const token = await getAccessToken();
 return confirmedFetch(endpoint, {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 ...(token ? { Authorization: `Bearer ${token}` } : {}),
 },
 body: JSON.stringify(body),
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

 async function generateHooks() {
 if (hooksLoading || !user) return;
 setHooksLoading(true);
 setError(null);
 setOutOfCredits(false);
 try {
 const res = await authedPost("/api/hook-studio", { mode: "hooks", videoType, topic: topic.trim() });
 if (!res) return; // user cancelled the credit confirmation (finally resets state)
 const data = (await res.json().catch(() => ({}))) as HooksResponse;
 if (handlePaidFailure(res, data)) return;
 if (!res.ok || !Array.isArray(data.hooks) || data.hooks.length === 0) {
 throw new Error(data.message || data.error || t("hooks.errHooksFailed"));
 }
 setHooks(data.hooks);
 refreshProfile();
 setTimeout(() => {
 document.getElementById("hooks-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
 }, 100);
 } catch (err) {
 setError(err instanceof Error ? err.message : t("hooks.errHooksFailed"));
 } finally {
 setHooksLoading(false);
 }
 }

 async function generateCaptions() {
 if (capLoading || !user) return;
 if (!capTopic.trim()) {
 setError(t("hooks.errNeedTopic"));
 return;
 }
 setCapLoading(true);
 setError(null);
 setOutOfCredits(false);
 try {
 const res = await authedPost("/api/hook-studio", {
 mode: "captions",
 topic: capTopic.trim(),
 platform: capPlatform,
 tone: capTone.trim(),
 });
 if (!res) return; // user cancelled the credit confirmation (finally resets state)
 const data = (await res.json().catch(() => ({}))) as CaptionsResponse;
 if (handlePaidFailure(res, data)) return;
 if (!res.ok || !Array.isArray(data.captions) || data.captions.length === 0) {
 throw new Error(data.message || data.error || t("hooks.errCaptionsFailed"));
 }
 setCapResult(data);
 refreshProfile();
 setTimeout(() => {
 document.getElementById("captions-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
 }, 100);
 } catch (err) {
 setError(err instanceof Error ? err.message : t("hooks.errCaptionsFailed"));
 } finally {
 setCapLoading(false);
 }
 }

 async function scoreVideo() {
 if (preflightLoading || !user) return;
 if (!title.trim()) {
 setError(t("hooks.errNeedTitle"));
 return;
 }
 setPreflightLoading(true);
 setError(null);
 setOutOfCredits(false);
 try {
 const res = await authedPost("/api/hook-studio", {
 mode: "preflight",
 title: title.trim(),
 caption: caption.trim(),
 hashtags: hashtags.trim(),
 description: description.trim(),
 });
 if (!res) return; // user cancelled the credit confirmation (finally resets state)
 const data = (await res.json().catch(() => ({}))) as PreflightResponse;
 if (handlePaidFailure(res, data)) return;
 if (!res.ok || !Array.isArray(data.checks) || data.checks.length === 0) {
 throw new Error(data.message || data.error || t("hooks.errScoringFailed"));
 }
 setScorecard(data);
 refreshProfile();
 setTimeout(() => {
 document.getElementById("preflight-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
 }, 100);
 } catch (err) {
 setError(err instanceof Error ? err.message : t("hooks.errScoringFailed"));
 } finally {
 setPreflightLoading(false);
 }
 }

 async function generateCtas() {
 if (ctaLoading || !user) return;
 if (!ctaTopic.trim()) {
 setError(t("hooks.errNeedVideoTopic"));
 return;
 }
 setCtaLoading(true);
 setError(null);
 setOutOfCredits(false);
 setScriptAdded({});
 try {
 const res = await authedPost("/api/generate-cta", {
 videoTopic: ctaTopic.trim(),
 ctaGoal,
 platform: ctaPlatform,
 tone: ctaTone.trim(),
 });
 if (!res) return; // user cancelled the credit confirmation (finally resets state)
 const data = (await res.json().catch(() => ({}))) as CtaResponse;
 if (handlePaidFailure(res, data)) return;
 if (!res.ok || !Array.isArray(data.ctas) || data.ctas.length === 0) {
 throw new Error(data.message || data.error || t("hooks.errCtasFailed"));
 }
 setCtas(data.ctas);
 refreshProfile();
 setTimeout(() => {
 document.getElementById("cta-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
 }, 100);
 } catch (err) {
 setError(err instanceof Error ? err.message : t("hooks.errCtasFailed"));
 } finally {
 setCtaLoading(false);
 }
 }

 /* ── "add to script" handoff ─────────────────────────────────────────────
    Drops the CTA into the Hub project as a script-kind asset. The Hub's
    tray + workflow rail pick it up automatically, and tools that consume
    script assets (Script Writer, Voiceover's script picker) can use it —
    the CTA travels with the project without leaving the /hooks page. */
 function addCtaToScript(cta: CtaVariant, index: number) {
 addAsset({
 kind: "script",
 url: `data:text/plain;charset=utf-8,${encodeURIComponent(cta.text)}`,
 label: `CTA · ${t(`hooks.ctaGoal.${ctaGoal}.label`)} · ${cta.text.slice(0, 40)}`,
 detail: cta.text,
 meta: {
 text: cta.text,
 goal: ctaGoal,
 platform: ctaPlatform,
 placement: cta.placement,
 topic: ctaTopic.trim().slice(0, 80),
 },
 });
 setScriptAdded((prev) => ({ ...prev, [index]: true }));
 }

 const activeVideoType = VIDEO_TYPES.find((v) => v.key === videoType)!;

 return (
 <div className="min-h-screen bg-black text-white">

 <main className="relative mx-auto max-w-4xl px-5 pb-24 pt-14 md:pt-20">
 {/* glow */}
 <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
 <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
 </div>

 {/* hero */}
 <div className="relative text-center">
 <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
 <Zap className="h-3 w-3" aria-hidden="true" /> {t("hooks.kicker")}
 </p>
 <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
 {t("hooks.heroTitleA")} <span className="text-primary">{t("hooks.heroTitleB")}</span>
 </h1>
 <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
 {t("hooks.heroSub")}
 </p>
 </div>

 {/* tabs */}
 <div className="relative mt-10 flex justify-center gap-2" role="tablist" aria-label={t("hooks.tablistAria")}>
 {(
 [
 { key: "hooks", icon: Zap },
 { key: "titles", icon: Type },
 { key: "captions", icon: Megaphone },
 { key: "scripts", icon: PenLine },
 { key: "styler", icon: Captions },
 { key: "cta", icon: MousePointerClick },
 { key: "preflight", icon: Gauge },
 { key: "dice", icon: Dices },
 { key: "comments", icon: MessageSquareReply },
 ] as { key: TabKey; icon: LucideIcon }[]
 ).map(({ key, icon: Icon }) => {
 const selected = tab === key;
 return (
 <button
 key={key}
 role="tab"
 aria-selected={selected}
 onClick={() => switchTab(key)}
 className={`flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold transition ${
 selected
 ? "bg-primary text-black shadow-[0_0_18px_rgba(212,175,55,0.35)]"
 : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
 }`}
 >
 <Icon className="h-4 w-4" aria-hidden="true" />
 {t(`hooks.tab.${key}.label`, { defaultValue: key === "titles" ? "Titles" : key === "dice" ? "Dice" : key === "scripts" ? "Scripts" : key === "styler" ? "Caption Styler" : key === "comments" ? "Comments" : undefined })}
 </button>
 );
 })}
 </div>

 {/* ── HOOK GENERATOR ─────────────────────────────────────────── */}
 {tab === "hooks" && (
 <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
 <div className="flex items-center gap-3">
 <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
 <Zap className="h-5 w-5" aria-hidden="true" />
 </span>
 <div>
 <h2 className="text-xl font-bold">{t("hooks.tab.hooks.label")}</h2>
 <p className="text-sm text-white/45">{t("hooks.hookGenSub")}</p>
 </div>
 </div>

 {/* Simple / Custom toggle */}
 <div className="flex gap-2 mt-6">
   <button
     type="button"
     onClick={() => setMode("simple")}
     className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
       mode === "simple" ? "bg-primary text-black" : "bg-white/5 text-white/60 hover:bg-white/10"
     }`}
   >
     Simple
   </button>
   <button
     type="button"
     onClick={() => setMode("custom")}
     className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
       mode === "custom" ? "bg-primary text-black" : "bg-white/5 text-white/60 hover:bg-white/10"
     }`}
   >
     Custom
   </button>
 </div>

 {mode === "simple" && (
   <div className="mt-6 space-y-4">
     <p className="text-sm text-white/60">One tap — we'll write 10 hooks for you.</p>
     <div className="grid grid-cols-2 gap-2.5">
       {HOOK_PRESETS.map((preset) => (
         <button
           key={preset.label}
           type="button"
           onClick={() => {
             setTopic(preset.topic);
             setVideoType(preset.type);
           }}
           className="p-4 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-all text-center"
         >
           <span className="text-sm font-semibold">{preset.label}</span>
         </button>
       ))}
     </div>
   </div>
 )}

 {mode === "custom" && (
 <>

 {/* video type picker */}
 <p data-min-stars="2" className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
 {t("hooks.whatKindLabel")}
 </p>
 <div data-min-stars="2" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
 {VIDEO_TYPES.map((v) => {
 const Icon = v.icon;
 const selected = v.key === videoType;
 return (
 <button
 key={v.key}
 onClick={() => setVideoType(v.key)}
 className={`rounded-2xl border p-3.5 text-left transition ${
 selected
 ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
 : "border-white/10 bg-white/[0.03] hover:border-primary/40"
 }`}
 >
 <Icon className={`mb-2 h-5 w-5 ${selected ? "text-primary" : "text-white/50"}`} aria-hidden="true" />
 <p className={`text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>{t(`hooks.videoType.${v.key}.label`)}</p>
 <p className="mt-0.5 text-[11px] leading-snug text-white/35">{t(`hooks.videoType.${v.key}.blurb`)}</p>
 </button>
 );
 })}
 </div>

 {/* topic */}
 <p className="mt-6 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
 {t("hooks.aboutLabel")} <span className="normal-case tracking-normal text-white/25">{t("hooks.optionalTag")}</span>
 </p>
 <input
 value={topic}
 onChange={(e) => setTopic(e.target.value)}
 maxLength={300}
 placeholder={t("hooks.topicPlaceholder", { example: activeVideoType.key === "music-promo" ? "Golden Tide" : "..." })}
 className={inputClass}
 />

 {/* generate */}
 <div className="mt-8 text-center">
 {user ? (
 <button
 onClick={generateHooks}
 disabled={hooksLoading}
 className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
 >
 {hooksLoading ? (
 <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
 ) : (
 <Sparkles className="h-6 w-6" aria-hidden="true" />
 )}
 {hooksLoading ? t("hooks.cookingHooks") : t("hooks.generateHooks")}
 </button>
 ) : (
 <Link
 href="/login"
 className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
 >
 <Sparkles className="h-6 w-6" aria-hidden="true" />
 {t("hooks.signInToGenerate")}
 <ArrowRight className="h-5 w-5" aria-hidden="true" />
 </Link>
 )}
 <p className="mt-2.5 text-xs text-white/35">
 {t("hooks.creditNoteGeneration", { cost: CREDIT_COST })}
 </p>
 {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
 {error && !outOfCredits && (
 <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
 {error}
 </p>
 )}
 {/* ── Content Intelligence round-trip ───────────────────────────────
     Drops the current hook into Step 2 of the Content Intelligence chain
     (/analytics-hub → Intelligence tab): validate the idea, score the
     hook for the viral loop, check the niche, find competitor gaps, and
     build the calendar — one guided flow. */}
 {(hooks.length > 0 || topic.trim()) && (
 <p className="mt-4">
 <Link
 href={`/analytics-hub?tab=intelligence&hook=${encodeURIComponent((hooks[0] ?? topic).trim().slice(0, 600))}`}
 className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black"
 >
 <Zap className="h-4 w-4" aria-hidden="true" />
 {t("hooks.fullIntelligenceCheck")}
 <ArrowRight className="h-4 w-4" aria-hidden="true" />
 </Link>
 </p>
 )}
 </div>

 {/* results */}
 {hooks.length > 0 && (
 <div id="hooks-results" className="mt-8">
 <div className="mb-4 flex items-center justify-between">
 <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
 <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t("hooks.yourHooks")}
 </p>
 {user && (
 <button
 onClick={generateHooks}
 disabled={hooksLoading}
 data-min-stars="2"
 className="flex items-center gap-1.5 rounded-full border border-primary/40 px-3.5 py-1.5 text-xs font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
 >
 <Zap className="h-3.5 w-3.5" aria-hidden="true" />
 {t("hooks.reroll", { cost: CREDIT_COST })}
 </button>
 )}
 </div>
 <div className="grid gap-3">
 {hooks.map((hook, i) => (
 <div
 key={`hook-${i}`}
 className="flex items-start gap-3.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/40"
 >
 <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
 {i + 1}
 </span>
 <p className="pt-1 text-[15px] leading-relaxed text-white/90">“{hook}”</p>
 </div>
 ))}
 </div>
 <p className="mt-4 text-center text-xs text-white/30">
 <Wrench className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
 {t("hooks.hooksTip")}
 </p>
 </div>
 )}
 {/* Wave 8 · Hook Rewriter — docked after the generator UI, inside the hooks tab */}
 <HookRewriter
   onUseAsTopic={(text) => {
     setTopic(text);
     window.scrollTo({ top: 0, behavior: "smooth" });
   }}
 />
 </>
 )}
 </div>
 )}

 {/* ── CAPTIONS & HASHTAGS ────────────────────────────────────── */}
 {tab === "titles" && (
 <TitlesTab />
 )}
 {tab === "captions" && (
 <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
 <div className="flex items-center gap-3">
 <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
 <Megaphone className="h-5 w-5" aria-hidden="true" />
 </span>
 <div>
 <h2 className="text-xl font-bold">{t("hooks.tab.captions.label")}</h2>
 <p className="text-sm text-white/45">{t("hooks.captionsSub")}</p>
 </div>
 </div>

 {/* Cross-link: this tab writes TEXT captions — burned-in video captions
     live in Clip Maker (the Caption Styler). */}
 <Link
 href="/promo-clip"
 className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/60 transition hover:border-primary/40 hover:text-white"
 >
 <span>{t("hooks.captions.needBurnedIn", { defaultValue: "Need burned-in video captions?" })}</span>
 <ArrowRight className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
 </Link>

 <p className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
 {t("hooks.postAboutLabel")}
 </p>
 <textarea
 value={capTopic}
 onChange={(e) => setCapTopic(e.target.value)}
 placeholder={t("hooks.capTopicPlaceholder")}
 rows={3}
 className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none"
 />

 <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
 <div>
 <p data-min-stars="2" className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">{t("hooks.platformLabel")}</p>
 <div data-min-stars="2" className="grid grid-cols-2 gap-2">
 {(["tiktok", "instagram", "youtube", "twitter"] as const).map((p) => (
 <button
 key={p}
 onClick={() => setCapPlatform(p)}
 className={`rounded-lg px-3 py-2.5 text-sm font-semibold capitalize transition ${
 capPlatform === p
 ? "bg-primary text-black"
 : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
 }`}
 >
 {p === "twitter" ? "X / Twitter" : p}
 </button>
 ))}
 </div>
 </div>
 <div data-min-stars="3">
 <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
 {t("hooks.toneLabel")} <span className="normal-case font-normal text-white/30">{t("hooks.optionalTag")}</span>
 </p>
 <input
 value={capTone}
 onChange={(e) => setCapTone(e.target.value)}
 placeholder={t("hooks.tonePlaceholder")}
 className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none"
 />
 </div>
 </div>

 <button
 onClick={generateCaptions}
 disabled={capLoading || !capTopic.trim()}
 className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
 >
 {capLoading ? (
 <><Loader2 className="h-5 w-5 animate-spin" /> {t("hooks.writing")}</>
 ) : (
 <><Sparkles className="h-5 w-5" /> {t("hooks.generateCaptions")}</>
 )}
 </button>

 {capResult && (
 <div id="captions-results" className="mt-8 space-y-6">
 <div>
 <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">{t("hooks.captionsPickFav")}</p>
 <div className="space-y-3">
 {capResult.captions?.map((c, i) => (
 <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
 <p className="text-white/90 whitespace-pre-wrap">{c}</p>
 <button
 onClick={() => navigator.clipboard.writeText(c)}
 className="mt-2 text-xs font-semibold text-primary hover:underline"
 >
 {t("hooks.copy")}
 </button>
 </div>
 ))}
 </div>
 </div>

 {capResult.hashtags && (
 <div>
 <div className="mb-3 flex items-center justify-between">
 <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("hooks.hashtagsLabel")}</p>
 <button
 onClick={() => {
 const all = [
 ...(capResult.hashtags?.niche ?? []),
 ...(capResult.hashtags?.broad ?? []),
 ...(capResult.hashtags?.trending ?? []),
 ].map((t) => `#${t}`).join(" ");
 navigator.clipboard.writeText(all);
 }}
 className="text-xs font-semibold text-primary hover:underline"
 >
 {t("hooks.copyAll")}
 </button>
 </div>
 {(["niche", "broad", "trending"] as const).map((tier) => {
 const tags = capResult.hashtags?.[tier] ?? [];
 if (tags.length === 0) return null;
 return (
 <div key={tier} className="mb-3">
 <p className="mb-1.5 text-xs font-semibold capitalize text-white/50">
 {tier === "niche" ? t("hooks.tierNiche") : tier === "broad" ? t("hooks.tierBroad") : t("hooks.tierTrending")}
 </p>
 <div className="flex flex-wrap gap-1.5">
 {tags.map((t, i) => (
 <span key={i} className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
 #{t}
 </span>
 ))}
 </div>
 </div>
 );
 })}
 </div>
 )}

 {capResult.cta && (
 <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-4">
 <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-white/40">{t("hooks.callToAction")}</p>
 <p className="text-white/90">{capResult.cta}</p>
 </div>
 )}
 </div>
 )}
 </div>
 )}

 {/* ── CTA GENERATOR ──────────────────────────────────────────── */}
 {tab === "cta" && (
 <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
 <div className="flex items-center gap-3">
 <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
 <MousePointerClick className="h-5 w-5" aria-hidden="true" />
 </span>
 <div>
 <h2 className="text-xl font-bold">{t("hooks.tab.cta.label")}</h2>
 <p className="text-sm text-white/45">{t("hooks.ctaSub")}</p>
 </div>
 </div>

 <p className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
 {t("hooks.ctaTopicLabel")}
 </p>
 <input
 value={ctaTopic}
 onChange={(e) => setCtaTopic(e.target.value)}
 maxLength={300}
 placeholder={t("hooks.ctaTopicPlaceholder")}
 className={inputClass}
 />

 <p data-min-stars="2" className="mt-6 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
 {t("hooks.ctaGoalLabel")}
 </p>
 <div data-min-stars="2" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
 {CTA_GOALS.map((g) => {
 const selected = g === ctaGoal;
 return (
 <button
 key={g}
 onClick={() => setCtaGoal(g)}
 className={`rounded-2xl border px-3.5 py-3 text-left transition ${
 selected
 ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
 : "border-white/10 bg-white/[0.03] hover:border-primary/40"
 }`}
 >
 <p className={`text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>
 {t(`hooks.ctaGoal.${g}.label`)}
 </p>
 </button>
 );
 })}
 </div>

 <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
 <div>
 <p data-min-stars="2" className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">{t("hooks.platformLabel")}</p>
 <div data-min-stars="2" className="grid grid-cols-2 gap-2">
 {CTA_PLATFORMS.map((p) => (
 <button
 key={p}
 onClick={() => setCtaPlatform(p)}
 className={`rounded-lg px-3 py-2.5 text-sm font-semibold capitalize transition ${
 ctaPlatform === p
 ? "bg-primary text-black"
 : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
 }`}
 >
 {p === "twitter" ? "X / Twitter" : p}
 </button>
 ))}
 </div>
 </div>
 <div data-min-stars="3">
 <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
 {t("hooks.toneLabel")} <span className="normal-case font-normal text-white/30">{t("hooks.optionalTag")}</span>
 </p>
 <input
 value={ctaTone}
 onChange={(e) => setCtaTone(e.target.value)}
 placeholder={t("hooks.tonePlaceholder")}
 className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none"
 />
 </div>
 </div>

 <div className="mt-8 text-center">
 {user ? (
 <button
 onClick={generateCtas}
 disabled={ctaLoading || !ctaTopic.trim()}
 className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
 >
 {ctaLoading ? (
 <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
 ) : (
 <MousePointerClick className="h-6 w-6" aria-hidden="true" />
 )}
 {ctaLoading ? t("hooks.cookingCtas") : t("hooks.generateCtas")}
 </button>
 ) : (
 <Link
 href="/login"
 className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
 >
 <MousePointerClick className="h-6 w-6" aria-hidden="true" />
 {t("hooks.signInToGenerate")}
 <ArrowRight className="h-5 w-5" aria-hidden="true" />
 </Link>
 )}
 <p className="mt-2.5 text-xs text-white/35">
 {t("hooks.creditNoteCta", { cost: CTA_CREDIT_COST })}
 </p>
 {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
 {error && !outOfCredits && (
 <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
 {error}
 </p>
 )}
 </div>

 {/* results — ranked by strength */}
 {ctas.length > 0 && (
 <div id="cta-results" className="mt-8">
 <p className="mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
 <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t("hooks.yourCtas")}
 </p>
 <div className="grid gap-3">
 {ctas.map((cta, i) => (
 <div
 key={`cta-${i}`}
 className="flex items-start gap-3.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/40"
 >
 <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
 {i + 1}
 </span>
 <div className="min-w-0 flex-1">
 <p className="text-[15px] leading-relaxed text-white/90">“{cta.text}”</p>
 <div className="mt-2 flex flex-wrap items-center gap-2">
 <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
 {t(`hooks.ctaPlacement.${cta.placement}.label`)}
 </span>
 <span className={`text-xs font-bold ${scoreColor(cta.strength)}`}>
 {t("hooks.ctaStrengthLabel")} {cta.strength}
 </span>
 </div>
 <div className="mt-2.5 flex flex-wrap gap-2">
 <button
 onClick={() => navigator.clipboard.writeText(cta.text)}
 className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-white"
 >
 <Copy className="h-3 w-3" aria-hidden="true" /> {t("hooks.copy")}
 </button>
 <button
 onClick={() => addCtaToScript(cta, i)}
 disabled={scriptAdded[i]}
 className="flex items-center gap-1 rounded-full border border-primary/40 px-3 py-1 text-xs font-bold text-primary transition hover:bg-primary hover:text-black disabled:cursor-default disabled:bg-primary/10 disabled:text-primary/60"
 >
 {scriptAdded[i] ? (
 <><Check className="h-3 w-3" aria-hidden="true" /> {t("hooks.addedToScript")}</>
 ) : (
 <>{t("hooks.addToScript")}</>
 )}
 </button>
 {scriptAdded[i] && (
 <a
 href="/script-writer"
 className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-primary"
 >
 <PenLine className="h-3 w-3" aria-hidden="true" /> {t("hooks.sendToScriptWriter")}
 </a>
 )}
 </div>
 </div>
 </div>
 ))}
 </div>
 <p className="mt-4 text-center text-xs text-white/30">
 <Wrench className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
 {t("hooks.ctaHandoffTip")}
 </p>
 </div>
 )}
 </div>
 )}

 {/* ── VIRALITY PRE-FLIGHT ────────────────────────────────────── */}
 {tab === "preflight" && (
 <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
 <div className="flex items-center gap-3">
 <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
 <Gauge className="h-5 w-5" aria-hidden="true" />
 </span>
 <div>
 <h2 className="text-xl font-bold">{t("hooks.tab.preflight.label")}</h2>
 <p className="text-sm text-white/45">{t("hooks.preflightSub")}</p>
 </div>
 </div>

 <div className="mt-8 grid gap-4">
 <div>
 <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40" htmlFor="pf-title">
 {t("hooks.pfTitleLabel")}
 </label>
 <input
 id="pf-title"
 value={title}
 onChange={(e) => setTitle(e.target.value)}
 maxLength={200}
 placeholder={t("hooks.pfTitlePlaceholder")}
 className={inputClass}
 />
 </div>
 <div data-min-stars="3">
 <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40" htmlFor="pf-caption">
 {t("hooks.pfCaptionLabel")}
 </label>
 <textarea
 id="pf-caption"
 value={caption}
 onChange={(e) => setCaption(e.target.value)}
 maxLength={1000}
 rows={2}
 placeholder={t("hooks.pfCaptionPlaceholder")}
 className={`${inputClass} resize-none`}
 />
 </div>
 <div data-min-stars="3">
 <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40" htmlFor="pf-hashtags">
 {t("hooks.hashtagsLabel")}
 </label>
 <input
 id="pf-hashtags"
 value={hashtags}
 onChange={(e) => setHashtags(e.target.value)}
 maxLength={500}
 placeholder={t("hooks.pfHashtagsPlaceholder")}
 className={inputClass}
 />
 </div>
 <div data-min-stars="3">
 <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40" htmlFor="pf-desc">
 {t("hooks.pfDescLabel")}
 </label>
 <textarea
 id="pf-desc"
 value={description}
 onChange={(e) => setDescription(e.target.value)}
 maxLength={1000}
 rows={2}
 placeholder={t("hooks.pfDescPlaceholder")}
 className={`${inputClass} resize-none`}
 />
 </div>
 </div>

 <div className="mt-8 text-center">
 {user ? (
 <button
 onClick={scoreVideo}
 disabled={preflightLoading}
 className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
 >
 {preflightLoading ? (
 <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
 ) : (
 <Gauge className="h-6 w-6" aria-hidden="true" />
 )}
 {preflightLoading ? t("hooks.runningPreflight") : t("hooks.scoreVideo")}
 </button>
 ) : (
 <Link
 href="/login"
 className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
 >
 <Gauge className="h-6 w-6" aria-hidden="true" />
 {t("hooks.signInToRunPreflight")}
 <ArrowRight className="h-5 w-5" aria-hidden="true" />
 </Link>
 )}
 <p className="mt-2.5 text-xs text-white/35">
 {t("hooks.creditNoteScorecard", { cost: CREDIT_COST })}
 </p>
 {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
 {error && !outOfCredits && (
 <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
 {error}
 </p>
 )}
 </div>

 {/* scorecard */}
 {scorecard && typeof scorecard.score === "number" && (
 <div id="preflight-results" className="mt-8">
 <div className="rounded-2xl border border-white/10 bg-black/60 p-6 text-center">
 <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
 {t("hooks.viralReadiness")}
 </p>
 <p className={`mt-2 font-display text-6xl font-black ${scoreColor(scorecard.score)}`}>
 {scorecard.score}
 <span className="text-2xl text-white/30">{t("hooks.scoreOutOf")}</span>
 </p>
 <div className="mx-auto mt-4 h-2.5 max-w-sm overflow-hidden rounded-full bg-white/10">
 <div
 className={`h-full rounded-full bg-gradient-to-r ${scoreBar(scorecard.score)} transition-all`}
 style={{ width: `${scorecard.score}%` }}
 />
 </div>
 {scorecard.verdict && (
 <p className="mx-auto mt-4 max-w-md text-[15px] font-semibold leading-relaxed text-white/85">
 {scorecard.verdict}
 </p>
 )}
 </div>

 <div className="mt-4 grid gap-3">
 {scorecard.checks!.map((check, i) => (
 <div
 key={`check-${i}`}
 className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
 >
 <div className="flex items-center justify-between gap-3">
 <p className="flex items-center gap-2 text-sm font-bold text-white/90">
 {check.score >= 75 ? (
 <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
 ) : (
 <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
 )}
 {check.label}
 </p>
 <p className={`font-display text-xl font-black ${scoreColor(check.score)}`}>
 {check.score}
 </p>
 </div>
 <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
 <div
 className={`h-full rounded-full bg-gradient-to-r ${scoreBar(check.score)}`}
 style={{ width: `${check.score}%` }}
 />
 </div>
 <p className="mt-2.5 text-sm leading-relaxed text-white/60">
 <span className="font-semibold text-primary/90">{t("hooks.fixPrefix")}</span>
 {check.fix}
 </p>
 </div>
 ))}
 </div>

 <p className="mt-4 text-center text-xs italic text-white/30">
 {scorecard.disclaimer || t("hooks.disclaimerDefault")}
 </p>
 </div>
 )}
 </div>
 )}

 {/* ── DICE (CONTENT RANDOMIZER) ──────────────────────────────── */}
 {tab === "dice" && (
 <RandomizerDice />
 )}

 {/* ── SCRIPTS (SCRIPT WRITER) ────────────────────────────────── */}
 {tab === "scripts" && (
 <ScriptWriter />
 )}

 {/* ── CAPTION STYLER (AI VIDEO CAPTIONS) ─────────────────────── */}
 {tab === "styler" && (
 <CaptionStyler />
 )}

 {/* ── COMMENT-TO-VIDEO ─────────────────────────────────────────── */}
 {tab === "comments" && (
 <div className="relative mt-8">
 <CommentToVideoSection />
 </div>
 )}

 {/* cross-link */}
 <p className="relative mt-8 text-center text-sm text-white/40">
 {t("hooks.crossLinkBefore")}{" "}
 <span className="font-semibold text-primary">Thy Cheat Code</span>{" "}
 {t("hooks.crossLinkAfter")}
 </p>
 </main>


 </div>
 );
}
