import { Suspense, lazy, useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import {
 DollarSign, TrendingUp, Loader2, Sparkles, ArrowRight, Target,
 Wallet, CalendarCheck, CheckCircle2, AlertTriangle,
 Play, Camera, Music2, Copy,
 Handshake, Megaphone, Coffee, Disc3, Crown, Store, ShoppingBag,
 Rocket, Newspaper, Mail, Users, Trophy, Gift, UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";
import NicheAnalyzerPanel from "@/components/coach/NicheAnalyzerPanel";
import MoneyTrackerPanel, { readMoneySnapshot } from "@/components/coach/MoneyTrackerPanel";

/* ── Money-hub tabs: former standalone pages, now lazy-loaded tabs ─────── */
const BrandDeals = lazy(() => import("@/pages/brand-deals"));
const Shoutouts = lazy(() => import("@/pages/shoutouts"));
const Tips = lazy(() => import("@/pages/tips"));
const Beats = lazy(() => import("@/pages/beats"));
const Memberships = lazy(() => import("@/pages/memberships"));
const Storefronts = lazy(() => import("@/pages/storefronts"));
const MyShop = lazy(() => import("@/pages/my-shop"));
const Distribute = lazy(() => import("@/pages/distribute"));
const PressKit = lazy(() => import("@/pages/press-kit"));
const EmailList = lazy(() => import("@/pages/email-list"));
const Collabs = lazy(() => import("@/pages/collabs"));
const Contests = lazy(() => import("@/pages/contests"));
const Referrals = lazy(() => import("@/pages/referrals"));
const TeamPage = lazy(() => import("@/pages/team"));

/* ─── Thy Cheat Code's Monetization Coach ─────────────────────────────────
 The money end of the creator loop: eligibility tracking for each
 platform's monetization program, niche/platform earnings guidance, and
 3 prioritized money moves for the next 30 days. POSTs to
 /api/monetization-coach at 1 credit per plan on GPT-6 Sol.
 Platform keys must stay in sync with the backend route's PLATFORMS enum. */

type PlatformKey = "youtube" | "tiktok" | "instagram";

interface PlatformOpt {
 key: PlatformKey;
 label: string;
 icon: LucideIcon;
 blurb: string;
}

const CREDIT_COST = 1;

interface EligibilityItem {
 platform: string;
 program: string;
 threshold: string;
 progress: number;
 status: "eligible" | "close" | "building";
 nextStep: string;
}

interface Earnings {
 rpmNotes: string;
 bestFormat: string;
 bestCadence: string;
}

interface CoachResponse {
 eligibility?: EligibilityItem[];
 earnings?: Earnings;
 moneyMoves?: string[];
 note?: string;
 creditsUsed?: number;
 creditsRemaining?: number;
 error?: string;
 message?: string;
}

function progressColor(p: number): string {
 if (p >= 90) return "text-emerald-400";
 if (p >= 40) return "text-amber-400";
 return "text-red-400";
}

function progressBar(p: number): string {
 if (p >= 90) return "from-emerald-500 to-emerald-300";
 if (p >= 40) return "from-amber-500 to-amber-300";
 return "from-red-500 to-red-300";
}

function statusBadge(status: EligibilityItem["status"]): { labelKey: string; cls: string } {
 switch (status) {
 case "eligible":
 return { labelKey: "coach.statusEligible", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
 case "close":
 return { labelKey: "coach.statusClose", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" };
 default:
 return { labelKey: "coach.statusBuilding", cls: "border-white/15 bg-white/[0.04] text-white/50" };
 }
}

const inputClass =
 "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

export default function MonetizationCoach() {
 const { t } = useTranslation();
 const { user, getAccessToken, refreshProfile } = useAuth();
 const { confirmedFetch } = useConfirmedApi();

 const PLATFORM_OPTS: PlatformOpt[] = [
  { key: "youtube", label: t("coach.platformYouTube"), icon: Play, blurb: t("coach.platformYouTubeBlurb") },
  { key: "tiktok", label: t("coach.platformTikTok"), icon: Music2, blurb: t("coach.platformTikTokBlurb") },
  { key: "instagram", label: t("coach.platformInstagram"), icon: Camera, blurb: t("coach.platformInstagramBlurb") },
 ];

 const NICHE_OPTIONS: { value: string; label: string }[] = [
  { value: "Music", label: t("coach.nicheMusic") },
  { value: "Gaming", label: t("coach.nicheGaming") },
  { value: "Comedy", label: t("coach.nicheComedy") },
  { value: "Fitness", label: t("coach.nicheFitness") },
  { value: "Beauty & Fashion", label: t("coach.nicheBeautyFashion") },
  { value: "Tech", label: t("coach.nicheTech") },
  { value: "Education", label: t("coach.nicheEducation") },
  { value: "Lifestyle", label: t("coach.nicheLifestyle") },
 ];

 const [niche, setNiche] = useState("Music");
 const [customNiche, setCustomNiche] = useState("");
 const [platforms, setPlatforms] = useState<PlatformKey[]>(["youtube", "tiktok"]);
 const [followers, setFollowers] = useState<Record<PlatformKey, string>>({
 youtube: "",
 tiktok: "",
 instagram: "",
 });
 const [cadence, setCadence] = useState("3");

 const [plan, setPlan] = useState<CoachResponse | null>(null);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [outOfCredits, setOutOfCredits] = useState(false);
/* ── Money-hub tab groups ─────────────────────────────────────────────── */
type CoachTab =
  | "plan" | "niche" | "money"
  | "brand-deals" | "shoutouts" | "tips" | "beats" | "memberships"
  | "distribute" | "storefronts" | "my-shop"
  | "press-kit" | "email-list" | "collabs" | "contests" | "referrals" | "team";

interface CoachTabDef { key: CoachTab; labelKey: string; defaultLabel: string; Icon: LucideIcon; }
interface CoachTabGroup { id: string; labelKey: string; defaultLabel: string; tabs: CoachTabDef[]; }

const COACH_TAB_GROUPS: CoachTabGroup[] = [
  {
    id: "plan", labelKey: "coach.tabGroupPlan", defaultLabel: "Plan",
    tabs: [
      { key: "plan", labelKey: "coach.tabPlan", defaultLabel: "Money Plan", Icon: Target },
      { key: "niche", labelKey: "coach.tabNiche", defaultLabel: "Niche Analyzer", Icon: Sparkles },
    ],
  },
  {
    id: "track", labelKey: "coach.tabGroupTrack", defaultLabel: "Track",
    tabs: [
      { key: "money", labelKey: "coach.tabMoneyTracker", defaultLabel: "Money Tracker", Icon: Wallet },
    ],
  },
  {
    id: "earn", labelKey: "coach.tabGroupEarn", defaultLabel: "Earn",
    tabs: [
      { key: "brand-deals", labelKey: "coach.tabBrandDeals", defaultLabel: "Brand Deals", Icon: Handshake },
      { key: "shoutouts", labelKey: "coach.tabShoutouts", defaultLabel: "Shoutouts", Icon: Megaphone },
      { key: "tips", labelKey: "coach.tabTips", defaultLabel: "Tips", Icon: Coffee },
      { key: "beats", labelKey: "coach.tabBeats", defaultLabel: "Sell Beats", Icon: Disc3 },
      { key: "memberships", labelKey: "coach.tabMemberships", defaultLabel: "Memberships", Icon: Crown },
    ],
  },
  {
    id: "sell", labelKey: "coach.tabGroupSell", defaultLabel: "Sell",
    tabs: [
      { key: "distribute", labelKey: "coach.tabDistribute", defaultLabel: "Distribute", Icon: Rocket },
      { key: "storefronts", labelKey: "coach.tabStorefronts", defaultLabel: "Storefronts", Icon: Store },
      { key: "my-shop", labelKey: "coach.tabMyShop", defaultLabel: "My Shop", Icon: ShoppingBag },
    ],
  },
  {
    id: "grow", labelKey: "coach.tabGroupGrow", defaultLabel: "Grow",
    tabs: [
      { key: "press-kit", labelKey: "coach.tabPressKit", defaultLabel: "Press Kit", Icon: Newspaper },
      { key: "email-list", labelKey: "coach.tabEmailList", defaultLabel: "Email List", Icon: Mail },
      { key: "collabs", labelKey: "coach.tabCollabs", defaultLabel: "Collabs", Icon: Users },
      { key: "contests", labelKey: "coach.tabContests", defaultLabel: "Contests", Icon: Trophy },
      { key: "referrals", labelKey: "coach.tabReferrals", defaultLabel: "Referrals", Icon: Gift },
      { key: "team", labelKey: "coach.tabTeam", defaultLabel: "Team", Icon: UsersRound },
    ],
  },
];

const ALL_COACH_TABS = COACH_TAB_GROUPS.flatMap((g) => g.tabs.map((t) => t.key));

function HubTabFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-white/40">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

 const [activeTab, setActiveTab] = useState<CoachTab>("plan");
 const search = useSearch();

 /* Deep-link: /coach?tab=<coach-tab> (e.g. from a paid brand deal or
    invoice) lands directly on that tab. Optional &subtab= forwards an
    inner tab to embedded pages (distribute: releases|new|plan;
    brand-deals: finder|pitch|marketplace). */
 const distributeSubTab = new URLSearchParams(search).get("subtab");
 useEffect(() => {
 const tab = new URLSearchParams(search).get("tab");
 if (tab && (ALL_COACH_TABS as string[]).includes(tab)) setActiveTab(tab as CoachTab);
 }, [search]);

 function togglePlatform(key: PlatformKey) {
 setPlatforms((prev) =>
 prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
 );
 }

 function setFollowerCount(key: PlatformKey, value: string) {
 const digits = value.replace(/[^0-9]/g, "").slice(0, 10);
 setFollowers((prev) => ({ ...prev, [key]: digits }));
 }

 async function buildPlan() {
 if (loading || !user) return;
 const finalNiche = (customNiche.trim() || niche).slice(0, 120);
 if (!finalNiche) {
 setError(t("coach.errorNoNiche"));
 return;
 }
 if (platforms.length === 0) {
 setError(t("coach.errorNoPlatform"));
 return;
 }
 const cadenceNum = Math.max(0, Math.min(100, parseInt(cadence, 10) || 0));

 setLoading(true);
 setError(null);
 setOutOfCredits(false);
 try {
 const token = await getAccessToken();
 const res = await confirmedFetch("/api/monetization-coach", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 ...(token ? { Authorization: `Bearer ${token}` } : {}),
 },
 body: JSON.stringify({
 niche: finalNiche,
 platforms,
 followers: {
 youtube: parseInt(followers.youtube || "0", 10) || 0,
 tiktok: parseInt(followers.tiktok || "0", 10) || 0,
 instagram: parseInt(followers.instagram || "0", 10) || 0,
 },
 cadence: cadenceNum,
 /* Real tracked money (from the Money Tracker tab) — grounds the
 plan in the creator's actual numbers instead of pure estimates. */
 moneySnapshot: readMoneySnapshot(),
 }),
 });
 if (!res) return; // user cancelled the credit confirmation (finally resets state)
 const data = (await res.json().catch(() => ({}))) as CoachResponse;
 if (res.status === 402 || data.error === "out_of_credits") {
 setOutOfCredits(true);
 refreshProfile();
 return;
 }
 if (!res.ok || !Array.isArray(data.eligibility) || data.eligibility.length === 0 || !Array.isArray(data.moneyMoves) || data.moneyMoves.length === 0) {
 throw new Error(data.message || data.error || t("coach.errorPlanFailed"));
 }
 setPlan(data);
 refreshProfile();
 setTimeout(() => {
 document.getElementById("coach-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
 }, 100);
 } catch (err) {
 setError(err instanceof Error ? err.message : t("coach.errorPlanFailed"));
 } finally {
 setLoading(false);
 }
 }

 return (
 <div className="min-h-screen bg-black text-white">

 <main className="relative mx-auto max-w-4xl px-5 pb-24 pt-14 md:pt-20">
 {/* glow */}
 <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
 <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
 </div>

 {/* hero */}
 <div className="relative text-center">
 <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-primary">
 <DollarSign className="h-3 w-3" aria-hidden="true" /> {t("coach.heroBadge")}
 </p>
 <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
 {t("coach.titleStart")} <span className="text-primary">{t("coach.titleHighlight")}</span>
 </h1>
 <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
 {t("coach.subtitle")}
 </p>
 </div>

 {/* ── TABS: grouped money-hub navigation ─────────────────────────── */}
 <div className="relative mt-8 flex justify-center">
 <div className="flex flex-wrap justify-center gap-x-5 gap-y-4 max-w-4xl">
 {COACH_TAB_GROUPS.map((group) => (
 <div key={group.id} className="flex flex-col items-center gap-1.5">
 <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
 {t(group.labelKey, { defaultValue: group.defaultLabel })}
 </span>
 <div className="inline-flex flex-wrap justify-center rounded-2xl border border-white/10 bg-white/[0.03] p-1.5 gap-1">
 {group.tabs.map((tab) => (
 <button
 key={tab.key}
 onClick={() => setActiveTab(tab.key)}
 className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-bold transition ${
 activeTab === tab.key
 ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
 : "text-white/55 hover:text-white"
 }`}
 >
 <tab.Icon className="h-3.5 w-3.5" aria-hidden="true" />
 {t(tab.labelKey, { defaultValue: tab.defaultLabel })}
 </button>
 ))}
 </div>
 </div>
 ))}
 </div>
 </div>

 {activeTab === "money" ? (
 <MoneyTrackerPanel />
 ) : activeTab === "niche" ? (
 <NicheAnalyzerPanel />
 ) : activeTab !== "plan" ? (
 /* ── Embedded money-hub pages (lazy) ──────────────────────────── */
 <Suspense fallback={<HubTabFallback />}>
 <div className="relative mt-6">
 {activeTab === "brand-deals" && <BrandDeals key={distributeSubTab ?? "d"} initialTab={distributeSubTab === "pitch" || distributeSubTab === "finder" || distributeSubTab === "marketplace" ? distributeSubTab : undefined} />}
 {activeTab === "shoutouts" && <Shoutouts />}
 {activeTab === "tips" && <Tips />}
 {activeTab === "beats" && <Beats />}
 {activeTab === "memberships" && <Memberships />}
 {activeTab === "distribute" && <Distribute key={distributeSubTab ?? "d"} initialTab={distributeSubTab === "plan" || distributeSubTab === "new" || distributeSubTab === "releases" ? distributeSubTab : undefined} />}
 {activeTab === "storefronts" && <Storefronts />}
 {activeTab === "my-shop" && <MyShop />}
 {activeTab === "press-kit" && <PressKit />}
 {activeTab === "email-list" && <EmailList />}
 {activeTab === "collabs" && <Collabs />}
 {activeTab === "contests" && <Contests />}
 {activeTab === "referrals" && <Referrals />}
 {activeTab === "team" && <TeamPage />}
 </div>
 </Suspense>
 ) : (
 <>
 {/* ── INPUTS ─────────────────────────────────────────────────── */}
 <div className="relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
 {/* niche */}
 <p data-min-stars="2" className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
 {t("coach.yourNiche")}
 </p>
 <div data-min-stars="2" className="flex flex-wrap gap-2">
 {NICHE_OPTIONS.map((opt) => {
 const selected = !customNiche.trim() && niche === opt.value;
 return (
 <button
 key={opt.value}
 onClick={() => { setNiche(opt.value); setCustomNiche(""); }}
 className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
 selected
 ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
 : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
 }`}
 >
 {opt.label}
 </button>
 );
 })}
 </div>
 <input
 value={customNiche}
 onChange={(e) => setCustomNiche(e.target.value)}
 maxLength={120}
 placeholder={t("coach.customNichePlaceholder")}
 className={`${inputClass} mt-3`}
 />

 {/* platforms */}
 <p className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
 {t("coach.whereDoYouPost")}
 </p>
 <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
 {PLATFORM_OPTS.map((p) => {
 const Icon = p.icon;
 const selected = platforms.includes(p.key);
 return (
 <div
 key={p.key}
 className={`rounded-2xl border p-3.5 transition ${
 selected
 ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
 : "border-white/10 bg-white/[0.03]"
 }`}
 >
 <button
 onClick={() => togglePlatform(p.key)}
 className="flex w-full items-center gap-2.5 text-left"
 >
 <span
 className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
 selected ? "border-primary bg-primary text-black" : "border-white/25 text-transparent"
 }`}
 >
 <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
 </span>
 <Icon className={`h-5 w-5 ${selected ? "text-primary" : "text-white/50"}`} aria-hidden="true" />
 <span>
 <span className={`block text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>
 {p.label}
 </span>
 <span className="block text-[11px] text-white/35">{p.blurb}</span>
 </span>
 </button>
 {selected && (
 <input
 data-min-stars="3"
 value={followers[p.key]}
 onChange={(e) => setFollowerCount(p.key, e.target.value)}
 inputMode="numeric"
 placeholder={p.key === "youtube" ? t("coach.subscribersPlaceholder") : t("coach.followersPlaceholder")}
 aria-label={t("coach.followerCountAria", { label: p.label })}
 className={`${inputClass} mt-3 !py-2.5`}
 />
 )}
 </div>
 );
 })}
 </div>

 {/* cadence */}
 <p data-min-stars="3" className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
 {t("coach.videosPerWeek")}
 </p>
 <input
 data-min-stars="3"
 value={cadence}
 onChange={(e) => setCadence(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
 inputMode="numeric"
 placeholder={t("coach.cadencePlaceholder")}
 aria-label={t("coach.videosPerWeek")}
 className={`${inputClass} max-w-[180px]`}
 />

 {/* CTA */}
 <div className="mt-8 text-center">
 {user ? (
 <button
 onClick={buildPlan}
 disabled={loading}
 className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
 >
 {loading ? (
 <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
 ) : (
 <TrendingUp className="h-6 w-6" aria-hidden="true" />
 )}
 {loading ? t("coach.crunching") : t("coach.buildPlan")}
 </button>
 ) : (
 <Link
 href="/login"
 className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
 >
 <TrendingUp className="h-6 w-6" aria-hidden="true" />
 {t("coach.signInCta")}
 <ArrowRight className="h-5 w-5" aria-hidden="true" />
 </Link>
 )}
 <p className="mt-2.5 text-xs text-white/35">
 {t("coach.costPerPlan", { cost: CREDIT_COST })}
 </p>
 {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
 {error && !outOfCredits && (
 <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
 {error}
 </p>
 )}
 </div>
 </div>

 {/* ── FRESH MONEY OPPORTUNITIES ──────────────────────────────── */}
 <div className="relative mt-8">
 <p className="mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
 <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t("coach.freshOpportunities")}
 </p>
 <div className="rounded-2xl border border-primary/25 bg-primary/[0.06] p-5">
 <p className="mb-2 inline-flex items-center rounded-full border border-primary/40 bg-primary/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-primary">
 {t("coach.newsBadge")}
 </p>
 <p className="text-base font-black text-white">
 {t("coach.newsTitle")}
 </p>
 <p className="mt-2 text-[15px] leading-relaxed text-white/70">
 {t("coach.newsBody")}
 </p>
 <p className="mt-3 text-xs text-white/40">
 {t("coach.newsFooter")}
 </p>
 </div>
 </div>

 {/* ── RESULTS ────────────────────────────────────────────────── */}
 {plan && plan.eligibility && plan.eligibility.length > 0 && (
 <div id="coach-results" className="relative mt-8">
 <div className="mb-4 flex items-center justify-between">
 <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
 <Target className="h-3.5 w-3.5" aria-hidden="true" /> {t("coach.eligibilityTitle")}
 </p>
 <button
   onClick={async () => {
     const lines: string[] = ["MY MONEY PLAN — Bow Down Visuals"];
     plan.eligibility!.forEach((e) => lines.push(`• ${e.platform} — ${e.program}: ${e.status.toUpperCase()} (${e.threshold}; ${e.progress}% there)`));
     if (plan.moneyMoves?.length) { lines.push("", "MONEY MOVES:"); plan.moneyMoves.forEach((m) => lines.push(`• ${m}`)); }
     if (plan.note) lines.push("", plan.note);
     try { await navigator.clipboard.writeText(lines.join("\n")); setError(null); } catch { /* clipboard blocked */ }
   }}
   className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-primary/50 hover:text-primary"
 >
   <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {t("coach.copyPlan", { defaultValue: "Copy plan" })}
 </button>
 </div>
 <div className="grid gap-3">
 {plan.eligibility.map((item, i) => {
 const badge = statusBadge(item.status);
 return (
 <div
 key={`elig-${i}`}
 className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
 >
 <div className="flex items-center justify-between gap-3">
 <p className="text-base font-black text-white">{item.platform}</p>
 <span className={`rounded-full border px-3 py-1 text-[11px] font-bold ${badge.cls}`}>
 {t(badge.labelKey)}
 </span>
 </div>
 <p className="mt-1 text-sm text-white/55">{item.program}</p>
 <p className="mt-1 text-xs text-white/40">{t("coach.threshold", { value: item.threshold })}</p>
 <div className="mt-3 flex items-center gap-3">
 <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
 <div
 className={`h-full rounded-full bg-gradient-to-r ${progressBar(item.progress)}`}
 style={{ width: `${item.progress}%` }}
 />
 </div>
 <p className={`font-display text-lg font-black ${progressColor(item.progress)}`}>
 {item.progress}%
 </p>
 </div>
 {item.nextStep && (
 <p className="mt-3 text-sm leading-relaxed text-white/70">
 <span className="font-semibold text-primary/90">{t("coach.nextLabel")}</span>
 {item.nextStep}
 </p>
 )}
 </div>
 );
 })}
 </div>

 {/* earnings */}
 {plan.earnings && (plan.earnings.rpmNotes || plan.earnings.bestFormat || plan.earnings.bestCadence) && (
 <>
 <p className="mb-4 mt-8 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
 <Wallet className="h-3.5 w-3.5" aria-hidden="true" /> {t("coach.earningsTitle")}
 </p>
 <div className="grid gap-3">
 {plan.earnings.bestFormat && (
 <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
 <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("coach.earnsMost")}</p>
 <p className="mt-1.5 text-[15px] leading-relaxed text-white/90">{plan.earnings.bestFormat}</p>
 </div>
 )}
 {plan.earnings.rpmNotes && (
 <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
 <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("coach.rpmRanges")}</p>
 <p className="mt-1.5 text-[15px] leading-relaxed text-white/90">{plan.earnings.rpmNotes}</p>
 </div>
 )}
 {plan.earnings.bestCadence && (
 <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
 <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("coach.cadenceLabel")}</p>
 <p className="mt-1.5 text-[15px] leading-relaxed text-white/90">{plan.earnings.bestCadence}</p>
 </div>
 )}
 </div>
 </>
 )}

 {/* money moves */}
 {plan.moneyMoves && plan.moneyMoves.length > 0 && (
 <>
 <p className="mb-4 mt-8 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
 <CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" /> {t("coach.moneyMovesTitle")}
 </p>
 <div className="grid gap-3">
 {plan.moneyMoves.map((move, i) => (
 <div
 key={`move-${i}`}
 className="flex items-start gap-3.5 rounded-2xl border border-primary/25 bg-primary/[0.06] p-4 text-left"
 >
 <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
 {i + 1}
 </span>
 <p className="pt-1 text-[15px] leading-relaxed text-white/90">{move}</p>
 </div>
 ))}
 </div>
 </>
 )}

 <p className="mt-4 flex items-start justify-center gap-1.5 text-center text-xs italic text-white/30">
 <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
 {plan.note || t("coach.defaultDisclaimer")}
 </p>

 {user && (
 <div className="mt-6 text-center">
 <button
 onClick={buildPlan}
 disabled={loading}
 className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
 >
 {loading ? (
 <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
 ) : (
 <Sparkles className="h-4 w-4" aria-hidden="true" />
 )}
 {t("coach.rebuildPlan", { cost: CREDIT_COST })}
 </button>
 </div>
 )}
 </div>
 )}
 </>
 )}

 {/* cross-link */}
 <p className="relative mt-8 text-center text-sm text-white/40">
 {t("coach.crossLinkStart")}{" "}
 <span className="font-semibold text-primary">{t("coach.crossLinkBrand")}</span>{" "}
 {t("coach.crossLinkEnd")}
 </p>
 </main>


 </div>
 );
}
