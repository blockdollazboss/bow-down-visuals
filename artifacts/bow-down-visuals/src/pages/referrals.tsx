import { useEffect, useState } from "react";
import { Users, Copy, Check, Share2, Gift, Loader2, TrendingUp, Star, Crown, Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";

/* ─── Promoter HQ — the referral program as a job ──────────────────────────
   Each user gets a personal referral link. New user signs up via link and
   gets 1,000 welcome Visual Bucs. Referrers climb 6 Kingpin-style stars: higher
   stars = higher revenue-share rate + one-time milestone bonuses. */

interface ReferralEntry {
  joinedAt: string;
  creditsEarned: number;
  shareExpiresAt: string | null;
  daysLeft: number;
  active: boolean;
}

interface TierInfo {
  stars: number;
  title: string;
  ratePct: number;
}

interface TierLadderEntry extends TierInfo {
  minReferrals: number;
  milestoneBonus: number;
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
  tier: TierInfo | null;
  nextTier: (TierInfo & { minReferrals: number; milestoneBonus: number }) | null;
  claimedMilestones: number[];
  tierLadder: TierLadderEntry[];
}

function StarRow({ filled, total = 6 }: { filled: number; total?: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <Star
          key={i}
          className={`h-6 w-6 ${i < filled ? "text-primary fill-primary" : "text-white/20"}`}
          style={i < filled ? { filter: "drop-shadow(0 0 6px rgba(212,160,23,0.7))" } : undefined}
        />
      ))}
    </div>
  );
}

