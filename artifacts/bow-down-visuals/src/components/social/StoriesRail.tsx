import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiJson, getSeenStories, type Story } from "@/lib/social-api";
import { Avatar } from "./Avatar";
import { StoryViewer } from "./StoryViewer";

/* Horizontal stories rail: one avatar per creator, GOLD ring = unviewed.
   "+ Your story" opens the story composer (URL + caption, 24h expiry). */
export function StoriesRail() {
  const { getAccessToken } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await apiJson<{ stories: Story[] }>(getAccessToken, "/api/stories/feed");
      setStories(data.stories);
      setSeen(getSeenStories());
    } catch {
      /* rail stays empty rather than breaking the feed */
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Group by creator: newest story first within each, creators by recency. */
  const groups = useMemo(() => {
    const map = new Map<string, Story[]>();
    for (const s of stories) {
      const arr = map.get(s.profile_id) ?? [];
      arr.push(s);
      map.set(s.profile_id, arr);
    }
    return [...map.entries()].sort(
      (a, b) => new Date(b[1][0].created_at).getTime() - new Date(a[1][0].created_at).getTime(),
    );
  }, [stories]);

  const flat = useMemo(() => groups.flatMap(([, arr]) => arr), [groups]);
  const unviewedCount = (arr: Story[]) => arr.filter((s) => !seen.has(s.id)).length;

  async function postStory() {
    if (!mediaUrl.trim() || posting) return;
    setPosting(true);
    setError(null);
    try {
      await apiJson(getAccessToken, "/api/stories", {
        method: "POST",
        body: JSON.stringify({ media_url: mediaUrl.trim(), caption: caption.trim().slice(0, 280) }),
      });
      setMediaUrl("");
      setCaption("");
      setComposerOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post that story.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div>
      <div className="flex gap-4 overflow-x-auto pb-2 pt-1" style={{ scrollbarWidth: "thin" }}>
        {/* Your story */}
        <button
          onClick={() => setComposerOpen((v) => !v)}
          className="flex w-[72px] shrink-0 flex-col items-center gap-1.5"
          aria-label="Post a story"
        >
          <span className="relative flex h-[68px] w-[68px] items-center justify-center rounded-full border-2 border-dashed border-[#d4af37]/50 bg-[#141414]">
            <Plus className="h-6 w-6 text-[#d4af37]" />
          </span>
          <span className="w-full truncate text-center text-[11px] text-neutral-300">Your story</span>
        </button>

        {groups.map(([profileId, arr]) => {
          const author = arr[0].author;
          const unviewed = unviewedCount(arr);
          return (
            <button
              key={profileId}
              onClick={() => setViewerIdx(flat.findIndex((s) => s.id === arr[0].id))}
              className="flex w-[72px] shrink-0 flex-col items-center gap-1.5"
              aria-label={`${author?.display_name ?? "Creator"}'s stories${unviewed ? `, ${unviewed} unviewed` : ""}`}
            >
              <span
                className={`rounded-full ${
                  unviewed > 0
                    ? "bg-gradient-to-tr from-[#d4af37] via-[#f5e08c] to-[#b8860b] p-[3px]"
                    : "border border-[#2a2a2a] p-[3px]"
                }`}
              >
                <Avatar author={author} size={62} showBadge={false} />
              </span>
              <span className="w-full truncate text-center text-[11px] text-neutral-300">
                {author?.display_name ?? "Creator"}
              </span>
            </button>
          );
        })}
      </div>

      {composerOpen && (
        <div className="mt-3 rounded-xl border border-[#d4af37]/30 bg-[#111] p-4">
          <p className="mb-2 text-sm font-semibold text-[#d4af37]">New story — live for 24 hours 🦈</p>
          <input
            value={mediaUrl}
            onChange={(e) => setMediaUrl(e.target.value)}
            placeholder="Paste an image or video URL…"
            className="mb-2 w-full rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#d4af37] focus:outline-none"
          />
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption (optional)…"
            maxLength={280}
            className="mb-3 w-full rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#d4af37] focus:outline-none"
          />
          {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
          <button
            onClick={postStory}
            disabled={!mediaUrl.trim() || posting}
            className="rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black disabled:opacity-40"
          >
            {posting ? "Posting…" : "Post story"}
          </button>
        </div>
      )}

      {viewerIdx !== null && flat[viewerIdx] && (
        <StoryViewer
          stories={flat}
          startIndex={viewerIdx}
          onClose={() => {
            setViewerIdx(null);
            setSeen(getSeenStories());
          }}
        />
      )}
    </div>
  );
}
