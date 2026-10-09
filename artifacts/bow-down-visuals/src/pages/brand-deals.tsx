import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Handshake, Loader2, Sparkles, Search, Users,
  CheckCircle2, AlertTriangle, Copy, Check, ChevronDown,
  BadgeDollarSign, Gift, Repeat2, FileText, Megaphone,
  Mail, MessageCircle, CalendarClock, Send, Clock, Reply, BadgeCheck,
  ArrowRight, Target, Briefcase, LayoutDashboard, PlusCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { formatBudgetRange, daysLeftLabel } from "@/lib/sponsors";
import SponsorReadPanel from "@/components/outreach/SponsorReadPanel";
import InvoiceGeneratorPanel from "@/components/outreach/InvoiceGeneratorPanel";
import SponsorPipeline from "@/components/wave8/SponsorPipeline";

/* ─── Thy Cheat Code's Sponsors Hub (ONE canonical file) ───────────────────
   Find Deals: AI matches creators with brand partnership opportunities —
   sponsored posts, affiliates, ambassadorships, gifting, usage licensing.
   POSTs to /api/brand-deals (2 credits/search) and /api/brand-deals/outreach
   (1 credit/draft) on GPT-6 Sol. Deal types + audience sizes must stay in
   sync with the backend route's enums.
   Pitch Kit (absorbed from /sponsorship-outreach): POST /api/outreach →
   2 credits per kit; includes the Wave 8 SponsorPipeline kanban
   (Pitched → Negotiating → Closed → Paid) + free outreach tracker.
   Marketplace (absorbed from /sponsors): browse posted deals
   (GET /api/sponsors/deals) + AI deal matcher (POST /api/sponsors/match).
   The wider cluster stays SEPARATE — linked from the Related row, never
   merged: /sponsors/dashboard, /sponsors/post, /sponsors/:id. */

type DealTypeKey = "sponsored-post" | "affiliate" | "ambassadorship" | "product-gifting" | "usage-licensing";

interface DealTypeOpt {
  key: DealTypeKey;
  label: string;
  icon: LucideIcon;
  blurb: string;
}

/* Display strings for these live inside the component (via t()); keys stay
   stable because deal-type/audience keys are sent to the backend. */
const DEAL_TYPE_DEFS: { key: DealTypeKey; labelKey: string; icon: LucideIcon; blurbKey: string }[] = [
  { key: "sponsored-post", labelKey: "sponsoredPost", icon: Megaphone, blurbKey: "sponsoredPost" },
  { key: "affiliate", labelKey: "affiliate", icon: Repeat2, blurbKey: "affiliate" },
  { key: "ambassadorship", labelKey: "ambassadorship", icon: Handshake, blurbKey: "ambassadorship" },
  { key: "product-gifting", labelKey: "productGifting", icon: Gift, blurbKey: "productGifting" },
  { key: "usage-licensing", labelKey: "usageLicensing", icon: FileText, blurbKey: "usageLicensing" },
];

type AudienceKey = "under-1k" | "1k-10k" | "10k-50k" | "50k-250k" | "250k-plus";

const AUDIENCE_DEFS: { key: AudienceKey; labelKey: string }[] = [
  { key: "under-1k", labelKey: "under1k" },
  { key: "1k-10k", labelKey: "k1_10k" },
  { key: "10k-50k", labelKey: "k10_50k" },
  { key: "50k-250k", labelKey: "k50_250k" },
  { key: "250k-plus", labelKey: "k250plus" },
];

const PLATFORM_PRESETS = ["TikTok", "Instagram", "YouTube", "Twitch", "X"];
/* Niche values stay English (sent to the API); only the button labels translate. */
const NICHE_DEFS: { value: string; labelKey: string }[] = [
  { value: "Music", labelKey: "music" },
  { value: "Gaming", labelKey: "gaming" },
  { value: "Fashion", labelKey: "fashion" },
  { value: "Fitness", labelKey: "fitness" },
  { value: "Beauty", labelKey: "beauty" },
  { value: "Tech", labelKey: "tech" },
  { value: "Food", labelKey: "food" },
  { value: "Lifestyle", labelKey: "lifestyle" },
];

const SEARCH_COST = 2;
const OUTREACH_COST = 1;

interface BrandDeal {
  brand: string;
  dealType: string;
  fitScore: number;
  fitReason: string;
  valueRange: string;
  outreachAngle: string;
  verifyNote: string;
}

