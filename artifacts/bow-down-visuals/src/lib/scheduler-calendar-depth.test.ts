/**
 * scheduler-calendar-depth.test.ts — Stack-3 scheduler calendar depth.
 *
 * Two behaviors are pinned at the source level because they ARE the
 * fix (the pure decision logic itself is unit-tested in
 * lib/scheduler.test.ts):
 *
 *  1. Optimistic drag-to-reschedule on the month grid. The drag
 *     existed, but the chip waited in its old day until the PATCH
 *     returned AND a full list refetch completed. handleReschedule
 *     now plans via planReschedule, moves the post in local state
 *     BEFORE the write, reconciles with the server's returned row,
 *     and rolls back to the original time on failure. (The Wave 8
 *     week planner's drag already worked this way; the month grid —
 *     the actual scheduled-posts calendar — didn't.)
 *
 *  2. The posting-accounts strip. The composer silently filters
 *     expired accounts out of its pickers, so on the scheduler an
 *     expired connection was indistinguishable from never connecting,
 *     and a failed accounts load presented as "no accounts". The
 *     strip surfaces the connection system's own state (connected /
 *     expired / not connected / load failed + retry) from the same
 *     account list, and links management to Settings, where the
 *     Connected Accounts panel lives — no second OAuth flow.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const schedulerSource = read("../pages/scheduler.tsx");

function sliceBetween(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
}

describe("optimistic drag-to-reschedule (month grid)", () => {
  const handler = sliceBetween(
    schedulerSource,
    "async function handleReschedule",
    "function handleUseSlot",
  );

  it("plans the drop through planReschedule before touching state or network", () => {
    expect(handler).toContain("planReschedule(post, targetDate)");
    expect(handler.indexOf("planReschedule(post, targetDate)")).toBeLessThan(
      handler.indexOf('method: "PATCH"'),
    );
  });

  it("moves the post in local state BEFORE the PATCH write", () => {
    const optimistic = handler.indexOf("{ ...p, scheduledAt: moved }");
    const write = handler.indexOf('method: "PATCH"');
    expect(optimistic).toBeGreaterThanOrEqual(0);
    expect(write).toBeGreaterThan(optimistic);
  });

  it("reconciles with the server's returned row on success (no full refetch)", () => {
    expect(handler).toContain("data.post");
    expect(handler).not.toContain("await loadPosts()");
  });

  it("rolls back to the original time when the write fails", () => {
    const write = handler.indexOf('method: "PATCH"');
    const rollback = handler.indexOf("{ ...p, scheduledAt: original }");
    expect(rollback).toBeGreaterThan(write);
    expect(handler).toContain("scheduler.toast.couldntReschedule");
  });

  it("the month grid's drops still land in handleReschedule", () => {
    expect(schedulerSource).toContain("onDropDay={handleReschedule}");
  });
});

describe("posting accounts strip", () => {
  it("is rendered on the scheduler page once loading finishes", () => {
    expect(schedulerSource).toContain("<PostingAccountsStrip");
    expect(schedulerSource).toContain("loadFailed={accountsError}");
  });

  it("reads the same account list through postingAccountStates", () => {
    const strip = sliceBetween(
      schedulerSource,
      "function PostingAccountsStrip",
      "function CalendarTab",
    );
    expect(strip).toContain("postingAccountStates(props.accounts)");
  });

  it("sends connect/reconnect to Settings, where Connected Accounts lives — no OAuth flow here", () => {
    const strip = sliceBetween(
      schedulerSource,
      "function PostingAccountsStrip",
      "function CalendarTab",
    );
    expect(strip).toContain('href="/settings"');
    expect(strip).not.toContain("auth-url");
  });

  it("a failed accounts load is its own state, never silently 'no accounts'", () => {
    expect(schedulerSource).toContain("setAccountsError(true)");
    expect(schedulerSource).toContain("setAccountsError(false)");
  });
});
