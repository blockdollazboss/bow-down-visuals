/* ── First-session pop-up coordinator (QC G10, stack800 lane 8) ─────────
   The app mounts several pop-ups that can fire unbidden in a member's
   first moments of a session — the "while you were away" digest on the
   dashboard, the extension upsell on a 12-second timer everywhere.
   Each used to keep its own memory and its own trigger, with no shared
   ordering: the upsell's overlay (z-9990) could slam on top of the
   digest (z-90) twelve seconds into a returning member's first screen.

   This coordinator is the one door they now share (EVERYTHING SMART:
   the right thing shows first, nothing re-fires blindly):

   - ORDERING — pop-ups carry a class + priority. Announcements (the
     member's own news: their renders, their streak) outrank upsells
     (asks). Only ONE coordinated pop-up holds the slot at a time; the
     rest wait, and the highest-priority waiter is promoted when the
     slot frees.
   - ONCE-PER-SESSION MEMORY — one shared session record of what has
     actually been shown; a pop-up can never claim twice in a session,
     even after it closes.
   - PER-PERSON RESTRAINT — a persistent per-person record: an upsell
     may be shown to the same person at most once per 24 hours across
     sessions, and at most ONE upsell may claim per session no matter
     how many are registered. Announcements are exempt from both
     restraints (their content is server-gated news, not an ask) but
     not from the once-per-session rule.

   User-summoned surfaces (the daily-bonus modal opened from the
   StreakWidget, the mystery crate) are NOT coordinated — a person who
   clicks a thing gets the thing. The coordinator governs only what
   fires unbidden.

   The core is a factory over injected storage + clock so the ordering
   and restraint rules are pinnable in plain tests; the app uses the
   browser-backed singleton below. */

export type PopupClass = "announcement" | "upsell";

export interface PopupSpec {
  class: PopupClass;
  /** Higher shows first when several pop-ups are waiting. */
  priority: number;
}

export const POPUP_REGISTRY = {
  /* The member's own news — always first. */
  "away-digest": { class: "announcement", priority: 100 },
  /* The ask — waits for the news, and for a quieter moment. */
  "extension-promo": { class: "upsell", priority: 10 },
} as const satisfies Record<string, PopupSpec>;

export type PopupId = keyof typeof POPUP_REGISTRY;

/** An upsell may re-show to the same person at most once per day. */
export const UPSELL_PERSON_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** At most one upsell claims per session, however many are registered. */
export const UPSELL_SESSION_CAP = 1;

export interface PopupStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SessionRecord {
  shown: Record<string, number>;
  upsellsShown: number;
}

interface PersonRecord {
  lastShown: Record<string, number>;
}

const SESSION_KEY = "bdv_popup_coordinator_v1";
const personStorageKey = (personKey: string) => `bdv_popup_coordinator_v1:${personKey}`;

function parseSession(raw: string | null): SessionRecord {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<SessionRecord>) : null;
    return {
      shown: v && typeof v.shown === "object" && v.shown ? v.shown : {},
      upsellsShown: typeof v?.upsellsShown === "number" ? v.upsellsShown : 0,
    };
  } catch {
    return { shown: {}, upsellsShown: 0 };
  }
}

function parsePerson(raw: string | null): PersonRecord {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<PersonRecord>) : null;
    return { lastShown: v && typeof v.lastShown === "object" && v.lastShown ? v.lastShown : {} };
  } catch {
    return { lastShown: {} };
  }
}

export type PopupDenyReason =
  | "unknown_popup"
  | "shown_this_session"
  | "person_cooldown"
  | "upsell_session_cap";

export type PopupEligibility = { ok: true } | { ok: false; reason: PopupDenyReason };

/** The pure restraint decision — no slot state, no DOM. */
export function decidePopupEligibility(args: {
  spec: PopupSpec | undefined;
  session: SessionRecord;
  person: PersonRecord;
  popupId: string;
  now: number;
}): PopupEligibility {
  const { spec, session, person, popupId, now } = args;
  if (!spec) return { ok: false, reason: "unknown_popup" };
  if (typeof session.shown[popupId] === "number") {
    return { ok: false, reason: "shown_this_session" };
  }
  if (spec.class === "upsell") {
    if (session.upsellsShown >= UPSELL_SESSION_CAP) {
      return { ok: false, reason: "upsell_session_cap" };
    }
    const last = person.lastShown[popupId];
    if (typeof last === "number" && now - last < UPSELL_PERSON_COOLDOWN_MS) {
      return { ok: false, reason: "person_cooldown" };
    }
  }
  return { ok: true };
}

