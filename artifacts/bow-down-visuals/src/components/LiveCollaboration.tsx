import { useEffect, useState, useRef } from "react";
import { getSupabase } from "@/lib/supabase";

interface Collaborator {
  userId: string;
  name: string;
  color: string;
  cursor?: { x: number; y: number };
}

const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];

/* Live collaboration presence via Supabase Realtime.
   Shows who's viewing/editing the same project. */
export function useCollaboration(projectId: string, userName: string) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const channelRef = useRef<any>(null);
  const userId = useRef(`user-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!projectId) return;
    const supabase = getSupabase();
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];

    const channel = supabase.channel(`project:${projectId}`, {
      config: { presence: { key: userId.current } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const others: Collaborator[] = [];
        Object.entries(state).forEach(([key, presences]: [string, any]) => {
          if (key === userId.current) return;
          const p = presences[0];
          if (p) {
            others.push({
              userId: key,
              name: p.name ?? "Anonymous",
              color: p.color ?? "#888",
              cursor: p.cursor,
            });
          }
        });
        setCollaborators(others);
      })
      .on("presence", { event: "join" }, ({ newPresences }: any) => {
        // Handled by sync
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            name: userName,
            color,
            cursor: null,
          });
        }
      });

    channelRef.current = channel;

    // Broadcast cursor position (throttled)
    let lastSent = 0;
    const onMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastSent < 100) return;
      lastSent = now;
      channel.track({
        name: userName,
        color,
        cursor: { x: e.clientX, y: e.clientY },
      });
    };
    window.addEventListener("mousemove", onMouseMove);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      supabase.removeChannel(channel);
    };
  }, [projectId, userName]);

  return { collaborators };
}

/* Floating avatars showing live collaborators */
export function CollaboratorAvatars({ collaborators }: { collaborators: Collaborator[] }) {
  if (!collaborators.length) return null;

  return (
    <div className="fixed top-4 right-4 z-[9000] flex -space-x-2">
      {collaborators.slice(0, 5).map((c) => (
        <div
          key={c.userId}
          title={c.name}
          className="h-8 w-8 rounded-full border-2 border-background flex items-center justify-center text-xs font-bold text-white"
          style={{ backgroundColor: c.color }}
        >
          {c.name.charAt(0).toUpperCase()}
        </div>
      ))}
      {collaborators.length > 5 && (
        <div className="h-8 w-8 rounded-full border-2 border-background bg-muted flex items-center justify-center text-xs font-bold">
          +{collaborators.length - 5}
        </div>
      )}
    </div>
  );
}

/* Live cursors of collaborators */
export function CollaboratorCursors({ collaborators }: { collaborators: Collaborator[] }) {
  return (
    <>
      {collaborators.map(
        (c) =>
          c.cursor && (
            <div
              key={c.userId}
              className="fixed z-[8999] pointer-events-none transition-transform duration-100"
              style={{
                left: c.cursor.x,
                top: c.cursor.y,
                transform: "translate(-2px, -2px)",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill={c.color}>
                <path d="M5 3l14 7-6 2-2 6z" />
              </svg>
              <span
                className="text-xs px-1.5 py-0.5 rounded ml-3 -mt-1 inline-block text-white font-medium"
                style={{ backgroundColor: c.color }}
              >
                {c.name}
              </span>
            </div>
          )
      )}
    </>
  );
}
