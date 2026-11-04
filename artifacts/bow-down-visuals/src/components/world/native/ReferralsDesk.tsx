import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Crown, Star, Trophy, Users } from "lucide-react";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native/NativeStates";
import { useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import {
  REFERRALS_CONTEST_PATH,
  REFERRALS_ME_PATH,
  nextTierLine,
  normalizeReferralContest,
  normalizeReferralSummary,
  rankLine,
  referralLink,
  referralNextTierStrings,
  referralRankStrings,
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
  const { t, i18n } = useTranslation();
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
        const parsed = normalizeReferralContest(await res.json(), t("worldLivePromo.referralAnonymous"));
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

  const nextLine = summary ? nextTierLine(summary, referralNextTierStrings(t)) : null;

  return (
    <NativeCard isLight={isLight} title={t("worldLivePromo.referralTitle")}>
      <div data-testid="world-referrals-desk" className="space-y-3">
        {loadFailed ? (
          <NativeErrorState
            isLight={isLight}
            title={t("worldLivePromo.referralErrorTitle")}
            message={t("worldLivePromo.referralErrorMessage")}
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : summary === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldLivePromo.referralLoading")} />
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
                {copied ? t("worldLivePromo.referralLinkCopied") : t("worldLivePromo.referralCopyLink")}
              </button>
              <span className={`text-xs ${muted}`}>
                {t("worldLivePromo.referralRewardLine", { reward: summary.refereeReward, pct: summary.revenueSharePct, days: summary.shareWindowDays })}
              </span>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <span className={`inline-flex items-center gap-1.5 text-sm ${strong}`}>
                <Users className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.referralBroughtIn", { total: summary.totalReferrals })}
              </span>
              <span className={`text-sm ${strong}`}>{t("worldLivePromo.referralEarningNow", { active: summary.activeReferrals })}</span>
              <span className={`text-sm ${strong}`}>{t("worldLivePromo.referralBucsEarned", { amount: summary.creditsEarned.toLocaleString(i18n.language) })}</span>
            </div>

            <div className="space-y-1">
              <p className={`inline-flex items-center gap-1.5 text-sm font-bold ${strong}`}>
                <Star className="h-4 w-4 text-[#d4af37]" />
                {summary.tier
                  ? t("worldLivePromo.referralTierLine", { title: summary.tier.title, rate: summary.tier.ratePct })
                  : t("worldLivePromo.referralTierStart")}
              </p>
              {nextLine ? <p className={`text-xs ${muted}`}>{nextLine}</p> : null}
              <p className={`text-xs ${muted}`}>{rankLine(summary, referralRankStrings(t))}</p>
              {summary.tierLadder.length > 0 ? (
                <p className={`text-xs ${muted}`}>
                  {t("worldLivePromo.referralLadderLine", {
                    list: summary.tierLadder
                      .map(
                        (tier) =>
                          `${t("worldLivePromo.referralLadderItem", { title: tier.title, min: tier.minReferrals, rate: tier.ratePct })}${
                            summary.claimedMilestones.includes(tier.stars) ? t("worldLivePromo.referralLadderBanked") : ""
                          }`,
                      )
                      .join(" · "),
                  })}
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
                  <Trophy className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldLivePromo.referralContestTitle", { pool: contest.prizePool.toLocaleString(i18n.language) })}
                </p>
                {contest.standings.slice(0, 3).map((s) => (
                  <p key={s.rank} className={`text-xs ${muted}`}>
                    {t("worldLivePromo.referralStandingLine", { rank: s.rank, name: s.name, signups: s.signups })}
                  </p>
                ))}
                <p className={`text-xs ${muted}`}>
                  {t("worldLivePromo.referralQualify", { min: contest.minSignupsToQualify })}
                  {summary.ranks.monthly !== null
                    ? t("worldLivePromo.referralYouStand", { rank: summary.ranks.monthly })
                    : t("worldLivePromo.referralBringFirst")}
                </p>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <p className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
                <Crown className="h-3.5 w-3.5" /> {t("worldLivePromo.referralPeopleTitle")}
              </p>
              {summary.referrals.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message={t("worldLivePromo.referralEmpty")}
                  detail={t("worldLivePromo.referralEmptyDetail")}
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
                      {t("worldLivePromo.referralJoined", {
                        date: p.joinedAt
                          ? new Date(p.joinedAt).toLocaleDateString(i18n.language, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—",
                      })}
                    </span>
                    <span className={`text-xs font-bold ${strong}`}>
                      {t("worldLivePromo.referralEarnedForYou", { amount: p.creditsEarned.toLocaleString(i18n.language) })}
                    </span>
                    <span className={`text-xs ${muted}`}>
                      {p.active ? t("worldLivePromo.referralDaysLeft", { days: p.daysLeft }) : t("worldLivePromo.referralWindowClosed")}
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
