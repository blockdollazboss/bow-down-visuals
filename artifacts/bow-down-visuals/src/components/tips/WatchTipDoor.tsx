import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  HandCoins, Loader2, Heart, BadgeAlert, Check, PiggyBank, Trophy, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useModalA11y } from "@/hooks/use-modal-a11y";
import { apiErrorMessage } from "@/lib/api-error";
import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout";

/* ─── Watch-page tip door (Stack-200 upgrade N4, stack1300) ─────────────
   The canonical tip jar had doors on the profile and in Shorts, but the
   video watch page — where fans actually watch — had none. This is that
   door: it probes the SAME jar the other doors use
   (GET /api/tips/page/:handle, which resolves a profile slug too) and
   renders NOTHING when the creator has no tip jar — no dead buttons,
   the Shorts rule. When a jar exists:
   - signed-out fans get the sign-in door (never a button that does
     nothing): /login?next=<this watch page>, the house pattern;
   - signed-in fans get the tip panel right here — the tip page's own
     flow (same rail, same suggested amounts, same words from the
     tipPage locale keys, same embedded on-site checkout, same 503
     intent fallback), never a trip to another page.
   Tips carry NO platform fee — 100% reaches the creator (the rail's
   TIP-TRUTH contract) — and this door's copy claims nothing else. */

interface PublicPage {
  handle: string;
  displayName: string;
  message: string;
  suggestedAmounts: number[];
  goalAmount: number | null;
  goalLabel: string;
}

interface FundingGoalView {
  label: string;
  targetAmount: number;
  currency: string;
  raised: number | null;
  raisedCount: number | null;
  progress: number | null;
  reached: boolean;
  reachedAt: string | null;
  progressUnavailable?: boolean;
}