export interface PopupCoordinator {
  /**
   * Ask for the slot. Grants immediately (returns true) only when the
   * pop-up is eligible AND the slot is free; when the slot is busy the
   * pop-up is registered as a waiter (returns false) and is promoted —
   * highest priority first — when the slot frees. An ineligible pop-up
   * is never queued: its denial is durable for the session/person
   * window, so waiting could never change the answer.
   */
  claim(popupId: string, personKey: string): boolean;
  /** Give the slot back (or withdraw a wait). Promotes the next waiter. */
  release(popupId: string): void;
  activeId(): string | null;
  /** The pure restraint answer for this person right now. */
  eligibility(popupId: string, personKey: string): PopupEligibility;
  subscribe(fn: () => void): () => void;
}

export function createPopupCoordinator(deps: {
  registry: Record<string, PopupSpec>;
  session: PopupStorage;
  person: PopupStorage;
  now?: () => number;
}): PopupCoordinator {
  const { registry, session, person } = deps;
  const now = deps.now ?? (() => Date.now());
  let active: string | null = null;
  const waiters = new Map<string, string>(); // popupId -> personKey
  const listeners = new Set<() => void>();

  const readSession = () => parseSession(session.getItem(SESSION_KEY));
  const readPerson = (personKey: string) => parsePerson(person.getItem(personStorageKey(personKey)));

  function eligibility(popupId: string, personKey: string): PopupEligibility {
    return decidePopupEligibility({
      spec: registry[popupId],
      session: readSession(),
      person: readPerson(personKey),
      popupId,
      now: now(),
    });
  }

  function grant(popupId: string, personKey: string): void {
    const spec = registry[popupId]!;
    const at = now();
    const s = readSession();
    s.shown[popupId] = at;
    if (spec.class === "upsell") s.upsellsShown += 1;
    try {
      session.setItem(SESSION_KEY, JSON.stringify(s));
    } catch { /* private mode — in-page arbitration still holds */ }
    const p = readPerson(personKey);
    p.lastShown[popupId] = at;
    try {
      person.setItem(personStorageKey(personKey), JSON.stringify(p));
    } catch { /* private mode */ }
    active = popupId;
    waiters.delete(popupId);
  }

  function notify(): void {
    listeners.forEach((fn) => {
      try { fn(); } catch { /* a listener must never break arbitration */ }
    });
  }

  function promoteWaiters(): void {
    if (active) return;
    const ordered = [...waiters.entries()].sort(
      (a, b) => (registry[b[0]]?.priority ?? 0) - (registry[a[0]]?.priority ?? 0),
    );
    for (const [popupId, personKey] of ordered) {
      if (eligibility(popupId, personKey).ok) {
        grant(popupId, personKey);
        return;
      }
      /* Became ineligible while waiting (e.g. shown in another tab's
         session record) — drop the wait rather than hold the queue. */
      waiters.delete(popupId);
    }
  }

  return {
    claim(popupId, personKey) {
      if (active === popupId) return true;
      if (!eligibility(popupId, personKey).ok) return false;
      if (active) {
        waiters.set(popupId, personKey);
        return false;
      }
      grant(popupId, personKey);
      notify();
      return true;
    },
    release(popupId) {
      waiters.delete(popupId);
      if (active !== popupId) return;
      active = null;
      promoteWaiters();
      notify();
    },
    activeId: () => active,
    eligibility,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/* ── Browser singleton ────────────────────────────────────────────────── */

function memoryFallback(): PopupStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function browserStorage(kind: "session" | "local"): PopupStorage {
  const fallback = memoryFallback();
  const real = (): Storage | null => {
    try {
      return kind === "session" ? window.sessionStorage : window.localStorage;
    } catch {
      return null;
    }
  };
  return {
    getItem: (k) => {
      try {
        return real()?.getItem(k) ?? fallback.getItem(k);
      } catch {
        return fallback.getItem(k);
      }
    },
    setItem: (k, v) => {
      try {
        const s = real();
        if (s) {
          s.setItem(k, v);
          return;
        }
      } catch { /* fall through to memory */ }
      fallback.setItem(k, v);
    },
  };
}

export const popupCoordinator: PopupCoordinator = createPopupCoordinator({
  registry: POPUP_REGISTRY,
  session: browserStorage("session"),
  person: browserStorage("local"),
});
