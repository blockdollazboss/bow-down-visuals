import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Trophy, Share2, Crown } from "lucide-react";
import { ordinal } from "@/lib/visual-bucs";
import BragModal from "@/components/milestones/BragModal";
import {
  tierColor,
  VERTICAL_META,
  type MilestoneAchievement,
  type MilestoneVertical,
} from "@/lib/milestone-thresholds";

/* ─── TrophyShelf — the public, shareable milestones showcase ───────────────
   Mounted on /artist/:slug. Shows every crossed brag threshold (streams,
   followers, earnings, releases) as gold trophy cards. Each trophy has its
   own brag button → the share modal → the virality loop runs from the
   public profile too. Renders nothing when the shelf is empty. */

interface TrophyShelfProps {
  slug: string;
  displayName: string;
  avatarUrl?: string | null;
}

const VERTICAL_ORDER: MilestoneVertical[] = ["streams", "followers", "earnings", "releases"];

interface ChallengeWin {
  place: number; prize_credits: number; announced_at: string;
  challenge_slug: string; challenge_title: string;
}

export default function TrophyShelf({ slug, displayName, avatarUrl }: TrophyShelfProps) {
  const { t } = useTranslation();
  const [achievements, setAchievements] = useState<MilestoneAchievement[] | null>(null);
  const [wins, setWins] = useState<ChallengeWin[] | null>(null);
  const [brag, setBrag] = useState<MilestoneAchievement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/achievements`);
        if (!res.ok) {
          if (!cancelled) setAchievements([]);
          return;
        }
        const data = (await res.json()) as { achievements?: MilestoneAchievement[] };
        if (!cancelled) setAchievements(data.achievements ?? []);
      } catch {
        if (!cancelled) setAchievements([]);
      }
    })();
    /* Challenge engine 2.0: challenge wins live on the same shelf — a crown
       is a crown. Renders nothing when the creator hasn't won any. */
    (async () => {
      try {
        const res = await fetch(`/api/challenges/wins/${encodeURIComponent(slug)}`);
        if (!res.ok) {
          if (!cancelled) setWins([]);
          return;
        }
        const data = (await res.json()) as { wins?: ChallengeWin[] };
        if (!cancelled) setWins(data.wins ?? []);
      } catch {
        if (!cancelled) setWins([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if ((!achievements || achievements.length === 0) && (!wins || wins.length === 0)) return null;

  const groups = VERTICAL_ORDER.map((vertical) => ({
    vertical,
    items: (achievements ?? []).filter((a) => a.vertical === vertical),
  })).filter((g) => g.items.length > 0);

  return (
    <section aria-label={t("milestones.trophyShelf")} className="mx-auto w-full max-w-5xl px-4 pb-10">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15" aria-hidden="true">
          <Trophy className="h-5 w-5 text-primary" />
        </span>
        <div>
          <h2 className="text-xl font-black text-white">{t("milestones.trophyShelf")}</h2>
          <p className="text-xs text-white/50">{t("milestones.trophyShelfSub")}</p>
        </div>
      </div>

      {groups.map(({ vertical, items }) => (
        <div key={vertical} className="mt-6">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/45">
            <span aria-hidden="true">{VERTICAL_META[vertical].emoji}</span>
            {VERTICAL_META[vertical].label}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((a, i) => {
              const color = tierColor(a.tier);
              return (
                <div
                  key={`${a.vertical}-${a.threshold}-${i}`}
                  className="group relative overflow-hidden rounded-2xl border bg-white/[0.02] p-5 transition hover:bg-white/[0.04]"
                  style={{ borderColor: `${color}55` }}
                >
                  <div
                    className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-3xl"
                    style={{ backgroundColor: `${color}22` }}
                    aria-hidden="true"
                  />
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-widest"
                      style={{ borderColor: `${color}88`, color, backgroundColor: `${color}14` }}
                    >
                      {a.tierLabel}
                    </span>
                    <button
                      onClick={() => setBrag(a)}
                      title={t("milestones.bragButton")}
                      aria-label={t("milestones.bragButtonWith", { headline: a.headline })}
                      className="rounded-full border border-white/10 p-2 text-white/50 opacity-0 transition group-hover:opacity-100 hover:border-primary/50 hover:text-primary focus:opacity-100"
                    >
                      <Share2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  <p className="mt-4 text-4xl font-black" style={{ color }}>
                    {a.displayValue}
                  </p>
                  <p className="mt-1 text-sm font-bold uppercase tracking-widest text-white/70">
                    {VERTICAL_META[vertical].unit}
                  </p>
                  <p className="mt-2 truncate text-xs text-white/45" title={a.context}>
                    {a.context}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {brag && (
        <BragModal
          achievement={brag}
          creatorName={displayName}
          avatarUrl={avatarUrl}
          onClose={() => setBrag(null)}
        />
      )}

      {/* Challenge engine 2.0: winners' circle badges on the same shelf */}
      {wins && wins.length > 0 && (
        <div className="mt-6">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/45">
            <span aria-hidden="true">🏆</span>
            Challenge Champion{wins.length > 1 ? "s" : ""} · {wins.length} {wins.length === 1 ? "crown" : "crowns"}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {wins.map((w) => (
              <Link
                key={`${w.challenge_slug}-${w.place}`}
                href={`/challenge/${w.challenge_slug}/winners`}
                className="group relative overflow-hidden rounded-2xl border border-primary/40 bg-primary/[0.04] p-5 transition hover:bg-primary/[0.08]"
              >
                <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
                <div className="flex items-start justify-between gap-2">
                  <span className="rounded-full border border-primary/60 bg-primary/15 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-primary">
                    {w.place === 1 ? "Champion" : w.place === 2 ? "Runner-up" : `${ordinal(w.place)} place`}
                  </span>
                  <Crown className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <p className="mt-4 truncate text-lg font-black text-white" title={w.challenge_title}>
                  {w.challenge_title}
                </p>
                {w.prize_credits > 0 && (
                  <p className="mt-1 text-sm font-bold text-primary">
                    {w.prize_credits.toLocaleString("en-US")} Visual Bucs won
                  </p>
                )}
                <p className="mt-2 text-xs text-white/45 group-hover:text-primary">
                  See the winners' circle →
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
