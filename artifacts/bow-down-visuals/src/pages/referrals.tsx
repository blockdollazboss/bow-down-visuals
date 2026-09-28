import { useEffect, useState } from "react";
import { Users, Copy, Check, Share2, Gift, Loader2, TrendingUp } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── Referrals — invite creators, earn a revenue share ────────────────────
   Each user gets a personal referral link. New user signs up via link and
   gets 10 welcome credits. Referrer earns 25% of the referee's credit
   purchases (paid in site credits) for 90 days. No upfront referrer payout. */

interface ReferralEntry {
  joinedAt: string;
  creditsEarned: number;
  shareExpiresAt: string | null;
  daysLeft: number;
  active: boolean;
}

interface ReferralInfo {
  code: string;
  totalReferrals: number;
  activeReferrals: number;
  creditsEarned: number;
  revenueSharePct: number;
  shareWindowDays: number;
  refereeReward: number;
  referrals: ReferralEntry[];
}

export default function Referrals() {
  const { user, getAccessToken } = useAuth();
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function authFetch(path: string, opts: RequestInit = {}) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      ...opts,
      headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  useEffect(() => {
    (async () => {
      if (!user) { setLoading(false); return; }
      const { res, data } = await authFetch("/api/referrals/me");
      setLoading(false);
      if (!res.ok) { setError(data.error ?? "Couldn't load referrals."); return; }
      setInfo(data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const referralLink = info ? `${window.location.origin}/?ref=${info.code}` : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const shareText = `Join me on Bow Down Visuals — the AI studio for content creators. Sign up with my link and get ${info?.refereeReward ?? 10} free credits to start!`;
  const shareLinks = [
    { label: "X", href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(referralLink)}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}` },
    { label: "Threads", href: `https://www.threads.net/intent/post?text=${encodeURIComponent(shareText + " " + referralLink)}` },
  ];

  return (
    <div className="min-h-screen flex flex-col items-center px-5 py-16">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 border border-primary/30 mb-4">
            <Gift className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Invite creators, <span className="text-primary">earn on every purchase</span>
          </h1>
          <p className="mt-3 text-white/55 max-w-md mx-auto">
            Share your link. New creators get{" "}
            <span className="text-primary font-semibold">{info?.refereeReward ?? 10} free credits</span>,
            and you earn{" "}
            <span className="text-primary font-semibold">{info?.revenueSharePct ?? 25}% of everything
            they buy</span>{" "}in credits for{" "}
            <span className="text-primary font-semibold">{info?.shareWindowDays ?? 90} days</span>.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="text-center text-red-400">{error}</p>
        ) : !user ? (
          <p className="text-center text-white/55">
            <a href="/signup" className="text-primary hover:underline font-semibold">Sign up</a>{" "}
            to get your referral link.
          </p>
        ) : info && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="lux-card p-5 text-center">
                <Users className="h-5 w-5 text-primary mx-auto mb-2" />
                <p className="text-3xl font-black text-white">{info.totalReferrals}</p>
                <p className="text-xs text-white/45 uppercase tracking-widest mt-1">Creators joined</p>
              </div>
              <div className="lux-card p-5 text-center">
                <TrendingUp className="h-5 w-5 text-primary mx-auto mb-2" />
                <p className="text-3xl font-black text-white">{info.activeReferrals}</p>
                <p className="text-xs text-white/45 uppercase tracking-widest mt-1">Earning now</p>
              </div>
              <div className="lux-card p-5 text-center">
                <Gift className="h-5 w-5 text-primary mx-auto mb-2" />
                <p className="text-3xl font-black text-white">{info.creditsEarned}</p>
                <p className="text-xs text-white/45 uppercase tracking-widest mt-1">Credits earned</p>
              </div>
            </div>

            {/* Link */}
            <div className="lux-card p-5 mb-6">
              <p className="text-xs text-white/45 uppercase tracking-widest mb-3">Your referral link</p>
              <div className="flex gap-2">
                <code className="flex-1 min-w-0 truncate rounded-lg bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-primary">
                  {referralLink}
                </code>
                <button
                  onClick={copyLink}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-black hover:brightness-110 transition"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            {/* Share */}
            <div className="lux-card p-5">
              <p className="text-xs text-white/45 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <Share2 className="h-3.5 w-3.5" /> Share it
              </p>
              <div className="flex gap-2 flex-wrap">
                {shareLinks.map((s) => (
                  <a
                    key={s.label}
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 hover:text-primary hover:border-primary/40 transition"
                  >
                    {s.label}
                  </a>
                ))}
              </div>
            </div>

            {/* Referral tracker — per-referral detail */}
            <div className="lux-card p-5 mb-6">
              <p className="text-xs text-white/45 uppercase tracking-widest mb-4 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Your referrals
              </p>
              {!info.referrals || info.referrals.length === 0 ? (
                <p className="text-center text-white/40 text-sm py-6">
                  Nobody's joined through your link yet — share it above and
                  they'll show up here.
                </p>
              ) : (
                <div className="space-y-2">
                  {info.referrals.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 rounded-lg bg-black/40 border border-white/10 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">
                          Creator #{info.referrals.length - i}
                        </p>
                        <p className="text-xs text-white/40">
                          Joined{" "}
                          {new Date(r.joinedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-primary">
                          +{r.creditsEarned} cr
                        </p>
                        {r.active ? (
                          <p className="text-xs text-emerald-400 font-medium">
                            Earning · {r.daysLeft}d left
                          </p>
                        ) : (
                          <p className="text-xs text-white/35">Window ended</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="mt-6 text-center text-xs text-white/35 max-w-md mx-auto">
              You earn {info.revenueSharePct}% of each referred creator's credit purchases,
              paid in credits, for {info.shareWindowDays} days after they join.
              Payouts land automatically when they buy.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
