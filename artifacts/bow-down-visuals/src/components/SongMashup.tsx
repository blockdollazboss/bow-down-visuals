import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2, Upload, Music2, Sparkles, Mic2, Palette, Disc3, Share2,
  Check, AlertCircle, Blend, AudioWaveform, Repeat,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { useToast } from "@/hooks/use-toast";

/* ─── Song Mashup (Suno parity) ──────────────────────────────────────────────
   Docked inside Song Maker (/make-song, "Mashup" tab). Pick two songs from
   the library or upload audio, choose a blend style, and POST /api/mashup
   renders a tempo/key-aligned blend server-side with ffmpeg.
   Result chains into: lyric video, cover art, album, one-click share. */

interface LibSong {
  id: string;
  title: string;
  audio_url: string;
  source: string;
  duration_sec?: string | null;
}

interface MashupResult {
  id: string;
  title: string;
  audio_url: string;
  duration_sec?: string | null;
}

interface MashupAnalysis {
  bpmA: number | null;
  bpmB: number | null;
  tempoRatio: number;
  style: string;
  blendPointSec: number;
  beatLockSec: number | null;
  durationSec: number;
}

type BlendStyle = "crossfade" | "beat-match" | "interleave";

const STYLES: Array<{ key: BlendStyle; icon: typeof Blend }> = [
  { key: "crossfade", icon: Blend },
  { key: "beat-match", icon: AudioWaveform },
  { key: "interleave", icon: Repeat },
];

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtLrcTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}]`;
}

/** Build a title-card LRC so a lyric-less mashup still gets a real karaoke video. */
function buildMashupLrc(title: string, a: string, b: string, styleLabel: string, dur: number): string {
  const d = Math.max(dur, 12);
  const lines: Array<[number, string]> = [
    [0, title],
    [Math.min(8, d * 0.08), `${a} × ${b}`],
    [d * 0.25, styleLabel],
    [d * 0.5, "M A S H U P"],
    [d * 0.72, `${a} × ${b}`],
    [Math.max(0, d - 6), title],
  ];
  return lines.map(([t, text]) => `${fmtLrcTime(t)}${text}`).join("\n");
}

export interface SongMashupProps {
  preselectA?: string | null;
  preselectB?: string | null;
}

export default function SongMashup({ preselectA, preselectB }: SongMashupProps) {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset, referralCode } = useHubProject();
  const { toast } = useToast();

  const [songs, setSongs] = useState<LibSong[]>([]);
  const [loadingSongs, setLoadingSongs] = useState(true);
  const [songAId, setSongAId] = useState<string>("");
  const [songBId, setSongBId] = useState<string>("");
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<"simple" | "custom">("simple");
  const [style, setStyle] = useState<BlendStyle>("beat-match");
  const [blendPct, setBlendPct] = useState(50);
  const [balance, setBalance] = useState(50);
  const [crossfadeSec, setCrossfadeSec] = useState(6);
  const [mashupTitle, setMashupTitle] = useState("");
  const [uploading, setUploading] = useState<"A" | "B" | null>(null);
  const [working, setWorking] = useState(false);
  const [workPhase, setWorkPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MashupResult | null>(null);
  const [analysis, setAnalysis] = useState<MashupAnalysis | null>(null);

  // Handoff state
  const [handoffRunning, setHandoffRunning] = useState<string | null>(null);
  const [lyricVideoUrl, setLyricVideoUrl] = useState<string | null>(null);
  const [coverArtUrl, setCoverArtUrl] = useState<string | null>(null);
  const [albums, setAlbums] = useState<Array<{ id: string; title: string }>>([]);
  const [albumsLoaded, setAlbumsLoaded] = useState(false);
  const [albumPick, setAlbumPick] = useState("");
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const [albumAdded, setAlbumAdded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fileInputA = useRef<HTMLInputElement>(null);
  const fileInputB = useRef<HTMLInputElement>(null);

  const songA = songs.find((s) => s.id === songAId) ?? null;
  const songB = songs.find((s) => s.id === songBId) ?? null;

  const loadSongs = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/songs", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await res.json()) as { songs?: LibSong[] };
      if (res.ok) setSongs(data.songs ?? []);
    } catch {
      /* library is optional — uploads still work */
    } finally {
      setLoadingSongs(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadSongs();
  }, [loadSongs]);

  useEffect(() => {
    if (preselectA) setSongAId(preselectA);
    if (preselectB) setSongBId(preselectB);
  }, [preselectA, preselectB]);

  // Phased progress copy while the server renders.
  useEffect(() => {
    if (!working) return;
    const phases = [0, 1, 2, 3];
    let i = 0;
    const timer = setInterval(() => {
      i = (i + 1) % phases.length;
      setWorkPhase(i);
    }, 9000);
    return () => clearInterval(timer);
  }, [working]);

  const phaseCopy = [
    t("mashup.analyzing"),
    t("mashup.tempoMatching"),
    t("mashup.blending"),
    t("mashup.saving"),
  ][workPhase];

  function captureDuration(id: string, el: HTMLAudioElement | null) {
    if (!el) return;
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) {
      setDurations((prev) => (prev[id] ? prev : { ...prev, [id]: d }));
    }
  }

  async function handleUpload(side: "A" | "B", file: File) {
    setUploading(side);
    setError(null);
    try {
      const token = await getAccessToken();
      const form = new FormData();
      form.append("song", file);
      form.append("title", file.name.replace(/\.[a-z0-9]+$/i, ""));
      const res = await fetch("/api/songs/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = (await res.json()) as { song?: LibSong; error?: string };
      if (!res.ok || !data.song) throw new Error(data.error || "Upload failed.");
      setSongs((prev) => [data.song!, ...prev]);
      if (side === "A") setSongAId(data.song.id);
      else setSongBId(data.song.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  const canSubmit = !!songA && !!songB && songA.id !== songB.id && !working;

  async function handleMashup() {
    if (!canSubmit || !songA || !songB) {
      setError(t("mashup.needsTwoSongs"));
      return;
    }
    setWorking(true);
    setError(null);
    setResult(null);
    setAnalysis(null);
    setLyricVideoUrl(null);
    setCoverArtUrl(null);
    setAlbumAdded(null);
    try {
      const durA = durations[songA.id] ?? 0;
      const body = {
        songA: { songId: songA.id },
        songB: { songId: songB.id },
        style,
        balance,
        crossfadeSec,
        ...(mode === "custom" && durA > 0
          ? { blendPointSec: Math.round(((blendPct / 100) * durA) * 10) / 10 }
          : {}),
        ...(mashupTitle.trim() ? { title: mashupTitle.trim() } : {}),
      };
      const res = await confirmedFetch("/api/mashup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res) {
        setWorking(false); // user cancelled the credit confirmation
        return;
      }
      const data = (await res.json()) as {
        song?: MashupResult;
        analysis?: MashupAnalysis;
        error?: string;
      };
      if (!res.ok || !data.song) {
        throw new Error(data.error || t("mashup.failed"));
      }
      setResult(data.song);
      setAnalysis(data.analysis ?? null);
      addAsset({
        kind: "song",
        url: data.song.audio_url,
        label: data.song.title,
        detail: "Song Mashup",
        meta: { sourceA: songA.title, sourceB: songB.title, style },
      });
      setSongs((prev) => [data.song as LibSong, ...prev]);
      await refreshProfile().catch(() => {});
      toast({ title: t("mashup.resultTitle"), description: data.song.title });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("mashup.failed"));
    } finally {
      setWorking(false);
    }
  }

  /* ── Handoffs ── */

  async function handleLyricVideo() {
    if (!result || handoffRunning) return;
    setHandoffRunning("lyric");
    try {
      const dur = Number(result.duration_sec) || analysis?.durationSec || 60;
      const styleLabel =
        style === "crossfade" ? t("mashup.styleCrossfade")
        : style === "beat-match" ? t("mashup.styleBeatMatch")
        : t("mashup.styleInterleave");
      const lrc = buildMashupLrc(result.title, songA?.title ?? "A", songB?.title ?? "B", styleLabel, dur);
      const res = await confirmedFetch("/api/karaoke-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioUrl: result.audio_url,
          lrc,
          title: result.title,
          artist: t("mashup.coverArtist"),
        }),
      });
      if (!res) return;
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Lyric video failed.");
      setLyricVideoUrl(data.url);
      addAsset({ kind: "video", url: data.url, label: `${result.title} — lyric video`, detail: "Lyric Video", meta: { sourceAsset: result.id } });
      toast({ title: t("mashup.lyricVideoDone") });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Lyric video failed.", variant: "destructive" });
    } finally {
      setHandoffRunning(null);
    }
  }

  async function handleCoverArt() {
    if (!result || handoffRunning) return;
    setHandoffRunning("cover");
    try {
      const res = await confirmedFetch("/api/cover-art", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songTitle: result.title,
          artistName: t("mashup.coverArtist"),
          style: "luxury-gold",
          aspectRatio: "1:1",
          tier: "standard",
        }),
      });
      if (!res) return;
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Cover art failed.");
      setCoverArtUrl(data.url);
      addAsset({ kind: "image", url: data.url, label: `${result.title} — cover art`, detail: "Cover Art", meta: { sourceAsset: result.id } });
      toast({ title: t("mashup.coverArtDone") });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Cover art failed.", variant: "destructive" });
    } finally {
      setHandoffRunning(null);
    }
  }

  async function loadAlbums() {
    if (albumsLoaded) return;
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/albums", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await res.json()) as { albums?: Array<{ id: string; title: string }> };
      if (res.ok) setAlbums(data.albums ?? []);
    } catch {
      toast({ title: t("mashup.albumLoadFailed"), variant: "destructive" });
    } finally {
      setAlbumsLoaded(true);
    }
  }

  async function handleAddToAlbum() {
    if (!result || handoffRunning) return;
    setHandoffRunning("album");
    try {
      const token = await getAccessToken();
      const headers: HeadersInit = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      let albumId = albumPick;
      let albumTitle = albums.find((a) => a.id === albumPick)?.title ?? "";
      if (!albumId) {
        const title = newAlbumTitle.trim();
        if (!title) {
          toast({ title: t("mashup.albumNew"), variant: "destructive" });
          return;
        }
        const res = await fetch("/api/albums", {
          method: "POST",
          headers,
          body: JSON.stringify({ title, song_ids: [result.id] }),
        });
        const data = (await res.json()) as { album?: { id: string; title: string }; error?: string };
        if (!res.ok || !data.album) throw new Error(data.error || "Could not create album.");
        albumId = data.album.id;
        albumTitle = data.album.title;
        setAlbums((prev) => [{ id: albumId, title: albumTitle }, ...prev]);
        setAlbumPick(albumId);
        setNewAlbumTitle("");
      } else {
        const detail = await (await fetch(`/api/albums/${albumId}`, { headers })).json() as {
          tracks?: Array<{ song_id: string }>;
          error?: string;
        };
        const existing = (detail.tracks ?? []).map((tr) => tr.song_id);
        if (!existing.includes(result.id)) {
          const res = await fetch(`/api/albums/${albumId}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ song_ids: [...existing, result.id] }),
          });
          const data = (await res.json()) as { error?: string };
          if (!res.ok) throw new Error(data.error || "Could not add to album.");
        }
      }
      setAlbumAdded(albumTitle);
      toast({ title: `${t("mashup.albumAdded")}: ${albumTitle}` });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Could not add to album.", variant: "destructive" });
    } finally {
      setHandoffRunning(null);
    }
  }

  function shareUrl(): string {
    if (!result) return "";
    const base = result.audio_url;
    const sep = base.includes("?") ? "&" : "?";
    return referralCode ? `${base}${sep}ref=${encodeURIComponent(referralCode)}` : base;
  }

  async function handleShare() {
    if (!result) return;
    const url = shareUrl();
    const shareData = { title: result.title, text: `${t("mashup.shareText")}: ${result.title}`, url };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      throw new Error("no-share");
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast({ title: "Copy this link:", description: url });
      }
    }
  }

  /* ── Render helpers ── */

  function SongPicker({ side }: { side: "A" | "B" }) {
    const selected = side === "A" ? songA : songB;
    const setId = side === "A" ? setSongAId : setSongBId;
    const inputRef = side === "A" ? fileInputA : fileInputB;
    const isUploading = uploading === side;
    const others = songs.filter((s) => (side === "A" ? s.id !== songBId : s.id !== songAId));
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            {side === "A" ? t("mashup.songA") : t("mashup.songB")}
          </p>
          <Music2 className="h-4 w-4 text-white/30" />
        </div>
        <select
          value={selected?.id ?? ""}
          onChange={(e) => setId(e.target.value)}
          disabled={loadingSongs || isUploading}
          className="h-11 w-full rounded-xl bg-white/[0.04] border border-white/10 text-white px-3 text-sm focus:outline-none focus:border-primary/60 cursor-pointer"
          style={{ colorScheme: "dark" }}
        >
          <option value="" style={{ background: "#111" }}>
            {loadingSongs ? "…" : t("mashup.pickFromLibrary")}
          </option>
          {others.map((s) => (
            <option key={s.id} value={s.id} style={{ background: "#111" }}>
              {s.title}
            </option>
          ))}
        </select>
        {selected && (
          <div className="space-y-1.5">
            <audio
              controls
              src={selected.audio_url}
              className="w-full h-8"
              onLoadedMetadata={(e) => captureDuration(selected.id, e.currentTarget)}
            />
            <p className="text-[11px] text-white/40">
              {selected.title}
              {durations[selected.id] ? ` · ${fmtTime(durations[selected.id]!)}` : ""}
            </p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUpload(side, f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-3 py-2.5 text-xs font-semibold text-white/60 hover:text-white hover:border-primary/40 transition-all disabled:opacity-50"
        >
          {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {isUploading ? t("mashup.uploading") : t("mashup.uploadInstead")}
        </button>
      </div>
    );
  }

  const blendPointSec = songA && durations[songA.id] ? Math.round(((blendPct / 100) * durations[songA.id]!) * 10) / 10 : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5 mb-2">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center">
            <Blend className="h-4 w-4 text-primary" />
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">{t("mashup.title")}</h2>
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary border border-primary/30 bg-primary/10 rounded-full px-2.5 py-1">
            {t("mashup.priceBadge")}
          </span>
        </div>
        <p className="text-sm text-white/50 leading-relaxed">{t("mashup.subtitle")}</p>
      </div>

      {/* Simple / Custom toggle */}
      <div className="flex gap-2">
        {(["simple", "custom"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-5 py-2.5 rounded-xl font-medium transition-all ${
              mode === m
                ? "bg-primary text-black font-bold"
                : "bg-white/5 text-white/60 hover:bg-white/10 border border-white/10"
            }`}
          >
            {m === "simple" ? t("mashup.modeSimple") : t("mashup.modeCustom")}
          </button>
        ))}
      </div>

      {/* Song pickers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SongPicker side="A" />
        <SongPicker side="B" />
      </div>

      {/* Blend style */}
      <div>
        <p className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-2.5">
          {t("mashup.styleLabel")}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {STYLES.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setStyle(key)}
              className={`flex flex-col items-start gap-1.5 p-4 rounded-2xl border text-left transition-all ${
                style === key
                  ? "border-primary/60 bg-primary/[0.08] shadow-[0_0_24px_-6px_hsl(45_95%_50%/0.4)]"
                  : "border-white/10 bg-black/40 hover:border-white/25"
              }`}
            >
              <Icon className={`h-5 w-5 ${style === key ? "text-primary" : "text-white/40"}`} />
              <span className="text-sm font-bold text-white">
                {key === "crossfade" ? t("mashup.styleCrossfade")
                  : key === "beat-match" ? t("mashup.styleBeatMatch")
                  : t("mashup.styleInterleave")}
              </span>
              <span className="text-[11px] text-white/40 leading-snug">
                {key === "crossfade" ? t("mashup.styleCrossfadeBlurb")
                  : key === "beat-match" ? t("mashup.styleBeatMatchBlurb")
                  : t("mashup.styleInterleaveBlurb")}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Custom controls */}
      {mode === "custom" && (
        <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-semibold text-white/70">{t("mashup.blendPointLabel")}</label>
              <span className="text-xs text-primary font-bold">
                {blendPointSec !== null ? fmtTime(blendPointSec) : "—"}
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={90}
              value={blendPct}
              onChange={(e) => setBlendPct(Number(e.target.value))}
              className="w-full accent-yellow-500"
            />
            <p className="text-[11px] text-white/35 mt-1">{t("mashup.blendPointHint")}</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-semibold text-white/70">{t("mashup.balanceLabel")}</label>
              <span className="text-xs text-primary font-bold">
                {balance === 50 ? "50 / 50" : balance > 50 ? `A ${balance}%` : `B ${100 - balance}%`}
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={90}
              value={balance}
              onChange={(e) => setBalance(Number(e.target.value))}
              className="w-full accent-yellow-500"
            />
            <p className="text-[11px] text-white/35 mt-1">{t("mashup.balanceHint")}</p>
          </div>
          {style === "crossfade" && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-semibold text-white/70">{t("mashup.crossfadeLabel")}</label>
                <span className="text-xs text-primary font-bold">{crossfadeSec}s</span>
              </div>
              <input
                type="range"
                min={2}
                max={15}
                value={crossfadeSec}
                onChange={(e) => setCrossfadeSec(Number(e.target.value))}
                className="w-full accent-yellow-500"
              />
            </div>
          )}
          <div>
            <label className="text-sm font-semibold text-white/70 block mb-1.5">{t("mashup.titleLabel")}</label>
            <input
              type="text"
              value={mashupTitle}
              onChange={(e) => setMashupTitle(e.target.value)}
              placeholder={t("mashup.titlePlaceholder")}
              maxLength={200}
              className="h-11 w-full rounded-xl bg-white/[0.04] border border-white/10 text-white px-3.5 text-sm placeholder:text-white/25 focus:outline-none focus:border-primary/60"
            />
          </div>
        </div>
      )}

      {/* Submit */}
      <Button
        type="button"
        onClick={() => void handleMashup()}
        disabled={!canSubmit}
        className="w-full gold-glow font-bold text-base rounded-xl gap-2.5"
        style={{ height: "54px" }}
      >
        {working ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            {phaseCopy}
          </>
        ) : (
          <>
            <Sparkles className="h-5 w-5" />
            {mode === "simple" ? t("mashup.submitSimple") : t("mashup.submitCustom")} · {t("mashup.priceBadge")}
          </>
        )}
      </Button>
      {songA && songB && songA.id === songB.id && (
        <p className="text-xs text-amber-300/80 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" /> Pick two different songs.
        </p>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5">
          <p className="text-red-400 text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="rounded-2xl border border-primary/30 bg-gradient-to-b from-primary/[0.08] to-transparent p-5 md:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-emerald-400" />
            <p className="text-sm font-bold text-white">{t("mashup.resultTitle")}</p>
          </div>
          <p className="text-lg font-bold text-primary">{result.title}</p>
          <audio controls src={result.audio_url} className="w-full h-10" />
          {analysis && (
            <div className="flex flex-wrap gap-2">
              <span className="text-[11px] font-semibold text-white/60 border border-white/10 rounded-full px-2.5 py-1">
                {analysis.bpmA ?? t("mashup.bpmUnknown")} → {analysis.bpmB ?? t("mashup.bpmUnknown")} BPM
              </span>
              <span className="text-[11px] font-semibold text-white/60 border border-white/10 rounded-full px-2.5 py-1">
                Tempo ×{analysis.tempoRatio}
              </span>
              <span className="text-[11px] font-semibold text-white/60 border border-white/10 rounded-full px-2.5 py-1">
                {fmtTime(analysis.durationSec)}
              </span>
              {analysis.beatLockSec !== null && (
                <span className="text-[11px] font-semibold text-white/60 border border-white/10 rounded-full px-2.5 py-1">
                  Beat lock @{fmtTime(analysis.beatLockSec)}
                </span>
              )}
            </div>
          )}

          {/* Handoff chain */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => void handleLyricVideo()}
              disabled={handoffRunning !== null}
              className="flex flex-col items-start gap-1.5 p-3 rounded-xl border border-white/10 bg-black/40 hover:border-primary/50 hover:bg-primary/[0.06] transition-all text-left disabled:opacity-50"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 border border-primary/25">
                {handoffRunning === "lyric" ? <Loader2 className="h-4 w-4 text-primary animate-spin" /> : <Mic2 className="h-4 w-4 text-primary" />}
              </span>
              <span className="text-xs font-bold text-white leading-tight">{t("mashup.handoffLyricVideo")}</span>
              <span className="text-[10px] text-white/40 leading-snug">{t("mashup.handoffLyricVideoBlurb")}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleCoverArt()}
              disabled={handoffRunning !== null}
              className="flex flex-col items-start gap-1.5 p-3 rounded-xl border border-white/10 bg-black/40 hover:border-primary/50 hover:bg-primary/[0.06] transition-all text-left disabled:opacity-50"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 border border-primary/25">
                {handoffRunning === "cover" ? <Loader2 className="h-4 w-4 text-primary animate-spin" /> : <Palette className="h-4 w-4 text-primary" />}
              </span>
              <span className="text-xs font-bold text-white leading-tight">{t("mashup.handoffCoverArt")}</span>
              <span className="text-[10px] text-white/40 leading-snug">{t("mashup.handoffCoverArtBlurb")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (albumsLoaded) setAlbumsLoaded(false);
                else void loadAlbums();
              }}
              disabled={handoffRunning !== null}
              className="flex flex-col items-start gap-1.5 p-3 rounded-xl border border-white/10 bg-black/40 hover:border-primary/50 hover:bg-primary/[0.06] transition-all text-left disabled:opacity-50"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 border border-primary/25">
                {handoffRunning === "album" ? <Loader2 className="h-4 w-4 text-primary animate-spin" /> : <Disc3 className="h-4 w-4 text-primary" />}
              </span>
              <span className="text-xs font-bold text-white leading-tight">{t("mashup.handoffAlbum")}</span>
              <span className="text-[10px] text-white/40 leading-snug">{t("mashup.handoffAlbumBlurb")}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleShare()}
              disabled={handoffRunning !== null}
              className="flex flex-col items-start gap-1.5 p-3 rounded-xl border border-white/10 bg-black/40 hover:border-primary/50 hover:bg-primary/[0.06] transition-all text-left disabled:opacity-50"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 border border-primary/25">
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Share2 className="h-4 w-4 text-primary" />}
              </span>
              <span className="text-xs font-bold text-white leading-tight">
                {copied ? t("mashup.copied") : t("mashup.handoffShare")}
              </span>
              <span className="text-[10px] text-white/40 leading-snug">{t("mashup.handoffShareBlurb")}</span>
            </button>
          </div>

          {/* Album picker (expands from the Add to album button) */}
          {albumsLoaded && !albumAdded && (
            <div className="rounded-xl border border-white/10 bg-black/50 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={albumPick}
                  onChange={(e) => setAlbumPick(e.target.value)}
                  className="h-10 flex-1 rounded-xl bg-white/[0.04] border border-white/10 text-white px-3 text-sm focus:outline-none focus:border-primary/60 cursor-pointer"
                  style={{ colorScheme: "dark" }}
                >
                  <option value="" style={{ background: "#111" }}>{t("mashup.albumPick")}</option>
                  {albums.map((a) => (
                    <option key={a.id} value={a.id} style={{ background: "#111" }}>{a.title}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newAlbumTitle}
                  onChange={(e) => setNewAlbumTitle(e.target.value)}
                  placeholder={t("mashup.albumNew")}
                  maxLength={120}
                  className="h-10 flex-1 rounded-xl bg-white/[0.04] border border-white/10 text-white px-3 text-sm placeholder:text-white/25 focus:outline-none focus:border-primary/60"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleAddToAlbum()}
                  disabled={handoffRunning !== null || (!albumPick && !newAlbumTitle.trim())}
                  className="rounded-xl h-10"
                >
                  {handoffRunning === "album" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {albumPick ? t("mashup.albumAdd") : t("mashup.albumCreateAdd")}
                </Button>
              </div>
            </div>
          )}
          {albumAdded && (
            <p className="text-xs text-emerald-300 flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" /> {t("mashup.albumAdded")}: <span className="font-bold">{albumAdded}</span>
            </p>
          )}

          {lyricVideoUrl && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3">
              <p className="text-xs font-bold text-emerald-300 mb-2 flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" /> {t("mashup.lyricVideoDone")}
              </p>
              <video src={lyricVideoUrl} controls className="w-full max-h-56 rounded-lg bg-black" />
            </div>
          )}
          {coverArtUrl && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3">
              <p className="text-xs font-bold text-emerald-300 mb-2 flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" /> {t("mashup.coverArtDone")}
              </p>
              <img src={coverArtUrl} alt={result.title} className="max-h-56 rounded-lg border border-white/10" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
