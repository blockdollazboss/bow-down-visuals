import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ageParts,
  countNeedsManualReview,
  filterReversals,
  formatUsdCents,
  parsePaymentReversals,
  REVERSAL_FILTERS,
  shortId,
  type PaymentReversalRow,
  type ReversalFilter,
} from "@/lib/admin-benches";

/* ─── Admin: Payment Reversals — the manual money-review queue ─────────
   The bench for GET /api/admin/payment-reversals (stack1000 P1's
   reversal engine trail; W6 finding F1: the rail had no frontend
   consumer, so the owner could not see the queue at all). Rows are
   written by the webhook's reversal engine from rail results. A row
   parked at 'needs_manual_review' is resolved HERE, through the
   rail's own verb (POST /api/admin/payment-reversals/:id/resolve —
   stack1100 Y2): 'complete' runs the engine's own completion path
   for the row, 'dismiss' closes the review with no money moved and
   requires a note. Both go through a confirm step that names the
   charge and refunded amounts from the row itself, and the recorded
   decision (who, when, which way, the note) renders on the row. */

const STATUS_CLS: Record<string, string> = {
  needs_manual_review: "border-red-400/40 bg-red-400/10 text-red-300",
  processing: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  completed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  partial_shortfall: "border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#e8c86a]",
  dismissed: "border-white/20 bg-white/5 text-white/50",
};

const STATUS_KEY: Record<string, string> = {
  needs_manual_review: "admin.reversals.status.needsManualReview",
  processing: "admin.reversals.status.processing",
  completed: "admin.reversals.status.completed",
  partial_shortfall: "admin.reversals.status.partialShortfall",
  dismissed: "admin.reversals.status.dismissed",
};

const FILTER_KEY: Record<ReversalFilter, string> = {
  all: "admin.reversals.filterAll",
  needs_manual_review: "admin.reversals.status.needsManualReview",
  completed: "admin.reversals.status.completed",
  partial_shortfall: "admin.reversals.status.partialShortfall",
  dismissed: "admin.reversals.status.dismissed",
  processing: "admin.reversals.status.processing",
};

type ResolveDecision = "complete" | "dismiss";

