# Worker 8 → Worker 4: mounting Stories on /artist/:slug

The stories rail, viewer, and highlights are built and live in
`artifacts/bow-down-visuals/src/components/social/`. Do NOT edit Worker 4's
files — these are drop-in mount instructions for the profile page.

## 1. Install the section (copy-paste)

```tsx
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiJson, type Story, type StoryHighlight } from "@/lib/social-api";
import { StoriesRail } from "@/components/social/StoriesRail";   // optional: global rail
import { StoryViewer } from "@/components/social/StoryViewer";
import { Avatar } from "@/components/social/Avatar";

/* Inside your /artist/:slug component, where `profile` is the loaded
   creator_profiles row: */
function ProfileStories({ profileId }: { profileId: string }) {
  const { getAccessToken } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [highlights, setHighlights] = useState<StoryHighlight[]>([]);
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);

  useEffect(() => {
    apiJson<{ stories: Story[] }>(getAccessToken, `/api/stories/by-profile/${profileId}`)
      .then((d) => setStories(d.stories)).catch(() => {});
    apiJson<{ highlights: StoryHighlight[] }>(getAccessToken, `/api/stories/highlights?profile_id=${profileId}`)
      .then((d) => setHighlights(d.highlights)).catch(() => {});
  }, [profileId, getAccessToken]);

  if (stories.length === 0 && highlights.length === 0) return null;
  return (
    <section aria-label="Stories">
      {/* live stories row */}
      {stories.length > 0 && (
        <div className="flex gap-3 overflow-x-auto py-2">
          {stories.map((s, i) => (
            <button key={s.id} onClick={() => setViewerIdx(i)} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5">
              <span className="rounded-full bg-gradient-to-tr from-[#d4af37] via-[#f5e08c] to-[#b8860b] p-[3px]">
                <img src={s.media_url} alt="" className="h-[62px] w-[62px] rounded-full object-cover" />
              </span>
              <span className="w-full truncate text-center text-[11px] text-neutral-300">Story</span>
            </button>
          ))}
        </div>
      )}
      {/* highlights row */}
      {highlights.length > 0 && (
        <div className="flex gap-3 overflow-x-auto py-2">
          {highlights.map((h) => (
            <div key={h.id} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5 opacity-90">
              <span className="flex h-[62px] w-[62px] items-center justify-center overflow-hidden rounded-full border border-[#d4af37]/50 bg-[#141414]">
                {h.cover_url ? <img src={h.cover_url} alt="" className="h-full w-full object-cover" /> : <span className="text-[#d4af37] text-lg">✦</span>}
              </span>
              <span className="w-full truncate text-center text-[11px] text-neutral-300">{h.title}</span>
            </div>
          ))}
        </div>
      )}
      {viewerIdx !== null && stories[viewerIdx] && (
        <StoryViewer stories={stories} startIndex={viewerIdx} onClose={() => setViewerIdx(null)} />
      )}
    </section>
  );
}
```

Mount `<ProfileStories profileId={profile.id} />` directly under the profile
header, above the content sections.

## 2. API contract (already live on staging)

- `GET /api/stories/by-profile/:profileId` — public, unexpired stories only
- `GET /api/stories/highlights?profile_id=:id` — public read (authed route,
  accepts any profile_id); without the param it returns the viewer's own
- `POST /api/stories/:id/view` — bump view count (called by StoryViewer)
- `POST /api/stories/:id/reply` — reply → DM (opens/reuses the canonical
  conversation with the profile owner via Worker 9's conversations/messages)

## 3. Link-graph notes

- The story viewer's header links to `/artist/:slug` (the profile page).
- Avatars everywhere (`Avatar` component) link to `/artist/:slug` and render
  the gold verified check when `creator_profiles.is_verified` is true
  (migration 0096 — Worker 4's profile API should include `is_verified` in
  its author payloads so badges show).
- `@mentions` in post bodies link to `/artist/:slug`; make sure the profile
  page resolves slugs case-insensitively (mention slugs are lowercased).
