import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Sparkles, Shirt, CalendarCheck, Check, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Wave 8: Merch Drop Planner ──────────────────────────────────────────
   Docked in the branding shop's merch section. The AI plans 3 merch
   concepts + a 5-day launch sequence (100 VB); accepting the plan saves it
   and queues the 5 launch posts into the content calendar as promo slots. */

interface MerchConcept {
  name: string;
  product: string;
  description: string;
  pricePoint: string;
  why: string;
}

interface LaunchPost {
  dayOffset: number;
  title: string;
  caption: string;
  cta: string;
}

interface MerchPlan {
  concepts: MerchConcept[];
  launchPosts: LaunchPost[];
}

interface SavedPlan {
  id: string;
  plan_name: string;
  concepts: MerchConcept[];
  launch_posts: LaunchPost[];
  status: string;
  created_at: string;
}

const PLAN_COST = 100;

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-[#d4af37]/60 focus:outline-none";

/** Default the launch week to next Monday (drops launch on a Monday). */
function nextMondayISO(): string {
  const d = new Date();
  const delta = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

export default function MerchDropPlanner() {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();

  const [niche, setNiche] = useState("");
  const [audience, setAudience] = useState("");
  const [priceBand, setPriceBand] = useState<"budget" | "mid" | "premium">("mid");
  const [planning, setPlanning] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [plan, setPlan] = useState<MerchPlan | null>(null);
  const [planName, setPlanName] = useState("");
  const [weekStart, setWeekStart] = useState(nextMondayISO());
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/wave8/merch-drop/plans", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setSavedPlans(data.plans ?? []);
        }
      } catch {
        /* non-fatal */
      } finally {
        setLoadingSaved(false);
      }
    })();
  }, []);

  async function handlePlan() {
    setError(null);
    setOutOfCredits(false);
    setAccepted(false);
    if (!niche.trim()) {
      setError(t("wave8.merchDrop.errors.nicheRequired"));
      return;
    }
    setPlanning(true);
    try {
      const res = await confirmedFetch("/api/wave8/merch-drop/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ niche: niche.trim(), audience: audience.trim(), priceBand }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = await res.json();
      if (res.status === 402) { setOutOfCredits(true); return; }
      if (res.status === 503) { setError(data.message || data.error); return; }
      if (!res.ok) { setError(data.message || data.error || t("wave8.merchDrop.errors.planFailed")); return; }
      setPlan(data.plan as MerchPlan);
      if (!planName.trim()) setPlanName(`${niche.trim().slice(0, 40)} Drop`);
    } catch {
      setError(t("wave8.merchDrop.errors.network"));
    } finally {
      setPlanning(false);
    }
  }

  async function handleAccept() {
    if (!plan) return;
    setError(null);
    if (!planName.trim()) {
      setError(t("wave8.merchDrop.errors.planNameRequired"));
      return;
    }
    setAccepting(true);
    try {
      const res = await confirmedFetch("/api/wave8/merch-drop/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        skipConfirm: true,
        body: JSON.stringify({
          planName: planName.trim(),
          concepts: plan.concepts,
          launchPosts: plan.launchPosts,
          weekStart,
        }),
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok) { setError(data.error || t("wave8.merchDrop.errors.saveFailed")); return; }
      setAccepted(true);
      setSavedPlans((prev) => [
        {
          id: data.planId,
          plan_name: planName.trim(),
          concepts: plan.concepts,
          launch_posts: plan.launchPosts,
          status: "accepted",
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
    } catch {
      setError(t("wave8.merchDrop.errors.network"));
    } finally {
      setAccepting(false);
    }
  }

  function startOver() {
    setPlan(null);
    setAccepted(false);
    setError(null);
    setPlanName("");
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-neutral-900 via-black to-neutral-900">
      <div className="p-6 md:p-8">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" /> {t("wave8.merchDrop.badge")}
        </div>
        <h2 className="text-2xl font-black">{t("wave8.merchDrop.title")}</h2>
        <p className="mt-2 max-w-2xl text-sm text-white/50">{t("wave8.merchDrop.subtitle")}</p>

        {outOfCredits && (
          <div className="mt-4">
            <OutOfCredits />
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* inputs */}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-xs font-semibold text-white/60">{t("wave8.merchDrop.nicheLabel")}</label>
            <input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder={t("wave8.merchDrop.nichePlaceholder")}
              maxLength={100}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-white/60">{t("wave8.merchDrop.priceBandLabel")}</label>
            <div className="flex gap-2">
              {(["budget", "mid", "premium"] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setPriceBand(b)}
                  className={`flex-1 rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
                    priceBand === b
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-white/10 text-white/50 hover:border-white/25"
                  }`}
                >
                  {t(`wave8.merchDrop.priceBands.${b}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-semibold text-white/60">{t("wave8.merchDrop.audienceLabel")}</label>
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder={t("wave8.merchDrop.audiencePlaceholder")}
            maxLength={300}
            className={inputCls}
          />
        </div>
        <button
          onClick={handlePlan}
          disabled={planning}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {planning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> {t("wave8.merchDrop.planning")}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" /> {t("wave8.merchDrop.planButton", { cost: PLAN_COST })}
            </>
          )}
        </button>

        {/* plan results */}
        {plan && (
          <div className="mt-8 space-y-8">
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#d4af37]">
                {t("wave8.merchDrop.conceptsTitle")}
              </h3>
              <div className="grid gap-4 md:grid-cols-3">
                {plan.concepts.map((c, i) => (
                  <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                      <Shirt className="h-5 w-5 text-primary" />
                    </div>
                    <h4 className="font-bold">{c.name}</h4>
                    <p className="mt-0.5 text-xs capitalize text-white/45">{c.product}</p>
                    <p className="mt-2 text-sm text-white/70">{c.description}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-lg font-black text-primary">{c.pricePoint}</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-white/45">{c.why}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#d4af37]">
                {t("wave8.merchDrop.launchTitle")}
              </h3>
              <div className="space-y-3">
                {plan.launchPosts.map((p, i) => (
                  <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 md:p-5">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/40">
                      <CalendarCheck className="h-3.5 w-3.5 text-primary" />
                      {t("wave8.merchDrop.dayLabel", { n: p.dayOffset + 1 })}
                    </div>
                    <h4 className="mt-1 font-bold">{p.title}</h4>
                    <p className="mt-1 text-sm leading-relaxed text-white/70">{p.caption}</p>
                    <p className="mt-2 text-xs font-semibold text-primary">
                      {t("wave8.merchDrop.ctaLabel")}: {p.cta}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* accept */}
            {accepted ? (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
                <Check className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                <h3 className="font-bold text-emerald-300">{t("wave8.merchDrop.successTitle")}</h3>
                <p className="mt-1 text-sm text-white/60">
                  {t("wave8.merchDrop.successText", { n: plan.launchPosts.length })}
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <Link
                    href="/scheduler"
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                  >
                    {t("wave8.merchDrop.viewScheduler")} <ArrowRight className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={startOver}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/70 hover:border-white/30"
                  >
                    {t("wave8.merchDrop.planAnother")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-primary/25 bg-primary/[0.05] p-5">
                <h3 className="font-bold">{t("wave8.merchDrop.acceptTitle")}</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-white/60">{t("wave8.merchDrop.planNameLabel")}</label>
                    <input
                      value={planName}
                      onChange={(e) => setPlanName(e.target.value)}
                      placeholder={t("wave8.merchDrop.planNamePlaceholder")}
                      maxLength={120}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-white/60">{t("wave8.merchDrop.weekStartLabel")}</label>
                    <input
                      type="date"
                      value={weekStart}
                      onChange={(e) => setWeekStart(e.target.value)}
                      className={`${inputCls} bg-black`}
                    />
                  </div>
                </div>
                <button
                  onClick={handleAccept}
                  disabled={accepting}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
                >
                  {accepting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> {t("wave8.merchDrop.saving")}
                    </>
                  ) : (
                    <>
                      <CalendarCheck className="h-4 w-4" /> {t("wave8.merchDrop.acceptButton")}
                    </>
                  )}
                </button>
                <p className="mt-2 text-xs text-white/35">
                  {t("wave8.merchDrop.queuedBadge", { n: plan.launchPosts.length })}
                </p>
              </div>
            )}
          </div>
        )}

        {/* saved plans */}
        <div className="mt-10">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#d4af37]">
            {t("wave8.merchDrop.savedTitle")}
          </h3>
          {loadingSaved ? (
            <div className="flex items-center gap-2 text-sm text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : savedPlans.length === 0 ? (
            <p className="text-sm text-white/35">{t("wave8.merchDrop.savedEmpty")}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {savedPlans.map((s) => (
                <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold">{s.plan_name}</span>
                    {s.status === "accepted" && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                        <Check className="h-3 w-3" /> {t("wave8.merchDrop.acceptedBadge")}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-white/40">
                    {s.concepts.length} concepts · {s.launch_posts.length} launch posts ·{" "}
                    {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
