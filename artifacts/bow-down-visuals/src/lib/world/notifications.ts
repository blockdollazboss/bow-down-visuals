/* ─── Notifications inbox in-world (stack-100 item 78) ────────────
   The World chrome bell rides the SAME rail the 2D header bell
   rides (components/discovery/NotificationsBell.tsx):
     GET  /api/discovery/notifications?limit=N → { items, unread }
     POST /api/discovery/notifications/read    { ids?: string[] }
          (no ids = mark all read — the rail's own contract)
   Item DTO is the rail's snake_case shape: id / kind / title /
   body / link / is_read / created_at.

   Navigation law: a tap goes IN-WORLD where the target lives
   in-world — a group link opens the Community Hall groups desk on
   that group; a messages link opens the Post Office. Anything else
   is the honest transfer (the website page, named as such) — the
   bell never pretends a page lives in the palace when it doesn't. */

import { stashPendingGroupSlug } from "./groups-desk";

export const NOTIFICATIONS_PATH = "/api/discovery/notifications?limit=30";
export const NOTIFICATIONS_READ_PATH = "/api/discovery/notifications/read";

export interface WorldNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

export function normalizeNotifications(data: unknown): { items: WorldNotification[]; unread: number } {
  const d = data as { items?: unknown; unread?: unknown } | null;
  const items = Array.isArray(d?.items)
    ? d.items.flatMap((n) => {
        const row = n as Record<string, unknown>;
        if (typeof row?.id !== "string" || typeof row?.title !== "string") return [];
        return [{
          id: row.id,
          kind: typeof row.kind === "string" ? row.kind : "",
          title: row.title,
          body: typeof row.body === "string" ? row.body : "",
          link: typeof row.link === "string" ? row.link : "",
          is_read: row.is_read === true,
          created_at: typeof row.created_at === "string" ? row.created_at : "",
        }];
      })
    : [];
  const unread =
    typeof d?.unread === "number" ? d.unread : items.filter((i) => !i.is_read).length;
  return { items, unread };
}

/** Mark-read body: specific ids, or (empty body semantics) all —
 *  the rail marks everything when `ids` is absent/empty, so the
 *  "mark all" call sends an empty object, never a fake id list. */
export function markReadBody(ids?: string[]): Record<string, unknown> {
  return ids && ids.length ? { ids } : {};
}

export type NotificationTarget =
  | { kind: "group"; slug: string; stationId: "community-hall" }
  | { kind: "station"; stationId: "post-office" }
  | { kind: "website"; href: string }
  | { kind: "none" };

/** Where a notification's link lives. Group links (/groups/:slug —
 *  group joins, forum replies, broadcasts all point there on the
 *  rail) open in-world; /messages and /dm open the Post Office;
 *  everything else with a link is the honest website transfer. */
export function notificationTarget(link: string): NotificationTarget {
  const path = (link ?? "").trim();
  if (!path) return { kind: "none" };
  const groupMatch = /^\/groups\/([a-z0-9][a-z0-9-]*[a-z0-9])\/?(?:[?#].*)?$/.exec(path);
  if (groupMatch) {
    return { kind: "group", slug: groupMatch[1], stationId: "community-hall" };
  }
  if (/^\/(messages|dm)(\/|$|\?)/.test(path)) {
    return { kind: "station", stationId: "post-office" };
  }
  if (path.startsWith("/")) return { kind: "website", href: path };
  return { kind: "none" };
}

/** The station a target opens, if it opens one in-world. */
export function notificationStationId(target: NotificationTarget): string | null {
  return target.kind === "group" || target.kind === "station" ? target.stationId : null;
}

/** Prepare an in-world navigation: for a group target, stash the
 *  slug so the groups desk opens on that group. Returns the station
 *  id to open, or null when the target isn't in-world. */
export function prepareNotificationNavigation(
  target: NotificationTarget,
  storage: Pick<Storage, "setItem">,
): string | null {
  if (target.kind === "group") {
    stashPendingGroupSlug(storage, target.slug);
    return target.stationId;
  }
  if (target.kind === "station") return target.stationId;
  return null;
}

/** Bell badge: the rail's unread count, capped for display. */
export function unreadBadge(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null;
  return unread > 99 ? "99+" : String(unread);
}
