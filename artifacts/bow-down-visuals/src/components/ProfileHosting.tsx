import { apiErrorMessage } from "../lib/api-error";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Check, Globe, Loader2, BadgeCheck } from "lucide-react";
import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout";
import { useAuth } from "@/contexts/AuthContext";
import { loginPathWithNext } from "@/lib/auth-next";
import { postJsonWithTransportRetry } from "@/lib/checkout-fetch";
import {
  hostingCardState,
  type HostingLoadPhase,
  type HostingMeView,
  type HostingPlanView,
} from "@/lib/profile-hosting-state";

/* ─── Profile Hosting — the $9/mo plan's door ───────────────────────────
   Stack-200 wave A5 (money census item 5): the Hosting rail
   (GET /creator-hosting/plan · /me · POST /creator-hosting/checkout)
   was complete server-side with ZERO frontend callers — a ruled,
   priced product nobody could buy — and its checkout was hosted-only.
   The checkout is now an embedded Checkout Session and this card is
   the door, docked on /creator-pricing in the money flow (under the
   plan cards, beside the gift desk) — the surface the plan's own
   feature rows have always pointed at (#feature-site).

   Copy law: every string renders from the profileHosting catalog
   namespace. The price line and the Elite-inclusion wording are
   MONEY copy — the English source sits verbatim in all 10 catalogs
   (never agent-translated), figures ride {{price}} / {{date}}
   interpolation. The plan's name/tagline/feature rows come from the
   server DTO, the same single source the tier cards read theirs from.

   States derive through hostingCardState (lib/profile-hosting-state):
   an Elite member sees "Included with Elite" and NO buy button (the
   rail refuses them a second charge with 409 — the door never offers
   one); checkout-not-configured shows the ruled price with an honest
   nothing-to-pay line, never a dead button. Checkout completion
   returns to /creator-pricing?hosting=return&session_id=… — the
   entitlement lands via the Stripe webhook sync, so the card polls
   /me until the hosted state shows, saying "switching on" meanwhile
   instead of pretending.                                            */

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function priceLabel(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2);
}

