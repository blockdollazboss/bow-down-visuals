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

export interface UpfrontRuleStrings {
  catalogOnly: string;
  anySong: string;
  minTip: string;
  tipsRun: string;
  notRequestable: string;
}

export const UPFRONT_RULE_DEFAULTS: UpfrontRuleStrings = {
  catalogOnly: "Requests come from this creator's own catalog — the songs listed below.",
  anySong: "Any song in the house catalog can be requested.",
  minTip: "This creator's minimum tip for a request is {{amount}}.",
  tipsRun: "Request tips run {{min}}–{{max}}.",
  notRequestable: "Songs marked “not requestable” have been taken out of requests by the creator.",
};

/** The up-front rule lines, built ONLY from what the server sent. */
export function upfrontRuleLines(rules: RequestRulesDto, tipBounds: { minVb: number; maxVb: number }, strings: UpfrontRuleStrings = UPFRONT_RULE_DEFAULTS): string[] {
  const lines: string[] = [];
  lines.push(rules.catalogOnly ? strings.catalogOnly : strings.anySong);
  if (rules.minTipVb !== null) {
    lines.push(strings.minTip.replace("{{amount}}", formatBucs(rules.minTipVb)));
  }
  lines.push(strings.tipsRun.replace("{{min}}", formatBucs(tipBounds.minVb)).replace("{{max}}", formatBucs(tipBounds.maxVb)));
  if (rules.excludedSongIds.length > 0) {
    lines.push(strings.notRequestable);
  }
  return lines;
}

export interface RequestStatusStrings {
  playing: string;
  inLinePosition: string;
  inLine: string;
  played: string;
  skippedRefunded: string;
  skipped: string;
  endedRefunded: string;
  ended: string;
}

export const REQUEST_STATUS_DEFAULTS: RequestStatusStrings = {
  playing: "Now playing",
  inLinePosition: "#{{position}} in line",
  inLine: "In line",
  played: "Played",
  skippedRefunded: "Skipped by the creator · tip refunded",
  skipped: "Skipped by the creator",
  endedRefunded: "Stream ended before it played · tip refunded",
  ended: "Stream ended before it played",
};

export function requestStatusLabel(r: SongRequestDto, strings: RequestStatusStrings = REQUEST_STATUS_DEFAULTS): string {
  switch (r.status) {
    case "playing":
      return strings.playing;
    case "queued":
      return r.position ? strings.inLinePosition.replace("{{position}}", String(r.position)) : strings.inLine;
    case "played":
      return strings.played;
    case "skipped":
      return r.refunded ? strings.skippedRefunded : strings.skipped;
    case "expired":
      return r.refunded ? strings.endedRefunded : strings.ended;
  }
}
