import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Bell, CheckCheck, Flame, Music2, UserPlus, Megaphone, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── NotificationsBell — header dropdown (Worker 6, discovery) ───────────
   Self-contained: drop <NotificationsBell /> into the header and it handles
   the unread badge, dropdown, and mark-all-read. Polls every 60s.

   MOUNT (coordinator): in App.tsx's AuthedLayout, inside the sticky header:
     import { NotificationsBell } from "@/components/discovery/NotificationsBell";
     <div className="sticky top-0 z-40 relative">
       <VideoBanner />
       <div className="absolute right-3 top-1/2 -translate-y-1/2">
         <NotificationsBell />
       </div>
     </div>
   Do NOT add a sidebar item — the bell lives in the header only. */

interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

function kindIcon(kind: string) {
  if (kind === "follow") return <UserPlus className="h-4 w-4 text-sky-300" />;
  if (kind === "release") return <Music2 className="h-4 w-4 text-[#e8c86a]" />;
  if (kind === "mention") return <Megaphone className="h-4 w-4 text-fuchsia-300" />;
  if (kind === "trending") return <Flame className="h-4 w-4 text-orange-300" />;
  return <Sparkles className="h-4 w-4 text-[#e8c86a]" />;
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function NotificationsBell() {
  const { user, getAccessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await getAccessToken().catch(() => null);
      if (!token) return;
      const r = await fetch("/api/discovery/notifications?limit=20", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return;
      const d = await r.json();
      setItems(Array.isArray(d.items) ? d.items : []);
      setUnread(typeof d.unread === "number" ? d.unread : 0);
    } catch {
      /* bell degrades silently */
    }
  }, [user, getAccessToken]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const markAllRead = async () => {
    try {
      const token = await getAccessToken().catch(() => null);
      if (!token) return;
      await fetch("/api/discovery/notifications/read", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
      setUnread(0);
    } catch {
      /* noop */
    }
  };

  if (!user) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/70 backdrop-blur transition-colors hover:border-[#e8c86a]/50 hover:text-[#e8c86a]"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-b from-[#ffe9a8] to-[#c9a84c] px-1 text-[11px] font-black text-black">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-[#c9a84c]/30 bg-[#14100a] shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h3 className="font-black">Notifications</h3>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs font-semibold text-[#e8c86a] hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="mx-auto mb-3 h-8 w-8 text-white/20" />
                <p className="text-sm font-semibold text-white/60">All quiet on the cheat-code front.</p>
                <p className="mt-1 text-xs text-white/35">
                  Follow creators and you'll hear about every drop first.
                </p>
              </div>
            ) : (
              items.map((n) => {
                const row = (
                  <div
                    className={`flex gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04] ${
                      n.is_read ? "opacity-60" : "bg-[#e8c86a]/[0.05]"
                    }`}
                  >
                    <span className="mt-0.5 shrink-0">{kindIcon(n.kind)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug">{n.title}</p>
                      {n.body && <p className="mt-0.5 truncate text-xs text-white/45">{n.body}</p>}
                      <p className="mt-1 text-[11px] text-white/30">{timeAgo(n.created_at)} ago</p>
                    </div>
                    {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#e8c86a]" />}
                  </div>
                );
                return n.link ? (
                  <Link key={n.id} href={n.link} onClick={() => setOpen(false)}>
                    <div className="cursor-pointer">{row}</div>
                  </Link>
                ) : (
                  <div key={n.id}>{row}</div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
