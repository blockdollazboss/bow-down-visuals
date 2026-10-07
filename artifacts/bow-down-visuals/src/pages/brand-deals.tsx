import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Handshake, Loader2, Sparkles, Search, Users,
  CheckCircle2, AlertTriangle, Copy, Check, ChevronDown,
  BadgeDollarSign, Gift, Repeat2, FileText, Megaphone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── Thy Cheat Code's Brand Deal Finder ────────────────────────────────────
   The money-hunt: AI matches creators with brand partnership opportunities —
   sponsored posts, affiliates, ambassadorships, gifting, usage licensing.
   This is the FINDER phase (AI surfaces opportunities); the two-sided
   Sponsor Marketplace lives separately at /sponsors.
   POSTs to /api/brand-deals (2 credits/search) and /api/brand-deals/outreach
   (1 credit/draft) on GPT-6 Sol. Deal types + audience sizes must stay in
   sync with the backend route's enums. */

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

export default function BrandDealFinder() {
  const { t } = useTranslation();
  const { user, profile, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

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
            <Link href="/sponsors" className="font-semibold text-primary hover:underline">{t("brandDeals.marketplaceLink", { defaultValue: "Sponsor Marketplace" })}</Link>.
          </p>
        </div>

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
      </main>


    </div>
  );
}
