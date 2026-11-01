/**
 * live-replay.ts — the honest replay state of an ended stream
 * (stack1100 lane W4). Pure: DTO facts in, one state out.
 *
 * The watch page used to declare "No recording was saved" the
 * moment a stream read as ended. For the site's own stage that was
 * wrong twice over: when a stream ends, the server is still
 * finishing the recording (remux + upload), and the outcome lands
 * on the row afterwards as the site destination's vod_state. The
 * states below are the whole truth the DTO can tell:
 *
 *   available — a replay URL exists; play it.
 *   saving    — own-server stage, no URL yet, no not_saved outcome:
 *               the server is still finishing the recording. It will
 *               resolve to available or none on its own.
 *   pending   — provider stage: the recording is made in the
 *               broadcaster's browser and uploaded from their
 *               studio, so it may still arrive — or may never. Never
 *               promise either way.
 *   none      — the outcome is KNOWN: the site destination recorded
 *               not_saved. Only now may a page say "no recording".
 */

export interface ReplayFacts {
  vod_url: string | null;
  provider: string | null;
  destinations?: Array<{ platform: string; vod_state: string | null }> | null;
}

export type ReplayState =
  | { kind: "available"; url: string }
  | { kind: "saving" }
  | { kind: "pending" }
  | { kind: "none" };

export function replayStateFor(facts: ReplayFacts): ReplayState {
  if (facts.vod_url) return { kind: "available", url: facts.vod_url };
  const site = facts.destinations?.find((d) => d.platform === "site");
  if (site?.vod_state === "not_saved") return { kind: "none" };
  return facts.provider === "own-server" ? { kind: "saving" } : { kind: "pending" };
}
