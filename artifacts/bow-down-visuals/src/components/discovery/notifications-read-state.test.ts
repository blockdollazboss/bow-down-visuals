/**
 * Logic pins for the header bell's read-state transitions
 * (notifications-read-state.ts).
 *
 * THE BUG (stack29, owner report Oct 23): opening a notification in
 * the 2D header bell never marked it read — the gold dot and badge
 * survived every open, and only "Mark all read" cleared them. The
 * fix routes every open through these transitions: flip exactly the
 * opened item, drop the badge by exactly one, never below zero;
 * mark-all flips everything.
 */
import { describe, it, expect } from "vitest";
import { markItemRead, decrementUnread, markAllItemsRead } from "./notifications-read-state";

const item = (id: string, is_read: boolean) => ({ id, is_read, title: `Note ${id}` });

describe("markItemRead — opening one notification", () => {
  it("flips exactly the opened item and reports it was unread", () => {
    const items = [item("a", false), item("b", false), item("c", true)];
    const next = markItemRead(items, "b");

    expect(next.wasUnread).toBe(true);
    expect(next.items.map((i) => [i.id, i.is_read])).toEqual([
      ["a", false],
      ["b", true],
      ["c", true],
    ]);
    // Untouched rows keep their identity (no repaint churn).
    expect(next.items[0]).toBe(items[0]);
    expect(next.items[2]).toBe(items[2]);
    // The input list is not mutated.
    expect(items[1].is_read).toBe(false);
  });

  it("is a no-op for an already-read item — the badge must not move twice", () => {
    const items = [item("a", false), item("b", true)];
    const next = markItemRead(items, "b");

    expect(next.wasUnread).toBe(false);
    expect(next.items).toBe(items);
  });

  it("is a no-op for an unknown id", () => {
    const items = [item("a", false)];
    const next = markItemRead(items, "missing");

    expect(next.wasUnread).toBe(false);
    expect(next.items).toBe(items);
  });
});

describe("decrementUnread — the badge after one open", () => {
  it("drops by exactly one", () => {
    expect(decrementUnread(3)).toBe(2);
    expect(decrementUnread(1)).toBe(0);
  });

  it("never goes below zero", () => {
    expect(decrementUnread(0)).toBe(0);
  });
});

describe("markAllItemsRead — mark-all's local half", () => {
  it("flips every unread item and keeps read items' identity", () => {
    const items = [item("a", false), item("b", true), item("c", false)];
    const next = markAllItemsRead(items);

    expect(next.every((i) => i.is_read)).toBe(true);
    expect(next[1]).toBe(items[1]);
    expect(items[0].is_read).toBe(false);
  });
});
