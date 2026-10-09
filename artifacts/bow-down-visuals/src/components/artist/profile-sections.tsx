import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Play, Pause, Heart, Share2, Check, Calendar, Radio, ShoppingBag,
  Megaphone, ChevronDown, MessageSquare, Sparkles, BadgeCheck, Gift,
  ExternalLink, MapPin,
} from "lucide-react";
import type {
  CreatorProfile, FeaturedMedia, ProfileSection, SeriesEntry,
  MerchItem, ProfileEventItem, SocialPostItem,
} from "@/lib/artist-profiles";
import { fetchComments, postComment, profileUrl, type ProfileComment } from "@/lib/artist-profiles";
import { RichText } from "@/lib/safe-richtext";
import { apiJson, type Story, type StoryHighlight } from "@/lib/social-api";
import { StoryViewer } from "@/components/social/StoryViewer";
import { useAuth } from "@/contexts/AuthContext";

/* ─── Shared profile section renderer ─────────────────────────────────────
   Used by the public /artist/:slug page, the AI Designer preview, and the
   editor. `mode="public"` hides empty sections; `mode="preview"` shows
   tasteful empty-state hints so the creator sees what to fill in. */

export interface MediaItem {
  id: string;
  title: string;
  thumbnailUrl?: string;
  url?: string;
  duration?: string;
  plays?: number;
  /** Deep link to the track/video page — media rows are never islands. */
  href?: string;
}

