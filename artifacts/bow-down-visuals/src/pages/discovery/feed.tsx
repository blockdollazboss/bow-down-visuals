import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Radio, Sparkles } from "lucide-react";
import { TrackRow, FeedEmpty, RowSkeleton } from "@/components/discovery/cards";
import { CreateCta } from "@/components/discovery/FollowButton";
import { ShareMenu } from "@/components/discovery/ShareMenu";
import { useAuth } from "@/contexts/AuthContext";
import type { TrackLite } from "@/components/discovery/cards";

/* ─── /feed — your cheat-code wire ────────────────────────────────────────
   New releases from creators you follow (last 30 days), newest first.
   "New since your last visit" is badged from localStorage. Auth required. */

const LAST_VISIT_KEY = "bdv_feed_last_visit";

interface FeedItem extends TrackLite {
  kind: "track" | "video";
  thumb: string | null;
  created_at: string;
}

export default function Feed() {
  const { user, getAccessToken } = useAuth();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [lastVisit, setLastVisit] = useState<string | null>(null);

  useEffect(() => {
    setLastVisit(localStorage.getItem(LAST_VISIT_KEY));
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        if (!token || cancelled) return;
        const r = await fetch("/api/discovery/feed?limit=40", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok || cancelled) return;
        const d = await r.json();
        if (!cancelled) setItems(d.items ?? []);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    // Mark the visit AFTER the load kicks off so this batch counts as "seen" next time.
    localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);

  const freshCount = lastVisit
    ? (items ?? []).filter((i) => new Date(i.created_at) > new Date(lastVisit)).length
    : (items ?? []).length;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
      <div className="mb-6 text-center">
        <p className="mb-2 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-[#e8c86a]">
          <Radio className="h-4 w-4" /> Your feed
        </p>
        <h1 className="text-3xl font-black tracking-tight md:text-4xl">
          The <span className="bg-gradient-to-b from-[#ffe9a8] to-[#c9a84c] bg-clip-text text-transparent">wire.</span>
        </h1>
        <p className="mt-2 text-sm text-white/50">
          Every drop from every creator you follow. Early fans win.
        </p>
      </div>

      {items === null ? (
        <div className="grid gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <FeedEmpty />
      ) : (
        <>
          {freshCount > 0 && (
            <p className="mb-4 flex items-center justify-center gap-2 text-sm font-bold text-[#e8c86a]">
              <Sparkles className="h-4 w-4" />
              {freshCount} new since your last visit
            </p>
          )}
          <div className="grid gap-3">
            {items.map((item) => (
              <div key={`${item.kind}-${item.id}`} className="relative">
                {lastVisit && new Date(item.created_at) > new Date(lastVisit) && (
                  <span className="absolute -left-1 top-3 z-10 rounded-full bg-[#e8c86a] px-2 py-0.5 text-[10px] font-black uppercase text-black">
                    New
                  </span>
                )}
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <TrackRow
                      track={{ ...item, artwork_url: item.thumb }}
                      linkPath={item.kind === "video" ? `/video/${item.id}` : `/track/${item.id}`}
                    />
                  </div>
                </div>
                <p className="mt-1 pl-1 text-[11px] text-white/30">
                  {new Date(item.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                  {" · "}
                  <Link href={`/artist/${item.slug}`} className="hover:text-[#e8c86a]">
                    {item.display_name}
                  </Link>
                  {" · "}
                  <ShareMenu path={item.kind === "video" ? `/video/${item.id}` : `/track/${item.id}`} title={item.title} compact />
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-8 text-center text-sm">
        <Link href="/charts" className="font-bold text-[#e8c86a] hover:underline">
          Find more creators to follow →
        </Link>
      </div>

      <CreateCta headline="Your fans could see YOU here." />
    </div>
  );
}
