import { useEffect, useState } from "react";
import {
  Crown,
  DoorOpen,
  Home,
  Loader2,
  Music2,
  Play,
  ShoppingBag,
  Users,
} from "lucide-react";
import {
  creatorTrackPlayInput,
  creatorVideoPlayInput,
  fetchCreatorRoomDetail,
  fetchCreatorRoomDirectory,
  frontRowCourtMember,
  type CreatorRoomDetail,
  type CreatorRoomSummary,
} from "@/lib/world/creator-rooms";
import { isSameShelfItem } from "@/lib/world/shelf";
import type { ShelfPlayerController } from "./ShelfPlayer";
import { PortraitCard } from "./PortraitCard";

/* ─── Creator Rooms panels (Ring 2, item 3.5) ────────────────────────
   Two surfaces, both fed by the world-shaped reads
   (GET /api/world/creator-rooms[/:slug]):
   - the Courtyard arch's DIRECTORY: every public creator's room,
     with "Your room" pinned first for a signed-in creator — pick
     one and the page walks you through the doorway transfer.
   - the room's own four stations (Their Music / Their Screen /
     Their Store / Their Front Row), all reading the ONE room-data
     fetch (cached per slug below, so walking station to station
     in a room never refetches it).
   The room has no stage and no jukebox and these panels never
   pretend otherwise: music plays on the personal Shelf player,
   the screen piece plays in the panel (and on the room's screen
   mesh), the store rides the profile store rails, and the Front
   Row opens the same Portrait Cards the Court Chamber hangs. */

const detailCache = new Map<string, CreatorRoomDetail>();
const detailInflight = new Map<string, Promise<CreatorRoomDetail | null>>();

function loadRoomDetail(slug: string): Promise<CreatorRoomDetail | null> {
  const cached = detailCache.get(slug);
  if (cached) return Promise.resolve(cached);
  const flying = detailInflight.get(slug);
  if (flying) return flying;
  const p = fetchCreatorRoomDetail(slug).then((detail) => {
    detailInflight.delete(slug);
    if (detail) detailCache.set(slug, detail);
    return detail;
  });
  detailInflight.set(slug, p);
  return p;
}

function useRoomDetail(slug: string | null): {
  detail: CreatorRoomDetail | null;
  failed: boolean;
  retry: () => void;
} {
  const [detail, setDetail] = useState<CreatorRoomDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setFailed(false);
    loadRoomDetail(slug).then((d) => {
      if (cancelled) return;
      if (d) setDetail(d);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, tick]);
  return { detail, failed, retry: () => setTick((n) => n + 1) };
}

/* ─── The directory (the Courtyard arch's panel) ──────────────────── */

