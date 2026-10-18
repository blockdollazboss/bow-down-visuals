import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Target, Flame, Crown, LogIn, Compass, Coins } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  destinationLabel,
  directorySlate,
  formatEventStart,
  mergeSlates,
  nextObjective,
  nextStreakStep,
  normalizeQuestsStatus,
  normalizeStreakStatus,
  normalizeWorldEventSlate,
  pickPalaceSlot,
  type PalaceSlateEvent,
  type QuestsStatusShape,
  type StreakStatusShape,
} from "@/lib/world/objective-strip";
import { QUEST_DISPLAY } from "@/lib/world/treasury-quests";
import { PALACE_LAYOUT } from "@/lib/world/palace-layout";
import {
  fetchWorldEvents,
  type PalaceDirectoryEntry,
  type WorldKingMomentState,
} from "@/lib/world/world-client";
import { kingStripLine } from "@/lib/world/king-moment";
import {
  GUEST_SIGN_IN_HREF,
  GUEST_SPEAK_PITCH,
  stripSlotsFor,
} from "@/lib/world/guest-honest";

/* ─── The Objective Strip (THE-GAME §5(a), Lane K2) ────────────────
   Always pinned in the world chrome, across every room: the next
   thing, named — never an empty strip. Three slots for members,
   each read off the server rail it belongs to:
     QUEST  — /api/retention/quests (Lane B's rails)
     STREAK — /api/retention/streak (the creation-streak rail)
     PALACE — Lane H's slate (GET /api/world/events + the
              directory frame's events[])
   Guests hold no hand: they see ONLY the palace slot (public
   information) plus the sign-in pitch — no quest slot, no streak
   slot, nothing personal, nothing to claim. */

const REFRESH_MS = 60_000;

