/* ─── Signature sounds — THE site sound engine (Stack-200 UPGRADES 183) ──
   One module every surface calls. No ad-hoc Audio() anywhere else:
   the header bell, the World bell, the messages page, the toast rail
   and the King's moments all play through here, BY ROLE — the actual
   asset files live behind the manifest (signature-sound-manifest.ts),
   the only place a sound filename appears, so a new approved set is a
   files-only swap.

   THE ACCEPTANCE CONDITION lives here, not at call sites: no sound
   may play anywhere its switch is off. Every play passes the one
   gate in this file:

     device/browser mute  — outranks everything (a muted device never
                            gets sound, whatever the toggles say)
     master_enabled off   — total silence
     the kind's switch off — that kind silent

   Call sites cannot bypass the gate: they hold no audio elements and
   no prefs of their own, only play(role).

   Restraint, so the site never becomes noise:
   - restrained per-role volumes (below),
   - one sound at a time — a new play retires the one still sounding
     (the ringtone is the exception: it loops until stopped, and it
     retires everything else when it starts),
   - a per-role cooldown collapses bursts (a poll that lands five
     notifications at once dings once),
   - background tabs stay silent — a sound is for a moment the member
     is present for; the next visit's badge still tells the story.

   Preferences are PER ACCOUNT, server-side (GET/PATCH
   /api/sound-prefs, migration 0242), loaded by the prefs provider in
   App and pushed into this engine. Signed-out = the all-on default,
   still gated by device mute and the visibility rule. */

import { SIGNATURE_SOUND_ASSETS } from "./signature-sound-manifest";

export type SoundKind =
  | "notification"
  | "message"
  | "success"
  | "error"
  | "sting"
  | "ringtone";

/** The Settings switches. success_stings is ONE switch governing two
 *  roles (success + the royal sting) per the owner's control spec;
 *  errors has its own switch so every role carries a gate. */
export interface SoundPrefs {
  master_enabled: boolean;
  notifications_enabled: boolean;
  messages_enabled: boolean;
  success_stings_enabled: boolean;
  errors_enabled: boolean;
  ringtone_enabled: boolean;
}

export const DEFAULT_SOUND_PREFS: SoundPrefs = {
  master_enabled: true,
  notifications_enabled: true,
  messages_enabled: true,
  success_stings_enabled: true,
  errors_enabled: true,
  ringtone_enabled: true,
};

const KIND_SWITCH: Record<SoundKind, keyof SoundPrefs> = {
  notification: "notifications_enabled",
  message: "messages_enabled",
  success: "success_stings_enabled",
  sting: "success_stings_enabled",
  error: "errors_enabled",
  ringtone: "ringtone_enabled",
};

/** Restrained volumes per role (0–1). */
export const SOUND_VOLUMES: Record<SoundKind, number> = {
  notification: 0.45,
  message: 0.4,
  success: 0.5,
  error: 0.35,
  sting: 0.55,
  ringtone: 0.6,
};

/** Minimum gap between two plays of the same role. */
export const SOUND_COOLDOWN_MS = 900;

export interface SoundAudioHandle {
  src: string;
  volume: number;
  loop: boolean;
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
}

export interface SoundEngineDeps {
  createAudio: (src: string) => SoundAudioHandle;
  now: () => number;
  /** True when the tab is in the background (document.hidden). */
  isHidden: () => boolean;
  /** Host-reported device/browser mute. Native wrappers (the app and
   *  extension, at their live-push bind) report the OS mute state
   *  through here; in a plain browser it stays false and the OS still
   *  silences output at the device, beneath anything we can play. */
  deviceMuted: () => boolean;
}

export interface SoundEngine {
  play(kind: SoundKind): boolean;
  stop(kind: SoundKind): void;
  stopAll(): void;
  setPrefs(prefs: SoundPrefs): void;
  getPrefs(): SoundPrefs;
  /** The one gate, exposed for tests and honest callers. */
  canPlay(kind: SoundKind): boolean;
}

export function createSoundEngine(deps: SoundEngineDeps): SoundEngine {
  let prefs: SoundPrefs = { ...DEFAULT_SOUND_PREFS };
  const handles = new Map<SoundKind, SoundAudioHandle>();
  const lastPlayedAt = new Map<SoundKind, number>();
  let sounding: SoundKind | null = null;

  function canPlay(kind: SoundKind): boolean {
    if (deps.deviceMuted()) return false;
    if (!prefs.master_enabled) return false;
    if (!prefs[KIND_SWITCH[kind]]) return false;
    return true;
  }

  function handleFor(kind: SoundKind): SoundAudioHandle {
    let h = handles.get(kind);
    if (!h) {
      h = deps.createAudio(SIGNATURE_SOUND_ASSETS[kind]);
      h.volume = SOUND_VOLUMES[kind];
      h.loop = kind === "ringtone";
      handles.set(kind, h);
    }
    return h;
  }

  function stop(kind: SoundKind): void {
    const h = handles.get(kind);
    if (h) {
      try {
        h.pause();
        h.currentTime = 0;
      } catch {
        /* a handle that refuses to stop must never break a surface */
      }
    }
    if (sounding === kind) sounding = null;
  }

  function stopAll(): void {
    for (const kind of handles.keys()) stop(kind);
    sounding = null;
  }

  function play(kind: SoundKind): boolean {
    if (!canPlay(kind)) return false;
    if (deps.isHidden()) return false;
    const now = deps.now();
    const last = lastPlayedAt.get(kind) ?? -Infinity;
    if (now - last < SOUND_COOLDOWN_MS) return false;
    /* One sound at a time: retire whatever is still sounding. The
       ringtone keeps sounding across other roles' cooldowns only
       until any other role actually plays — presence wins. */
    if (sounding && sounding !== kind) stop(sounding);
    if (sounding === kind) stop(kind);
    lastPlayedAt.set(kind, now);
    try {
      const h = handleFor(kind);
      h.currentTime = 0;
      const result = h.play();
      sounding = kind;
      if (result && typeof (result as Promise<void>).catch === "function") {
        /* Autoplay policy (no user gesture yet) rejects the promise —
           that is the browser honoring its own rule, not an error
           worth surfacing anywhere. */
        (result as Promise<void>).catch(() => {
          if (sounding === kind) sounding = null;
        });
      }
    } catch {
      sounding = null;
      return false;
    }
    return true;
  }

  return {
    play,
    stop,
    stopAll,
    canPlay,
    setPrefs(next: SoundPrefs) {
      prefs = { ...next };
      /* Turning a switch off silences a sound already playing —
         the gate is not only about starting plays. */
      for (const kind of [...handles.keys()]) {
        if (!canPlay(kind)) stop(kind);
      }
    },
    getPrefs() {
      return { ...prefs };
    },
  };
}

