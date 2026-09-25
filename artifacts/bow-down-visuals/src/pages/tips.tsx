import { useEffect, useState } from "react";
import {
  HandCoins, Loader2, Copy, Check, Link2, PiggyBank, Users, TrendingUp,
  MessageCircleHeart, Sparkles, BadgeAlert,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";

/* ─── Tip Jar — creator dashboard ──────────────────────────────────────────
   Set up your public tip page at /tips/:handle, share the link, and watch
   tip intent roll in. Payment processing is COMING SOON — tips are recorded
   as intent only, no charge is ever made. Setup is free. */

interface TipSettings {
  handle: string;
  displayName: string;
  message: string;
  suggestedAmounts: number[];
  goalAmount: number | null;
  goalLabel: string;
}

interface TipIntent {
  id: string;
  amount: number;
  currency: string;
  fanName: string;
  message: string;
  status: string;
  createdAt: string;
}

interface Dashboard {
  hasPage: boolean;
  handle: string | null;
  total: number;
  count: number;
  average: number;
  goalAmount: number | null;
  goalLabel: string;
  goalProgress: number | null;
  feed: TipIntent[];
  paymentsLive: boolean;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const cardClass =
  "rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-6 backdrop-blur";

const DEFAULT_SUGGESTED = "5, 10, 25";

export default function Tips() {
  const { user, getAccessToken } = useAuth();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [suggested, setSuggested] = useState(DEFAULT_SUGGESTED);
  const [goalAmount, setGoalAmount] = useState("");
  const [goalLabel, setGoalLabel] = useState("");

  async function authFetch(path: string, opts: RequestInit = {}) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      ...opts,
      headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function load() {
    setLoading(true);
    setError(null);
    const { res, data } = await authFetch("/api/tips/dashboard");
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't load your tip jar.");
      return;
    }
    setDashboard(data);
    if (data.hasPage) {
      const { res: sres, data: sdata } = await authFetch("/api/tips/settings");
      if (sres.ok && sdata.settings) {
        const s: TipSettings = sdata.settings;
        setHandle(s.handle);
        setDisplayName(s.displayName);
        setMessage(s.message);
        setSuggested(s.suggestedAmounts.join(", "));
        setGoalAmount(s.goalAmount != null ? String(s.goalAmount) : "");
        setGoalLabel(s.goalLabel);
      }
    }
  }

  useEffect(() => {
    if (user) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function save() {
    setSaving(true);
    setError(null);
    const suggestedAmounts = suggested
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x) && x > 0);
    const { res, data } = await authFetch("/api/tips/settings", {
      method: "POST",
      body: JSON.stringify({
        handle,
        displayName,
        message,
        suggestedAmounts: suggestedAmounts.length ? suggestedAmounts : [5, 10, 25],
        goalAmount: goalAmount.trim() ? Number(goalAmount) : null,
        goalLabel,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(data.details?.[0]?.message ?? data.error ?? "Couldn't save your tip page.");
      return;
    }
    await load();
  }

  function tipUrl() {
    return `${window.location.origin}/tips/${dashboard?.handle ?? handle}`;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(tipUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — user can copy manually */
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-28">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-primary">
          <HandCoins className="h-4 w-4" /> Creator monetization
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">
          Your <span className="bg-gradient-to-r from-amber-200 via-primary to-amber-200 bg-clip-text text-transparent">Tip Jar</span>
        </h1>
        <p className="mt-3 max-w-2xl text-white/55">
          Give fans a beautiful place to support you. Set up your page, share the link,
          and every tip shows up here. Free to set up.
        </p>

        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4 text-sm text-amber-200/90">
          <BadgeAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <p>
            <strong className="text-amber-100">Payments are coming soon.</strong> Tips are recorded as
            intent only right now — no charge is ever made and nothing is marked paid. We'll flip the
            switch when real payments go live.
          </p>
        </div>

        {loading ? (
          <div className="mt-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : (
          <>
            {error && (
              <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
            )}

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              {/* Setup */}
              <section className={cardClass}>
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <Link2 className="h-5 w-5 text-primary" /> Your tip page
                </h2>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-white/50">Handle (your public link)</label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white/40">/tips/</span>
                      <input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                        placeholder="sharkking" className={inputClass} maxLength={30} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-white/50">Display name</label>
                    <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Shark King" className={inputClass} maxLength={60} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-white/50">Message to fans</label>
                    <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                      placeholder="Your support keeps the music coming. Every tip means the world." className={inputClass} rows={3} maxLength={500} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-white/50">Suggested amounts (comma-separated, USD)</label>
                    <input value={suggested} onChange={(e) => setSuggested(e.target.value)}
                      placeholder="5, 10, 25" className={inputClass} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-white/50">Goal amount (optional)</label>
                      <input value={goalAmount} onChange={(e) => setGoalAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                        placeholder="500" className={inputClass} inputMode="decimal" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-white/50">Goal label</label>
                      <input value={goalLabel} onChange={(e) => setGoalLabel(e.target.value)}
                        placeholder="New studio mic" className={inputClass} maxLength={80} />
                    </div>
                  </div>
                  <button onClick={save} disabled={saving || !handle.trim() || !displayName.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-primary px-4 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-40">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {dashboard?.hasPage ? "Update tip page" : "Create my tip page"}
                  </button>
                  {dashboard?.hasPage && (
                    <button onClick={copyLink}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/[0.08]">
                      {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                      {copied ? "Link copied!" : "Copy my tip link"}
                    </button>
                  )}
                </div>
              </section>

              {/* Dashboard */}
              <section className={cardClass}>
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <PiggyBank className="h-5 w-5 text-primary" /> Tip jar totals
                </h2>
                {!dashboard?.hasPage ? (
                  <p className="mt-4 text-sm text-white/50">
                    Set up your tip page to start collecting tips. Your totals and tip feed will appear here.
                  </p>
                ) : (
                  <>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-center">
                        <div className="text-2xl font-extrabold text-primary">${dashboard.total.toFixed(2)}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-wider text-white/40">tipped</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-center">
                        <div className="flex items-center justify-center gap-1 text-2xl font-extrabold"><Users className="h-5 w-5 text-primary" />{dashboard.count}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-wider text-white/40">tips</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-center">
                        <div className="flex items-center justify-center gap-1 text-2xl font-extrabold"><TrendingUp className="h-5 w-5 text-primary" />${dashboard.average.toFixed(2)}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-wider text-white/40">average</div>
                      </div>
                    </div>
                    {dashboard.goalAmount != null && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-xs text-white/50">
                          <span>{dashboard.goalLabel || "Goal"} — ${dashboard.total.toFixed(2)} of ${dashboard.goalAmount.toFixed(2)}</span>
                          <span>{Math.round((dashboard.goalProgress ?? 0) * 100)}%</span>
                        </div>
                        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-primary transition-all"
                            style={{ width: `${Math.round((dashboard.goalProgress ?? 0) * 100)}%` }} />
                        </div>
                      </div>
                    )}
                    <h3 className="mt-6 flex items-center gap-2 text-sm font-bold text-white/70">
                      <MessageCircleHeart className="h-4 w-4 text-primary" /> Recent tips
                    </h3>
                    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                      {dashboard.feed.length === 0 && (
                        <p className="text-sm text-white/40">No tips yet — share your link and they'll land here.</p>
                      )}
                      {dashboard.feed.map((t) => (
                        <div key={t.id} className="rounded-xl border border-white/10 bg-black/40 p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-white/85">{t.fanName || "Anonymous fan"}</span>
                            <span className="text-sm font-bold text-primary">${t.amount.toFixed(2)}</span>
                          </div>
                          {t.message && <p className="mt-1 text-xs text-white/50">“{t.message}”</p>}
                          <p className="mt-1 text-[11px] text-white/30">
                            {new Date(t.createdAt).toLocaleString()} · {t.status === "pending_payment" ? "intent recorded" : t.status}
                          </p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
