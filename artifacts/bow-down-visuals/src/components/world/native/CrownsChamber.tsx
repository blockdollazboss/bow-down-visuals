import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t, i18n } = useTranslation();
  const [read, setRead] = useState<CrownsRead | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchCrownsRead(undefined, {
      yearName: (year) => t("worldCreatorRooms.crownsYearFallback", { year }),
    })
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
        title={t("worldCreatorRooms.crownsLoadTitle")}
        message={t("worldCreatorRooms.crownsLoadMessage")}
        onRetry={() => setTick((n) => n + 1)}
      />
    );
  }
  if (read === null) {
    return <NativeLoadingState isLight={isLight} message={t("worldCreatorRooms.crownsReading")} />;
  }

  const { current, years } = read;
  const headline =
    current.leaders.find((c) => c.key === "creator-of-the-year") ??
    current.leaders.find((c) => c.leaders.length > 0);

  return (
    <div className="space-y-4">
      <NativeBoard
        isLight={isLight}
        title={t("worldCreatorRooms.crownsChaseTitle", { name: current.name })}
        headline={
          <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            {t("worldCreatorRooms.crownsChaseIntro")}
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
                meta={`${l.metric.toLocaleString(i18n.language)} ${headline.metricLabel}`}
                action={
                  i === 0 ? (
                    <Swords className="h-4 w-4 shrink-0 text-[#d4af37]" aria-label={t("worldCreatorRooms.crownsLeadingAria")} />
                  ) : undefined
                }
              />
            ))}
          </div>
        ) : (
          <NativeEmptyState
            isLight={isLight}
            message={t("worldCreatorRooms.crownsEmptyTitle")}
            detail={t("worldCreatorRooms.crownsEmptyDetail")}
          />
        )}
      </NativeBoard>

      {years.map((year) => {
        const crowned = crownedAwards(year);
        return (
          <NativeBoard
            key={year.crownKey}
            isLight={isLight}
            title={t("worldCreatorRooms.crownsDecidedTitle", { name: year.name })}
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
                    meta={crownMetricLabel(a, i18n.language)}
                    action={
                      <Crown className="h-4 w-4 shrink-0 text-[#d4af37]" aria-label={t("worldCreatorRooms.crownsCrownedAria")} />
                    }
                  />
                ))}
              </div>
            ) : (
              <NativeEmptyState
                isLight={isLight}
                message={t("worldCreatorRooms.crownsNobodyTitle")}
                detail={t("worldCreatorRooms.crownsNobodyDetail")}
              />
            )}
          </NativeBoard>
        );
      })}

      {years.length === 0 && (
        <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          {t("worldCreatorRooms.crownsNoneDecided", { name: current.name })}
        </p>
      )}
      <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        {t("worldCreatorRooms.crownsNoMoney")}
      </p>
    </div>
  );
}
