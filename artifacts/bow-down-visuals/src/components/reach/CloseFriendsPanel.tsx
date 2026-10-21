import { useCallback, useEffect, useState } from "react";
import { Heart, Search, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { reachApi } from "@/lib/reach-api";
import { apiJson } from "@/lib/social-api";

/* ── Close-friends circle (Stack 9 #7) ──────────────────────────────────
   The people on this list — and only these people — can see your
   posts and stories set to "Close friends". Enforcement is on the
   server at read time; this panel is just the list management. */

interface CircleFriend {
  userId: string;
  profile: { id: string; slug: string; displayName: string; avatarUrl: string | null } | null;
}

interface SearchHit {
  profile_id: string;
  slug: string;
  display_name: string;
  avatar_url: string | null;
}

export default function CloseFriendsPanel() {
  const { getAccessToken } = useAuth();
  const [friends, setFriends] = useState<CircleFriend[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchNote, setSearchNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await reachApi.closeFriends(getAccessToken);
      setFriends(d.friends);
      setError(null);
    } catch {
      setError("Your circle couldn't load.");
    }
  }, [getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="rounded-2xl border border-[#2a2a2a] bg-[#111] p-4 text-white" data-testid="close-friends-panel">
      <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#e8c86a]">
        <Heart className="h-4 w-4" /> Close friends
      </h3>
      <p className="mt-1 text-xs text-neutral-400">
        Only your circle sees posts and stories set to “Close friends” — enforced on every surface, the moment you change this list.
      </p>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      {friends.length === 0 && !error && <p className="mt-3 text-sm text-neutral-500">Your circle is empty for now.</p>}
      <ul className="mt-3 space-y-2">
        {friends.map((f) => (
          <li key={f.userId} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {f.profile?.avatarUrl ? <img src={f.profile.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e8c86a]/20 text-xs font-bold text-[#e8c86a]">{f.profile?.displayName?.[0] ?? "?"}</span>}
              <span className="truncate">{f.profile?.displayName ?? "Creator"}</span>
            </span>
            <button
              type="button"
              title="Remove from your circle"
              onClick={async () => {
                if (!f.profile) return;
                await reachApi.removeCloseFriend(getAccessToken, f.profile.id).catch(() => undefined);
                void load();
              }}
              className="text-neutral-500 transition hover:text-red-300"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setSearchNote(null);
          try {
            const d = await apiJson<{ creators?: SearchHit[] }>(getAccessToken, `/api/discovery/search?q=${encodeURIComponent(query.trim())}&type=creator`);
            setHits(d.creators ?? []);
            if (!(d.creators ?? []).length) setSearchNote("No creators matched that search.");
          } catch {
            setSearchNote("Search couldn't run right now.");
          }
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a creator…" className="min-w-0 flex-1 rounded-lg border border-[#2a2a2a] bg-black px-3 py-2 text-sm focus:border-[#d4af37] focus:outline-none" />
        <button type="submit" className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-2 text-xs font-bold text-black">
          <Search className="h-3.5 w-3.5" /> Find
        </button>
      </form>
      {searchNote && <p className="mt-2 text-xs text-neutral-500">{searchNote}</p>}
      {hits.length > 0 && (
        <ul className="mt-2 space-y-2">
          {hits.slice(0, 6).map((h) => (
            <li key={h.profile_id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{h.display_name}</span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await reachApi.addCloseFriend(getAccessToken, h.profile_id);
                    setHits((prev) => prev.filter((x) => x.profile_id !== h.profile_id));
                    void load();
                  } catch (err) {
                    setSearchNote(err instanceof Error ? err.message : "Couldn't add them.");
                  }
                }}
                className="rounded-full border border-[#d4af37]/50 px-3 py-1 text-xs font-bold text-[#e8c86a]"
              >
                Add to circle
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
