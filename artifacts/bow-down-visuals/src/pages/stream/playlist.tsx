import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useRoute } from "wouter";
import {
  Play, Pause, ArrowLeft, ListMusic, ListPlus, ListVideo,
  Music2, Clapperboard, UserPlus, UserCheck, Layers, Share2,
  Lock, Sparkles, Crown, Loader2, BadgeDollarSign,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { JsonLd } from "@/components/seo/json-ld";
import { useAuth } from "@/contexts/AuthContext";
import { useStreamingPlayer, trackToQueueItem, type QueueItem } from "@/contexts/StreamingPlayerContext";
import { PlayerShareMenu } from "@/components/player/MediaActions";
import { EmbedButton } from "@/components/player/EmbedButton";
import { CommentThread } from "@/components/player/CommentThread";
import {
  fetchPlaylist, fetchTrack, fetchVideo, formatCount, formatDuration, formatSeriesLabel,
  resolveMedia, togglePlaylistFollow, updatePlaylistSettings, fetchSeriesBuyers, runSeriesAssist,
  type StreamPlaylist, type StreamProfileRef, type MediaKind,
  type SeriesBuyer, type SeriesAssistDraft,
} from "@/lib/streaming";

/* ─── Playlist page — /playlist/:id (Worker 2) ───
   Audio AND video mix freely. Play-all feeds the site-wide audio queue for
   audio items; video items play on their watch pages. kind='series'
   playlists group videos by season with S1 E3 labeling. */

interface ResolvedItem {
  kind: MediaKind;
  id: string;
  title: string;
  thumb: string | null;
  duration: number | null;
  plays: number;
  src: string; // playable audio src (audio items only)
  artwork: string | null;
  season?: number | null;
  episode?: number | null;
  price?: number | null;
  /* Paid Series: locked episodes render as a shelf card (no player, no
     link); the preview episode is badged as the free watch. */
  locked?: boolean;
  isPreview?: boolean;
}

async function resolveItems(pl: StreamPlaylist, artistName: string, untitled: string): Promise<ResolvedItem[]> {
  if (pl.resolved_items && pl.resolved_items.length) {
    return pl.resolved_items.map((r) => {
      if (r.kind === "track") {
        const t = r.item;
        return {
          kind: "track" as const, id: String(t.id), title: t.title ?? untitled,
          thumb: t.artwork_url, duration: t.duration_sec, plays: t.play_count,
          src: resolveMedia(t.audio_url), artwork: t.artwork_url,
          price: t.download_price_cents ?? null,
          locked: r.locked ?? false, isPreview: r.is_preview ?? false,
        };
      }
      const v = r.item;
      return {
        kind: "video" as const, id: String(v.id), title: v.title ?? untitled,
        thumb: v.thumbnail_url, duration: v.duration_sec, plays: v.view_count,
        src: "", artwork: v.thumbnail_url,
        season: v.season_number ?? null, episode: v.episode_number ?? null,
        locked: r.locked ?? false, isPreview: r.is_preview ?? false,
      };
    });
  }
  // Fall back to per-item fetches (bounded — playlists are capped at 200 server-side).
  const refs = (pl.items ?? []).slice(0, 60);
  const out: ResolvedItem[] = [];
  await Promise.all(refs.map(async (ref) => {
    try {
      if (ref.kind === "track") {
        const r = await fetchTrack(String(ref.id));
        if (r) out.push({
          kind: "track", id: String(r.track.id), title: r.track.title ?? untitled,
          thumb: r.track.artwork_url, duration: r.track.duration_sec, plays: r.track.play_count,
          src: resolveMedia(r.track.audio_url), artwork: r.track.artwork_url,
          price: r.track.download_price_cents ?? null,
        });
      } else {
        const r = await fetchVideo(String(ref.id));
        if (r) out.push({
          kind: "video", id: String(r.video.id), title: r.video.title ?? untitled,
          thumb: r.video.thumbnail_url, duration: r.video.duration_sec, plays: r.video.view_count,
          src: "", artwork: r.video.thumbnail_url,
          season: r.video.season_number ?? null, episode: r.video.episode_number ?? null,
        });
      }
    } catch { /* skip missing items */ }
  }));
  // Preserve the playlist's original order.
  const order = new Map(refs.map((r, i) => [`${r.kind}:${r.id}`, i]));
  out.sort((a, b) => (order.get(`${a.kind}:${a.id}`) ?? 999) - (order.get(`${b.kind}:${b.id}`) ?? 999));
  return out;
}

export default function StreamPlaylistPage() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const [, params] = useRoute("/playlist/:id");
  const id = params?.id ?? "";
  const player = useStreamingPlayer();
  const { user, getAccessToken } = useAuth();

  const [playlist, setPlaylist] = useState<StreamPlaylist | null>(null);
  const [owner, setOwner] = useState<StreamProfileRef | null>(null);
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followers, setFollowers] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  /* Paid Series — Series Studio state (owner only). */
  const [priceDollars, setPriceDollars] = useState("");
  const [previewKey, setPreviewKey] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [assistDraft, setAssistDraft] = useState<SeriesAssistDraft | null>(null);
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistMsg, setAssistMsg] = useState<string | null>(null);
  const [buyers, setBuyers] = useState<SeriesBuyer[]>([]);
  const [buyerTotals, setBuyerTotals] = useState<{ buyers: number; gross_cents: number; gross: string } | null>(null);

  const userId = (user as { id?: string } | null)?.id ?? null;

  async function authHeaders(): Promise<Record<string, string> | undefined> {
    const token = await getAccessToken().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  }

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setNotFound(false);
    (async () => {
      /* A signed-in viewer passes their session along: buyers and owners
         see the series unlocked; everyone else gets the locked shelf. */
      const headers = userId ? await authHeaders() : undefined;
      const res = await fetchPlaylist(id, headers);
      if (!alive) return;
      if (!res) { setNotFound(true); setLoading(false); return; }
      setPlaylist(res.playlist);
      setOwner(res.owner ?? null);
      setFollowers(res.playlist.follower_count ?? 0);
      setPriceDollars(
        (res.playlist.price_cents ?? 0) > 0 ? ((res.playlist.price_cents ?? 0) / 100).toFixed(2) : "",
      );
      setPreviewKey(
        res.playlist.preview_item ? `${res.playlist.preview_item.kind}:${res.playlist.preview_item.id}` : "",
      );
      const resolved = await resolveItems(res.playlist, res.owner?.display_name ?? t("playlist.creatorFallback"), t("playlist.untitled"));
      if (alive) { setItems(resolved); setLoading(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, userId]);

  /* The buyer list loads for the owner alone (the endpoint refuses
     everyone else — the list is the creator's property). */
  useEffect(() => {
    if (!playlist || !playlist.is_owner || (playlist.kind ?? "").toLowerCase() !== "series") return;
    let alive = true;
    (async () => {
      const headers = await authHeaders();
      if (!headers || !alive) return;
      const res = await fetchSeriesBuyers(playlist.id, headers);
      if (alive && res) { setBuyers(res.buyers); setBuyerTotals(res.totals); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist?.id, playlist?.is_owner, playlist?.kind]);

  usePageTitle(
    playlist ? t("playlist.pageTitleWith", { title: playlist.title }) : t("playlist.kindPlaylist"),
    playlist ? t("playlist.pageDescWith", { text: playlist.description ?? playlist.title }) : t("playlist.pageDescDefault")
  );

  const isSeries = (playlist?.kind ?? "").toLowerCase() === "series";
  const ownerName = owner?.display_name ?? t("playlist.creatorFallback");
  /* Paid Series state for this viewer. */
  const isPaidSeries = isSeries && !!playlist?.is_paid_series;
  const seriesAccess = playlist?.series_access ?? "free";
  const seriesPrice = (playlist?.price_cents ?? 0) > 0
    ? `$${((playlist?.price_cents ?? 0) / 100).toFixed(2)}`
    : null;
  const isSeriesOwner = isSeries && !!playlist?.is_owner;
  const titleByKey = useMemo(
    () => new Map(items.map((i) => [`${i.kind}:${i.id}`, i.title])),
    [items],
  );

  const audioItems = useMemo(() => items.filter((i) => i.kind === "track" && i.src), [items]);
  const videoCount = useMemo(() => items.filter((i) => i.kind === "video").length, [items]);
  const totalSecs = useMemo(() => items.reduce((n, i) => n + (i.duration ?? 0), 0), [items]);

  /* Season grouping for series playlists. */
  const seasons = useMemo(() => {
    if (!isSeries) return null;
    const groups = new Map<number | string, ResolvedItem[]>();
    for (const i of items) {
      const key = i.season ?? "other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    }
    return [...groups.entries()].sort((a, b) => {
      const sa = a[0] === "other" ? 999 : Number(a[0]);
      const sb = b[0] === "other" ? 999 : Number(b[0]);
      return sa - sb;
    });
  }, [isSeries, items]);

  function toQueueItem(i: ResolvedItem): QueueItem {
    return { kind: "track", id: i.id, title: i.title, artistName: ownerName, artwork: i.artwork, src: i.src };
  }

  function playAll(fromIndex = 0) {
    const queue = audioItems.map(toQueueItem);
    if (!queue.length) return;
    player.playItems(queue, Math.min(fromIndex, queue.length - 1));
  }

  async function handleFollow() {
    if (!user || !playlist) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      const prev = following;
      setFollowing(!prev);
      setFollowers((n) => n + (prev ? -1 : 1));
      const res = await togglePlaylistFollow(String(playlist.id), prev, { Authorization: `Bearer ${token}` });
      setFollowing(res.following);
      if (res.count != null) setFollowers(res.count);
    } catch {
      setFollowing((v) => !v);
    }
  }

  const firstVideo = items.find((i) => i.kind === "video");
  const isPlayingPlaylist = player.current?.kind === "track" && audioItems.some((i) => i.id === player.current?.id);

  /* ── Series Studio handlers (owner) ────────────────────────────────────
     Every write goes through the settings PATCH — including applying a
     Turbo draft, which only ever happens on the creator's own tap. */
  async function refreshPlaylist(updated: StreamPlaylist) {
    setPlaylist(updated);
    setItems(await resolveItems(updated, ownerName, t("playlist.untitled")));
  }

  async function saveSeriesSettings() {
    if (!playlist) return;
    const headers = await authHeaders();
    if (!headers) { setSettingsMsg(t("paidSeries.msgSignInSave")); return; }
    let priceCents: number | null = null;
    const trimmed = priceDollars.trim();
    if (trimmed) {
      const parsed = Number.parseFloat(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setSettingsMsg(t("paidSeries.msgPriceParse"));
        return;
      }
      priceCents = Math.round(parsed * 100);
      if (priceCents > 0 && priceCents < 50) {
        setSettingsMsg(t("paidSeries.msgPriceMin"));
        return;
      }
    }
    const preview = previewKey
      ? { kind: previewKey.split(":")[0] as MediaKind, id: previewKey.split(":")[1]! }
      : null;
    setSavingSettings(true);
    setSettingsMsg(null);
    const updated = await updatePlaylistSettings(
      playlist.id, { price_cents: priceCents, preview_item: preview }, headers,
    );
    setSavingSettings(false);
    if (!updated) { setSettingsMsg(t("paidSeries.msgSaveFailed")); return; }
    await refreshPlaylist(updated);
    setSettingsMsg(priceCents
      ? t("paidSeries.msgSavedPaid", { price: `$${(priceCents / 100).toFixed(2)}` })
      : t("paidSeries.msgSavedFree"));
  }

  async function buildWithAssist() {
    if (!playlist) return;
    const headers = await authHeaders();
    if (!headers) { setAssistMsg(t("paidSeries.msgSignInAssist")); return; }
    setAssistBusy(true);
    setAssistMsg(null);
    const draft = await runSeriesAssist(playlist.id, headers);
    setAssistBusy(false);
    if (!draft) { setAssistMsg(t("paidSeries.msgAssistFailed")); return; }
    setAssistDraft(draft);
  }

  async function applyAssistOrder() {
    if (!playlist || !assistDraft) return;
    const headers = await authHeaders();
    if (!headers) return;
    const refs = assistDraft.suggested_order.map((k) => ({
      kind: k.split(":")[0] as MediaKind, id: k.split(":")[1]!,
    }));
    setAssistBusy(true);
    const updated = await updatePlaylistSettings(playlist.id, { items: refs }, headers);
    setAssistBusy(false);
    if (updated) { await refreshPlaylist(updated); setAssistMsg(t("paidSeries.msgOrderApplied")); }
    else setAssistMsg(t("paidSeries.msgOrderFailed"));
  }

  async function applyAssistCopy(field: "title" | "description") {
    if (!playlist || !assistDraft) return;
    const headers = await authHeaders();
    if (!headers) return;
    const patch = field === "title"
      ? { title: assistDraft.sales_copy.headline }
      : { description: assistDraft.sales_copy.description };
    setAssistBusy(true);
    const updated = await updatePlaylistSettings(playlist.id, patch, headers);
    setAssistBusy(false);
    if (updated) { await refreshPlaylist(updated); setAssistMsg(field === "title" ? t("paidSeries.msgTitleApplied") : t("paidSeries.msgDescApplied")); }
    else setAssistMsg(t("paidSeries.msgCopyFailed"));
  }

  function ItemRow({ item, position }: { item: ResolvedItem; position: number }) {
    const isCurrentAudio = player.current?.kind === "track" && player.current?.id === item.id;
    const seriesLabel = formatSeriesLabel(item.season, item.episode);
    const inner = (
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors hover:bg-white/5 ${isCurrentAudio ? "bg-[#e8c86a]/10" : ""}`}>
        <span className="w-6 text-center text-xs text-white/30 tabular-nums shrink-0">{position + 1}</span>
        {item.thumb ? (
          <img src={item.thumb} alt="" loading="lazy" className="h-11 w-11 rounded-lg object-cover shrink-0" />
        ) : (
          <div className="h-11 w-11 rounded-lg bg-[#e8c86a]/10 flex items-center justify-center shrink-0">
            {item.kind === "video" ? <Clapperboard className="h-5 w-5 text-[#e8c86a]/50" /> : <Music2 className="h-5 w-5 text-[#e8c86a]/50" />}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className={`text-sm truncate ${isCurrentAudio ? "text-[#e8c86a] font-semibold" : "text-white/85"}`}>{item.title}</p>
          <p className="text-xs text-white/40 flex items-center gap-2">
            {item.kind === "video" ? (
              <><Clapperboard className="h-3 w-3" /> {t("playlist.rowVideoViews", { count: formatCount(item.plays) })}</>
            ) : (
              <><Music2 className="h-3 w-3" /> {t("playlist.rowAudioPlays", { count: formatCount(item.plays) })}</>
            )}
            {seriesLabel && <span className="text-[#e8c86a]/80 font-semibold">{seriesLabel}</span>}
            {item.isPreview && (
              <span className="rounded-full bg-[#e8c86a] text-black px-1.5 py-px text-[10px] font-bold uppercase tracking-wide">{t("paidSeries.freePreviewBadge")}</span>
            )}
            {item.locked && (
              <span className="inline-flex items-center gap-1 text-white/40"><Lock className="h-3 w-3" /> {t("paidSeries.lockedWord")}</span>
            )}
          </p>
        </div>
        <span className="text-xs text-white/30 tabular-nums shrink-0">{formatDuration(item.duration)}</span>
      </div>
    );

    if (item.locked) {
      /* Locked episodes point at the unlock panel — never at a player. */
      return <a href="#series-unlock" className="block opacity-80">{inner}</a>;
    }
    if (item.kind === "video") {
      return <Link href={`/watch/${item.id}`}>{inner}</Link>;
    }
    return (
      <div className="group relative">
        <button
          className="w-full text-left"
          onClick={() => {
            const queue = audioItems.map(toQueueItem);
            const idx = queue.findIndex((q) => q.id === item.id);
            player.playItems(queue, Math.max(0, idx));
          }}
        >
          {inner}
        </button>
        <div data-min-stars="3" className="absolute right-3 top-1/2 -translate-y-1/2 hidden group-hover:flex gap-1 bg-black/70 rounded-full px-1">
          <button
            onClick={() => player.playNext(toQueueItem(item))}
            className="p-1.5 text-white/60 hover:text-[#e8c86a]" title={t("playlist.playNext")} aria-label={t("playlist.playNext")}
          >
            <ListVideo className="h-4 w-4" />
          </button>
          <button
            onClick={() => player.addToQueue(toQueueItem(item))}
            className="p-1.5 text-white/60 hover:text-[#e8c86a]" title={t("playlist.addToQueue")} aria-label={t("playlist.addToQueue")}
          >
            <ListPlus className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-white/40">{t("playlist.loading")}</p>
      </div>
    );
  }

  if (notFound || !playlist) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <ListMusic className="h-12 w-12 text-[#e8c86a]/40 mx-auto mb-4" />
          <p className="text-xl font-bold mb-2">{t("playlist.notFoundTitle")}</p>
          <p className="text-white/40 text-sm mb-6">{t("playlist.notFoundBody")}</p>
          <Link href="/showcase"><span className="text-[#e8c86a] underline text-sm">{t("playlist.backToShowcase")}</span></Link>
        </div>
      </div>
    );
  }

  const cover = playlist.cover_url ?? items[0]?.thumb ?? null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: playlist.title,
    description: playlist.description ?? playlist.title,
    url: `https://bowdownvisuals.com/playlist/${playlist.id}`,
    numberOfItems: items.length,
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <JsonLd data={jsonLd} />
      <div className="mx-auto max-w-4xl px-4 md:px-6 py-8">
        <Link href="/showcase" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-[#e8c86a] mb-6">
          <ArrowLeft className="h-4 w-4" /> {t("playlist.back")}
        </Link>

        <div className="grid md:grid-cols-[280px_1fr] gap-8">
          <div>
            {cover ? (
              <img src={cover} alt={playlist.title} className="w-full aspect-square rounded-2xl object-cover border border-[#e8c86a]/25 shadow-[0_20px_60px_rgba(0,0,0,.6)]" />
            ) : (
              <div className="w-full aspect-square rounded-2xl bg-gradient-to-br from-[#e8c86a]/25 to-black border border-[#e8c86a]/25 flex items-center justify-center">
                {isSeries ? <Clapperboard className="h-16 w-16 text-[#e8c86a]/50" /> : <ListMusic className="h-16 w-16 text-[#e8c86a]/50" />}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold uppercase tracking-widest text-[#e8c86a]">
                {isSeries ? t("paidSeries.kindSeries") : t("playlist.kindPlaylist")}
              </span>
              {!playlist.is_public && (
                <span className="text-xs text-white/40 border border-white/15 rounded-full px-2 py-0.5">{t("playlist.privateBadge")}</span>
              )}
              {isPaidSeries && seriesPrice && (
                <span className="text-xs font-bold text-black bg-[#e8c86a] rounded-full px-2 py-0.5">{t("paidSeries.priceUnlockBadge", { price: seriesPrice })}</span>
              )}
            </div>
            <h1 className="text-3xl md:text-4xl font-black leading-tight">{playlist.title}</h1>
            {playlist.description && <p className="mt-2 text-white/55 text-sm leading-relaxed">{playlist.description}</p>}
            <p className="mt-3 text-sm text-white/45">
              {t("playlist.byWord")} {owner?.slug ? (
                <Link href={`/artist/${owner.slug}`} className="text-[#e8c86a] hover:underline font-semibold">{ownerName}</Link>
              ) : (
                <span className="text-[#e8c86a] font-semibold">{ownerName}</span>
              )}
              <span className="mx-2 text-white/20">•</span>
              {t("playlist.itemsCount", { count: items.length, plural: items.length === 1 ? "" : "s" })}
              {audioItems.length > 0 && videoCount > 0 && (
                <span className="text-white/35"> {t("playlist.mixBreakdown", { audio: audioItems.length, video: videoCount })}</span>
              )}
              {totalSecs > 0 && <><span className="mx-2 text-white/20">•</span>{formatDuration(totalSecs)}</>}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => (isPlayingPlaylist && player.playing ? player.pause() : playAll())}
                disabled={audioItems.length === 0}
                className="flex items-center gap-2 rounded-full bg-[#e8c86a] text-black font-bold px-6 py-3 text-sm hover:bg-[#f5d67e] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isPlayingPlaylist && player.playing ? <Pause className="h-5 w-5 fill-black" /> : <Play className="h-5 w-5 fill-black" />}
                {isPlayingPlaylist && player.playing ? t("playlist.pause") : t("playlist.playAll")}
              </button>
              <button
                onClick={handleFollow}
                title={user ? (following ? t("playlist.unfollowTitle") : t("playlist.followTitle")) : t("playlist.signInToFollow")}
                className={`flex items-center gap-2 rounded-full border px-5 py-3 text-sm font-semibold transition-colors ${
                  following
                    ? "border-[#e8c86a] bg-[#e8c86a]/15 text-[#e8c86a]"
                    : "border-white/15 text-white/70 hover:border-[#e8c86a]/60 hover:text-[#e8c86a]"
                }`}
              >
                {following ? <UserCheck className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {following ? t("playlist.following") : t("playlist.follow")} <span className="text-white/40">({formatCount(followers)})</span>
              </button>
              <div className="relative">
                <button
                  onClick={() => setShareOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-full border border-white/15 text-white/70 hover:border-[#e8c86a]/60 hover:text-[#e8c86a] px-5 py-3 text-sm font-semibold transition-colors"
                >
                  <Share2 className="h-4 w-4" /> {t("playlist.share")}
                </button>
                {shareOpen && (
                  <PlayerShareMenu title={playlist.title} artistName={ownerName} sharePath={`/playlist/${playlist.id}`} onClose={() => setShareOpen(false)} />
                )}
              </div>
              <EmbedButton kind="playlist" id={String(playlist.id)} artistSlug={owner?.slug} title={playlist.title} className="px-5 py-3" />
            </div>

            {/* Paid Series — the unlock panel (fans) / ownership state. */}
            {isPaidSeries && seriesAccess === "locked" && (
              <div id="series-unlock" className="mt-6 rounded-2xl border border-[#e8c86a]/40 bg-gradient-to-br from-[#e8c86a]/15 via-transparent to-transparent p-5">
                <p className="flex items-center gap-2 text-sm font-bold text-[#e8c86a]">
                  <Lock className="h-4 w-4" /> {t("paidSeries.unlockTitle")}
                </p>
                <p className="mt-1.5 text-sm text-white/60 leading-relaxed">
                  {t("paidSeries.unlockBody", { price: seriesPrice, owner: ownerName })}
                </p>
                <Link
                  href={`/store/buy/series/${playlist.id}`}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#e8c86a] text-black font-bold px-6 py-3 text-sm hover:bg-[#f5d67e] transition-colors"
                >
                  <BadgeDollarSign className="h-4 w-4" /> {t("paidSeries.unlockCta", { price: seriesPrice })}
                </Link>
              </div>
            )}
            {isPaidSeries && seriesAccess === "purchased" && (
              <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#e8c86a]/50 bg-[#e8c86a]/10 px-4 py-2 text-sm font-semibold text-[#e8c86a]">
                <Crown className="h-4 w-4" /> {t("paidSeries.ownSeries")}
              </p>
            )}
            {audioItems.length === 0 && items.length > 0 && (
              <p className="mt-3 text-xs text-white/40">
                {t("playlist.allVideoNote")}
              </p>
            )}
          </div>
        </div>

        {/* Series Studio — the owner's controls (price, preview, Turbo
            Series Builder, buyer list). Renders only for the owner of a
            series; the server enforces the same boundary on every call. */}
        {isSeriesOwner && (
          <section className="mt-10 rounded-2xl border border-[#e8c86a]/30 bg-gradient-to-b from-[#171208] to-[#0d0a04] p-5 md:p-6">
            <h2 className="flex items-center gap-2 text-base font-black text-[#e8c86a]">
              <Sparkles className="h-5 w-5" /> {t("paidSeries.studioTitle")}
            </h2>
            <p className="mt-1 text-sm text-white/50">
              {t("paidSeries.studioIntro")}
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider text-white/40">{t("paidSeries.priceLabel")}</span>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-white/40">$</span>
                  <input
                    value={priceDollars}
                    onChange={(e) => setPriceDollars(e.target.value)}
                    inputMode="decimal"
                    placeholder={t("paidSeries.pricePlaceholder")}
                    className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-[#e8c86a]/60 focus:outline-none"
                  />
                </div>
                <span className="mt-1 block text-xs text-white/35">
                  {seriesPrice ? t("paidSeries.onSaleNote", { price: seriesPrice, keep: `$${(((playlist.price_cents ?? 0) * 0.95) / 100).toFixed(2)}` }) : t("paidSeries.freeNowNote")}
                </span>
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider text-white/40">{t("paidSeries.previewLabel")}</span>
                <select
                  value={previewKey}
                  onChange={(e) => setPreviewKey(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white focus:border-[#e8c86a]/60 focus:outline-none"
                >
                  <option value="">{t("paidSeries.noPreview")}</option>
                  {(playlist.items ?? []).map((ref) => (
                    <option key={`${ref.kind}:${ref.id}`} value={`${ref.kind}:${ref.id}`}>
                      {titleByKey.get(`${ref.kind}:${ref.id}`) ?? t("paidSeries.episodeFallback")}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-white/35">{t("paidSeries.previewNote")}</span>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={saveSeriesSettings}
                disabled={savingSettings}
                className="rounded-full bg-[#e8c86a] text-black font-bold px-5 py-2.5 text-sm hover:bg-[#f5d67e] transition-colors disabled:opacity-40"
              >
                {savingSettings ? t("paidSeries.saving") : t("paidSeries.saveSettings")}
              </button>
              <button
                onClick={buildWithAssist}
                disabled={assistBusy || items.length === 0}
                className="inline-flex items-center gap-2 rounded-full border border-[#e8c86a]/50 text-[#e8c86a] font-semibold px-5 py-2.5 text-sm hover:bg-[#e8c86a]/10 transition-colors disabled:opacity-40"
              >
                {assistBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {t("paidSeries.turboBuilder")}
              </button>
              {settingsMsg && <span className="text-xs text-white/55">{settingsMsg}</span>}
              {assistMsg && <span className="text-xs text-white/55">{assistMsg}</span>}
            </div>

            {assistDraft && (
              <div className="mt-5 space-y-5 rounded-xl border border-white/10 bg-black/30 p-4">
                <p className="text-xs text-white/45">{assistDraft.note}</p>
                <p className="text-xs text-white/55">
                  <span className="font-bold text-white/75">{t("paidSeries.priceReadLabel")}</span>{" "}
                  {t("paidSeries.priceReadRange", { low: `$${(assistDraft.price_advice.low_cents / 100).toFixed(2)}`, high: `$${(assistDraft.price_advice.high_cents / 100).toFixed(2)}`, smart: `$${(assistDraft.price_advice.smart_cents / 100).toFixed(2)}` })} {assistDraft.price_advice.label}
                </p>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/40">{t("paidSeries.suggestedOrder")}</p>
                  <ol className="mt-2 space-y-1 text-sm text-white/75">
                    {assistDraft.suggested_order.map((k, i) => (
                      <li key={k} className="flex gap-2">
                        <span className="text-white/30 tabular-nums">{i + 1}.</span> {titleByKey.get(k) ?? t("paidSeries.episodeFallback")}
                      </li>
                    ))}
                  </ol>
                  <button
                    onClick={applyAssistOrder}
                    disabled={assistBusy}
                    className="mt-2 rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/80 hover:border-[#e8c86a]/60 hover:text-[#e8c86a] disabled:opacity-40"
                  >
                    {t("paidSeries.applyOrder")}
                  </button>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/40">{t("paidSeries.salesCopyDraft")}</p>
                  <p className="mt-2 text-sm font-bold text-white/90">{assistDraft.sales_copy.headline}</p>
                  <p className="mt-1 text-sm text-white/60 leading-relaxed">{assistDraft.sales_copy.description}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => applyAssistCopy("title")}
                      disabled={assistBusy}
                      className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/80 hover:border-[#e8c86a]/60 hover:text-[#e8c86a] disabled:opacity-40"
                    >
                      {t("paidSeries.useAsTitle")}
                    </button>
                    <button
                      onClick={() => applyAssistCopy("description")}
                      disabled={assistBusy}
                      className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/80 hover:border-[#e8c86a]/60 hover:text-[#e8c86a] disabled:opacity-40"
                    >
                      {t("paidSeries.useAsDescription")}
                    </button>
                  </div>
                </div>
                {assistDraft.trailer_shot_list.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-white/40">{t("paidSeries.trailerShotList")}</p>
                    <ul className="mt-2 space-y-1.5 text-sm text-white/70">
                      {assistDraft.trailer_shot_list.map((s, i) => (
                        <li key={i} className="flex gap-2">
                          <Clapperboard className="mt-0.5 h-4 w-4 shrink-0 text-[#e8c86a]/60" />
                          <span>
                            <span className="font-semibold text-white/85">{titleByKey.get(s.item) ?? t("paidSeries.episodeFallback")}:</span>{" "}
                            {s.moment}{s.caption ? <> — <span className="text-white/50">“{s.caption}”</span></> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 border-t border-white/10 pt-5">
              <h3 className="text-sm font-bold text-white/85">
                {t("paidSeries.buyerListTitle")}
                {buyerTotals && <span className="ml-2 text-white/40 font-normal">{t("paidSeries.buyerTotals", { buyers: buyerTotals.buyers, gross: buyerTotals.gross })}</span>}
              </h3>
              {buyers.length === 0 ? (
                <p className="mt-2 text-sm text-white/45">
                  {t("paidSeries.noSalesYet")}
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {buyers.map((b) => (
                    <li key={`${b.buyer_user_id}-${b.purchased_at}`} className="flex items-center gap-3 text-sm">
                      {b.avatar_url ? (
                        <img src={b.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8c86a]/15 text-xs font-bold text-[#e8c86a]">
                          {(b.display_name ?? t("paidSeries.buyerInitial")).slice(0, 1)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-white/85">
                        {b.slug ? (
                          <Link href={`/artist/${b.slug}`} className="hover:text-[#e8c86a] hover:underline">{b.display_name}</Link>
                        ) : b.display_name}
                      </span>
                      {b.status !== "completed" && (
                        <span className="rounded-full border border-red-400/40 px-2 py-0.5 text-[11px] font-semibold text-red-300">{b.status}</span>
                      )}
                      <span className="text-white/50 tabular-nums">${(b.amount_cents / 100).toFixed(2)}</span>
                      <span className="text-xs text-white/30">{new Date(b.purchased_at).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* Items */}
        <section className="mt-10">
          {items.length === 0 ? (
            <div className={`rounded-2xl border border-dashed px-6 py-12 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]/60" : "border-white/15 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
              <ListMusic className="h-10 w-10 text-[#e8c86a]/40 mx-auto mb-3" />
              <p className="text-white/70 font-semibold">{t("playlist.emptyTitle")}</p>
              <p className="text-sm text-white/40 mt-1">{t("playlist.emptyBody")}</p>
              <p className="text-xs text-white/35 mt-3">{t("playlist.emptyYours")} <Link href="/publish"><span className="text-[#e8c86a] hover:underline">{t("playlist.uploadFirstDrop")}</span></Link></p>
            </div>
          ) : seasons ? (
            seasons.map(([season, group]) => (
              <div key={String(season)} className="mb-8">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#e8c86a] mb-3">
                  <Layers className="h-4 w-4" />
                  {season === "other" ? t("paidSeries.moreEpisodes") : t("paidSeries.seasonHeading", { season })}
                  <span className="text-white/30 font-normal">({group.length})</span>
                </h2>
                <div className="space-y-1">
                  {group.map((item, i) => <ItemRow key={`${item.kind}:${item.id}`} item={item} position={i} />)}
                </div>
              </div>
            ))
          ) : (
            <div className="space-y-1">
              {items.map((item, i) => <ItemRow key={`${item.kind}:${item.id}`} item={item} position={i} />)}
            </div>
          )}
        </section>

        {firstVideo && (
          <p className="mt-6 text-xs text-white/35 text-center">
            {t("playlist.footerNote")}
          </p>
        )}
      </div>
    </div>
  );
}
