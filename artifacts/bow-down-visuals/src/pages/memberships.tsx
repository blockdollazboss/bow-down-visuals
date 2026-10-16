import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  Crown, Plus, Trash2, Pencil, Users, DollarSign, TrendingDown,
  Sparkles, Loader2, Check, X, AlertTriangle, BadgePercent, RotateCcw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Fan Memberships ───────────────────────────────────────────────────
   /memberships — creators launch fan clubs with paid tiers. Tier setup +
   member tracking are free. The site takes a 10% platform fee out of the
   creator's cut. Fans join through secure checkout (test mode) — a
   membership activates only when the payment verifies on return. Tiers
   can offer a 7-day free trial and a creator-set annual discount, and
   memberships can be gifted. The AI perk suggester costs 1 credit per
   suggestion (charge-before-generate). */

interface Tier {
  id: string;
  creatorUserId?: string;
  name: string;
  priceDollars: number;
  priceCents: number;
  description: string;
  perks: string[];
  isActive: boolean;
  trialEnabled: boolean;
  annualDiscountPct: number;
  annualPriceCents: number;
  annualPriceDollars: number;
  createdAt: string;
}

interface TierBreakdown {
  tierId: string;
  name: string;
  activeMembers: number;
  mrrCents: number;
}

interface Dashboard {
  activeMembers: number;
  pastDueMembers: number;
  canceledMembers: number;
  mrrCents: number;
  mrrDollars: number;
  netMrrCents: number;
  churnPct: number;
  byTier: TierBreakdown[];
  paymentsLive: boolean;
}

interface Member {
  id: string;
  tierId: string;
  tierName: string;
  fanLabel: string;
  fanUserId: string | null;
  status: "trialing" | "active" | "past_due" | "canceled" | "expired";
  priceDollars: number;
  billingPeriod: string;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  isGift: boolean;
  joinedAt: string;
}

interface MyMembership {
  id: string;
  tierName: string | null;
  creatorUserId: string;
  status: string;
  priceDollars: number;
  billingPeriod: string;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  isGift: boolean;
}

interface MyGift {
  id: string;
  tierId: string;
  recipientUserId: string;
  purchaserUserId: string;
  amountDollars: number;
  billingPeriod: string;
  status: string;
  createdAt: string;
}

interface SuggestedTier {
  name: string;
  priceDollars: number;
  perks: string[];
}

const GOLD_BTN =
  "inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-6 py-3 text-base font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50";
const GOLD_BTN_GATED = (isLight: boolean) =>
  "inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-base font-black transition active:scale-95 disabled:cursor-not-allowed " +
  (isLight ? "border border-[#C9A84C]/60 bg-[#EFE3C2] text-[#7A5A12]" : "border border-primary/30 bg-primary/20 text-primary/70");
const CARD =
  "rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-6";
const INPUT =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-primary/60 focus:outline-none";

async function api(path: string, token: string | null, init?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, data };
}

/* ─── Fan join view (deep link: /memberships?creator=<creatorUserId>) ───
   Fans pick monthly or annual (the annual price shown is the exact
   amount checkout charges — both come from the same server math), start
   a free trial when the tier offers one, or gift the tier to another
   fan by user id. Payment completes at secure checkout; the membership
   activates when the return visit verifies it. */
