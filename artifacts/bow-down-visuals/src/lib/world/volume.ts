/**
 * volume.ts — the World's master volume (stack900, lane G3).
 *
 * B7's settings census proved the gap in writing: "no World master
 * sound switch or volume exists anywhere" — the announcements mute
 * was the only World sound control, and every other World sound
 * (the jukebox, the radio, voice, the desk players) ran at its own
 * fixed level with no way for the walker to turn the WORLD down.
 * This module is that missing control's one home:
 *
 * - THE SETTING: one device-persisted pair — level 0–100 + a mute
 *   flag — under WORLD_VOLUME_KEY, stored exactly like the
 *   announcements mute beside it (this device only; the palace
 *   itself is never quietened for anyone else).
 * - THE MATH: worldVolumeGain() is the single gain every World
 *   sound passes through. Owned bases compose multiplicatively
 *   (scaledWorldVolume) — the jukebox's designed 0.85 stays 0.85
 *   OF the master, never beside it.
 * - THE CHOKE: every World audio source applies this gain in
 *   series, downstream of its own gates, so the master can only
 *   ever quiet — it can never resurrect a sound another switch
 *   silenced:
 *     · signature sounds (announcement + King stings, bell
 *       arrivals) — the engine's output scale (signature-sounds.ts
 *       setOutputScale), driven by the World page while mounted;
 *     · voice receive — a master gain node in series in voice.ts,
 *       AFTER the per-peer proximity/deafen gains (deafen still
 *       wins: 0 × master is 0);
 *     · the Music Hall jukebox + Charts Radio — their elements'
 *       volumes, set from this store;
 *     · every media element standing in the World page's DOM
 *       (desk players, the shelf player, live remote video) — the
 *       media choke below, one register/apply path for all of them.
 *   Phone-mute-wins (SOUNDS v7 law) is untouched: the signature
 *   engine's device-mute gate still outranks every play before
 *   volume is ever consulted, and this module holds no gate of its
 *   own — it is a fader, never a switch that can un-silence.
 *
 * Composition with the announcements mute: the two are independent
 * faders on different things. The announce mute silences the
 * banner + sting at the page's call site; the master scales what
 * remains. Neither writes the other's store, and turning the
 * master back up never un-mutes announcements (their sting call
 * site still checks the announce mute first).
 */

export interface WorldVolume {
  /** 0–100. 100 = the World's sounds at their designed levels. */
  level: number;
  /** The mute flag: gain 0 whatever the level says. Un-muting
   *  returns to the level — the level is never destroyed by muting. */
  muted: boolean;
}

export const WORLD_VOLUME_KEY = "bdv.world.volume";

export const DEFAULT_WORLD_VOLUME: WorldVolume = { level: 100, muted: false };

/* ── Pure math ─────────────────────────────────────────────────── */

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** A level is a whole percent, 0–100. Garbage in (NaN, a string, a
 *  negative) sanitizes to a sane value rather than poisoning the
 *  store: non-numbers fall back to full, numbers clamp + round. */
export function sanitizeWorldVolumeLevel(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_WORLD_VOLUME.level;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

export function sanitizeWorldVolume(raw: unknown): WorldVolume {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_WORLD_VOLUME };
  const r = raw as { level?: unknown; muted?: unknown };
  return {
    level: sanitizeWorldVolumeLevel(r.level),
    muted: r.muted === true,
  };
}

/** THE gain: the one number every World sound is scaled by.
 *  Muted, or a level of 0, is silence; 100 is unity. */
export function worldVolumeGain(v: WorldVolume): number {
  return v.muted ? 0 : v.level / 100;
}

/** An owned base volume composed with the master: the jukebox's
 *  0.85, a signature role's 0.55 — each stays itself OF the master. */
export function scaledWorldVolume(base: number, v: WorldVolume): number {
  return clamp01(base) * worldVolumeGain(v);
}

/* ── Control transitions (what the header control's hands do) ──── */

/** Dragging the slider: the level is the ask. Dragging UP from any
 *  state asks for sound, so a mute flag never survives a level the
 *  user just chose; dragging to 0 is silence either way (the flag
 *  is left as it stands — gain is 0 regardless). */
export function withWorldVolumeLevel(v: WorldVolume, level: number): WorldVolume {
  const next = sanitizeWorldVolumeLevel(level);
  return { level: next, muted: next > 0 ? false : v.muted };
}

/** The mute tap: the flag flips, the level is preserved — un-muting
 *  lands back on exactly the loudness the walker left. */
export function withWorldVolumeMuted(v: WorldVolume, muted: boolean): WorldVolume {
  return { level: v.level, muted };
}

/* ── The device store (announce.ts's pattern, verbatim shape) ──── */

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The persisted setting. Absent/garbled storage reads as the
 *  default (full volume, unmuted) — the World sounds as designed
 *  unless the walker chose otherwise on this device. */
export function loadWorldVolume(storage: StorageLike | null = defaultStorage()): WorldVolume {
  try {
    const raw = storage?.getItem(WORLD_VOLUME_KEY);
    if (!raw) return { ...DEFAULT_WORLD_VOLUME };
    return sanitizeWorldVolume(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_WORLD_VOLUME };
  }
}

export function storeWorldVolume(v: WorldVolume, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(WORLD_VOLUME_KEY, JSON.stringify(sanitizeWorldVolume(v)));
  } catch {
    /* private modes etc. — the choice lasts the session, in state */
  }
}

