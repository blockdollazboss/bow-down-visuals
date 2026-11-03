import { useEffect, useState } from "react";
import {
  ArrowLeft, BadgeDollarSign, Banknote, Briefcase, CheckCircle2, Loader2,
  Megaphone, PackageCheck, PenLine, Play, ShieldCheck, Sparkles, Users, XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  NativeEmptyState, NativeErrorState, NativeLoadingState,
} from "@/components/world/native/NativeStates";
import { NativeBoard, NativeBoardRow } from "@/components/world/native/NativeBoard";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import { formatBudgetRange, daysLeftLabel } from "@/lib/sponsors";
import {
  EMPTY_SPONSOR_POST_FORM,
  SPONSOR_CAN_SPEND_PATH,
  SPONSOR_DASHBOARD_PATH,
  SPONSOR_DEALS_PATH,
  SPONSOR_ESCROW_CONFIRM_PATH,
  SPONSOR_PITCH_COST_VB,
  SPONSOR_PITCH_PATH,
  SPONSOR_PITCH_TONES,
  SPONSOR_POST_COST_VB,
  SPONSOR_DEAL_STEPS,
  buildSponsorApplyPayload,
  buildSponsorPitchPayload,
  buildSponsorPostPayload,
  buildSponsorReviewPayload,
  isSponsorSpendingPaused,
  normalizeSponsorApplications,
  normalizeSponsorCanSpend,
  normalizeSponsorDashboard,
  normalizeSponsorDealDetail,
  normalizeSponsorFundResult,
  normalizeSponsorPitchResult,
  normalizeSponsorPostResult,
  sponsorDealActionPath,
  sponsorDealApplicationsPath,
  sponsorDealApplyPath,
  sponsorDealPath,
  sponsorDealStepIndex,
  sponsorApplicationPath,
  sponsorErrorMessage,
  sponsorFundAmountCents,
  sponsorMoneyCents,
  sponsorPostFormError,
  sponsorReleasePreview,
  type SponsorApplication,
  type SponsorDashboardData,
  type SponsorFullDeal,
  type SponsorPitchTone,
  type SponsorPostForm,
} from "@/lib/world/sponsor-depth";

/* ─── SponsorDepthDesk — the sponsor marketplace at full depth,
   in-World (stack1400 world parity wave 1, item 5) ────────────────
   The StudioBoard's sponsor pipeline card was a summary: active
   count, dollars in play, next to touch. This desk is the working
   depth behind it, on the sponsors router's own rails — the same
   endpoints the 2D pages call:

   - POST a deal as a brand (POST /api/sponsors/deals): 500 Visual
     Bucs, named on the button and confirmed through the credit
     registry before the ask — the rail charges before the save and
     auto-refunds a failed save. The can-spend readout is checked on
     arrival, so a paused account hears it before the first attempt.
   - The DASHBOARD (GET /api/sponsors/dashboard): my posted deals,
     my applications, my payouts and the earned total — numbers only
     ever render from a successful load, never a painted $0.00.
   - A DEAL at full detail (GET /api/sponsors/deals/:id): the offer,
     the lifecycle steps, the escrow box with the rail's own stamped
     fee/payout cents, and every action the rail supports — apply
     (free) with the 100-Buc AI pitch writer, brand review
     (accept/reject with the agreed payout inside the budget), fund
     escrow (embedded payment right here; sandbox confirms in place;
     the hosted page only when the rail returns one, the 2D page's
     own by-design fallback), creator start / mark delivered, and
     the brand's release (the rail splits 15% / 85%).

   Everything completes inside the World — no page pull-ups, no
   doors to the 2D pages. Shaping lives in lib/world/sponsor-depth;
   this desk is the form and the boards only. */

const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

