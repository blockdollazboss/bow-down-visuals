/* ─── Prompt dismissal memory — 30 days, then re-ask ────────────────────
   Owner ruling (stack1400 #16, W5/K1): dismissing the install card or
   a push opt-in prompt silences that prompt for 30 days — not forever,
   and not just until the next visit. After the window the prompt may
   ask again.

   Storage shape: the dismissal is a timestamp (milliseconds since the
   epoch, as a decimal string) stored under the SAME key the prompt has
   always used — `bdv-pwa-dismissed` for the install card and
   `bdv_push_prompt_dismissed:<context>` per push context. No new keys,
   so an existing dismissal is never orphaned by this change.

   Legacy migration: prompts used to store the bare string "1"
   (permanent dismissal). At the first read after this ships, a legacy
   "1" is rewritten in place as a timestamp for *now* — those visitors
   get 30 fresh days from that first read, then the prompt may re-ask.
   The migration is deliberate: the old value carries no date, so there
   is no honest way to know when it was dismissed.

   Expiry is checked on read: a timestamp 30 days old or older no
   longer counts as dismissed. Storage failures (private mode, quota)
   never throw — a failed read means "not dismissed" and a failed
   write simply means the prompt may show again next view. */

export const PROMPT_DISMISSAL_WINDOW_DAYS = 30;
export const PROMPT_DISMISSAL_WINDOW_MS =
  PROMPT_DISMISSAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** The pre-timestamp dismissal value written by older builds. */
const LEGACY_DISMISSED_VALUE = "1";

type DismissalStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): DismissalStorage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function resolveStorage(
  storage: DismissalStorage | null | undefined,
): DismissalStorage | null {
  return storage === undefined ? defaultStorage() : storage;
}

/**
 * True when `key` holds a dismissal still inside its 30-day window.
 *
 * Side effect (legacy migration only): a bare "1" is rewritten as a
 * timestamp for `now` and counts as freshly dismissed.
 */
export function isPromptDismissed(
  key: string,
  storage?: DismissalStorage | null,
  now: number = Date.now(),
): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return false;
  }
  if (raw === null || raw === "") return false;

  if (raw === LEGACY_DISMISSED_VALUE) {
    try {
      store.setItem(key, String(now));
    } catch {
      /* migration is best-effort — this read still counts as dismissed */
    }
    return true;
  }

  const dismissedAt = Number(raw);
  if (!Number.isFinite(dismissedAt) || dismissedAt <= 0) return false;
  return now - dismissedAt < PROMPT_DISMISSAL_WINDOW_MS;
}

/** Record a dismissal of `key` as a timestamp for `now`. Never throws. */
export function recordPromptDismissal(
  key: string,
  storage?: DismissalStorage | null,
  now: number = Date.now(),
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(key, String(now));
  } catch {
    /* private mode — hiding for this view is enough */
  }
}
