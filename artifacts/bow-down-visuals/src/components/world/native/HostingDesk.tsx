/**
 * HostingDesk — the Profile Hosting door, native in the World
 * (Stack 300 item 90, census A5).
 *
 * Profile Hosting ($9/mo standalone, included with Creator Elite)
 * sold on /creator-pricing with NO World twin — the walker had to
 * drop out of the palace to buy, check, or cancel the plan that
 * puts their profile on its own domain. This desk rides the exact
 * rails the 2D card rides (GET /api/creator-hosting/plan + /me,
 * POST /api/creator-hosting/checkout, POST /api/creator-tiers/portal)
 * and renders the SAME card state machine
 * (lib/profile-hosting-state.ts hostingCardState) over strict
 * parsers (lib/world/hosting-desk.ts) — one truth, two doors.
 *
 * House rules kept: status + headline actions native; the embedded
 * checkout form mounts IN the desk (no leaving the site); the
 * Stripe billing portal — the sanctioned money-moment exception —
 * opens in a NEW TAB; the portal route resolves the shared Stripe
 * customer, so a hosting-only buyer reaches manage/cancel from
 * here too (item 88). Mounted in EarningsBoard directly under
 * PlansDesk (the plan + hosting pair of the Get Paid rack).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Check, Globe, Loader2 } from "lucide-react";
import { NativeCard } from "@/components/world/native/NativeCard";
import { useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import {
  EmbeddedSessionCheckout,
  hasStripePublishableKey,
} from "@/components/checkout/EmbeddedCheckout";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { postJsonWithTransportRetry } from "@/lib/checkout-fetch";
import {
  hostingCardState,
  type HostingLoadPhase,
  type HostingMeView,
  type HostingPlanView,
} from "@/lib/profile-hosting-state";
import {
  parseHostingMe,
  parseHostingPlan,
  hostingCheckoutPayload,
  hostingPortalPayload,
} from "@/lib/world/hosting-desk";

function fmtDate(iso: string, lng: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lng || "en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function HostingDesk({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const authHeaders = useDeskAuthHeaders();
  const [phase, setPhase] = useState<HostingLoadPhase>("loading");
  const [plan, setPlan] = useState<HostingPlanView | null>(null);
  const [me, setMe] = useState<HostingMeView | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalOpened, setPortalOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const [planRes, meRes] = await Promise.all([
        fetch("/api/creator-hosting/plan"),
        fetch("/api/creator-hosting/me", { headers: await authHeaders() }),
      ]);
      const planDto = planRes.ok ? parseHostingPlan(await planRes.json().catch(() => null)) : null;
      if (meRes.status === 404) {
        /* The rail's named no-profile answer — hosting needs a
           creator profile to anchor to, same as the 2D card. */
        if (planDto) setPlan(planDto);
        setPhase("no-profile");
        return;
      }
      if (!meRes.ok) {
        setPhase("failed");
        return;
      }
      const meDto = parseHostingMe(await meRes.json().catch(() => null));
      if (!meDto) {
        setPhase("failed");
        return;
      }
      setMe(meDto);
      setPlan(planDto ?? meDto.plan);
      setPhase("ready");
    } catch {
      setPhase("failed");
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Returning to the palace re-reads the truth (the PlansDesk focus
     precedent) — a portal cancel in the other tab shows up here
     without a reload. An open checkout form is never yanked. */
  useEffect(() => {
    const onFocus = () => {
      if (!clientSecret) void load();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load, clientSecret]);

  async function startCheckout() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const token = headers.Authorization?.replace(/^Bearer\s+/i, "") ?? null;
      /* The rail answers a session clientSecret (embedded) — the
         form mounts below, in this desk, never a redirect. */
      const result = await postJsonWithTransportRetry("/api/creator-hosting/checkout", {
        token,
        body: hostingCheckoutPayload(),
      });
      const payload = (result.data ?? {}) as { clientSecret?: string };
      if (!result.ok || !payload.clientSecret) {
        setError(apiErrorMessage(payload, t("profileHosting.checkoutDidntStart")) || t("profileHosting.checkoutDidntStart"));
        return;
      }
      setClientSecret(payload.clientSecret);
    } catch (e) {
      setError(plainErrorText(e, t("worldHostingDesk.networkHiccup")));
    } finally {
      setBusy(false);
    }
  }

  /* Manage / cancel: the billing portal opens in a NEW TAB — the
     one sanctioned money-moment exit — and its return lands back
     in the World. */
  async function openManage() {
    if (portalBusy) return;
    setPortalBusy(true);
    setPortalError(null);
    setPortalOpened(false);
    try {
      const res = await fetch("/api/creator-tiers/portal", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(hostingPortalPayload()),
      });
      const payload = (await res.json().catch(() => ({}))) as { url?: string };
      if (!res.ok || !payload.url) {
        setPortalError(apiErrorMessage(payload, t("worldHostingDesk.portalOpenFailed")) || t("worldHostingDesk.portalOpenFailed"));
        return;
      }
      window.open(payload.url, "_blank", "noopener,noreferrer");
      setPortalOpened(true);
    } catch {
      setPortalError(t("worldHostingDesk.portalOpenFailed"));
    } finally {
      setPortalBusy(false);
    }
  }

  const state = hostingCardState({ signedIn: true, phase, me, plan });
  const ink = isLight ? "text-[#2a1e07]" : "text-white";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const goldBtn =
    "inline-flex items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-2 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";
  const ghostBtn = `rounded-full border px-4 py-2 text-xs font-bold transition disabled:opacity-50 bdv-touch-target ${isLight ? "border-[#7A5A12]/40 text-[#2a1e07]" : "border-white/20 text-white"}`;

  return (
    <div data-testid="world-hosting-desk">
      <NativeCard isLight={isLight} title={t("worldHostingDesk.title")}>
        <p className={`flex items-start gap-1.5 text-xs ${muted}`}>
          <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("profileHosting.tagline")}</span>
        </p>

        {state.kind === "loading" && (
          <p className={`mt-3 flex items-center gap-2 text-sm ${ink}`}>
            <Loader2 className="h-4 w-4 animate-spin" /> {t("worldHostingDesk.loading")}
          </p>
        )}

        {state.kind === "load-failed" && (
          <div className="mt-3">
            <p className="text-sm text-red-300">{t("worldHostingDesk.loadFailed")}</p>
            <button onClick={() => { void load(); }} className={`mt-2 ${ghostBtn}`}>
              {t("worldHostingDesk.tryAgain")}
            </button>
          </div>
        )}

        {state.kind === "no-profile" && (
          <p className={`mt-3 text-sm ${ink}`}>{t("profileHosting.noProfile")}</p>
        )}

        {state.kind === "elite-included" && (
          <div className="mt-3 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm text-emerald-200">
            <BadgeCheck className="mr-1.5 inline h-4 w-4" /> {t("profileHosting.eliteActive")}
          </div>
        )}

        {state.kind === "admin-entitled" && (
          <div className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
            <BadgeCheck className="mr-1.5 inline h-4 w-4" /> {t("profileHosting.adminActive")}
          </div>
        )}

        {state.kind === "hosting-active" && (
          <div className="mt-3">
            <div className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm text-emerald-200">
              <BadgeCheck className="mr-1.5 inline h-4 w-4" /> {t("profileHosting.hostingActive")}
              {state.me.currentPeriodEnd && (
                <span> {t("profileHosting.activeUntil", { date: fmtDate(state.me.currentPeriodEnd, i18n.language) })}</span>
              )}
            </div>
            <p className={`mt-2 text-xs ${muted}`}>{t("profileHosting.renewsNote")}</p>
            <button onClick={() => { void openManage(); }} disabled={portalBusy} className={`mt-3 ${ghostBtn}`}>
              {portalBusy ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("worldHostingDesk.opening")}
                </span>
              ) : (
                t("worldHostingDesk.manage")
              )}
            </button>
            {portalOpened && <p className={`mt-2 text-xs ${muted}`}>{t("worldHostingDesk.portalOpened")}</p>}
            {portalError && <p className="mt-2 text-xs font-semibold text-red-400">{portalError}</p>}
          </div>
        )}

        {state.kind === "not-switched-on" && (
          <div className="mt-3 rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-200">
            {t("profileHosting.notSwitchedOn")}
          </div>
        )}

        {state.kind === "buy" && (
          <div className="mt-3">
            <p className={`text-lg font-black ${ink}`}>
              {t("profileHosting.pricePerMonth", { price: state.me.plan.priceUsdPerMonth })}
            </p>
            <p className={`mt-0.5 text-xs ${muted}`}>{t("profileHosting.includedWithEliteNote")}</p>
            {state.me.plan.tagline ? <p className={`mt-2 text-xs ${muted}`}>{state.me.plan.tagline}</p> : null}
            {state.me.plan.features.length > 0 && (
              <ul className={`mt-2 space-y-1 text-xs ${ink}`}>
                {state.me.plan.features.map((f) => (
                  <li key={f.label} className="flex items-start gap-1.5">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
                    <span>{f.label}</span>
                  </li>
                ))}
              </ul>
            )}
            {!clientSecret && (
              <button
                onClick={() => { void startCheckout(); }}
                disabled={busy || !state.me.plan.available}
                className={`mt-3 ${goldBtn}`}
              >
                {busy ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("profileHosting.openingCheckout")}
                  </span>
                ) : (
                  t("profileHosting.buyButton")
                )}
              </button>
            )}
            {error && <p className="mt-2 text-xs font-semibold text-red-400">{error}</p>}
            {clientSecret && (
              <div className="mt-3">
                {hasStripePublishableKey() ? (
                  <EmbeddedSessionCheckout clientSecret={clientSecret} />
                ) : (
                  /* Item 116's honesty, carried in-world: a missing
                     publishable key is a site config fault — no
                     retry promise. */
                  <div className="rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-200">
                    {t("profileHosting.checkoutUnavailable")}
                  </div>
                )}
                <button onClick={() => setClientSecret(null)} className={`mt-3 ${ghostBtn}`}>
                  {t("profileHosting.cancelCheckout")}
                </button>
              </div>
            )}
          </div>
        )}
      </NativeCard>
    </div>
  );
}
