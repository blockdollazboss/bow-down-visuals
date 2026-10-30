import { apiErrorMessage, plainErrorText } from "../../lib/api-error";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";

/**
 * Payout setup — the Connect door on the Earnings page (stack400 lane 5).
 *
 * The Connect backend has been complete since the payfix wave — account
 * creation, hosted onboarding links, a reconciled status state machine,
 * the seller-initiated payout and a payout history:
 *   POST /api/connect/onboard   create account (if needed) + setup link
 *   POST /api/connect/refresh   fresh setup link for an existing account
 *   GET  /api/connect/status    state + Stripe's action-needed reasons
 *   POST /api/connect/payout    cash out the pending balance
 *   GET  /api/connect/payouts   payout history
 * — and the Store Dashboard has carried a full Get Paid card since then.
 * But the Earnings page — where a seller lands to see "Pending payout
 * $X" — had the balance and the line items with NO way to start setup,
 * see the Connect state, or cash out. This card is that door, docked
 * directly under the pending-payout balance it acts on.
 *
 * Honest rails: bank setup itself happens on Stripe's hosted onboarding
 * pages (Connect onboarding is hosted by design — a seller's bank and
 * identity details never touch this site). That is NOT a checkout:
 * buyers never leave the site to pay; this is the seller's one-time
 * payout setup. The copy below says exactly that.
 *
 * States mirror the server state machine exactly:
 *   not_started   → Start payout setup
 *   action_needed → Stripe's own reasons + Continue setup
 *   pending       → Stripe is verifying + Continue setup / Check again
 *   verified      → readiness + pending amount + Cash out + history
 * A failed load says so (never a fake "not started"), and a user with
 * no creator profile gets the profile door, not a silent gap.
 */

export interface ConnectStatusRead {
  connected: boolean;
  accountId: string | null;
  onboarded: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  state: "not_started" | "pending" | "action_needed" | "verified";
  actionNeeded: string[];
  pendingCents: number;
  minPayoutCents: number;
  testMode: boolean;
}