export function SponsorDepthDesk({ isLight }: { isLight: boolean }) {
  const { user, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const labelCls = `block text-xs font-bold ${muted}`;

  const [dashboard, setDashboard] = useState<SponsorDashboardData | null>(null);
  const [dashFailed, setDashFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [spendingPaused, setSpendingPaused] = useState(false);

  /* Post a deal */
  const [showPost, setShowPost] = useState(false);
  const [postForm, setPostForm] = useState<SponsorPostForm>(EMPTY_SPONSOR_POST_FORM);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postOutOfCredits, setPostOutOfCredits] = useState(false);

  /* Deal detail */
  const [openId, setOpenId] = useState<string | null>(null);
  const [deal, setDeal] = useState<SponsorFullDeal | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [applications, setApplications] = useState<SponsorApplication[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [agreedDollars, setAgreedDollars] = useState("");
  const [fundSecret, setFundSecret] = useState<string | null>(null);

  /* Apply + pitch writer */
  const [pitch, setPitch] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [pitchName, setPitchName] = useState("");
  const [pitchNiche, setPitchNiche] = useState("");
  const [pitchFollowers, setPitchFollowers] = useState("");
  const [pitchWins, setPitchWins] = useState("");
  const [pitchTone, setPitchTone] = useState<SponsorPitchTone>("professional");
  const [pitchWriting, setPitchWriting] = useState(false);
  const [pitchOutOfCredits, setPitchOutOfCredits] = useState(false);

  const loadDashboard = async () => {
    try {
      const res = await fetch(SPONSOR_DASHBOARD_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error(`dashboard ${res.status}`);
      const parsed = normalizeSponsorDashboard(await res.json());
      if (!parsed) throw new Error("dashboard shape");
      setDashboard(parsed);
      setDashFailed(false);
    } catch {
      setDashFailed(true);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadDashboard();
      if (cancelled) return;
      /* The can-spend readout: learn the paused state on arrival,
         like the 2D post page — fail-open, the submit-time 403
         still answers honestly. */
      try {
        const res = await fetch(SPONSOR_CAN_SPEND_PATH, { headers: await authHeaders() });
        if (res.ok && !cancelled && normalizeSponsorCanSpend(await res.json()) === false) {
          setSpendingPaused(true);
        }
      } catch {
        /* readout unreachable — the submit-time 403 still speaks */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const loadDetail = async (id: string) => {
    setDetailFailed(false);
    try {
      const res = await fetch(sponsorDealPath(id), { headers: await authHeaders() });
      if (!res.ok) throw new Error(`deal ${res.status}`);
      const parsed = normalizeSponsorDealDetail(await res.json());
      if (!parsed) throw new Error("deal shape");
      setDeal(parsed);
      if (user && parsed.postedBy === user.id) {
        try {
          const appsRes = await fetch(sponsorDealApplicationsPath(id), { headers: await authHeaders() });
          setApplications(appsRes.ok ? normalizeSponsorApplications(await appsRes.json()) : null);
        } catch {
          setApplications(null);
        }
      } else {
        setApplications(null);
      }
    } catch {
      setDetailFailed(true);
    }
  };

  useEffect(() => {
    if (!openId) return;
    setDeal(null);
    setApplications(null);
    setDetailError(null);
    setFundSecret(null);
    setAgreedDollars("");
    void loadDetail(openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const openDeal = (id: string) => setOpenId(id);
  const closeDeal = () => {
    setOpenId(null);
    setDeal(null);
    setTick((n) => n + 1);
  };

  /* ── Post a deal ─────────────────────────────────────────────── */
  const postDeal = async () => {
    const formError = sponsorPostFormError(postForm);
    if (formError) {
      setPostError(formError);
      return;
    }
    const payload = buildSponsorPostPayload(postForm);
    if (!payload || posting) return;
    setPosting(true);
    setPostError(null);
    setPostOutOfCredits(false);
    try {
      const res = await confirmedFetch(SPONSOR_DEALS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res) return; /* the walker cancelled the credit confirmation */
      const body: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setPostOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (isSponsorSpendingPaused(body, res.status)) {
        setSpendingPaused(true);
        setPostError(sponsorErrorMessage(body, res.status, "Posting didn't go through — try again."));
        refreshProfile();
        return;
      }
      if (!res.ok) {
        setPostError(sponsorErrorMessage(body, res.status, "Posting the deal didn't go through — try again."));
        return;
      }
      const result = normalizeSponsorPostResult(body);
      refreshProfile();
      setPostForm(EMPTY_SPONSOR_POST_FORM);
      setShowPost(false);
      setTick((n) => n + 1);
      if (result) openDeal(result.dealId);
    } catch {
      setPostError("Posting the deal didn't go through — try again.");
    } finally {
      setPosting(false);
    }
  };

  /* ── Detail actions ──────────────────────────────────────────── */
  const runAction = async (
    path: string,
    method: string,
    body: unknown,
    busyKey: string,
  ): Promise<Record<string, unknown> | null> => {
    if (!openId) return null;
    setBusy(busyKey);
    setDetailError(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setDetailError(sponsorErrorMessage(data, res.status, "That didn't go through — try again."));
        return null;
      }
      await loadDetail(openId);
      setTick((n) => n + 1);
      return (data ?? {}) as Record<string, unknown>;
    } catch {
      setDetailError("That didn't go through — try again.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const applyToDeal = async () => {
    if (!openId) return;
    const payload = buildSponsorApplyPayload(pitch, portfolioUrl);
    if (!payload) {
      setDetailError("Write your pitch first.");
      return;
    }
    const data = await runAction(sponsorDealApplyPath(openId), "POST", payload, "apply");
    if (data) {
      setPitch("");
      setPortfolioUrl("");
    }
  };

  const writePitch = async () => {
    if (!openId || pitchWriting) return;
    const payload = buildSponsorPitchPayload(openId, {
      creatorName: pitchName,
      niche: pitchNiche,
      followers: pitchFollowers,
      achievements: pitchWins,
      tone: pitchTone,
    });
    if (!payload) {
      setDetailError("Add your niche first — the pitch writer needs it.");
      return;
    }
    setPitchWriting(true);
    setDetailError(null);
    setPitchOutOfCredits(false);
    try {
      const res = await confirmedFetch(SPONSOR_PITCH_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res) return; /* cancelled the credit confirmation */
      const body: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setPitchOutOfCredits(true);
        refreshProfile();
        return;
      }
      const written = res.ok ? normalizeSponsorPitchResult(body) : null;
      if (!written) {
        setDetailError(sponsorErrorMessage(body, res.status, "The pitch writer didn't answer — try again."));
        return;
      }
      setPitch(written);
      refreshProfile();
    } catch {
      setDetailError("The pitch writer didn't answer — try again.");
    } finally {
      setPitchWriting(false);
    }
  };

  const reviewApplication = async (app: SponsorApplication, action: "accept" | "reject") => {
    if (!deal) return;
    const built = buildSponsorReviewPayload(action, agreedDollars, deal);
    if ("error" in built) {
      setDetailError(built.error);
      return;
    }
    const data = await runAction(sponsorApplicationPath(app.id), "PATCH", built.payload, `review-${app.id}`);
    if (data) setAgreedDollars("");
  };

  const fundDeal = async () => {
    if (!openId || !deal) return;
    const amountCents = sponsorFundAmountCents(deal, agreedDollars);
    if (!amountCents) {
      setDetailError("There's no agreed payout to fund yet.");
      return;
    }
    setFundSecret(null);
    const data = await runAction(
      sponsorDealActionPath(openId, "fund"),
      "POST",
      { amountCents, uiMode: hasStripePublishableKey() ? "embedded" : undefined },
      "fund",
    );
    if (!data) return;
    const fund = normalizeSponsorFundResult(data);
    if (!fund) return;
    if (fund.sandbox && fund.sessionId) {
      /* Sandbox: simulate the card payment completing, in place. */
      await runAction(SPONSOR_ESCROW_CONFIRM_PATH, "POST", { dealId: openId, sessionId: fund.sessionId }, "fund-confirm");
    } else if (fund.clientSecret) {
      setFundSecret(fund.clientSecret);
    } else if (fund.checkoutUrl) {
      /* The rail's own hosted fallback — the payment moment only,
         exactly as the 2D detail page answers it. */
      window.location.href = fund.checkoutUrl;
    }
  };

  const isBrand = !!user && !!deal && deal.postedBy === user.id;
  const isCreator = !!user && !!deal && deal.acceptedUserId === user.id;
  const stepIndex = deal ? sponsorDealStepIndex(deal.status) : -1;
  const releasePreview = deal?.agreedAmountCents ? sponsorReleasePreview(deal.agreedAmountCents) : null;

  const setPostField = (key: keyof SponsorPostForm) => (e: { target: { value: string } }) =>
    setPostForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="space-y-3" data-testid="world-sponsor-depth-desk">
      {openId ? (
        <NativeCard isLight={isLight} title="Sponsor deal">
          <button type="button" data-testid="world-sponsor-depth-back" onClick={closeDeal} className={chipBtn(isLight)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back to your sponsor desk
          </button>
          {detailFailed ? (
            <NativeErrorState
              isLight={isLight}
              title="The deal wouldn't open"
              message="The deal is safe — its page just didn't answer. Try again."
              onRetry={() => void loadDetail(openId)}
            />
          ) : !deal ? (
            <NativeLoadingState isLight={isLight} message="Opening the deal…" />
          ) : (
            <div className="mt-3 space-y-4">
              <div>
                <p className={`flex items-center gap-2 text-xs font-black uppercase tracking-wide ${muted}`}>
                  <Briefcase className="h-3.5 w-3.5 text-[#d4af37]" /> {deal.niche}
                </p>
                <p className={`mt-1 text-lg font-black ${strong}`}>{deal.brandName}</p>
                <p className={`text-xs ${muted}`}>
                  {daysLeftLabel(deal.deadline)} · {formatBudgetRange(deal.budgetMin, deal.budgetMax)} budget ·{" "}
                  {deal.applicationCount} application{deal.applicationCount === 1 ? "" : "s"}
                </p>
                <p className={`mt-2 text-sm ${strong}`}>{deal.description}</p>
                <p className={`mt-2 text-xs ${muted}`}>
                  <span className="font-bold">Deliverables:</span> {deal.deliverables}
                </p>
              </div>

              {/* Lifecycle steps */}
              <div className="flex flex-wrap gap-1.5" data-testid="world-sponsor-depth-steps">
                {SPONSOR_DEAL_STEPS.map((s, i) => (
                  <span
                    key={s}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize ${
                      stepIndex >= 0 && i <= stepIndex
                        ? "border-[#d4af37] bg-[#d4af37]/15 text-[#d4af37]"
                        : isLight
                          ? "border-[#7A5A12]/25 text-[#6B5B36]"
                          : "border-white/15 text-white/40"
                    }`}
                  >
                    {i + 1}. {s.replace("_", " ")}
                  </span>
                ))}
              </div>

              {/* Escrow box — the rail's own stamped cents */}
              <div
                data-testid="world-sponsor-depth-escrow"
                className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
              >
                <p className={`flex items-center gap-1.5 text-xs font-black uppercase tracking-wide ${muted}`}>
                  <ShieldCheck className="h-3.5 w-3.5 text-[#d4af37]" /> Escrow
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <span className={muted}>Status<br /><span className={`text-sm font-bold capitalize ${strong}`}>{deal.escrowStatus.replace("_", " ")}</span></span>
                  <span className={muted}>Agreed payout<br /><span className={`text-sm font-bold ${strong}`}>{sponsorMoneyCents(deal.agreedAmountCents)}</span></span>
                  <span className={muted}>Platform fee<br /><span className={`text-sm font-bold ${strong}`}>{sponsorMoneyCents(deal.platformFeeCents)}</span></span>
                  <span className={muted}>Creator gets<br /><span className="text-sm font-bold text-[#d4af37]">{sponsorMoneyCents(deal.creatorPayoutCents)}</span></span>
                </div>
                <p className={`mt-2 text-xs ${muted}`}>
                  The brand funds the escrow up front; the money releases to the creator when the
                  work is delivered, with the platform fee split out by the rail.
                </p>
              </div>

              {detailError && (
                <p role="alert" data-testid="world-sponsor-depth-detail-error" className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                  {detailError}
                </p>
              )}

              {/* Creator: apply */}
              {!isBrand && deal.status === "active" && (
                <div className="space-y-3" data-testid="world-sponsor-depth-apply">
                  {deal.myApplicationStatus ? (
                    <p className={`inline-flex items-center gap-1.5 text-sm font-bold ${strong}`}>
                      <CheckCircle2 className="h-4 w-4 text-[#d4af37]" /> You applied — status: {deal.myApplicationStatus}
                    </p>
                  ) : (
                    <>
                      <p className={`flex items-center gap-2 text-sm font-black ${strong}`}>
                        <PenLine className="h-4 w-4 text-[#d4af37]" /> Apply for this deal
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <label className={labelCls} htmlFor="world-sponsor-pitch-name">Your name</label>
                          <input id="world-sponsor-pitch-name" className={deskInputCls(isLight)} maxLength={120} value={pitchName} onChange={(e) => setPitchName(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className={labelCls} htmlFor="world-sponsor-pitch-niche">Your niche</label>
                          <input id="world-sponsor-pitch-niche" data-testid="world-sponsor-pitch-niche" className={deskInputCls(isLight)} maxLength={120} value={pitchNiche} onChange={(e) => setPitchNiche(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className={labelCls} htmlFor="world-sponsor-pitch-followers">Followers</label>
                          <input id="world-sponsor-pitch-followers" className={deskInputCls(isLight)} inputMode="numeric" value={pitchFollowers} onChange={(e) => setPitchFollowers(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))} />
                        </div>
                        <div className="space-y-1">
                          <span className={labelCls}>Tone</span>
                          <div className="flex flex-wrap gap-1.5">
                            {SPONSOR_PITCH_TONES.map((toneDef) => (
                              <button
                                key={toneDef.key}
                                type="button"
                                aria-pressed={pitchTone === toneDef.key}
                                onClick={() => setPitchTone(toneDef.key)}
                                className={pitchTone === toneDef.key ? goldBtn : chipBtn(isLight)}
                              >
                                {toneDef.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className={labelCls} htmlFor="world-sponsor-pitch-wins">Your wins</label>
                        <input id="world-sponsor-pitch-wins" className={deskInputCls(isLight)} maxLength={500} value={pitchWins} onChange={(e) => setPitchWins(e.target.value)} />
                      </div>
                      <button type="button" data-testid="world-sponsor-write-pitch" onClick={() => void writePitch()} disabled={pitchWriting} className={chipBtn(isLight)}>
                        {pitchWriting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {pitchWriting ? "Writing…" : `Write my pitch — ${SPONSOR_PITCH_COST_VB} Visual Bucs`}
                      </button>
                      {pitchOutOfCredits && (
                        <p className={`text-xs font-semibold ${strong}`}>Not enough Visual Bucs for the pitch writer — applying yourself below is free.</p>
                      )}
                      <div className="space-y-1">
                        <label className={labelCls} htmlFor="world-sponsor-pitch">Your pitch</label>
                        <textarea id="world-sponsor-pitch" data-testid="world-sponsor-pitch" className={deskInputCls(isLight)} rows={4} maxLength={2000} value={pitch} onChange={(e) => setPitch(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className={labelCls} htmlFor="world-sponsor-portfolio">Portfolio link (optional)</label>
                        <input id="world-sponsor-portfolio" className={deskInputCls(isLight)} maxLength={500} value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} />
                      </div>
                      <button type="button" data-testid="world-sponsor-apply" onClick={() => void applyToDeal()} disabled={busy === "apply" || !pitch.trim()} className={goldBtn}>
                        {busy === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />}
                        {busy === "apply" ? "Sending…" : "Send application — free"}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Creator: the work */}
              {isCreator && (deal.status === "funded" || deal.status === "in_progress" || deal.status === "completed" || deal.status === "paid") && (
                <div className="space-y-2" data-testid="world-sponsor-depth-work">
                  <p className={`text-sm font-black ${strong}`}>Your deal</p>
                  <p className={`text-xs ${muted}`}>
                    {deal.status === "funded" && "The escrow is funded — start the work when you're ready."}
                    {deal.status === "in_progress" && "Work is under way — mark it delivered when it's done."}
                    {deal.status === "completed" && "Delivered — the brand releases the payment next."}
                    {deal.status === "paid" && `Paid out — you received ${sponsorMoneyCents(deal.creatorPayoutCents)}.`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {deal.status === "funded" && (
                      <button type="button" data-testid="world-sponsor-start" onClick={() => void runAction(sponsorDealActionPath(deal.id, "start"), "POST", undefined, "start")} disabled={!!busy} className={goldBtn}>
                        {busy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start work
                      </button>
                    )}
                    {deal.status === "in_progress" && (
                      <button type="button" data-testid="world-sponsor-complete" onClick={() => void runAction(sponsorDealActionPath(deal.id, "complete"), "POST", undefined, "complete")} disabled={!!busy} className={goldBtn}>
                        {busy === "complete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />} Mark delivered
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Brand: applications + escrow actions */}
              {isBrand && (
                <div className="space-y-3" data-testid="world-sponsor-depth-brand">
                  <p className={`flex items-center gap-2 text-sm font-black ${strong}`}>
                    <Users className="h-4 w-4 text-[#d4af37]" /> Applications ({deal.applicationCount})
                  </p>
                  {applications === null ? (
                    <p className={`text-xs ${muted}`}>Applications couldn't be read just now — try reopening the deal.</p>
                  ) : applications.length === 0 ? (
                    <p className={`text-xs ${muted}`}>No applications yet — creators see your deal in the marketplace.</p>
                  ) : (
                    applications.map((a) => (
                      <div key={a.id} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold capitalize ${
                            a.status === "accepted" ? "border-emerald-500/40 text-emerald-500" : a.status === "rejected" ? "border-red-500/40 text-red-400" : isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/60"
                          }`}>{a.status}</span>
                          <span className={`text-[11px] ${muted}`}>{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : ""}</span>
                        </div>
                        <p className={`mt-2 text-sm ${strong}`}>{a.pitch}</p>
                        {a.portfolioUrl && (
                          <p className={`mt-1 break-all text-xs ${muted}`}>Portfolio: {a.portfolioUrl}</p>
                        )}
                        {a.status === "pending" && deal.status === "active" && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <input
                              aria-label="Agreed payout in dollars"
                              data-testid="world-sponsor-agreed"
                              className={`${deskInputCls(isLight)} w-44`}
                              inputMode="decimal"
                              placeholder={`$${deal.budgetMin.toLocaleString("en-US")}–$${deal.budgetMax.toLocaleString("en-US")}`}
                              value={agreedDollars}
                              onChange={(e) => setAgreedDollars(e.target.value.replace(/[^0-9.]/g, "").slice(0, 10))}
                            />
                            <button type="button" data-testid="world-sponsor-accept" onClick={() => void reviewApplication(a, "accept")} disabled={busy === `review-${a.id}`} className={goldBtn}>
                              {busy === `review-${a.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Accept
                            </button>
                            <button type="button" data-testid="world-sponsor-reject" onClick={() => void reviewApplication(a, "reject")} disabled={busy === `review-${a.id}`} className={chipBtn(isLight)}>
                              <XCircle className="h-3.5 w-3.5" /> Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}

                  {deal.acceptedApplicationId && deal.escrowStatus === "unfunded" && (
                    <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                      <p className={`flex items-center gap-1.5 text-sm font-bold ${strong}`}>
                        <ShieldCheck className="h-4 w-4 text-[#d4af37]" /> Fund the escrow — {sponsorMoneyCents(deal.agreedAmountCents)}
                      </p>
                      <p className={`mt-1 text-xs ${muted}`}>The money is held safely until the creator delivers; the payment form opens right here.</p>
                      <button type="button" data-testid="world-sponsor-fund" onClick={() => void fundDeal()} disabled={busy === "fund" || busy === "fund-confirm"} className={`${goldBtn} mt-2`}>
                        {busy === "fund" || busy === "fund-confirm" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                        {busy ? "Processing…" : `Fund ${sponsorMoneyCents(deal.agreedAmountCents)}`}
                      </button>
                    </div>
                  )}
                  {fundSecret && (
                    <div className="space-y-2" data-testid="world-sponsor-fund-embedded">
                      <p className={`text-xs ${muted}`}>Finish funding the escrow right here — the deal shows as funded the moment the payment lands.</p>
                      <EmbeddedSessionCheckout clientSecret={fundSecret} />
                      <button type="button" onClick={() => setFundSecret(null)} className={chipBtn(isLight)}>
                        Close — the escrow stays unfunded until a payment completes
                      </button>
                    </div>
                  )}
                  {deal.status === "completed" && (
                    <div className={`rounded-xl border p-3 ${isLight ? "border-emerald-500/30 bg-emerald-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
                      <p className={`flex items-center gap-1.5 text-sm font-bold ${strong}`}>
                        <Banknote className="h-4 w-4 text-emerald-500" /> Release {sponsorMoneyCents(deal.agreedAmountCents)}
                      </p>
                      <p className={`mt-1 text-xs ${muted}`}>
                        The creator receives {releasePreview ? sponsorMoneyCents(releasePreview.netCents) : "—"} after the platform fee
                        {releasePreview ? ` (${sponsorMoneyCents(releasePreview.feeCents)})` : ""} — the rail stamps the settled split on the deal.
                      </p>
                      <button type="button" data-testid="world-sponsor-release" onClick={() => void runAction(sponsorDealActionPath(deal.id, "release"), "POST", undefined, "release")} disabled={busy === "release"} className={`${goldBtn} mt-2`}>
                        {busy === "release" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Banknote className="h-3.5 w-3.5" />} Release payment
                      </button>
                    </div>
                  )}
                  {deal.status === "paid" && (
                    <p className={`inline-flex items-center gap-1.5 text-sm font-bold ${strong}`}>
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Paid out — the creator received {sponsorMoneyCents(deal.creatorPayoutCents)}.
                    </p>
                  )}
                </div>
              )}

              {!isBrand && !isCreator && deal.status !== "active" && (
                <p className={`text-xs ${muted}`}>This deal is {deal.status.replace("_", " ")} — applications are closed.</p>
              )}
            </div>
          )}
        </NativeCard>
      ) : (
        <>
          {/* Summary — numbers only from a successful load */}
          <NativeCard isLight={isLight} title="Sponsor desk">
            {dashFailed ? (
              <NativeErrorState
                isLight={isLight}
                title="The sponsor desk wouldn't open"
                message="Your deals and earnings are safe — the desk just didn't answer. Try again."
                onRetry={() => void loadDashboard()}
              />
            ) : !dashboard ? (
              <NativeLoadingState isLight={isLight} message="Opening your sponsor desk…" />
            ) : (
              <div className="space-y-3" data-testid="world-sponsor-depth-summary">
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                  <span className={strong}>
                    <Banknote className="mr-1 inline h-4 w-4 text-[#d4af37]" />
                    <span className="font-black text-[#d4af37]">{sponsorMoneyCents(dashboard.totalEarnedCents)}</span> earned as a creator
                  </span>
                  <span className={strong}>
                    <span className="font-black">{dashboard.postedDeals.length}</span> deal{dashboard.postedDeals.length === 1 ? "" : "s"} posted ·{" "}
                    {dashboard.postedDeals.filter((d) => d.status === "active").length} open
                  </span>
                  <span className={strong}>
                    <span className="font-black">{dashboard.applications.length}</span> application{dashboard.applications.length === 1 ? "" : "s"} sent ·{" "}
                    {dashboard.applications.filter((a) => a.applicationStatus === "accepted").length} accepted
                  </span>
                </div>
                <button type="button" data-testid="world-sponsor-post-toggle" onClick={() => setShowPost((v) => !v)} disabled={spendingPaused} className={goldBtn}>
                  <Megaphone className="h-3.5 w-3.5" /> Post a deal — {SPONSOR_POST_COST_VB} Visual Bucs
                </button>
                {spendingPaused && (
                  <p className={`text-xs font-semibold ${strong}`}>Credit spending is paused on this account right now — posting is paused with it, and nothing was charged.</p>
                )}
              </div>
            )}
          </NativeCard>

          {showPost && !spendingPaused && (
            <NativeCard isLight={isLight} title="Post a sponsorship deal">
              <div className="space-y-3" data-testid="world-sponsor-post-form">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className={labelCls} htmlFor="world-sponsor-post-brand">Brand name</label>
                    <input id="world-sponsor-post-brand" data-testid="world-sponsor-post-brand" className={deskInputCls(isLight)} maxLength={120} value={postForm.brandName} onChange={setPostField("brandName")} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls} htmlFor="world-sponsor-post-niche">Niche</label>
                    <input id="world-sponsor-post-niche" className={deskInputCls(isLight)} maxLength={120} value={postForm.niche} onChange={setPostField("niche")} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls} htmlFor="world-sponsor-post-min">Budget min ($)</label>
                    <input id="world-sponsor-post-min" className={deskInputCls(isLight)} inputMode="numeric" value={postForm.budgetMin} onChange={(e) => setPostForm((f) => ({ ...f, budgetMin: e.target.value.replace(/[^0-9]/g, "").slice(0, 8) }))} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls} htmlFor="world-sponsor-post-max">Budget max ($)</label>
                    <input id="world-sponsor-post-max" className={deskInputCls(isLight)} inputMode="numeric" value={postForm.budgetMax} onChange={(e) => setPostForm((f) => ({ ...f, budgetMax: e.target.value.replace(/[^0-9]/g, "").slice(0, 8) }))} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls} htmlFor="world-sponsor-post-deadline">Deadline</label>
                    <input id="world-sponsor-post-deadline" data-testid="world-sponsor-post-deadline" type="date" className={deskInputCls(isLight)} value={postForm.deadline} onChange={setPostField("deadline")} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls} htmlFor="world-sponsor-post-deliverables">Deliverables</label>
                    <input id="world-sponsor-post-deliverables" className={deskInputCls(isLight)} maxLength={500} value={postForm.deliverables} onChange={setPostField("deliverables")} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className={labelCls} htmlFor="world-sponsor-post-description">Description</label>
                  <textarea id="world-sponsor-post-description" className={deskInputCls(isLight)} rows={3} maxLength={2000} value={postForm.description} onChange={setPostField("description")} />
                </div>
                {postError && (
                  <p role="alert" data-testid="world-sponsor-post-error" className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{postError}</p>
                )}
                {postOutOfCredits && (
                  <p className={`text-xs font-semibold ${strong}`}>Not enough Visual Bucs to post — it costs {SPONSOR_POST_COST_VB}. Top up at the Treasury; nothing was charged.</p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" data-testid="world-sponsor-post-submit" onClick={() => void postDeal()} disabled={posting} className={goldBtn}>
                    {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />}
                    {posting ? "Posting…" : `Post the deal — ${SPONSOR_POST_COST_VB} Visual Bucs`}
                  </button>
                  <span className={`inline-flex items-center gap-1 text-xs ${muted}`}>
                    <BadgeDollarSign className="h-3.5 w-3.5 text-[#d4af37]" /> Charged before the save; a failed save is refunded automatically.
                  </span>
                </div>
              </div>
            </NativeCard>
          )}

          {dashboard && (
            <>
              <NativeBoard isLight={isLight} title="Deals you posted">
                {dashboard.postedDeals.length === 0 ? (
                  <NativeEmptyState isLight={isLight} message="No deals posted yet." detail="Post one above — it lands in the marketplace for creators to apply to." />
                ) : (
                  dashboard.postedDeals.map((d) => (
                    <NativeBoardRow
                      key={d.id}
                      isLight={isLight}
                      title={d.brandName}
                      detail={[d.niche, d.status.replace("_", " "), `${d.applicationCount} application${d.applicationCount === 1 ? "" : "s"}`, d.agreedAmountCents != null ? `escrow ${d.escrowStatus}: ${sponsorMoneyCents(d.agreedAmountCents)}` : null].filter(Boolean).join(" · ")}
                      meta={formatBudgetRange(d.budgetMin, d.budgetMax)}
                      action={
                        <button type="button" data-testid="world-sponsor-open-deal" onClick={() => openDeal(d.id)} className={goldBtn}>Open</button>
                      }
                    />
                  ))
                )}
              </NativeBoard>

              <NativeBoard isLight={isLight} title="Your applications">
                {dashboard.applications.length === 0 ? (
                  <NativeEmptyState isLight={isLight} message="No applications sent yet." detail="Open a deal from the marketplace boards and apply with a pitch." />
                ) : (
                  dashboard.applications.map((a) => (
                    <NativeBoardRow
                      key={a.id}
                      isLight={isLight}
                      title={a.brandName}
                      detail={[a.niche, `deal ${a.dealStatus.replace("_", " ")}`, a.pitch].filter(Boolean).join(" · ")}
                      meta={a.applicationStatus}
                      action={
                        <button type="button" data-testid="world-sponsor-open-application" onClick={() => openDeal(a.dealId)} className={goldBtn}>Open</button>
                      }
                    />
                  ))
                )}
              </NativeBoard>

              <NativeBoard isLight={isLight} title="Your sponsor earnings">
                {dashboard.payouts.length === 0 ? (
                  <NativeEmptyState isLight={isLight} message="No payouts yet." detail="When a brand releases a deal you delivered, the payout lands here." />
                ) : (
                  dashboard.payouts.map((p) => (
                    <NativeBoardRow
                      key={p.id}
                      isLight={isLight}
                      title={p.brandName}
                      detail={[p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "", `gross ${sponsorMoneyCents(p.grossCents)} · fee ${sponsorMoneyCents(p.feeCents)}`].filter(Boolean).join(" · ")}
                      meta={sponsorMoneyCents(p.netCents)}
                      action={
                        <button type="button" data-testid="world-sponsor-open-payout" onClick={() => openDeal(p.dealId)} className={goldBtn}>Open</button>
                      }
                    />
                  ))
                )}
              </NativeBoard>
            </>
          )}
        </>
      )}
    </div>
  );
}
