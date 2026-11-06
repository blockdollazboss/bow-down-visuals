import { apiErrorMessage, plainErrorText } from "../../lib/api-error";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  LayoutDashboard, Loader2, Briefcase, BadgeDollarSign, Banknote,
  ArrowRight, PlusCircle, PenLine, CheckCircle2, Clock, RotateCcw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { formatBudgetRange } from "@/lib/sponsors";
import { useTranslation } from "react-i18next";

/* ─── Manage Deals — the Sponsor Dashboard, folded into Brand Deals ───────
   (C-21 one-door consolidation, owner ruling Nov 5 2026: Brand Deals is the
   only sponsors front door; this panel is its "Manage Deals" tab. The old
   /sponsors/dashboard route redirects here. Content is the former page,
   unchanged: my deals, my applications, my earnings — one read of
   GET /api/sponsors/dashboard. Free (pure UI read). Creators see payouts;
   brands see posted deals. */

interface PostedDeal {
  id: string;
  brandName: string;
  budgetMin: number;
  budgetMax: number;
  niche: string;
  status: string;
  escrowStatus: string;
  agreedAmountCents: number | null;
  applicationCount: number;
}

interface MyApplication {
  id: string;
  deal_id: string;
  application_status: string;
  pitch: string;
  created_at: string;
  brand_name: string;
  budget_min: number;
  budget_max: number;
  niche: string;
  deal_status: string;
  agreed_amount_cents: number | null;
  escrow_status: string;
}

interface Payout {
  id: string;
  deal_id: string;
  gross_cents: number;
  fee_cents: number;
  net_cents: number;
  created_at: string;
  brand_name: string;
}

const inputTab =
  "rounded-xl px-4 py-2.5 text-sm font-bold transition";

function moneyCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return "$" + (Number(cents) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const APP_BADGE: Record<string, string> = {
  pending: "border-white/15 text-white/60",
  accepted: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  rejected: "border-red-500/40 bg-red-500/10 text-red-300",
};

export function SponsorDashboardPanel({
  onPostDeal,
  onBrowseDeals,
}: {
  onPostDeal: () => void;
  onBrowseDeals: () => void;
}) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [tab, setTab] = useState<"deals" | "applications" | "earnings">("deals");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [postedDeals, setPostedDeals] = useState<PostedDeal[]>([]);
  const [applications, setApplications] = useState<MyApplication[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  /* Null until the dashboard actually loads: the banner must never
     paint a fake $0.00 / 0 / 0 during loading or after a failure
     (Stack-28 #25 / A3-F3). */
  const [totalEarnedCents, setTotalEarnedCents] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      if (!user) { setLoading(false); return; }
      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/sponsors/dashboard", {
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const data = (await res.json().catch(() => ({}))) as {
          postedDeals?: PostedDeal[]; applications?: MyApplication[];
          payouts?: Payout[]; totalEarnedCents?: number; error?: string;
        };
        if (!res.ok) throw new Error(apiErrorMessage(data, t("sponsorDashboard.errorLoadDashboard")));
        setPostedDeals(Array.isArray(data.postedDeals) ? data.postedDeals : []);
        setApplications(Array.isArray(data.applications) ? data.applications : []);
        setPayouts(Array.isArray(data.payouts) ? data.payouts : []);
        setTotalEarnedCents(Number(data.totalEarnedCents ?? 0));
      } catch (err) {
        setError(plainErrorText(err, t("sponsorDashboard.errorLoadDashboard")));
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, retryNonce]);

  return (
    <div>
      {/* compact section heading (the hub owns the page hero) */}
      <div className="text-center">
        <p className="mb-2 flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
          <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" /> {t("sponsorDashboard.eyebrow")}
        </p>
        <h2 className="font-display text-2xl font-black tracking-tight md:text-3xl">{t("sponsorDashboard.pageTitle")} <span className="text-primary">{t("sponsorDashboard.pageTitleAccent")}</span></h2>
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={onBrowseDeals}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:border-primary/50 hover:text-white">
            {t("sponsorDashboard.browseDeals")} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <button onClick={onPostDeal}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-4 py-2.5 text-sm font-black text-black transition hover:scale-[1.03]">
            <PlusCircle className="h-4 w-4" aria-hidden="true" /> {t("sponsorDashboard.postDeal")}
          </button>
        </div>
      </div>

      {/* earnings banner — numbers ONLY on a successful load
          (Stack-28 #25 / A3-F3): while loading the banner shows
          placeholders, and on failure it shows an error note — never
          a confident $0.00 / 0 / 0 above the real error card. */}
      <div className="mt-8 grid gap-4 md:grid-cols-3" data-testid="sponsor-banner">
        <div className={`${isLight ? "rounded-3xl border border-primary/25 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-6" : "rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-6"}`}>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
            <Banknote className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> {t("sponsorDashboard.earnedAsCreator")}
          </p>
          <p className="mt-2 font-display text-3xl font-black text-primary">{loading || error || totalEarnedCents === null ? "—" : moneyCents(totalEarnedCents)}</p>
          <p className="mt-1 text-xs text-white/40">{error ? "Couldn't load your earnings — try again below." : loading ? "Loading…" : t("sponsorDashboard.earnedHint")}</p>
        </div>
        <div className={`rounded-3xl border p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
            <Briefcase className="h-3.5 w-3.5 text-primary/70" aria-hidden="true" /> {t("sponsorDashboard.dealsPosted")}
          </p>
          <p className="mt-2 font-display text-3xl font-black text-white">{loading || error ? "—" : postedDeals.length}</p>
          <p className="mt-1 text-xs text-white/40">{loading || error ? "—" : t("sponsorDashboard.openNow", { count: postedDeals.filter((d) => d.status === "active").length })}</p>
        </div>
        <div className={`rounded-3xl border p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
            <PenLine className="h-3.5 w-3.5 text-primary/70" aria-hidden="true" /> {t("sponsorDashboard.applicationsSent")}
          </p>
          <p className="mt-2 font-display text-3xl font-black text-white">{loading || error ? "—" : applications.length}</p>
          <p className="mt-1 text-xs text-white/40">{loading || error ? "—" : t("sponsorDashboard.acceptedCount", { count: applications.filter((a) => a.application_status === "accepted").length })}</p>
        </div>
      </div>

      {/* tabs */}
      <div className="mt-8 flex gap-2">
        {(["deals", "applications", "earnings"] as const).map((tabKey) => (
          <button key={tabKey} onClick={() => setTab(tabKey)}
            className={`${inputTab} ${tab === tabKey
              ? "bg-primary text-black"
              : "border border-white/15 text-white/60 hover:text-white"}`}>
            {tabKey === "deals" ? t("sponsorDashboard.tabMyDeals") : tabKey === "applications" ? t("sponsorDashboard.tabMyApplications") : t("sponsorDashboard.tabEarnings")}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-white/40">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> {t("sponsorDashboard.loading")}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
            <div>
              <button
                onClick={() => setRetryNonce((n) => n + 1)}
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
              >
                <RotateCcw className="h-4 w-4" /> Try again
              </button>
            </div>
          </div>
        ) : tab === "deals" ? (
          postedDeals.length === 0 ? (
            <EmptyState
              title={t("sponsorDashboard.emptyDealsTitle")}
              body={t("sponsorDashboard.emptyDealsBody")}
              cta={{ label: t("sponsorDashboard.postDeal"), onClick: onPostDeal }}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {postedDeals.map((d) => (
                <Link key={d.id} href={`/sponsors/${d.id}`}
                  className={`rounded-3xl border p-6 transition hover:border-primary/40 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-black text-white">{d.brandName}</p>
                      <p className="mt-0.5 text-xs uppercase tracking-wider text-white/40">{d.niche}</p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-black text-primary">
                      <BadgeDollarSign className="h-4 w-4" aria-hidden="true" />
                      {formatBudgetRange(d.budgetMin, d.budgetMax)}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-3 text-xs">
                    <StatusPill status={d.status} />
                    <span className="inline-flex items-center gap-1 text-white/50">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {d.applicationCount} {d.applicationCount === 1 ? t("sponsorDashboard.applicationSingular") : t("sponsorDashboard.applicationPlural")}
                    </span>
                    {d.agreedAmountCents != null && (
                      <span className="text-white/50">{t("sponsorDashboard.escrowLine", { amount: moneyCents(d.agreedAmountCents), status: d.escrowStatus })}</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )
        ) : tab === "applications" ? (
          applications.length === 0 ? (
            <EmptyState
              title={t("sponsorDashboard.emptyAppsTitle")}
              body={t("sponsorDashboard.emptyAppsBody")}
              cta={{ label: t("sponsorDashboard.browseDeals"), onClick: onBrowseDeals }}
            />
          ) : (
            <div className="space-y-3">
              {applications.map((a) => (
                <Link key={a.id} href={`/sponsors/${a.deal_id}`}
                  className={`block rounded-2xl border p-5 transition hover:border-primary/40 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black text-white">{a.brand_name}
                      <span className="ml-2 text-xs font-normal uppercase tracking-wider text-white/40">{a.niche}</span>
                    </p>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold capitalize ${APP_BADGE[a.application_status] ?? APP_BADGE.pending}`}>
                      {a.application_status}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-white/60">{a.pitch}</p>
                  <p className="mt-2 text-xs text-white/40">
                    {t("sponsorDashboard.applicationDealLine", { budget: formatBudgetRange(a.budget_min, a.budget_max), status: a.deal_status.replace("_", " ") })}
                    {a.agreed_amount_cents != null && a.application_status === "accepted" &&
                      t("sponsorDashboard.agreedAmountSuffix", { amount: moneyCents(a.agreed_amount_cents) })}
                  </p>
                </Link>
              ))}
            </div>
          )
        ) : payouts.length === 0 ? (
          <EmptyState
            title={t("sponsorDashboard.emptyPayoutsTitle")}
            body={t("sponsorDashboard.emptyPayoutsBody")}
            cta={{ label: t("sponsorDashboard.findDeals"), onClick: onBrowseDeals }}
          />
        ) : (
          <div className="space-y-3">
            {payouts.map((p) => (
              <Link key={p.id} href={`/sponsors/${p.deal_id}`}
                className={`flex items-center justify-between gap-3 rounded-2xl border p-5 transition hover:border-primary/40 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
                <div>
                  <p className="font-black text-white">{p.brand_name}</p>
                  <p className="text-xs text-white/40">
                    {t("sponsorDashboard.payoutLine", { date: new Date(p.created_at).toLocaleDateString(), gross: moneyCents(p.gross_cents), fee: moneyCents(p.fee_cents) })}
                  </p>
                </div>
                <p className="flex items-center gap-1.5 font-display text-xl font-black text-primary">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                  {moneyCents(p.net_cents)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "active" ? "border-primary/40 bg-primary/10 text-primary"
    : status === "paid" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : "border-white/15 text-white/60";
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-bold capitalize ${color}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function EmptyState({ title, body, cta }: { title: string; body: string; cta: { label: string; onClick: () => void } }) {
  const isLight = useIsLightTheme();
  return (
    <div className={`rounded-3xl border p-10 text-center ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
      <p className="font-bold text-white">{title}</p>
      <p className="mt-1 text-sm text-white/50">{body}</p>
      <button onClick={cta.onClick}
        className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-black text-black transition hover:brightness-110">
        {cta.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
