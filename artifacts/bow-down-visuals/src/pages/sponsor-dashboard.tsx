import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  LayoutDashboard, Loader2, Briefcase, BadgeDollarSign, Banknote,
  ArrowRight, PlusCircle, PenLine, CheckCircle2, Clock,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { formatBudgetRange } from "@/lib/sponsors";

/* ─── /sponsors/dashboard — my deals, my applications, my earnings ─────────
   Free (pure UI read). Creators see payouts; brands see posted deals. */

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

export default function SponsorDashboard() {
  const { user, getAccessToken } = useAuth();
  const [tab, setTab] = useState<"deals" | "applications" | "earnings">("deals");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [postedDeals, setPostedDeals] = useState<PostedDeal[]>([]);
  const [applications, setApplications] = useState<MyApplication[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [totalEarnedCents, setTotalEarnedCents] = useState(0);

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
        if (!res.ok) throw new Error(data.error || "Could not load your dashboard.");
        setPostedDeals(Array.isArray(data.postedDeals) ? data.postedDeals : []);
        setApplications(Array.isArray(data.applications) ? data.applications : []);
        setPayouts(Array.isArray(data.payouts) ? data.payouts : []);
        setTotalEarnedCents(Number(data.totalEarnedCents ?? 0));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load your dashboard.");
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-28 md:pt-32">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
              <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" /> Sponsor dashboard
            </p>
            <h1 className="font-display text-4xl font-black">Your <span className="text-primary">deals</span></h1>
          </div>
          <div className="flex gap-2">
            <Link href="/sponsors"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:border-primary/50 hover:text-white">
              Browse deals <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/sponsors/post"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-4 py-2.5 text-sm font-black text-black transition hover:scale-[1.03]">
              <PlusCircle className="h-4 w-4" aria-hidden="true" /> Post a deal
            </Link>
          </div>
        </div>

        {/* earnings banner */}
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
              <Banknote className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Earned as creator
            </p>
            <p className="mt-2 font-display text-3xl font-black text-primary">{moneyCents(totalEarnedCents)}</p>
            <p className="mt-1 text-xs text-white/40">85% of every released deal — after the 15% platform fee</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
              <Briefcase className="h-3.5 w-3.5 text-primary/70" aria-hidden="true" /> Deals posted
            </p>
            <p className="mt-2 font-display text-3xl font-black text-white">{postedDeals.length}</p>
            <p className="mt-1 text-xs text-white/40">{postedDeals.filter((d) => d.status === "active").length} open now</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
              <PenLine className="h-3.5 w-3.5 text-primary/70" aria-hidden="true" /> Applications sent
            </p>
            <p className="mt-2 font-display text-3xl font-black text-white">{applications.length}</p>
            <p className="mt-1 text-xs text-white/40">{applications.filter((a) => a.application_status === "accepted").length} accepted</p>
          </div>
        </div>

        {/* tabs */}
        <div className="mt-8 flex gap-2">
          {(["deals", "applications", "earnings"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`${inputTab} ${tab === t
                ? "bg-primary text-black"
                : "border border-white/15 text-white/60 hover:text-white"}`}>
              {t === "deals" ? "My deals" : t === "applications" ? "My applications" : "Earnings"}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-white/40">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading…
            </div>
          ) : error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>
          ) : tab === "deals" ? (
            postedDeals.length === 0 ? (
              <EmptyState
                title="No deals posted yet"
                body="Post your first sponsorship deal and creators will come pitching."
                cta={{ href: "/sponsors/post", label: "Post a deal" }}
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {postedDeals.map((d) => (
                  <Link key={d.id} href={`/sponsors/${d.id}`}
                    className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-primary/40">
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
                        {d.applicationCount} application{d.applicationCount === 1 ? "" : "s"}
                      </span>
                      {d.agreedAmountCents != null && (
                        <span className="text-white/50">Escrow: {moneyCents(d.agreedAmountCents)} · {d.escrowStatus}</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )
          ) : tab === "applications" ? (
            applications.length === 0 ? (
              <EmptyState
                title="No applications yet"
                body="Browse the marketplace and pitch brands on deals that fit you."
                cta={{ href: "/sponsors", label: "Browse deals" }}
              />
            ) : (
              <div className="space-y-3">
                {applications.map((a) => (
                  <Link key={a.id} href={`/sponsors/${a.deal_id}`}
                    className="block rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-primary/40">
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
                      {formatBudgetRange(a.budget_min, a.budget_max)} · deal {a.deal_status.replace("_", " ")}
                      {a.agreed_amount_cents != null && a.application_status === "accepted" &&
                        ` · agreed ${moneyCents(a.agreed_amount_cents)}`}
                    </p>
                  </Link>
                ))}
              </div>
            )
          ) : payouts.length === 0 ? (
            <EmptyState
              title="No payouts yet"
              body="Win a deal, deliver the work, and your 85% lands here."
              cta={{ href: "/sponsors", label: "Find deals" }}
            />
          ) : (
            <div className="space-y-3">
              {payouts.map((p) => (
                <Link key={p.id} href={`/sponsors/${p.deal_id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-primary/40">
                  <div>
                    <p className="font-black text-white">{p.brand_name}</p>
                    <p className="text-xs text-white/40">
                      {new Date(p.created_at).toLocaleDateString()} · gross {moneyCents(p.gross_cents)} · fee {moneyCents(p.fee_cents)}
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
      </main>
      <SiteFooter />
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

function EmptyState({ title, body, cta }: { title: string; body: string; cta: { href: string; label: string } }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
      <p className="font-bold text-white">{title}</p>
      <p className="mt-1 text-sm text-white/50">{body}</p>
      <Link href={cta.href}
        className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-black text-black transition hover:brightness-110">
        {cta.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
