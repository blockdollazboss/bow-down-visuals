import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Sparkles, UserPlus, Music2, Megaphone, Flame, Users, MessageSquare } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  NOTIFICATIONS_PATH, NOTIFICATIONS_READ_PATH, normalizeNotifications,
  markReadBody, notificationTarget, prepareNotificationNavigation, unreadBadge,
  type WorldNotification,
} from "@/lib/world/notifications";

/* ─── The World chrome bell (stack-100 item 78) ────────────────────
   A member standing in the palace was deaf to follows, tips, group
   joins, forum replies and DM requests. This bell rides the exact
   rail the 2D header bell rides — GET /api/discovery/notifications
   and POST /api/discovery/notifications/read — polls on the same
   60s cadence, and navigates IN-WORLD where the target lives
   in-world (groups → the Community Hall groups desk, opened on
   that group; messages → the Post Office). Anything else is the
   honest transfer: the website page, opened as a website page and
   labelled as such. Members only — the rail is requireAuth, and a
   guest has no inbox to be deaf to, so guests see no dead bell. */

function kindIcon(kind: string) {
  if (kind === "follow") return <UserPlus className="h-4 w-4 shrink-0 text-[#d4af37]" />;
  if (kind === "release") return <Music2 className="h-4 w-4 shrink-0 text-[#d4af37]" />;
  if (kind === "mention") return <Megaphone className="h-4 w-4 shrink-0 text-[#d4af37]" />;
  if (kind === "trending") return <Flame className="h-4 w-4 shrink-0 text-[#d4af37]" />;
  if (kind.startsWith("group") || kind === "forum_reply") return <Users className="h-4 w-4 shrink-0 text-[#d4af37]" />;
  if (kind.startsWith("dm") || kind === "message") return <MessageSquare className="h-4 w-4 shrink-0 text-[#d4af37]" />;
  return <Sparkles className="h-4 w-4 shrink-0 text-[#d4af37]" />;
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function WorldNotificationsBell({
  isLight,
  onOpenStation,
}: {
  isLight: boolean;
  /** Open a palace station's panel in-world (the world page's own opener). */
  onOpenStation: (stationId: string) => void;
}) {
  const { user, getAccessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<WorldNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await getAccessToken().catch(() => null);
      if (!token) return;
      const r = await fetch(NOTIFICATIONS_PATH, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) { setLoadError(true); return; }
      const parsed = normalizeNotifications(await r.json().catch(() => null));
      setLoadError(false);
      setItems(parsed.items);
      setUnread(parsed.unread);
    } catch {
      setLoadError(true);
    }
  }, [user, getAccessToken]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open ]);

  const markRead = useCallback(async (ids?: string[]) => {
    try {
      const token = await getAccessToken().catch(() => null);
      if (!token) return;
      await fetch(NOTIFICATIONS_READ_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(markReadBody(ids)),
      });
    } catch {
      /* the next poll re-reads the truth from the rail */
    }
  }, [getAccessToken]);

  const markAllRead = async () => {
    setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
    setUnread(0);
    await markRead();
  };

  const openItem = async (item: WorldNotification) => {
    if (!item.is_read) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_read: true } : i)));
      setUnread((u) => Math.max(0, u - 1));
      void markRead([item.id]);
    }
    const target = notificationTarget(item.link);
    const stationId = prepareNotificationNavigation(target, window.sessionStorage);
    if (stationId) {
      setOpen(false);
      onOpenStation(stationId);
      return;
    }
    if (target.kind === "website") {
      setOpen(false);
      window.open(target.href, "_blank", "noopener");
    }
  };

  if (!user) return null;
  const badge = unreadBadge(unread);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  return (
    <div ref={wrapRef} className="relative" data-testid="world-notifications">
      <button
        type="button"
        data-testid="world-notifications-bell"
        aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); if (!open) void load(); }}
        className={`relative inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
          isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
        }`}
      >
        <Bell className="h-4 w-4" />
        <span className="hidden sm:inline">Inbox</span>
        {badge && (
          <span data-testid="world-notifications-badge" className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#d4af37] px-1 text-[11px] font-black text-black">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="world-notifications-panel"
          className={`absolute right-0 top-[calc(100%+8px)] z-50 w-[min(92vw,380px)] overflow-hidden rounded-2xl border shadow-2xl ${
            isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9]" : "border-[#d4af37]/25 bg-[#0b0a08]"
          }`}
        >
          <div className={`flex items-center gap-2 border-b px-4 py-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
            <p className={`text-sm font-black ${strong}`}>Notifications</p>
            {unread > 0 && (
              <button type="button" data-testid="world-notifications-mark-all" onClick={() => void markAllRead()} className={`ml-auto inline-flex items-center gap-1.5 text-xs font-bold ${muted} hover:opacity-80`}>
                <CheckCheck className="h-4 w-4 text-[#d4af37]" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {loadError ? (
              <p data-testid="world-notifications-error" className={`px-4 py-4 text-sm ${muted}`}>
                Your inbox wouldn't open just now — tap the bell again to retry. Nothing is lost; it lives on the same rail as the website bell.
              </p>
            ) : items.length === 0 ? (
              <p data-testid="world-notifications-empty" className={`px-4 py-4 text-sm ${muted}`}>
                All quiet in the palace. Follows, tips, group news and message requests will land here.
              </p>
            ) : (
              items.map((item) => {
                const target = notificationTarget(item.link);
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`world-notification-${item.id}`}
                    onClick={() => void openItem(item)}
                    className={`flex w-full items-start gap-2.5 px-4 py-3 text-left transition ${
                      isLight ? "hover:bg-[#C9A84C]/10" : "hover:bg-white/5"
                    } ${item.is_read ? "opacity-70" : ""}`}
                  >
                    {kindIcon(item.kind)}
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-semibold leading-snug ${strong}`}>
                        {!item.is_read && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#d4af37] align-middle" aria-label="Unread" />}
                        {item.title}
                      </span>
                      {item.body && <span className={`mt-0.5 block truncate text-xs ${muted}`}>{item.body}</span>}
                      <span className={`mt-0.5 block text-[11px] font-semibold ${muted}`}>
                        {timeAgo(item.created_at)}
                        {target.kind === "group" && " · Opens the group here in the palace"}
                        {target.kind === "station" && " · Opens the Post Office here"}
                        {target.kind === "website" && " · Opens on the website ↗"}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
