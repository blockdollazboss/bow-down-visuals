import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Plus, Check, Rocket } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── FollowButton — inline follow on every chart row / card ───────────────
   Hits Worker 1's contract:
     POST   /api/creator-profiles/:id/follow   → { followed, follower_count }
     DELETE /api/creator-profiles/:id/unfollow → { followed, follower_count }
   Initial state comes from GET /api/discovery/following?ids=… (batched by
   the parent via FollowStateContext, or pass `initialFollowing`). */

export function FollowButton({
  profileId,
  initialFollowing,
  onToggle,
  className,
}: {
  profileId: string;
  initialFollowing?: boolean;
  onToggle?: (following: boolean, followerCount: number | null) => void;
  className?: string;
}) {
  const { user, getAccessToken } = useAuth();
  const [following, setFollowing] = useState<boolean | null>(initialFollowing ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialFollowing !== undefined) setFollowing(initialFollowing);
  }, [initialFollowing]);

  if (!user) {
    return (
      <Link href="/signup">
        <span
          className={`inline-flex cursor-pointer items-center gap-1 rounded-full border border-[#c9a84c]/40 px-3 py-1 text-xs font-bold text-[#e8c86a] hover:bg-[#e8c86a]/10 ${className ?? ""}`}
        >
          <Plus className="h-3.5 w-3.5" /> Follow
        </span>
      </Link>
    );
  }

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const token = await getAccessToken().catch(() => null);
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };
      const r = await fetch(`/api/creator-profiles/${profileId}/${following ? "unfollow" : "follow"}`, {
        method: following ? "DELETE" : "POST",
        headers,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Follow failed");
      const next = !following;
      setFollowing(next);
      onToggle?.(next, typeof d.follower_count === "number" ? d.follower_count : null);
    } catch {
      /* the button just doesn't flip — no toast spam on discovery surfaces */
    } finally {
      setBusy(false);
    }
  };

  if (following === null) {
    return <span className={`inline-block h-7 w-20 animate-pulse rounded-full bg-white/10 ${className ?? ""}`} />;
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold transition-all disabled:opacity-50 ${
        following
          ? "border border-white/15 bg-white/5 text-white/60 hover:border-white/30"
          : "border border-[#c9a84c]/40 bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110"
      } ${className ?? ""}`}
    >
      {following ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
      {following ? "Following" : "Follow"}
    </button>
  );
}

/* ─── Batch follow-state loader ────────────────────────────────────────────
   useFollowStates(ids) → { [profileId]: boolean | undefined }.
   One GET /api/discovery/following?ids=… per id-set instead of N requests. */

export function useFollowStates(ids: string[]): Record<string, boolean | undefined> {
  const { user, getAccessToken } = useAuth();
  const [states, setStates] = useState<Record<string, boolean | undefined>>({});
  const key = [...new Set(ids)].filter(Boolean).sort().join(",");

  useEffect(() => {
    if (!user || !key) {
      setStates({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        if (!token || cancelled) return;
        const r = await fetch(`/api/discovery/following?ids=${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok || cancelled) return;
        const d = await r.json();
        if (!cancelled) setStates(d);
      } catch {
        /* follow buttons render in unknown state */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, key]);

  return states;
}

/* ─── CreateCta — every platform page links back to the creation tools ─────
   No orphaned surfaces: discovery always hands off to making something. */

const CREATE_LINKS = [
  { href: "/choose-artist", label: "Start creating", desc: "Songs, videos, everything" },
  { href: "/make-song", label: "Make a song", desc: "AI song studio" },
  { href: "/make-video", label: "Make a video", desc: "AI video studio" },
  { href: "/go-live", label: "Go live", desc: "Stream to your fans" },
];

export function CreateCta({ headline }: { headline?: string }) {
  return (
    <div className="mt-14 rounded-2xl border border-[#c9a84c]/25 bg-gradient-to-b from-[#c9a84c]/[0.08] to-transparent p-8 text-center md:p-10">
      <p className="mb-1 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#e8c86a]/80">
        <Rocket className="h-4 w-4" /> Your turn
      </p>
      <h2 className="text-2xl font-black tracking-tight md:text-3xl">
        {headline ?? "Seen the charts? Now break them."}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-white/50">
        Every creator up there started with one upload. The cheat code is
        yours — make something and take your shot.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {CREATE_LINKS.map((l) => (
          <Link key={l.href} href={l.href}>
            <span className="inline-block cursor-pointer rounded-full border border-[#c9a84c]/40 bg-black/40 px-5 py-2.5 text-sm font-bold text-[#e8c86a] transition-all hover:bg-[#e8c86a] hover:text-black">
              {l.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
