import { Link } from "wouter";
import { Play, Eye, Heart, Users, Flame, Sparkles, SearchX, Radio } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, resolveMedia } from "@/lib/streaming";
import { verticalLabel } from "@/lib/verticals";
import { ShareMenu } from "./ShareMenu";
import { FollowButton } from "./FollowButton";

/* ─── Discovery shared UI — gold/black luxury, cheat-code voice ─────────── */

export interface CreatorLite {
  id: string;
  slug: string;
  display_name: string;
  avatar_url: string | null;
  vertical: string;
  follower_count: number;
  total_plays: number;
  bio?: string | null;
  new_followers?: number;
  window_plays?: number;
  /** Guide-to-money: true when the creator has digital sales. */
  has_sales?: boolean;
  month_earnings_cents?: number;
}

export function formatMoney(cents: number | null | undefined): string {
  const v = Math.max(0, Math.round(cents ?? 0));
  if (v >= 100_000) return `$${(v / 100_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${(v / 100).toFixed(v % 100 === 0 ? 0 : 2)}`;
}

export interface TrackLite {
  id: string;
  profile_id: string;
  title: string;
  genre: string | null;
  artwork_url: string | null;
  play_count: number;
  like_count: number;
  duration_sec: number | null;
  window_plays?: number;
  slug?: string;
  display_name?: string;
  avatar_url?: string | null;
}

export interface VideoLite {
  id: string;
  profile_id: string;
  title: string;
  genre: string | null;
  thumbnail_url: string | null;
  view_count: number;
  like_count: number;
  duration_sec: number | null;
  window_plays?: number;
  slug?: string;
  display_name?: string;
  avatar_url?: string | null;
}

export function rankBadge(i: number) {
  const base =
    "flex h-8 w-8 items-center justify-center rounded-full text-sm font-black shrink-0";
  if (i === 0)
    return `${base} bg-gradient-to-b from-[#ffe9a8] to-[#c9a84c] text-black shadow-[0_0_18px_rgba(232,200,106,0.5)]`;
  if (i === 1)
    return `${base} bg-gradient-to-b from-[#e8e8e8] to-[#9a9a9a] text-black`;
  if (i === 2)
    return `${base} bg-gradient-to-b from-[#f0b27a] to-[#a06a2c] text-black`;
  return `${base} border border-white/15 bg-white/5 text-white/60`;
}

export function SectionHeader({
  icon,
  title,
  blurb,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  blurb?: string;
  href?: string;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-black tracking-tight">
          <span className="text-[#e8c86a]">{icon}</span>
          {title}
        </h2>
        {blurb && <p className="mt-1 text-sm text-white/45">{blurb}</p>}
      </div>
      {href && (
        <Link href={href} className="shrink-0 text-sm font-semibold text-[#e8c86a] hover:underline">
          View all →
        </Link>
      )}
    </div>
  );
}

export function CreatorCard({
  creator,
  rank,
  followState,
}: {
  creator: CreatorLite;
  rank?: number;
  /** Batch-loaded follow state (useFollowStates) — renders the inline button. */
  followState?: boolean;
}) {
  return (
    <article className="group relative flex h-full flex-col items-center rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center transition-colors hover:border-[#e8c86a]/40">
      <Link href={`/artist/${creator.slug}`}>
        <div className="relative mb-3 cursor-pointer">
          {creator.avatar_url ? (
            <img
              src={resolveMedia(creator.avatar_url)}
              alt={creator.display_name}
              className="h-20 w-20 rounded-full border-2 border-[#c9a84c]/40 object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#c9a84c]/40 bg-gradient-to-b from-[#2a2118] to-[#0b0603] text-2xl font-black text-[#e8c86a]">
              {creator.display_name.slice(0, 1).toUpperCase()}
            </div>
          )}
          {typeof rank === "number" && (
            <span className={`absolute -left-2 -top-2 ${rankBadge(rank)}`}>{rank + 1}</span>
          )}
        </div>
      </Link>
      <Link href={`/artist/${creator.slug}`}>
        <h3 className="cursor-pointer font-bold leading-tight group-hover:text-[#e8c86a] line-clamp-1">
          {creator.display_name}
        </h3>
      </Link>
      <p className="mt-0.5 text-xs text-[#e8c86a]/80">{verticalLabel(creator.vertical)}</p>
      <div className="mt-3 flex items-center gap-4 text-xs text-white/45">
        <span className="flex items-center gap-1">
          <Users className="h-3.5 w-3.5" /> {formatCount(creator.follower_count)}
        </span>
        <span className="flex items-center gap-1">
          <Play className="h-3.5 w-3.5" /> {formatCount(creator.total_plays)}
        </span>
      </div>
      {typeof creator.new_followers === "number" && creator.new_followers > 0 && (
        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-emerald-300">
          <Flame className="h-3.5 w-3.5" /> +{formatCount(creator.new_followers)} this week
        </p>
      )}
      {creator.has_sales && (
        <Link
          href={`/artist/${creator.slug}`}
          title="Visit their store — they're selling"
          className="mt-2 inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] font-black text-emerald-300 transition-colors hover:bg-emerald-400/20"
        >
          💰 Selling
          {(creator.month_earnings_cents ?? 0) > 0 && (
            <span className="font-semibold text-emerald-200/80">
              · {formatMoney(creator.month_earnings_cents)}/mo
            </span>
          )}
        </Link>
      )}
      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        <FollowButton profileId={creator.id} initialFollowing={followState} />
      </div>
    </article>
  );
}

