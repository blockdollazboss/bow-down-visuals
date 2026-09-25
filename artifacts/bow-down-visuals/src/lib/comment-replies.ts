/* Pure helpers for the Comment Reply Assistant (/comment-replies).
   Kept in a lib module so they are unit-testable without React. */

export const MAX_COMMENTS = 10;
export const HISTORY_LIMIT = 20;
export const HISTORY_KEY = "bdv-comment-replies-history";

export type ToneKey = "hype" | "grateful" | "playful" | "professional";

export interface ReplyBatch {
  id: number;
  at: string;
  tone: ToneKey;
  comments: string[];
  replies: string[];
}

/** Split pasted textarea input into 1-10 non-empty comment lines. */
export function parseCommentLines(text: string): string[] {
  return text
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, MAX_COMMENTS);
}

export function buildBatch(
  tone: ToneKey,
  comments: string[],
  replies: string[],
): ReplyBatch {
  return { id: Date.now(), at: new Date().toISOString(), tone, comments, replies };
}

/** Load history from localStorage; never throws. */
export function loadReplyHistory(
  storage: Pick<Storage, "getItem"> = localStorage,
): ReplyBatch[] {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? (parsed as ReplyBatch[]).slice(0, HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

/** Clear history; never throws. */
export function clearReplyHistory(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  try {
    storage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
}
/** Prepend a batch, cap the list, persist; never throws. */
export function saveReplyBatch(
  prev: ReplyBatch[],
  batch: ReplyBatch,
  storage: Pick<Storage, "setItem"> = localStorage,
): ReplyBatch[] {
  const next = [batch, ...prev].slice(0, HISTORY_LIMIT);
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable — history is a nicety, not a blocker */
  }
  return next;
}
