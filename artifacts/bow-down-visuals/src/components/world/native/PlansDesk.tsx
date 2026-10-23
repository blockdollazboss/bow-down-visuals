import { useCallback, useEffect, useState } from "react";
import { Check, Crown, Loader2 } from "lucide-react";
import { NativeCard } from "@/components/world/native/NativeCard";
import { useDeskAuthHeaders } from "@/components/world/native/CreateDeskShared";
import {
  apiErrorLine,
  parseSitePlanMe,
  parseSitePlans,
  planCheckoutPayload,
  planHostedUrl,
  planPriceLabel,
  plansNote,
  type SitePlan,
  type SitePlanMe,
} from "@/lib/world/money-desks-2";

/* ─── PlansDesk — your site plan (Free / Pro / Elite), purchasable
   from the Get Paid Room (Stack-100 #69). The creator-pricing page
   is the reference implementation: the catalog is READ from
   GET /api/creator-tiers/plans — names, prices, fee rates and
   boosts all ride the rail's own DTO (verified in code: Pro
   $12/mo, Elite $29/mo in platform-fees TIER_PLANS), never a local
   price table — and the caller's standing comes from
   GET /api/creator-tiers/me. Buying rides POST
   /api/creator-tiers/checkout { tier, returnTo: "/world" } and
   managing rides POST /api/creator-tiers/portal; both answer a
   hosted Stripe page, which opens in a NEW TAB (the sanctioned
   exit — the pricing page leaves for the same hosted pages), and
   the desk re-reads /me on focus so a landed upgrade shows. The
   plans payload's own note line renders verbatim. A plan whose
   Stripe price isn't configured server-side (priceConfigured
   false) says so on its card instead of offering a checkout that
   can't start. Members only — the board above already pitches
   guests. */

