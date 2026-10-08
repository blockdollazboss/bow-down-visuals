import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { Users, Disc3, Clapperboard, Flame, Sparkles, Radio, ChevronLeft } from "lucide-react";
import {
  CreatorCard, TrackRow, VideoCard, SectionHeader,
  ChartSkeleton, CardSkeleton, EmptyState,
  type CreatorLite, type TrackLite, type VideoLite,
} from "@/components/discovery/cards";
import { useFollowStates, CreateCta } from "@/components/discovery/FollowButton";
import { ShareMenu } from "@/components/discovery/ShareMenu";
import { VERTICAL_META, isVerticalKey } from "@/lib/verticals";
import { formatCount } from "@/lib/streaming";

/* ─── /vertical/:vertical — one lane's home base ──────────────────────────
   Top creators, top audio, top videos, fresh drops, rising — plus a live
   CTA. Every card links to the creator AND their content; the share menu
   carries ?ref=CODE + "Made with Bow Down Visuals". */

interface VerticalPayload {
  vertical: string;
  label: string;
  creators: CreatorLite[];
  tracks: TrackLite[];
  videos: VideoLite[];
  new_this_week: Array<TrackLite & { kind: string; thumb: string | null }>;
  rising: CreatorLite[];
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

export default function VerticalPage() {
  const [, params] = useRoute("/vertical/:vertical");
  const vertical = (params?.vertical ?? "").toLowerCase();
  const valid = isVerticalKey(vertical);
  const [data, setData] = useState<VerticalPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!valid) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const d = await getJson<VerticalPayload>(`/api/discovery/vertical/${vertical}?limit=8`);
      if (!cancelled) {
        setData(d);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vertical, valid]);

  const creatorIds = useMemo(
    () => [...(data?.creators ?? []), ...(data?.rising ?? [])].map((c) => c.id),
    [data]
  );
  const followStates = useFollowStates(creatorIds);

  if (!valid) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-16">
        <EmptyState
          title="That lane doesn't exist… yet"
          blurb="The verticals are music, video, gaming, podcast, film, tv, influencer, education and more."
          ctaHref="/browse"
          ctaLabel="Browse all lanes"
        />
      </div>
    );
  }

  const meta = VERTICAL_META[vertical];
  const sharePath = `/vertical/${vertical}`;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <Link href="/browse" className="mb-4 inline-flex items-center gap-1 text-sm text-white/40 hover:text-[#e8c86a]">
        <ChevronLeft className="h-4 w-4" /> All lanes
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight md:text-5xl">
            {meta.label} <span className="bg-gradient-to-b from-[#ffe9a8] to-[#c9a84c] bg-clip-text text-transparent">hub.</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-white/50 md:text-base">{meta.pitch}</p>
        </div>
        <ShareMenu path={sharePath} title={`${meta.label} creators on Bow Down Visuals`} />
      </div>

      {loading || !data ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <>
          {/* Fresh drops */}
          {data.new_this_week.length > 0 && (
            <section className="mb-10">
              <SectionHeader
                icon={<Sparkles className="h-5 w-5" />}
                title="Fresh drops"
                blurb={`New ${meta.label.toLowerCase()} heat from the last 14 days.`}
              />
              <div className="grid gap-3 md:grid-cols-2">
                {data.new_this_week.slice(0, 6).map((item) => (
                  <TrackRow
                    key={`${item.kind}-${item.id}`}
                    track={{ ...item, artwork_url: item.thumb }}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Top creators */}
          <section className="mb-10">
            <SectionHeader
              icon={<Users className="h-5 w-5" />}
              title={`Top ${meta.plural.toLowerCase()}`}
              blurb="Ranked by plays + followers. This is where the next big one gets found."
            />
            {data.creators.length === 0 ? (
              <EmptyState
                title={`The ${meta.label.toLowerCase()} lane is wide open`}
                blurb="No chart-toppers here yet. Publish something and take the crown — the cheat code favors the bold."
                ctaHref="/choose-artist"
                ctaLabel="Claim this lane"
              />
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {data.creators.map((c, i) => (
                  <CreatorCard key={c.id} creator={c} rank={i} followState={followStates[c.id]} />
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-10 lg:grid-cols-2">
            <section>
              <SectionHeader icon={<Disc3 className="h-5 w-5" />} title="Top audio" />
              {data.tracks.length === 0 ? (
                <EmptyState title="Quiet in here" blurb="Be the first to drop audio in this lane." />
              ) : (
                <div className="grid gap-3">
                  {data.tracks.map((t, i) => (
                    <TrackRow key={t.id} track={t} rank={i} />
                  ))}
                </div>
              )}
            </section>
            <section>
              <SectionHeader icon={<Clapperboard className="h-5 w-5" />} title="Top videos" />
              {data.videos.length === 0 ? (
                <EmptyState title="Quiet in here" blurb="Be the first to drop video in this lane." />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {data.videos.map((v, i) => (
                    <VideoCard key={v.id} video={v} rank={i} />
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Rising */}
          {data.rising.length > 0 && (
            <section className="mt-10">
              <SectionHeader
                icon={<Flame className="h-5 w-5" />}
                title="Breaking in this lane"
                blurb="Gaining followers fastest this week."
              />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {data.rising.map((c) => (
                  <CreatorCard key={c.id} creator={c} followState={followStates[c.id]} />
                ))}
              </div>
            </section>
          )}

          {/* Go live CTA */}
          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#c9a84c]/25 bg-gradient-to-r from-[#c9a84c]/[0.08] to-transparent p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-red-400/40 bg-red-500/10">
                <Radio className="h-5 w-5 text-red-300" />
              </span>
              <div>
                <h3 className="font-black">Streaming in the {meta.label.toLowerCase()} lane?</h3>
                <p className="text-sm text-white/50">
                  Go live and your {formatCount(data.creators[0]?.follower_count ?? 0)}-strong crowd finds you here.
                </p>
              </div>
            </div>
            <Link href="/go-live">
              <span className="inline-block cursor-pointer rounded-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] px-6 py-2.5 text-sm font-black text-black hover:brightness-110">
                Go live now
              </span>
            </Link>
          </div>
        </>
      )}

      <CreateCta headline={`Run the ${meta.label.toLowerCase()} lane.`} />
    </div>
  );
}
