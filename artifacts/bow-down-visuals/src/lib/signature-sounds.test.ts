/**
 * signature-sounds.test.ts — UPGRADES 183 acceptance pins.
 *
 * THE ACCEPTANCE CONDITION: no sound may play anywhere its switch is
 * off. These tests drive the REAL engine (createSoundEngine) with a
 * recording fake-audio factory and walk the full matrix:
 *
 *   every kind × all-on            → plays (through the manifest asset)
 *   every kind × master off        → ZERO plays
 *   every kind × its switch off    → ZERO plays for that kind
 *   every kind × device muted      → ZERO plays (mute outranks settings)
 *   hidden tab                     → ZERO plays
 *
 * plus the restraint rules (one sound at a time, per-kind cooldown),
 * the switch-off-mid-play silence, the arrival tracker's
 * seed-silently / message-outranks rules, and the manifest's
 * exclusivity: the manifest is the ONLY source file that names a
 * signature-sound asset, so an approved set swap stays files-only.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSoundEngine,
  createArrivalTracker,
  soundForNewArrivals,
  isMessageKind,
  DEFAULT_SOUND_PREFS,
  SOUND_COOLDOWN_MS,
  type SoundAudioHandle,
  type SoundKind,
  type SoundPrefs,
} from "./signature-sounds";
import { SIGNATURE_SOUND_ASSETS } from "./signature-sound-manifest";

const KINDS: SoundKind[] = ["notification", "message", "success", "error", "sting", "ringtone"];

const KIND_SWITCH: Record<SoundKind, keyof SoundPrefs> = {
  notification: "notifications_enabled",
  message: "messages_enabled",
  success: "success_stings_enabled",
  sting: "success_stings_enabled",
  error: "errors_enabled",
  ringtone: "ringtone_enabled",
};

interface FakeHandle extends SoundAudioHandle {
  plays: number;
  pauses: number;
}

function makeWorld(opts: { hidden?: boolean; muted?: boolean } = {}) {
  const handles: FakeHandle[] = [];
  let now = 1_000_000;
  let hidden = opts.hidden ?? false;
  let muted = opts.muted ?? false;
  const engine = createSoundEngine({
    createAudio: (src: string) => {
      const h: FakeHandle = {
        src,
        volume: 1,
        loop: false,
        currentTime: 0,
        plays: 0,
        pauses: 0,
        play() {
          h.plays += 1;
          return Promise.resolve();
        },
        pause() {
          h.pauses += 1;
        },
      };
      handles.push(h);
      return h;
    },
    now: () => now,
    isHidden: () => hidden,
    deviceMuted: () => muted,
  });
  return {
    engine,
    handles,
    totalPlays: () => handles.reduce((n, h) => n + h.plays, 0),
    advance: (ms: number) => { now += ms; },
    setHidden: (v: boolean) => { hidden = v; },
    setMuted: (v: boolean) => { muted = v; },
  };
}

function prefsWith(patch: Partial<SoundPrefs>): SoundPrefs {
  return { ...DEFAULT_SOUND_PREFS, ...patch };
}

describe("signature sound engine — the acceptance gate", () => {
  it("all-on: every kind plays, through the manifest asset for its role", () => {
    const w = makeWorld();
    for (const kind of KINDS) {
      expect(w.engine.play(kind), kind).toBe(true);
      w.advance(SOUND_COOLDOWN_MS + 1);
    }
    expect(w.handles.map((h) => h.src)).toEqual(KINDS.map((k) => SIGNATURE_SOUND_ASSETS[k]));
    expect(w.totalPlays()).toBe(KINDS.length);
  });

  it("master off: ZERO plays for every kind", () => {
    const w = makeWorld();
    w.engine.setPrefs(prefsWith({ master_enabled: false }));
    for (const kind of KINDS) {
      expect(w.engine.canPlay(kind), kind).toBe(false);
      expect(w.engine.play(kind), kind).toBe(false);
      w.advance(SOUND_COOLDOWN_MS + 1);
    }
    expect(w.totalPlays()).toBe(0);
    expect(w.handles.length).toBe(0);
  });

  it.each(KINDS)("kind switch off (%s): that kind is silent, the gate says so", (kind) => {
    const w = makeWorld();
    w.engine.setPrefs(prefsWith({ [KIND_SWITCH[kind]]: false }));
    expect(w.engine.canPlay(kind)).toBe(false);
    expect(w.engine.play(kind)).toBe(false);
    w.advance(SOUND_COOLDOWN_MS + 1);
    expect(w.engine.play(kind)).toBe(false);
    expect(w.totalPlays()).toBe(0);
  });

  it("success_stings off silences BOTH success and sting — and nothing else", () => {
    const w = makeWorld();
    w.engine.setPrefs(prefsWith({ success_stings_enabled: false }));
    expect(w.engine.play("success")).toBe(false);
    expect(w.engine.play("sting")).toBe(false);
    expect(w.engine.play("notification")).toBe(true);
    expect(w.totalPlays()).toBe(1);
  });

  it("device muted: ZERO plays for every kind, whatever the toggles say", () => {
    const w = makeWorld({ muted: true });
    for (const kind of KINDS) {
      expect(w.engine.canPlay(kind), kind).toBe(false);
      expect(w.engine.play(kind), kind).toBe(false);
      w.advance(SOUND_COOLDOWN_MS + 1);
    }
    expect(w.totalPlays()).toBe(0);
  });

  it("device mute landing mid-session closes the gate at once", () => {
    const w = makeWorld();
    expect(w.engine.play("notification")).toBe(true);
    w.setMuted(true);
    w.advance(SOUND_COOLDOWN_MS + 1);
    expect(w.engine.play("notification")).toBe(false);
    expect(w.totalPlays()).toBe(1);
  });

  it("hidden tab: no plays", () => {
    const w = makeWorld({ hidden: true });
    for (const kind of KINDS) expect(w.engine.play(kind)).toBe(false);
    expect(w.totalPlays()).toBe(0);
  });

  it("turning a switch off silences a sound already playing", () => {
    const w = makeWorld();
    expect(w.engine.play("ringtone")).toBe(true);
    const ring = w.handles[0]!;
    expect(ring.loop).toBe(true);
    w.engine.setPrefs(prefsWith({ ringtone_enabled: false }));
    expect(ring.pauses).toBeGreaterThan(0);
    expect(w.engine.play("ringtone")).toBe(false);
  });

  it("master off silences a sound already playing", () => {
    const w = makeWorld();
    expect(w.engine.play("notification")).toBe(true);
    w.engine.setPrefs(prefsWith({ master_enabled: false }));
    expect(w.handles[0]!.pauses).toBeGreaterThan(0);
  });
});

describe("signature sound engine — restraint", () => {
  it("per-kind cooldown collapses a burst into one play", () => {
    const w = makeWorld();
    expect(w.engine.play("notification")).toBe(true);
    expect(w.engine.play("notification")).toBe(false);
    w.advance(SOUND_COOLDOWN_MS - 1);
    expect(w.engine.play("notification")).toBe(false);
    w.advance(2);
    expect(w.engine.play("notification")).toBe(true);
    expect(w.totalPlays()).toBe(2);
  });

  it("one sound at a time: a new play retires the one still sounding", () => {
    const w = makeWorld();
    expect(w.engine.play("notification")).toBe(true);
    w.advance(SOUND_COOLDOWN_MS + 1);
    expect(w.engine.play("success")).toBe(true);
    expect(w.handles[0]!.pauses).toBeGreaterThan(0);
    expect(w.handles[1]!.plays).toBe(1);
  });

  it("stop() retires the ringtone", () => {
    const w = makeWorld();
    expect(w.engine.play("ringtone")).toBe(true);
    w.engine.stop("ringtone");
    expect(w.handles[0]!.pauses).toBeGreaterThan(0);
  });

  it("an audio factory that throws never breaks the caller", () => {
    const engine = createSoundEngine({
      createAudio: () => { throw new Error("no audio here"); },
      now: () => 0,
      isHidden: () => false,
      deviceMuted: () => false,
    });
    expect(engine.play("success")).toBe(false);
  });
});

describe("arrival tracker — bells seed silently, then sound new arrivals once", () => {
  const item = (id: string, kind = "follow", is_read = false) => ({ id, kind, is_read });

  it("first sighting seeds silently even with unread waiting", () => {
    const tracker = createArrivalTracker();
    expect(tracker.observe([item("1"), item("2")])).toBeNull();
  });

  it("a new notification arrival sounds the notification role", () => {
    const tracker = createArrivalTracker();
    tracker.observe([item("1")]);
    expect(tracker.observe([item("1"), item("2")])).toBe("notification");
    /* the same set again: nothing new, nothing sounds */
    expect(tracker.observe([item("1"), item("2")])).toBeNull();
  });

  it("a message arrival outranks a plain notification in the same poll", () => {
    const tracker = createArrivalTracker();
    tracker.observe([]);
    expect(tracker.observe([item("1", "follow"), item("2", "dm_request")])).toBe("message");
  });

  it("already-read arrivals never sound", () => {
    const tracker = createArrivalTracker();
    tracker.observe([]);
    expect(tracker.observe([item("1", "follow", true)])).toBeNull();
  });

  it("isMessageKind knows the rail's message kinds", () => {
    expect(isMessageKind("dm_request")).toBe(true);
    expect(isMessageKind("message")).toBe(true);
    expect(isMessageKind("follow")).toBe(false);
    expect(isMessageKind("release")).toBe(false);
  });

  it("soundForNewArrivals prunes ids that left the unread set", () => {
    const known = new Set<string>();
    soundForNewArrivals(known, [item("1")]);
    expect([...known]).toEqual(["1"]);
    soundForNewArrivals(known, [item("1", "follow", true)]);
    expect(known.size).toBe(0);
  });
});

describe("the manifest — the only place a sound file is named", () => {
  it("maps all six roles to wav assets under /sounds/", () => {
    for (const kind of KINDS) {
      expect(SIGNATURE_SOUND_ASSETS[kind]).toMatch(/^\/sounds\/.+\.wav$/);
    }
  });

  it("every manifest asset exists in public/sounds and is non-empty", () => {
    for (const kind of KINDS) {
      const rel = SIGNATURE_SOUND_ASSETS[kind].replace(/^\//, "");
      const path = new URL(`../../public/${rel}`, import.meta.url);
      const stat = statSync(path);
      expect(stat.size, SIGNATURE_SOUND_ASSETS[kind]).toBeGreaterThan(10_000);
    }
  });

  it("no other source file names a signature-sound asset (files-only swap)", () => {
    const srcRoot = new URL("../", import.meta.url).pathname;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        if (full.endsWith("signature-sound-manifest.ts")) continue;
        if (full.endsWith("signature-sounds.test.ts")) continue;
        const text = readFileSync(full, "utf8");
        if (text.includes("/sounds/signature-")) offenders.push(full);
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
