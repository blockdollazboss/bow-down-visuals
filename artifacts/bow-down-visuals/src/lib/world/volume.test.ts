/**
 * volume.test.ts — the World's master volume (stack900, lane G3).
 *
 * Pinned contract:
 * - the gain math: level/100, mute (or level 0) is silence, owned
 *   bases compose multiplicatively and clamp — the jukebox's 0.85
 *   is 0.85 OF the master, never beside it;
 * - the device store: absent/garbled storage reads as the default
 *   (full, unmuted), a stored setting round-trips, storage throwing
 *   never breaks the read or the write;
 * - the control transitions: dragging the slider up un-mutes (the
 *   level is the ask), the mute tap preserves the level exactly;
 * - composition: the master and the announcements mute are separate
 *   stores — neither writes the other (the sting's call site checks
 *   the announce mute first; this fader can only scale);
 * - the media choke: one register/apply path — base captured at
 *   first sight (a declared data base wins), re-registering never
 *   re-captures a scaled value as the base, master changes re-apply
 *   to every registered element, the choke never touches `muted`,
 *   and a walker's own native-volume drag re-bases instead of
 *   being fought;
 * - the wiring (source pins): the header control beside the
 *   announcements toggle, the jukebox/radio/engine/voice choke
 *   points, and the Charts page NOT receiving the World fader.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORLD_VOLUME,
  WORLD_VOLUME_KEY,
  createWorldMediaChoke,
  getWorldVolume,
  loadWorldVolume,
  scaledWorldVolume,
  setWorldVolume,
  storeWorldVolume,
  subscribeWorldVolume,
  withWorldVolumeLevel,
  withWorldVolumeMuted,
  worldVolumeGain,
  type WorldMediaElementLike,
  type WorldVolume,
} from "./volume";
import { ANNOUNCE_MUTED_KEY, loadAnnounceMuted, storeAnnounceMuted } from "./announce";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

/* ── The gain math ─────────────────────────────────────────────── */

describe("worldVolumeGain", () => {
  it("is unity at the default (100, unmuted)", () => {
    expect(worldVolumeGain(DEFAULT_WORLD_VOLUME)).toBe(1);
    expect(worldVolumeGain({ level: 100, muted: false })).toBe(1);
  });
  it("is the level as a fraction", () => {
    expect(worldVolumeGain({ level: 50, muted: false })).toBe(0.5);
    expect(worldVolumeGain({ level: 25, muted: false })).toBe(0.25);
    expect(worldVolumeGain({ level: 1, muted: false })).toBeCloseTo(0.01);
  });
  it("is silence at level 0 and under mute at ANY level", () => {
    expect(worldVolumeGain({ level: 0, muted: false })).toBe(0);
    expect(worldVolumeGain({ level: 100, muted: true })).toBe(0);
    expect(worldVolumeGain({ level: 40, muted: true })).toBe(0);
  });
});

describe("scaledWorldVolume (owned bases compose)", () => {
  it("scales the jukebox's designed 0.85 by the master", () => {
    expect(scaledWorldVolume(0.85, { level: 100, muted: false })).toBeCloseTo(0.85);
    expect(scaledWorldVolume(0.85, { level: 50, muted: false })).toBeCloseTo(0.425);
    expect(scaledWorldVolume(0.85, { level: 80, muted: true })).toBe(0);
  });
  it("clamps an over-unity or garbage base instead of amplifying", () => {
    expect(scaledWorldVolume(1.4, { level: 100, muted: false })).toBe(1);
    expect(scaledWorldVolume(Number.NaN, { level: 100, muted: false })).toBe(0);
    expect(scaledWorldVolume(-0.5, { level: 100, muted: false })).toBe(0);
  });
});

/* ── The device store ──────────────────────────────────────────── */

