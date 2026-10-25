/**
 * theme-kit-sound-stamp.test.ts — Stack-200 join #12: the sound-pref
 * binding the theme-packs lane left as its open item 1.
 *
 * The lane's pack-apply stamped only the local seam (localStorage
 * "bdv-sound-set" + the applied event) because sound_prefs (migration
 * 0242) did not exist on its base. Joined, applying an entitled pack
 * must ALSO write the pack's sound roles into the account's
 * sound_prefs (PATCH /api/sound-prefs) — the v7 house set BY ROLE,
 * through the signature-sound-manifest, no per-pack forks — and an
 * unentitled pack must stamp NOTHING.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIGNATURE_SOUND_ASSETS } from "@/lib/signature-sound-manifest";
import {
  DEFAULT_SOUND_PREFS,
  signatureSounds,
  type SoundPrefs,
} from "@/lib/signature-sounds";
import {
  COMPONENT_SOUND_ROLES,
  PACK_SOUNDS_APPLIED_EVENT,
  SOUND_LIBRARY_ROLES,
  SOUND_ROLE_ENGINE_KIND,
  SOUND_ROLE_PREF_SWITCH,
  SOUND_SET_STAMP_KEY,
  SOUND_SET_STAMP_VALUE,
  soundLibraryPath,
  soundManifestAssetForRole,
  soundPrefsPatchForPackSounds,
  stampPackSoundsForApply,
  type SoundPrefsFetch,
} from "@/lib/theme-kit";

const ALL_ON: SoundPrefs = { ...DEFAULT_SOUND_PREFS };
const ALL_OFF: SoundPrefs = {
  master_enabled: false,
  notifications_enabled: false,
  messages_enabled: false,
  success_stings_enabled: false,
  errors_enabled: false,
  ringtone_enabled: false,
};

afterEach(() => {
  signatureSounds.setPrefs({ ...DEFAULT_SOUND_PREFS });
});

describe("sound roles resolve through the signature-sound-manifest — one source, no forks", () => {
  it("every pack sound role's library path IS its manifest asset", () => {
    for (const role of SOUND_LIBRARY_ROLES) {
      expect(soundManifestAssetForRole(role)).toBe(
        SIGNATURE_SOUND_ASSETS[SOUND_ROLE_ENGINE_KIND[role]],
      );
      expect(soundLibraryPath(role)).toBe(soundManifestAssetForRole(role));
    }
  });

  it("the pack sound scheme is the full six-role house set", () => {
    expect(COMPONENT_SOUND_ROLES["sound-scheme"]).toEqual([
      ...SOUND_LIBRARY_ROLES,
    ]);
  });
});

describe("the stamp patch reflects the pack's roles", () => {
  it("enables master + the governing switch of every scheme role", () => {
    const patch = soundPrefsPatchForPackSounds();
    expect(patch.master_enabled).toBe(true);
    for (const role of COMPONENT_SOUND_ROLES["sound-scheme"]) {
      expect(patch[SOUND_ROLE_PREF_SWITCH[role]], role).toBe(true);
    }
    // All six roles land on exactly the six account switches.
    expect(patch).toEqual(ALL_ON);
  });
});

describe("stampPackSoundsForApply", () => {
  function harness(savedPrefs: SoundPrefs) {
    const storage = new Map<string, string>();
    const dispatched: string[] = [];
    const calls: Array<{
      url: string;
      init: { method: string; headers: Record<string, string>; body: string };
    }> = [];
    const fetchImpl: SoundPrefsFetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => savedPrefs };
    };
    return {
      storage,
      dispatched,
      calls,
      deps: {
        fetchImpl,
        storageSet: (k: string, v: string) => storage.set(k, v),
        dispatchApplied: (packId: string) => dispatched.push(packId),
      },
    };
  }

  it("apply pack → sound prefs reflect the pack's roles (account PATCH + engine push + local seam)", async () => {
    signatureSounds.setPrefs({ ...ALL_OFF });
    const h = harness(ALL_ON);
    const result = await stampPackSoundsForApply("kings-set", {
      unlocked: true,
      getAccessToken: async () => "tok-123",
      ...h.deps,
    });
    expect(result).toEqual({ localStamped: true, accountStamped: true });
    // The account stamp: one PATCH to the sound-prefs rail, authed,
    // carrying exactly the pack-role patch.
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe("/api/sound-prefs");
    expect(h.calls[0].init.method).toBe("PATCH");
    expect(h.calls[0].init.headers.Authorization).toBe("Bearer tok-123");
    expect(JSON.parse(h.calls[0].init.body)).toEqual(
      soundPrefsPatchForPackSounds(),
    );
    // The live engine now holds the saved prefs — playback follows.
    expect(signatureSounds.getPrefs()).toEqual(ALL_ON);
    // The local seam the lane built still lands.
    expect(h.storage.get(SOUND_SET_STAMP_KEY)).toBe(SOUND_SET_STAMP_VALUE);
    expect(h.dispatched).toEqual(["kings-set"]);
    expect(PACK_SOUNDS_APPLIED_EVENT).toBe("bdv-pack-sounds-applied");
  });

  it("unentitled pack → no stamp at all (no fetch, no local seam, engine untouched)", async () => {
    signatureSounds.setPrefs({ ...ALL_OFF });
    const h = harness(ALL_ON);
    const getAccessToken = vi.fn(async () => "tok-123");
    const result = await stampPackSoundsForApply("kings-set", {
      unlocked: false,
      getAccessToken,
      ...h.deps,
    });
    expect(result).toEqual({ localStamped: false, accountStamped: false });
    expect(h.calls).toHaveLength(0);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(h.storage.size).toBe(0);
    expect(h.dispatched).toEqual([]);
    expect(signatureSounds.getPrefs()).toEqual(ALL_OFF);
  });

  it("signed-out apply → local seam only, no account call", async () => {
    const h = harness(ALL_ON);
    const result = await stampPackSoundsForApply("golden-marble", {
      unlocked: true,
      getAccessToken: async () => null,
      ...h.deps,
    });
    expect(result).toEqual({ localStamped: true, accountStamped: false });
    expect(h.calls).toHaveLength(0);
    expect(h.storage.get(SOUND_SET_STAMP_KEY)).toBe(SOUND_SET_STAMP_VALUE);
    expect(h.dispatched).toEqual(["golden-marble"]);
  });

  it("a failed account stamp never breaks the apply (local seam stands)", async () => {
    const h = harness(ALL_ON);
    const failingFetch: SoundPrefsFetch = async () => {
      throw new Error("network down");
    };
    const result = await stampPackSoundsForApply("golden-marble", {
      unlocked: true,
      getAccessToken: async () => "tok-123",
      ...h.deps,
      fetchImpl: failingFetch,
    });
    expect(result).toEqual({ localStamped: true, accountStamped: false });
    expect(h.storage.get(SOUND_SET_STAMP_KEY)).toBe(SOUND_SET_STAMP_VALUE);
  });
});
