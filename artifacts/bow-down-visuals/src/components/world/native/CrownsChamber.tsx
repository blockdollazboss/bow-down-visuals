import { useEffect, useState } from "react";
import { Crown, Swords } from "lucide-react";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  fetchCrownsRead,
  crownedAwards,
  crownMetricLabel,
  type CrownsRead,
} from "@/lib/the-crowns";

/* ─── The Crowns Chamber (N8 — the yearly house awards) ──────────
   The Royal Court Chamber's yearly record, docked under the
   Season Marks Wall: every decided year's crowned winners (the
   published categories, decided by the year's real platform
   records and frozen at the turn) and the running year's chase
   above them. The read is public — GET /api/crowns needs no
   sign-in — so a guest sees exactly the chamber a member sees.
   One fetch, three honest states (loading / failed + retry /
   the record itself); a year that crowned nobody says so. */

export function CrownsChamber({ isLight }: { isLight: boolean }) {
  const [read, setRead] = useState<CrownsRead | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchCrownsRead()
      .then((data) => {
        if (!cancelled) {
          if (data) setRead(data);
          else setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  if (failed) {
    return (
      <NativeErrorState
        isLight={isLight}
        title="The crowns wouldn't load"
        message="The decided years are safe — the reading lamp slipped. Try again."
        onRetry={() => setTick((n) => n + 1)}
      />
    );
  }
  if (read === null) {
    return <NativeLoadingState isLight={isLight} message="Reading the crowns…" />;
  }

  const { current, years } = read;
  const headline =
    current.leaders.find((c) => c.key === "creator-of-the-year") ??
    current.leaders.find((c) => c.leaders.length > 0);

  return (
    <div className="space-y-4">
      <NativeBoard
        isLight={isLight}
        title={`${current.name} — the chase`}
        headline={
          <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            The year&rsquo;s live leaders for Creator of the Year. Every published category is
            decided by the year&rsquo;s real records at the turn — no votes, no estimates — and
            the winners wear their crowns on their profiles for the year.
          </p>
        }
      >
        {headline && headline.leaders.length > 0 ? (
          <div className="space-y-1.5">
            {headline.leaders.map((l, i) => (
              <NativeBoardRow
                key={l.userId}
                isLight={isLight}
                highlighted={i === 0}
                title={`${i + 1}. ${l.displayName}`}
                detail={headline.title}
                meta={`${l.metric.toLocaleString("en-US")} ${headline.metricLabel}`}
                action={
                  i === 0 ? (
                    <Swords className="h-4 w-4 shrink-0 text-[#d4af37]" aria-label="Leading the chase" />
                  ) : undefined
                }
              />
            ))}
          </div>
        ) : (
          <NativeEmptyState
            isLight={isLight}
            message="The year's court is scoreless — so far."
            detail="Publish, sell, stream and gather tips this year and the chase fills. The crowns are earned, never given."
          />
        )}
      </NativeBoard>

      {years.map((year) => {
        const crowned = crownedAwards(year);
        return (
          <NativeBoard
            key={year.crownKey}
            isLight={isLight}
            title={`${year.name} — decided`}
            headline={
              year.heraldText ? (
                <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                  {year.heraldText}
                </p>
              ) : undefined
            }
          >
            {crowned.length > 0 ? (
              <div className="space-y-1.5">
                {crowned.map((a) => (
                  <NativeBoardRow
                    key={a.category}
                    isLight={isLight}
                    highlighted
                    title={`${a.categoryTitle} — ${a.displayName}`}
                    detail={`★${a.stars} ${a.title}`}
                    meta={crownMetricLabel(a)}
                    action={
                      <Crown className="h-4 w-4 shrink-0 text-[#d4af37]" aria-label="Crowned" />
                    }
                  />
                ))}
              </div>
            ) : (
              <NativeEmptyState
                isLight={isLight}
                message="This year crowned nobody — the court scored nothing."
                detail="The year still decided; its record stands honestly empty."
              />
            )}
          </NativeBoard>
        );
      })}

      {years.length === 0 && (
        <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          No year has been decided yet — the first crowns are placed when {current.name} turns.
        </p>
      )}
      <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        Crowns are honor, not money: decided by published works, exports, followers, streams,
        tips, sales and memberships across the year. No Visual Bucs change hands in this chamber.
      </p>
    </div>
  );
}
