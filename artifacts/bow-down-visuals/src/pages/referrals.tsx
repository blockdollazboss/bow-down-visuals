import { useEffect, useState } from "react";
import { Users, Copy, Check, Share2, Gift, Loader2, TrendingUp, Star, Crown, Lock, Trophy, Timer, Megaphone } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { QRCodeModal } from "@/components/QRCode";
import { useTranslation } from "react-i18next";

/* ─── Promoter HQ — the referral program as a job ──────────────────────────
   Each user gets a personal referral link. New user signs up via link and
   gets 1,000 welcome Visual Bucs. Referrers climb 6 Kingpin-style stars: higher
   stars = higher revenue-share rate + one-time milestone bonuses.

   VIRALITY WAVE:
   - Referral leaderboard (weekly / monthly / all-time) — public, real data.
   - Monthly viral contest: 40,000 VB prize pool, countdown, auto-settled
     winners paid in Visual Bucs, shareable winner announcements.
   - Share kit: pre-written posts + personal link, one click to blast. */

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

interface WindowRanks {
  weekly: number | null;
  monthly: number | null;
  alltime: number | null;
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
  ranks: WindowRanks;
}

interface LeaderboardEntry {
  rank: number;
  name: string;
  slug: string | null;
  signups: number;
  revenue: number;
  badge: { stars: number; title: string } | null;
}

interface ContestPrize {
  rank: number;
  prizeCredits: number;
}

interface ContestWinner {
  rank: number;
  name: string;
  slug: string | null;
  signups: number;
  prizeCredits: number;
  badge: { stars: number; title: string } | null;
}

interface ContestData {
  period: string;
  endsAt: string;
  rules: string[];
  prizes: ContestPrize[];
  minSignupsToQualify: number;
  standings: LeaderboardEntry[];
  lastWinners: ContestWinner[];
  lastWinnerPeriod: string | null;
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

function BadgeChip({ badge }: { badge: { stars: number; title: string } | null }) {
  if (!badge) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary whitespace-nowrap">
      <Crown className="h-3 w-3" /> {badge.title}
    </span>
  );
}

/* ─── Countdown to month-end ─────────────────────────────────────────────── */
function useCountdown(endsAt: string | null) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt) return { d: 0, h: 0, m: 0, s: 0 };
  const diff = Math.max(0, new Date(endsAt).getTime() - nowMs);
  return {
    d: Math.floor(diff / 86400000),
    h: Math.floor((diff % 86400000) / 3600000),
    m: Math.floor((diff % 3600000) / 60000),
    s: Math.floor((diff % 60000) / 1000),
  };
}