function FanClubJoin({
  creatorUserId,
  getAccessToken,
  signedIn,
}: {
  creatorUserId: string;
  getAccessToken: () => Promise<string | null>;
  signedIn: boolean;
}) {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  const [giftFor, setGiftFor] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/memberships/public/${creatorUserId}`);
        const data = (await res.json().catch(() => ({}))) as { tiers?: Tier[] };
        if (!alive) return;
        if (!res.ok || !Array.isArray(data.tiers)) { setLoadErr(true); return; }
        setTiers(data.tiers);
      } catch {
        if (alive) setLoadErr(true);
      }
    })();
    return () => { alive = false; };
  }, [creatorUserId]);

  const fmt$ = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 === 0 ? 0 : 2 });

  async function join(tier: Tier, mode: "checkout" | "trial") {
    if (!signedIn) { window.location.href = "/login"; return; }
    setBusy(tier.id + mode);
    setMsg(null);
    try {
      const token = await getAccessToken();
      const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      if (mode === "trial") {
        const res = await fetch("/api/memberships/join-trial", {
          method: "POST", headers, body: JSON.stringify({ tierId: tier.id }),
        });
        const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        if (!res.ok) throw new Error(data.message ?? data.error ?? "Couldn't start the trial.");
        setMsg("Your 7-day free trial is on — no charge today. Join with a paid plan before it ends to keep your seat.");
        return;
      }
      const recipient = giftFor.trim();
      const res = await fetch("/api/memberships/checkout", {
        method: "POST",
        headers,
        body: JSON.stringify({
          tierId: tier.id,
          billingPeriod: period,
          ...(recipient ? { recipientUserId: recipient } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; free?: boolean; error?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Couldn't start checkout.");
      if (data.free) {
        setMsg(recipient ? "Gift sent — they're a member now." : "You're in — your membership is active.");
        return;
      }
      if (data.url) { window.location.href = data.url; return; }
      throw new Error("Couldn't start checkout.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (loadErr) {
    return (
      <div className="mb-10 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        Couldn't load this fan club. Check the link and try again.
      </div>
    );
  }
  if (tiers.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-2xl font-black mb-4 flex items-center gap-2">
        <Crown className="h-6 w-6 text-primary" /> Join this fan club
        <span className="text-[10px] font-bold uppercase tracking-wider rounded-full border border-white/20 px-2 py-0.5 text-white/50">Test mode</span>
      </h2>
      <div className="mb-4 flex items-center gap-2">
        {(["monthly", "annual"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-xl border px-4 py-2 text-sm font-bold capitalize transition ${
              period === p ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-white/50 hover:border-white/25"
            }`}
          >
            {p}
          </button>
        ))}
        <input
          className="ml-auto w-64 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-primary/60 focus:outline-none"
          placeholder="Gift it: recipient's user ID (optional)"
          value={giftFor}
          onChange={(e) => setGiftFor(e.target.value)}
        />
      </div>
      {msg && (
        <div className="mb-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">{msg}</div>
      )}
      <div className="grid md:grid-cols-3 gap-4">
        {tiers.map((tier) => {
          const price = period === "annual" ? tier.annualPriceDollars : tier.priceDollars;
          return (
            <div key={tier.id} className="rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-5">
              <div className="font-black text-lg">{tier.name}</div>
              <div className="text-primary font-bold">
                {tier.priceCents === 0 ? "Free" : `${fmt$(price)}`}
                {tier.priceCents > 0 && <span className="text-white/40 text-sm font-normal">/{period === "annual" ? "yr" : "mo"}</span>}
              </div>
              {period === "annual" && tier.annualDiscountPct > 0 && (
                <div className="text-xs text-emerald-300/80">Save {tier.annualDiscountPct}% vs monthly</div>
              )}
              {tier.description && <p className="text-sm text-white/50 mt-2">{tier.description}</p>}
              <ul className="mt-3 space-y-1.5">
                {tier.perks.map((p, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />{p}
                  </li>
                ))}
              </ul>
              <div className="mt-4 space-y-2">
                <button
                  onClick={() => void join(tier, "checkout")}
                  disabled={busy === tier.id + "checkout"}
                  className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-black hover:brightness-110 disabled:opacity-50"
                >
                  {busy === tier.id + "checkout" ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : giftFor.trim() ? "Gift this tier" : "Join now"}
                </button>
                {tier.trialEnabled && !giftFor.trim() && (
                  <button
                    onClick={() => void join(tier, "trial")}
                    disabled={busy === tier.id + "trial"}
                    className="w-full rounded-xl border border-primary/40 px-4 py-2.5 text-sm font-bold text-primary hover:bg-primary/10 disabled:opacity-50"
                  >
                    Start 7-day free trial
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function Memberships() {
  usePageTitle("Memberships", "Launch your fan club with paid membership tiers, member perks, and tracking.");
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /* A failed load is NOT a brand-new account — it gets its own error
     state with a retry, and every empty/default branch fed by load()
     is gated on !loadError. */
  const [loadError, setLoadError] = useState(false);

  /* Tier form state */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("5");
  const [description, setDescription] = useState("");
  const [perkInput, setPerkInput] = useState("");
  const [perks, setPerks] = useState<string[]>([]);
  const [trialEnabled, setTrialEnabled] = useState(false);
  const [annualDiscount, setAnnualDiscount] = useState("0");

  /* Fan-side state: my memberships + gifts, checkout-return message. */
  const [mine, setMine] = useState<{ memberships: MyMembership[]; giftsSent: MyGift[]; giftsReceived: MyGift[] } | null>(null);
  const [fanMsg, setFanMsg] = useState<string | null>(null);
  const creatorParam = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("creator")
    : null;
  const [saving, setSaving] = useState(false);

  /* Member form state */
  const [memberTier, setMemberTier] = useState("");
  const [fanLabel, setFanLabel] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  /* AI suggester state */
  const [niche, setNiche] = useState("");
  const [audienceSize, setAudienceSize] = useState<"starting" | "growing" | "established">("growing");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedTier[]>([]);
  const [outOfCredits, setOutOfCredits] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    setLoadError(false);
    try {
      const token = await getAccessToken();
      const [{ res: tRes, data: t }, { res: dRes, data: d }, { res: mRes, data: m }] = await Promise.all([
        api("/memberships/tiers", token),
        api("/memberships/dashboard", token),
        api("/memberships/members", token),
      ]);
      /* api() never throws on HTTP status, so check res.ok and the
         expected shapes explicitly — any failure is a load error, not
         an empty fan club. Nothing is applied on failure. */
      if (
        !tRes.ok || !dRes.ok || !mRes.ok ||
        !Array.isArray(t.tiers) ||
        d.activeMembers === undefined ||
        !Array.isArray(m.members)
      ) {
        setLoadError(true);
        return;
      }
      setTiers(t.tiers as Tier[]);
      setDashboard(d as unknown as Dashboard);
      setMembers(m.members as Member[]);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user) void load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* Fan side: load my memberships/gifts; if we just returned from a
     membership checkout, verify the payment first — the membership is
     only real once the server confirms it. */
  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      const token = await getAccessToken();
      const sid = new URLSearchParams(window.location.search).get("session_id");
      if (sid) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search.replace(/[?&]session_id=[^&]+/, "").replace(/^&/, "?"));
        try {
          const { res, data } = await api("/memberships/verify", token, {
            method: "POST",
            body: JSON.stringify({ sessionId: sid }),
          });
          if (alive) {
            setFanMsg(
              res.ok && data.success
                ? "Payment confirmed — your membership is active."
                : String(data.error ?? "We couldn't confirm that payment. If you were charged, contact support."),
            );
          }
        } catch {
          if (alive) setFanMsg("We couldn't confirm that payment. If you were charged, contact support.");
        }
      }
      try {
        const { res, data } = await api("/memberships/mine", token);
        if (alive && res.ok && Array.isArray(data.memberships)) {
          setMine(data as unknown as { memberships: MyMembership[]; giftsSent: MyGift[]; giftsReceived: MyGift[] });
        }
      } catch { /* fan section is additive — creator load errors rule the page */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setPrice("5");
    setDescription("");
    setPerks([]);
    setPerkInput("");
    setTrialEnabled(false);
    setAnnualDiscount("0");
  }

  function startEdit(t: Tier) {
    setEditingId(t.id);
    setName(t.name);
    setPrice(String(t.priceDollars));
    setDescription(t.description);
    setPerks(t.perks);
    setPerkInput("");
    setTrialEnabled(!!t.trialEnabled);
    setAnnualDiscount(String(t.annualDiscountPct ?? 0));
  }

  async function saveTier() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const token = await getAccessToken();
      const body = {
        name: name.trim(),
        priceDollars: Math.max(0, Math.min(999.99, parseFloat(price) || 0)),
        description: description.trim(),
        perks,
        trialEnabled,
        annualDiscountPct: Math.max(0, Math.min(90, Math.round(parseFloat(annualDiscount) || 0))),
      };
      const { res } = editingId
        ? await api(`/memberships/tiers/${editingId}`, token, { method: "PUT", body: JSON.stringify(body) })
        : await api("/memberships/tiers", token, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      resetForm();
      await load();
    } catch {
      setError(t("memberships.errorSaveTier"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteTier(id: string) {
    if (!confirm(t("memberships.confirmDeleteTier"))) return;
    try {
      const token = await getAccessToken();
      await api(`/memberships/tiers/${id}`, token, { method: "DELETE" });
      await load();
    } catch {
      setError(t("memberships.errorDeleteTier"));
    }
  }

  async function addMember() {
    if (!memberTier || !fanLabel.trim()) return;
    setAddingMember(true);
    try {
      const token = await getAccessToken();
      const { res, data } = await api("/memberships/members", token, {
        method: "POST",
        body: JSON.stringify({ tierId: memberTier, fanLabel: fanLabel.trim() }),
      });
      if (res.status === 409) {
        setError(String(data.error ?? t("memberships.errorDuplicateMember")));
        return;
      }
      if (!res.ok) throw new Error();
      setFanLabel("");
      await load();
    } catch {
      setError(t("memberships.errorAddMember"));
    } finally {
      setAddingMember(false);
    }
  }

  async function setMemberStatus(id: string, status: Member["status"]) {
    try {
      const token = await getAccessToken();
      await api(`/memberships/members/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch {
      setError(t("memberships.errorUpdateMember"));
    }
  }

  async function removeMember(id: string) {
    if (!confirm(t("memberships.confirmRemoveMember"))) return;
    try {
      const token = await getAccessToken();
      await api(`/memberships/members/${id}`, token, { method: "DELETE" });
      await load();
    } catch {
      setError(t("memberships.errorRemoveMember"));
    }
  }

  async function suggestTiers() {
    if (!niche.trim() || suggesting) return;
    setSuggesting(true);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const { res, data } = await api("/memberships/ai-perks", token, {
        method: "POST",
        body: JSON.stringify({ niche: niche.trim(), audienceSize, tierCount: 3 }),
      });
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.tiers)) throw new Error();
      setSuggestions(data.tiers as SuggestedTier[]);
      refreshProfile();
    } catch {
      setError(t("memberships.errorSuggester"));
    } finally {
      setSuggesting(false);
    }
  }

  function applySuggestion(s: SuggestedTier) {
    setEditingId(null);
    setName(s.name);
    setPrice(String(s.priceDollars));
    setDescription("");
    setPerks(s.perks);
    setPerkInput("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const fmt$ = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 === 0 ? 0 : 2 });

  return (
    <div className={`min-h-screen ${isLight ? "text-[#2A1E07]" : "bg-black text-white"}`}>
      <main className="max-w-6xl mx-auto px-5 md:px-8 py-10">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary mb-4">
            <Crown className="h-3.5 w-3.5" /> {t("memberships.badge")}
          </div>
          <h1 className="text-4xl md:text-5xl font-black">
            {t("memberships.titleStart")} <span className="text-primary">{t("memberships.titleAccent")}</span>
          </h1>
          <p className="mt-3 text-white/60 max-w-2xl mx-auto">
            {t("memberships.subtitle")}
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t("memberships.paymentsNotice")}
          </div>
        </div>

        {creatorParam && creatorParam !== user?.id && (
          <FanClubJoin creatorUserId={creatorParam} getAccessToken={getAccessToken} signedIn={!!user} />
        )}

        {fanMsg && (
          <div className="mb-8 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary flex items-center justify-between">
            {fanMsg}
            <button onClick={() => setFanMsg(null)} aria-label={t("memberships.dismiss")}><X className="h-4 w-4" /></button>
          </div>
        )}

        {!user ? (
          <div className={CARD + " text-center"}>
            <p className="text-white/70 mb-4">{t("memberships.signInPrompt")}</p>
            <Link href="/login" className={GOLD_BTN}>{t("memberships.signIn")}</Link>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-10">
            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center justify-between">
                {error}
                <button onClick={() => setError(null)} aria-label={t("memberships.dismiss")}><X className="h-4 w-4" /></button>
              </div>
            )}

            {loadError && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center gap-3">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {t("memberships.errorLoad")}
                <button
                  onClick={() => void load()}
                  className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-300/30 px-3 py-1.5 text-xs font-bold text-red-200 hover:bg-red-500/10"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> {t("memberships.retry")}
                </button>
              </div>
            )}

            {/* ── Your memberships (fan side) ── */}
            {mine && (mine.memberships.length > 0 || mine.giftsSent.length > 0 || mine.giftsReceived.length > 0) && (
              <section>
                <h2 className="text-2xl font-black mb-4 flex items-center gap-2">
                  <Crown className="h-6 w-6 text-primary" /> Your memberships
                </h2>
                <div className={CARD + " space-y-3"}>
                  {mine.memberships.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-3 py-1">
                      <div>
                        <div className="font-bold text-sm">{m.tierName ?? "Membership"}{m.isGift && <span className="ml-2 text-xs text-primary">gifted to you</span>}</div>
                        <div className="text-xs text-white/40">
                          {fmt$(m.priceDollars)} · {m.billingPeriod}
                          {m.status === "trialing" && m.trialEndsAt && <> · trial ends {new Date(m.trialEndsAt).toLocaleDateString()}</>}
                          {m.status !== "trialing" && m.currentPeriodEnd && <> · {m.status === "expired" ? "ended" : "renews"} {new Date(m.currentPeriodEnd).toLocaleDateString()}</>}
                        </div>
                      </div>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full capitalize ${
                        m.status === "active" ? "bg-emerald-500/15 text-emerald-300"
                        : m.status === "trialing" ? "bg-primary/15 text-primary"
                        : "bg-white/10 text-white/50"
                      }`}>{m.status.replace("_", " ")}</span>
                    </div>
                  ))}
                  {mine.giftsSent.map((g) => (
                    <div key={g.id} className="flex items-center justify-between gap-3 py-1 border-t border-white/5 pt-3">
                      <div className="text-sm text-white/60">Gift sent · {fmt$(g.amountDollars)} · {g.billingPeriod}</div>
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/10 text-white/60 capitalize">{g.status.replace("_", " ")}</span>
                    </div>
                  ))}
                  {mine.giftsReceived.map((g) => (
                    <div key={g.id} className="flex items-center justify-between gap-3 py-1 border-t border-white/5 pt-3">
                      <div className="text-sm text-white/60">Gift received · {fmt$(g.amountDollars)} · {g.billingPeriod}</div>
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/10 text-white/60 capitalize">{g.status.replace("_", " ")}</span>
                    </div>
                  ))}
                </div>
                {user && (
                  <p className="mt-3 text-xs text-white/40">
                    Fans join your club at <span className="text-primary/80">/memberships?creator={user.id}</span> — share that link anywhere.
                  </p>
                )}
              </section>
            )}

            {/* ── Dashboard ── */}
            {dashboard && (
              <section>
                <h2 className="text-2xl font-black mb-4 flex items-center gap-2">
                  <Users className="h-6 w-6 text-primary" /> {t("memberships.dashboardTitle")}
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className={CARD}>
                    <div className="text-xs uppercase tracking-widest text-white/40 mb-1">{t("memberships.activeMembers")}</div>
                    <div className="text-3xl font-black text-primary">{dashboard.activeMembers}</div>
                  </div>
                  <div className={CARD}>
                    <div className="text-xs uppercase tracking-widest text-white/40 mb-1">{t("memberships.monthlyRevenue")}</div>
                    <div className="text-3xl font-black">{fmt$(dashboard.mrrDollars)}</div>
                    <div className="text-xs text-white/40 mt-1 flex items-center gap-1">
                      <BadgePercent className="h-3 w-3" />
                      {t("memberships.afterFee", { amount: fmt$(dashboard.netMrrCents / 100) })}
                    </div>
                  </div>
                  <div className={CARD}>
                    <div className="text-xs uppercase tracking-widest text-white/40 mb-1">{t("memberships.churn")}</div>
                    <div className="text-3xl font-black flex items-center gap-2">
                      <TrendingDown className="h-6 w-6 text-amber-400" />{dashboard.churnPct}%
                    </div>
                  </div>
                  <div className={CARD}>
                    <div className="text-xs uppercase tracking-widest text-white/40 mb-1">{t("memberships.pastDue")}</div>
                    <div className="text-3xl font-black text-amber-400">{dashboard.pastDueMembers}</div>
                  </div>
                </div>
                {dashboard.byTier.length > 0 && (
                  <div className="mt-4 grid md:grid-cols-3 gap-4">
                    {dashboard.byTier.map((b) => (
                      <div key={b.tierId} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                        <div className="font-bold">{b.name}</div>
                        <div className="text-sm text-white/50 mt-1">
                          {t("memberships.tierStats", { count: b.activeMembers, amount: fmt$(b.mrrCents / 100) })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ── Tier builder ── */}
            <section>
              <h2 className="text-2xl font-black mb-4 flex items-center gap-2">
                <Crown className="h-6 w-6 text-primary" /> {editingId ? t("memberships.editTier") : t("memberships.buildTier")}
              </h2>
              <div className={CARD + " space-y-4"}>
                <div className="grid md:grid-cols-2 gap-4">
                  <input className={INPUT} placeholder={t("memberships.tierNamePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                    <input className={INPUT + " pl-9"} placeholder={t("memberships.pricePlaceholder")} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
                  </div>
                </div>
                <textarea className={INPUT} placeholder={t("memberships.descriptionPlaceholder")} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} />
                <div className="grid md:grid-cols-2 gap-4">
                  <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/70 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={trialEnabled}
                      onChange={(e) => setTrialEnabled(e.target.checked)}
                      className="h-4 w-4 accent-[#C9A84C]"
                    />
                    Offer a 7-day free trial
                    <span className="text-xs text-white/40">No charge during the trial</span>
                  </label>
                  <div className="relative">
                    <BadgePercent className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                    <input
                      className={INPUT + " pl-9"}
                      placeholder="Annual discount % (fans pay yearly)"
                      value={annualDiscount}
                      onChange={(e) => setAnnualDiscount(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex gap-2">
                    <input
                      className={INPUT}
                      placeholder={t("memberships.perkPlaceholder")}
                      value={perkInput}
                      onChange={(e) => setPerkInput(e.target.value)}
                      maxLength={140}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && perkInput.trim() && perks.length < 20) {
                          e.preventDefault();
                          setPerks([...perks, perkInput.trim()]);
                          setPerkInput("");
                        }
                      }}
                    />
                    <button
                      className="shrink-0 rounded-xl border border-primary/40 px-4 text-sm font-bold text-primary hover:bg-primary/10"
                      onClick={() => {
                        if (perkInput.trim() && perks.length < 20) {
                          setPerks([...perks, perkInput.trim()]);
                          setPerkInput("");
                        }
                      }}
                    >
                      Add
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {perks.map((p, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs">
                        <Check className="h-3 w-3 text-primary" />{p}
                        <button onClick={() => setPerks(perks.filter((_, j) => j !== i))} aria-label={t("memberships.removePerk")}>
                          <X className="h-3 w-3 text-white/40 hover:text-white" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3">
                  <button className={!name.trim() && !saving ? GOLD_BTN_GATED(isLight) : GOLD_BTN} disabled={saving || !name.trim()} onClick={saveTier}>
                    {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                    {editingId ? t("memberships.saveTier") : t("memberships.createTier")}
                  </button>
                  {editingId && (
                    <button className="rounded-2xl border border-white/15 px-6 py-3 text-sm font-bold text-white/70 hover:bg-white/5" onClick={resetForm}>
                      {t("memberships.cancel")}
                    </button>
                  )}
                </div>
              </div>

              {tiers.length > 0 && (
                <div className="mt-4 grid md:grid-cols-3 gap-4">
                  {tiers.map((tier) => (
                    <div key={tier.id} className={`${isLight ? "rounded-2xl border border-primary/20 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-5" : "rounded-2xl border border-primary/20 bg-gradient-to-b from-[#171208] to-[#0d0a04] p-5"}`}>
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-black text-lg">{tier.name}</div>
                          <div className="text-primary font-bold">{fmt$(tier.priceDollars)}<span className="text-white/40 text-sm font-normal">{t("memberships.perMonth")}</span></div>
                          {tier.annualDiscountPct > 0 && (
                            <div className="text-xs text-white/50">{fmt$(tier.annualPriceDollars)}/yr — save {tier.annualDiscountPct}%</div>
                          )}
                          {tier.trialEnabled && (
                            <div className="text-xs text-emerald-300/80">7-day free trial</div>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => startEdit(tier)} aria-label={t("memberships.editTierAria")} className="p-1.5 rounded-lg hover:bg-white/10">
                            <Pencil className="h-4 w-4 text-white/50" />
                          </button>
                          <button onClick={() => deleteTier(tier.id)} aria-label={t("memberships.deleteTierAria")} className="p-1.5 rounded-lg hover:bg-white/10">
                            <Trash2 className="h-4 w-4 text-red-400/70" />
                          </button>
                        </div>
                      </div>
                      {tier.description && <p className="text-sm text-white/50 mt-2">{tier.description}</p>}
                      <ul className="mt-3 space-y-1.5">
                        {tier.perks.map((p, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                            <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />{p}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── AI perk suggester ── */}
            <section>
              <h2 className="text-2xl font-black mb-4 flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-primary" /> {t("memberships.aiSuggesterTitle")}
                <span className="text-xs font-bold rounded-full bg-primary/15 border border-primary/30 text-primary px-2.5 py-1">{t("memberships.aiCost")}</span>
              </h2>
              <div className={CARD + " space-y-4"}>
                <p className="text-sm text-white/60">
                  {t("memberships.aiDescription")}
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  <input className={INPUT} placeholder={t("memberships.nichePlaceholder")} value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={80} />
                  <div className="flex gap-2">
                    {(["starting", "growing", "established"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setAudienceSize(s)}
                        className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold capitalize transition ${
                          audienceSize === s
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-white/10 text-white/50 hover:border-white/25"
                        }`}
                      >
                        {t("memberships.audience" + s.charAt(0).toUpperCase() + s.slice(1))}
                      </button>
                    ))}
                  </div>
                </div>
                <button className={!niche.trim() && !suggesting ? GOLD_BTN_GATED(isLight) : GOLD_BTN} disabled={suggesting || !niche.trim()} onClick={suggestTiers}>
                  {suggesting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                  {t("memberships.suggestButton")}
                </button>
                {outOfCredits && <OutOfCredits />}
                {suggestions.length > 0 && (
                  <div className="grid md:grid-cols-3 gap-4 pt-2">
                    {suggestions.map((s, i) => (
                      <div key={i} className={`rounded-2xl border border-primary/20 p-5 ${isLight ? "bg-[#F7ECD2]/70" : "bg-black/40"}`}>
                        <div className="font-black">{s.name}</div>
                        <div className="text-primary font-bold">{fmt$(s.priceDollars)}<span className="text-white/40 text-sm font-normal">/mo</span></div>
                        <ul className="mt-2 space-y-1">
                          {s.perks.map((p, j) => (
                            <li key={j} className="text-xs text-white/60 flex gap-1.5">
                              <Check className="h-3.5 w-3.5 text-primary shrink-0" />{p}
                            </li>
                          ))}
                        </ul>
                        <button
                          onClick={() => applySuggestion(s)}
                          className="mt-3 w-full rounded-xl border border-primary/40 py-2 text-sm font-bold text-primary hover:bg-primary/10"
                        >
                          {t("memberships.useTier")}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* ── Members ── */}
            <section>
              <h2 className="text-2xl font-black mb-4 flex items-center gap-2">
                <Users className="h-6 w-6 text-primary" /> {t("memberships.membersTitle")}
              </h2>
              <div className={CARD + " space-y-4"}>
                <p className="text-xs text-white/40">
                  {t("memberships.membersNote")}
                </p>
                <div className="flex flex-col md:flex-row gap-3">
                  <select
                    className={INPUT + " md:w-56"}
                    value={memberTier}
                    onChange={(e) => setMemberTier(e.target.value)}
                  >
                    <option value="">{t("memberships.pickTier")}</option>
                    {tiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>{t("memberships.tierOption", { name: tier.name, price: fmt$(tier.priceDollars) })}</option>
                    ))}
                  </select>
                  <input
                    className={INPUT}
                    placeholder={t("memberships.fanPlaceholder")}
                    value={fanLabel}
                    onChange={(e) => setFanLabel(e.target.value)}
                    maxLength={120}
                  />
                  <button
                    className="shrink-0 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black hover:brightness-110 disabled:opacity-50"
                    disabled={addingMember || !memberTier || !fanLabel.trim()}
                    onClick={addMember}
                  >
                    {addingMember ? <Loader2 className="h-4 w-4 animate-spin" /> : t("memberships.addMember")}
                  </button>
                </div>
                {members.length > 0 ? (
                  <div className="divide-y divide-white/5">
                    {members.map((m) => (
                      <div key={m.id} className="py-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-sm">{m.fanLabel}</div>
                          <div className="text-xs text-white/40">
                            {t("memberships.memberMeta", { tier: m.tierName, price: fmt$(m.priceDollars), date: new Date(m.joinedAt).toLocaleDateString() })}
                            {m.isGift && <span className="ml-1 text-primary/80">· gifted</span>}
                            {m.status === "trialing" && m.trialEndsAt && (
                              <span className="ml-1 text-emerald-300/80">· trial ends {new Date(m.trialEndsAt).toLocaleDateString()}</span>
                            )}
                            {(m.status === "active" || m.status === "expired") && m.currentPeriodEnd && (
                              <span className="ml-1">· {m.status === "expired" ? "ended" : "renews"} {new Date(m.currentPeriodEnd).toLocaleDateString()}</span>
                            )}
                            {m.billingPeriod === "annual" && <span className="ml-1">· annual</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            className="rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-xs text-white"
                            value={m.status}
                            onChange={(e) => setMemberStatus(m.id, e.target.value as Member["status"])}
                          >
                            <option value="active">{t("memberships.statusActive")}</option>
                            <option value="trialing">Trialing</option>
                            <option value="past_due">{t("memberships.statusPastDue")}</option>
                            <option value="canceled">{t("memberships.statusCanceled")}</option>
                            <option value="expired">Expired</option>
                          </select>
                          <button onClick={() => removeMember(m.id)} aria-label={t("memberships.removeMemberAria")} className="p-1.5 rounded-lg hover:bg-white/10">
                            <Trash2 className="h-4 w-4 text-red-400/70" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !loadError ? (
                  <p className="text-sm text-white/40">{t("memberships.noMembers")}</p>
                ) : null}
              </div>
            </section>
          </div>
        )}
      </main>

    </div>
  );
}