interface FinderResponse {
  deals?: BrandDeal[];
  disclaimer?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface OutreachResponse {
  outreach?: { subject: string; message: string };
  tips?: string[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

function fitColor(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 55) return "text-amber-400";
  return "text-white/50";
}

function fitBar(score: number): string {
  if (score >= 80) return "from-emerald-500 to-emerald-300";
  if (score >= 55) return "from-amber-500 to-amber-300";
  return "from-white/40 to-white/20";
}

export default function BrandDealFinder({ initialTab }: { initialTab?: "finder" | "pitch" | "marketplace" }) {
  const { t } = useTranslation();
  const { user, profile, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  /* ── Sponsors hub: Find Deals · Pitch Kit (pipeline lives inside it) ·
     Marketplace. ?tab= deep-links (finder/pitch/marketplace); the
     /sponsorship-outreach alias redirects here with ?tab=pitch, and ?bio=
     from the press kit still lands on the Pitch Kit tab. */
  type MainTab = "finder" | "pitch" | "marketplace";
  const [mainTab, setMainTab] = useState<MainTab>(() => {
    if (initialTab) return initialTab;
    try {
      const q = new URLSearchParams(window.location.search);
      const forced = q.get("tab");
      if (forced === "pitch" || forced === "finder") return forced;
      if (forced === "pipeline") return "pitch"; // Wave 8 pipeline merged into the Pitch Kit tab
      if (forced === "marketplace") return "marketplace";
      if (window.location.pathname.startsWith("/sponsorship-outreach")) return "pitch";
      if (q.get("bio")) return "pitch";
    } catch { /* non-browser — default to finder */ }
    return "finder";
  });

  /* Translated display strings for the option grids above. */
  const DEAL_OPTS: DealTypeOpt[] = DEAL_TYPE_DEFS.map((d) => ({
    key: d.key,
    label: t(`brandDeals.dealTypes.${d.labelKey}.label`),
    icon: d.icon,
    blurb: t(`brandDeals.dealTypes.${d.blurbKey}.blurb`),
  }));
  const AUDIENCE_OPTS: { key: AudienceKey; label: string }[] = AUDIENCE_DEFS.map((a) => ({
    key: a.key,
    label: t(`brandDeals.audiences.${a.labelKey}`),
  }));

  const [niche, setNiche] = useState("Music");
  const [customNiche, setCustomNiche] = useState("");
  const [audienceSize, setAudienceSize] = useState<AudienceKey>("1k-10k");
  const [platforms, setPlatforms] = useState<string[]>(["TikTok", "Instagram"]);
  const [customPlatform, setCustomPlatform] = useState("");
  const [contentStyle, setContentStyle] = useState("");
  const [dealTypes, setDealTypes] = useState<DealTypeKey[]>(["sponsored-post", "affiliate", "ambassadorship"]);
  const [creatorName, setCreatorName] = useState("");

  /* Deep link from the brand calculator — niche and rate card flow through. */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const n = q.get("niche");
    const r = q.get("rate");
    if (n) setCustomNiche(n);
    if (r) {
      try { localStorage.setItem("bdv_rate_card", JSON.stringify({ rate: r, at: Date.now() })); } catch { /* ignore */ }
    }
    if (n || r) {
      const next = (() => { q.delete("niche"); q.delete("rate"); const s = q.toString(); return s ? `?${s}` : ""; })();
      window.history.replaceState({}, "", `${window.location.pathname}${next}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [deals, setDeals] = useState<BrandDeal[] | null>(null);
  const [disclaimer, setDisclaimer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [outreachFor, setOutreachFor] = useState<number | null>(null);
  const [outreach, setOutreach] = useState<{ subject: string; message: string } | null>(null);
  const [outreachTips, setOutreachTips] = useState<string[]>([]);
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [outreachError, setOutreachError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function toggleDealType(key: DealTypeKey) {
    setDealTypes((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]));
  }

  function togglePlatform(p: string) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function addCustomPlatform() {
    const p = customPlatform.trim().slice(0, 50);
    if (p && !platforms.includes(p)) setPlatforms((prev) => [...prev, p].slice(0, 8));
    setCustomPlatform("");
  }

  async function authedPost(endpoint: string, body: unknown) {
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

  async function huntDeals() {
    if (loading || !user) return;
    const finalNiche = (customNiche.trim() || niche).slice(0, 100);
    if (!finalNiche) {
      setError(t("brandDeals.errorNiche"));
      return;
    }
    if (platforms.length === 0) {
      setError(t("brandDeals.errorPlatforms"));
      return;
    }
    if (!contentStyle.trim()) {
      setError(t("brandDeals.errorContentStyle"));
      return;
    }
    if (dealTypes.length === 0) {
      setError(t("brandDeals.errorDealTypes"));
      return;
    }

    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setDeals(null);
    setOutreachFor(null);
    setOutreach(null);
    try {
      const res = await authedPost("/api/brand-deals", {
        niche: finalNiche,
        audienceSize,
        platforms,
        contentStyle: contentStyle.trim().slice(0, 200),
        dealTypes,
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as FinderResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.deals) || data.deals.length === 0) {
        throw new Error(data.message || data.error || t("brandDeals.errorHuntFailed"));
      }
      setDeals(data.deals);
      setDisclaimer(data.disclaimer || "");
      refreshProfile();
      setTimeout(() => {
        document.getElementById("deal-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("brandDeals.errorHuntFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function draftOutreach(index: number, deal: BrandDeal) {
    if (outreachLoading || !user) return;
    const name = creatorName.trim() || profile?.display_name || "Independent Creator";
    setOutreachFor(index);
    setOutreach(null);
    setOutreachTips([]);
    setOutreachError(null);
    setOutreachLoading(true);
    try {
      const res = await authedPost("/api/brand-deals/outreach", {
        brand: deal.brand,
        dealType: deal.dealType,
        creatorName: name.slice(0, 100),
        niche: (customNiche.trim() || niche).slice(0, 100),
        audienceSize,
        platforms,
        contentStyle: contentStyle.trim().slice(0, 200),
      });
      if (!res) {
        setOutreachFor(null);
        return; // user cancelled the credit confirmation
      }
      const data = (await res.json().catch(() => ({}))) as OutreachResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        setOutreachFor(null);
        return;
      }
      if (!res.ok || !data.outreach?.subject || !data.outreach?.message) {
        throw new Error(data.message || data.error || t("brandDeals.errorOutreachFailed"));
      }
      setOutreach(data.outreach);
      setOutreachTips(data.tips ?? []);
      refreshProfile();
    } catch (err) {
      setOutreachError(err instanceof Error ? err.message : t("brandDeals.errorOutreachFailed"));
    } finally {
      setOutreachLoading(false);
    }
  }

  function copyOutreach() {
    if (!outreach) return;
    void navigator.clipboard
      .writeText(`Subject: ${outreach.subject}\n\n${outreach.message}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
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
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Handshake className="h-3 w-3" aria-hidden="true" /> {t("brandDeals.heroBadge")}
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            {t("brandDeals.title")} <span className="text-primary">{t("brandDeals.titleAccent")}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            {t("brandDeals.subtitle")}
          </p>
          <p className="mx-auto mt-3 max-w-xl text-xs text-white/40">
            {t("brandDeals.finderExplainer", { defaultValue: "This is the finder — AI hunts down brands that fit you. When a brand posts a deal for creators to apply to, that's the " })}
            <button onClick={() => setMainTab("marketplace")} className="font-semibold text-primary hover:underline">{t("brandDeals.marketplaceLink", { defaultValue: "Sponsor Marketplace" })}</button>.
          </p>
        </div>

        {/* ── Sponsors hub tabs: Find Deals · Pitch Kit · Marketplace ── */}
        <div className="relative mt-8 flex flex-wrap justify-center gap-2">
          {(
            [
              { key: "finder", label: t("brandDeals.tabs.finder", { defaultValue: "Find deals" }), icon: Search },
              { key: "pitch", label: t("outreach.tabs.pitchKit", { defaultValue: "Pitch kit" }), icon: Mail },
              { key: "marketplace", label: t("brandDeals.tabs.marketplace", { defaultValue: "Marketplace" }), icon: Briefcase },
            ] as { key: MainTab; label: string; icon: LucideIcon }[]
          ).map((tb) => {
            const Icon = tb.icon;
            const active = mainTab === tb.key;
            return (
              <button
                key={tb.key}
                onClick={() => setMainTab(tb.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                    : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tb.label}
              </button>
            );
          })}
        </div>

        {/* Related — the wider sponsor cluster (separate pages, linked not merged) */}
        <p className="relative mt-4 text-center text-xs text-white/40">
          {t("brandDeals.related.label", { defaultValue: "Related:" })}{" "}
          <Link href="/sponsors/dashboard" className="font-semibold text-primary hover:underline">
            {t("brandDeals.related.sponsorDashboard", { defaultValue: "Sponsor dashboard" })}
          </Link>
          {" · "}
          <Link href="/sponsors/post" className="font-semibold text-primary hover:underline">
            {t("brandDeals.related.postDeal", { defaultValue: "Post a deal" })}
          </Link>
        </p>

        {mainTab === "finder" && (
        <>
        {/* Thy Cheat Code's coaching callout */}
        <div className="relative mt-8 flex gap-3 rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/10 to-transparent p-4">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="text-sm leading-relaxed text-white/70">
            <span className="font-bold text-primary">{t("brandDeals.coachingTake")}</span>{" "}
            {t("brandDeals.coachingText1")}<em>{t("brandDeals.coachingTextEm")}</em>{t("brandDeals.coachingText2")}
          </div>
        </div>

        {/* ── INPUTS ─────────────────────────────────────────────────── */}
        <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          {/* niche + audience */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("brandDeals.nicheLabel")}
              </p>
              <input
                value={customNiche}
                onChange={(e) => setCustomNiche(e.target.value)}
                maxLength={100}
                placeholder={niche}
                className={inputClass}
              />
              <div className="mt-2 flex flex-wrap gap-1.5" data-min-stars="2">
                {NICHE_DEFS.map((n) => (
                  <button
                    key={n.value}
                    onClick={() => { setNiche(n.value); setCustomNiche(""); }}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                      !customNiche.trim() && niche === n.value
                        ? "bg-primary text-black"
                        : "border border-white/10 text-white/50 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {t(`brandDeals.niches.${n.labelKey}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40" data-min-stars="2">
                <Users className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> {t("brandDeals.audienceLabel")}
              </p>
              <div className="flex flex-wrap gap-2" data-min-stars="2">
                {AUDIENCE_OPTS.map((a) => (
                  <button
                    key={a.key}
                    onClick={() => setAudienceSize(a.key)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      audienceSize === a.key
                        ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                        : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <p className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-widest text-white/40" data-min-stars="3">
                {t("brandDeals.nameLabel")} <span className="text-white/25 normal-case tracking-normal">{t("brandDeals.nameLabelHint")}</span>
              </p>
              <input
                value={creatorName}
                data-min-stars="3"
                onChange={(e) => setCreatorName(e.target.value)}
                maxLength={100}
                placeholder={t("brandDeals.namePlaceholder")}
                className={inputClass}
              />
            </div>
          </div>

          {/* platforms */}
          <p className="mb-3 mt-8 text-[11px] font-bold uppercase tracking-widest text-white/40" data-min-stars="2">
            {t("brandDeals.platformsLabel")}
          </p>
          <div className="flex flex-wrap gap-2" data-min-stars="2">
            {PLATFORM_PRESETS.map((p) => {
              const selected = platforms.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    selected
                      ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                      : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <input
              value={customPlatform}
              onChange={(e) => setCustomPlatform(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomPlatform(); } }}
              maxLength={50}
              placeholder={t("brandDeals.addPlatformPlaceholder")}
              className="w-36 rounded-full border border-dashed border-white/20 bg-transparent px-4 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-primary/60"
            />
          </div>

          {/* content style */}
          <p className="mb-3 mt-8 text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("brandDeals.contentStyleLabel")}
          </p>
          <textarea
            value={contentStyle}
            onChange={(e) => setContentStyle(e.target.value)}
            maxLength={200}
            rows={2}
            placeholder={t("brandDeals.contentStylePlaceholder")}
            className={`${inputClass} resize-none`}
          />

          {/* deal types */}
          <p className="mb-3 mt-8 text-[11px] font-bold uppercase tracking-widest text-white/40" data-min-stars="2">
            {t("brandDeals.dealTypesLabel")}
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" data-min-stars="2">
            {DEAL_OPTS.map((d) => {
              const Icon = d.icon;
              const selected = dealTypes.includes(d.key);
              return (
                <button
                  key={d.key}
                  onClick={() => toggleDealType(d.key)}
                  className={`rounded-2xl border p-3.5 text-left transition ${
                    selected
                      ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                      : "border-white/10 bg-white/[0.03] hover:border-primary/30"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
                        selected ? "border-primary bg-primary text-black" : "border-white/25 text-transparent"
                      }`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <Icon className={`h-5 w-5 ${selected ? "text-primary" : "text-white/50"}`} aria-hidden="true" />
                  </span>
                  <span className={`mt-2 block text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>
                    {d.label}
                  </span>
                  <span className="block text-[11px] text-white/35">{d.blurb}</span>
                </button>
              );
            })}
          </div>

          {error && (
            <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </div>
          )}

          <button
            onClick={huntDeals}
            disabled={loading || !user}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-base font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> {t("brandDeals.huntingButton")}
              </>
            ) : (
              <>
                <Search className="h-5 w-5" aria-hidden="true" /> {t("brandDeals.huntButton", { n: SEARCH_COST })}
              </>
            )}
          </button>
          {!user && (
            <p className="mt-3 text-center text-xs text-white/40">{t("brandDeals.signInNote")}</p>
          )}
        </div>

        {outOfCredits && (
          <div className="mt-8">
            <OutOfCredits />
          </div>
        )}

        {/* ── RESULTS ────────────────────────────────────────────────── */}
        {deals && (
          <div id="deal-results" className="relative mt-12">
            <h2 className="font-display text-2xl font-black tracking-tight">
              {t("brandDeals.resultsTitle")} <span className="text-primary">{t("brandDeals.resultsCount", { n: deals.length })}</span>
            </h2>
            {disclaimer && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] leading-relaxed text-amber-200/90">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {disclaimer}
              </div>
            )}
            <div className="mt-6 space-y-5">
              {deals.map((deal, i) => {
                const drafting = outreachFor === i;
                return (
                  <div
                    key={i}
                    className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#14100a] to-black"
                  >
                    <div className="p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-black leading-snug">{deal.brand}</h3>
                          <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-primary/80">
                            {deal.dealType}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`font-display text-2xl font-black ${fitColor(deal.fitScore)}`}>
                            {deal.fitScore}
                          </p>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">{t("brandDeals.fitScore")}</p>
                        </div>
                      </div>

                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${fitBar(deal.fitScore)}`}
                          style={{ width: `${deal.fitScore}%` }}
                        />
                      </div>

                      <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/[0.06] p-4">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-primary/80">{t("brandDeals.fitReasonTitle")}</p>
                        <p className="mt-1.5 text-sm leading-relaxed text-white/75">{deal.fitReason}</p>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
                            <BadgeDollarSign className="h-3.5 w-3.5" aria-hidden="true" /> {t("brandDeals.estValue")}
                          </p>
                          <p className="mt-1.5 text-sm leading-relaxed text-white/75">{deal.valueRange}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
                            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t("brandDeals.outreachAngle")}
                          </p>
                          <p className="mt-1.5 text-sm leading-relaxed text-white/75">{deal.outreachAngle}</p>
                        </div>
                      </div>

                      {deal.verifyNote && (
                        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-amber-200/70">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {t("brandDeals.verifyPrefix")} {deal.verifyNote}
                        </p>
                      )}

                      <button
                        onClick={() => (drafting ? setOutreachFor(null) : draftOutreach(i, deal))}
                        disabled={outreachLoading}
                        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
                      >
                        {outreachLoading && drafting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("brandDeals.draftingButton")}
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" aria-hidden="true" />
                            {drafting ? t("brandDeals.hideDraft") : t("brandDeals.draftButton", { n: OUTREACH_COST })}
                            <ChevronDown className={`h-4 w-4 transition ${drafting ? "rotate-180" : ""}`} aria-hidden="true" />
                          </>
                        )}
                      </button>

                      {drafting && (
                        <div className="mt-4 rounded-2xl border border-white/10 bg-black/60 p-5">
                          {outreachError && (
                            <p className="flex items-start gap-2 text-sm text-red-300">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                              {outreachError}
                            </p>
                          )}
                          {outreach && !outreachLoading && (
                            <>
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-sm font-bold">
                                  <span className="text-white/40">{t("brandDeals.subjectPrefix")}</span>{" "}
                                  {outreach.subject}
                                </p>
                                <button
                                  onClick={copyOutreach}
                                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-primary/50 hover:text-primary"
                                >
                                  {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                                  {copied ? t("brandDeals.copied") : t("brandDeals.copyButton")}
                                </button>
                              </div>
                              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-white/75">{outreach.message}</p>
                              {outreachTips.length > 0 && (
                                <div className="mt-4 border-t border-white/10 pt-4">
                                  <p className="text-[11px] font-bold uppercase tracking-widest text-primary/80">
                                    {t("brandDeals.tipsTitle")}
                                  </p>
                                  <ul className="mt-2 space-y-1.5">
                                    {outreachTips.map((t, ti) => (
                                      <li key={ti} className="flex items-start gap-2 text-[13px] text-white/60">
                                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
                                        {t}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </>
        )}

        {/* ── PITCH KIT TAB — absorbed from /sponsorship-outreach ── */}
        {mainTab === "pitch" && (
          <div className="relative mt-4">
            <PitchKitTab onFindDeals={() => setMainTab("finder")} />
          </div>
        )}

        {/* ── MARKETPLACE TAB — absorbed from /sponsors ── */}
        {mainTab === "marketplace" && (
          <div className="relative mt-4">
            <MarketplaceTab />
          </div>
        )}
      </main>


    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   PITCH KIT TAB — the full /sponsorship-outreach page, absorbed as a tab.
   AI-crafted pitch kit: POST /api/outreach → 2 credits per kit (pitch email
   + DM version + media kit summary + 3-step follow-up sequence). Generated
   kits auto-save into the free tracker (localStorage, shared with the Deal
   Pipeline tab). Handoffs preserved: ?bio= from the press kit, rate card
   from the brand calculator, creator identity from the vault, and the
   → /sponsors marketplace tip. */

const PITCH_KIT_COST = 2;

const OUTREACH_PLATFORMS = ["tiktok", "instagram", "youtube", "twitch", "twitter", "facebook"];

interface PitchFollowUp {
  day: number;
  subject: string;
  body: string;
}

interface PitchOutreachKit {
  pitchEmail: { subject: string; body: string };
  dmVersion: string;
  mediaKitSummary: string;
  followUps: PitchFollowUp[];
  disclaimer: string;
}

interface PitchOutreachResponse {
  kit?: PitchOutreachKit;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

type TrackStatus = "sent" | "followed-up" | "replied" | "booked";

interface TrackedOutreach {
  id: string;
  brandName: string;
  creatorName: string;
  createdAt: string;
  status: TrackStatus;
}

const TRACK_KEY = "bdv-outreach-tracker";

const STATUS_META: Record<TrackStatus, { labelKey: string; icon: LucideIcon; color: string }> = {
  sent: { labelKey: "outreach.statusSent", icon: Send, color: "text-sky-400" },
  "followed-up": { labelKey: "outreach.statusFollowedUp", icon: Clock, color: "text-amber-400" },
  replied: { labelKey: "outreach.statusReplied", icon: Reply, color: "text-violet-400" },
  booked: { labelKey: "outreach.statusBooked", icon: BadgeCheck, color: "text-emerald-400" },
};

const outreachLabelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/50";

function loadOutreachTracker(): TrackedOutreach[] {
  try {
    const raw = localStorage.getItem(TRACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function KitCopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-white"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t("outreach.copied") : t("outreach.copy")}
    </button>
  );
}

function PitchKitTab({ onFindDeals }: { onFindDeals: () => void }) {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { activeArtist } = useActiveArtist();

  /* creator profile */
  const [creatorName, setCreatorName] = useState("");
  const [niche, setNiche] = useState("");
  const [audienceSize, setAudienceSize] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["tiktok", "instagram"]);
  const [engagement, setEngagement] = useState("");
  const [notableWins, setNotableWins] = useState("");

  /* brand / target */
  const [brandName, setBrandName] = useState("");
  const [product, setProduct] = useState("");
  const [campaignGoal, setCampaignGoal] = useState("");
  const [contactName, setContactName] = useState("");

  const [kit, setKit] = useState<PitchOutreachKit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* Deep links: ?bio= from the press kit; the rate card from the calculator
     rides in localStorage; the vault fills creator identity. */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const bio = q.get("bio");
    if (bio) {
      setNotableWins((w) => (w ? `${w}\n${bio}` : bio));
      q.delete("bio");
      const s = q.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
    }
    try {
      const raw = localStorage.getItem("bdv_rate_card");
      if (raw) {
        const rc = JSON.parse(raw) as { rate?: string; at?: number };
        if (rc.rate && (!rc.at || Date.now() - rc.at < 24 * 3600_000)) {
          setNotableWins((w) => (w ? w : `Rate card: ${rc.rate}`));
        }
      }
    } catch { /* ignore */ }
    /* The vault knows the creator — prefill identity once. */
    if (activeArtist) {
      if (activeArtist.artist_name) { setCreatorName((c) => c || activeArtist.artist_name); }
      if (activeArtist.genre) { setNiche((n) => n || (activeArtist.genre as string)); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePlatform(p: string) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function generateKit() {
    if (loading || !user) return;
    if (!creatorName.trim() || !niche.trim() || !audienceSize.trim() || !brandName.trim() || platforms.length === 0) {
      setError(t("outreach.fillRequired"));
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/outreach", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: PITCH_KIT_COST, // registry is stale at 1; backend + UI agree on 2
        overrideFeature: "Outreach",
        body: JSON.stringify({
          creatorName: creatorName.trim(),
          niche: niche.trim(),
          audienceSize: audienceSize.trim(),
          platforms,
          engagement: engagement.trim(),
          notableWins: notableWins.trim(),
          brandName: brandName.trim(),
          product: product.trim(),
          campaignGoal: campaignGoal.trim(),
          contactName: contactName.trim(),
        }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as PitchOutreachResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.kit) {
        throw new Error(data.message || data.error || t("outreach.kitFailed"));
      }
      setKit(data.kit);
      refreshProfile();
      /* auto-add to the free tracker as sent (shared with the Deal Pipeline tab) */
      const entry: TrackedOutreach = {
        id: `${Date.now()}`,
        brandName: brandName.trim(),
        creatorName: creatorName.trim(),
        createdAt: new Date().toISOString(),
        status: "sent",
      };
      try {
        localStorage.setItem(TRACK_KEY, JSON.stringify([entry, ...loadOutreachTracker()]));
      } catch { /* storage full or unavailable — tracker just won't persist */ }
      setTimeout(() => {
        document.getElementById("outreach-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("outreach.kitFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {/* compact section heading */}
      <div className="text-center">
        <h2 className="font-display text-2xl font-black tracking-tight md:text-3xl">
          {t("outreach.heroTitle")} <span className="text-primary">{t("outreach.heroTitleAccent")}</span>
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-white/55">
          {t("outreach.heroDescription")}
        </p>
        <p className="mx-auto mt-3 max-w-xl text-xs text-white/40">
          {t("outreach.pitchExplainer", { defaultValue: "Your pitch kit — emails and DMs that land sponsors. Found a brand in the finder? Draft your pitch right here." })}{" "}
          <button onClick={onFindDeals} className="font-semibold text-primary hover:underline">
            {t("outreach.brandDealsLink", { defaultValue: "← Back to the deal finder" })}
          </button>
        </p>
      </div>

      {/* form */}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {/* creator card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
            <Sparkles className="h-4 w-4" /> {t("outreach.creatorProfile")}
          </h3>
          <div className="mt-4 space-y-4">
            <div>
              <label className={outreachLabelClass} htmlFor="pitch-creator">{t("outreach.creatorNameLabel")}</label>
              <input id="pitch-creator" className={inputClass} value={creatorName} onChange={(e) => setCreatorName(e.target.value)} placeholder={t("outreach.creatorNamePlaceholder")} maxLength={100} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={outreachLabelClass} htmlFor="pitch-niche">{t("outreach.nicheLabel")}</label>
                <input id="pitch-niche" className={inputClass} value={niche} onChange={(e) => setNiche(e.target.value)} placeholder={t("outreach.nichePlaceholder")} maxLength={100} />
              </div>
              <div>
                <label className={outreachLabelClass} htmlFor="pitch-audience">{t("outreach.audienceLabel")}</label>
                <input id="pitch-audience" className={inputClass} value={audienceSize} onChange={(e) => setAudienceSize(e.target.value)} placeholder={t("outreach.audiencePlaceholder")} maxLength={50} />
              </div>
            </div>
            <div>
              <span className={outreachLabelClass}>{t("outreach.platformsLabel")}</span>
              <div className="flex flex-wrap gap-2">
                {OUTREACH_PLATFORMS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition ${
                      platforms.includes(p)
                        ? "bg-primary text-black"
                        : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={outreachLabelClass} htmlFor="pitch-engagement">{t("outreach.engagementLabel")}</label>
              <input id="pitch-engagement" className={inputClass} value={engagement} onChange={(e) => setEngagement(e.target.value)} placeholder={t("outreach.engagementPlaceholder")} maxLength={200} />
            </div>
            <div>
              <label className={outreachLabelClass} htmlFor="pitch-wins">{t("outreach.winsLabel")}</label>
              <textarea id="pitch-wins" className={inputClass} rows={2} value={notableWins} onChange={(e) => setNotableWins(e.target.value)} placeholder={t("outreach.winsPlaceholder")} maxLength={500} />
            </div>
          </div>
        </div>

        {/* brand card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
            <Handshake className="h-4 w-4" /> {t("outreach.brandTitle")}
          </h3>
          <div className="mt-4 space-y-4">
            <div>
              <label className={outreachLabelClass} htmlFor="pitch-brand">{t("outreach.brandNameLabel")}</label>
              <input id="pitch-brand" className={inputClass} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder={t("outreach.brandNamePlaceholder")} maxLength={100} />
            </div>
            <div>
              <label className={outreachLabelClass} htmlFor="pitch-product">{t("outreach.productLabel")}</label>
              <input id="pitch-product" className={inputClass} value={product} onChange={(e) => setProduct(e.target.value)} placeholder={t("outreach.productPlaceholder")} maxLength={200} />
            </div>
            <div>
              <label className={outreachLabelClass} htmlFor="pitch-goal">{t("outreach.goalLabel")}</label>
              <input id="pitch-goal" className={inputClass} value={campaignGoal} onChange={(e) => setCampaignGoal(e.target.value)} placeholder={t("outreach.goalPlaceholder")} maxLength={300} />
            </div>
            <div>
              <label className={outreachLabelClass} htmlFor="pitch-contact">{t("outreach.contactLabel")}</label>
              <input id="pitch-contact" className={inputClass} value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={t("outreach.contactPlaceholder")} maxLength={100} />
            </div>
            <p className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs leading-relaxed text-white/45">
              {t("outreach.tipPrefix")} <span className="text-primary">{t("outreach.tipMarketplace")}</span> {t("outreach.tipSuffix")}
            </p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="mt-8 text-center">
        <button
          onClick={generateKit}
          disabled={loading || !user}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3.5 text-sm font-bold text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? t("outreach.writingKit") : t("outreach.generateKit", { cost: PITCH_KIT_COST })}
        </button>
        {!user && <p className="mt-3 text-xs text-white/40">{t("outreach.signInPrompt")}</p>}
        {error && <p className="mx-auto mt-4 max-w-md text-sm text-red-400">{error}</p>}
        {outOfCredits && (
          <div className="mx-auto mt-4 max-w-md">
            <OutOfCredits />
          </div>
        )}
      </div>

      {/* results */}
      {kit && (
        <div id="outreach-results" className="mt-12 space-y-6">
          {/* pitch email */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
                <Mail className="h-4 w-4" /> {t("outreach.pitchEmail")}
              </h3>
              <KitCopyButton text={`${t("outreach.subjectPrefix")}${kit.pitchEmail.subject}\n\n${kit.pitchEmail.body}`} />
            </div>
            <p className="mt-4 text-sm font-semibold text-white">{t("outreach.subjectPrefix")}{kit.pitchEmail.subject}</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/70">{kit.pitchEmail.body}</p>
          </section>

          {/* DM version */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
                <MessageCircle className="h-4 w-4" /> {t("outreach.dmVersion")}
              </h3>
              <KitCopyButton text={kit.dmVersion} />
            </div>
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-white/70">{kit.dmVersion}</p>
          </section>

          {/* media kit summary */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
                <FileText className="h-4 w-4" /> {t("outreach.mediaKitSummary")}
              </h3>
              <KitCopyButton text={kit.mediaKitSummary} />
            </div>
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-white/70">{kit.mediaKitSummary}</p>
          </section>

          {/* follow-ups */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
              <CalendarClock className="h-4 w-4" /> {t("outreach.followUpSequence")}
            </h3>
            <div className="mt-4 space-y-4">
              {kit.followUps.map((f, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wider text-white/50">
                      {t("outreach.followUpDay", { day: f.day })} · {f.subject}
                    </p>
                    <KitCopyButton text={`${t("outreach.subjectPrefix")}${f.subject}\n\n${f.body}`} />
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/70">{f.body}</p>
                </div>
              ))}
            </div>
          </section>

          <p className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-xs leading-relaxed text-amber-200/80">
            {kit.disclaimer}
          </p>
        </div>
      )}

      {/* sponsor read generator — deal landed? write the actual spoken read */}
      <div className="mt-4">
        <SponsorReadPanel />
      </div>

      {/* invoice generator — deal landed? bill the brand. Prefilled from the
          pitch form above (brand) and the creator profile / active artist. */}
      <div>
        <InvoiceGeneratorPanel
          prefillBrand={brandName}
          prefillCreator={creatorName || activeArtist?.artist_name || ""}
        />
      </div>

      {/* ── DEAL PIPELINE — Wave 8 SponsorPipeline kanban (Pitched →
          Negotiating → Closed → Paid) + free outreach tracker, inside the
          Pitch Kit tab. Paid → /api/money income-ledger handoff intact. */}
      <div className="mt-12 border-t border-white/10 pt-12">
        <PipelineTab />
      </div>
    </div>
  );
}

/* ─── Deal Pipeline tab ────────────────────────────────────────────────────
   Wave 8's SponsorPipeline kanban (Pitched → Negotiating → Closed → Paid
   with AI follow-up drafts) plus the free client-side outreach tracker,
   ported from /sponsorship-outreach. */

function PipelineTab() {
  const { t } = useTranslation();

  const [tracked, setTracked] = useState<TrackedOutreach[]>([]);
  useEffect(() => {
    setTracked(loadOutreachTracker());
  }, []);

  function saveTracker(next: TrackedOutreach[]) {
    setTracked(next);
    try {
      localStorage.setItem(TRACK_KEY, JSON.stringify(next));
    } catch {
      /* storage full or unavailable — tracker just won't persist */
    }
  }

  function setStatus(id: string, status: TrackStatus) {
    saveTracker(tracked.map((item) => (item.id === id ? { ...item, status } : item)));
  }

  function removeTracked(id: string) {
    saveTracker(tracked.filter((item) => item.id !== id));
  }

  return (
    <div>
      <div className="text-center">
        <h2 className="font-display text-2xl font-black tracking-tight md:text-3xl">
          {t("outreach.pipelineTitle", { defaultValue: "Sponsor Deal Pipeline" })}
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-white/55">
          {t("outreach.pipelineSubtitle", { defaultValue: "Every deal from first pitch to paid — drag them through, let the AI draft your follow-ups, and log the win when it lands." })}
        </p>
      </div>

      {/* Wave 8 kanban: Pitched → Negotiating → Closed → Paid, AI follow-up drafts */}
      <div className="mt-8">
        <SponsorPipeline />
      </div>

      {/* free tracker — fed automatically by pitch kits generated above */}
      <div className="mt-12">
        <h3 className="text-center text-sm font-bold uppercase tracking-widest text-white/60">
          {t("outreach.trackerTitle")} <span className="text-primary">{t("outreach.trackerFree")}</span>
        </h3>
        {tracked.length === 0 ? (
          <p className="mt-4 text-center text-sm text-white/40">
            {t("outreach.trackerEmpty")}
          </p>
        ) : (
          <div className="mt-6 space-y-3">
            {tracked.map((item) => {
              const meta = STATUS_META[item.status];
              const Icon = meta.icon;
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-white">{item.brandName}</p>
                    <p className="text-xs text-white/40">
                      {item.creatorName} · {new Date(item.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.color}`}>
                    <Icon className="h-3.5 w-3.5" /> {t(meta.labelKey)}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(STATUS_META) as TrackStatus[]).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStatus(item.id, s)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                          item.status === s
                            ? "bg-primary text-black"
                            : "border border-white/10 text-white/50 hover:border-primary/40 hover:text-white"
                        }`}
                      >
                        {t(STATUS_META[s].labelKey)}
                      </button>
                    ))}
                    <button
                      onClick={() => removeTracked(item.id)}
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-white/40 transition hover:text-red-400"
                    >
                      {t("outreach.remove")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   MARKETPLACE TAB — the two-sided Sponsor Marketplace, absorbed from
   /sponsors as the hub's third tab. Brands post paid sponsorship deals,
   creators apply with a pitch — Bow Down Visuals takes 15% of every
   released deal.
   Money rules: browsing is free (pure UI); the AI deal matcher is 1 credit;
   posting a deal lives on /sponsors/post (5 credits).
   Endpoints: GET /api/sponsors/deals, POST /api/sponsors/match. */

interface MarketplaceDeal {
  id: string;
  brandName: string;
  budgetMin: number;
  budgetMax: number;
  niche: string;
  deliverables: string;
  description: string;
  deadline: string;
  status: string;
  createdAt: string;
}

interface DealMatch {
  dealId: string;
  brandName: string;
  score: number;
  why: string;
}

const MATCHER_COST = 1;

const marketplaceSectionLabel =
  "mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40";

function MarketplaceTab() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [deals, setDeals] = useState<MarketplaceDeal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [nicheFilter, setNicheFilter] = useState("");

  // AI deal matcher
  const [matchNiche, setMatchNiche] = useState("");
  const [matchFollowers, setMatchFollowers] = useState("");
  const [matchPlatforms, setMatchPlatforms] = useState("");
  const [matches, setMatches] = useState<DealMatch[]>([]);
  const [matchNote, setMatchNote] = useState("");
  const [matchLoading, setMatchLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async function loadDeals() {
    if (!user) {
      setDealsLoading(false);
      return;
    }
    setDealsLoading(true);
    setDealsError(null);
    try {
      const res = await fetch("/api/sponsors/deals", { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as { deals?: MarketplaceDeal[]; error?: string };
      if (!res.ok) throw new Error(data.error || t("sponsors.errorLoadDeals"));
      setDeals(Array.isArray(data.deals) ? data.deals : []);
    } catch (err) {
      setDealsError(err instanceof Error ? err.message : t("sponsors.errorLoadDeals"));
    } finally {
      setDealsLoading(false);
    }
  }

  useEffect(() => {
    loadDeals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function runMatcher() {
    if (!matchNiche.trim()) {
      setError(t("sponsors.errorNicheFirst"));
      return;
    }
    setMatchLoading(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/sponsors/match", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          niche: matchNiche.trim(),
          followers: Number(matchFollowers.replace(/[^0-9]/g, "")) || 0,
          platforms: matchPlatforms.split(",").map((p) => p.trim()).filter(Boolean).slice(0, 5),
        }),
      });
      if (!res) return; /* user cancelled the credit confirmation */
      const data = (await res.json().catch(() => ({}))) as {
        matches?: DealMatch[]; note?: string; error?: string; creditsRemaining?: number;
      };
      if (res.status === 402) {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) throw new Error(data.error || t("sponsors.errorMatcher"));
      setMatches(Array.isArray(data.matches) ? data.matches : []);
      setMatchNote(data.note || "");
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sponsors.errorMatcher"));
    } finally {
      setMatchLoading(false);
    }
  }

  const filtered = nicheFilter.trim()
    ? deals.filter((d) => d.niche.toLowerCase().includes(nicheFilter.trim().toLowerCase()))
    : deals;

  return (
    <div>
      {/* compact section heading (the hub owns the page hero) */}
      <div className="text-center">
        <h2 className="font-display text-2xl font-black tracking-tight md:text-3xl">
          {t("sponsors.pageTitleA")} <span className="text-primary">{t("sponsors.pageTitleAccent")}</span> {t("sponsors.pageTitleB")}
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-white/55">
          {t("sponsors.pageSubtitle")}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Link href="/sponsors/dashboard"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:border-primary/50 hover:text-white">
            <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> {t("sponsors.myDashboard")}
          </Link>
          <Link href="/sponsors/post"
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-4 py-2.5 text-sm font-black text-black shadow-[0_4px_24px_rgba(212,175,55,0.35)] transition hover:scale-[1.03]">
            <PlusCircle className="h-4 w-4" aria-hidden="true" /> {t("sponsors.postDeal")}
          </Link>
        </div>
      </div>

      {error && (
        <p className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>
      )}

      {/* filter */}
      <div className="mt-8 flex max-w-sm items-center gap-2" data-min-stars="2">
        <input value={nicheFilter} onChange={(e) => setNicheFilter(e.target.value)} maxLength={60}
          placeholder={t("sponsors.filterPlaceholder")} className={inputClass} />
      </div>

      {/* deals grid */}
      <div className="mt-6">
        {!user ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <p className="text-white/60">{t("sponsors.signInPrompt")}</p>
            <Link href="/login"
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-6 py-3 font-bold text-primary transition hover:bg-primary hover:text-black">
              {t("sponsors.signIn")} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        ) : dealsLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-white/40">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> {t("sponsors.loadingDeals")}
          </div>
        ) : dealsError ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{dealsError}</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <Handshake className="mx-auto h-10 w-10 text-primary/60" aria-hidden="true" />
            <p className="mt-3 font-bold text-white">{deals.length === 0 ? t("sponsors.emptyNoDeals") : t("sponsors.emptyNoMatch")}</p>
            <p className="mt-1 text-sm text-white/50">
              {deals.length === 0 ? t("sponsors.emptyNoDealsHint") : t("sponsors.emptyNoMatchHint")}
            </p>
            {deals.length === 0 && (
              <Link href="/sponsors/post"
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 font-black text-black transition hover:brightness-110">
                <Megaphone className="h-4 w-4" aria-hidden="true" /> {t("sponsors.postFirstDeal")}
              </Link>
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {filtered.map((d) => (
              <Link key={d.id} href={`/sponsors/${d.id}`}
                className="group rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-primary/40 hover:bg-white/[0.05]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-lg font-black text-white">
                      <Briefcase className="h-4 w-4 text-primary/70" aria-hidden="true" />
                      {d.brandName}
                    </p>
                    <p className="mt-0.5 text-xs uppercase tracking-wider text-white/40">{d.niche}</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-black text-primary">
                    <BadgeDollarSign className="h-4 w-4" aria-hidden="true" />
                    {formatBudgetRange(d.budgetMin, d.budgetMax)}
                  </span>
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-white/70">{d.description}</p>
                <div className="mt-4 flex items-center justify-between text-[13px] text-white/55">
                  <p className="inline-flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5 text-primary/70" aria-hidden="true" />
                    {daysLeftLabel(d.deadline)}
                  </p>
                  <span className="inline-flex items-center gap-1 font-bold text-primary opacity-0 transition group-hover:opacity-100">
                    {t("sponsors.viewDeal")} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── AI DEAL MATCHER ──────────────────────────────────────── */}
      <div className="relative mt-12 rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
          <Target className="h-3.5 w-3.5" aria-hidden="true" /> {t("sponsors.matcherEyebrow", { cost: MATCHER_COST })}
        </p>
        <h2 className="font-display text-2xl font-black">{t("sponsors.matcherTitleA")} <span className="text-primary">{t("sponsors.matcherTitleAccent")}</span></h2>
        <p className="mt-2 max-w-xl text-sm text-white/55">
          {t("sponsors.matcherSubtitle")}
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <p className={marketplaceSectionLabel}>{t("sponsors.matchNicheLabel")}</p>
            <input value={matchNiche} onChange={(e) => setMatchNiche(e.target.value)} maxLength={120}
              placeholder={t("sponsors.matchNichePlaceholder")} className={inputClass} />
          </div>
          <div data-min-stars="3">
            <p className={marketplaceSectionLabel}>{t("sponsors.matchFollowersLabel")}</p>
            <input value={matchFollowers} onChange={(e) => setMatchFollowers(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
              inputMode="numeric" placeholder={t("sponsors.matchFollowersPlaceholder")} className={inputClass} />
          </div>
          <div data-min-stars="3">
            <p className={marketplaceSectionLabel}>{t("sponsors.matchPlatformsLabel")}</p>
            <input value={matchPlatforms} onChange={(e) => setMatchPlatforms(e.target.value)} maxLength={200}
              placeholder={t("sponsors.matchPlatformsPlaceholder")} className={inputClass} />
          </div>
        </div>
        <button onClick={runMatcher} disabled={matchLoading}
          className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-7 py-3 text-sm font-black text-black shadow-[0_4px_24px_rgba(212,175,55,0.35)] transition hover:scale-[1.03] disabled:opacity-50">
          {matchLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
          {matchLoading ? t("sponsors.matching") : t("sponsors.findMatchesButton", { cost: MATCHER_COST })}
        </button>
        {matchNote && <p className="mt-4 text-sm italic text-white/60">{matchNote}</p>}
        {matches.length > 0 && (
          <div className="mt-4 space-y-2">
            {matches.map((m) => (
              <Link key={m.dealId} href={`/sponsors/${m.dealId}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 transition hover:border-primary/40">
                <div>
                  <p className="font-bold text-white">{m.brandName}</p>
                  <p className="text-xs text-white/50">{m.why}</p>
                </div>
                <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-black text-primary">
                  {m.score}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {outOfCredits && <OutOfCredits onClose={() => setOutOfCredits(false)} />}
    </div>
  );
}
