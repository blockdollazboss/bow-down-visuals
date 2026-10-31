import { useEffect, useState } from "react";
import { Check, Copy, Crown, Star, Trophy, Users } from "lucide-react";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native/NativeStates";
import { useDeskAuthHeaders } from "@/components/world/native/CreateDeskShared";
import {
  REFERRALS_CONTEST_PATH,
  REFERRALS_ME_PATH,
  nextTierLine,
  normalizeReferralContest,
  normalizeReferralSummary,
  rankLine,
  referralLink,
  type ReferralContest,
  type ReferralSummary,
} from "@/lib/world/referrals-desk";

/* ─── Referrals, in-world (stack1100 world parity) ─────────────────
   Your referral hub at the Earnings Board — on the referrals
   router's own rails, the same /api/referrals/me + /contest
   endpoints pages/referrals.tsx calls: your code and share link
   (the page's own construction), who you brought in and what they
   earned you, your promoter tier and the climb to the next one,
   your leaderboard ranks, and this month's contest board. The desk
   renders inside the EarningsBoard, which already pitches guests,
   so it is members-only by construction. Numbers render only from
   the rail's fields; a window the rail leaves unranked reads
   "unranked", never a placing invented for the row. */

const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

export function ReferralsDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [contest, setContest] = useState<ReferralContest | null>(null);
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    (async () => {
      try {
        const res = await fetch(REFERRALS_ME_PATH, { headers: await authHeaders() });
        if (!res.ok) throw new Error(`referrals ${res.status}`);
        const parsed = normalizeReferralSummary(await res.json());
        if (!parsed) throw new Error("referrals shape");
        if (!cancelled) setSummary(parsed);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  /* The contest is a secondary read: its failure never takes the
     hub down — the strip simply doesn't stand. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(REFERRALS_CONTEST_PATH, { headers: await authHeaders() });
        if (!res.ok) return;
        const parsed = normalizeReferralContest(await res.json());
        if (!cancelled && parsed) setContest(parsed);
      } catch {
        /* tolerant — the hub stands without the contest strip */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  function copyLink() {
    if (!summary) return;
    void navigator.clipboard
      ?.writeText(referralLink(window.location.origin, summary.code))
      .catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const nextLine = summary ? nextTierLine(summary) : null;

  return (
    <NativeCard isLight={isLight} title="Referrals — bring the kingdom">
      <div data-testid="world-referrals-desk" className="space-y-3">
        {loadFailed ? (
          <NativeErrorState
            isLight={isLight}
            title="Your referral hub wouldn't open"
            message="Your code and your people are safe on the real rails — the hub just didn't answer. Try again."
            onRetry={() => setTick((t) => t + 1)}
          />
        ) : summary === null ? (
          <NativeLoadingState isLight={isLight} message="Opening your referral hub…" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <code
                className={`rounded-lg px-2.5 py-1.5 text-sm font-black tracking-widest ${
                  isLight ? "bg-[#d4af37]/15 text-[#7A5A12]" : "bg-[#d4af37]/10 text-[#e8c86a]"
                }`}
              >
                {summary.code}
              </code>
              <button type="button" className={chipBtn(isLight)} onClick={copyLink}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Link copied" : "Copy my link"}
              </button>
              <span className={`text-xs ${muted}`}>
                Friends who join through it get {summary.refereeReward} Bucs to start — and you earn{" "}
                {summary.revenueSharePct}% of what they spend for {summary.shareWindowDays} days.
              </span>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <span className={`inline-flex items-center gap-1.5 text-sm ${strong}`}>
                <Users className="h-4 w-4 text-[#d4af37]" /> {summary.totalReferrals} brought in
              </span>
              <span className={`text-sm ${strong}`}>{summary.activeReferrals} earning now</span>
              <span className={`text-sm ${strong}`}>{summary.creditsEarned.toLocaleString()} Bucs earned</span>
            </div>

            <div className="space-y-1">
              <p className={`inline-flex items-center gap-1.5 text-sm font-bold ${strong}`}>
                <Star className="h-4 w-4 text-[#d4af37]" />
                {summary.tier
                  ? `${summary.tier.title} — ${summary.tier.ratePct}% share`
                  : "Your promoter climb starts with your first signup"}
              </p>
              {nextLine ? <p className={`text-xs ${muted}`}>{nextLine}</p> : null}
              <p className={`text-xs ${muted}`}>{rankLine(summary)}</p>
              {summary.tierLadder.length > 0 ? (
                <p className={`text-xs ${muted}`}>
                  The ladder:{" "}
                  {summary.tierLadder
                    .map(
                      (t) =>
                        `${t.title} at ${t.minReferrals}+ (${t.ratePct}%)${
                          summary.claimedMilestones.includes(t.stars) ? " ✓ milestone banked" : ""
                        }`,
                    )
                    .join(" · ")}
                </p>
              ) : null}
            </div>

            {contest && contest.standings.length > 0 ? (
              <div
                data-testid="world-referrals-contest"
                className={`space-y-1 rounded-xl border p-3 ${
                  isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                }`}
              >
                <p className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.12em] ${strong}`}>
                  <Trophy className="h-3.5 w-3.5 text-[#d4af37]" /> This month&rsquo;s contest —{" "}
                  {contest.prizePool.toLocaleString()} Buc pool
                </p>
                {contest.standings.slice(0, 3).map((s) => (
                  <p key={s.rank} className={`text-xs ${muted}`}>
                    #{s.rank} {s.name} — {s.signups} signups
                  </p>
                ))}
                <p className={`text-xs ${muted}`}>
                  {contest.minSignupsToQualify}+ signups qualifies
                  {summary.ranks.monthly !== null
                    ? ` · you stand #${summary.ranks.monthly} this month`
                    : " · bring in your first signup to enter the board"}
                  .
                </p>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <p className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
                <Crown className="h-3.5 w-3.5" /> Your people
              </p>
              {summary.referrals.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message="Nobody's come in on your link yet."
                  detail="Share it anywhere — the first signup starts your climb and your earnings."
                />
              ) : (
                summary.referrals.slice(0, 10).map((p, i) => (
                  <div
                    key={`${p.joinedAt}-${i}`}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 ${
                      isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                    }`}
                  >
                    <span className={`text-xs ${muted}`}>
                      Joined{" "}
                      {p.joinedAt
                        ? new Date(p.joinedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </span>
                    <span className={`text-xs font-bold ${strong}`}>
                      {p.creditsEarned.toLocaleString()} Bucs earned for you
                    </span>
                    <span className={`text-xs ${muted}`}>
                      {p.active ? `${p.daysLeft} days of sharing left` : "Share window closed"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </NativeCard>
  );
}