export function PlansDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const [plans, setPlans] = useState<SitePlan[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [me, setMe] = useState<SitePlanMe | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [openedNote, setOpenedNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [plansRes, meRes] = await Promise.all([
        fetch("/api/creator-tiers/plans"),
        fetch("/api/creator-tiers/me", { headers: await authHeaders() }),
      ]);
      if (!plansRes.ok) throw new Error("plans");
      const payload = (await plansRes.json()) as unknown;
      const parsed = parseSitePlans(payload);
      if (!parsed) throw new Error("plans");
      setPlans(parsed);
      setNote(plansNote(payload));
      if (meRes.ok) setMe(parseSitePlanMe(await meRes.json()));
      setLoadFailed(false);
    } catch { setLoadFailed(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* Back from a hosted tab: the webhook may land a beat after
     Stripe lets go — re-read the standing on focus. */
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const checkout = async (plan: SitePlan) => {
    if (busyTier) return;
    setBusyTier(plan.tier);
    setError(null);
    setOpenedNote(null);
    try {
      const res = await fetch("/api/creator-tiers/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(planCheckoutPayload(plan.tier)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "Checkout didn't start. Try again in a minute."));
      const url = planHostedUrl(data);
      if (!url) throw new Error("Checkout didn't return a payment page — nothing was charged.");
      window.open(url, "_blank", "noopener,noreferrer");
      setOpenedNote(`${plan.name} checkout opened in a new tab — finish there and your plan updates the moment it confirms.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network hiccup — try again.");
    } finally { setBusyTier(null); }
  };

  const openPortal = async () => {
    if (portalBusy) return;
    setPortalBusy(true);
    setError(null);
    setOpenedNote(null);
    try {
      const res = await fetch("/api/creator-tiers/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ returnTo: "/world" }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "The billing portal didn't open. Try again in a minute."));
      const url = planHostedUrl(data);
      if (!url) throw new Error("The billing portal didn't return a page.");
      window.open(url, "_blank", "noopener,noreferrer");
      setOpenedNote("Your billing portal opened in a new tab — manage or cancel there; this desk re-reads your plan when you're back.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network hiccup — try again.");
    } finally { setPortalBusy(false); }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  return (
    <NativeCard isLight={isLight} title="Your site plan">
      <div data-testid="world-plans-desk" className="space-y-3">
        {loadFailed ? (
          <p className={`text-xs ${muted}`}>
            The plan catalog wouldn&rsquo;t open — your plan is unchanged.{" "}
            <button type="button" data-testid="world-plans-retry" onClick={() => void load()} className="font-bold text-[#d4af37]">Try again</button>
          </p>
        ) : plans === null ? (
          <p className={`inline-flex items-center gap-2 text-xs ${muted}`}>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> Reading the plans…
          </p>
        ) : (
          <>
            {me && (
              <p className={`text-xs ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
                You&rsquo;re on <strong className="capitalize">{me.tier}</strong>
                {me.status !== "active" ? ` (${me.status})` : ""} — platform fee {me.feePct}% · {me.aiBoostsPerMonth} AI boosts a month
                {me.currentPeriodEnd ? ` · current period ends ${new Date(me.currentPeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-3">
              {plans.map((plan) => {
                const isMine = me?.tier === plan.tier;
                const paid = plan.priceUsdPerMonth !== null;
                return (
                  <div key={plan.tier} data-testid={`world-plan-${plan.tier}`}
                    className={`flex flex-col rounded-2xl border px-3 py-3 ${isMine ? "border-[#d4af37] bg-[#d4af37]/[0.07]" : isLight ? "border-[#7A5A12]/25 bg-white/50" : "border-white/10 bg-white/5"}`}>
                    <p className={`flex items-center gap-1.5 text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                      <Crown className="h-4 w-4 text-[#d4af37]" /> {plan.name}
                      {isMine && <span className="ml-auto rounded-full bg-[#d4af37] px-2 py-0.5 text-[10px] font-black text-black">YOUR PLAN</span>}
                    </p>
                    <p className="text-xl font-black text-[#d4af37]">{planPriceLabel(plan)}</p>
                    {plan.tagline && <p className={`text-[11px] ${muted}`}>{plan.tagline}</p>}
                    <p className={`mt-1 text-[11px] ${muted}`}>Platform fee {plan.feePct}% · {plan.aiBoostsPerMonth} AI boosts/mo</p>
                    <ul className={`mt-2 flex-1 space-y-1 text-[11px] ${isLight ? "text-[#2a1e07]" : "text-white/75"}`}>
                      {plan.features.slice(0, 5).map((f) => (
                        <li key={f} className="flex gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-[#d4af37]" /> {f}</li>
                      ))}
                    </ul>
                    {isMine ? (
                      paid ? (
                        <button type="button" data-testid="world-plan-manage" onClick={() => void openPortal()} disabled={portalBusy}
                          className={`mt-3 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${isLight ? "border-[#7A5A12]/40 text-[#2a1e07]" : "border-white/20 text-white"}`}>
                          {portalBusy ? "Opening…" : "Manage / cancel"}
                        </button>
                      ) : (
                        <p className={`mt-3 text-center text-[11px] font-bold ${muted}`}>Your starting plan</p>
                      )
                    ) : !paid ? (
                      <p className={`mt-3 text-center text-[11px] ${muted}`}>Downgrades run through Manage / cancel on your current plan.</p>
                    ) : !plan.purchasable ? (
                      <p className={`mt-3 text-center text-[11px] font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                        This plan&rsquo;s checkout isn&rsquo;t switched on yet — nothing to charge today.
                      </p>
                    ) : (
                      <button type="button" data-testid={`world-plan-buy-${plan.tier}`} onClick={() => void checkout(plan)} disabled={busyTier !== null}
                        className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50">
                        {busyTier === plan.tier ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crown className="h-3.5 w-3.5" />}
                        {busyTier === plan.tier ? "Starting…" : `Go ${plan.name} — ${planPriceLabel(plan)}`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {note && <p className={`text-[11px] ${muted}`}>{note}</p>}
            {openedNote && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{openedNote}</p>}
            {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
          </>
        )}
      </div>
    </NativeCard>
  );
}
