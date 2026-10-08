import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Bookmark, Music2, Clapperboard } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { apiJson, type FeedPost, type SocialAuthor } from "@/lib/social-api";
import { PostCard } from "@/components/social/PostCard";
import { Avatar } from "@/components/social/Avatar";

interface SaveItem {
  kind: string;
  target_id: string;
  saved_at: string;
  post?: FeedPost | null;
  profile?: SocialAuthor | null;
  track?: { id: string; title: string; artwork_url: string | null; profile_id: string } | null;
  video?: { id: string; title: string; thumbnail_url: string | null; profile_id: string } | null;
}

/* ─── /saved — bookmarks: posts, profiles, sounds, videos ───────────────── */
export default function SavedPage() {
  const { getAccessToken } = useAuth();
  const [saves, setSaves] = useState<SaveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "post" | "profile" | "track" | "video">("all");

  usePageTitle("Saved", "Your bookmarks — posts, creators, sounds, and videos.");

  useEffect(() => {
    apiJson<{ saves: SaveItem[] }>(getAccessToken, "/api/saves/mine")
      .then((d) => setSaves(d.saves))
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = saves.filter((s) => tab === "all" || s.kind === tab);
  const countFor = (k: string) => saves.filter((s) => s.kind === k).length;

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 pb-24 pt-6">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-black text-white">
        <Bookmark className="h-6 w-6 text-[#d4af37]" /> Saved
      </h1>
      <p className="mb-4 text-xs text-neutral-500">Everything you bookmarked, one tap away.</p>

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {(["all", "post", "profile", "track", "video"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold ${
              tab === t ? "border-[#d4af37] bg-[#d4af37] text-black" : "border-[#2a2a2a] text-neutral-300 hover:border-[#d4af37]/60"
            }`}
          >
            {t === "all" ? `All (${saves.length})` : `${t[0].toUpperCase()}${t.slice(1)}s (${countFor(t)})`}
          </button>
        ))}
      </div>

      {loading && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl border border-[#2a2a2a] bg-[#111]" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#111] p-10 text-center">
          <p className="text-lg font-bold text-white">Nothing saved here yet 🦈</p>
          <p className="mt-2 text-sm text-neutral-400">Tap the bookmark on any post, sound, video, or creator to stash it here.</p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((s) => {
          if (s.kind === "post" && s.post) {
            return <PostCard key={`post-${s.target_id}`} post={s.post} onDeleted={() => setSaves((p) => p.filter((x) => x.target_id !== s.target_id))} />;
          }
          if (s.kind === "profile" && s.profile) {
            return (
              <Link
                key={`profile-${s.target_id}`}
                href={`/artist/${s.profile.slug}`}
                className="flex items-center gap-3 rounded-2xl border border-[#2a2a2a] bg-[#111] p-4 transition hover:border-[#d4af37]/60"
              >
                <Avatar author={s.profile} size={48} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-white">{s.profile.display_name}</span>
                  <span className="block text-xs text-neutral-500">@{s.profile.slug} · tap to visit</span>
                </span>
              </Link>
            );
          }
          if (s.kind === "track" && s.track) {
            return (
              <Link
                key={`track-${s.target_id}`}
                href={`/track/${s.track.id}`}
                className="flex items-center gap-3 rounded-2xl border border-[#2a2a2a] bg-[#111] p-4 transition hover:border-[#d4af37]/60"
              >
                {s.track.artwork_url ? (
                  <img src={s.track.artwork_url} alt="" className="h-12 w-12 rounded-lg object-cover" loading="lazy" />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#d4af37]/15">
                    <Music2 className="h-6 w-6 text-[#d4af37]" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-white">{s.track.title}</span>
                  <span className="block text-xs text-neutral-500">Sound · tap to listen</span>
                </span>
              </Link>
            );
          }
          if (s.kind === "video" && s.video) {
            return (
              <Link
                key={`video-${s.target_id}`}
                href={`/watch/${s.video.id}`}
                className="flex items-center gap-3 rounded-2xl border border-[#2a2a2a] bg-[#111] p-4 transition hover:border-[#d4af37]/60"
              >
                {s.video.thumbnail_url ? (
                  <img src={s.video.thumbnail_url} alt="" className="h-12 w-12 rounded-lg object-cover" loading="lazy" />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#d4af37]/15">
                    <Clapperboard className="h-6 w-6 text-[#d4af37]" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-white">{s.video.title}</span>
                  <span className="block text-xs text-neutral-500">Video · tap to watch</span>
                </span>
              </Link>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
