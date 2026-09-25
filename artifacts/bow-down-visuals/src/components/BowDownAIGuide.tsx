import { useState, useEffect, useCallback, useRef } from "react";
import {
<<<<<<< HEAD
  ListMusic, Play, Pause, Volume2, VolumeX,
=======
  Bot, ChevronRight, Zap,
>>>>>>> feature/homepage-playlist
  Minimize2, ChevronUp, GripHorizontal,
  Upload, Trash2, Loader2,
} from "lucide-react";
import { useThemePlayer } from "@/contexts/ThemePlayerContext";
import { useAuth } from "@/contexts/AuthContext";

/* ─── Snap geometry ─────────────────────────────────────────── */

const SNAP_M    = 20;   // px margin from screen edge
const HIDE_MS   = 3500; // ms idle before auto-hide
const PEEK_PX   = 6;    // px left visible as hover target

type SnapPt = "TL" | "TC" | "TR" | "RC" | "BR" | "BC" | "BL" | "LC";
const ALL_SNAPS: SnapPt[] = ["TL", "TC", "TR", "RC", "BR", "BC", "BL", "LC"];

function snapPos(pt: SnapPt, w: number, h: number) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const m = SNAP_M;
  const cx = Math.round((vw - w) / 2), cy = Math.round((vh - h) / 2);
  const map: Record<SnapPt, { x: number; y: number }> = {
    TL: { x: m,          y: m          },
    TC: { x: cx,         y: m          },
    TR: { x: vw - w - m, y: m          },
    RC: { x: vw - w - m, y: cy         },
    BR: { x: vw - w - m, y: vh - h - m },
    BC: { x: cx,         y: vh - h - m },
    BL: { x: m,          y: vh - h - m },
    LC: { x: m,          y: cy         },
  };
  return map[pt];
}

function nearestSnap(x: number, y: number, w: number, h: number): SnapPt {
  const cx = x + w / 2, cy = y + h / 2;
  let best: SnapPt = "TL", bestD = Infinity;
  for (const pt of ALL_SNAPS) {
    const a = snapPos(pt, w, h);
    const d = (cx - a.x - w / 2) ** 2 + (cy - a.y - h / 2) ** 2;
    if (d < bestD) { bestD = d; best = pt; }
  }
  return best;
}

/** CSS transform that slides the widget off its nearest edge, leaving PEEK_PX visible. */
function slideXform(pt: SnapPt): string {
  const off = `${SNAP_M - PEEK_PX}px`;
  if (pt === "TR" || pt === "RC" || pt === "BR") return `translateX(calc(100% + ${off}))`;
  if (pt === "TL" || pt === "LC" || pt === "BL") return `translateX(calc(-100% - ${off}))`;
  if (pt === "TC")                                return `translateY(calc(-100% - ${off}))`;
  /* BC */                                        return `translateY(calc(100%  + ${off}))`;
}

/** Thin gold peek tab that stays visible at the inside edge after slide. */
function peekStyle(pt: SnapPt): React.CSSProperties {
  const base: React.CSSProperties = {
    position:      "absolute",
    borderRadius:  2,
    background:    "linear-gradient(135deg,rgba(155,117,21,0.90),rgba(218,165,32,0.90))",
    boxShadow:     "0 0 8px rgba(218,165,32,0.60)",
    pointerEvents: "none",
  };
  if (pt === "TR" || pt === "RC" || pt === "BR")
    return { ...base, left: 0,   top: "15%", bottom: "15%", width: PEEK_PX };
  if (pt === "TL" || pt === "LC" || pt === "BL")
    return { ...base, right: 0,  top: "15%", bottom: "15%", width: PEEK_PX };
  if (pt === "TC")
    return { ...base, bottom: 0, left: "25%", right: "25%", height: PEEK_PX };
  /* BC */
  return   { ...base, top: 0,    left: "25%", right: "25%", height: PEEK_PX };
}

/* Snap labels for the indicator dots */
const SNAP_LABELS: Record<SnapPt, string> = {
  TL: "Top Left", TC: "Top Center", TR: "Top Right",
  RC: "Right Center",
  BR: "Bottom Right", BC: "Bottom Center", BL: "Bottom Left",
  LC: "Left Center",
};