export function ObjectiveStrip({
  isLight,
  isGuest,
  directory,
  kingMoment,
  tutorialLine,
  onTutorialClaim,
  tutorialClaimBusy,
}: {
  isLight: boolean;
  isGuest: boolean;
  directory: PalaceDirectoryEntry[];
  /** The King's daily moment (Ring 3), mirrored by the page from
   *  the world client — while its window stands in the hall, the
   *  strip carries the king line ahead of the palace slot. Null
   *  (or past its deadline) renders no king chip at all. */
  kingMoment?: WorldKingMomentState | null;
  /** "Your First 10 Minutes" (Ring 3, Phase 6): while the member's
   *  quest line stands, its chip leads the strip — a new member's
   *  next step outranks the weekly quest summary, which returns
   *  when the line completes and its reward is claimed (or when
   *  no status has loaded). Members only; guests never see it. */
  tutorialLine?: string | null;
  /** The completed line's claim action, shown beside the line. */
  onTutorialClaim?: () => void;
  tutorialClaimBusy?: boolean;
}) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const slots = stripSlotsFor(isGuest);
  const [quests, setQuests] = useState<QuestsStatusShape | null>(null);
  const [questsFailed, setQuestsFailed] = useState(false);
  const [streak, setStreak] = useState<StreakStatusShape | null>(null);
  const [streakFailed, setStreakFailed] = useState(false);
  const [restEvents, setRestEvents] = useState<PalaceSlateEvent[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setNowMs(Date.now());
      /* The palace slate is public — everyone reads it, guests too. */
      try {
        const events = await fetchWorldEvents();
        if (!cancelled) setRestEvents(normalizeWorldEventSlate(events));
      } catch {
        /* The directory slate below still speaks for the palace. */
      }
      if (isGuest) return;
      try {
        const token = await getAccessToken().catch(() => null);
        const headers: Record<string, string> = token
          ? { Authorization: `Bearer ${token}` }
          : {};
        const [qRes, sRes] = await Promise.all([
          fetch("/api/retention/quests", { headers }),
          fetch("/api/retention/streak", { headers }),
        ]);
        if (!cancelled) {
          if (qRes.ok) {
            const shaped = normalizeQuestsStatus(await qRes.json());
            if (shaped) {
              setQuests(shaped);
              setQuestsFailed(false);
            } else setQuestsFailed(true);
          } else setQuestsFailed(true);
          if (sRes.ok) {
            const shaped = normalizeStreakStatus(await sRes.json());
            if (shaped) {
              setStreak(shaped);
              setStreakFailed(false);
            } else setStreakFailed(true);
          } else setStreakFailed(true);
        }
      } catch {
        if (!cancelled) {
          setQuestsFailed(true);
          setStreakFailed(true);
        }
      }
    };
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  const palaceSlot = useMemo(() => {
    const merged = mergeSlates(restEvents, directorySlate(directory));
    return pickPalaceSlot(merged, nowMs);
  }, [restEvents, directory, nowMs]);

  const roomNameFor = (roomId: string): string => {
    const fromDirectory = directory.find((r) => r.id === roomId)?.name;
    if (fromDirectory) return fromDirectory;
    return PALACE_LAYOUT[roomId]?.name ?? "the palace";
  };

  const questTitle = (key: string): string => {
    const display = QUEST_DISPLAY[key];
    return display ? t(display.titleKey) : key;
  };

  const slotCls = `inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
    isLight
      ? "border-[#C9A84C]/50 bg-white/60 text-[#6B5B36]"
      : "border-white/10 bg-white/5 text-white/65"
  }`;
  const labelCls = `inline-flex shrink-0 items-center gap-1 text-[10px] font-black uppercase tracking-[0.12em] ${
    isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
  }`;

  const questSlot = () => {
    if (questsFailed) {
      return (
        <span>
          Your quests wouldn&rsquo;t answer — the Treasury board holds them.
        </span>
      );
    }
    if (!quests) return <span>Reading your quests…</span>;
    const next = nextObjective(quests);
    switch (next.kind) {
      case "claimable":
        return (
          <span>
            <strong>{questTitle(next.quest.key)}</strong> is done —{" "}
            {next.objective.progress} of {next.objective.target}. Claim its{" "}
            {next.quest.reward.toLocaleString("en-US")} VB in the Treasury.
          </span>
        );
      case "active":
        return (
          <span>
            <strong>{questTitle(next.quest.key)}</strong> — {next.objective.progress} of{" "}
            {next.objective.target}, at {destinationLabel(next.destination)}
            {next.quest.reward > 0
              ? ` · ${next.quest.reward.toLocaleString("en-US")} VB`
              : ""}
          </span>
        );
      case "all-done":
        return (
          <span>
            All of this week&rsquo;s quests are done — the next slate lands Monday.
          </span>
        );
      case "off":
        return (
          <span>Quests are switched off in your settings — the Treasury board can switch them back on.</span>
        );
      case "none":
        return <span>No quests on this week&rsquo;s slate.</span>;
    }
  };

  const streakSlot = () => {
    if (streakFailed) {
      return <span>Your streak wouldn&rsquo;t answer — the Treasury board holds it.</span>;
    }
    if (!streak) return <span>Reading your streak…</span>;
    const step = nextStreakStep(streak);
    switch (step.kind) {
      case "claimable":
        return (
          <span>
            {step.currentStreak}-day streak — the {step.milestone.days}-day milestone is
            reached: {step.milestone.reward.toLocaleString("en-US")} VB waiting in the
            Treasury.
          </span>
        );
      case "upcoming":
        return (
          <span>
            {step.currentStreak}-day streak — next milestone {step.milestone.days} days,{" "}
            {step.milestone.reward.toLocaleString("en-US")} VB ({step.daysToGo}{" "}
            {step.daysToGo === 1 ? "day" : "days"} to go).
          </span>
        );
      case "all-claimed":
        return (
          <span>
            {step.currentStreak}-day streak — every milestone claimed. Keep it alive.
          </span>
        );
      case "off":
        return <span>Streaks are switched off in your settings.</span>;
    }
  };

  const palaceSlotContent = () => {
    switch (palaceSlot.kind) {
      case "live":
        return (
          <span>
            <span className="inline-flex items-center gap-1 font-black text-red-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> LIVE
            </span>{" "}
            <strong>{palaceSlot.event.title}</strong> — {roomNameFor(palaceSlot.event.roomId)}
            {palaceSlot.event.hostName ? ` · ${palaceSlot.event.hostName}` : ""}
          </span>
        );
      case "next":
        return (
          <span>
            Next: <strong>{palaceSlot.event.title}</strong> —{" "}
            {roomNameFor(palaceSlot.event.roomId)},{" "}
            {formatEventStart(palaceSlot.event.startsAt, nowMs)}
          </span>
        );
      case "none":
        return <span>Nothing on the palace slate</span>;
    }
  };

  return (
    <div
      className={`relative z-20 flex flex-wrap items-center gap-1.5 border-b px-4 py-2 ${
        isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9]" : "border-[#d4af37]/25 bg-[#070605]"
      }`}
      data-testid="world-objective-strip"
    >
      <span
        className={`mr-1 text-[11px] font-black uppercase tracking-[0.14em] ${
          isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
        }`}
      >
        Your next things
      </span>
      {!isGuest && tutorialLine && (
        <span className={slotCls} data-testid="world-objective-tutorial">
          <span className={labelCls}>
            <Compass className="h-3 w-3" /> Tutorial
          </span>
          <span>{tutorialLine}</span>
          {onTutorialClaim && (
            <button
              type="button"
              onClick={onTutorialClaim}
              disabled={tutorialClaimBusy}
              data-testid="world-objective-tutorial-claim"
              className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-2.5 py-0.5 text-[11px] font-bold text-black transition hover:scale-105 disabled:opacity-50"
            >
              <Coins className="h-3 w-3" />{" "}
              {tutorialClaimBusy ? "Claiming…" : "Claim"}
            </button>
          )}
        </span>
      )}
      {slots.quest && !tutorialLine && (
        <span className={slotCls} data-testid="world-objective-quest">
          <span className={labelCls}>
            <Target className="h-3 w-3" /> Quest
          </span>
          {questSlot()}
        </span>
      )}
      {slots.streak && (
        <span className={slotCls} data-testid="world-objective-streak">
          <span className={labelCls}>
            <Flame className="h-3 w-3" /> Streak
          </span>
          {streakSlot()}
        </span>
      )}
      {kingStripLine(kingMoment ?? null, nowMs, isGuest) && (
        <span className={slotCls} data-testid="world-objective-king">
          <span className={labelCls}>
            <Crown className="h-3 w-3" /> King
          </span>
          <span>{kingStripLine(kingMoment ?? null, nowMs, isGuest)}</span>
        </span>
      )}
      {slots.palace && (
        <span className={slotCls} data-testid="world-objective-palace">
          <span className={labelCls}>
            <Crown className="h-3 w-3" /> Palace
          </span>
          {palaceSlotContent()}
        </span>
      )}
      {isGuest && (
        <span
          className={`inline-flex items-center gap-2 text-xs font-semibold ${
            isLight ? "text-[#6B5B36]" : "text-white/55"
          }`}
          data-testid="world-objective-guest-pitch"
        >
          {GUEST_SPEAK_PITCH}
          <Link
            href={GUEST_SIGN_IN_HREF}
            className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-1 text-xs font-bold text-black transition hover:scale-105"
          >
            <LogIn className="h-3 w-3" /> Sign in
          </Link>
        </span>
      )}
    </div>
  );
}
