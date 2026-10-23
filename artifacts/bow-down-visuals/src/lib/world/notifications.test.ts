import { describe, expect, it } from "vitest";
import {
  NOTIFICATIONS_PATH, NOTIFICATIONS_READ_PATH, normalizeNotifications, markReadBody,
  notificationTarget, notificationStationId, prepareNotificationNavigation, unreadBadge,
} from "./notifications";

describe("78 — the bell rides the 2D bell's own rail", () => {
  it("paths match NotificationsBell's fetch strings", () => {
    expect(NOTIFICATIONS_PATH).toBe("/api/discovery/notifications?limit=30");
    expect(NOTIFICATIONS_READ_PATH).toBe("/api/discovery/notifications/read");
  });

  it("normalizes items + unread, counting unread from items when omitted", () => {
    const { items, unread } = normalizeNotifications({
      unread: 2,
      items: [
        { id: "n1", kind: "follow", title: "A followed you", body: "", link: "/artist/a", is_read: false, created_at: "t" },
        { id: "n2", kind: "group_join", title: "B joined", body: "x", link: "/groups/beat-makers", is_read: true, created_at: "t" },
        { title: "no id" },
      ],
    });
    expect(items).toHaveLength(2);
    expect(unread).toBe(2);
    const fallback = normalizeNotifications({ items: [{ id: "n1", title: "t", is_read: false }] });
    expect(fallback.unread).toBe(1);
    expect(normalizeNotifications(null)).toEqual({ items: [], unread: 0 });
  });

  it("mark-all sends no ids (the rail's mark-everything contract)", () => {
    expect(markReadBody()).toEqual({});
    expect(markReadBody([])).toEqual({});
    expect(markReadBody(["n1", "n2"])).toEqual({ ids: ["n1", "n2"] });
  });
});

describe("78 — taps navigate in-world where the target lives in-world", () => {
  it("group links open the Community Hall on that group", () => {
    const t = notificationTarget("/groups/beat-makers");
    expect(t).toEqual({ kind: "group", slug: "beat-makers", stationId: "community-hall" });
    expect(notificationStationId(t)).toBe("community-hall");
  });
  it("message links open the Post Office", () => {
    expect(notificationTarget("/messages")).toEqual({ kind: "station", stationId: "post-office" });
    expect(notificationTarget("/messages?c=1").kind).toBe("station");
  });
  it("anything else is the honest website transfer; empty is none", () => {
    expect(notificationTarget("/artist/someone")).toEqual({ kind: "website", href: "/artist/someone" });
    expect(notificationTarget("/earnings")).toEqual({ kind: "website", href: "/earnings" });
    expect(notificationTarget("")).toEqual({ kind: "none" });
    expect(notificationTarget("https://example.com/x")).toEqual({ kind: "none" });
  });
  it("preparing a group navigation stashes the slug for the desk", () => {
    const store = new Map<string, string>();
    const storage = { setItem: (k: string, v: string) => void store.set(k, v) };
    const station = prepareNotificationNavigation(notificationTarget("/groups/beat-makers"), storage);
    expect(station).toBe("community-hall");
    expect([...store.values()]).toEqual(["beat-makers"]);
    expect(prepareNotificationNavigation(notificationTarget("/earnings"), storage)).toBeNull();
  });
});

describe("78 — badge", () => {
  it("hides at zero, caps at 99+", () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(3)).toBe("3");
    expect(unreadBadge(140)).toBe("99+");
  });
});
