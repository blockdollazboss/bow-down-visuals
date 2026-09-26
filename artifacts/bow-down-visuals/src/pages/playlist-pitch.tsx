import { useEffect, useState } from "react";
import {
  ListMusic, Sparkles, Loader2, Copy, Check, Mail, MessageCircle,
  Users, ClipboardList, Plus, Trash2, Send, Clock, Trophy, XCircle,
  AlertTriangle, ChevronDown, Music2,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Playlist Pitcher ────────────────────────────────────────────────────
   AI helps musicians pitch songs to Spotify/editorial playlists:
   pick a song (library or manual) → AI analyzes it (genre, mood, energy,
   comparable artists) → generates a professional pitch email + DM version.
   Curator directory (free, starter list) + pitch tracker (free) included.

   Pricing: 2 credits per pitch kit. Tracker + curators are free. */

const CREDIT_COST = 2;

type Tab = "kit" | "curators" | "tracker";

const GENRES = [
  "hip-hop", "r&b", "pop", "edm", "rock", "indie", "country", "latin", "afrobeats",
];

interface SongAnalysis {
  genre: string;
  mood: string;
  energy: number;
  tempoFeel: string;
  comparableArtists: string[];
  playlistFit: string[];
  oneLiner: string;
}

interface PitchKit {
  analysis: SongAnalysis;
  pitchEmail: { subject: string; body: string };
  dmPitch: string;
  followUp: string;
  disclaimer: string;
}

interface LibrarySong {
  id: string;
  title?: string;
  audio_url?: string;
}

interface Curator {
  id: string;
  name: string;
  platform: string;
  genres: string[];
  focus: string;
  submitVia: string;
}

interface Pitch {
  id: string;
  songTitle: string;
  artistName?: string | null;
  curatorName?: string | null;
  playlistName: string;
  status: string;
  notes?: string | null;
  contactedAt?: string | null;
  createdAt?: string | null;
}

const STATUS_META: Record<string, { label: string; icon: typeof Send; cls: string }> = {
  sent: { label: "Sent", icon: Send, cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  pending: { label: "Pending", icon: Clock, cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  accepted: { label: "Accepted", icon: Trophy, cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  rejected: { label: "Rejected", icon: XCircle, cls: "border-red-500/40 bg-red-500/10 text-red-300" },
};

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch { /* clipboard unavailable */ }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white"
      aria-label={`Copy ${label}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : `Copy ${label}`}
    </button>
  );
}

async function authedFetch(
  getAccessToken: () => Promise<string | null>,
  url: string,
  init?: RequestInit,
) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; message?: string };
  return { res, data };
}

export default function PlaylistPitcher() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>("kit");

  /* ── pitch kit state ── */
  const [library, setLibrary] = useState<LibrarySong[]>([]);
  const [songSource, setSongSource] = useState<"library" | "manual">("manual");
  const [librarySongId, setLibrarySongId] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [energy, setEnergy] = useState(60);
  const [tempo, setTempo] = useState("");
  const [description, setDescription] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [curatorName, setCuratorName] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [kit, setKit] = useState<PitchKit | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* ── curators state ── */
  const [genreFilter, setGenreFilter] = useState("all");
  const [curators, setCurators] = useState<Curator[]>([]);
  const [curatorNotice, setCuratorNotice] = useState("");

  /* ── tracker state ── */
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPitch, setNewPitch] = useState({
    songTitle: "", artistName: "", curatorName: "", playlistName: "", notes: "",
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { res, data } = await authedFetch(getAccessToken, "/api/songs");
        if (res.ok && Array.isArray((data as { songs?: unknown }).songs)) {
          setLibrary((data as { songs: LibrarySong[] }).songs.slice(0, 100));
        }
      } catch { /* library is optional */ }
    })();
    loadCurators("all");
    loadTracker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function loadCurators(g: string) {
    try {
      const { res, data } = await authedFetch(
        getAccessToken, `/api/playlist-pitch/curators?genre=${encodeURIComponent(g)}`,
      );
      if (res.ok) {
        setCurators((data as { curators: Curator[] }).curators ?? []);
        setCuratorNotice((data as { notice: string }).notice ?? "");
      }
    } catch { /* non-fatal */ }
  }

  async function loadTracker() {
    setTrackerLoading(true);
    try {
      const { res, data } = await authedFetch(getAccessToken, "/api/playlist-pitch/tracker");
      if (res.ok) setPitches((data as { pitches: Pitch[] }).pitches ?? []);
    } catch { /* non-fatal */ }
    finally { setTrackerLoading(false); }
  }

  async function generateKit() {
    if (generating || !user) return;
    const finalTitle = songSource === "library"
      ? (library.find((s) => s.id === librarySongId)?.title ?? "").trim()
      : songTitle.trim();
    if (!finalTitle) {
      setError("Give your song a title first — the pitch is built around it.");
      return;
    }
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const { res, data } = await authedFetch(getAccessToken, "/api/playlist-pitch/kit", {
        method: "POST",
        body: JSON.stringify({
          songTitle: finalTitle,
          artistName: artistName.trim(),
          songDescription: description.trim(),
          genre: genre.trim(),
          mood: mood.trim(),
          energy,
          tempo: tempo.trim(),
          lyrics: lyrics.trim(),
          curatorName: curatorName.trim(),
          playlistName: playlistName.trim(),
        }),
      });
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !(data as { kit?: PitchKit }).kit) {
        throw new Error(data.message || (typeof data.error === "string" ? data.error : "") || "Pitch kit failed — try again.");
      }
      setKit((data as { kit: PitchKit }).kit);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("pitch-kit-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pitch kit failed — try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function addPitch() {
    if (!newPitch.songTitle.trim() || !newPitch.playlistName.trim()) {
      setError("Song title and playlist name are required for a tracker entry.");
      return;
    }
    setError(null);
    try {
      const { res, data } = await authedFetch(getAccessToken, "/api/playlist-pitch/tracker", {
        method: "POST",
        body: JSON.stringify({
          songTitle: newPitch.songTitle.trim(),
          artistName: newPitch.artistName.trim(),
          curatorName: newPitch.curatorName.trim(),
          playlistName: newPitch.playlistName.trim(),
          notes: newPitch.notes.trim(),
        }),
      });
      if (!res.ok) throw new Error("Couldn't save that pitch — try again.");
      const pitch = (data as { pitch: Pitch }).pitch;
      setPitches((prev) => [pitch, ...prev]);
      setNewPitch({ songTitle: "", artistName: "", curatorName: "", playlistName: "", notes: "" });
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that pitch — try again.");
    }
  }

  async function updatePitchStatus(id: string, status: string) {
    try {
      const { res, data } = await authedFetch(getAccessToken, `/api/playlist-pitch/tracker/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Couldn't update that pitch.");
      const updated = (data as { pitch: Pitch }).pitch;
      setPitches((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch { /* non-fatal */ }
  }

  async function deletePitch(id: string) {
    try {
      const { res } = await authedFetch(getAccessToken, `/api/playlist-pitch/tracker/${id}`, {
        method: "DELETE",
      });
      if (res.ok) setPitches((prev) => prev.filter((p) => p.id !== id));
    } catch { /* non-fatal */ }
  }

  function addCuratorToTracker(c: Curator) {
    setNewPitch((prev) => ({
      ...prev,
      curatorName: c.name,
      playlistName: prev.playlistName || c.focus.split("(")[0]!.trim().slice(0, 80),
    }));
    setTab("tracker");
    setShowAddForm(true);
    setTimeout(() => {
      document.getElementById("pitch-tracker")?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }

  const acceptedCount = pitches.filter((p) => p.status === "accepted").length;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="relative mx-auto max-w-4xl px-5 pb-24 pt-14 md:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <ListMusic className="h-3 w-3" aria-hidden="true" /> Playlist Pitcher
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Get Your Song <span className="text-primary">Playlisted</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            AI analyzes your song, then writes a professional curator pitch —
            the email, the DM, and the follow-up. Pitching improves your odds;
            it never guarantees placement.
          </p>
        </div>

        {/* tabs */}
        <div className="relative mt-8 flex justify-center gap-2">
          {([
            { key: "kit", label: "Pitch Kit", icon: Sparkles },
            { key: "curators", label: "Curators", icon: Users },
            { key: "tracker", label: `Tracker${pitches.length ? ` (${pitches.length})` : ""}`, icon: ClipboardList },
          ] as { key: Tab; label: string; icon: typeof Sparkles }[]).map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                    : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t.label}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="relative mt-6 flex items-start gap-2.5 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        {outOfCredits && (
          <div className="relative mt-6">
            <OutOfCredits />
          </div>
        )}

        {/* ═══ PITCH KIT TAB ═══ */}
        {tab === "kit" && (
          <div className="relative mt-8">
            <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
              {/* song source */}
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
                Your song
              </p>
              <div className="flex gap-2">
                {(["manual", "library"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSongSource(s)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      songSource === s
                        ? "bg-primary text-black"
                        : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {s === "manual" ? "Enter manually" : `From my library${library.length ? ` (${library.length})` : ""}`}
                  </button>
                ))}
              </div>

              {songSource === "library" ? (
                <select
                  value={librarySongId}
                  onChange={(e) => setLibrarySongId(e.target.value)}
                  className={`${inputClass} mt-4`}
                >
                  <option value="">Pick a song…</option>
                  {library.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title || "Untitled song"}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={songTitle}
                  onChange={(e) => setSongTitle(e.target.value)}
                  maxLength={200}
                  placeholder="Song title *"
                  className={`${inputClass} mt-4`}
                />
              )}

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <input
                  value={artistName}
                  onChange={(e) => setArtistName(e.target.value)}
                  maxLength={200}
                  placeholder="Artist name"
                  className={inputClass}
                />
                <input
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  maxLength={100}
                  placeholder="Genre (e.g. Alt R&B)"
                  className={inputClass}
                  list="pitch-genres"
                />
                <datalist id="pitch-genres">
                  {GENRES.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                    Energy — {energy}
                  </label>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={energy}
                  onChange={(e) => setEnergy(parseInt(e.target.value, 10))}
                  className="mt-2 w-full accent-[#d4af37]"
                  aria-label="Song energy"
                />
                <div className="flex justify-between text-[11px] text-white/35">
                  <span>Chill</span>
                  <span>Balanced</span>
                  <span>Turnt</span>
                </div>
              </div>

              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              >
                Advanced details (optional)
                <ChevronDown className={`h-4 w-4 transition ${showAdvanced ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <input
                      value={mood}
                      onChange={(e) => setMood(e.target.value)}
                      maxLength={200}
                      placeholder="Mood (e.g. late-night, confident)"
                      className={inputClass}
                    />
                    <input
                      value={tempo}
                      onChange={(e) => setTempo(e.target.value)}
                      maxLength={50}
                      placeholder="Tempo (e.g. 98 BPM)"
                      className={inputClass}
                    />
                  </div>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    placeholder="What is the song about? Any story behind it?"
                    className={`${inputClass} resize-y`}
                  />
                  <textarea
                    value={lyrics}
                    onChange={(e) => setLyrics(e.target.value)}
                    maxLength={5000}
                    rows={4}
                    placeholder="Paste lyrics (optional — helps the AI nail the themes)"
                    className={`${inputClass} resize-y`}
                  />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <input
                      value={curatorName}
                      onChange={(e) => setCuratorName(e.target.value)}
                      maxLength={200}
                      placeholder="Curator name (to personalize)"
                      className={inputClass}
                    />
                    <input
                      value={playlistName}
                      onChange={(e) => setPlaylistName(e.target.value)}
                      maxLength={200}
                      placeholder="Playlist name (to personalize)"
                      className={inputClass}
                    />
                  </div>
                </div>
              )}

              <button
                onClick={generateKit}
                disabled={generating || !user}
                className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-base font-black text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                )}
                {generating ? "Writing your pitch kit…" : `Generate pitch kit · ${CREDIT_COST} credits`}
              </button>
              {!user && (
                <p className="mt-3 text-center text-sm text-white/40">
                  Sign in to generate a pitch kit.
                </p>
              )}
            </div>

            {/* results */}
            {kit && (
              <div id="pitch-kit-results" className="mt-8 space-y-6">
                {/* analysis */}
                <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
                  <h2 className="flex items-center gap-2 text-lg font-black">
                    <Music2 className="h-5 w-5 text-primary" aria-hidden="true" />
                    Song analysis
                  </h2>
                  <p className="mt-3 border-l-2 border-primary/60 pl-4 text-[15px] italic leading-relaxed text-white/85">
                    “{kit.analysis.oneLiner}”
                  </p>
                  <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: "Genre", value: kit.analysis.genre },
                      { label: "Mood", value: kit.analysis.mood },
                      { label: "Energy", value: `${kit.analysis.energy}/100` },
                      { label: "Tempo feel", value: kit.analysis.tempoFeel },
                    ].map((s) => (
                      <div key={s.label} className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">{s.label}</p>
                        <p className="mt-1 text-sm font-semibold text-white">{s.value}</p>
                      </div>
                    ))}
                  </div>
                  {kit.analysis.comparableArtists.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">Sounds like</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {kit.analysis.comparableArtists.map((a) => (
                          <span key={a} className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                            {a}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {kit.analysis.playlistFit.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">Playlist fit</p>
                      <ul className="mt-2 space-y-1.5">
                        {kit.analysis.playlistFit.map((p, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                            {p}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* pitch email */}
                <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
                  <div className="flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-lg font-black">
                      <Mail className="h-5 w-5 text-primary" aria-hidden="true" />
                      Pitch email
                    </h2>
                    <CopyButton text={`Subject: ${kit.pitchEmail.subject}\n\n${kit.pitchEmail.body}`} label="email" />
                  </div>
                  <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-white/40">Subject</p>
                  <p className="mt-1 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm font-semibold text-white">
                    {kit.pitchEmail.subject}
                  </p>
                  <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-white/40">Body</p>
                  <p className="mt-1 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm leading-relaxed text-white/80">
                    {kit.pitchEmail.body}
                  </p>
                </div>

                {/* DM + follow-up */}
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
                    <div className="flex items-center justify-between">
                      <h3 className="flex items-center gap-2 font-black">
                        <MessageCircle className="h-4 w-4 text-primary" aria-hidden="true" />
                        DM version
                      </h3>
                      <CopyButton text={kit.dmPitch} label="DM" />
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-white/75">{kit.dmPitch}</p>
                  </div>
                  <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
                    <div className="flex items-center justify-between">
                      <h3 className="flex items-center gap-2 font-black">
                        <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                        7-day follow-up
                      </h3>
                      <CopyButton text={kit.followUp} label="follow-up" />
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-white/75">{kit.followUp}</p>
                  </div>
                </div>

                <p className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4 text-center text-[13px] leading-relaxed text-amber-200/80">
                  {kit.disclaimer}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ═══ CURATORS TAB ═══ */}
        {tab === "curators" && (
          <div className="relative mt-8">
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4 text-[13px] leading-relaxed text-amber-200/85">
              <span className="font-black text-amber-300">Starter list.</span>{" "}
              {curatorNotice || "Verify each curator's current submission guidelines before pitching. Never pay for guaranteed placements."}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {["all", ...GENRES].map((g) => (
                <button
                  key={g}
                  onClick={() => { setGenreFilter(g); loadCurators(g); }}
                  className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${
                    genreFilter === g
                      ? "bg-primary text-black"
                      : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                  }`}
                >
                  {g === "all" ? "All genres" : g}
                </button>
              ))}
            </div>

            <div className="mt-5 space-y-4">
              {curators.map((c) => (
                <div key={c.id} className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-black text-white">{c.name}</h3>
                      <p className="mt-0.5 text-xs font-semibold uppercase tracking-widest text-primary/80">
                        {c.platform}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.genres.slice(0, 4).map((g) => (
                        <span key={g} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-semibold capitalize text-white/60">
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-white/65">{c.focus}</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/50">
                    <span className="font-semibold text-white/70">How to submit: </span>
                    {c.submitVia}
                  </p>
                  <button
                    onClick={() => addCuratorToTracker(c)}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition hover:bg-primary/20"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add to tracker
                  </button>
                </div>
              ))}
              {curators.length === 0 && (
                <p className="py-10 text-center text-sm text-white/40">
                  No curators found for this genre yet.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ═══ TRACKER TAB ═══ */}
        {tab === "tracker" && (
          <div id="pitch-tracker" className="relative mt-8">
            <div className="flex items-center justify-between">
              <div className="flex gap-4 text-sm">
                <span className="text-white/50">
                  <span className="font-black text-white">{pitches.length}</span> pitches
                </span>
                <span className="text-white/50">
                  <span className="font-black text-emerald-300">{acceptedCount}</span> accepted
                </span>
              </div>
              <button
                onClick={() => setShowAddForm((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-black text-black transition hover:brightness-110"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Log a pitch
              </button>
            </div>

            {showAddForm && (
              <div className="mt-4 rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    value={newPitch.songTitle}
                    onChange={(e) => setNewPitch({ ...newPitch, songTitle: e.target.value })}
                    maxLength={200}
                    placeholder="Song title *"
                    className={inputClass}
                  />
                  <input
                    value={newPitch.playlistName}
                    onChange={(e) => setNewPitch({ ...newPitch, playlistName: e.target.value })}
                    maxLength={200}
                    placeholder="Playlist name *"
                    className={inputClass}
                  />
                  <input
                    value={newPitch.artistName}
                    onChange={(e) => setNewPitch({ ...newPitch, artistName: e.target.value })}
                    maxLength={200}
                    placeholder="Artist name"
                    className={inputClass}
                  />
                  <input
                    value={newPitch.curatorName}
                    onChange={(e) => setNewPitch({ ...newPitch, curatorName: e.target.value })}
                    maxLength={200}
                    placeholder="Curator name"
                    className={inputClass}
                  />
                </div>
                <textarea
                  value={newPitch.notes}
                  onChange={(e) => setNewPitch({ ...newPitch, notes: e.target.value })}
                  maxLength={1000}
                  rows={2}
                  placeholder="Notes (optional)"
                  className={`${inputClass} mt-3 resize-y`}
                />
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={addPitch}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110"
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Save pitch
                  </button>
                  <button
                    onClick={() => setShowAddForm(false)}
                    className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold text-white/60 transition hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="mt-5 space-y-3">
              {trackerLoading && (
                <p className="py-10 text-center text-sm text-white/40">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-hidden="true" />
                </p>
              )}
              {!trackerLoading && pitches.map((p) => {
                const meta = STATUS_META[p.status] ?? STATUS_META["sent"]!;
                const Icon = meta.icon;
                return (
                  <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-black text-white">
                          {p.songTitle}
                          {p.artistName ? <span className="font-normal text-white/45"> — {p.artistName}</span> : null}
                        </p>
                        <p className="mt-1 text-sm text-white/55">
                          {p.playlistName}
                          {p.curatorName ? <span className="text-white/35"> · {p.curatorName}</span> : null}
                        </p>
                        {p.notes ? (
                          <p className="mt-2 text-[13px] italic text-white/40">{p.notes}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${meta.cls}`}>
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                          {meta.label}
                        </span>
                        <button
                          onClick={() => deletePitch(p.id)}
                          className="rounded-lg p-1.5 text-white/30 transition hover:bg-red-500/10 hover:text-red-300"
                          aria-label="Delete pitch"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {Object.entries(STATUS_META).map(([key, m]) => (
                        <button
                          key={key}
                          onClick={() => updatePitchStatus(p.id, key)}
                          disabled={p.status === key}
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                            p.status === key
                              ? "cursor-default bg-white/10 text-white/40"
                              : "border border-white/10 text-white/55 hover:border-primary/50 hover:text-white"
                          }`}
                        >
                          Mark {m.label.toLowerCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {!trackerLoading && pitches.length === 0 && (
                <div className="rounded-3xl border border-dashed border-white/15 p-10 text-center">
                  <ClipboardList className="mx-auto h-8 w-8 text-white/25" aria-hidden="true" />
                  <p className="mt-3 text-sm text-white/50">
                    No pitches logged yet. Generate a pitch kit, find a curator,
                    and track every send right here — free forever.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
