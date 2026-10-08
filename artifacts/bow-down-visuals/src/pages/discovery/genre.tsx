import { useEffect, useMemo, useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { Users, Disc3, Clapperboard, ChevronLeft, Tags } from "lucide-react";
import {
  CreatorCard, TrackRow, VideoCard, SectionHeader,
  ChartSkeleton, CardSkeleton, EmptyState,
  type CreatorLite, type TrackLite, type VideoLite,
} from "@/components/discovery/cards";
import { useFollowStates, CreateCta } from "@/components/discovery/FollowButton";
import { ShareMenu } from "@/components/discovery/ShareMenu";

/* ─── /genre/:genre — one sound's whole world ─────────────────────────────
   Creators AND their tracks AND their videos — everything links both ways. */

interface GenrePayload {
  genre: string;
  tracks: TrackLite[];
  videos: VideoLite[];
  creators: CreatorLite[];
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export default function GenrePage() {
  const [, params] = useRoute("/genre/:genre");
  const [location] = useLocation();
  const genre = decodeURIComponent(params?.genre ?? "");
  const vertical = useMemo(() => {
    const m = /[?&]vertical=([^&]*)/.exec(location);
    return m ? decodeURIComponent(m[1]) : null;
  }, [location]);

  const [data, setData] = useState<GenrePayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const d = await getJson<GenrePayload>(
        `/api/discovery/genre/${encodeURIComponent(genre)}?limit=12${vertical ? `&vertical=${vertical}` : ""}`
      );
      if (!cancelled) {
        setData(d);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [genre, vertical]);

  const creatorIds = useMemo(() => (data?.creators ?? []).map((c) => c.id), [data]);
  const followStates = useFollowStates(creatorIds);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <Link href="/genres" className="mb-4 inline-flex items-center gap-1 text-sm text-white/40 hover:text-[#e8c86a]">
        <ChevronLeft className="h-4 w-4" /> All genres
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-[#e8c86a]">
            <Tags className="h-4 w-4" /> Genre
          </p>
          <h1 className="text-3xl font-black tracking-tight md:text-5xl">
            {genre || "Unknown"}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-white/50">
            The creators, the tracks, the videos — the whole {genre} universe in one place.
          </p>
        </div>
        <ShareMenu path={`/genre/${encodeURIComponent(genre)}`} title={`${genre} creators on Bow Down Visuals`} />
      </div>

      {loading || !data ? (
        <div className="grid gap-8 lg:grid-cols-2">
          <ChartSkeleton rows={6} />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        </div>
      ) : (
        <>
          {data.creators.length > 0 && (
            <section className="mb-10">
              <SectionHeader icon={<Users className="h-5 w-5" />} title={`${genre} creators`} />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {data.creators.map((c) => (
                  <CreatorCard key={c.id} creator={c} followState={followStates[c.id]} />
                ))}
              </div>
            </section>
          )}
          <div className="grid gap-10 lg:grid-cols-2">
            <section>
              <SectionHeader icon={<Disc3 className="h-5 w-5" />} title={`${genre} audio`} />
              {data.tracks.length === 0 ? (
                <EmptyState title="No audio here yet" blurb={`Be the first ${genre} drop. The lane is yours.`} />
              ) : (
                <div className="grid gap-3">
                  {data.tracks.map((t, i) => (
                    <TrackRow key={t.id} track={t} rank={i} />
                  ))}
                </div>
              )}
            </section>
            <section>
              <SectionHeader icon={<Clapperboard className="h-5 w-5" />} title={`${genre} videos`} />
              {data.videos.length === 0 ? (
                <EmptyState title="No videos here yet" blurb={`Be the first ${genre} video. The lane is yours.`} />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {data.videos.map((v, i) => (
                    <VideoCard key={v.id} video={v} rank={i} />
                  ))}
                </div>
              )}
            </section>
          </div>
          {data.creators.length === 0 && data.tracks.length === 0 && data.videos.length === 0 && (
            <EmptyState
              title={`Nothing tagged "${genre}" yet`}
              blurb="This sound is unclaimed. Drop something, tag it, and own it."
              ctaHref="/choose-artist"
              ctaLabel="Claim this genre"
            />
          )}
        </>
      )}

      <CreateCta headline={`Make the ${genre} anthem.`} />
    </div>
  );
}
