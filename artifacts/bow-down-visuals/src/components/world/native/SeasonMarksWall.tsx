import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { CrownsChamber } from "./CrownsChamber";

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
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      {standings.map((s) => (
        <NativeBoardRow
          key={s.userId}
          isLight={isLight}
          highlighted={s.place === 1}
          title={`${s.place}. ${s.displayName}`}
          detail={`★${s.stars} ${s.title}`}
          meta={t("worldBoards.smPoints", { points: s.points })}
          action={
            s.place === 1 ? (
              <Crown className="h-4 w-4 shrink-0 text-[#d4af37]" aria-label={t("worldBoards.smFirstAria")} />
            ) : (
              <Medal
                className={`h-4 w-4 shrink-0 ${frozen ? "text-[#d4af37]/80" : "text-[#d4af37]/50"}`}
                aria-label={t("worldBoards.smPlacedAria", { place: s.place })}
              />
            )
          }
        />
      ))}
    </div>
  );
}

export function SeasonMarksWall({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const [wall, setWall] = useState<CourtSeasonWallData | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchCourtSeasonWall(undefined, {
      fallbackTitle: t("worldBoards.smFallbackTitle"),
      fallbackSeasonName: t("worldBoards.smFallbackSeasonName"),
    })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  if (failed) {
    return (
      <NativeErrorState
        isLight={isLight}
        title={t("worldBoards.smLoadTitle")}
        message={t("worldBoards.smLoadMessage")}
        onRetry={() => setTick((n) => n + 1)}
      />
    );
  }
  if (wall === null) {
    return <NativeLoadingState isLight={isLight} message={t("worldBoards.smLoading")} />;
  }

  const { current, seasons } = wall;
  return (
    <div className="space-y-4">
      <NativeBoard
        isLight={isLight}
        title={t("worldBoards.smRunningTitle", { name: seasonDisplayName(current) })}
        headline={
          <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            {t("worldBoards.smRunningHeadline", {
              turn: seasonTurnLabel(current.endsAt, i18n.language, {
                turn: (date) => t("worldBoards.smTurnsOn", { date }),
              }),
            })}
          </p>
        }
      >
        {current.standings.length > 0 ? (
          <StandingRows standings={current.standings} isLight={isLight} frozen={false} />
        ) : (
          <NativeEmptyState
            isLight={isLight}
            message={t("worldBoards.smCurrentEmpty")}
            detail={t("worldBoards.smCurrentEmptyDetail")}
          />
        )}
      </NativeBoard>

      {seasons.map((season) => (
        <NativeBoard
          key={season.seasonKey}
          isLight={isLight}
          title={t("worldBoards.smSettledTitle", { name: seasonDisplayName(season) })}
          headline={
            season.standings.length > 0 ? (
              <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                {t("worldBoards.smSettledHeadline")}
              </p>
            ) : undefined
          }
        >
          {season.standings.length > 0 ? (
            <StandingRows standings={season.standings} isLight={isLight} frozen />
          ) : (
            <NativeEmptyState
              isLight={isLight}
              message={t("worldBoards.smSettledEmpty")}
              detail={t("worldBoards.smSettledEmptyDetail")}
            />
          )}
        </NativeBoard>
      ))}

      {seasons.length === 0 && (
        <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          {t("worldBoards.smNoSettled", { name: current.name })}
        </p>
      )}
      <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        {t("worldBoards.smHonorNote")}
      </p>

      <CrownsChamber isLight={isLight} />
    </div>
  );
}
