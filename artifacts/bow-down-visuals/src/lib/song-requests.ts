import { formatBucs } from "@/lib/visual-bucs";

/* ─── Song Requests, Live (Stack-200 N18) — shared surface types +
   pure copy helpers. The docked components (components/live/
   SongRequests.tsx) render these; the words are built ONLY from what
   the server sent — no invented minimums, no suggested amounts. */

export interface RequestRulesDto {
  requestsOpen: boolean;
  catalogOnly: boolean;
  excludedSongIds: string[];
  minTipVb: number | null;
}
export interface CatalogSongDto {
  id: string;
  title: string;
  durationSec: string | null;
  excluded: boolean;
}
export interface SongRequestDto {
  id: string;
  streamId: string;
  songId: string | null;
  songTitle: string;
  amountVb: number;
  status: "queued" | "playing" | "played" | "skipped" | "expired";
  position: number | null;
  fanUserId: string;
  fan: { displayName: string; avatarUrl: string | null; slug: string | null };
  refunded: boolean;
  createdAt: string;
  playedAt: string | null;
}
export interface QueuePayload {
  streamId: string;
  available: boolean;
  rules: RequestRulesDto;
  refundCopy: string;
  tipBounds: { minVb: number; maxVb: number };
  catalog: CatalogSongDto[];
  queue: SongRequestDto[];
}

/** The up-front rule lines, built ONLY from what the server sent. */
export function upfrontRuleLines(rules: RequestRulesDto, tipBounds: { minVb: number; maxVb: number }): string[] {
  const lines: string[] = [];
  lines.push(
    rules.catalogOnly
      ? "Requests come from this creator's own catalog — the songs listed below."
      : "Any song in the house catalog can be requested.",
  );
  if (rules.minTipVb !== null) {
    lines.push(`This creator's minimum tip for a request is ${formatBucs(rules.minTipVb)}.`);
  }
  lines.push(`Request tips run ${formatBucs(tipBounds.minVb)}–${formatBucs(tipBounds.maxVb)}.`);
  if (rules.excludedSongIds.length > 0) {
    lines.push("Songs marked “not requestable” have been taken out of requests by the creator.");
  }
  return lines;
}

export function requestStatusLabel(r: SongRequestDto): string {
  switch (r.status) {
    case "playing":
      return "Now playing";
    case "queued":
      return r.position ? `#${r.position} in line` : "In line";
    case "played":
      return "Played";
    case "skipped":
      return r.refunded ? "Skipped by the creator · tip refunded" : "Skipped by the creator";
    case "expired":
      return r.refunded ? "Stream ended before it played · tip refunded" : "Stream ended before it played";
  }
}