describe("loadWorldVolume / storeWorldVolume", () => {
  it("reads the default on absent storage", () => {
    expect(loadWorldVolume(fakeStorage())).toEqual(DEFAULT_WORLD_VOLUME);
    expect(loadWorldVolume(null)).toEqual(DEFAULT_WORLD_VOLUME);
  });
  it("round-trips a stored setting", () => {
    const s = fakeStorage();
    storeWorldVolume({ level: 35, muted: true }, s);
    expect(loadWorldVolume(s)).toEqual({ level: 35, muted: true });
  });
  it("reads the default on garbled storage, and sanitizes a partial one", () => {
    expect(loadWorldVolume(fakeStorage({ [WORLD_VOLUME_KEY]: "not json{" }))).toEqual(DEFAULT_WORLD_VOLUME);
    expect(loadWorldVolume(fakeStorage({ [WORLD_VOLUME_KEY]: "{}" }))).toEqual(DEFAULT_WORLD_VOLUME);
    expect(loadWorldVolume(fakeStorage({ [WORLD_VOLUME_KEY]: JSON.stringify({ level: 250 }) }))).toEqual({ level: 100, muted: false });
    expect(loadWorldVolume(fakeStorage({ [WORLD_VOLUME_KEY]: JSON.stringify({ level: 33.6, muted: 1 }) }))).toEqual({ level: 34, muted: false });
  });
  it("survives storage that throws (private modes)", () => {
    const hostile = {
      getItem: () => { throw new Error("nope"); },
      setItem: () => { throw new Error("nope"); },
    };
    expect(loadWorldVolume(hostile)).toEqual(DEFAULT_WORLD_VOLUME);
    expect(() => storeWorldVolume({ level: 10, muted: false }, hostile)).not.toThrow();
  });
  it("sanitizes on the way in: levels clamp + round, garbage falls back to full", () => {
    expect(setWorldVolume({ level: 101, muted: false }).level).toBe(100);
    expect(setWorldVolume({ level: -3, muted: false }).level).toBe(0);
    expect(setWorldVolume({ level: Number.NaN, muted: false }).level).toBe(100);
  });
});

/* ── The live mirror + subscription ────────────────────────────── */

describe("the mirror every choke point follows", () => {
  it("setWorldVolume updates the mirror and notifies; unsubscribe stops the word", () => {
    const seen: WorldVolume[] = [];
    const unsub = subscribeWorldVolume((v) => seen.push(v));
    setWorldVolume({ level: 60, muted: false });
    expect(getWorldVolume()).toEqual({ level: 60, muted: false });
    expect(seen).toEqual([{ level: 60, muted: false }]);
    unsub();
    setWorldVolume({ level: 70, muted: false });
    expect(seen).toHaveLength(1);
    setWorldVolume({ ...DEFAULT_WORLD_VOLUME });
  });
});

/* ── Control transitions ───────────────────────────────────────── */

describe("withWorldVolumeLevel / withWorldVolumeMuted", () => {
  it("dragging up from muted un-mutes — the level is the ask", () => {
    expect(withWorldVolumeLevel({ level: 30, muted: true }, 55)).toEqual({ level: 55, muted: false });
  });
  it("dragging to 0 is silence with the flag left as it stands", () => {
    expect(withWorldVolumeLevel({ level: 30, muted: false }, 0)).toEqual({ level: 0, muted: false });
    expect(withWorldVolumeLevel({ level: 30, muted: true }, 0)).toEqual({ level: 0, muted: true });
  });
  it("the mute tap preserves the level exactly, both ways", () => {
    expect(withWorldVolumeMuted({ level: 42, muted: false }, true)).toEqual({ level: 42, muted: true });
    expect(withWorldVolumeMuted({ level: 42, muted: true }, false)).toEqual({ level: 42, muted: false });
  });
});

/* ── Composition with the announcements mute ───────────────────── */

describe("composition: master volume × announcements mute", () => {
  it("are separate stores under separate keys — neither writes the other", () => {
    expect(WORLD_VOLUME_KEY).not.toBe(ANNOUNCE_MUTED_KEY);
    const s = fakeStorage();
    storeAnnounceMuted(true, s);
    storeWorldVolume({ level: 20, muted: false }, s);
    expect(loadAnnounceMuted(s)).toBe(true);
    expect(loadWorldVolume(s)).toEqual({ level: 20, muted: false });
  });
  it("the sting's gates stay upstream: the page checks the announce mute before the engine, and the fader only scales (source pins)", () => {
    const page = read("../../pages/world.tsx");
    expect(page).toContain("!announceMutedRef.current && isAnnounceFresh(a, Date.now())) playSignatureSound(\"sting\")");
    expect(page).toContain("signatureSounds.setOutputScale(worldVolumeGain(worldVolume))");
  });
});

