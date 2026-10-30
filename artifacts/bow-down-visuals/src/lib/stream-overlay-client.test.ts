/**
 * stream-overlay-client — pure view/feed logic for the OBS overlay
 * pages (stack900 lane C2). The components render from these
 * helpers; the socket glue (use-overlay-feed) is pinned by source
 * in stream-overlay-wiring.test.ts, per the repo's node-env split.
 */
import { describe, expect, it } from "vitest";
import {
  ALERT_DISPLAY_MS,
  ALERT_QUEUE_MAX,
  buildOverlayWsUrl,
  enqueueAlert,
  formatVb,
  goalPercent,
  parseOverlayMessage,
  type OverlayAlertData,
  type OverlayStateData,
} from "./stream-overlay-client";

const ALERT: OverlayAlertData = {
  kind: "tip",
  title: "Fan One tipped 300 Visual Bucs",
  body: "great set",
  amountVb: 300,
  test: false,
  at: "2026-10-29T21:05:00.000Z",
};

const STATE: OverlayStateData = {
  creator: { displayName: "Stage Star" },
  stream: { id: "s1", status: "live", title: "Friday Live" },
  latestFollower: { displayName: "Fan One", followedAt: "2026-10-29T21:00:00.000Z" },
  recentTips: [{ tipperName: "Fan One", amountVb: 300, createdAt: "2026-10-29T21:05:00.000Z" }],
  goal: { goalVb: 1000, totalVb: 500, tipCount: 2 },
};

describe("buildOverlayWsUrl", () => {
  it("uses ws on http pages and wss on https pages, same origin", () => {
    expect(buildOverlayWsUrl({ protocol: "http:", host: "localhost:3000" }, "tok")).toBe(
      "ws://localhost:3000/api/overlay/ws?token=tok",
    );
    expect(buildOverlayWsUrl({ protocol: "https:", host: "bowdownvisuals.com" }, "tok")).toBe(
      "wss://bowdownvisuals.com/api/overlay/ws?token=tok",
    );
  });

  it("encodes the token into the query", () => {
    expect(buildOverlayWsUrl({ protocol: "https:", host: "x.test" }, "a b+c")).toContain(
      "token=a%20b%2Bc",
    );
  });
});

describe("parseOverlayMessage", () => {
  it("parses the three real frame shapes", () => {
    expect(parseOverlayMessage(JSON.stringify({ type: "alert", alert: ALERT }))).toEqual({
      type: "alert",
      alert: ALERT,
    });
    expect(parseOverlayMessage(JSON.stringify({ type: "state", state: STATE }))).toEqual({
      type: "state",
      state: STATE,
    });
    expect(parseOverlayMessage(JSON.stringify({ type: "refresh" }))).toEqual({ type: "refresh" });
  });

  it("never throws on junk — junk parses to null", () => {
    expect(parseOverlayMessage("not json")).toBeNull();
    expect(parseOverlayMessage("")).toBeNull();
    expect(parseOverlayMessage("null")).toBeNull();
    expect(parseOverlayMessage(JSON.stringify({ type: "mystery" }))).toBeNull();
    expect(parseOverlayMessage(JSON.stringify({ type: "alert" }))).toBeNull();
    expect(parseOverlayMessage(JSON.stringify({ type: "alert", alert: { kind: "tip" } }))).toBeNull();
    expect(
      parseOverlayMessage(JSON.stringify({ type: "alert", alert: { ...ALERT, kind: "shout" } })),
    ).toBeNull();
    expect(parseOverlayMessage(JSON.stringify({ type: "state", state: { creator: {} } }))).toBeNull();
  });

  it("normalizes a partial alert instead of trusting it raw", () => {
    const parsed = parseOverlayMessage(
      JSON.stringify({ type: "alert", alert: { kind: "follow", title: "Fan One just followed" } }),
    );
    expect(parsed).toEqual({
      type: "alert",
      alert: {
        kind: "follow",
        title: "Fan One just followed",
        body: null,
        amountVb: null,
        test: false,
        at: "",
      },
    });
  });
});

describe("enqueueAlert", () => {
  it("appends in order and caps the queue at the max, freshest wins", () => {
    let queue = enqueueAlert([], ALERT, 1);
    queue = enqueueAlert(queue, { ...ALERT, title: "second" }, 2);
    expect(queue.map((q) => q.key)).toEqual([1, 2]);

    let burst: ReturnType<typeof enqueueAlert> = [];
    for (let i = 1; i <= ALERT_QUEUE_MAX + 3; i++) {
      burst = enqueueAlert(burst, { ...ALERT, title: `t${i}` }, i);
    }
    expect(burst).toHaveLength(ALERT_QUEUE_MAX);
    expect(burst[0]!.alert.title).toBe("t4");
    expect(burst[burst.length - 1]!.alert.title).toBe(`t${ALERT_QUEUE_MAX + 3}`);
  });

  it("does not mutate the queue it was given", () => {
    const before = [{ key: 1, alert: ALERT }];
    const after = enqueueAlert(before, ALERT, 2);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
  });
});

describe("goalPercent", () => {
  it("is null with no goal — no goal, no bar", () => {
    expect(goalPercent({ goalVb: null, totalVb: 0, tipCount: 0 })).toBeNull();
    expect(goalPercent({ goalVb: 0, totalVb: 0, tipCount: 0 })).toBeNull();
  });

  it("rounds and clamps to 0..100", () => {
    expect(goalPercent({ goalVb: 1000, totalVb: 500, tipCount: 2 })).toBe(50);
    expect(goalPercent({ goalVb: 1000, totalVb: 333, tipCount: 1 })).toBe(33);
    expect(goalPercent({ goalVb: 1000, totalVb: 5000, tipCount: 9 })).toBe(100);
    expect(goalPercent({ goalVb: 1000, totalVb: 0, tipCount: 0 })).toBe(0);
  });
});

describe("formatVb + display timing", () => {
  it("groups thousands the way the site writes Bucs", () => {
    expect(formatVb(300)).toBe("300");
    expect(formatVb(1000000)).toBe("1,000,000");
  });

  it("keeps the on-screen time a sane pop-and-fade window", () => {
    expect(ALERT_DISPLAY_MS).toBeGreaterThanOrEqual(5000);
    expect(ALERT_DISPLAY_MS).toBeLessThanOrEqual(10000);
  });
});
