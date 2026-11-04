/**
 * theme-packs-entitlements.test.ts — QC fix #12 (Sitting B minor).
 *
 * The defect: after buying The King's Set, a reload showed the "Own
 * it forever — 1,000 VB" buy button for ~10s before OWNED appeared.
 * The charge had persisted server-side; the desk's entitlement feed
 * (GET /api/theme-packs/state) only starts once auth yields a user +
 * token, and the desk rendered its still-empty owned list as "not
 * owned" — with no distinction between "feed unresolved" and "feed
 * says not owned". Worse, the post-purchase revalidation REPLACED the
 * owned list, so a stale read could un-own the just-bought pack.
 *
 * The fix's load-bearing pieces, pinned here:
 *  - mergeOwnedPackIds: readings merge as unions (owned is forever —
 *    a reading can add an id, never remove one);
 *  - the per-user localStorage cache of owned ids: round-trips,
 *    validates ids against the registry, isolates users, and treats
 *    corrupt data as empty;
 *  - the desk source: premium cards render a "checking" state while
 *    the feed is unresolved, hydrate from the cache, and never assign
 *    the feed's list wholesale again.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cacheOwnedPackIds,
  mergeOwnedPackIds,
  readCachedOwnedPackIds,
} from "@/lib/theme-packs";

class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

function stubStorage(): FakeStorage {
  const storage = new FakeStorage();
  vi.stubGlobal("localStorage", storage);
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mergeOwnedPackIds — readings only ever add", () => {
  it("a stale (empty) reading cannot un-own a bought pack", () => {
    expect(mergeOwnedPackIds(["kings-set"], [])).toEqual(["kings-set"]);
  });

  it("a fresh reading adds newly bought packs, without duplicates", () => {
    expect(mergeOwnedPackIds(["kings-set"], ["kings-set", "arcade-gold"])).toEqual([
      "kings-set",
      "arcade-gold",
    ]);
    expect(mergeOwnedPackIds([], ["kings-set"])).toEqual(["kings-set"]);
    expect(mergeOwnedPackIds([], [])).toEqual([]);
  });
});

describe("the per-user owned-ids cache", () => {
  it("round-trips the owned ids for the same user", () => {
    stubStorage();
    cacheOwnedPackIds("user-a", ["kings-set", "arcade-gold"]);
    expect(readCachedOwnedPackIds("user-a")).toEqual(["kings-set", "arcade-gold"]);
  });

  it("isolates users — one account's cache never paints another's OWNED", () => {
    stubStorage();
    cacheOwnedPackIds("user-a", ["kings-set"]);
    expect(readCachedOwnedPackIds("user-b")).toEqual([]);
  });

  it("drops ids that are not real packs (corrupt or foreign data)", () => {
    const storage = stubStorage();
    storage.setItem(
      "bdv-theme-pack-owned:user-a",
      JSON.stringify(["kings-set", "not-a-pack", 42, null]),
    );
    expect(readCachedOwnedPackIds("user-a")).toEqual(["kings-set"]);
    cacheOwnedPackIds("user-a", ["kings-set", "invented-pack"]);
    expect(readCachedOwnedPackIds("user-a")).toEqual(["kings-set"]);
  });

  it("treats corrupt cache data as empty, and no user as no cache", () => {
    const storage = stubStorage();
    storage.setItem("bdv-theme-pack-owned:user-a", "{not json");
    expect(readCachedOwnedPackIds("user-a")).toEqual([]);
    storage.setItem("bdv-theme-pack-owned:user-a", JSON.stringify({ owned: ["kings-set"] }));
    expect(readCachedOwnedPackIds("user-a")).toEqual([]);
    expect(readCachedOwnedPackIds(null)).toEqual([]);
    expect(readCachedOwnedPackIds(undefined)).toEqual([]);
    cacheOwnedPackIds(null, ["kings-set"]);
    expect(readCachedOwnedPackIds("user-a")).toEqual([]);
  });
});

describe("the desk never paints a false Buy window (source pins)", () => {
  const desk = readFileSync(
    new URL("../components/theme-packs/ThemePacksDesk.tsx", import.meta.url),
    "utf8",
  );

  it("tracks feed resolution and passes the pending state to the cards", () => {
    expect(desk).toContain("entitlementsReady");
    expect(desk).toContain("entitlementsPending={Boolean(user) && !entitlementsReady}");
  });

  it("a premium card renders a checking state while the feed is unresolved", () => {
    expect(desk).toContain("theme-pack-checking-${pack.id}");
    expect(desk).toContain("Checking your packs…");
    // The checking branch stands between the unlocked branch and the
    // buy branch in the card's action chain.
    const unlockedAt = desk.indexOf(") : unlocked ? (");
    const checkingAt = desk.indexOf(") : entitlementsPending ? (");
    const buyAt = desk.indexOf(") : signedIn ? (");
    expect(unlockedAt).toBeGreaterThanOrEqual(0);
    expect(checkingAt).toBeGreaterThan(unlockedAt);
    expect(buyAt).toBeGreaterThan(checkingAt);
  });

  it("hydrates from the per-user cache and merges feed readings — never replaces", () => {
    expect(desk).toContain("readCachedOwnedPackIds(user.id)");
    expect(desk).toContain("mergeOwnedPackIds");
    expect(desk).not.toContain("setOwnedIds(json.owned");
  });

  it("a completed purchase applies + caches the bought id before revalidating", () => {
    expect(desk).toContain("applyOwnedIds([pack.id])");
  });
});