/* ── The media choke ───────────────────────────────────────────── */

function fakeVolumeSource(initial: WorldVolume) {
  let v = initial;
  const subs = new Set<(v: WorldVolume) => void>();
  return {
    getVolume: () => v,
    subscribe: (fn: (v: WorldVolume) => void) => {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    set(next: WorldVolume) {
      v = next;
      for (const fn of [...subs]) fn(v);
    },
  };
}

function fakeEl(volume = 1, dataset: Record<string, string | undefined> = {}): WorldMediaElementLike {
  return { volume, muted: false, dataset };
}

describe("createWorldMediaChoke", () => {
  it("applies base × gain at registration", () => {
    const src = fakeVolumeSource({ level: 50, muted: false });
    const choke = createWorldMediaChoke(src);
    const el = fakeEl(1);
    choke.register(el);
    expect(el.volume).toBeCloseTo(0.5);
    expect(choke.appliedFor(el)).toBeCloseTo(0.5);
    choke.dispose();
  });

  it("a declared data base wins over the element's current volume", () => {
    const src = fakeVolumeSource({ level: 50, muted: false });
    const choke = createWorldMediaChoke(src);
    const el = fakeEl(1, { worldBaseVolume: "0.85" });
    choke.register(el);
    expect(el.volume).toBeCloseTo(0.425);
    choke.dispose();
  });

  it("follows every master change across every registered element", () => {
    const src = fakeVolumeSource({ level: 100, muted: false });
    const choke = createWorldMediaChoke(src);
    const a = fakeEl(1);
    const b = fakeEl(0.8);
    choke.register(a);
    choke.register(b);
    src.set({ level: 25, muted: false });
    expect(a.volume).toBeCloseTo(0.25);
    expect(b.volume).toBeCloseTo(0.2);
    src.set({ level: 25, muted: true });
    expect(a.volume).toBe(0);
    expect(b.volume).toBe(0);
    src.set({ level: 100, muted: false });
    expect(a.volume).toBeCloseTo(1);
    expect(b.volume).toBeCloseTo(0.8);
    choke.dispose();
  });

  it("re-registering never re-captures a scaled value as the base", () => {
    const src = fakeVolumeSource({ level: 50, muted: false });
    const choke = createWorldMediaChoke(src);
    const el = fakeEl(1);
    choke.register(el);
    expect(el.volume).toBeCloseTo(0.5);
    choke.register(el); // a second play event, mid-song
    src.set({ level: 100, muted: false });
    expect(el.volume).toBeCloseTo(1); // the base was 1, not the scaled 0.5
    choke.dispose();
  });

  it("registers silently under a muted master and restores on unmute", () => {
    const src = fakeVolumeSource({ level: 70, muted: true });
    const choke = createWorldMediaChoke(src);
    const el = fakeEl(1);
    choke.register(el);
    expect(el.volume).toBe(0);
    src.set({ level: 70, muted: false });
    expect(el.volume).toBeCloseTo(0.7);
    choke.dispose();
  });

  it("never touches an element's muted flag (muted-by-design stays muted)", () => {
    const src = fakeVolumeSource({ level: 30, muted: false });
    const choke = createWorldMediaChoke(src);
    const el = fakeEl(1);
    el.muted = true; // a figure loop / room screen: silent by construction
    choke.register(el);
    src.set({ level: 90, muted: false });
    expect(el.muted).toBe(true);
    choke.dispose();
  });

  it("a walker's native-volume drag re-bases instead of being fought", () => {
    const src = fakeVolumeSource({ level: 50, muted: false });
    const choke = createWorldMediaChoke(src);
    const el = fakeEl(1);
    choke.register(el);
    expect(el.volume).toBeCloseTo(0.5);
    el.volume = 0.3; // the walker dragged the desk video's own slider
    choke.noteExternalVolume(el);
    expect(el.volume).toBeCloseTo(0.3); // their hand stands
    src.set({ level: 100, muted: false });
    expect(el.volume).toBeCloseTo(0.6); // the new base (0.3 / 0.5), at full master
    choke.dispose();
  });

  it("recognizes its own writes by value and ignores the echo", () => {
    const src = fakeVolumeSource({ level: 50, muted: false });
    const choke = createWorldMediaChoke(src);
    const el = fakeEl(1);
    choke.register(el);
    choke.noteExternalVolume(el); // the volumechange our own write fired
    src.set({ level: 100, muted: false });
    expect(el.volume).toBeCloseTo(1); // base still 1 — no phantom re-base
    choke.dispose();
  });

  it("cannot infer a base from silence: native drags under a muted master leave the base alone", () => {
    const src = fakeVolumeSource({ level: 50, muted: true });
    const choke = createWorldMediaChoke(src);
    const el = fakeEl(1);
    choke.register(el);
    el.volume = 0.44;
    choke.noteExternalVolume(el);
    src.set({ level: 100, muted: false });
    expect(el.volume).toBeCloseTo(1); // base still the captured 1
    choke.dispose();
  });

  it("release forgets an element; dispose stops following the master", () => {
    const src = fakeVolumeSource({ level: 100, muted: false });
    const choke = createWorldMediaChoke(src);
    const a = fakeEl(1);
    const b = fakeEl(1);
    choke.register(a);
    choke.register(b);
    choke.release(a);
    expect(choke.appliedFor(a)).toBeNull();
    src.set({ level: 10, muted: false });
    expect(a.volume).toBe(1);
    expect(b.volume).toBeCloseTo(0.1);
    choke.dispose();
    src.set({ level: 90, muted: false });
    expect(b.volume).toBeCloseTo(0.1);
  });
});

/* ── The wiring (source pins) ──────────────────────────────────── */

describe("wiring", () => {
  const page = read("../../pages/world.tsx");

  it("the header control stands beside the announcements toggle, inside the header", () => {
    const announceAt = page.indexOf('data-testid="world-announce-toggle"');
    const volumeAt = page.indexOf('data-testid="world-volume-control"');
    const fullscreenAt = page.indexOf('data-testid="world-fullscreen"');
    expect(announceAt).toBeGreaterThan(-1);
    expect(volumeAt).toBeGreaterThan(announceAt);
    expect(fullscreenAt).toBeGreaterThan(volumeAt);
    expect(page).toContain('data-testid="world-volume-mute"');
    expect(page).toContain('data-testid="world-volume-slider"');
    expect(page).toContain("setWorldVolume(withWorldVolumeMuted(worldVolume, !worldVolume.muted))");
    expect(page).toContain("setWorldVolume(withWorldVolumeLevel(worldVolume, Number(e.target.value)))");
  });

  it("the jukebox applies the store to its designed 0.85 (detached element, owner-applied)", () => {
    expect(page).toContain("scaledWorldVolume(0.85, getWorldVolume())");
    expect(page).toContain("el.volume = scaledWorldVolume(0.85, v);");
  });

  it("the in-World radio receives the master gain as its scale", () => {
    expect(page).toContain("<ChartsRadioPanel compact volumeScale={worldVolumeGain(worldVolume)} />");
  });

  it("the page's media choke is installed on the page root and disposed on exit", () => {
    expect(page).toContain("createWorldMediaChoke()");
    expect(page).toContain('addEventListener("play", onPlay, true)');
    expect(page).toContain('addEventListener("volumechange", onVolumeChange, true)');
    expect(page).toContain("choke.dispose()");
  });

  it("leaving the World restores the signature engine to the site's own loudness", () => {
    expect(page).toContain("signatureSounds.setOutputScale(1);");
  });

  it("voice receive routes through the master gain; the local level tap stays raw", () => {
    const voice = read("./voice.ts");
    const sink = voice.slice(voice.indexOf("export function createBrowserVoiceSink"));
    expect(sink).toContain("gain.connect(masterVoiceGain(ctx))");
    const tap = voice.slice(
      voice.indexOf("export function createLocalLevelTap"),
      voice.indexOf("export function createBrowserVoiceSink"),
    );
    expect(tap).not.toContain("masterVoiceGain");
  });

  it("the Charts page does NOT receive the World fader (surface separation)", () => {
    const charts = read("../../pages/discovery/charts.tsx");
    expect(charts).not.toContain("volumeScale");
    const radio = read("../../components/discovery/ChartsRadio.tsx");
    expect(radio).toContain("volumeScale = 1");
  });
});
