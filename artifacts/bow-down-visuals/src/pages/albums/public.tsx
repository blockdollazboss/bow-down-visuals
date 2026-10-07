import { useEffect, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  ArrowLeft, ArrowRight, Check, Disc3, Eye, Loader2, Pause, Play, Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Public album page (/albums/:slug) ──────────────────────────────────
   The viral surface for the Album/EP Builder: indexable per-album page with
   MusicAlbum JSON-LD, gold-black styling, playable tracklist, per-track and
   whole-album share buttons, referral ?ref=CODE on share links, and the
   "Made with Bow Down Visuals" badge. */

interface AlbumTrack {
  id: string;
  position: number;
  song_id: string;
  title: string;
  audio_url: string;
  source: string;
}

interface PublicAlbum {
  id: string;
  title: string;
  slug: string | null;
  album_type: string;
  release_notes: string;
  cover_art_url: string | null;
  views: number;
  created_at: string;
  tracks: AlbumTrack[];
}

export default function PublicAlbumPage() {
  const [, params] = useRoute("/albums/:slug");
  const slug = params?.slug ?? "";
  const [album, setAlbum] = useState<PublicAlbum | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/albums/public/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((d) => {
        if (d?.album) {
          setAlbum(d.album);
          setReferralCode(d.referralCode ?? null);
        } else if (!notFound) setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const typeLabel = album?.album_type === "ep" ? "EP" : "Album";
  usePageTitle(
    album ? `${album.title} — ${typeLabel} | Bow Down Visuals` : "Album | Bow Down Visuals",
    album
      ? `${album.title} — a ${typeLabel.toLowerCase()} with ${album.tracks.length} track${album.tracks.length === 1 ? "" : "s"}. Made with Bow Down Visuals.`
      : "Listen to albums and EPs made with Bow Down Visuals.",
  );

  function shareUrl(trackSongId?: string): string {
    const base = `https://bowdownvisuals.com/albums/${slug}`;
    const frag = trackSongId ? `#track-${trackSongId}` : "";
    return referralCode ? `${base}?ref=${referralCode}${frag}` : `${base}${frag}`;
  }

  async function copyShare(key: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  function togglePlay(track: AlbumTrack) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === track.song_id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    audio.src = track.audio_url;
    audio.play().catch(() => setPlayingId(null));
    setPlayingId(track.song_id);
  }

  useEffect(() => {
    // Deep-link support: /albums/:slug#track-<songId>
    if (!album || !window.location.hash.startsWith("#track-")) return;
    const songId = window.location.hash.replace("#track-", "");
    const track = album.tracks.find((t) => t.song_id === songId);
    if (track) {
      const el = document.getElementById(`track-${songId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      togglePlay(track);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-white/40" />
      </div>
    );
  }

  if (notFound || !album) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="text-center">
          <Disc3 className="h-12 w-12 text-white/20 mx-auto mb-4" />
          <p className="text-xl font-bold mb-2">Album not found</p>
          <p className="text-white/40 text-sm mb-6">It may have been removed or unpublished.</p>
          <Link href="/songs">
            <Button variant="outline" className="border-white/15 text-white/70">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to music
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const pageUrl = `https://bowdownvisuals.com/albums/${album.slug}`;
  const musicAlbumJsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicAlbum",
    name: album.title,
    description: album.release_notes || album.title,
    url: pageUrl,
    image: album.cover_art_url || undefined,
    datePublished: album.created_at,
    numTracks: album.tracks.length,
    track: album.tracks.map((t) => ({
      "@type": "MusicRecording",
      name: t.title,
      url: `${pageUrl}#track-${t.song_id}`,
      audio: t.audio_url,
    })),
    publisher: { "@type": "Organization", name: "Bow Down Visuals", url: "https://bowdownvisuals.com" },
  };

  const trackCount = album.tracks.length;

  return (
    <div className="min-h-screen bg-black text-white">
      <JsonLd data={musicAlbumJsonLd} />
      <audio
        ref={audioRef}
        onEnded={() => setPlayingId(null)}
        onPause={() => setPlayingId(null)}
        className="hidden"
      />
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-12">
        <LuxReveal>
          {/* Header */}
          <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 mb-10">
            <div className="shrink-0 mx-auto sm:mx-0">
              {album.cover_art_url ? (
                <img
                  src={album.cover_art_url}
                  alt={`${album.title} cover art`}
                  className="w-48 h-48 sm:w-56 sm:h-56 rounded-2xl object-cover border border-[#c9a84c]/30 shadow-[0_0_60px_rgba(201,168,76,0.15)]"
                />
              ) : (
                <div className="w-48 h-48 sm:w-56 sm:h-56 rounded-2xl border border-[#c9a84c]/30 bg-gradient-to-br from-[#c9a84c]/20 to-transparent flex items-center justify-center">
                  <Disc3 className="h-20 w-20 text-[#c9a84c]/40" />
                </div>
              )}
            </div>
            <div className="flex-1 text-center sm:text-left">
              <span className="inline-block text-[11px] uppercase tracking-[0.2em] text-[#e8c86a] border border-[#c9a84c]/40 rounded-full px-3 py-1 mb-4">
                {typeLabel}
              </span>
              <h1 className="text-3xl sm:text-4xl font-bold mb-3 bg-gradient-to-b from-white to-white/70 bg-clip-text text-transparent">
                {album.title}
              </h1>
              {album.release_notes && (
                <p className="text-sm text-white/55 leading-relaxed mb-5 max-w-xl">{album.release_notes}</p>
              )}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                <button
                  onClick={() => copyShare("album", shareUrl())}
                  className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 transition"
                >
                  {copied === "album" ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                  {copied === "album" ? "Link copied!" : "Share album"}
                </button>
                <span className="flex items-center gap-1.5 text-xs text-white/35">
                  <Eye className="h-3.5 w-3.5" /> {album.views} plays page views
                </span>
              </div>
            </div>
          </div>

          {/* Tracklist */}
          <h2 className="text-sm uppercase tracking-[0.2em] text-white/40 font-semibold mb-4">
            Tracklist · {trackCount} track{trackCount === 1 ? "" : "s"}
          </h2>
          <div className="space-y-2 mb-12">
            {album.tracks.map((track, i) => {
              const isPlaying = playingId === track.song_id;
              return (
                <div
                  key={track.id}
                  id={`track-${track.song_id}`}
                  className={`flex items-center gap-3 sm:gap-4 rounded-xl border p-3 transition ${
                    isPlaying
                      ? "border-[#c9a84c]/50 bg-[#c9a84c]/[0.07]"
                      : "border-white/[0.06] bg-white/[0.02] hover:border-white/15"
                  }`}
                >
                  <span className="text-xs text-white/30 font-mono w-6 text-center shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <button
                    onClick={() => togglePlay(track)}
                    aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                    className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition ${
                      isPlaying
                        ? "bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black"
                        : "border border-white/15 text-white/70 hover:border-[#c9a84c]/50 hover:text-white"
                    }`}
                  >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                  </button>
                  <p className="flex-1 min-w-0 text-sm font-semibold truncate">{track.title}</p>
                  <button
                    onClick={() => copyShare(`track-${track.song_id}`, shareUrl(track.song_id))}
                    aria-label={`Share ${track.title}`}
                    className="shrink-0 flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/50 hover:text-white hover:border-[#c9a84c]/40 transition"
                  >
                    {copied === `track-${track.song_id}` ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Share2 className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">{copied === `track-${track.song_id}` ? "Copied" : "Share"}</span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Badge + CTA */}
          <div className="text-center rounded-2xl border border-[#c9a84c]/25 bg-gradient-to-b from-[#c9a84c]/[0.07] to-transparent p-8 sm:p-10">
            <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#e8c86a] border border-[#c9a84c]/40 rounded-full px-4 py-1.5 mb-5">
              <Disc3 className="h-3.5 w-3.5" /> Made with Bow Down Visuals
            </p>
            <h2 className="text-2xl font-bold mb-3">Build your own album</h2>
            <p className="text-white/50 mb-6 max-w-xl mx-auto text-sm">
              Group your AI songs into albums and EPs, publish a shareable page,
              and pitch it to playlists — all inside Bow Down Visuals.
            </p>
            <Link href="/signup">
              <Button className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110">
                Start creating <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </LuxReveal>
      </div>
    </div>
  );
}
