import type { SavedDestination } from "./reach-api";

export interface LiveStreamDestination {
  platform: string;
  label: string;
  status: string;
  error_reason?: string | null;
  has_key?: boolean;
}

/**
 * The destinations endpoint contract is `{ destinations: [...] }`, but a
 * partial payload must be recognized as malformed instead of being stored
 * as state. Returning null lets the panel show its honest load error.
 */
export function savedDestinationsFromPayload(
  payload: unknown,
): SavedDestination[] | null {
  if (!payload || typeof payload !== "object") return null;
  const destinations = (payload as { destinations?: unknown }).destinations;
  return Array.isArray(destinations)
    ? (destinations as SavedDestination[])
    : null;
}

/** Last-resort render guard: even poisoned state renders as an empty list. */
export function savedDestinationsOrEmpty(
  saved: readonly SavedDestination[] | null | undefined,
): SavedDestination[] {
  return Array.isArray(saved) ? [...saved] : [];
}

/** A live-stream status payload may also omit or mistype its destinations. */
export function liveStreamDestinations(value: unknown): LiveStreamDestination[] {
  return Array.isArray(value) ? (value as LiveStreamDestination[]) : [];
}
