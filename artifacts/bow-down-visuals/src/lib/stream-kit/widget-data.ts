/**
 * widget-data.ts — the live data overlay widget sources render from.
 *
 * The studio polls GET /api/live/:id/widgets while a stream is live
 * and parks the DTO here; the stage's draw loop reads it each frame.
 * Widgets render REAL data only: when a widget has nothing real to
 * show, widgetLines returns null and the stage draws nothing — the
 * program output stays clean, while the studio panel (which reads
 * the same DTO over React state) shows the honest empty state.
 */
import type { WidgetKind } from "./scenes";

export interface WidgetTip {
  tipperName: string;
  amountVb: number;
  createdAt: string;
}

export interface WidgetData {
  latestFollower: { displayName: string; slug: string | null; followedAt: string } | null;
  recentTips: WidgetTip[];
  goal: { goalVb: number | null; totalVb: number; tipCount: number };
}

export const EMPTY_WIDGET_DATA: WidgetData = {
  latestFollower: null,
  recentTips: [],
  goal: { goalVb: null, totalVb: 0, tipCount: 0 },
};

let current: WidgetData = EMPTY_WIDGET_DATA;

export function setWidgetData(data: WidgetData): void {
  current = data;
}

export function getWidgetData(): WidgetData {
  return current;
}

export function resetWidgetData(): void {
  current = EMPTY_WIDGET_DATA;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Goal progress 0..1, or null when no goal is set. */
export function goalProgress(data: WidgetData): number | null {
  const goal = data.goal.goalVb;
  if (!goal || goal <= 0) return null;
  return Math.min(1, Math.max(0, data.goal.totalVb / goal));
}

/**
 * The lines a widget draws right now, or null for "draw nothing"
 * (no real data). `tickSeconds` drives the tip ticker's rotation so
 * the draw loop stays the only clock.
 */
export function widgetLines(kind: WidgetKind, data: WidgetData, tickSeconds = 0): string[] | null {
  switch (kind) {
    case "latest-follower": {
      if (!data.latestFollower) return null;
      return [`Latest follower`, data.latestFollower.displayName];
    }
    case "tip-ticker": {
      if (!data.recentTips.length) return null;
      const idx = Math.floor(tickSeconds / 4) % data.recentTips.length;
      const tip = data.recentTips[idx]!;
      return [`${tip.tipperName} tipped ${fmt(tip.amountVb)} Visual Bucs`];
    }
    case "goal-bar": {
      const progress = goalProgress(data);
      if (progress === null) return null;
      return [
        `Tip goal: ${fmt(data.goal.totalVb)} / ${fmt(data.goal.goalVb!)} Visual Bucs`,
        `${Math.round(progress * 100)}%`,
      ];
    }
  }
}
