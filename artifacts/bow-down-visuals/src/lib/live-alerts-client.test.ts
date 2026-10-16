/**
 * AlertQueue tests — one alert at a time, timed rotation, burst
 * capping, preview tagging, and event-detail validation.
 */
import { describe, it, expect } from "vitest";
import { AlertQueue, alertFromEventDetail, previewAlert, ALERT_QUEUE_MAX, type StreamAlert } from "./live-alerts-client";

function makeQueue() {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const queue = new AlertQueue(
    {
      setTimeoutFn: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimeoutFn: () => undefined,
    },
    () => undefined,
  );
  return {
    queue,
    fireNext: () => {
      const t = timers.shift();
      t?.fn();
    },
    pending: () => timers.length,
  };
}

const tip = (n: number): StreamAlert => ({ kind: "tip", title: `tip ${n}`, body: "" });

describe("AlertQueue", () => {
  it("shows one at a time and rotates through the queue on timers", () => {
    const { queue, fireNext } = makeQueue();
    queue.push(tip(1));
    queue.push(tip(2));
    expect(queue.current?.title).toBe("tip 1");
    expect(queue.queuedCount).toBe(1);
    fireNext(); // show time elapses → current clears
    expect(queue.current).toBeNull();
    fireNext(); // gap elapses → next shows
    expect(queue.current?.title).toBe("tip 2");
    fireNext();
    fireNext();
    expect(queue.current).toBeNull();
    expect(queue.queuedCount).toBe(0);
  });

  it("caps a burst by dropping the oldest queued alerts", () => {
    const { queue } = makeQueue();
    queue.push(tip(0)); // showing
    for (let i = 1; i <= ALERT_QUEUE_MAX + 3; i++) queue.push(tip(i));
    expect(queue.queuedCount).toBe(ALERT_QUEUE_MAX);
  });

  it("clear drops everything", () => {
    const { queue } = makeQueue();
    queue.push(tip(1));
    queue.push(tip(2));
    queue.clear();
    expect(queue.current).toBeNull();
    expect(queue.queuedCount).toBe(0);
  });
});

describe("alert helpers", () => {
  it("the preview alert is clearly a preview", () => {
    const p = previewAlert();
    expect(p.preview).toBe(true);
    expect(p.title).toMatch(/Preview/);
  });

  it("event details are scoped to the stream and shape-checked", () => {
    expect(alertFromEventDetail({ streamId: "s1", kind: "follow", title: "X just followed", body: "hi" }, "s1")).toEqual({
      kind: "follow",
      title: "X just followed",
      body: "hi",
      amountVb: undefined,
    });
    expect(alertFromEventDetail({ streamId: "other", kind: "tip", title: "T" }, "s1")).toBeNull();
    expect(alertFromEventDetail({ streamId: "s1" }, "s1")).toBeNull();
    expect(alertFromEventDetail(null, "s1")).toBeNull();
  });
});
