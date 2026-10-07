import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Megaphone, Loader2, ArrowLeft, BadgeDollarSign } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";

/* ─── /sponsors/post — brands post a sponsorship deal ─────────────────────
   Money rule: posting a deal is 5 credits (a business listing that can
   close real money). Charged BEFORE the save, auto-refunded on failure. */

const POST_COST = 5;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const sectionLabel =
  "mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40";

export default function SponsorPost() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [, navigate] = useLocation();

  const [brandName, setBrandName] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [niche, setNiche] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  async function postDeal() {
    const min = Number(budgetMin);
    const max = Number(budgetMax);
    if (!brandName.trim()) { setError(t("sponsorsPost.errorBrandName")); return; }
    if (!Number.isFinite(min) || min < 0) { setError(t("sponsorsPost.errorBudgetMin")); return; }
    if (!Number.isFinite(max) || max < min) { setError(t("sponsorsPost.errorBudgetMax")); return; }
    if (!niche.trim()) { setError(t("sponsorsPost.errorNiche")); return; }
    if (!deliverables.trim()) { setError(t("sponsorsPost.errorDeliverables")); return; }
    if (!description.trim()) { setError(t("sponsorsPost.errorDescription")); return; }
    if (!deadline) { setError(t("sponsorsPost.errorDeadline")); return; }

    setPosting(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/sponsors/deals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          brandName: brandName.trim(),
          budgetMin: Math.round(min),
          budgetMax: Math.round(max),
          niche: niche.trim(),
          deliverables: deliverables.trim(),
          description: description.trim(),
          deadline: new Date(deadline).toISOString(),
        }),
      });
      if (!res) return; /* user cancelled the credit confirmation */
      const data = (await res.json().catch(() => ({}))) as { deal?: { id: string }; error?: string };
      if (res.status === 402) {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) throw new Error(data.error || t("sponsorsPost.errorPostDeal"));
      refreshProfile();
      navigate(data.deal?.id ? `/sponsors/${data.deal.id}` : "/sponsors");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sponsorsPost.errorPostDeal"));
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-28 md:pt-32">
        <Link href="/sponsors" className="inline-flex items-center gap-1.5 text-sm text-white/50 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("sponsorsPost.backToDeals")}
        </Link>

        <p className="mb-2 mt-6 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
          <Megaphone className="h-3.5 w-3.5" aria-hidden="true" /> {t("sponsorsPost.eyebrow")}
        </p>
        <h1 className="font-display text-4xl font-black">{t("sponsorsPost.pageTitle")} <span className="text-primary">{t("sponsorsPost.pageTitleAccent")}</span></h1>
        <p className="mt-3 max-w-xl text-sm text-white/55">
          {t("sponsorsPost.pageSubtitle")}
        </p>

        {error && (
          <p className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>
        )}

        {!user ? (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <p className="text-white/60">{t("sponsorsPost.signInPrompt")}</p>
            <Link href="/login"
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-6 py-3 font-bold text-primary transition hover:bg-primary hover:text-black">
              {t("sponsorsPost.signIn")}
            </Link>
          </div>
        ) : (
          <div className="mt-8 rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className={sectionLabel}>{t("sponsorsPost.brandNameLabel")}</p>
                <input value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={120}
                  placeholder={t("sponsorsPost.brandNamePlaceholder")} className={inputClass} />
              </div>
              <div>
                <p className={sectionLabel}>{t("sponsorsPost.nicheLabel")}</p>
                <input value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={120}
                  placeholder={t("sponsorsPost.nichePlaceholder")} className={inputClass} />
              </div>
              <div>
                <p className={sectionLabel}>{t("sponsorsPost.budgetMinLabel")}</p>
                <input value={budgetMin} onChange={(e) => setBudgetMin(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))}
                  inputMode="numeric" placeholder={t("sponsorsPost.budgetMinPlaceholder")} className={inputClass} />
              </div>
              <div>
                <p className={sectionLabel}>{t("sponsorsPost.budgetMaxLabel")}</p>
                <input value={budgetMax} onChange={(e) => setBudgetMax(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))}
                  inputMode="numeric" placeholder={t("sponsorsPost.budgetMaxPlaceholder")} className={inputClass} />
              </div>
              <div>
                <p className={sectionLabel}>{t("sponsorsPost.deadlineLabel")}</p>
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
                  className={`${inputClass} [color-scheme:dark]`} />
              </div>
              <div>
                <p className={sectionLabel}>{t("sponsorsPost.deliverablesLabel")}</p>
                <input value={deliverables} onChange={(e) => setDeliverables(e.target.value)} maxLength={500}
                  placeholder={t("sponsorsPost.deliverablesPlaceholder")} className={inputClass} />
              </div>
            </div>
            <p className={`${sectionLabel} mt-4`}>{t("sponsorsPost.descriptionLabel")}</p>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={4}
              placeholder={t("sponsorsPost.descriptionPlaceholder")} className={`${inputClass} resize-y`} />

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
              <p className="inline-flex items-center gap-1.5 text-sm text-white/50">
                <BadgeDollarSign className="h-4 w-4 text-primary/70" aria-hidden="true" />
                {t("sponsorsPost.costNote", { cost: POST_COST })}
              </p>
              <button onClick={postDeal} disabled={posting}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-3.5 text-base font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50">
                {posting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Megaphone className="h-5 w-5" aria-hidden="true" />}
                {posting ? t("sponsorsPost.posting") : t("sponsorsPost.postDealButton", { cost: POST_COST })}
              </button>
            </div>
          </div>
        )}
      </main>

      {outOfCredits && <OutOfCredits onClose={() => setOutOfCredits(false)} />}
    </div>
  );
}