/* ── The live mirror + subscription ────────────────────────────────
   One in-memory copy of the setting that every choke point reads
   or follows: the voice master gain and the media choke subscribe;
   React surfaces mirror it into state. setWorldVolume is the ONLY
   write path — it sanitizes, persists, and notifies in one motion,
   so no surface can drift from the store. */

let current: WorldVolume | null = null;
const listeners = new Set<(v: WorldVolume) => void>();

export function getWorldVolume(): WorldVolume {
  if (!current) current = loadWorldVolume();
  return current;
}

export function setWorldVolume(next: WorldVolume): WorldVolume {
  const clean = sanitizeWorldVolume(next);
  current = clean;
  storeWorldVolume(clean);
  for (const fn of [...listeners]) fn(clean);
  return clean;
}

export function subscribeWorldVolume(fn: (v: WorldVolume) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/* ── The media choke ───────────────────────────────────────────────
   Every media element standing in the World page's DOM — the desk
   players, the shelf player, live remote video, the A/B previews —
   is scaled through here: ONE register/apply path, so no present
   or future in-World player can sound at a level the master
   didn't pass. (Detached elements — the jukebox, the radio, the
   signature engine's handles — never enter the DOM, so their
   owners apply the same store directly; the census in the lane
   report names which is which.)
 *
 * An element's BASE is its own designed/user volume: captured at
 * registration (an explicit data-world-base-volume wins, else the
 * element's current volume — 1 for every element the World ships
 * today). The choke only ever writes base × gain. It never touches
 * `muted`: a muted-by-design element (figure loops, room screens)
 * stays muted, and master mute is gain 0, not an element mute — so
 * un-muting the master restores levels without resurrecting
 * anything the element itself silenced.
 *
 * Native controls: a walker who drags a desk video's own volume
 * slider is making a base decision, not fighting the master —
 * noteExternalVolume re-bases the element from the value they
 * chose (when the master lets anything be heard) instead of
 * snapping it back. */

export interface WorldMediaElementLike {
  volume: number;
  muted: boolean;
  dataset?: Record<string, string | undefined>;
}

export interface WorldMediaChoke {
  /** Capture the element's base (first sight) and apply the
   *  master. Re-registering a known element keeps its base and
   *  simply re-applies — safe to call on every play. */
  register(el: WorldMediaElementLike): void;
  /** A volumechange the choke didn't cause: the walker's own
   *  hand on the element's native control. Re-bases the element;
   *  the choke's own writes are recognized by value and ignored. */
  noteExternalVolume(el: WorldMediaElementLike): void;
  /** The last value the choke wrote to this element (null if it
   *  never has) — the echo guard, exposed for the page glue. */
  appliedFor(el: WorldMediaElementLike): number | null;
  /** The value the choke WOULD write now (base × gain). */
  scaledFor(el: WorldMediaElementLike): number | null;
  /** Forget one element (it left the page). */
  release(el: WorldMediaElementLike): void;
  dispose(): void;
}

export interface WorldMediaChokeDeps {
  getVolume?: () => WorldVolume;
  subscribe?: (fn: (v: WorldVolume) => void) => () => void;
}

interface ChokeEntry {
  base: number;
  applied: number;
}

export function createWorldMediaChoke(deps: WorldMediaChokeDeps = {}): WorldMediaChoke {
  const getVolume = deps.getVolume ?? getWorldVolume;
  const subscribe = deps.subscribe ?? subscribeWorldVolume;
  const entries = new Map<WorldMediaElementLike, ChokeEntry>();

  function baseOf(el: WorldMediaElementLike): number {
    const declared = el.dataset?.worldBaseVolume;
    if (declared !== undefined) {
      const parsed = Number(declared);
      if (Number.isFinite(parsed)) return clamp01(parsed);
    }
    return clamp01(el.volume);
  }

  function apply(el: WorldMediaElementLike, entry: ChokeEntry): void {
    entry.applied = entry.base * worldVolumeGain(getVolume());
    el.volume = entry.applied;
  }

  function applyAll(): void {
    for (const [el, entry] of entries) apply(el, entry);
  }

  const unsubscribe = subscribe(() => applyAll());

  const choke: WorldMediaChoke = {
    register(el) {
      const known = entries.get(el);
      if (known) {
        apply(el, known);
        return;
      }
      /* Capture the base BEFORE the first write — the element's
         current volume is its own (designed or user-chosen); after
         we write, that truth is gone. */
      const entry: ChokeEntry = { base: baseOf(el), applied: el.volume };
      entries.set(el, entry);
      apply(el, entry);
    },
    noteExternalVolume(el) {
      const entry = entries.get(el);
      if (!entry) {
        choke.register(el);
        return;
      }
      if (el.volume === entry.applied) return; /* our own echo */
      const gain = worldVolumeGain(getVolume());
      if (gain <= 0) return; /* muted master: nothing audible to infer a base from */
      entry.base = clamp01(el.volume / gain);
      entry.applied = el.volume; /* the walker's hand stands until the master moves */
    },
    appliedFor(el) {
      return entries.get(el)?.applied ?? null;
    },
    scaledFor(el) {
      const entry = entries.get(el);
      return entry ? entry.base * worldVolumeGain(getVolume()) : null;
    },
    release(el) {
      entries.delete(el);
    },
    dispose() {
      unsubscribe();
      entries.clear();
    },
  };
  return choke;
}