export function CreatorRoomsDirectory({
  isLight,
  mySlug,
  onEnterCreatorRoom,
}: {
  isLight: boolean;
  /** The signed-in walker's own profile slug (null for guests and
   *  members without a profile): their room pins to the top. */
  mySlug: string | null;
  onEnterCreatorRoom: (slug: string) => void;
}) {
  const [rooms, setRooms] = useState<CreatorRoomSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchCreatorRoomDirectory()
      .then((list) => {
        if (!cancelled) setRooms(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  if (failed) {
    return (
      <div className="flex flex-col items-start gap-2 px-1 py-3">
        <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          The rooms wouldn&rsquo;t list — the doors are fine, the directory slipped.
        </p>
        <button
          type="button"
          onClick={() => setTick((n) => n + 1)}
          className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
        >
          Try again
        </button>
      </div>
    );
  }
  if (rooms === null) {
    return (
      <p className={`inline-flex items-center gap-2 px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> Opening the arch…
      </p>
    );
  }
  if (rooms.length === 0) {
    return (
      <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        No creator has opened a room yet — the arch stands ready for the first host.
      </p>
    );
  }
  const mine = mySlug ? rooms.find((r) => r.slug === mySlug) ?? null : null;
  const others = mine ? rooms.filter((r) => r.slug !== mine.slug) : rooms;
  const row = (r: CreatorRoomSummary, isMine: boolean) => (
    <button
      key={r.slug}
      type="button"
      data-testid={isMine ? "world-creator-room-mine" : "world-creator-room-row"}
      onClick={() => onEnterCreatorRoom(r.slug)}
      className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition ${
        isLight
          ? "border-[#C9A84C]/50 bg-white/60 hover:border-[#7A5A12]"
          : "border-[#d4af37]/25 bg-white/5 hover:border-[#d4af37]/70"
      }`}
    >
      {r.avatarUrl ? (
        <img
          src={r.avatarUrl}
          alt={r.displayName}
          className="h-11 w-11 shrink-0 rounded-full border-2 object-cover"
          style={{ borderColor: r.theme.accent }}
        />
      ) : (
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-lg font-black text-black"
          style={{
            borderColor: r.theme.accent,
            background: `linear-gradient(135deg, ${r.theme.accent}, ${r.theme.primary})`,
          }}
        >
          {r.displayName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
          {isMine ? "Your room" : r.roomName}
        </span>
        <span className={`block truncate text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          {isMine ? `${r.displayName} — your place in the palace. ` : ""}
          {r.hasContent
            ? "Their music and featured work are on the walls."
            : "A quiet room — its host is still moving in."}
        </span>
      </span>
      {r.occupantCount > 0 && (
        <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          <Users className="h-3.5 w-3.5" /> {r.occupantCount} in
        </span>
      )}
      <DoorOpen className="h-4 w-4 shrink-0 text-[#d4af37]" />
    </button>
  );
  return (
    <div className="space-y-2">
      {mine && row(mine, true)}
      {others.map((r) => row(r, false))}
      <p className={`px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        Every room is its creator&rsquo;s place — their screen, their music rail, their Front Row,
        their store door. Pick one and the palace walks you through the arch.
      </p>
    </div>
  );
}

/* ─── Inside a creator's room: the four stations ──────────────────── */

export function CreatorRoomStation({
  stationId,
  slug,
  isLight,
  isGuest,
  shelfPlayer,
  onPlayTrack,
}: {
  stationId: string;
  slug: string;
  isLight: boolean;
  isGuest: boolean;
  shelfPlayer: ShelfPlayerController;
  /** Portrait Card Play seam: the host's jukebox.add intent (the
   *  card's own contract — a card press in ANY room offers the
   *  track to the Music Hall jukebox; the room's own rail below
   *  plays on the Shelf player instead). */
  onPlayTrack: (trackId: string) => void;
}) {
  const { detail, failed, retry } = useRoomDetail(slug);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  if (failed) {
    return (
      <div className="flex flex-col items-start gap-2 px-1 py-3">
        <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          This room&rsquo;s things wouldn&rsquo;t load — the room is here, its shelves slipped.
        </p>
        <button
          type="button"
          onClick={retry}
          className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!detail) {
    return (
      <p className={`inline-flex items-center gap-2 px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> Stepping into {slug}&rsquo;s room…
      </p>
    );
  }

  if (stationId === "creator-front-row") {
    const selected = detail.frontRow.find((m) => m.slug === selectedSlug) ?? null;
    if (selected) {
      return (
        <PortraitCard
          member={frontRowCourtMember(selected)}
          isLight={isLight}
          isGuest={isGuest}
          onPlayTrack={onPlayTrack}
          onBack={() => setSelectedSlug(null)}
        />
      );
    }
    if (detail.frontRow.length === 0) {
      return (
        <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          {detail.displayName} hasn&rsquo;t seated a Front Row yet — the chairs are here, the
          portraits come when they crown their court.
        </p>
      );
    }
    return (
      <div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {detail.frontRow.map((m) => (
            <button
              key={m.profileId}
              type="button"
              data-testid="world-creator-room-portrait"
              onClick={() => setSelectedSlug(m.slug)}
              className={`group flex flex-col items-center gap-1.5 rounded-2xl border px-3 py-3 text-center transition ${
                isLight
                  ? "border-[#C9A84C]/50 bg-white/60 hover:border-[#7A5A12]"
                  : "border-[#d4af37]/25 bg-white/5 hover:border-[#d4af37]/70"
              }`}
            >
              {m.avatarUrl ? (
                <img
                  src={m.avatarUrl}
                  alt={m.displayName}
                  className="h-14 w-14 rounded-full border-2 border-[#d4af37] object-cover"
                />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#d4af37] bg-gradient-to-br from-amber-300 to-amber-600 text-xl font-black text-black">
                  {m.displayName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className={`w-full truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {m.displayName}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-[#e8c86a]">
                <Crown className="h-3 w-3" /> Seat #{m.position}
              </span>
              <span className={`text-[11px] font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]/80"}`}>
                See their card →
              </span>
            </button>
          ))}
        </div>
        <p className={`px-1 pt-2 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          {detail.displayName}&rsquo;s Front Row — the creators they keep closest. A portrait
          opens that creator&rsquo;s card, right here in the room.
        </p>
      </div>
    );
  }

  if (stationId === "creator-music") {
    if (detail.tracks.length === 0) {
      return (
        <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          {detail.displayName} hasn&rsquo;t put any music on the rail yet — the shelf is here,
          waiting for their first published song.
        </p>
      );
    }
    return (
      <div className="space-y-1.5">
        {detail.tracks.map((t) => {
          const isCurrent =
            !!shelfPlayer.current &&
            isSameShelfItem(shelfPlayer.current, { kind: "track", id: t.id });
          const isFeatured = detail.featuredTrack?.id === t.id;
          return (
            <div
              key={t.id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
              }`}
            >
              {t.artworkUrl ? (
                <img src={t.artworkUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#d4af37]/15">
                  <Music2 className="h-5 w-5 text-[#d4af37]" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  {t.title}
                  {isFeatured && (
                    <span className="ml-2 align-middle text-[10px] font-black uppercase tracking-wide text-[#e8c86a]">
                      Featured
                    </span>
                  )}
                </span>
                <span className={`block text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                  {detail.displayName} · {t.playCount.toLocaleString("en-US")} plays
                </span>
              </span>
              <button
                type="button"
                data-testid="world-creator-room-track-play"
                onClick={() =>
                  isCurrent
                    ? shelfPlayer.toggle()
                    : shelfPlayer.play(creatorTrackPlayInput(t, detail))
                }
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105"
              >
                <Play className="h-3.5 w-3.5" />
                {isCurrent && shelfPlayer.playing ? "Pause" : "Play"}
              </button>
            </div>
          );
        })}
        <p className={`px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          Plays here, for you, on the palace player — the room has no jukebox (that&rsquo;s the
          Music Hall&rsquo;s, two doors west of the hall).
        </p>
      </div>
    );
  }

  if (stationId === "creator-screen") {
    const video = detail.featuredVideo;
    if (!video) {
      return (
        <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          {detail.displayName} hasn&rsquo;t put a video on the screen yet — the screen wears
          their name until their first featured piece.
        </p>
      );
    }
    const isCurrent =
      !!shelfPlayer.current &&
      isSameShelfItem(shelfPlayer.current, { kind: "video", id: video.id });
    return (
      <div className="space-y-2">
        <div
          className={`overflow-hidden rounded-2xl border ${isLight ? "border-[#C9A84C]/50" : "border-[#d4af37]/25"}`}
        >
          {video.thumbnailUrl ? (
            <img src={video.thumbnailUrl} alt={video.title} className="aspect-video w-full object-cover" />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center bg-black/60">
              <Play className="h-10 w-10 text-[#d4af37]" />
            </div>
          )}
          <div className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${isLight ? "bg-white/60" : "bg-white/5"}`}>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {video.title}
              </span>
              <span className={`block text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                {detail.displayName} · {video.viewCount.toLocaleString("en-US")} views
              </span>
            </span>
            <button
              type="button"
              data-testid="world-creator-room-screen-play"
              onClick={() =>
                isCurrent
                  ? shelfPlayer.toggle()
                  : shelfPlayer.play(creatorVideoPlayInput(video, detail))
              }
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
            >
              <Play className="h-3.5 w-3.5" />
              {isCurrent && shelfPlayer.playing ? "Pause" : "Watch"}
            </button>
          </div>
        </div>
        <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          The same piece plays on the room&rsquo;s big screen behind you — turn around. Watching
          here gives you the sound and the transport; the screen on the wall is the room&rsquo;s
          ambient showing.
        </p>
      </div>
    );
  }

  /* creator-store */
  return <CreatorStorePanel detail={detail} isLight={isLight} />;
}

/* ─── Their Store: the profile store catalog on the shop rails ────── */

interface StoreCatalogItem {
  id: string;
  kind: string;
  title: string;
  artworkUrl: string | null;
  price: string;
  buyUrl: string;
}

function parseStoreCatalog(payload: unknown): StoreCatalogItem[] {
  if (!payload || typeof payload !== "object") return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: StoreCatalogItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r["id"] === "string" ? r["id"] : "";
    const buyUrl = typeof r["buyUrl"] === "string" ? r["buyUrl"] : "";
    if (!id || !buyUrl) continue;
    out.push({
      id,
      kind: typeof r["kind"] === "string" ? r["kind"] : "item",
      title: typeof r["title"] === "string" ? r["title"] : "Untitled",
      artworkUrl: typeof r["artworkUrl"] === "string" ? r["artworkUrl"] : null,
      price: typeof r["price"] === "string" ? r["price"] : "",
      buyUrl,
    });
  }
  return out;
}

function CreatorStorePanel({ detail, isLight }: { detail: CreatorRoomDetail; isLight: boolean }) {
  const [items, setItems] = useState<StoreCatalogItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/creator-profiles/${encodeURIComponent(detail.slug)}/store-catalog`,
        );
        if (!res.ok) throw new Error("catalog");
        const parsed = parseStoreCatalog(await res.json());
        if (!cancelled) setItems(parsed);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.slug]);

  return (
    <div className="space-y-2">
      <p className={`inline-flex items-center gap-2 px-1 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        <ShoppingBag className="h-4 w-4 text-[#d4af37]" />
        {detail.storefront
          ? `${detail.displayName} also runs ${detail.storefront.name} — their shopfront stands in the Courtyard Marketplace too.`
          : `${detail.displayName}'s store, on their profile's own rails.`}
      </p>
      {failed ? (
        <p className={`px-1 py-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          The store wouldn&rsquo;t open — the goods are fine, the stand slipped.
        </p>
      ) : items === null ? (
        <p className={`inline-flex items-center gap-2 px-1 py-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> Setting out the goods…
        </p>
      ) : items.length === 0 ? (
        <p className={`px-1 py-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          Nothing is for sale here yet — the stand is built, the shelves fill when{" "}
          {detail.displayName} lists their first piece.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((item) => (
            <div
              key={`${item.kind}-${item.id}`}
              className={`flex flex-col gap-1.5 rounded-2xl border px-3 py-3 ${
                isLight ? "border-[#C9A84C]/50 bg-white/60" : "border-[#d4af37]/25 bg-white/5"
              }`}
            >
              {item.artworkUrl ? (
                <img src={item.artworkUrl} alt="" className="aspect-square w-full rounded-xl object-cover" />
              ) : (
                <span className="flex aspect-square w-full items-center justify-center rounded-xl bg-[#d4af37]/10">
                  <ShoppingBag className="h-7 w-7 text-[#d4af37]" />
                </span>
              )}
              <span className={`truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {item.title}
              </span>
              {item.price && (
                <span className={`text-xs font-black ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                  {item.price}
                </span>
              )}
              <a
                href={item.buyUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
              >
                Buy on the website
              </a>
            </div>
          ))}
        </div>
      )}
      <p className={`inline-flex items-center gap-1.5 px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        <Home className="h-3.5 w-3.5 text-[#d4af37]" />
        Buying finishes on the website, as at every palace stand — the room shows the goods,
        the till lives on the site.
      </p>
    </div>
  );
}