/** The tip page's data shape, as served by GET /api/tips/page/:handle. */
interface TipPageData {
  page: PublicPage;
  goal: FundingGoalView | null;
  stats: { total: number; count: number; average: number; goalProgress: number | null };
  paymentsLive: boolean;
  notice: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

export function WatchTipDoor({
  handleOrSlug,
  signInNext,
}: {
  /** The creator's profile slug or tip handle — the jar resolves both. */
  handleOrSlug: string | null | undefined;
  /** Where a signed-out fan returns after sign-in (this watch page). */
  signInNext: string;
}) {
  const { user, profile } = useAuth();
  const [data, setData] = useState<TipPageData | null>(null);
  const [open, setOpen] = useState(false);

  /* The Shorts probe: the door exists only when the jar does. */
  useEffect(() => {
    setData(null);
    setOpen(false);
    if (!handleOrSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tips/page/${encodeURIComponent(handleOrSlug)}`);
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        if (!cancelled && json?.page?.handle) setData(json as TipPageData);
      } catch { /* no tip jar — the door stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, [handleOrSlug]);

  if (!data) return null;

  const doorClass =
    "px-5 py-3 text-sm rounded-full border font-semibold flex items-center gap-2 transition-colors border-[#e8c86a] bg-[#e8c86a] text-black hover:brightness-110";

  if (!user) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(signInNext)}`}
        className={doorClass}
        title="Tip the creator"
        data-testid="watch-tip-signin-door"
      >
        <HandCoins className="h-5 w-5" /> Tip
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={doorClass}
        title="Tip the creator"
        data-testid="watch-tip-door"
      >
        <HandCoins className="h-5 w-5" /> Tip
      </button>
      {open && (
        <WatchTipPanel
          data={data}
          initialFanName={profile?.display_name ?? ""}
          returnPath={signInNext}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function WatchTipPanel({
  data,
  initialFanName,
  returnPath,
  onClose,
}: {
  data: TipPageData;
  initialFanName: string;
  /** This watch page's own path — the rail lands the fan back here
   *  when the checkout session ends (see returnPath in sendTip). */
  returnPath: string;
  onClose: () => void;
}) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const dialogRef = useModalA11y<HTMLDivElement>(true, onClose);
  const handle = data.page.handle;

  const [amount, setAmount] = useState<number | null>(
    data.page.suggestedAmounts?.length ? data.page.suggestedAmounts[0] : null,
  );
  const [customAmount, setCustomAmount] = useState("");
  const [fanName, setFanName] = useState(initialFanName);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  /* Embedded checkout (TIP-TRUTH): a returned client secret mounts the
     payment form right here in the panel — the fan never leaves the
     watch page for a hosted checkout page. */
  const [embeddedSecret, setEmbeddedSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveAmount = customAmount.trim() ? Number(customAmount) : amount;

  /* The tip page's send flow, rail for rail (tip-page.tsx sendTip):
     real checkout first; a 503 means payments aren't configured —
     fall back to recording the tip intent, exactly the page's
     behavior; every other failure is shown plainly and the Send
     button stays live so the fan can retry. */
  async function sendTip() {
    if (!effectiveAmount || effectiveAmount <= 0) {
      setError(t("tipPage.amountRequired"));
      return;
    }
    setSending(true);
    setError(null);
    setEmbeddedSecret(null);
    try {
      const co = await fetch(`/api/tips/${encodeURIComponent(handle)}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: effectiveAmount,
          fanName,
          message,
          uiMode: hasStripePublishableKey() ? "embedded" : undefined,
          /* The tip started HERE: when the session ends, the rail
             lands the fan back on this watch page instead of the
             tip page (the rail admits only house-minted path shapes
             and falls back to /tips/:handle for anything else). The
             tip itself settles by webhook either way. */
          returnPath,
        }),
      });
      if (co.ok) {
        const coJson = await co.json().catch(() => null);
        if (coJson?.clientSecret) {
          setEmbeddedSecret(coJson.clientSecret as string);
          return;
        }
        if (coJson?.checkoutUrl) {
          window.location.href = coJson.checkoutUrl as string;
          return;
        }
      } else if (co.status !== 503) {
        const coJson = await co.json().catch(() => null);
        setError(coJson?.details?.[0]?.message ?? apiErrorMessage(coJson, t("tipPage.recordFailed")));
        return;
      }
      const res = await fetch(`/api/tips/${encodeURIComponent(handle)}/tip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: effectiveAmount, fanName, message }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.details?.[0]?.message ?? apiErrorMessage(json, t("tipPage.recordFailed")));
        return;
      }
      setSent(true);
    } catch {
      setError(t("tipPage.genericError"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${t("tipPage.tipHeading")} ${data.page.displayName}`}
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className={`relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border p-6 text-center text-white shadow-[0_20px_60px_rgba(0,0,0,.8)] ${
          isLight
            ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
            : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"
        }`}
        data-testid="watch-tip-panel"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-white/40 hover:text-white"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        {sent ? (
          <div className="py-8" data-testid="watch-tip-sent">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
              <Check className="h-8 w-8 text-emerald-400" />
            </div>
            <h2 className="mt-4 text-2xl font-bold">{t("tipPage.recordedTitle")}</h2>
            <p className="mx-auto mt-2 max-w-sm text-white/55">
              {t("tipPage.recordedBody", { name: data.page.displayName, amount: effectiveAmount?.toFixed(2) })}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/70 transition hover:bg-white/[0.06]"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/25 to-primary/25">
              <HandCoins className="h-7 w-7 text-primary" />
            </div>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight">
              {t("tipPage.tipHeading")}{" "}
              <span className="bg-gradient-to-r from-amber-200 via-primary to-amber-200 bg-clip-text text-transparent">
                {data.page.displayName}
              </span>
            </h2>
            {data.page.message && <p className="mx-auto mt-2 max-w-sm text-sm text-white/60">{data.page.message}</p>}

            {data.goal != null && (
              <div className="mx-auto mt-4 max-w-sm">
                {data.goal.reached ? (
                  <div className="rounded-2xl border border-amber-400/40 bg-gradient-to-r from-amber-500/20 via-primary/20 to-amber-500/20 px-4 py-3">
                    <div className="flex items-center justify-center gap-2 text-sm font-extrabold text-amber-200">
                      <Trophy className="h-4 w-4 text-primary" />
                      {t("tipPage.goalReachedTitle")}
                    </div>
                    <p className="mt-1 text-xs text-white/60">
                      {t("tipPage.goalReachedBody", {
                        label: data.goal.label || t("tipPage.goalDefault"),
                        raised: (data.goal.raised ?? 0).toFixed(2),
                        goal: data.goal.targetAmount.toFixed(2),
                      })}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-xs text-white/50">
                      <span>{data.goal.label || t("tipPage.goalDefault")}</span>
                      {data.goal.raised != null ? (
                        <span>${data.goal.raised.toFixed(2)} / ${data.goal.targetAmount.toFixed(2)}</span>
                      ) : (
                        <span>${data.goal.targetAmount.toFixed(2)}</span>
                      )}
                    </div>
                    {data.goal.progress != null && (
                      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-primary"
                          style={{ width: `${Math.round(data.goal.progress * 100)}%` }}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-white/40">
              <PiggyBank className="h-4 w-4 text-primary" />
              {t("tipPage.tipStats", { count: data.stats.count, total: data.stats.total.toFixed(2) })}
            </div>

            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/45">{t("tipPage.chooseAmount")}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {data.page.suggestedAmounts.map((a) => (
                  <button
                    type="button"
                    key={a}
                    onClick={() => { setAmount(a); setCustomAmount(""); }}
                    className={`rounded-xl border px-5 py-2.5 text-sm font-bold transition ${
                      amount === a && !customAmount.trim()
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-white/15 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
                    }`}
                  >
                    ${a}
                  </button>
                ))}
              </div>
              <input
                aria-label={t("tipPage.customAmountPlaceholder")}
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder={t("tipPage.customAmountPlaceholder")}
                className={`${inputClass} mt-3 text-center`}
                inputMode="decimal"
              />
            </div>

            <div className="mt-4 space-y-3 text-left">
              <input
                aria-label={t("tipPage.fanNamePlaceholder")}
                value={fanName}
                onChange={(e) => setFanName(e.target.value)}
                placeholder={t("tipPage.fanNamePlaceholder")}
                className={inputClass}
                maxLength={60}
              />
              <textarea
                aria-label={t("tipPage.messagePlaceholder")}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("tipPage.messagePlaceholder")}
                className={inputClass}
                rows={2}
                maxLength={280}
              />
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" role="alert">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={sendTip}
              disabled={sending}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-primary px-4 py-3.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className="h-4 w-4" />}
              {t("tipPage.sendTipButton", { amount: effectiveAmount && effectiveAmount > 0 ? effectiveAmount.toFixed(2) : "0.00" })}
            </button>

            {embeddedSecret && (
              <div className="mt-4 space-y-3 text-left" data-testid="watch-tip-embedded-checkout">
                <p className={`text-xs font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>
                  Your payment form is right here — the tip lands the moment the payment confirms.
                </p>
                <EmbeddedSessionCheckout clientSecret={embeddedSecret} />
                <button
                  type="button"
                  onClick={() => setEmbeddedSecret(null)}
                  className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/[0.06]"
                >
                  Close — nothing is charged until you complete the form
                </button>
              </div>
            )}

            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3 text-left text-xs text-amber-200/85">
              <BadgeAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p>{data.notice}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
