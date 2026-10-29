/**
 * First-session pop-up coordinator pins (QC G10, stack800 lane 8).
 *
 * The defect: globally-mounted pop-ups each kept their own trigger and
 * memory, so first-session pop-ups stacked blind — the extension
 * upsell (z-9990, 12s timer) could paint over the "while you were
 * away" digest (z-90) on a returning member's first screen.
 *
 * Pinned here, over the real coordinator with fake storage + clock:
 *   1. Announcement before upsell — an upsell never takes the slot
 *      while an announcement holds it, and a waiting announcement
 *      outranks a waiting upsell when the slot frees.
 *   2. Once-per-session memory — a shown pop-up can never claim again
 *      in the same session, even after it closes; a new session can.
 *   3. Per-person restraint — an upsell shows the same person at most
 *      once per 24h across sessions; other people are unaffected;
 *      at most one upsell claims per session however many exist;
 *      announcements are exempt from the upsell restraints.
 */
import { describe, expect, it } from "vitest";
import {
  createPopupCoordinator,
  decidePopupEligibility,
  UPSELL_PERSON_COOLDOWN_MS,
  type PopupSpec,
  type PopupStorage,
} from "../popup-coordinator";

const REGISTRY: Record<string, PopupSpec> = {
  news: { class: "announcement", priority: 100 },
  holder: { class: "announcement", priority: 50 },
  "upsell-a": { class: "upsell", priority: 10 },
  "upsell-b": { class: "upsell", priority: 20 },
};

function fakeStorage(): PopupStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function rig(opts?: { session?: PopupStorage; person?: PopupStorage; start?: number }) {
  const session = opts?.session ?? fakeStorage();
  const person = opts?.person ?? fakeStorage();
  let clock = opts?.start ?? 1_000_000;
  const coordinator = createPopupCoordinator({
    registry: REGISTRY,
    session,
    person,
    now: () => clock,
  });
  return {
    coordinator,
    session,
    person,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("ordering — announcement before upsell", () => {
  it("an upsell waits while an announcement holds the slot, then is promoted on release", () => {
    const { coordinator } = rig();
    expect(coordinator.claim("news", "person-a")).toBe(true);
    expect(coordinator.claim("upsell-a", "person-a")).toBe(false);
    expect(coordinator.activeId()).toBe("news");
    coordinator.release("news");
    expect(coordinator.activeId()).toBe("upsell-a");
  });

  it("a waiting announcement outranks a waiting upsell when the slot frees", () => {
    const { coordinator } = rig();
    expect(coordinator.claim("holder", "person-a")).toBe(true);
    expect(coordinator.claim("upsell-a", "person-a")).toBe(false);
    expect(coordinator.claim("news", "person-a")).toBe(false);
    coordinator.release("holder");
    expect(coordinator.activeId()).toBe("news");
    coordinator.release("news");
    expect(coordinator.activeId()).toBe("upsell-a");
  });

  it("the holder re-claiming its own slot is a no-op grant", () => {
    const { coordinator } = rig();
    expect(coordinator.claim("news", "person-a")).toBe(true);
    expect(coordinator.claim("news", "person-a")).toBe(true);
    expect(coordinator.activeId()).toBe("news");
  });
});

describe("once-per-session memory", () => {
  it("a shown pop-up can never claim twice in a session — even after closing, even for another person", () => {
    const { coordinator } = rig();
    expect(coordinator.claim("news", "person-a")).toBe(true);
    coordinator.release("news");
    expect(coordinator.claim("news", "person-a")).toBe(false);
    expect(coordinator.eligibility("news", "person-a")).toEqual({ ok: false, reason: "shown_this_session" });
    expect(coordinator.claim("news", "person-b")).toBe(false);
  });

  it("a new session (fresh session record) may show it again", () => {
    const person = fakeStorage();
    const first = rig({ person });
    expect(first.coordinator.claim("news", "person-a")).toBe(true);
    first.coordinator.release("news");
    const second = rig({ person });
    expect(second.coordinator.claim("news", "person-a")).toBe(true);
  });
});

describe("per-person restraint", () => {
  it("an upsell re-shows the same person at most once per 24h across sessions; others are unaffected", () => {
    const person = fakeStorage();
    const first = rig({ person });
    expect(first.coordinator.claim("upsell-a", "person-a")).toBe(true);
    first.coordinator.release("upsell-a");

    const second = rig({ person });
    second.advance(UPSELL_PERSON_COOLDOWN_MS - 60_000);
    expect(second.coordinator.claim("upsell-a", "person-a")).toBe(false);
    expect(second.coordinator.eligibility("upsell-a", "person-a")).toEqual({
      ok: false,
      reason: "person_cooldown",
    });
    expect(second.coordinator.claim("upsell-a", "person-b")).toBe(true);
    second.coordinator.release("upsell-a");

    const third = rig({ person });
    third.advance(UPSELL_PERSON_COOLDOWN_MS + 60_000);
    expect(third.coordinator.claim("upsell-a", "person-a")).toBe(true);
  });

  it("at most one upsell claims per session, however many are registered", () => {
    const { coordinator } = rig();
    expect(coordinator.claim("upsell-a", "person-a")).toBe(true);
    coordinator.release("upsell-a");
    expect(coordinator.claim("upsell-b", "person-b")).toBe(false);
    expect(coordinator.eligibility("upsell-b", "person-b")).toEqual({
      ok: false,
      reason: "upsell_session_cap",
    });
  });

  it("announcements are exempt from the upsell cap and the person cooldown", () => {
    const { coordinator } = rig();
    expect(coordinator.claim("upsell-a", "person-a")).toBe(true);
    coordinator.release("upsell-a");
    /* Same person, same session, moments later — the news still shows. */
    expect(coordinator.claim("news", "person-a")).toBe(true);
  });

  it("an ineligible pop-up is denied outright, never queued behind the slot", () => {
    const { coordinator } = rig();
    expect(coordinator.claim("news", "person-a")).toBe(true);
    expect(coordinator.claim("news", "person-a")).toBe(true); // holder no-op
    coordinator.release("news");
    /* upsell-a was never shown; holder takes the slot again is denied
       (shown), and nothing stale promotes afterwards. */
    expect(coordinator.claim("holder", "person-a")).toBe(true);
    expect(coordinator.claim("news", "person-a")).toBe(false);
    coordinator.release("holder");
    expect(coordinator.activeId()).toBeNull();
  });
});

describe("decidePopupEligibility (pure)", () => {
  it("unknown pop-ups are denied", () => {
    expect(
      decidePopupEligibility({
        spec: undefined,
        session: { shown: {}, upsellsShown: 0 },
        person: { lastShown: {} },
        popupId: "nope",
        now: 0,
      }),
    ).toEqual({ ok: false, reason: "unknown_popup" });
  });

  it("an announcement ignores a recent person record; an upsell honours it", () => {
    const person = { lastShown: { x: 5000 } };
    const session = { shown: {}, upsellsShown: 0 };
    expect(
      decidePopupEligibility({
        spec: { class: "announcement", priority: 1 },
        session,
        person,
        popupId: "x",
        now: 6000,
      }),
    ).toEqual({ ok: true });
    expect(
      decidePopupEligibility({
        spec: { class: "upsell", priority: 1 },
        session,
        person,
        popupId: "x",
        now: 6000,
      }),
    ).toEqual({ ok: false, reason: "person_cooldown" });
  });
});
