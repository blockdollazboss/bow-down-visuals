import { useEffect, useState } from "react";
import { Crown, Medal } from "lucide-react";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  fetchCourtSeasonWall,
  seasonDisplayName,
  seasonTurnLabel,
  type CourtSeasonStanding,
  type CourtSeasonWall as CourtSeasonWallData,
} from "@/lib/world/court-season";

/* ─── The Season Marks Wall (Ring 4 — court seasons) ───────────────
   The Royal Court Chamber's collectible record: every settled
   season's frozen final standings as marks (who placed, which
   season, with the earned rank they held at the turn), and the
   running season's live top of the court above them. The read is
   public — GET /api/world/court-season needs no sign-in — so a
   guest sees exactly the wall a member sees: standings are public
   spectacle, and no mark here is a balance. One fetch, three
   honest states (loading / failed + retry / the wall itself);
   an empty stretch of wall says so in plain words. */

function StandingRows({
  standings,
  isLight,
  frozen,
}: {
  standings: CourtSeasonStanding[];
  isLight: boolean;
  frozen: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {standings.map((s) => (
        <NativeBoardRow
          key={s.userId}
          isLight={isLight}
          highlighted={s.place === 1}
          title={`${s.place}. ${s.displayName}`}
          detail={`★${s.stars} ${s.title}`}
          meta={`${s.points} pts`}
          action={
            s.place === 1 ? (
              <Crown className="h-4 w-4 shrink-0 text-[#d4af37]" aria-label="First of the court" />
            ) : (
              <Medal
                className={`h-4 w-4 shrink-0 ${frozen ? "text-[#d4af37]/80" : "text-[#d4af37]/50"}`}
                aria-label={`Placed ${s.place}`}
              />
            )
          }
        />
      ))}
    </div>
  );
}

export function SeasonMarksWall({ isLight }: { isLight: boolean }) {
  const [wall, setWall] = useState<CourtSeasonWallData | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchCourtSeasonWall()
      .then((data) => {
        if (!cancelled) {
          if (data) setWall(data);
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
        title="The marks wall wouldn't load"
        message="The carved seasons are safe — the reading lamp slipped. Try again."
        onRetry={() => setTick((n) => n + 1)}
      />
    );
  }
  if (wall === null) {
    return <NativeLoadingState isLight={isLight} message="Reading the marks…" />;
  }

  const { current, seasons } = wall;
  return (
    <div className="space-y-4">
      <NativeBoard
        isLight={isLight}
        title={`The running season — ${seasonDisplayName(current)}`}
        headline={
          <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            Live standings — the ladder&rsquo;s points over this season&rsquo;s work.{" "}
            {seasonTurnLabel(current.endsAt)}; at the turn the court settles and these become marks.
          </p>
        }
      >
        {current.standings.length > 0 ? (
          <StandingRows standings={current.standings} isLight={isLight} frozen={false} />
        ) : (
          <NativeEmptyState
            isLight={isLight}
            message="The court is scoreless this season — so far."
            detail="The first marks are earned, never given: publish, sell, stream, gather tips inside the season and the wall fills."
          />
        )}
      </NativeBoard>

      {seasons.map((season) => (
        <NativeBoard
          key={season.seasonKey}
          isLight={isLight}
          title={`${seasonDisplayName(season)} — settled`}
          headline={
            season.standings.length > 0 ? (
              <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                The final court, frozen at the turn — these marks do not move.
              </p>
            ) : undefined
          }
        >
          {season.standings.length > 0 ? (
            <StandingRows standings={season.standings} isLight={isLight} frozen />
          ) : (
            <NativeEmptyState
              isLight={isLight}
              message="No marks this season — the court scored nothing."
              detail="The season still settled; its wall stands honestly empty."
            />
          )}
        </NativeBoard>
      ))}

      {seasons.length === 0 && (
        <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          No season has settled yet — the first marks are carved when {current.name} turns.
        </p>
      )}
      <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        Marks are honor, not money: earned by published work, exports, followers, streams, tips,
        sales and memberships during the season. No Visual Bucs change hands on this wall.
      </p>
    </div>
  );
}