function savedSnap(): SnapPt {
  try {
    const v = localStorage.getItem("bdv-guide-snap") as SnapPt | null;
    if (v && (ALL_SNAPS as string[]).includes(v)) return v;
  } catch { /* noop */ }
  return "TL";
}
function saveSnap(pt: SnapPt) {
  try { localStorage.setItem("bdv-guide-snap", pt); } catch { /* noop */ }
}

/* ─── Playlist ─── */

interface PlaylistTrack { name: string; url: string }

/** Filename → readable title ("my-song_final.mp3" → "my song final"). */
function displayName(name: string): string {
  const noExt = name.replace(/\.[a-z0-9]+$/i, "");
  const spaced = noExt.replace(/[_-]+/g, " ").trim();
  return spaced || name;
}

/* Uploadable track list. The built-in theme song lives in ThemePlayerRow
 * above and is not part of this list. Playback uses one detached Audio
 * instance (never appended to the DOM) so the theme player's page-media
 * observer ignores it; starting a track pauses the theme song so the two
 * never overlap. */
function PlaylistTracks() {
  const { getAccessToken } = useAuth();
  const { playing: themePlaying, togglePlay: toggleThemePlay } = useThemePlayer();
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentName, setCurrentName] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tracksRef = useRef<PlaylistTrack[]>([]);
  const currentRef = useRef<string | null>(null);
  const playingRef = useRef(false);
  tracksRef.current = tracks;
  playingRef.current = playing;

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    try {
      const token = await getAccessToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }, [getAccessToken]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/playlist");
      if (res.ok) {
        const data = await res.json();
        setTracks(Array.isArray(data.tracks) ? data.tracks : []);
      }
    } catch {
      /* keep the previous list */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Owner-only upload/delete controls.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/status", {
          headers: await authHeaders(),
        });
        const data = (await res.json().catch(() => ({}))) as {
          isAdmin?: boolean;
        };
        if (!cancelled) setIsAdmin(res.ok && data.isAdmin === true);
      } catch {
        /* not the owner — controls stay hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  // One detached Audio instance for the whole playlist — never in the DOM.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    audioRef.current = audio;

    const beginPlayback = (track: PlaylistTrack) => {
      if (audio.src !== track.url) audio.src = track.url;
      void audio
        .play()
        .then(() => {
          currentRef.current = track.name;
          setCurrentName(track.name);
          playingRef.current = true;
          setPlaying(true);
          setError(null);
        })
        .catch(() => {
          playingRef.current = false;
          setPlaying(false);
          setError("Couldn't play that track.");
        });
    };

    // Auto-advance to the next track; stop at the end of the list.
    const onEnded = () => {
      const list = tracksRef.current;
      const idx = list.findIndex((t) => t.name === currentRef.current);
      const next = idx >= 0 ? list[idx + 1] : undefined;
      if (next) {
        beginPlayback(next);
      } else {
        currentRef.current = null;
        playingRef.current = false;
        setCurrentName(null);
        setPlaying(false);
      }
    };
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  // Mutual exclusion with the theme song: if it starts, stop the track.
  useEffect(() => {
    if (themePlaying && currentRef.current) {
      audioRef.current?.pause();
      currentRef.current = null;
      playingRef.current = false;
      setCurrentName(null);
      setPlaying(false);
    }
  }, [themePlaying]);

  const playTrack = useCallback(
    (track: PlaylistTrack) => {
      const audio = audioRef.current;
      if (!audio) return;
      setError(null);
      if (currentRef.current === track.name && playingRef.current) {
        // Clicking the playing track stops it.
        audio.pause();
        currentRef.current = null;
        playingRef.current = false;
        setCurrentName(null);
        setPlaying(false);
        return;
      }
      if (themePlaying) toggleThemePlay(); // never overlap the theme song
      if (audio.src !== track.url) audio.src = track.url;
      void audio
        .play()
        .then(() => {
          currentRef.current = track.name;
          setCurrentName(track.name);
          playingRef.current = true;
          setPlaying(true);
        })
        .catch(() => setError("Couldn't play that track."));
    },
    [themePlaying, toggleThemePlay],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        const form = new FormData();
        form.append("track", file);
        const res = await fetch("/api/playlist/upload", {
          method: "POST",
          headers: await authHeaders(),
          body: form,
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Upload failed.");
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [authHeaders, refresh],
  );

  const handleDelete = useCallback(
    async (name: string) => {
      setError(null);
      try {
        const res = await fetch(`/api/playlist/${encodeURIComponent(name)}`, {
          method: "DELETE",
          headers: await authHeaders(),
        });
        if (!res.ok) throw new Error("Delete failed.");
        if (currentRef.current === name) {
          audioRef.current?.pause();
          currentRef.current = null;
          playingRef.current = false;
          setCurrentName(null);
          setPlaying(false);
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed.");
      }
    },
    [authHeaders, refresh],
  );

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">
        Playlist
        {loaded && tracks.length > 0 && (
          <span className="text-yellow-400/60"> · {tracks.length}</span>
        )}
      </p>

      {!loaded ? (
        <div className="flex items-center justify-center py-6 text-white/30">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : tracks.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-white/40 py-1">
          No tracks yet — the owner can upload songs here.
        </p>
      ) : (
        <div className="space-y-1.5">
          {tracks.map((track) => {
            const isCurrent = currentName === track.name;
            const isPlaying = isCurrent && playing;
            return (
              <div
                key={track.name}
                className="flex items-center gap-2 px-2.5 py-2 rounded-xl transition-colors"
                style={{
                  background: isCurrent
                    ? "rgba(218,165,32,0.08)"
                    : "rgba(255,255,255,0.02)",
                  border: `1px solid ${
                    isCurrent
                      ? "rgba(218,165,32,0.30)"
                      : "rgba(255,255,255,0.06)"
                  }`,
                }}
              >
                <button
                  onClick={() => playTrack(track)}
                  aria-label={isPlaying ? `Stop ${track.name}` : `Play ${track.name}`}
                  className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-transform hover:scale-110 active:scale-95"
                  style={
                    isCurrent
                      ? {
                          background:
                            "linear-gradient(135deg,#9B7515,#DAA520)",
                          boxShadow: "0 0 8px rgba(218,165,32,0.50)",
                        }
                      : {
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.10)",
                        }
                  }
                >
                  {isPlaying ? (
                    <Pause className="h-3 w-3 text-black" fill="black" />
                  ) : (
                    <Play
                      className="h-3 w-3 text-white/70"
                      fill="currentColor"
                      style={{ marginLeft: 1 }}
                    />
                  )}
                </button>
                <p
                  className="flex-1 min-w-0 text-[11px] font-semibold truncate"
                  style={{
                    color: isCurrent
                      ? "rgba(255,215,0,0.90)"
                      : "rgba(255,255,255,0.65)",
                  }}
                  title={track.name}
                >
                  {displayName(track.name)}
                </p>
                {isPlaying && (
                  <div className="flex items-end gap-[2px]" style={{ height: 7 }}>
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        style={{
                          width: 2,
                          borderRadius: 1,
                          background:
                            "linear-gradient(to top,#9B7515,#FFD700)",
                          height: 7,
                          animation: `bdvEq${i} 0.6s ease-in-out ${i * 0.12}s infinite alternate`,
                        }}
                      />
                    ))}
                  </div>
                )}
                {isAdmin && (
                  <button
                    onClick={() => void handleDelete(track.name)}
                    aria-label={`Delete ${track.name}`}
                    title="Delete track"
                    className="h-6 w-6 flex items-center justify-center rounded-lg text-white/25 hover:text-red-400/90 transition-colors shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isAdmin && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
            className="hidden"
            aria-label="Upload a song"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold transition-colors disabled:opacity-50"
            style={{
              border: "1px dashed rgba(218,165,32,0.30)",
              color: "rgba(255,215,0,0.85)",
              background: "rgba(218,165,32,0.04)",
            }}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {uploading ? "Uploading…" : "Upload song"}
          </button>
        </>
      )}

      {error && (
        <p className="text-[11px] text-red-400/80" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ─── localStorage open/closed ─── */
const LS_OPEN = "bdv_guide_open";
function readOpen() {
  try { return localStorage.getItem(LS_OPEN) !== "false"; } catch { return true; }
}
function saveOpen(v: boolean) {
  try { localStorage.setItem(LS_OPEN, v ? "true" : "false"); } catch { /* noop */ }
}

/* ─── Snap position indicator dots ─── */
function SnapDots({ current }: { current: SnapPt }) {
  const positions: { pt: SnapPt; style: React.CSSProperties }[] = [
    { pt: "TL", style: { top: 0,    left: 0  } },
    { pt: "TC", style: { top: 0,    left: "50%", transform: "translateX(-50%)" } },
    { pt: "TR", style: { top: 0,    right: 0 } },
    { pt: "RC", style: { top: "50%", right: 0, transform: "translateY(-50%)" } },
    { pt: "BR", style: { bottom: 0, right: 0 } },
    { pt: "BC", style: { bottom: 0, left: "50%", transform: "translateX(-50%)" } },
    { pt: "BL", style: { bottom: 0, left: 0  } },
    { pt: "LC", style: { top: "50%", left: 0, transform: "translateY(-50%)" } },
  ];
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
      style={{ borderRadius: "inherit" }}
    >
      {positions.map(({ pt, style }) => (
        <div
          key={pt}
          title={SNAP_LABELS[pt]}
          style={{
            position: "absolute",
            width: 6, height: 6, borderRadius: "50%",
            background: pt === current
              ? "rgba(218,165,32,0.95)"
              : "rgba(255,255,255,0.15)",
            boxShadow: pt === current ? "0 0 6px rgba(218,165,32,0.80)" : "none",
            transition: "background 0.25s, box-shadow 0.25s",
            margin: 4,
            ...style,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────── */

export function BowDownAIGuide() {
  const elRef      = useRef<HTMLDivElement>(null);
  const dragging   = useRef(false);
  const startPtr   = useRef({ px: 0, py: 0, ex: 0, ey: 0 });
  const posRef     = useRef({ x: 0, y: 0 });
  const hideTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initSnap   = savedSnap();
  const [pos,          rawSetPos]      = useState(() => snapPos(initSnap, 220, 44));
  const [currentSnap,  setCurrentSnap] = useState<SnapPt>(initSnap);
  const [isSnapping,   setIsSnapping]  = useState(false);
  const [isDragging,   setIsDragging]  = useState(false);
  const [isHidden,     setIsHidden]    = useState(false);  // auto-hidden (peeking)
  const [open,         setOpen]        = useState<boolean>(readOpen);

<<<<<<< HEAD
=======
  const [location]   = useLocation();
  const [editorTab,  setEditorTab] = useState<string | null>(null);

>>>>>>> feature/homepage-playlist
  const { playing } = useThemePlayer();

  /* ── helpers ── */
  function updatePos(p: { x: number; y: number }) {
    posRef.current = p;
    rawSetPos(p);
  }

  function snapTo(pt: SnapPt, w: number, h: number) {
    saveSnap(pt);
    setCurrentSnap(pt);
    setIsSnapping(true);
    updatePos(snapPos(pt, w, h));
    setTimeout(() => setIsSnapping(false), 400);
  }

  const startHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setOpen(false);          // collapse panel on auto-hide
      setIsHidden(true);
    }, HIDE_MS);
  }, []);

  const cancelHideTimer = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);

  /* ── boot: place at saved snap, start idle timer ── */
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    updatePos(snapPos(initSnap, el.offsetWidth, el.offsetHeight));
    startHideTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── resize: re-snap ── */
  useEffect(() => {
    const onResize = () => {
      const el = elRef.current;
      if (!el || dragging.current) return;
      updatePos(snapPos(currentSnap, el.offsetWidth, el.offsetHeight));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [currentSnap]);

  /* ── drag handlers ── */
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button,input")) return;
    dragging.current = true;
    setIsDragging(true);
    cancelHideTimer();
    setIsHidden(false);
    const el = elRef.current!;
    const rect = el.getBoundingClientRect();
    startPtr.current = { px: e.clientX, py: e.clientY, ex: rect.left, ey: rect.top };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const el = elRef.current!;
    const w = el.offsetWidth, h = el.offsetHeight;
    const { px, py, ex, ey } = startPtr.current;
    const half = SNAP_M / 2;
    updatePos({
      x: Math.max(half, Math.min(window.innerWidth  - w - half, ex + e.clientX - px)),
      y: Math.max(half, Math.min(window.innerHeight - h - half, ey + e.clientY - py)),
    });
  }

  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    const el = elRef.current!;
    const pt = nearestSnap(posRef.current.x, posRef.current.y, el.offsetWidth, el.offsetHeight);
    snapTo(pt, el.offsetWidth, el.offsetHeight);
    startHideTimer();
  }

  function onMouseEnter() {
    cancelHideTimer();
    setIsHidden(false);
  }

  function onMouseLeave() {
    if (!dragging.current) startHideTimer();
  }

  /* ── open/close ── */
  function toggleOpen() {
    const next = !open;
    saveOpen(next);
    setOpen(next);
    // re-snap after next tick when size has settled
    requestAnimationFrame(() => {
      const el = elRef.current;
      if (!el) return;
      updatePos(snapPos(currentSnap, el.offsetWidth, el.offsetHeight));
    });
    cancelHideTimer();
    startHideTimer();
  }

  /* ── transitions ── */
  const transition = [
    isSnapping
      ? "left 0.30s cubic-bezier(0.34,1.56,0.64,1), top 0.30s cubic-bezier(0.34,1.56,0.64,1)"
      : "",
    "transform 0.32s cubic-bezier(0.34,1.56,0.64,1)",
    "opacity 0.20s ease",
  ].filter(Boolean).join(", ");

  return (
    <>
      <style>{`
        @keyframes bdvEq0 { from{height:2px} to{height:7px} }
        @keyframes bdvEq1 { from{height:4px} to{height:7px} }
        @keyframes bdvEq2 { from{height:7px} to{height:2px} }
        @keyframes bdvEq3 { from{height:3px} to{height:7px} }
      `}</style>

      <div
        ref={elRef}
        style={{
          position:         "fixed",
          left:             pos.x,
          top:              pos.y,
          zIndex:           9990,
          width:            open ? 300 : "auto",
          maxHeight:        open ? "min(72vh, 580px)" : "auto",
          display:          "flex",
          flexDirection:    "column",
          transform:        isHidden ? slideXform(currentSnap) : "none",
          transition,
          touchAction:      "none",
          userSelect:       "none",
          WebkitUserSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Gold peek tab — visible only when auto-hidden */}
        <div
          style={{
            ...peekStyle(currentSnap),
            opacity:    isHidden ? 1 : 0,
            transition: "opacity 0.20s ease",
          }}
          aria-hidden="true"
        />

        {/* Drag grip */}
        <div
          style={{
            display:        "flex",
            justifyContent: "center",
            alignItems:     "center",
            paddingBottom:  2,
            cursor:         isDragging ? "grabbing" : "grab",
            opacity:        isHidden ? 0 : 1,
            transition:     "opacity 0.15s ease",
          }}
          title="Drag to move — snaps to 8 positions"
        >
          <GripHorizontal size={13} style={{ color: "rgba(218,165,32,0.40)" }} />
        </div>

        {/* ── Expanded panel ── */}
        {open && (
          <div
            className="flex flex-col rounded-2xl border shadow-2xl overflow-hidden"
            style={{
              background:     "rgba(6,6,6,0.96)",
              backdropFilter: "blur(20px)",
              borderColor:    "rgba(218,165,32,0.18)",
              maxHeight:      "min(72vh, 560px)",
              position:       "relative",
            }}
          >
            {/* Snap dots indicator */}
            <SnapDots current={currentSnap} />

            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 shrink-0"
              style={{ borderBottom: "1px solid rgba(218,165,32,0.12)" }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    background: "linear-gradient(135deg,rgba(155,117,21,0.6),rgba(218,165,32,0.3))",
                    border:     "1px solid rgba(218,165,32,0.30)",
                  }}
                >
                  <ListMusic className="h-3.5 w-3.5 text-yellow-400" />
                </div>
                <div>
                  <p className="text-[11px] font-black text-white leading-none">Bow Down Playlist</p>
                  <p className="text-[9px] text-yellow-400/50 leading-none mt-0.5">
                    {SNAP_LABELS[currentSnap]} · active ✓
                  </p>
                </div>
              </div>
              <button
                onClick={toggleOpen}
                className="flex items-center justify-center h-6 w-6 rounded-lg border border-white/10 bg-white/[0.04] text-white/40 hover:text-white hover:border-white/20 transition-colors"
                aria-label="Minimize playlist"
              >
                <Minimize2 className="h-3 w-3" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

<<<<<<< HEAD
              <ThemePlayerRow />

              <div style={{ height: 1, background: "rgba(255,255,255,0.05)" }} />

              {/* Playlist */}
              <PlaylistTracks />
=======
              {/* Page guide */}
              <div className="space-y-3">
                <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">{guide.title}</p>
                <div className="space-y-3">
                  {guide.steps.map((step) => (
                    <div key={step.n} className="flex gap-3">
                      <div
                        className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 mt-0.5"
                        style={{ background: "rgba(218,165,32,0.12)", border: "1px solid rgba(218,165,32,0.25)", color: "rgba(218,165,32,0.90)" }}
                      >
                        {step.n}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white/80 leading-tight">{step.title}</p>
                        <p className="text-[11px] text-white/40 mt-0.5 leading-relaxed">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {guide.tips && guide.tips.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5" style={{ color: "rgba(218,165,32,0.45)" }}>
                    <Zap className="h-3 w-3" /> Tips
                  </p>
                  {guide.tips.map((tip, i) => (
                    <div key={i} className="flex gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <ChevronRight className="h-3 w-3 shrink-0 mt-0.5" style={{ color: "rgba(218,165,32,0.45)" }} />
                      <p className="text-[11px] text-white/50 leading-relaxed">{tip}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Status */}
              <div
                className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 rounded-xl text-[10px] font-mono"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
              >
                <span className="text-white/25">Guide: <span className="text-green-400/70">active ✓</span></span>
                <span className="text-white/25">Playlist: <span className="text-green-400/70">on homepage ✓</span></span>
                <span className="text-white/25">Snap: <span className="text-yellow-400/50">{SNAP_LABELS[currentSnap]}</span></span>
              </div>
>>>>>>> feature/homepage-playlist

            </div>
          </div>
        )}

        {/* ── Collapsed pill ── */}
        {!open && (
          <div
            style={{
              position: "relative",
              opacity:  isHidden ? 0 : 1,
              transition: "opacity 0.15s ease",
            }}
          >
            {/* Snap dots on pill */}
            <SnapDots current={currentSnap} />

            <button
              onClick={toggleOpen}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl shadow-2xl"
              style={{
                background:     "rgba(6,6,6,0.92)",
                border:         "1px solid rgba(218,165,32,0.28)",
                backdropFilter: "blur(16px)",
                boxShadow:      "0 0 20px rgba(218,165,32,0.12), 0 4px 24px rgba(0,0,0,0.60)",
                cursor:         isDragging ? "grabbing" : "pointer",
              }}
              aria-label="Open Bow Down Playlist"
            >
              <div
                className="h-6 w-6 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "linear-gradient(135deg,rgba(155,117,21,0.7),rgba(218,165,32,0.4))", border: "1px solid rgba(218,165,32,0.35)" }}
              >
                <ListMusic className="h-3.5 w-3.5 text-yellow-400" />
              </div>
              {playing && (
                <div className="flex items-end gap-[1.5px]" style={{ height: 8 }}>
                  {[0,1,2,3].map((i) => (
                    <div key={i} style={{
                      width: 2, borderRadius: 1,
                      background: "linear-gradient(to top,#9B7515,#FFD700)",
                      height: 8,
                      animation: `bdvEq${i} 0.6s ease-in-out ${i * 0.1}s infinite alternate`,
                    }} />
                  ))}
                </div>
              )}
              <ChevronUp className="h-3.5 w-3.5 text-yellow-400/60 shrink-0" />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
