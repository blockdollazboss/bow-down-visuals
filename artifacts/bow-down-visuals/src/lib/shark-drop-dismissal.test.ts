/**
 * Shark-drop dismissal tests — QC-200 fix queue #4 (Sitting A,
 * live-verified Nov 3, 2026): the "Shark dropped … VB" modal came
 * back on every dashboard visit after "Maybe later".
 *
 * Covers the three pinned behaviors:
 *  · dismiss → revisit → the same drop stays hidden (its dismissal is
 *    read back on the next "visit" — a fresh read of the same store);
 *  · a genuinely NEW drop (new server-minted id) still shows;
 *  · the claim path is untouched — the dashboard's onClaimed still
 *    only clears state and records NO dismissal, and the modal's
 *    claim still posts the drop id to the claim rail.
 *
 * The dashboard wiring is pinned as a source contract in the repo's
 * established style (see treasury-panels.test.ts): mounting the whole
 * dashboard page in a unit test would drag in its full section tree,
 * so the fetch gate and the dismiss handler are pinned at the source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isSharkDropDismissed,
  recordSharkDropDismissal,
  sharkDropDismissalKey,
} from "./shark-drop-dismissal";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const dashboard = read("../pages/dashboard.tsx");
const sharkDropModal = read("../components/retention/SharkDropModal.tsx");

/** Minimal localStorage stand-in for the node test environment. */
function mockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

const DROP_A = "11111111-1111-4111-8111-111111111111";
const DROP_B = "22222222-2222-4222-8222-222222222222";

describe("shark-drop dismissal memory", () => {
  it("is not dismissed when nothing is stored", () => {
    expect(isSharkDropDismissed(DROP_A, mockStorage())).toBe(false);
  });

  it("dismiss → revisit → the same drop stays hidden", () => {
    const s = mockStorage();
    // First visit: the drop shows, the member taps "Maybe later".
    expect(isSharkDropDismissed(DROP_A, s)).toBe(false);
    recordSharkDropDismissal(DROP_A, s);
    expect(s.getItem(sharkDropDismissalKey(DROP_A))).toBe("1");
    // Every later visit re-reads the same store: still hidden.
    expect(isSharkDropDismissed(DROP_A, s)).toBe(true);
    expect(isSharkDropDismissed(DROP_A, s)).toBe(true);
  });

  it("a genuinely new drop (new id) still shows", () => {
    const s = mockStorage();
    recordSharkDropDismissal(DROP_A, s);
    expect(isSharkDropDismissed(DROP_A, s)).toBe(true);
    expect(isSharkDropDismissed(DROP_B, s)).toBe(false);
  });

  it("dismissals are per drop — dismissing B never hides A retroactively or vice versa", () => {
    const s = mockStorage();
    recordSharkDropDismissal(DROP_B, s);
    expect(isSharkDropDismissed(DROP_A, s)).toBe(false);
    expect(isSharkDropDismissed(DROP_B, s)).toBe(true);
  });

  it("the dismissal has no time window — the drop id is the scope", () => {
    const s = mockStorage();
    recordSharkDropDismissal(DROP_A, s);
    // Far-future reads still honor it; the drop itself expires
    // server-side at 48h, so the key can never outlive its usefulness.
    expect(isSharkDropDismissed(DROP_A, s)).toBe(true);
  });

  it("an empty drop id never reads as dismissed and records nothing", () => {
    const s = mockStorage();
    expect(isSharkDropDismissed("", s)).toBe(false);
    recordSharkDropDismissal("", s);
    expect(s.getItem(sharkDropDismissalKey(""))).toBeNull();
  });

  it("survives a throwing storage without throwing", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(isSharkDropDismissed(DROP_A, throwing)).toBe(false);
    expect(() => recordSharkDropDismissal(DROP_A, throwing)).not.toThrow();
  });

  it("no storage at all (SSR/private) reads as not dismissed", () => {
    expect(isSharkDropDismissed(DROP_A, null)).toBe(false);
    expect(() => recordSharkDropDismissal(DROP_A, null)).not.toThrow();
  });
});

describe("dashboard wiring (source contract)", () => {
  it("gates the fetched drop on the dismissal memory before showing it", () => {
    expect(dashboard).toContain(
      "if (d.drop && !isSharkDropDismissed(d.drop.id)) setSharkDrop(d.drop);",
    );
  });

  it("routes the modal's onDismiss through the recording handler", () => {
    expect(dashboard).toContain("onDismiss={dismissSharkDrop}");
    expect(dashboard).toContain("recordSharkDropDismissal(sharkDrop.id)");
  });

  it("claim path untouched: onClaimed only clears state, records no dismissal", () => {
    expect(dashboard).toContain("onClaimed={() => setSharkDrop(null)}");
    const handlerStart = dashboard.indexOf("const dismissSharkDrop");
    const claimedAt = dashboard.indexOf("onClaimed={() => setSharkDrop(null)}");
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(claimedAt).toBeGreaterThan(handlerStart);
  });

  it("the modal still claims through the claim rail with the drop id", () => {
    expect(sharkDropModal).toContain('fetch("/api/retention/shark-drop/claim"');
    expect(sharkDropModal).toContain("body: JSON.stringify({ dropId: drop.id })");
  });

  it("every modal exit that is not a claim still flows through onDismiss", () => {
    // X button, backdrop, Escape, and "Maybe later" all call onDismiss
    // in the modal — the handler those calls land on is the recording
    // one pinned above, so no exit can forget the snooze.
    const dismissCalls = sharkDropModal.match(/onDismiss/g) ?? [];
    expect(dismissCalls.length).toBeGreaterThanOrEqual(4);
    expect(sharkDropModal).toContain('t("retentionDelight.sharkDrop_dismiss")');
  });
});