export function PaymentReversalsAdmin({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [rows, setRows] = useState<PaymentReversalRow[]>([]);
  const [filter, setFilter] = useState<ReversalFilter>("all");
  const [loading, setLoading] = useState(true);
  /* Load failures are NOT "no reversals" — own error state + retry;
     the empty state renders only for a successful load with no rows. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  /* The resolve flow: which parked row's confirm is open, which way
     it will go, the admin's note, and its own busy/error state (an
     action failure never masquerades as a load state). */
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [decision, setDecision] = useState<ResolveDecision>("complete");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const openConfirm = (rowId: string, d: ResolveDecision) => {
    setConfirmFor(rowId);
    setDecision(d);
    setNote("");
    setActionError(null);
  };

  const submitResolve = async (row: PaymentReversalRow) => {
    if (decision === "dismiss" && note.trim().length === 0) {
      setActionError(t("admin.reversals.noteRequired"));
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/payment-reversals/${row.id}/resolve`, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim() }),
      });
      if (res.ok) {
        setConfirmFor(null);
        await load();
      } else if (res.status === 409) {
        /* Someone (or the engine) resolved it first — reload so the
           recorded decision is what the bench shows. */
        setActionError(t("admin.reversals.conflict"));
        await load();
      } else {
        setActionError(t("admin.reversals.resolveError"));
      }
    } catch {
      setActionError(t("admin.reversals.resolveError"));
    } finally {
      setBusy(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/payment-reversals", { headers: await authHeaders() });
      const parsed = res.ok ? parsePaymentReversals(await res.json()) : null;
      if (parsed) setRows(parsed);
      else setLoadError(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load, retryNonce]);

  const parked = countNeedsManualReview(rows);
  const visible = filterReversals(rows, filter);
  const now = Date.now();

  const ageLabel = (iso: string): string | null => {
    const parts = ageParts(iso, now);
    if (!parts) return null;
    const unit =
      parts.unit === "minute"
        ? t("admin.reversals.ageMinute")
        : parts.unit === "hour"
          ? t("admin.reversals.ageHour")
          : t("admin.reversals.ageDay");
    return t("admin.reversals.age", { value: parts.value, unit });
  };

  return (
    <div
      className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="payment-reversals-bench"
    >
      <div className="flex items-center gap-2 mb-1">
        <Undo2 className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.reversals.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">{t("admin.reversals.description")}</p>

      {loading ? (
        <p className="text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin inline" /></p>
      ) : loadError ? (
        <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
            {t("admin.reversals.loadErrorTitle")}
          </p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            {t("admin.reversals.loadErrorBody")}
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-white/40">{t("admin.reversals.empty")}</p>
      ) : (
        <>
          {parked > 0 && (
            <div className="mb-4 rounded-xl border border-red-400/40 bg-red-400/10 px-4 py-3">
              <p className="text-sm font-semibold text-red-300">
                {t("admin.reversals.needsReviewCount", { count: parked })}
              </p>
            </div>
          )}
          <div className="mb-4 flex flex-wrap gap-2">
            {REVERSAL_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  filter === f
                    ? "border-primary/60 bg-primary/15 text-[#e8c86a]"
                    : "border-white/10 bg-black/30 text-white/50 hover:text-white"
                }`}
              >
                {t(FILTER_KEY[f])}
                {f === "needs_manual_review" && parked > 0 ? ` (${parked})` : ""}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-white/40">{t("admin.reversals.emptyFilter")}</p>
          ) : (
            <div className="space-y-3">
              {visible.map((r) => (
                <div key={r.id} className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <p className="text-sm font-semibold text-white">
                      {r.rail || "—"}
                      <span className="ml-2 text-xs font-normal text-white/40">{r.trigger}</span>
                    </p>
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CLS[r.status] ?? STATUS_CLS.processing}`}
                    >
                      {t(STATUS_KEY[r.status] ?? "", { defaultValue: r.status })}
                    </span>
                  </div>

                  {r.status === "needs_manual_review" && r.manualReason && (
                    <p className="mt-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-200">
                      <span className="font-semibold">{t("admin.reversals.manualReasonLabel")}: </span>
                      {r.manualReason}
                    </p>
                  )}

                  {r.resolution && (
                    <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60">
                      <span className="font-semibold text-white/80">
                        {r.resolution.decision === "dismiss"
                          ? t("admin.reversals.resolvedDismiss")
                          : t("admin.reversals.resolvedComplete")}
                      </span>
                      {r.resolution.adminEmail && (
                        <span> · {t("admin.reversals.resolvedBy", { email: r.resolution.adminEmail })}</span>
                      )}
                      {r.resolution.resolvedAt && (
                        <span> · {new Date(r.resolution.resolvedAt).toLocaleString()}</span>
                      )}
                      {r.resolution.note && (
                        <p className="mt-1 text-white/50">
                          {t("admin.reversals.noteLabel")}: {r.resolution.note}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
                    <span>
                      {t("admin.reversals.charge")} <span className="text-white/90 font-semibold">{formatUsdCents(r.chargeAmountCents)}</span>
                    </span>
                    <span>
                      {t("admin.reversals.refunded")} <span className="text-white/90 font-semibold">{formatUsdCents(r.refundedCentsSeen)}</span>
                    </span>
                    <span>
                      {t("admin.reversals.granted")} <span className="text-white/90 font-semibold">{r.grantedCredits.toLocaleString()} VB</span>
                    </span>
                    <span>
                      {t("admin.reversals.clawedBack")} <span className="text-white/90 font-semibold">{r.creditsClawed.toLocaleString()} VB</span>
                    </span>
                    {r.referralCreditsClawed > 0 && (
                      <span>
                        {t("admin.reversals.referralClawed")} <span className="text-white/90 font-semibold">{r.referralCreditsClawed.toLocaleString()} VB</span>
                      </span>
                    )}
                    {r.shortfallCredits > 0 && (
                      <span className="text-red-300">
                        {t("admin.reversals.shortfall")} <span className="font-semibold">{r.shortfallCredits.toLocaleString()} VB</span>
                      </span>
                    )}
                  </div>

                  {(r.disputeLost || r.entitlementRevoked || r.sellerReversed) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.disputeLost && (
                        <span className="rounded-full border border-red-400/40 bg-red-400/10 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                          {t("admin.reversals.disputeLost")}
                        </span>
                      )}
                      {r.entitlementRevoked && (
                        <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-white/70">
                          {t("admin.reversals.entitlementRevoked")}
                        </span>
                      )}
                      {r.sellerReversed && (
                        <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-white/70">
                          {t("admin.reversals.sellerReversed")}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/30">
                    {r.userId && (
                      <span title={r.userId}>{t("admin.reversals.member")} {shortId(r.userId)}</span>
                    )}
                    {r.stripeChargeId && (
                      <span title={r.stripeChargeId}>{shortId(r.stripeChargeId)}</span>
                    )}
                    {r.sessionId && (
                      <span title={r.sessionId}>{t("admin.reversals.session")} {shortId(r.sessionId)}</span>
                    )}
                    <span>{new Date(r.createdAt).toLocaleString()}</span>
                    {ageLabel(r.createdAt) && <span>{ageLabel(r.createdAt)}</span>}
                  </div>

                  {r.status === "needs_manual_review" && confirmFor !== r.id && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openConfirm(r.id, "complete")}
                        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/20"
                      >
                        <Check className="h-3.5 w-3.5" /> {t("admin.reversals.completeAction")}
                      </button>
                      <button
                        type="button"
                        onClick={() => openConfirm(r.id, "dismiss")}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/60 hover:text-white"
                      >
                        <X className="h-3.5 w-3.5" /> {t("admin.reversals.dismissAction")}
                      </button>
                    </div>
                  )}

                  {r.status === "needs_manual_review" && confirmFor === r.id && (
                    <div
                      className={`mt-3 rounded-lg border p-3 ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/30 bg-black/40"}`}
                      data-testid="reversal-resolve-confirm"
                    >
                      <p className={`text-sm font-semibold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                        {decision === "complete"
                          ? t("admin.reversals.confirmComplete", {
                              charge: formatUsdCents(r.chargeAmountCents),
                              refunded: formatUsdCents(r.refundedCentsSeen),
                            })
                          : t("admin.reversals.confirmDismiss", {
                              charge: formatUsdCents(r.chargeAmountCents),
                              refunded: formatUsdCents(r.refundedCentsSeen),
                            })}
                      </p>
                      <label
                        className={`mt-2 block text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}
                      >
                        {t("admin.reversals.noteLabel")}
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder={t("admin.reversals.notePlaceholder")}
                          rows={2}
                          maxLength={1000}
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                        />
                      </label>
                      {actionError && <p className="mt-2 text-xs font-semibold text-red-300">{actionError}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void submitResolve(r)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          {t("admin.reversals.confirmButton")}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmFor(null)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/60 hover:text-white disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" /> {t("admin.reversals.cancelButton")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <p className="mt-3 text-[11px] text-white/30">{t("admin.reversals.footerNote")}</p>
    </div>
  );
}