export default function Referrals() {
  const { t } = useTranslation();
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
      if (!res.ok) { setError(data.error ?? t("referrals.error.loadFailed")); return; }
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

  const shareText = t("referrals.shareText", { reward: info?.refereeReward ?? 10 });
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
            <Crown className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            {t("referrals.titlePrefix")} <span className="text-primary">{t("referrals.titleSuffix")}</span>
          </h1>
          <p className="mt-3 text-white/55 max-w-md mx-auto">
            {t("referrals.hero.p1")}{" "}
            <span className="text-primary font-semibold">{t("referrals.hero.reward", { num: info?.refereeReward ?? 10 })}</span>
            {t("referrals.hero.p2")}{" "}
            <span className="text-primary font-semibold">{t("referrals.hero.cut")}</span>{" "}
            {t("referrals.hero.p3")}{" "}
            <span className="text-primary font-semibold">{t("referrals.hero.days", { days: info?.shareWindowDays ?? 90 })}</span>
            {t("referrals.hero.p4")}
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
            <a href="/signup" className="text-primary hover:underline font-semibold">{t("referrals.signup.link")}</a>{" "}
            {t("referrals.signup.suffix")}
          </p>
        ) : info && (
          <>
            {/* Rank card — your Kingpin standing */}
            <div className="lux-card p-6 mb-8 text-center relative overflow-hidden">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[120px] bg-primary/10 rounded-full blur-[60px] pointer-events-none" />
              <div className="relative z-10">
                {info.tier ? (
                  <>
                    <StarRow filled={info.tier.stars} />
                    <p className="mt-3 text-2xl font-black text-white tracking-tight">
                      {info.tier.title}
                    </p>
                    <p className="mt-1 text-sm text-primary font-semibold">
                      {t("referrals.rank.cut", { pct: info.tier.ratePct })}
                    </p>
                  </>
                ) : (
                  <>
                    <StarRow filled={0} />
                    <p className="mt-3 text-2xl font-black text-white/60 tracking-tight">
                      {t("referrals.rank.notRanked")}
                    </p>
                    <p className="mt-1 text-sm text-white/45">
                      {t("referrals.rank.firstStar")}
                    </p>
                  </>
                )}
                {info.nextTier && (
                  <div className="mt-5 max-w-sm mx-auto">
                    <div className="flex justify-between text-xs text-white/45 mb-1.5">
                      <span>
                        {t("referrals.rank.moreTo", { num: info.nextTier.minReferrals - info.totalReferrals })}{" "}
                        <span className="text-primary font-semibold">{info.nextTier.title}</span>
                      </span>
                      <span>{t("referrals.rank.nextReward", { pct: info.nextTier.ratePct, bonus: info.nextTier.milestoneBonus.toLocaleString("en-US") })}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#C9A84C] to-[#e8c86a] transition-all"
                        style={{
                          width: `${Math.min(100, (info.totalReferrals / info.nextTier.minReferrals) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {!info.nextTier && info.tier && (
                  <p className="mt-4 text-sm text-primary font-semibold flex items-center justify-center gap-1.5">
                    <Crown className="h-4 w-4" /> {t("referrals.rank.top")}
                  </p>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="lux-card p-5 text-center">
                <Users className="h-5 w-5 text-primary mx-auto mb-2" />
                <p className="text-3xl font-black text-white">{info.totalReferrals}</p>
                <p className="text-xs text-white/45 uppercase tracking-widest mt-1">{t("referrals.stats.joined")}</p>
              </div>
              <div className="lux-card p-5 text-center">
                <TrendingUp className="h-5 w-5 text-primary mx-auto mb-2" />
                <p className="text-3xl font-black text-white">{info.activeReferrals}</p>
                <p className="text-xs text-white/45 uppercase tracking-widest mt-1">{t("referrals.stats.earning")}</p>
              </div>
              <div className="lux-card p-5 text-center">
                <Gift className="h-5 w-5 text-primary mx-auto mb-2" />
                <p className="text-3xl font-black text-white">{info.creditsEarned.toLocaleString("en-US")}</p>
                <p className="text-xs text-white/45 uppercase tracking-widest mt-1">{t("referrals.stats.earned")}</p>
              </div>
            </div>

            {/* Link */}
            <div className="lux-card p-5 mb-6">
              <p className="text-xs text-white/45 uppercase tracking-widest mb-3">{t("referrals.link.title")}</p>
              <div className="flex gap-2">
                <code className="flex-1 min-w-0 truncate rounded-lg bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-primary">
                  {referralLink}
                </code>
                <button
                  onClick={copyLink}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-black hover:brightness-110 transition"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? t("referrals.link.copied") : t("referrals.link.copy")}
                </button>
              </div>
            </div>

            {/* Share */}
            <div className="lux-card p-5">
              <p className="text-xs text-white/45 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <Share2 className="h-3.5 w-3.5" /> {t("referrals.share.title")}
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
                <Users className="h-3.5 w-3.5" /> {t("referrals.tracker.title")}
              </p>
              {!info.referrals || info.referrals.length === 0 ? (
                <p className="text-center text-white/40 text-sm py-6">
                  {t("referrals.tracker.empty")}
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
                          {t("referrals.tracker.creator", { n: info.referrals.length - i })}
                        </p>
                        <p className="text-xs text-white/40">
                          {t("referrals.tracker.joined")}{" "}
                          {new Date(r.joinedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-primary">
                          {t("referrals.tracker.earned", { amount: r.creditsEarned })}
                        </p>
                        {r.active ? (
                          <p className="text-xs text-emerald-400 font-medium">
                            {t("referrals.tracker.earning", { days: r.daysLeft })}
                          </p>
                        ) : (
                          <p className="text-xs text-white/35">{t("referrals.tracker.ended")}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Rank ladder — the climb */}
            <div className="lux-card p-5 mb-6">
              <p className="text-xs text-white/45 uppercase tracking-widest mb-4 flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5" /> {t("referrals.ladder.title")}
              </p>
              <div className="space-y-2">
                {info.tierLadder.map((tier) => {
                  const unlocked = info.totalReferrals >= tier.minReferrals;
                  const isCurrent = info.tier?.stars === tier.stars;
                  const claimed = info.claimedMilestones.includes(tier.stars);
                  return (
                    <div
                      key={tier.stars}
                      className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3 border ${
                        isCurrent
                          ? "bg-primary/10 border-primary/40"
                          : unlocked
                            ? "bg-black/40 border-white/10"
                            : "bg-black/20 border-white/5 opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex shrink-0">
                          {Array.from({ length: tier.stars }).map((_, i) => (
                            <Star
                              key={i}
                              className={`h-3.5 w-3.5 -ml-1 first:ml-0 ${unlocked ? "text-primary fill-primary" : "text-white/20"}`}
                            />
                          ))}
                        </div>
                        <div className="min-w-0">
                          <p className={`text-sm font-bold ${unlocked ? "text-white" : "text-white/50"}`}>
                            {tier.title}
                            {isCurrent && <span className="ml-2 text-xs text-primary font-semibold">{t("referrals.ladder.you")}</span>}
                          </p>
                          <p className="text-xs text-white/40">
                            {t("referrals.ladder.requirement", { min: tier.minReferrals, pct: tier.ratePct })}
                            {tier.milestoneBonus > 0 && (
                              <> · <span className={claimed ? "text-emerald-400" : "text-primary/80"}>
                                {claimed
                                  ? t("referrals.ladder.bonusClaimed", { bonus: tier.milestoneBonus.toLocaleString("en-US") })
                                  : t("referrals.ladder.bonus", { bonus: tier.milestoneBonus.toLocaleString("en-US") })}
                              </span></>
                            )}
                          </p>
                        </div>
                      </div>
                      {!unlocked && (
                        <Lock className="h-4 w-4 text-white/25 shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="mt-6 text-center text-xs text-white/35 max-w-md mx-auto">
              {t("referrals.footer", { pct: info.revenueSharePct, days: info.shareWindowDays })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
