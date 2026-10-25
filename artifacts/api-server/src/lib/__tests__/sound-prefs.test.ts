/**
 * sound-prefs.test.ts — UPGRADES 183: per-account signature-sound
 * switches (migration 0242) against an in-memory store.
 *
 * Pins the storage contract the Settings card and the site engine
 * rely on: no row = the all-on DEFAULT; a PATCH merges over the
 * current prefs (never resets siblings); accounts are isolated; the
 * persisted roundtrip is exact.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOUND_PREFS,
  getSoundPrefs,
  setSoundPrefs,
  type SoundPrefsStore,
  type SoundPrefsWire,
} from "../sound-prefs";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function memoryStore(): SoundPrefsStore {
  const rows = new Map<string, SoundPrefsWire>();
  return {
    async getRow(userId) {
      const row = rows.get(userId);
      return row ? { ...row } : null;
    },
    async upsertRow(userId, prefs) {
      rows.set(userId, { ...prefs });
    },
  };
}

describe("sound prefs store", () => {
  it("no row yet: the all-on default, every switch true", async () => {
    const store = memoryStore();
    const prefs = await getSoundPrefs(store, USER_A);
    expect(prefs).toEqual(DEFAULT_SOUND_PREFS);
    expect(Object.values(prefs).every((v) => v === true)).toBe(true);
  });

  it("a patch persists and reads back exactly", async () => {
    const store = memoryStore();
    const saved = await setSoundPrefs(store, USER_A, { master_enabled: false });
    expect(saved.master_enabled).toBe(false);
    expect(await getSoundPrefs(store, USER_A)).toEqual(saved);
  });

  it("a patch merges — sibling switches keep their values", async () => {
    const store = memoryStore();
    await setSoundPrefs(store, USER_A, { notifications_enabled: false });
    const after = await setSoundPrefs(store, USER_A, { ringtone_enabled: false });
    expect(after.notifications_enabled).toBe(false);
    expect(after.ringtone_enabled).toBe(false);
    expect(after.messages_enabled).toBe(true);
    expect(after.master_enabled).toBe(true);
  });

  it("an empty patch is a no-op that returns the current prefs", async () => {
    const store = memoryStore();
    await setSoundPrefs(store, USER_A, { errors_enabled: false });
    const after = await setSoundPrefs(store, USER_A, {});
    expect(after.errors_enabled).toBe(false);
    expect(after.master_enabled).toBe(true);
  });

  it("accounts are isolated", async () => {
    const store = memoryStore();
    await setSoundPrefs(store, USER_A, { master_enabled: false });
    expect((await getSoundPrefs(store, USER_B)).master_enabled).toBe(true);
    expect((await getSoundPrefs(store, USER_A)).master_enabled).toBe(false);
  });

  it("every switch can be turned off and back on", async () => {
    const store = memoryStore();
    const allOff: SoundPrefsWire = {
      master_enabled: false,
      notifications_enabled: false,
      messages_enabled: false,
      success_stings_enabled: false,
      errors_enabled: false,
      ringtone_enabled: false,
    };
    expect(await setSoundPrefs(store, USER_A, allOff)).toEqual(allOff);
    expect(await setSoundPrefs(store, USER_A, DEFAULT_SOUND_PREFS)).toEqual(DEFAULT_SOUND_PREFS);
  });
});