function ContestSection({ contest, mySignupsThisMonth }: { contest: ContestData; mySignupsThisMonth: number }) {
  const { t } = useTranslation();
  const [copiedWin, setCopiedWin] = useState<number | null>(null);
  const { d, h, m, s } = useCountdown(contest.endsAt);
  const totalPool = contest.prizes.reduce((sum, p) => sum + p.prizeCredits, 0);
  const pad = (n: number) => String(n).padStart(2, "0");

  const shareWinner = async (w: ContestWinner) => {
    const text = t("referrals.contest.shareWin", {
      name: w.name,
      prize: w.prizeCredits.toLocaleString("en-US"),
      signups: w.signups,
      link: `${window.location.origin}/referrals`,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopiedWin(w.rank);
      setTimeout(() => setCopiedWin(null), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="lux-card p-6 mb-8 relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[340px] h-[140px] bg-primary/10 rounded-full blur-[60px] pointer-events-none" />
      <div className="relative z-10">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Trophy className="h-5 w-5 text-primary" />
          <p className="text-xs text-white/45 uppercase tracking-widest">{t("referrals.contest.title")}</p>
        </div>
        <p className="text-center text-3xl font-black text-white tracking-tight">
          <span className="text-primary">{totalPool.toLocaleString("en-US")}</span> VB
        </p>
        <p className="text-center text-xs text-white/45 mt-1">
          {t("referrals.contest.pool", { total: totalPool.toLocaleString("en-US") })}
        </p>

        {/* Countdown */}
        <div className="flex items-center justify-center gap-2 mt-4">
          <Timer className="h-4 w-4 text-primary" />
          <span className="text-xs text-white/45 uppercase tracking-widest">{t("referrals.contest.endsIn")}</span>
        </div>
        <div className="flex justify-center gap-2 mt-2">
          {[
            { v: pad(d), l: t("referrals.contest.days") },
            { v: pad(h), l: t("referrals.contest.hours") },
            { v: pad(m), l: t("referrals.contest.mins") },
            { v: pad(s), l: t("referrals.contest.secs") },
          ].map((u) => (
            <div key={u.l} className="rounded-lg bg-black/50 border border-primary/25 px-3 py-2 text-center min-w-[56px]">
              <p className="text-xl font-black text-primary tabular-nums">{u.v}</p>
              <p className="text-[10px] text-white/40 uppercase">{u.l}</p>
            </div>
          ))}
        </div>

        {/* Prizes */}
        <div className="mt-5">
          <p className="text-xs text-white/45 uppercase tracking-widest mb-2 text-center">{t("referrals.contest.prizesTitle")}</p>
          <div className="grid grid-cols-3 gap-2">
            {contest.prizes.map((p) => (
              <div key={p.rank} className="rounded-lg bg-black/40 border border-white/10 px-3 py-2.5 text-center">
                <p className="text-lg font-black text-primary">#{p.rank}</p>
                <p className="text-sm font-bold text-white">{p.prizeCredits.toLocaleString("en-US")} VB</p>
              </div>
            ))}
          </div>
        </div>

        {/* Rules */}
        <div className="mt-5">
          <p className="text-xs text-white/45 uppercase tracking-widest mb-2 text-center">{t("referrals.contest.rulesTitle")}</p>
          <ul className="space-y-1.5 max-w-md mx-auto">
            {contest.rules.map((rule, i) => (
              <li key={i} className="text-xs text-white/60 flex gap-2">
                <span className="text-primary font-bold shrink-0">{i + 1}.</span> {rule}
              </li>
            ))}
          </ul>
        </div>

        {/* Live standings */}
        <div className="mt-5">
          <p className="text-xs text-white/45 uppercase tracking-widest mb-2 text-center">
            {t("referrals.contest.standingsTitle")}
          </p>
          {contest.standings.length === 0 ? (
            <p className="text-center text-white/40 text-sm py-4">{t("referrals.leaderboard.empty")}</p>
          ) : (
            <div className="space-y-1.5">
              {contest.standings.map((e) => {
                const qualified = e.signups >= contest.minSignupsToQualify;
                return (
                  <div
                    key={e.rank}
                    className="flex items-center gap-3 rounded-lg bg-black/40 border border-white/10 px-3 py-2"
                  >
                    <span className={`text-sm font-black w-7 text-center ${e.rank <= 3 ? "text-primary" : "text-white/40"}`}>
                      {e.rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{e.name}</p>
                      <p className="text-[11px] text-white/40">
                        {t("referrals.leaderboard.signups")}: <span className="text-white/70 font-bold">{e.signups}</span>
                        {" · "}
                        {qualified
                          ? <span className="text-emerald-400 font-semibold">{t("referrals.contest.qualified")}</span>
                          : <span className="text-white/35">{t("referrals.contest.needMore", { n: contest.minSignupsToQualify - e.signups })}</span>}
                      </p>
                    </div>
                    <BadgeChip badge={e.badge} />
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-center text-xs text-white/40 mt-2">
            {t("referrals.contest.yourSpots", { n: mySignupsThisMonth })}
          </p>
        </div>

        {/* Last month's winners */}
        {contest.lastWinners.length > 0 && contest.lastWinnerPeriod && (
          <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <p className="text-xs text-white/45 uppercase tracking-widest mb-3 text-center">
              {t("referrals.contest.lastWinnersTitle")} · {contest.lastWinnerPeriod}
            </p>
            <div className="space-y-2">
              {contest.lastWinners.map((w) => (
                <div key={w.rank} className="flex items-center gap-3">
                  <Trophy className={`h-4 w-4 shrink-0 ${w.rank === 1 ? "text-primary" : "text-white/40"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">
                      {w.slug ? <a href={`/artist/${w.slug}`} className="hover:text-primary hover:underline">{w.name}</a> : w.name}
                      {" "}<BadgeChip badge={w.badge} />
                    </p>
                    <p className="text-[11px] text-white/45">
                      {w.signups} {t("referrals.contest.signups")} → <span className="text-primary font-bold">+{w.prizeCredits.toLocaleString("en-US")} VB</span>
                    </p>
                  </div>
                  <button
                    onClick={() => shareWinner(w)}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-primary hover:border-primary/40 transition"
                  >
                    {copiedWin === w.rank ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
                    {copiedWin === w.rank ? t("referrals.contest.copied") : t("referrals.contest.share")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Leaderboard ────────────────────────────────────────────────────────── */
function LeaderboardSection({ myRanks }: { myRanks: WindowRanks }) {
  const { t } = useTranslation();
  const [window, setWindow] = useState<"weekly" | "monthly" | "alltime">("monthly");
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    (async () => {
      try {
        const res = await fetch(`/api/referrals/leaderboard?window=${window}`);
        const data = await res.json();
        if (!cancelled && res.ok) setEntries(data.entries ?? []);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [window]);

  const myRank = myRanks[window];
  const tabs: Array<{ key: "weekly" | "monthly" | "alltime"; label: string }> = [
    { key: "weekly", label: t("referrals.leaderboard.weekly") },
    { key: "monthly", label: t("referrals.leaderboard.monthly") },
    { key: "alltime", label: t("referrals.leaderboard.allTime") },
  ];

  return (
    <div className="lux-card p-5 mb-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="text-xs text-white/45 uppercase tracking-widest flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" /> {t("referrals.leaderboard.title")}
        </p>
        <div className="flex gap-1 rounded-lg bg-black/40 border border-white/10 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setWindow(tab.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${
                window === tab.key ? "bg-primary text-black" : "text-white/55 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {myRank != null && (
        <p className="text-center text-sm text-primary font-bold mb-3">
          {t("referrals.leaderboard.yourRank", { rank: myRank })}
        </p>
      )}
      {entries === null ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-center text-white/40 text-sm py-6">{t("referrals.leaderboard.empty")}</p>
      ) : (
        <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
          {entries.map((e) => {
            const isMe = myRank != null && e.rank === myRank;
            return (
              <div
                key={e.rank}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 border ${
                  isMe ? "bg-primary/10 border-primary/40" : "bg-black/40 border-white/10"
                }`}
              >
                <span className={`text-sm font-black w-7 text-center ${e.rank <= 3 ? "text-primary" : "text-white/40"}`}>
                  {e.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">
                    {e.slug ? <a href={`/artist/${e.slug}`} className="hover:text-primary hover:underline">{e.name}</a> : e.name}
                    {isMe && <span className="ml-2 text-[10px] text-primary font-black">{t("referrals.leaderboard.you")}</span>}
                  </p>
                  <p className="text-[11px] text-white/40">
                    {e.signups} {t("referrals.leaderboard.signups")} · {e.revenue.toLocaleString("en-US")} {t("referrals.leaderboard.revenue")}
                  </p>
                </div>
                <BadgeChip badge={e.badge} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Share kit — one-click blast ────────────────────────────────────────── */
function ShareKitSection({ referralLink, reward }: { referralLink: string; reward: number }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);

  const templates: Array<{ key: string; label: string; text: string }> = [
    { key: "x", label: t("referrals.sharekit.templates.x"), text: t("referrals.sharekit.postX", { reward, link: referralLink }) },
    { key: "threads", label: t("referrals.sharekit.templates.threads"), text: t("referrals.sharekit.postThreads", { reward, link: referralLink }) },
    { key: "tiktok", label: t("referrals.sharekit.templates.tiktok"), text: t("referrals.sharekit.postTiktok", { reward, link: referralLink }) },
    { key: "chat", label: t("referrals.sharekit.templates.chat"), text: t("referrals.sharekit.postChat", { reward, link: referralLink }) },
  ];

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const blastText = templates[0]!.text;
  const blastLinks = [
    { label: "X", href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(blastText)}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${encodeURIComponent(blastText)}` },
    { label: "Telegram", href: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(t("referrals.sharekit.postX", { reward, link: "" }))}` },
  ];

  return (
    <div className="lux-card p-5 mb-6">
      <p className="text-xs text-white/45 uppercase tracking-widest mb-1 flex items-center gap-1.5">
        <Megaphone className="h-3.5 w-3.5" /> {t("referrals.sharekit.title")}
      </p>
      <p className="text-xs text-white/40 mb-4">{t("referrals.sharekit.subtitle")}</p>
      <div className="space-y-3">
        {templates.map((tpl) => (
          <div key={tpl.key} className="rounded-lg bg-black/40 border border-white/10 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-white/60 uppercase tracking-widest">{tpl.label}</p>
              <button
                onClick={() => copyText(tpl.key, tpl.text)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black hover:brightness-110 transition"
              >
                {copied === tpl.key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === tpl.key ? t("referrals.sharekit.copied") : t("referrals.sharekit.copy")}
              </button>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">{tpl.text}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap mt-4">
        {blastLinks.map((s) => (
          <a
            key={s.label}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-bold text-primary hover:bg-primary/20 transition"
          >
            Blast on {s.label} ↗
          </a>
        ))}
      </div>
    </div>
  );
}

export default function Referrals() {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [contest, setContest] = useState<ContestData | null>(null);
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
      // Contest is public — load it even for logged-out visitors.
      try {
        const cres = await fetch("/api/referrals/contest");
        const cdata = await cres.json();
        if (cres.ok) setContest(cdata);
      } catch { /* non-fatal */ }
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

  // Signups this month for the contest "your spots" line
  const mySignupsThisMonth = (() => {
    if (!info) return 0;
    const now = new Date();
    const mStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime();
    return info.referrals.filter((r) => new Date(r.joinedAt).getTime() >= mStart).length;
  })();

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

        {/* Contest is public — show it even when logged out */}
        {contest && <ContestSection contest={contest} mySignupsThisMonth={mySignupsThisMonth} />}

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
            {/* Rank card — your Kingpin standing + window ranks */}
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
                {/* Your leaderboard ranks */}
                <div className="mt-4 flex justify-center gap-2 flex-wrap">
                  {[
                    { label: t("referrals.rank.thisWeek"), rank: info.ranks.weekly },
                    { label: t("referrals.rank.thisMonth"), rank: info.ranks.monthly },
                    { label: t("referrals.rank.allTime"), rank: info.ranks.alltime },
                  ].map((w) => (
                    <div key={w.label} className="rounded-lg bg-black/40 border border-white/10 px-3 py-1.5">
                      <p className="text-[10px] text-white/40 uppercase tracking-widest">{w.label}</p>
                      <p className="text-sm font-black text-primary">
                        {w.rank != null ? `#${w.rank}` : t("referrals.rank.unranked")}
                      </p>
                    </div>
                  ))}
                </div>
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

            {/* Leaderboard */}
            <LeaderboardSection myRanks={info.ranks} />

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
                <QRCodeModal data={referralLink} title="Referral QR Code" />
              </div>
            </div>

            {/* Share kit */}
            <ShareKitSection referralLink={referralLink} reward={info.refereeReward} />

            {/* Share */}
            <div className="lux-card p-5 mb-6">
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
