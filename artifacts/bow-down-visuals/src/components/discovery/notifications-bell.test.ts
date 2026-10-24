/**
 * Source pins for the 2D header bell (NotificationsBell.tsx).
 *
 * THE REGRESSION (stack29, owner report Oct 23, 20:24 EDT): clicking
 * a notification navigated but never marked it read — the row's only
 * click behaviour was closing the dropdown, and the sole call to
 * POST /api/discovery/notifications/read in the component was
 * mark-all's. The rail has always accepted { ids: [...] } per item
 * (and the World bell already opens correctly) — the header bell now
 * sends the opened item's id and updates its row + badge at once.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./NotificationsBell.tsx", import.meta.url), "utf8");

describe("NotificationsBell — opening a notification marks it read", () => {
  it("posts the opened item's id to the read rail (per-item body, not mark-all's)", () => {
    expect(src).toContain('"/api/discovery/notifications/read"');
    expect(src).toContain("JSON.stringify({ ids: [id] })");
  });

  it("both row kinds — linked and link-less — open through the read-marking handler", () => {
    const opens = src.match(/onClick=\{\(\) => openNotification\(n\)\}/g) ?? [];
    expect(opens).toHaveLength(2);
  });

  it("the old navigate-only click is gone from the linked row", () => {
    expect(src).not.toContain("onClick={() => setOpen(false)}");
  });

  it("opening flips the row and drops the badge via the pinned transitions, guarded against double-counting", () => {
    expect(src).toContain("if (n.is_read) return;");
    expect(src).toContain("markItemRead(items, n.id)");
    expect(src).toContain("decrementUnread(u)");
  });
});

describe("NotificationsBell — mark-all still clears everything", () => {
  it("the header button still calls markAllRead", () => {
    expect(src).toContain("onClick={markAllRead}");
  });

  it("markAllRead still posts the rail's no-ids body and zeroes the badge", () => {
    expect(src).toContain("JSON.stringify({})");
    expect(src).toContain("setUnread(0)");
    expect(src).toContain("markAllItemsRead(prev)");
  });
});