export default function ProfileHosting({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [plan, setPlan] = useState<HostingPlanView | null>(null);
  const [me, setMe] = useState<HostingMeView | null>(null);
  const [phase, setPhase] = useState<HostingLoadPhase>("loading");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const pollRef = useRef(0);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, [getAccessToken]);

  const loadMe = useCallback(async (): Promise<HostingMeView | null> => {
    try {
      const res = await fetch("/api/creator-hosting/me", { headers: await authHeaders() });
      if (res.status === 404) {
        setPhase("no-profile");
        return null;
      }
      if (!res.ok) {
        setPhase("failed");
        return null;
      }
      const data = (await res.json()) as HostingMeView;
      setMe(data);
      setPlan(data.plan);
      setPhase("ready");
      return data;
    } catch {
      setPhase("failed");
      return null;
    }
  }, [authHeaders]);

  /* Public plan for the signed-out pitch (price + features); a failed
     plan read never blocks the signed-in /me read. */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/creator-hosting/plan");
        if (live && res.ok) {
          const data = await res.json();
          if (data.plan) setPlan((prev) => prev ?? (data.plan as HostingPlanView));
        }
      } catch { /* pitch degrades to the /me read when signed in */ }
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadMe();
  }, [user, loadMe]);

  /* Embedded-checkout return: ?hosting=return&session_id=… — the
     entitlement lands through the webhook sync, so poll /me a few
     times until it shows; the switching-on note covers the gap
     honestly. The session id itself is never trusted as proof. */
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("hosting") !== "return") return;
    setReturning(true);
    pollRef.current = 0;
    const timer = setInterval(() => {
      pollRef.current += 1;
      if (pollRef.current > 8) {
        clearInterval(timer);
        return;
      }
      void loadMe().then((fresh) => {
        if (fresh?.hostingEntitled) clearInterval(timer);
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [user, loadMe]);

  async function startCheckout() {
    if (!user) {
      window.location.href = loginPathWithNext("/creator-pricing");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      /* Transport-resilient like the tier buy: the session create is
         idempotency-keyed server-side (same member + price + hosting
         state + request fingerprint), so a transport retry replays
         the same session — never a second subscription. */
      const { ok, data } = await postJsonWithTransportRetry("/api/creator-hosting/checkout", {
        token,
        body: { returnTo: "/creator-pricing" },
      });
      if (ok && data.clientSecret) {
        setClientSecret(data.clientSecret as string);
        return;
      }
      setError(apiErrorMessage(data, t("profileHosting.checkoutDidntStart")));
    } catch {
      setError(t("profileHosting.checkoutDidntStart"));
    } finally {
      setBusy(false);
    }
  }

  const state = hostingCardState({ signedIn: !!user, phase, me, plan });
  const shownPlan = state.kind === "signed-out" || state.kind === "no-profile" ? state.plan : state.kind === "loading" || state.kind === "load-failed" ? plan : state.me.plan;
  const price = shownPlan ? priceLabel(shownPlan.priceUsdPerMonth) : null;

  const cardCls = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] text-[#2A1E07]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const noteCls = isLight ? "text-[#6B5B36]" : "text-white/55";

  return (
    <section id="profile-hosting" data-testid="profile-hosting-card" className={`mt-12 scroll-mt-24 rounded-3xl border p-6 sm:p-8 ${cardCls}`}>
      <h2 className="text-2xl font-black">
        <Globe className={`mr-2 inline h-6 w-6 ${isLight ? "text-[#7A5A12]" : "text-amber-300"}`} />
        {t("profileHosting.heading")}
      </h2>
      {shownPlan && <p className={`mt-2 max-w-2xl text-sm ${noteCls}`}>{shownPlan.tagline}</p>}
      {price && (
        <div className="mt-3 flex items-end gap-2">
          <span className="text-3xl font-black">{t("profileHosting.pricePerMonth", { price })}</span>
        </div>
      )}
      <p className={`mt-1 text-sm font-semibold ${isLight ? "text-[#7A5A12]" : "text-amber-300"}`}>
        {t("profileHosting.includedWithEliteNote")}
      </p>

      {shownPlan && shownPlan.features.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm">
          {shownPlan.features.map((f) => (
            <li key={f.label} className="flex items-start gap-2">
              <Check className={`mt-0.5 h-4 w-4 shrink-0 ${isLight ? "text-emerald-700" : "text-emerald-300"}`} />
              <span className={noteCls}>{f.label}</span>
            </li>
          ))}
        </ul>
      )}

      {state.kind === "loading" && (
        <div className="mt-5 flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}

      {state.kind === "load-failed" && (
        <button
          onClick={() => { setPhase("loading"); void loadMe(); }}
          className={`mt-5 rounded-full border px-5 py-2.5 text-sm font-bold ${isLight ? "border-[#C9A84C]/60 text-[#2A1E07]" : "border-white/25 text-white"}`}
        >
          {t("profileHosting.loadFailed")}
        </button>
      )}

      {state.kind === "signed-out" && (
        <p className="mt-5 text-sm">
          <Link href={loginPathWithNext("/creator-pricing")} className={`font-bold ${isLight ? "text-[#7A5A12]" : "text-amber-300"}`}>
            {t("profileHosting.signInPrompt")}
          </Link>
        </p>
      )}

      {state.kind === "no-profile" && (
        <p className={`mt-5 text-sm ${noteCls}`}>{t("profileHosting.noProfile")}</p>
      )}

      {state.kind === "elite-included" && (
        <div className="mt-5 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-4 text-sm text-emerald-200">
          <BadgeCheck className="mr-1.5 inline h-4 w-4" /> {t("profileHosting.eliteActive")}
        </div>
      )}

      {state.kind === "admin-entitled" && (
        <div className="mt-5 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-4 text-sm text-emerald-200">
          <BadgeCheck className="mr-1.5 inline h-4 w-4" /> {t("profileHosting.adminActive")}
        </div>
      )}

      {state.kind === "hosting-active" && (
        <div className="mt-5">
          <div className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-4 text-sm text-emerald-200">
            <BadgeCheck className="mr-1.5 inline h-4 w-4" /> {t("profileHosting.hostingActive")}
            {state.me.currentPeriodEnd && (
              <span> {t("profileHosting.activeUntil", { date: fmtDate(state.me.currentPeriodEnd) })}</span>
            )}
          </div>
          <p className={`mt-2 text-xs ${noteCls}`}>{t("profileHosting.renewsNote")}</p>
        </div>
      )}

      {state.kind === "not-switched-on" && (
        <p className={`mt-5 text-sm ${noteCls}`}>{t("profileHosting.notSwitchedOn")}</p>
      )}

      {returning && state.kind !== "hosting-active" && state.kind !== "elite-included" && state.kind !== "admin-entitled" && (
        <div className="mt-5 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-200">
          {t("profileHosting.switchingOn")}
        </div>
      )}

      {state.kind === "buy" && !clientSecret && (
        <div className="mt-5">
          <button
            onClick={startCheckout}
            disabled={busy}
            className="rounded-full bg-gradient-to-b from-amber-200 to-amber-500 px-6 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {t("profileHosting.openingCheckout")}</span>
            ) : (
              t("profileHosting.buyButton", { price: price ?? "" })
            )}
          </button>
          <p className={`mt-2 text-xs ${noteCls}`}>{t("profileHosting.renewsNote")}</p>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>
      )}

      {clientSecret && (
        <div className="mt-5">
          {hasStripePublishableKey() ? (
            <EmbeddedSessionCheckout clientSecret={clientSecret} />
          ) : (
            <div className="rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-sm text-red-200">
              {t("profileHosting.checkoutDidntStart")}
            </div>
          )}
          <button
            onClick={() => setClientSecret(null)}
            className="mt-2 w-full text-center text-xs text-white/40 hover:text-white/70"
          >
            {t("profileHosting.cancelCheckout")}
          </button>
        </div>
      )}
    </section>
  );
}
