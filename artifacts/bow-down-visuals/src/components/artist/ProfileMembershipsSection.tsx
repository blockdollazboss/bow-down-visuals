import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Gem, AlertTriangle, RotateCcw, Check } from "lucide-react";
import {
  fetchPublicMemberships,
  membershipsViewState,
  activeTiers,
  membershipPriceLabel,
  membershipAnnualLabel,
  type PublicMembershipsDto,
  type MembershipTierDto,
  type MembershipsLoadStatus,
} from "@/lib/profile-website";
import { fetchMyProfile } from "@/lib/artist-profiles";
import { useAuth } from "@/contexts/AuthContext";
import { apiJson } from "@/lib/social-api";

/* ─── Memberships — public profile section ────────────────────────────────
   The creator's fan membership tiers, sold right on the profile under
   the Store (GET /memberships/public/:creatorUserId). Join runs the
   real checkout: a free tier activates on the spot; a paid tier hands
   off to the checkout page for exactly the price shown. Guests are
   asked to sign in first. No tiers hides the block for visitors; the
   owner gets the set-up invitation; a failed load is an honest error. */

type BillingPeriod = "monthly" | "annual";

export default function ProfileMembershipsSection({
  creatorUserId,
  title = "Memberships",
}: {
  creatorUserId: string;
  title?: string;
}) {
  const { user, getAccessToken } = useAuth();
  const [data, setData] = useState<PublicMembershipsDto | null>(null);
  const [status, setStatus] = useState<MembershipsLoadStatus>("loading");
  const [isOwner, setIsOwner] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [joined, setJoined] = useState<Set<string>>(new Set());
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const d = await fetchPublicMemberships(creatorUserId);
        if (!cancelled) {
          setData(d);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [creatorUserId, retryNonce]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mine = await fetchMyProfile();
        if (!cancelled) setIsOwner(!!mine && mine.user_id === creatorUserId);
      } catch {
        if (!cancelled) setIsOwner(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [creatorUserId]);

  const tiers = data ? activeTiers(data.tiers) : [];
  const view = membershipsViewState({ status, tiers: data?.tiers ?? [], isOwner });
  if (view === "loading" || view === "hidden") return null;

  const anyAnnual = tiers.some((t) => membershipAnnualLabel(t) !== null);

  const join = async (tier: MembershipTierDto) => {
    setBusyTier(tier.id);
    setJoinError(null);
    try {
      const usePeriod: BillingPeriod =
        period === "annual" && membershipAnnualLabel(tier) !== null ? "annual" : "monthly";
      const res = await apiJson<{ free?: boolean; url?: string }>(
        getAccessToken,
        "/api/memberships/checkout",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tierId: tier.id, billingPeriod: usePeriod }),
        },
      );
      if (res.free) {
        setJoined((prev) => new Set(prev).add(tier.id));
      } else if (res.url) {
        window.location.assign(res.url);
      } else {
        setJoinError("Checkout didn't start — try again in a moment.");
      }
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Couldn't start checkout. Try again.");
    } finally {
      setBusyTier(null);
    }
  };

  return (
    <section className="ap-section" style={{ padding: "var(--ap-pad)" }} data-testid="profile-memberships">
      <div className="mb-3 flex items-center gap-2">
        <Gem className="h-5 w-5" style={{ color: "var(--ap-primary)" }} />
        <h2
          className="text-xl font-bold tracking-wide sm:text-2xl"
          style={{ fontFamily: "var(--ap-heading-font)", color: "var(--ap-text)" }}
        >
          {title}
        </h2>
        {view === "tiers" && anyAnnual && (
          <div
            className="ml-auto flex overflow-hidden rounded-full text-[11px] font-bold"
            style={{ border: "1px solid var(--ap-border)" }}
          >
            {(["monthly", "annual"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className="px-3 py-1 capitalize transition"
                style={
                  period === p
                    ? { backgroundColor: "var(--ap-primary)", color: "#000" }
                    : { color: "var(--ap-muted)" }
                }
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === "error" && (
        <div
          className="flex flex-col items-center gap-2 rounded-xl px-4 py-6 text-center"
          style={{ border: "1px solid var(--ap-border)", backgroundColor: "var(--ap-card)" }}
        >
          <AlertTriangle className="h-6 w-6" style={{ color: "var(--ap-primary)" }} />
          <p className="text-sm" style={{ color: "var(--ap-text)" }}>
            Memberships couldn't load right now.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-1 inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold text-black transition hover:scale-105"
            style={{ backgroundColor: "var(--ap-primary)" }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {view === "owner-empty" && (
        <div
          className="flex flex-col items-center gap-2 rounded-xl px-4 py-6 text-center"
          style={{ border: "1px dashed var(--ap-primary)", backgroundColor: "var(--ap-card)" }}
        >
          <Gem className="h-6 w-6" style={{ color: "var(--ap-primary)" }} />
          <p className="text-sm font-semibold" style={{ color: "var(--ap-text)" }}>
            No memberships yet
          </p>
          <p className="max-w-sm text-xs" style={{ color: "var(--ap-muted)" }}>
            Give your biggest fans a home — set a monthly tier and it sells right here on your page.
          </p>
          <Link
            href="/memberships"
            className="mt-1 inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold text-black transition hover:scale-105"
            style={{ backgroundColor: "var(--ap-primary)" }}
          >
            Set up memberships
          </Link>
        </div>
      )}

      {view === "tiers" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiers.map((tier) => {
              const annual = membershipAnnualLabel(tier);
              const isJoined = joined.has(tier.id);
              return (
                <div
                  key={tier.id}
                  className="flex flex-col rounded-xl px-5 py-5"
                  style={{ border: "1px solid var(--ap-border)", backgroundColor: "var(--ap-card)" }}
                  data-testid="membership-tier"
                >
                  <div
                    className="text-base font-bold"
                    style={{ color: "var(--ap-text)", fontFamily: "var(--ap-heading-font)" }}
                  >
                    {tier.name}
                  </div>
                  <div className="mt-1 text-2xl font-black" style={{ color: "var(--ap-primary)" }}>
                    {period === "annual" && annual
                      ? `$${tier.annualPriceDollars}`
                      : tier.priceCents > 0
                        ? `$${tier.priceDollars}`
                        : "Free"}
                    {tier.priceCents > 0 && (
                      <span className="ml-1 text-xs font-semibold" style={{ color: "var(--ap-muted)" }}>
                        / {period === "annual" && annual ? "year" : "month"}
                      </span>
                    )}
                  </div>
                  {annual && period === "monthly" && (
                    <div className="mt-0.5 text-[11px] font-semibold" style={{ color: "var(--ap-muted)" }}>
                      {annual}
                    </div>
                  )}
                  {period === "annual" && annual && (
                    <div className="mt-0.5 text-[11px] font-semibold" style={{ color: "var(--ap-muted)" }}>
                      Save {tier.annualDiscountPct}% vs monthly
                    </div>
                  )}
                  {tier.trialEnabled && (
                    <div className="mt-0.5 text-[11px] font-semibold" style={{ color: "var(--ap-muted)" }}>
                      Free trial available
                    </div>
                  )}
                  {tier.description && (
                    <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--ap-muted)" }}>
                      {tier.description}
                    </p>
                  )}
                  {tier.perks.length > 0 && (
                    <ul className="mt-3 flex-1 space-y-1.5">
                      {tier.perks.map((perk, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs" style={{ color: "var(--ap-text)" }}>
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--ap-primary)" }} />
                          {perk}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-4">
                    {isOwner ? (
                      <p className="text-center text-[11px] font-semibold" style={{ color: "var(--ap-muted)" }}>
                        Your tier — fans join right here
                      </p>
                    ) : isJoined ? (
                      <p
                        className="rounded-full px-4 py-2 text-center text-xs font-bold"
                        style={{ border: "1px solid var(--ap-primary)", color: "var(--ap-primary)" }}
                      >
                        You're in — welcome to {tier.name}
                      </p>
                    ) : !user ? (
                      <Link
                        href="/login"
                        className="block rounded-full px-4 py-2 text-center text-xs font-bold text-black transition hover:scale-[1.02]"
                        style={{ backgroundColor: "var(--ap-primary)" }}
                      >
                        Sign in to join
                      </Link>
                    ) : (
                      <button
                        type="button"
                        disabled={busyTier === tier.id}
                        onClick={() => void join(tier)}
                        className="w-full rounded-full px-4 py-2 text-xs font-bold text-black transition hover:scale-[1.02] disabled:opacity-50"
                        style={{ backgroundColor: "var(--ap-primary)" }}
                      >
                        {busyTier === tier.id ? "Starting checkout…" : `Join — ${membershipPriceLabel(tier)}`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {joinError && (
            <p className="mt-3 text-center text-xs font-semibold text-red-400">{joinError}</p>
          )}
          {data?.testMode && (
            <p className="mt-3 text-center text-[11px]" style={{ color: "var(--ap-muted)" }}>
              Payments are in test mode — no real charge.
            </p>
          )}
        </>
      )}
    </section>
  );
}
