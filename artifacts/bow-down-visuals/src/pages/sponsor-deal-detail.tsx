import { useEffect, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import {
  ArrowLeft, Loader2, Briefcase, CalendarClock, BadgeDollarSign,
  PenLine, Sparkles, Copy, CheckCircle2, ShieldCheck, Wallet,
  Play, PackageCheck, Banknote, Users, XCircle, AlertTriangle,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { formatBudgetRange, daysLeftLabel } from "@/lib/sponsors";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── /sponsors/:id — deal detail ──────────────────────────────────────────
   Creators: apply with a pitch (+ AI pitch writer, 1 credit), track status,
   start work, mark delivered.
   Brands: review applications, accept/reject, fund escrow (Stripe or
   sandbox), release payment (15% platform fee).
   Deal lifecycle: active → funded → in_progress → completed → paid. */

interface FullDeal {
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
  postedBy: string;
  agreedAmountCents: number | null;
  escrowStatus: string;
  platformFeeCents: number | null;
  creatorPayoutCents: number | null;
  acceptedApplicationId: string | null;
  acceptedUserId: string | null;
  paidAt: string | null;
  applicationCount: number;
  myApplicationStatus: string | null;
}

interface Application {
  id: string;
  deal_id: string;
  user_id: string;
  pitch: string;
  status: string;
  portfolio_url: string | null;
  decided_at: string | null;
  created_at: string;
}

const AI_COST = 1;
const TONES = ["professional", "bold", "friendly"] as const;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const sectionLabel =
  "mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40";

const STEPS = ["active", "funded", "in_progress", "completed", "paid"] as const;
const STEP_LABELS: Record<string, string> = {
  active: "Open",
  funded: "Funded",
  in_progress: "In progress",
  completed: "Delivered",
  paid: "Paid",
};

function moneyCents(cents: number | null): string {
  if (cents == null) return "—";
  return "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function SponsorDealDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const dealId = params.id ?? "";

  const [deal, setDeal] = useState<FullDeal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  // apply
  const [pitch, setPitch] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  // AI pitch writer
  const [creatorName, setCreatorName] = useState("");
  const [creatorNiche, setCreatorNiche] = useState("");
  const [creatorFollowers, setCreatorFollowers] = useState("");
  const [achievements, setAchievements] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]>("professional");
  const [pitchLoading, setPitchLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  // brand
  const [applications, setApplications] = useState<Application[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [agreedDollars, setAgreedDollars] = useState("");
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async function load() {
    if (!user || !dealId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sponsors/deals/${dealId}`, { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as { deal?: FullDeal; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load the deal.");
      setDeal(data.deal ?? null);
      if (data.deal && data.deal.postedBy === user.id) loadApplications(data.deal.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the deal.");
    } finally {
      setLoading(false);
    }
  }

  async function loadApplications(id: string) {
    setAppsLoading(true);
    try {
      const res = await fetch(`/api/sponsors/deals/${id}/applications`, { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as { applications?: Application[] };
      if (res.ok) setApplications(Array.isArray(data.applications) ? data.applications : []);
    } finally {
      setAppsLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, dealId]);

  async function postAction(path: string, method: string, body?: unknown, busyKey?: string) {
    setBusy(busyKey ?? path);
    setError(null);
    try {
      const res = await fetch(path, {
        method,
        headers: await authHeaders(),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
      if (!res.ok) throw new Error(data.error || "Action failed.");
      await load();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function applyToDeal() {
    if (!pitch.trim()) { setError("Write your pitch first."); return; }
    const data = await postAction(`/api/sponsors/deals/${dealId}/apply`, "POST",
      { pitch: pitch.trim(), portfolioUrl: portfolioUrl.trim() || undefined }, "apply");
    if (data) {
      setPitch("");
      setPortfolioUrl("");
    }
  }

  async function writePitch() {
    if (!creatorNiche.trim()) { setError("Tell the AI your niche first."); return; }
    setPitchLoading(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/sponsors/pitch", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          dealId,
          creatorName: creatorName.trim(),
          niche: creatorNiche.trim(),
          followers: Number(creatorFollowers.replace(/[^0-9]/g, "")) || 0,
          platforms: [],
          achievements: achievements.trim(),
          tone,
        }),
      });
      if (!res) return; /* user cancelled the credit confirmation */
      const data = (await res.json().catch(() => ({}))) as { pitch?: string; error?: string };
      if (res.status === 402) { setOutOfCredits(true); refreshProfile(); return; }
      if (!res.ok || !data.pitch) throw new Error(data.error || "Pitch writer failed.");
      setPitch(data.pitch);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pitch writer failed.");
    } finally {
      setPitchLoading(false);
    }
  }

  function copyPitch() {
    navigator.clipboard?.writeText(pitch).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function reviewApplication(appId: string, action: "accept" | "reject") {
    if (action === "accept" && !agreedDollars.trim()) {
      setError("Set the agreed payout in dollars to accept a creator.");
      return;
    }
    setReviewingId(appId);
    const ok = await postAction(`/api/sponsors/applications/${appId}`, "PATCH", {
      action,
      ...(action === "accept" ? { agreedAmountCents: Math.round(Number(agreedDollars) * 100) } : {}),
    }, "review");
    setReviewingId(null);
    if (ok) {
      setAgreedDollars("");
      loadApplications(dealId);
    }
  }

  async function fundDeal() {
    const amountCents = deal?.agreedAmountCents ?? Math.round(Number(agreedDollars) * 100);
    if (!amountCents || amountCents <= 0) { setError("No agreed payout to fund."); return; }
    const data = await postAction(`/api/sponsors/deals/${dealId}/fund`, "POST", { amountCents }, "fund") as
      { sandbox?: boolean; sessionId?: string; checkoutUrl?: string } | null;
    if (!data) return;
    if (data.sandbox && data.sessionId) {
      /* Sandbox: simulate the card payment completing. */
      const confirm = await postAction("/api/sponsors/escrow/confirm", "POST",
        { dealId, sessionId: data.sessionId }, "fund-confirm");
      if (confirm) setError(null);
    } else if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
    }
  }

  const isBrand = !!user && !!deal && deal.postedBy === user.id;
  const isCreator = !!user && !!deal && deal.acceptedUserId === user.id;
  const stepIndex = deal ? STEPS.indexOf(deal.status as (typeof STEPS)[number]) : -1;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-4xl px-4 pb-24 pt-28 md:pt-32">
        <button onClick={() => navigate("/sponsors")}
          className="inline-flex items-center gap-1.5 text-sm text-white/50 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to deals
        </button>

        {error && (
          <p className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-white/40">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading deal…
          </div>
        ) : !deal ? (
          <p className="mt-10 text-center text-white/50">Deal not found.</p>
        ) : (
          <>
            {/* ── deal header ── */}
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                    <Briefcase className="h-3.5 w-3.5" aria-hidden="true" /> {deal.niche}
                  </p>
                  <h1 className="mt-2 font-display text-3xl font-black md:text-4xl">{deal.brandName}</h1>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-white/50">
                    <CalendarClock className="h-4 w-4 text-primary/70" aria-hidden="true" />
                    {daysLeftLabel(deal.deadline)}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-lg font-black text-primary">
                  <BadgeDollarSign className="h-5 w-5" aria-hidden="true" />
                  {formatBudgetRange(deal.budgetMin, deal.budgetMax)}
                </span>
              </div>

              <p className="mt-5 text-sm leading-relaxed text-white/75">{deal.description}</p>
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-4 text-sm">
                <p className={sectionLabel}>Deliverables</p>
                <p className="text-white/80">{deal.deliverables}</p>
              </div>

              {/* status timeline */}
              <div className="mt-6">
                <p className={sectionLabel}>Deal progress</p>
                <div className="flex items-center gap-1">
                  {STEPS.map((s, i) => {
                    const done = stepIndex >= 0 && i <= stepIndex;
                    return (
                      <div key={s} className="flex flex-1 items-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-black ${
                            done ? "border-primary bg-primary text-black" : "border-white/15 text-white/30"
                          }`}>
                            {i + 1}
                          </span>
                          <span className={`text-[10px] font-bold ${done ? "text-primary" : "text-white/30"}`}>
                            {STEP_LABELS[s]}
                          </span>
                        </div>
                        {i < STEPS.length - 1 && (
                          <div className={`mx-1 mb-5 h-0.5 flex-1 ${done && stepIndex > i ? "bg-primary" : "bg-white/10"}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* escrow box */}
              <div className="mt-6 rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Escrow
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                  <div>
                    <p className="text-white/40 text-xs">Status</p>
                    <p className="font-bold capitalize text-white">{deal.escrowStatus.replace("_", " ")}</p>
                  </div>
                  <div>
                    <p className="text-white/40 text-xs">Agreed payout</p>
                    <p className="font-bold text-white">{moneyCents(deal.agreedAmountCents)}</p>
                  </div>
                  <div>
                    <p className="text-white/40 text-xs">Platform fee (15%)</p>
                    <p className="font-bold text-white">{moneyCents(deal.platformFeeCents)}</p>
                  </div>
                  <div>
                    <p className="text-white/40 text-xs">Creator gets</p>
                    <p className="font-bold text-primary">{moneyCents(deal.creatorPayoutCents)}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-white/40">
                  The brand's payment is held in escrow and released to the creator on delivery —
                  Bow Down Visuals keeps 15%, the creator keeps 85%.
                </p>
              </div>
            </div>

            {/* ── creator: apply ── */}
            {!isBrand && deal.status === "active" && (
              <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
                {deal.myApplicationStatus ? (
                  <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Application {deal.myApplicationStatus}
                  </p>
                ) : (
                  <>
                    <h2 className="flex items-center gap-2 font-display text-xl font-black">
                      <PenLine className="h-5 w-5 text-primary" aria-hidden="true" /> Apply to this deal · free
                    </h2>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div>
                        <p className={sectionLabel}>Your name / handle</p>
                        <input value={creatorName} onChange={(e) => setCreatorName(e.target.value)} maxLength={120}
                          placeholder="e.g. TRGDY TRBLZ" className={inputClass} />
                      </div>
                      <div>
                        <p className={sectionLabel}>Your niche</p>
                        <input value={creatorNiche} onChange={(e) => setCreatorNiche(e.target.value)} maxLength={120}
                          placeholder="e.g. Music" className={inputClass} />
                      </div>
                      <div>
                        <p className={sectionLabel}>Followers</p>
                        <input value={creatorFollowers} onChange={(e) => setCreatorFollowers(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                          inputMode="numeric" placeholder="25000" className={inputClass} />
                      </div>
                      <div>
                        <p className={sectionLabel}>Tone</p>
                        <div className="flex gap-2">
                          {TONES.map((t) => (
                            <button key={t} onClick={() => setTone(t)}
                              className={`rounded-xl border px-4 py-2.5 text-sm font-bold capitalize transition ${
                                tone === t ? "border-primary bg-primary/15 text-primary" : "border-white/15 text-white/60 hover:text-white"
                              }`}>
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <p className={`${sectionLabel} mt-4`}>Your wins (optional)</p>
                    <input value={achievements} onChange={(e) => setAchievements(e.target.value)} maxLength={500}
                      placeholder="e.g. 2M views on my last drop, opened for…" className={inputClass} />
                    <button onClick={writePitch} disabled={pitchLoading}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50">
                      {pitchLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                      {pitchLoading ? "Writing…" : `AI pitch writer · ${AI_COST} credit`}
                    </button>

                    <p className={`${sectionLabel} mt-6`}>Your pitch</p>
                    <textarea value={pitch} onChange={(e) => setPitch(e.target.value)} maxLength={2000} rows={5}
                      placeholder="Why you're the one for this brand…" className={`${inputClass} resize-y`} />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button onClick={copyPitch} disabled={!pitch.trim()}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 transition hover:text-white disabled:opacity-40">
                        {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <p className={`${sectionLabel} mt-4`}>Portfolio / artist vault link (optional)</p>
                    <input value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} maxLength={500}
                      placeholder="https://… your best work" className={inputClass} />
                    <button onClick={applyToDeal} disabled={busy === "apply" || !pitch.trim()}
                      className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-3.5 text-base font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] disabled:opacity-50">
                      {busy === "apply" ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <PenLine className="h-5 w-5" aria-hidden="true" />}
                      {busy === "apply" ? "Sending…" : "Send application · free"}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── creator: work actions ── */}
            {isCreator && (
              <div className="mt-6 rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
                <h2 className="font-display text-xl font-black">Your deal</h2>
                <p className="mt-2 text-sm text-white/55">
                  {deal.status === "funded" && "The brand funded the escrow. Start work when you're ready."}
                  {deal.status === "in_progress" && "Work is underway — mark it delivered when you ship."}
                  {deal.status === "completed" && "Delivered! The brand reviews and releases your payment."}
                  {deal.status === "paid" && `Paid out: ${moneyCents(deal.creatorPayoutCents)} — nice work.`}
                </p>
                <div className="mt-4 flex gap-2">
                  {deal.status === "funded" && (
                    <button onClick={() => postAction(`/api/sponsors/deals/${dealId}/start`, "POST", undefined, "start")}
                      disabled={!!busy}
                      className="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50">
                      {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                      Start work
                    </button>
                  )}
                  {deal.status === "in_progress" && (
                    <button onClick={() => postAction(`/api/sponsors/deals/${dealId}/complete`, "POST", undefined, "complete")}
                      disabled={!!busy}
                      className="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50">
                      {busy === "complete" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PackageCheck className="h-4 w-4" aria-hidden="true" />}
                      Mark delivered
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── brand: applications ── */}
            {isBrand && (
              <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
                <h2 className="flex items-center gap-2 font-display text-xl font-black">
                  <Users className="h-5 w-5 text-primary" aria-hidden="true" />
                  Applications ({deal.applicationCount})
                </h2>
                {appsLoading ? (
                  <p className="mt-4 flex items-center gap-2 text-sm text-white/40">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
                  </p>
                ) : applications.length === 0 ? (
                  <p className="mt-4 text-sm text-white/50">No applications yet — share your deal to get creators pitching.</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {applications.map((a) => (
                      <div key={a.id} className="rounded-2xl border border-white/10 bg-black/40 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={`rounded-full border px-3 py-1 text-xs font-bold capitalize ${
                            a.status === "accepted" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                            : a.status === "rejected" ? "border-red-500/40 bg-red-500/10 text-red-300"
                            : "border-white/15 text-white/60"
                          }`}>
                            {a.status}
                          </span>
                          <span className="text-xs text-white/30">{new Date(a.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-white/80">{a.pitch}</p>
                        {a.portfolio_url && (
                          <a href={a.portfolio_url} target="_blank" rel="noreferrer"
                            className="mt-2 inline-block text-sm font-bold text-primary hover:underline">
                            View portfolio →
                          </a>
                        )}
                        {a.status === "pending" && deal.status === "active" && (
                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <input value={agreedDollars}
                              onChange={(e) => setAgreedDollars(e.target.value.replace(/[^0-9.]/g, "").slice(0, 10))}
                              inputMode="decimal" placeholder={`Agreed $ (${deal.budgetMin}–${deal.budgetMax})`}
                              className="w-48 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-primary/60" />
                            <button onClick={() => reviewApplication(a.id, "accept")}
                              disabled={reviewingId === a.id}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50">
                              {reviewingId === a.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                              Accept
                            </button>
                            <button onClick={() => reviewApplication(a.id, "reject")}
                              disabled={reviewingId === a.id}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-sm text-white/60 transition hover:text-white disabled:opacity-50">
                              <XCircle className="h-4 w-4" aria-hidden="true" /> Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* brand: fund / release */}
                {deal.acceptedApplicationId && deal.escrowStatus === "unfunded" && (
                  <div className="mt-6 rounded-2xl border border-primary/25 bg-black/40 p-5">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-white">
                      <Wallet className="h-4 w-4 text-primary" aria-hidden="true" />
                      Fund the escrow — {moneyCents(deal.agreedAmountCents)}
                    </p>
                    <p className="mt-1 text-xs text-white/50">
                      Your card is charged now; funds are held until you release them after delivery.
                    </p>
                    <button onClick={fundDeal} disabled={busy === "fund" || busy === "fund-confirm"}
                      className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-6 py-3 text-sm font-black text-black transition hover:scale-[1.03] disabled:opacity-50">
                      {(busy === "fund" || busy === "fund-confirm") ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                      {busy ? "Processing…" : `Fund ${moneyCents(deal.agreedAmountCents)}`}
                    </button>
                  </div>
                )}
                {deal.status === "completed" && (
                  <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-white">
                      <Banknote className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                      Work delivered — release {moneyCents(deal.agreedAmountCents)}?
                    </p>
                    <p className="mt-1 text-xs text-white/50">
                      The creator gets {moneyCents(deal.agreedAmountCents ? Math.round(deal.agreedAmountCents * 0.85) : null)} (85%) —
                      Bow Down Visuals keeps 15%.
                    </p>
                    <button onClick={() => postAction(`/api/sponsors/deals/${dealId}/release`, "POST", undefined, "release")}
                      disabled={busy === "release"}
                      className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50">
                      {busy === "release" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Banknote className="h-4 w-4" aria-hidden="true" />}
                      {busy === "release" ? "Releasing…" : "Release payment"}
                    </button>
                  </div>
                )}
                {deal.status === "paid" && (
                  <p className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Paid out {moneyCents(deal.creatorPayoutCents)} to the creator
                  </p>
                )}
              </div>
            )}

            {!isBrand && !isCreator && deal.status !== "active" && (
              <p className="mt-6 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
                <AlertTriangle className="h-4 w-4 text-primary/70" aria-hidden="true" />
                This deal is {STEP_LABELS[deal.status] ?? deal.status} — applications are closed.
              </p>
            )}
          </>
        )}
      </main>
      <SiteFooter />
      {outOfCredits && <OutOfCredits onClose={() => setOutOfCredits(false)} />}
    </div>
  );
}
