import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
 Zap, Gauge, Loader2, Sparkles, ArrowRight, Megaphone,
 Clapperboard, Film, GraduationCap, Wrench, CheckCircle2, AlertTriangle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";
import { useHubProject } from "@/lib/hub-project";
import { getHookTemplate } from "@/data/hook-templates";
import { getCaptionPack } from "@/data/caption-templates";

/* ─── Thy Cheat Code's Hook Studio ────────────────────────────────────────
 Two money tools on one page: the Hook Generator (first-3-second openers)
 and the Virality Pre-flight (honest viral-READINESS scorecard — never a
 virality guarantee). Both POST to /api/hook-studio at 1 credit per
 generation on GPT-6 Sol. Video-type keys must stay in sync with the
 backend route's VIDEO_TYPES enum. */

type TabKey = "hooks" | "preflight" | "captions";

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

export default function HookStudio() {
 const { t } = useTranslation();
 const { user, getAccessToken, refreshProfile } = useAuth();
 const { confirmedFetch } = useConfirmedApi();
 const [tab, setTab] = useState<TabKey>("hooks");

 /* hook generator state */
 const [videoType, setVideoType] = useState<VideoTypeKey>("music-promo");
 const [topic, setTopic] = useState("");
 const { project } = useHubProject();
 useEffect(() => {
 if (!topic && project.name) setTopic(project.name);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [project.name]);

 /* Template deep-link: ?template=<slug> preloads the hook generator;
    ?tab=captions&template=<slug> preloads the caption writer.
    Used by the public template galleries (/templates/hooks, /templates/captions). */
 useEffect(() => {
 try {
 const params = new URLSearchParams(window.location.search);
 const tabParam = params.get("tab");
 if (tabParam === "captions") setTab("captions");
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

 /* shared */
 const [error, setError] = useState<string | null>(null);
 const [outOfCredits, setOutOfCredits] = useState(false);

 function switchTab(next: TabKey) {
 setTab(next);
 setError(null);
 setOutOfCredits(false);
 }

 async function authedPost(body: Record<string, unknown>) {
 const token = await getAccessToken();
 return confirmedFetch("/api/hook-studio", {
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
 const res = await authedPost({ mode: "hooks", videoType, topic: topic.trim() });
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
 const res = await authedPost({
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
 const res = await authedPost({
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
 { key: "captions", icon: Megaphone },
 { key: "preflight", icon: Gauge },
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
 {t(`hooks.tab.${key}.label`)}
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
 </div>
 )}

 {/* ── CAPTIONS & HASHTAGS ────────────────────────────────────── */}
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
