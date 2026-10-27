/**
 * creator-live-prefs.test.ts — UPGRADE deltas #172/#166: per-creator
 * live automation switches against an in-memory store.
 *
 * Pins the contract the Stream Copilot desk and the automation libs
 * rely on: no row = the all-on DEFAULT (link rules empty); a PATCH
 * merges over the current prefs; link rules are sanitized at the
 * write seam (http(s) only, deduped, capped); accounts isolated.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_PREFS,
  MAX_LINK_RULES,
  getLivePrefs,
  sanitizeLinkRules,
  setLivePrefs,
  type LivePrefsStore,
  type LivePrefsWire,
} from "../creator-live-prefs";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function memoryStore(): LivePrefsStore {
  const rows = new Map<string, LivePrefsWire>();
  return {
    async getRow(userId) {
      const row = rows.get(userId);
      return row ? { ...row, stage_manager_link_rules: [...row.stage_manager_link_rules] } : null;
    },
    async upsertRow(userId, prefs) {
      rows.set(userId, { ...prefs, stage_manager_link_rules: [...prefs.stage_manager_link_rules] });
    },
  };
}

describe("creator live prefs store", () => {
  it("no row yet: the all-on default with empty link rules", async () => {
    const store = memoryStore();
    const prefs = await getLivePrefs(store, USER_A);
    expect(prefs).toEqual(DEFAULT_LIVE_PREFS);
    expect(prefs.stage_manager_link_rules).toEqual([]);
  });

  it("a patch persists and merges — siblings keep their values", async () => {
    const store = memoryStore();
    await setLivePrefs(store, USER_A, { auto_highlights_enabled: false });
    const after = await setLivePrefs(store, USER_A, { stage_manager_pin_enabled: false });
    expect(after.auto_highlights_enabled).toBe(false);
    expect(after.stage_manager_pin_enabled).toBe(false);
    expect(after.stage_manager_enabled).toBe(true);
    expect(await getLivePrefs(store, USER_A)).toEqual(after);
  });

  it("accounts are isolated", async () => {
    const store = memoryStore();
    await setLivePrefs(store, USER_A, { stage_manager_enabled: false });
    expect((await getLivePrefs(store, USER_B)).stage_manager_enabled).toBe(true);
  });

  it("link rules persist through the store", async () => {
    const store = memoryStore();
    const rules = [{ keyword: "merch", label: "My merch", url: "https://example.com/merch" }];
    const saved = await setLivePrefs(store, USER_A, { stage_manager_link_rules: rules });
    expect(saved.stage_manager_link_rules).toEqual(rules);
    // A later boolean patch must not wipe the rules.
    const after = await setLivePrefs(store, USER_A, { stage_manager_sting_enabled: false });
    expect(after.stage_manager_link_rules).toEqual(rules);
  });
});

describe("sanitizeLinkRules", () => {
  it("keeps valid http(s) rules and normalizes keywords", () => {
    expect(
      sanitizeLinkRules([{ keyword: "  MERCH ", label: "Merch", url: "https://example.com/m" }]),
    ).toEqual([{ keyword: "merch", label: "Merch", url: "https://example.com/m" }]);
  });

  it("drops non-http(s), malformed, and undersized entries", () => {
    expect(
      sanitizeLinkRules([
        { keyword: "x", label: "Short kw", url: "https://example.com" },
        { keyword: "ok", label: "", url: "https://example.com" },
        { keyword: "ok2", label: "Ftp", url: "ftp://example.com/f" },
        { keyword: "ok3", label: "Bad url", url: "not a url" },
        { keyword: "ok4", label: "JS", url: "javascript:alert(1)" },
        "junk",
        null,
      ]),
    ).toEqual([]);
  });

  it("dedupes by keyword (first wins) and caps the list", () => {
    const many = Array.from({ length: MAX_LINK_RULES + 5 }, (_, i) => ({
      keyword: `kw${i}`,
      label: `L${i}`,
      url: `https://example.com/${i}`,
    }));
    const out = sanitizeLinkRules([
      { keyword: "dup", label: "First", url: "https://example.com/a" },
      { keyword: "dup", label: "Second", url: "https://example.com/b" },
      ...many,
    ]);
    expect(out).toHaveLength(MAX_LINK_RULES);
    expect(out[0]).toEqual({ keyword: "dup", label: "First", url: "https://example.com/a" });
  });

  it("non-array input reads as no rules", () => {
    expect(sanitizeLinkRules(undefined)).toEqual([]);
    expect(sanitizeLinkRules({ keyword: "merch" })).toEqual([]);
  });
});