interface PayoutHistoryRow {
  id: string;
  amountCents: number;
  status: string;
  stripeTransferId: string | null;
  createdAt: string;
}

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ConnectPayoutCard({ getToken }: { getToken: () => Promise<string | null> }) {
  const [status, setStatus] = useState<ConnectStatusRead | null>(null);
  const [history, setHistory] = useState<PayoutHistoryRow[]>([]);
  const [noProfile, setNoProfile] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<"connect" | "payout" | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const token = await getToken().catch(() => null);
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const res = await fetch("/api/connect/status", { headers });
    if (res.status === 404) { setNoProfile(true); return; }
    if (!res.ok) throw new Error(`connect status failed (${res.status})`);
    setStatus((await res.json()) as ConnectStatusRead);
    /* History is additive — a history failure never takes the card down. */
    try {
      const hres = await fetch("/api/connect/payouts", { headers });
      if (hres.ok) {
        const hdata = (await hres.json()) as { payouts?: PayoutHistoryRow[] };
        setHistory(hdata.payouts ?? []);
      }
    } catch { /* the list just stays as it was */ }
  }, [getToken]);

  useEffect(() => {
    let cancelled = false;
    load().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [load]);

  const goOnboard = async (path: "/api/connect/onboard" | "/api/connect/refresh") => {
    setErr(""); setNote(""); setBusy("connect");
    try {
      const token = await getToken().catch(() => null);
      const res = await fetch(path, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (!res.ok || !data.url) throw new Error(apiErrorMessage(data, "Couldn't start payout setup."));
      window.location.href = data.url;
    } catch (e) {
      setErr(plainErrorText(e, "Couldn't start payout setup."));
      setBusy(null);
    }
  };

  const doPayout = async () => {
    setErr(""); setNote(""); setBusy("payout");
    try {
      const token = await getToken().catch(() => null);
      const res = await fetch("/api/connect/payout", {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = (await res.json().catch(() => ({}))) as {
        payout?: { amountCents: number }; error?: string; message?: string; note?: string;
        actionNeeded?: string[];
      };
      if (!res.ok) {
        /* A NOT_ONBOARDED refusal carries Stripe's own reasons — show
           the first instead of a bare "isn't verified yet". */
        const reason = data.actionNeeded?.[0];
        throw new Error((data.message || data.error || "Payout failed.") + (reason ? ` ${reason}` : ""));
      }
      setNote(`Cash out sent: ${usd(data.payout?.amountCents ?? 0)}${data.note ? ` — ${data.note}` : ""}`);
      await load();
    } catch (e) {
      setErr(plainErrorText(e, "Payout failed."));
    } finally {
      setBusy(null);
    }
  };

  if (noProfile) {
    return (
      <div className="mt-4 rounded-xl border border-border bg-card p-5" data-testid="connect-payout-noprofile">
        <div className="text-sm text-muted-foreground">Payout setup</div>
        <p className="mt-2 text-sm text-muted-foreground">
          Payouts go to the bank on your creator profile. Set up your profile first — then you can
          connect a bank here and cash out what you earn.
        </p>
        <Link
          href="/choose-artist"
          className="mt-3 inline-block rounded-full bg-amber-400 px-5 py-2 text-sm font-bold text-black transition hover:scale-105"
        >
          Set up your creator profile →
        </Link>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="mt-4 rounded-xl border border-border bg-card p-5" data-testid="connect-payout-failed">
        <div className="text-sm text-muted-foreground">Payout setup</div>
        <div className="mt-2 text-lg font-semibold text-destructive">Couldn&apos;t load — try again</div>
        <button
          type="button"
          className="mt-3 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium"
          onClick={() => { setFailed(false); load().catch(() => setFailed(true)); }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="mt-4 rounded-xl border border-border bg-card p-5" data-testid="connect-payout-loading">
        <div className="text-sm text-muted-foreground">Payout setup</div>
        <div className="mt-2 text-sm text-muted-foreground">Loading your payout setup…</div>
      </div>
    );
  }

  const canCashOut = status.payoutsEnabled && status.pendingCents >= status.minPayoutCents;

  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-5" data-testid="connect-payout-card">
      <div className="flex items-center gap-2">
        <div className="text-sm text-muted-foreground">Payout setup</div>
        {status.testMode && (
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Test mode
          </span>
        )}
      </div>

      {status.state === "not_started" && (
        <>
          <div className="mt-2 text-2xl font-bold">Connect your bank to get paid</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Your sales pile up as the pending balance above. Connect a bank once — setup runs on
            Stripe&apos;s secure pages, because your bank and ID details never touch this site — and
            cash out whenever you want. (That&apos;s payout setup, not a checkout: buyers always pay
            right here on Bow Down Visuals.)
          </p>
          <button
            type="button"
            onClick={() => goOnboard("/api/connect/onboard")}
            disabled={busy === "connect"}
            className="mt-4 rounded-full bg-amber-400 px-5 py-2.5 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-60"
          >
            {busy === "connect" ? "Opening setup…" : "Start payout setup →"}
          </button>
        </>
      )}

      {status.state === "action_needed" && (
        <>
          <div className="mt-2 text-2xl font-bold">Stripe needs a little more from you</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Your payout setup is paused until Stripe gets the items below — finish them to unlock payouts.
          </p>
          {status.actionNeeded.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-600 dark:text-amber-300">
              {status.actionNeeded.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => goOnboard("/api/connect/refresh")}
            disabled={busy === "connect"}
            className="mt-4 rounded-full bg-amber-400 px-5 py-2.5 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-60"
          >
            {busy === "connect" ? "Opening setup…" : "Continue setup →"}
          </button>
        </>
      )}

      {status.state === "pending" && (
        <>
          <div className="mt-2 text-2xl font-bold">Stripe is checking your details</div>
          <p className="mt-1 text-sm text-muted-foreground">
            You&apos;ve submitted everything — Stripe is verifying it now. This page updates itself the
            moment Stripe flips you to ready; if anything else is needed, the exact reason shows here.
            Still mid-form? Continue your setup instead.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => goOnboard("/api/connect/refresh")}
              disabled={busy === "connect"}
              className="rounded-full bg-amber-400 px-5 py-2.5 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-60"
            >
              {busy === "connect" ? "Opening setup…" : "Continue setup →"}
            </button>
            <button
              type="button"
              onClick={() => { setErr(""); load().catch(() => setFailed(true)); }}
              className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              Check again
            </button>
          </div>
        </>
      )}

      {status.state === "verified" && (
        <>
          <div className="mt-2 text-2xl font-bold">Ready to cash out {usd(status.pendingCents)}</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Bank connected and verified. Minimum cash-out is {usd(status.minPayoutCents)}.
            Payouts are sent when you ask — nothing moves on its own.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={doPayout}
              disabled={!canCashOut || busy === "payout"}
              className="rounded-full bg-amber-400 px-5 py-2.5 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-40"
            >
              {busy === "payout" ? "Sending…" : `Cash out ${usd(status.pendingCents)}`}
            </button>
            <button
              type="button"
              onClick={() => goOnboard("/api/connect/refresh")}
              disabled={busy === "connect"}
              className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              Manage payout setup
            </button>
          </div>
          {!canCashOut && status.pendingCents < status.minPayoutCents && (
            <p className="mt-2 text-xs text-muted-foreground">
              Your pending balance is under the {usd(status.minPayoutCents)} minimum — it keeps
              building until it reaches it.
            </p>
          )}
        </>
      )}

      {history.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payout history</div>
          <ul className="mt-2 space-y-1.5">
            {history.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold">{usd(p.amountCents)}</span>
                <span className="flex-1 text-muted-foreground">
                  {new Date(p.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {p.status === "pending" ? "On its way" : p.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {note && <p className="mt-3 text-sm font-medium text-emerald-600 dark:text-emerald-300">{note}</p>}
      {err && (
        <div className="mt-3">
          <p className="text-sm font-medium text-destructive">{err}</p>
          <button
            type="button"
            onClick={() => { setErr(""); load().catch(() => setFailed(true)); }}
            className="mt-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