export function TrackRow({ track, rank, linkPath }: { track: TrackLite; rank?: number; linkPath?: string }) {
  const href = linkPath ?? `/track/${track.id}`;
  return (
    <div className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-[#e8c86a]/40">
      {typeof rank === "number" ? (
        <span className={rankBadge(rank)}>{rank + 1}</span>
      ) : null}
      <Link href={href} className="relative h-12 w-12 shrink-0 cursor-pointer">
        {track.artwork_url ? (
          <img
            src={resolveMedia(track.artwork_url)}
            alt=""
            className="h-12 w-12 rounded-lg object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-b from-[#2a2118] to-[#0b0603]">
            <Play className="h-5 w-5 text-[#e8c86a]" />
          </div>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={href}>
          <p className="cursor-pointer truncate font-semibold group-hover:text-[#e8c86a]">
            {track.title}
          </p>
        </Link>
        <p className="truncate text-xs text-white/40">
          {track.display_name ? (
            <Link href={`/artist/${track.slug}`} className="hover:text-[#e8c86a]">
              {track.display_name}
            </Link>
          ) : null}
          {track.genre ? ` · ${track.genre}` : ""}
        </p>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-xs text-white/45">
        <Play className="h-3.5 w-3.5" />
        {formatCount(track.window_plays ?? track.play_count)}
      </span>
      <ShareMenu path={href} title={track.title} compact />
    </div>
  );
}

export function VideoCard({ video, rank }: { video: VideoLite; rank?: number }) {
  return (
    <Link href={`/watch/${video.id}`}>
      <article className="group cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition-colors hover:border-[#e8c86a]/40">
        <div className="relative aspect-video bg-black/40">
          {video.thumbnail_url ? (
            <img
              src={resolveMedia(video.thumbnail_url)}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-[#2a2118] to-[#0b0603]">
              <Play className="h-8 w-8 text-[#e8c86a]/60" />
            </div>
          )}
          {typeof rank === "number" && (
            <span className={`absolute left-2 top-2 ${rankBadge(rank)}`}>{rank + 1}</span>
          )}
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white/80">
            <Eye className="mr-1 inline h-3 w-3" />
            {formatCount(video.window_plays ?? video.view_count)}
          </span>
        </div>
        <div className="p-3">
          <h3 className="truncate text-sm font-bold group-hover:text-[#e8c86a]">{video.title}</h3>
          <p className="mt-0.5 truncate text-xs text-white/40">
            {video.display_name ?? ""}
            {video.genre ? ` · ${video.genre}` : ""}
          </p>
        </div>
      </article>
    </Link>
  );
}

/* ─── Skeletons ─────────────────────────────────────────────────────────── */

export function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <Skeleton className="mx-auto mb-3 h-20 w-20 rounded-full" />
      <Skeleton className="mx-auto mb-2 h-4 w-3/4" />
      <Skeleton className="mx-auto h-3 w-1/2" />
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <Skeleton className="h-8 w-8 rounded-full" />
      <Skeleton className="h-12 w-12 rounded-lg" />
      <div className="flex-1">
        <Skeleton className="mb-2 h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export function ChartSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <RowSkeleton key={i} />
      ))}
    </div>
  );
}

/* ─── Empty states (cheat-code voice) ───────────────────────────────────── */

export function EmptyState({
  icon,
  title,
  blurb,
  ctaHref,
  ctaLabel,
}: {
  icon?: React.ReactNode;
  title: string;
  blurb?: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#c9a84c]/20 bg-gradient-to-b from-[#c9a84c]/[0.06] to-transparent px-6 py-14 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[#c9a84c]/30 bg-black/40 text-[#e8c86a]">
        {icon ?? <Sparkles className="h-6 w-6" />}
      </div>
      <h3 className="text-lg font-black">{title}</h3>
      {blurb && <p className="mx-auto mt-2 max-w-md text-sm text-white/50">{blurb}</p>}
      {ctaHref && ctaLabel && (
        <Link href={ctaHref}>
          <span className="mt-5 inline-block cursor-pointer rounded-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] px-6 py-2.5 text-sm font-black text-black hover:brightness-110">
            {ctaLabel}
          </span>
        </Link>
      )}
    </div>
  );
}

export function NoSearchResults({ q }: { q: string }) {
  return (
    <EmptyState
      icon={<SearchX className="h-6 w-6" />}
      title={q ? `No hits for "${q}"` : "Search the whole creator universe"}
      blurb="The next big thing might just not be here yet — or try a different search. The cheat code rewards the curious."
    />
  );
}


export function FeedEmpty() {
  return (
    <EmptyState
      icon={<Radio className="h-6 w-6" />}
      title="Your feed's quiet… too quiet."
      blurb="Follow some creators and you'll be the first to know when they drop. That's the cheat code — early fans win."
      ctaHref="/charts"
      ctaLabel="Find creators to follow"
    />
  );
}