/* ─── Stories section (Worker 8 mount — 24h stories + highlights) ─────────── */
export function StoriesSection({ profileId }: { profileId: string }) {
  const { getAccessToken } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [highlights, setHighlights] = useState<StoryHighlight[]>([]);
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);

  useEffect(() => {
    apiJson<{ stories: Story[] }>(getAccessToken, `/api/stories/by-profile/${profileId}`)
      .then((d) => setStories(d.stories ?? [])).catch(() => {});
    apiJson<{ highlights: StoryHighlight[] }>(getAccessToken, `/api/stories/highlights?profile_id=${profileId}`)
      .then((d) => setHighlights(d.highlights ?? [])).catch(() => {});
  }, [profileId, getAccessToken]);

  if (stories.length === 0 && highlights.length === 0) return null;
  return (
    <section aria-label="Stories">
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

/* Internal vs external link renderer — keeps the link graph inside the
   platform for site routes, new-tab for off-site URLs. */
function SmartLink({ href, children, className, style }: {
  href: string; children: React.ReactNode; className?: string; style?: React.CSSProperties;
}) {
  if (/^https?:\/\//i.test(href)) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className={className} style={style}>{children}</a>;
  }
  return <Link href={href} className={className} style={style}>{children}</Link>;
}

function Shell({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="ap-section" style={{ padding: "var(--ap-pad)" }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          className="text-xl font-bold tracking-wide sm:text-2xl"
          style={{ fontFamily: "var(--ap-heading-font)", color: "var(--ap-text)" }}
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div
      className="rounded-lg border border-dashed p-4 text-center text-sm"
      style={{ borderColor: "var(--ap-border)", color: "var(--ap-muted)" }}
    >
      {text}
    </div>
  );
}

/* ─── Featured media hero — CLICK-TO-PLAY, never autoplay with sound ─── */
export function HeroSection({ profile }: { profile: CreatorProfile }) {
  const fm: FeaturedMedia | null = profile.featured_media;
  const [playing, setPlaying] = useState(false);
  const mediaRef = useRef<HTMLAudioElement | HTMLVideoElement | null>(null);
  const isVideo = fm?.kind === "video";
  const verticalLabel =
    profile.vertical === "gaming" ? "Stream" :
    profile.vertical === "podcast" ? "Featured Episode" :
    profile.vertical === "film" || profile.vertical === "tv" ? "Featured Trailer" :
    profile.vertical === "education" ? "Featured Lesson" :
    profile.vertical === "music" ? "Featured Track" : "Featured";

  useEffect(() => () => { mediaRef.current?.pause(); }, []);

  const toggle = () => {
    const el = mediaRef.current;
    if (!el || !fm?.url) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
  };

  return (
    <section className="ap-hero relative overflow-hidden">
      {profile.banner_url && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${profile.banner_url})`,
            opacity: 1 - profile.theme_config.banner.overlayOpacity,
          }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to top, var(--ap-bg) 4%, transparent 70%), linear-gradient(to top, rgba(0,0,0,${profile.theme_config.banner.overlayOpacity}), transparent 60%)`,
        }}
      />
      <div className="relative mx-auto max-w-4xl px-4 pb-10 pt-24 text-center sm:pt-32">
        {profile.avatar_url && (
          <img
            src={profile.avatar_url}
            alt={profile.display_name}
            className="mx-auto mb-4 h-24 w-24 rounded-full border-2 object-cover sm:h-28 sm:w-28"
            style={{ borderColor: "var(--ap-primary)" }}
          />
        )}
        <h1
          className="text-3xl font-black tracking-tight sm:text-5xl"
          style={{ fontFamily: "var(--ap-heading-font)", color: "var(--ap-text)" }}
        >
          {profile.display_name}
        </h1>
        {profile.bio && (
          <p className="mx-auto mt-3 max-w-xl text-sm sm:text-base" style={{ color: "var(--ap-muted)" }}>
            {profile.bio.split("\n")[0]}
          </p>
        )}

        {/* Featured media — honest tap-to-play. Browsers block autoplay with
            sound, so we say exactly what the tap does. */}
        <div
          className="mx-auto mt-6 max-w-2xl rounded-lg border p-4 text-left backdrop-blur"
          style={{ backgroundColor: "color-mix(in srgb, var(--ap-card) 82%, transparent)", borderColor: "var(--ap-border)" }}
        >
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--ap-primary)" }}>
            {verticalLabel}
          </div>
          {fm?.url ? (
            <div className="flex items-center gap-4">
              {isVideo ? (
                <video
                  ref={mediaRef as React.RefObject<HTMLVideoElement>}
                  src={fm.url}
                  poster={fm.thumbnailUrl}
                  className="h-20 w-32 shrink-0 rounded object-cover"
                  playsInline
                  preload="metadata"
                  onEnded={() => setPlaying(false)}
                />
              ) : (
                <>
                  {fm.thumbnailUrl && (
                    <img src={fm.thumbnailUrl} alt="" className="h-20 w-20 shrink-0 rounded object-cover" />
                  )}
                  <audio
                    ref={mediaRef as React.RefObject<HTMLAudioElement>}
                    src={fm.url}
                    preload="metadata"
                    onEnded={() => setPlaying(false)}
                    className="hidden"
                  />
                </>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold" style={{ color: "var(--ap-text)" }}>
                  {fm.title || "Featured drop"}
                </div>
                <div className="text-xs" style={{ color: "var(--ap-muted)" }}>
                  {playing ? "Now playing" : "Tap to play my featured " + (isVideo ? "video" : fm.kind === "episode" ? "episode" : "track")}
                </div>
                {fm.pageUrl && (
                  <SmartLink
                    href={fm.pageUrl}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-semibold underline"
                    style={{ color: "var(--ap-primary)" } as React.CSSProperties}
                  >
                    Open the {isVideo ? "video" : fm.kind === "episode" ? "episode" : "track"} page <ExternalLink className="h-3 w-3" />
                  </SmartLink>
                )}
              </div>
              <button
                onClick={toggle}
                aria-label={playing ? "Pause" : "Play featured media"}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-bold transition hover:scale-105"
                style={{ backgroundColor: "var(--ap-primary)", color: "#000" }}
              >
                {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
              </button>
            </div>
          ) : (
            <div className="text-sm" style={{ color: "var(--ap-muted)" }}>
              Nothing featured yet — the good stuff lands here.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ─── Media rows (tracks / videos) ─── */
export function MediaRowSection({ title, items, kind }: { title: string; items: MediaItem[]; kind: "track" | "video" }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <Shell title={title}>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <div
            key={it.id}
            className="rounded-lg border p-3 transition hover:-translate-y-0.5"
            style={{ backgroundColor: "var(--ap-card)", borderColor: "var(--ap-border)" }}
          >
            <div className="flex items-center gap-3">
              {it.thumbnailUrl ? (
                <img src={it.thumbnailUrl} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
              ) : (
                <span
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded"
                  style={{ backgroundColor: "var(--ap-surface)", color: "var(--ap-primary)" }}
                >
                  <Play className="h-5 w-5" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                {it.href ? (
                  <SmartLink href={it.href} className="block truncate text-sm font-semibold underline decoration-dotted underline-offset-2" style={{ color: "var(--ap-text)" }}>
                    {it.title}
                  </SmartLink>
                ) : (
                  <span className="block truncate text-sm font-semibold" style={{ color: "var(--ap-text)" }}>{it.title}</span>
                )}
                <span className="text-xs" style={{ color: "var(--ap-muted)" }}>
                  {[it.duration, typeof it.plays === "number" ? `${it.plays.toLocaleString()} plays` : null].filter(Boolean).join(" · ")}
                </span>
              </span>
              <button
                onClick={() => setActiveId(activeId === it.id ? null : it.id)}
                aria-label={activeId === it.id ? "Hide player" : "Preview"}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: "var(--ap-surface)", color: "var(--ap-primary)" }}
              >
                <Play className="h-4 w-4" />
              </button>
            </div>
            {it.url && activeId === it.id && (
              kind === "video"
                ? <video src={it.url} controls playsInline className="mt-2 w-full rounded" />
                : <audio src={it.url} controls preload="metadata" className="mt-2 w-full" />
            )}
          </div>
        ))}
      </div>
    </Shell>
  );
}

/* ─── Series / seasons / episodes grouping ─── */
export function SeriesSection({ title, series }: { title: string; series: SeriesEntry[] }) {
  const [open, setOpen] = useState<string | null>(series[0]?.id ?? null);
  if (!series.length) return null;
  return (
    <Shell title={title}>
      <div className="space-y-3">
        {series.map((s) => (
          <div
            key={s.id}
            className="overflow-hidden rounded-lg border"
            style={{ backgroundColor: "var(--ap-card)", borderColor: "var(--ap-border)" }}
          >
            <button
              onClick={() => setOpen(open === s.id ? null : s.id)}
              className="flex w-full items-center gap-3 p-3 text-left"
            >
              {s.thumbnailUrl && <img src={s.thumbnailUrl} alt="" className="h-12 w-20 rounded object-cover" />}
              <span className="flex-1 font-semibold" style={{ color: "var(--ap-text)" }}>{s.title}</span>
              <ChevronDown
                className="h-4 w-4 transition-transform"
                style={{ color: "var(--ap-muted)", transform: open === s.id ? "rotate(180deg)" : undefined }}
              />
            </button>
            {open === s.id && (
              <div className="border-t px-3 py-2" style={{ borderColor: "var(--ap-border)" }}>
                {s.seasons.map((season) => (
                  <div key={String(season.season)} className="py-2">
                    <div className="mb-1 text-xs font-bold uppercase tracking-widest" style={{ color: "var(--ap-primary)" }}>
                      Season {season.season}{season.title ? ` — ${season.title}` : ""}
                    </div>
                    {season.episodes.map((ep) => (
                      <div key={ep.id} className="flex items-center gap-3 py-1.5">
                        {ep.thumbnailUrl && <img src={ep.thumbnailUrl} alt="" className="h-9 w-14 rounded object-cover" />}
                        <span className="flex-1 truncate text-sm" style={{ color: "var(--ap-text)" }}>{ep.title}</span>
                        {ep.duration && <span className="text-xs" style={{ color: "var(--ap-muted)" }}>{ep.duration}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Shell>
  );
}

/* ─── Stream schedule + live-now ─── */
export function ScheduleSection({ title, profile }: { title: string; profile: CreatorProfile }) {
  const info = profile.stream_schedule;
  if (!info) return null;
  const slots = info.schedule ?? [];
  return (
    <Shell title={title}>
      {info.isLive ? (
        <a
          href={info.liveUrl || "#"}
          className="mb-3 flex items-center gap-3 rounded-lg border p-4"
          style={{ borderColor: "var(--ap-primary)", backgroundColor: "color-mix(in srgb, var(--ap-primary) 12%, var(--ap-card))" }}
        >
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
          </span>
          <span className="flex-1">
            <span className="block font-bold" style={{ color: "var(--ap-text)" }}>LIVE NOW{info.platform ? ` on ${info.platform}` : ""}</span>
            <span className="text-sm" style={{ color: "var(--ap-muted)" }}>Tap in — the chat is already going.</span>
          </span>
          <Radio className="h-5 w-5" style={{ color: "var(--ap-primary)" }} />
        </a>
      ) : info.nextStream ? (
        <div className="mb-3 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--ap-border)", color: "var(--ap-muted)" }}>
          <Calendar className="mr-2 inline h-4 w-4" style={{ color: "var(--ap-primary)" }} />
          Next stream: <strong style={{ color: "var(--ap-text)" }}>{info.nextStream}</strong>
        </div>
      ) : null}
      {slots.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {slots.map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
              style={{ backgroundColor: "var(--ap-card)", borderColor: "var(--ap-border)" }}
            >
              <span className="font-semibold" style={{ color: "var(--ap-text)" }}>{s.day}</span>
              <span style={{ color: "var(--ap-muted)" }}>{s.time}{s.label ? ` · ${s.label}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

/* ─── Media kit — stats, rates, collab CTA ─── */
export function MediaKitSection({ title, profile }: { title: string; profile: CreatorProfile }) {
  const kit = profile.media_kit;
  if (!kit) return null;
  const stats = [
    kit.followers && { label: "Followers", value: kit.followers },
    kit.avgViews && { label: "Avg. views", value: kit.avgViews },
    kit.engagement && { label: "Engagement", value: kit.engagement },
  ].filter(Boolean) as { label: string; value: string }[];
  return (
    <Shell
      title={title}
      action={
        <Link
          href="/coach?tab=brand-deals"
          className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition hover:scale-105"
          style={{ backgroundColor: "var(--ap-primary)", color: "#000" }}
        >
          <Megaphone className="h-4 w-4" /> Work with me
        </Link>
      }
    >
      {stats.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-lg border p-3 text-center"
              style={{ backgroundColor: "var(--ap-card)", borderColor: "var(--ap-border)" }}
            >
              <div className="text-lg font-black sm:text-2xl" style={{ color: "var(--ap-primary)", fontFamily: "var(--ap-heading-font)" }}>
                {s.value}
              </div>
              <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--ap-muted)" }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {kit.audienceNote && (
        <p className="mb-3 text-sm" style={{ color: "var(--ap-muted)" }}>{kit.audienceNote}</p>
      )}
      {kit.rates && kit.rates.length > 0 && (
        <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--ap-border)" }}>
          {kit.rates.map((r, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-4 py-2.5 text-sm"
              style={{
                backgroundColor: i % 2 ? "var(--ap-card)" : "var(--ap-surface)",
                color: "var(--ap-text)",
              }}
            >
              <span>{r.label}</span>
              <strong style={{ color: "var(--ap-primary)" }}>{r.price}</strong>
            </div>
          ))}
        </div>
      )}
      {kit.contactEmail && (
        <a
          href={`mailto:${kit.contactEmail}`}
          className="mt-3 inline-block text-sm underline"
          style={{ color: "var(--ap-primary)" }}
        >
          {kit.contactEmail}
        </a>
      )}
    </Shell>
  );
}

/* ─── Merch shelf — products link out; shelf links to their shop ─── */
export function MerchSection({ title, profile }: { title: string; profile: CreatorProfile }) {
  const items = profile.merch_items ?? [];
  const shopHref = `/my-shop?artist=${encodeURIComponent(profile.slug)}`;
  return (
    <Shell
      title={title}
      action={
        <SmartLink
          href={shopHref}
          className="flex items-center gap-1.5 text-sm font-semibold underline"
          style={{ color: "var(--ap-primary)" }}
        >
          <ShoppingBag className="h-4 w-4" /> Full shop
        </SmartLink>
      }
    >
      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {items.slice(0, 8).map((m: MerchItem) => (
            <SmartLink
              key={m.id}
              href={m.url || shopHref}
              className="group overflow-hidden rounded-lg border transition hover:-translate-y-0.5"
              style={{ backgroundColor: "var(--ap-card)", borderColor: "var(--ap-border)" }}
            >
              {m.imageUrl && <img src={m.imageUrl} alt={m.title} className="aspect-square w-full object-cover" />}
              <div className="p-2.5">
                <div className="truncate text-sm font-semibold" style={{ color: "var(--ap-text)" }}>{m.title}</div>
                {m.price && <div className="text-sm font-bold" style={{ color: "var(--ap-primary)" }}>{m.price}</div>}
              </div>
            </SmartLink>
          ))}
        </div>
      ) : (
        <LinkCardSection
          title={title}
          cta="Visit the shop"
          blurb="Official merch, made for the community."
          href={shopHref}
          icon={<ShoppingBag className="h-6 w-6" />}
        />
      )}
    </Shell>
  );
}

/* ─── Events — tour dates link to their event pages; section links to /tour ─── */
export function EventsSection({ title, profile }: { title: string; profile: CreatorProfile }) {
  const events = profile.events ?? [];
  const verticalWord = profile.vertical === "music" ? "tour dates" : "dates";
  return (
    <Shell
      title={title}
      action={
        <SmartLink
          href="/tour"
          className="flex items-center gap-1.5 text-sm font-semibold underline"
          style={{ color: "var(--ap-primary)" }}
        >
          <Calendar className="h-4 w-4" /> All {verticalWord}
        </SmartLink>
      }
    >
      {events.length > 0 ? (
        <div className="space-y-2">
          {events.slice(0, 6).map((e: ProfileEventItem) => (
            <SmartLink
              key={e.id}
              href={e.url || "/tour"}
              className="flex items-center gap-3 rounded-lg border p-3 transition hover:-translate-y-0.5"
              style={{ backgroundColor: "var(--ap-card)", borderColor: "var(--ap-border)" }}
            >
              <span
                className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg"
                style={{ backgroundColor: "var(--ap-surface)" }}
              >
                <Calendar className="h-5 w-5" style={{ color: "var(--ap-primary)" }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold" style={{ color: "var(--ap-text)" }}>{e.title}</span>
                <span className="flex items-center gap-1 text-xs" style={{ color: "var(--ap-muted)" }}>
                  {e.date && <span>{e.date}</span>}
                  {(e.venue || e.city) && (
                    <span className="flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" /> {[e.venue, e.city].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              </span>
              <ExternalLink className="h-4 w-4 shrink-0" style={{ color: "var(--ap-muted)" }} />
            </SmartLink>
          ))}
        </div>
      ) : (
        <LinkCardSection
          title={title}
          cta={`See ${verticalWord}`}
          blurb="Catch it live — don't just watch it happen."
          href="/tour"
          icon={<Calendar className="h-6 w-6" />}
        />
      )}
    </Shell>
  );
}

/* ─── Social posts feed ─── */
export function PostsSection({ title, posts }: { title: string; posts: SocialPostItem[] }) {
  if (!posts.length) return null;
  return (
    <Shell title={title}>
      <div className="grid gap-3 sm:grid-cols-3">
        {posts.slice(0, 6).map((p) => {
          const inner = (
            <>
              {p.imageUrl && <img src={p.imageUrl} alt="" className="aspect-video w-full rounded-t-lg object-cover" />}
              <div className="p-3">
                <p className="line-clamp-3 text-sm" style={{ color: "var(--ap-text)" }}>{p.text}</p>
                {p.created_at && (
                  <div className="mt-1 text-[11px]" style={{ color: "var(--ap-muted)" }}>
                    {new Date(p.created_at).toLocaleDateString()}
                  </div>
                )}
              </div>
            </>
          );
          return p.url ? (
            <SmartLink
              key={p.id}
              href={p.url}
              className="overflow-hidden rounded-lg border transition hover:-translate-y-0.5"
              style={{ backgroundColor: "var(--ap-card)", borderColor: "var(--ap-border)" }}
            >
              {inner}
            </SmartLink>
          ) : (
            <div
              key={p.id}
              className="overflow-hidden rounded-lg border"
              style={{ backgroundColor: "var(--ap-card)", borderColor: "var(--ap-border)" }}
            >
              {inner}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

/* ─── Simple link sections: merch, events ─── */
export function LinkCardSection({
  title, blurb, cta, href, icon,
}: { title: string; blurb: string; cta: string; href: string; icon: React.ReactNode }) {
  return (
    <Shell title={title}>
      <Link
        href={href}
        className="flex items-center gap-4 rounded-lg border p-4 transition hover:-translate-y-0.5"
        style={{ backgroundColor: "var(--ap-card)", borderColor: "var(--ap-border)" }}
      >
        <span style={{ color: "var(--ap-primary)" }}>{icon}</span>
        <span className="flex-1">
          <span className="block font-semibold" style={{ color: "var(--ap-text)" }}>{cta}</span>
          <span className="text-sm" style={{ color: "var(--ap-muted)" }}>{blurb}</span>
        </span>
      </Link>
    </Shell>
  );
}

/* ─── Shout wall ─── */
export function ShoutWallSection({ title, slug, preview }: { title: string; slug: string; preview?: boolean }) {
  const [comments, setComments] = useState<ProfileComment[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    fetchComments(slug).then((c) => { if (!cancelled) setComments(c); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [slug, preview]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const c = await postComment(slug, body);
      setComments((prev) => [c, ...prev]);
      setDraft("");
    } catch { /* auth wall or error — leave the draft in place */ }
    finally { setSending(false); }
  };

  return (
    <Shell title={title}>
      {!preview && (
        <div className="mb-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
            placeholder="Leave some love on the wall…"
            maxLength={280}
            className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ backgroundColor: "var(--ap-surface)", borderColor: "var(--ap-border)", color: "var(--ap-text)" }}
          />
          <button
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-40"
            style={{ backgroundColor: "var(--ap-primary)", color: "#000" }}
          >
            <MessageSquare className="h-4 w-4" /> Shout
          </button>
        </div>
      )}
      {comments.length === 0 ? (
        preview ? <EmptyHint text="The Shout Wall lives here — social proof sells. Every shout is a review." /> : (
          <p className="text-sm" style={{ color: "var(--ap-muted)" }}>
            Be the first to leave some love. <Sparkles className="inline h-4 w-4" style={{ color: "var(--ap-primary)" }} />
          </p>
        )
      ) : (
        <div className="space-y-2">
          {comments.slice(0, 10).map((c) => (
            <div
              key={c.id}
              className="rounded-lg border p-3"
              style={{ backgroundColor: "var(--ap-card)", borderColor: "var(--ap-border)" }}
            >
              <div className="mb-1 flex items-center gap-2">
                {c.author_avatar_url && <img src={c.author_avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />}
                {c.author_slug ? (
                  <Link href={`/artist/${encodeURIComponent(c.author_slug)}`} className="text-xs font-bold underline decoration-dotted underline-offset-2" style={{ color: "var(--ap-primary)" }}>
                    {c.author_name}
                  </Link>
                ) : (
                  <span className="text-xs font-bold" style={{ color: "var(--ap-primary)" }}>{c.author_name}</span>
                )}
              </div>
              <p className="text-sm" style={{ color: "var(--ap-text)" }}>{c.body}</p>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

/* ─── Top creators — the MySpace strip ─── */
export function TopCreatorsSection({ title, slugs }: { title: string; slugs: string[] }) {
  const [peeks, setPeeks] = useState<Record<string, { display_name: string; avatar_url: string | null }>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: typeof peeks = {};
      await Promise.all(slugs.slice(0, 8).map(async (s) => {
        try {
          const res = await fetch(`/api/creator-profiles/${encodeURIComponent(s)}`);
          if (!res.ok) return;
          const data = await res.json();
          const p = data.profile ?? data;
          out[s] = { display_name: p.display_name ?? s, avatar_url: p.avatar_url ?? null };
        } catch { /* skip */ }
      }));
      if (!cancelled) setPeeks(out);
    })();
    return () => { cancelled = true; };
  }, [slugs.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!slugs.length) return null;
  return (
    <Shell title={title}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {slugs.slice(0, 8).map((s) => {
          const peek = peeks[s];
          return (
            <Link key={s} href={`/artist/${encodeURIComponent(s)}`} className="group w-20 shrink-0 text-center">
              {peek?.avatar_url ? (
                <img
                  src={peek.avatar_url}
                  alt={peek.display_name}
                  className="mx-auto h-16 w-16 rounded-full border-2 object-cover transition group-hover:scale-105"
                  style={{ borderColor: "var(--ap-border)" }}
                />
              ) : (
                <span
                  className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 text-lg font-black"
                  style={{ borderColor: "var(--ap-border)", backgroundColor: "var(--ap-surface)", color: "var(--ap-primary)", fontFamily: "var(--ap-heading-font)" }}
                >
                  {(peek?.display_name ?? s).slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="mt-1 block truncate text-[11px]" style={{ color: "var(--ap-muted)" }}>
                {peek?.display_name ?? s}
              </span>
            </Link>
          );
        })}
      </div>
    </Shell>
  );
}

/* ─── Profile chrome: follow / tip / share / badge ─── */
export function ProfileActions({ profile }: { profile: CreatorProfile }) {
  const [following, setFollowing] = useState(false);
  const [count, setCount] = useState(profile.follower_count);
  const [shared, setShared] = useState(false);

  const toggleFollow = async () => {
    try {
      if (following) {
        const r = await (await import("@/lib/artist-profiles")).unfollowProfile(profile.slug);
        setCount(r.follower_count); setFollowing(false);
      } else {
        const r = await (await import("@/lib/artist-profiles")).followProfile(profile.slug);
        setCount(r.follower_count); setFollowing(true);
      }
    } catch { /* stay quiet — no dead button, just no-op on auth failure */ }
  };

  const share = async () => {
    /* Custom domain first — shares point at the creator's world, not ours. */
    const base = profileUrl(profile);
    const url = profile.referral_code
      ? `${base}?ref=${encodeURIComponent(profile.referral_code)}`
      : base;
    try {
      if (navigator.share) await navigator.share({ title: `${profile.display_name} — Bow Down Visuals`, url });
      else await navigator.clipboard.writeText(url);
      setShared(true); setTimeout(() => setShared(false), 2000);
    } catch { /* user cancelled */ }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-2 px-4 pb-6">
      <button
        onClick={() => void toggleFollow()}
        className="flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-bold transition hover:scale-105"
        style={following
          ? { border: "1px solid var(--ap-primary)", color: "var(--ap-primary)", backgroundColor: "transparent" }
          : { backgroundColor: "var(--ap-primary)", color: "#000" }}
      >
        <Heart className={`h-4 w-4 ${following ? "fill-current" : ""}`} />
        {following ? "Following" : "Follow"} · {count.toLocaleString()}
      </button>
      {profile.tip_jar_enabled && (
        <Link
          href={`/tips/${encodeURIComponent(profile.slug)}`}
          className="flex items-center gap-1.5 rounded-full border px-5 py-2 text-sm font-bold transition hover:scale-105"
          style={{ borderColor: "var(--ap-border)", color: "var(--ap-text)" }}
        >
          <Gift className="h-4 w-4" style={{ color: "var(--ap-primary)" }} /> Tip Jar
        </Link>
      )}
      <button
        onClick={() => void share()}
        aria-label="Share this profile"
        className="flex h-9 w-9 items-center justify-center rounded-full border transition hover:scale-105"
        style={{ borderColor: "var(--ap-border)", color: "var(--ap-muted)" }}
      >
        {shared ? <Check className="h-4 w-4 text-emerald-400" /> : <Share2 className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function MadeWithBadge({ referralCode }: { referralCode?: string | null }) {
  const href = referralCode ? `/?ref=${encodeURIComponent(referralCode)}` : "/";
  return (
    <div className="flex justify-center px-4 pb-10">
      <Link
        href={href}
        className="flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition hover:scale-105"
        style={{ borderColor: "var(--ap-border)", color: "var(--ap-muted)" }}
      >
        <BadgeCheck className="h-4 w-4" style={{ color: "var(--ap-primary)" }} />
        Made with Bow Down Visuals — the cheat code
      </Link>
    </div>
  );
}

/* ─── Master section switch ─── */
export function ProfileSections({
  profile, mode = "public",
}: { profile: CreatorProfile; mode?: "public" | "preview" }) {
  const preview = mode === "preview";
  /* Extension content lives on the profile defensively. */
  const mediaItems = (profile as unknown as { media_items?: { tracks?: MediaItem[]; videos?: MediaItem[] } }).media_items;

  return (
    <>
      {profile.sections.filter((s) => s.visible).map((s: ProfileSection) => {
        switch (s.type) {
          case "hero":
            return <HeroSection key={s.id} profile={profile} />;
          case "tracks":
            return mediaItems?.tracks?.length
              ? <MediaRowSection key={s.id} title={s.title} items={mediaItems.tracks} kind="track" />
              : preview ? <Shell key={s.id} title={s.title}><EmptyHint text="No drops yet — add your first drop. Every play is a future fan, and fans pay." /></Shell> : null;
          case "videos":
            return mediaItems?.videos?.length
              ? <MediaRowSection key={s.id} title={s.title} items={mediaItems.videos} kind="video" />
              : preview ? <Shell key={s.id} title={s.title}><EmptyHint text="No videos yet — add your first drop. Views turn into follows, follows turn into money." /></Shell> : null;
          case "series":
            return profile.series?.length
              ? <SeriesSection key={s.id} title={s.title} series={profile.series} />
              : preview ? <Shell key={s.id} title={s.title}><EmptyHint text="No series yet — group your content into bingeable seasons. Binges build superfans." /></Shell> : null;
          case "merch":
            return <MerchSection key={s.id} title={s.title} profile={profile} />;
          case "events":
            return <EventsSection key={s.id} title={s.title} profile={profile} />;
          case "posts":
            return profile.social_posts?.length
              ? <PostsSection key={s.id} title={s.title} posts={profile.social_posts} />
              : preview ? <Shell key={s.id} title={s.title}><EmptyHint text="No posts yet — your feed keeps fans coming back between drops." /></Shell> : null;
          case "schedule":
            return profile.stream_schedule
              ? <ScheduleSection key={s.id} title={s.title} profile={profile} />
              : preview ? <Shell key={s.id} title={s.title}><EmptyHint text="No schedule yet — tell fans when you're live. Live viewers tip the most." /></Shell> : null;
          case "mediakit":
            return profile.media_kit
              ? <MediaKitSection key={s.id} title={s.title} profile={profile} />
              : preview ? <Shell key={s.id} title={s.title}><EmptyHint text="No media kit yet — brands can't pay you if they can't see your numbers." /></Shell> : null;
          case "bio":
            return profile.bio ? (
              <Shell key={s.title + s.id} title={s.title}>
                <RichText source={profile.bio} className="ap-bio max-w-3xl text-sm leading-relaxed sm:text-base" />
              </Shell>
            ) : preview ? <Shell key={s.id} title={s.title}><EmptyHint text="No story yet — fans buy from creators they feel. The AI bio writer drafts it in one click." /></Shell> : null;
          case "shoutwall":
            return <ShoutWallSection key={s.id} title={s.title} slug={profile.slug} preview={preview} />;
          case "stories":
            return <StoriesSection key={s.id} profileId={profile.id} />;
          case "topcreators":
            return <TopCreatorsSection key={s.id} title={s.title} slugs={profile.top_creators} />;
          default:
            return null;
        }
      })}
    </>
  );
}
