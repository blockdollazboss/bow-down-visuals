/**
 * Email theme rotation — company law (owner, Nov 8, 2026): automatic
 * emails alternate theme BY CUSTOMER in a strict rotation —
 * dark, light, dark, light. The first email a customer ever gets is
 * the dark send; every later send flips. A theme is only "spent" when
 * a send is VERIFIED SENT: resolving a theme for rendering never
 * advances the rotation, so a failed send or a retry keeps the theme
 * it was assigned (the same rule the outreach sender runs on).
 *
 * ── Where the state lives ──────────────────────────────────────────
 * There is no per-recipient key/value table in the schema today
 * (verified Nov 11, 2026 against lib/db/src/schema: the settings
 * tables are all per-creator feature tables, and
 * generation_stored_results is charge-scoped — its rows belong to
 * paid generation intents, so borrowing it would corrupt its
 * invariant). The rotation therefore sits behind the store seam
 * below and defaults to a process-local in-memory store:
 *
 *   - SAFE DEFAULT: with no durable store, a recipient's first send
 *     after a server start is dark, and alternation is exact for the
 *     life of the process. A restart restarts a customer's sequence
 *     at dark — a theme repeat, never a broken or unthemed email.
 *   - TRAILING STEP (single, named): one join-assigned migration
 *     creating the durable table, then a DB-backed store plugged in
 *     via setEmailThemeRotationStore() — no call site changes.
 *     Proposed table (DDL for the join, NOT a migration file):
 *
 *       CREATE TABLE IF NOT EXISTS email_theme_rotation (
 *         recipient_email text PRIMARY KEY,
 *         next_theme      text NOT NULL DEFAULT 'dark'
 *                           CHECK (next_theme IN ('dark','light')),
 *         sent_count      integer NOT NULL DEFAULT 0,
 *         updated_at      timestamptz NOT NULL DEFAULT now()
 *       );
 *
 * Every function here is fail-open: a store error resolves to the
 * safe default (dark for a fresh sequence) and never throws — theme
 * bookkeeping must never break or block an email.
 */

export type EmailTheme = "dark" | "light";

export interface EmailThemeRotationState {
  /** The theme the customer's NEXT verified send will carry. */
  nextTheme: EmailTheme;
  /** Verified sends recorded for this customer so far. */
  sentCount: number;
  updatedAt: string | null;
}

/**
 * Persistence seam for the rotation. Implementations must treat the
 * recipient key as an opaque, already-normalized string
 * (see normalizeEmailThemeRecipientKey).
 */
export interface EmailThemeRotationStore {
  get(recipientKey: string): Promise<EmailThemeRotationState | null>;
  set(recipientKey: string, state: EmailThemeRotationState): Promise<void>;
}

const FIRST_THEME: EmailTheme = "dark";

export function otherEmailTheme(theme: EmailTheme): EmailTheme {
  return theme === "dark" ? "light" : "dark";
}

/** Normalize a recipient address into the rotation key. */
export function normalizeEmailThemeRecipientKey(
  email: string | null | undefined,
): string | null {
  if (!email) return null;
  const key = email.trim().toLowerCase();
  return key.length > 0 ? key : null;
}

class InMemoryEmailThemeRotationStore implements EmailThemeRotationStore {
  private readonly states = new Map<string, EmailThemeRotationState>();

  async get(recipientKey: string): Promise<EmailThemeRotationState | null> {
    return this.states.get(recipientKey) ?? null;
  }

  async set(
    recipientKey: string,
    state: EmailThemeRotationState,
  ): Promise<void> {
    this.states.set(recipientKey, state);
  }

  clear(): void {
    this.states.clear();
  }
}

const inMemoryStore = new InMemoryEmailThemeRotationStore();
let activeStore: EmailThemeRotationStore = inMemoryStore;

/**
 * Plug in a durable store (the trailing-step migration's DB-backed
 * implementation). Passing null restores the in-memory default.
 */
export function setEmailThemeRotationStore(
  store: EmailThemeRotationStore | null,
): void {
  activeStore = store ?? inMemoryStore;
}

/** The store currently backing the rotation (exposed for tests). */
export function getEmailThemeRotationStore(): EmailThemeRotationStore {
  return activeStore;
}

async function readState(
  recipientKey: string,
): Promise<EmailThemeRotationState> {
  try {
    const existing = await activeStore.get(recipientKey);
    if (existing && (existing.nextTheme === "dark" || existing.nextTheme === "light")) {
      return existing;
    }
  } catch {
    /* fail-open: fall through to the fresh-sequence default */
  }
  return { nextTheme: FIRST_THEME, sentCount: 0, updatedAt: null };
}

/**
 * The theme this customer's next send carries. PEEK ONLY — resolving
 * a theme for rendering never advances the rotation; the flip is
 * recorded by recordEmailThemeSent() after a verified send, so a
 * failed send or a retry keeps its assigned theme.
 */
export async function resolveEmailThemeForRecipient(
  email: string | null | undefined,
): Promise<EmailTheme> {
  const key = normalizeEmailThemeRecipientKey(email);
  if (!key) return FIRST_THEME;
  const state = await readState(key);
  return state.nextTheme;
}

/**
 * Record a VERIFIED sent email: if the theme that was sent is the
 * theme the rotation currently has assigned to this customer, the
 * rotation flips to the other theme. A send carrying a stale or
 * explicitly-forced theme does not disturb the sequence. Fail-open:
 * bookkeeping errors are swallowed — the email already went out.
 */
export async function recordEmailThemeSent(
  email: string | null | undefined,
  themeSent: EmailTheme,
): Promise<void> {
  const key = normalizeEmailThemeRecipientKey(email);
  if (!key) return;
  try {
    const state = await readState(key);
    if (state.nextTheme !== themeSent) return;
    await activeStore.set(key, {
      nextTheme: otherEmailTheme(themeSent),
      sentCount: state.sentCount + 1,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    /* fail-open: rotation bookkeeping never breaks a send path */
  }
}

/** Test seam: clear the in-memory default store's state. */
export function resetEmailThemeRotationForTests(): void {
  inMemoryStore.clear();
  activeStore = inMemoryStore;
}
