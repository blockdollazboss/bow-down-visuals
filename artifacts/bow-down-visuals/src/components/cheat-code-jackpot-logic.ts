/**
 * cheat-code-jackpot-logic.ts — pure, testable helpers for the Cheat Code
 * Jackpot event UI. No JSX, no React — safe for the node-only vitest setup.
 */

export type JackpotPhase = "live" | "claimed" | "upcoming" | "ended" | "none";

export interface JackpotStatus {
  phase: JackpotPhase;
  name?: string;
  prizeCredits?: number;
  codeLength?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  resetsAt?: string | null;
  winnerDisplayName?: string | null;
  claimedAt?: string | null;
}

export type Direction = "up" | "down" | "left" | "right";

export const ARROW_TO_DIR: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export const DIR_GLYPH: Record<Direction, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

/** Rolling input buffer capped at the code length. */
export function rollBuffer(
  buffer: Direction[],
  dir: Direction,
  max: number,
): Direction[] {
  return [...buffer, dir].slice(-Math.max(1, max));
}

/** "2027-03-24T…" -> "Mar 24, 2027". */
export function formatJackpotDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