/* ── The shared engine ──────────────────────────────────────────────────
   Device mute signal: a plain browser exposes no JS-readable OS-mute
   flag, so the default detector reads the host bridge the app /
   extension wrappers set (window.__bdvDeviceMuted) and otherwise
   defers to the OS, which silences device output beneath us. The
   moment any host reports muted, the gate closes above every
   setting — pinned by the engine tests. */

function defaultCreateAudio(src: string): SoundAudioHandle {
  return new Audio(src) as unknown as SoundAudioHandle;
}

function defaultDeviceMuted(): boolean {
  if (typeof window === "undefined") return false;
  return (window as unknown as { __bdvDeviceMuted?: boolean }).__bdvDeviceMuted === true;
}

export const signatureSounds: SoundEngine = createSoundEngine({
  createAudio: defaultCreateAudio,
  now: () => Date.now(),
  isHidden: () => typeof document !== "undefined" && document.hidden,
  deviceMuted: defaultDeviceMuted,
});

/** The one call every surface makes. Returns whether a sound started. */
export function playSignatureSound(kind: SoundKind): boolean {
  return signatureSounds.play(kind);
}

/* ── Prefs loading (per account, server-side) ───────────────────────────
   Fetches the signed-in account's switches and pushes them into the
   engine. A failed load leaves the current prefs in place — for a
   signed-in member those are the defaults until the first successful
   load, and the Settings card itself owns the honest load-error
   state. Fire-and-forget safe: never throws. */
export async function loadSoundPrefsIntoEngine(
  getAccessToken: () => Promise<string | null>,
): Promise<void> {
  try {
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    const res = await fetch("/api/sound-prefs", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const d = (await res.json()) as Partial<SoundPrefs>;
    signatureSounds.setPrefs({
      master_enabled: d.master_enabled ?? true,
      notifications_enabled: d.notifications_enabled ?? true,
      messages_enabled: d.messages_enabled ?? true,
      success_stings_enabled: d.success_stings_enabled ?? true,
      errors_enabled: d.errors_enabled ?? true,
      ringtone_enabled: d.ringtone_enabled ?? true,
    });
  } catch {
    /* the engine keeps its current prefs; sounds never break a page */
  }
}

/* ── Notification-arrival helper (shared by the site bell, the World
      bell, and any future surface on the same rail) ───────────────────
   Given the unread items of successive polls, decide the ONE role a
   new arrival should sound — or null. The first sighting seeds the
   known set silently (a page opening on old unread mail must not
   ding); later polls sound at most one role, messages outranking
   plain notifications, and the engine's own gates + cooldown have
   the final word regardless. */

export interface ArrivalItem {
  id: string;
  kind: string;
  is_read: boolean;
}

export function isMessageKind(kind: string): boolean {
  return kind === "message" || kind.startsWith("dm") || kind === "message_request";
}

/** Stateful per-surface tracker: the first observe() seeds silently,
 *  later ones report the role for genuinely new arrivals. */
export function createArrivalTracker(): {
  observe(items: ArrivalItem[]): SoundKind | null;
} {
  const knownUnreadIds = new Set<string>();
  let seeded = false;
  return {
    observe(items: ArrivalItem[]): SoundKind | null {
      if (!seeded) {
        seeded = true;
        soundForNewArrivals(knownUnreadIds, items);
        return null;
      }
      return soundForNewArrivals(knownUnreadIds, items);
    },
  };
}

export function soundForNewArrivals(
  knownUnreadIds: Set<string>,
  items: ArrivalItem[],
): SoundKind | null {
  const fresh = items.filter((i) => !i.is_read && !knownUnreadIds.has(i.id));
  for (const i of items) {
    if (!i.is_read) knownUnreadIds.add(i.id);
  }
  /* Drop ids that left the unread set (read elsewhere / aged out of
     the poll window) so the set tracks the current unread world. */
  const currentUnread = new Set(items.filter((i) => !i.is_read).map((i) => i.id));
  for (const id of [...knownUnreadIds]) {
    if (!currentUnread.has(id)) knownUnreadIds.delete(id);
  }
  if (fresh.length === 0) return null;
  return fresh.some((i) => isMessageKind(i.kind)) ? "message" : "notification";
}
