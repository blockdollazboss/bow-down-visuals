import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Disc3, Sparkles, Loader2, Copy, Check, Mail, FileText,
  Building2, ClipboardList, Plus, Trash2, Send, Clock, Trophy, XCircle,
  AlertTriangle, Music2, ListMusic, Clapperboard, Users, MessageCircle, ChevronDown,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import SyncTab from "@/components/sync-pitch/SyncTab";

/* ─── Label Pitch ─────────────────────────────────────────────────────────
   AI helps artists pitch demos to record labels:
   pick a song (library or manual) → AI analyzes it → generates a
   professional demo submission package: submission email, artist
   one-sheet/bio, and follow-up template.
   Label directory (free, starter list) + submission tracker (free) included.

   Pricing: 3 credits per demo kit. Tracker + directory are free.

   Honesty: labels rarely sign from cold demos. The disclaimer is shown
   with every kit — relationships, buzz, and timing matter most. */

const CREDIT_COST = 3;

type Tab = "kit" | "labels" | "tracker";

const GENRES = [
  "hip-hop", "r&b", "pop", "rock", "country", "latin", "afrobeats", "edm",
];

interface DemoAnalysis {
  genre: string;
  mood: string;
  energy: number;
  tempoFeel: string;
  comparableArtists: string[];
  labelFit: string[];
  oneLiner: string;
}

interface DemoKit {
  analysis: DemoAnalysis;
  submissionEmail: { subject: string; body: string };
  oneSheet: string;
  followUp: string;
  disclaimer: string;
}

interface LibrarySong {
  id: string;
  title?: string;
  audio_url?: string;
}

interface LabelEntry {
  id: string;
  name: string;
  parent: string;
  type: "major" | "imprint" | "indie";
  genres: string[];
  knownFor: string;
  submitVia: string;
}

interface Submission {
  id: string;
  songTitle: string;
  artistName?: string | null;
  labelName: string;
  status: string;
  notes?: string | null;
  contactedAt?: string | null;
  createdAt?: string | null;
}



const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
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
      aria-label={t("labelPitch.copyTemplate", { label })}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t("labelPitch.copied") : t("labelPitch.copyTemplate", { label })}
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

export default function LabelPitch() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>("kit");

  /* ── merged surface: Labels (original) · Playlists (absorbed from
     /playlist-pitch). The /playlist-pitch route renders this same component
     (alias) — deep links from songs/release land on the Playlists mode. */
  type Mode = "labels" | "playlists";
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (window.location.pathname === "/playlist-pitch") return "playlists";
      if (q.get("mode") === "playlists" || q.get("tab") === "sync") return "playlists";
      if (q.get("song")) return "playlists";
    } catch { /* non-browser — ignore */ }
    return "labels";
  });

  /* press-kit feed: ?bio= pre-fills the artist bio for the label kit. */
  useEffect(() => {
    try {
      const bio = new URLSearchParams(window.location.search).get("bio")?.trim().slice(0, 2000);
      if (bio) {
        setArtistBio((b) => b || bio);
        setShowAdvanced(true);
      }
    } catch { /* ignore */ }
  }, []);

  const STATUS_META: Record<string, { label: string; icon: typeof Send; cls: string }> = {
    sent: { label: t("labelPitch.statusSent"), icon: Send, cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
    pending: { label: t("labelPitch.statusPending"), icon: Clock, cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
    signed: { label: t("labelPitch.statusSigned"), icon: Trophy, cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
    passed: { label: t("labelPitch.statusPassed"), icon: XCircle, cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  };

  const TYPE_META: Record<string, { label: string; cls: string }> = {
    major: { label: t("labelPitch.typeMajor"), cls: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300" },
    imprint: { label: t("labelPitch.typeImprint"), cls: "border-purple-500/40 bg-purple-500/10 text-purple-300" },
    indie: { label: t("labelPitch.typeIndependent"), cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  };

  /* ── demo kit state ── */
  const [library, setLibrary] = useState<LibrarySong[]>([]);
  const [songSource, setSongSource] = useState<"auto" | "library" | "manual">("auto");
  const [librarySongId, setLibrarySongId] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [energy, setEnergy] = useState(60);
  const [tempo, setTempo] = useState("");
  const [description, setDescription] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [artistBio, setArtistBio] = useState("");
  const [socialStats, setSocialStats] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [labelName, setLabelName] = useState("");
  const [kit, setKit] = useState<DemoKit | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* ── labels state ── */
  const [genreFilter, setGenreFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [labels, setLabels] = useState<LabelEntry[]>([]);
  const [labelNotice, setLabelNotice] = useState("");

  /* ── tracker state ── */
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSubmission, setNewSubmission] = useState({
    songTitle: "", artistName: "", labelName: "", notes: "",
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
    loadLabels("all", "all");
    loadTracker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function loadLabels(g: string, t: string) {
    try {
      const { res, data } = await authedFetch(
        getAccessToken,
        `/api/label-pitch/labels?genre=${encodeURIComponent(g)}&type=${encodeURIComponent(t)}`,
      );
      if (res.ok) {
        setLabels((data as { labels: LabelEntry[] }).labels ?? []);
        setLabelNotice((data as { notice: string }).notice ?? "");
      }
    } catch { /* non-fatal */ }
  }

  async function loadTracker() {
    setTrackerLoading(true);
    try {
      const { res, data } = await authedFetch(getAccessToken, "/api/label-pitch/tracker");
      if (res.ok) setSubmissions((data as { pitches: Submission[] }).pitches ?? []);
    } catch { /* non-fatal */ }
    finally { setTrackerLoading(false); }
  }

  async function generateKit() {
    if (generating || !user) return;
    // Auto mode: use the most recent library song; fall back to manual if library is empty
    const effectiveSource = songSource === "auto" && library.length > 0 ? "library" : songSource === "auto" ? "manual" : songSource;
    const effectiveSongId = songSource === "auto" && library.length > 0 ? library[0].id : librarySongId;
    const finalTitle = effectiveSource === "library"
      ? (library.find((s) => s.id === effectiveSongId)?.title ?? "").trim()
      : songTitle.trim();
    if (!finalTitle) {
      setError(songSource === "auto"
        ? t("labelPitch.errAutoNoSong")
        : t("labelPitch.errNoTitle"));
      return;
    }
    // Auto mode: AI fills in bio, stats, and label targeting from your profile
    const autoBio = songSource === "auto" && !artistBio.trim();
    const autoTarget = songSource === "auto" && !labelName.trim();
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const { res, data } = await authedFetch(getAccessToken, "/api/label-pitch/kit", {
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
          artistBio: artistBio.trim(),
          socialStats: socialStats.trim(),
          labelName: labelName.trim(),
          autoMode: songSource === "auto",
          autoBio: autoBio,
          autoTarget: autoTarget,
        }),
      });
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !(data as { kit?: DemoKit }).kit) {
        throw new Error(data.message || (typeof data.error === "string" ? data.error : "") || t("labelPitch.errKitFailed"));
      }
      setKit((data as { kit: DemoKit }).kit);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("demo-kit-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("labelPitch.errKitFailed"));
    } finally {
      setGenerating(false);
    }
  }

  async function addSubmission() {
    if (!newSubmission.songTitle.trim() || !newSubmission.labelName.trim()) {
      setError(t("labelPitch.errTrackerRequired"));
      return;
    }
    setError(null);
    try {
      const { res, data } = await authedFetch(getAccessToken, "/api/label-pitch/tracker", {
        method: "POST",
        body: JSON.stringify({
          songTitle: newSubmission.songTitle.trim(),
          artistName: newSubmission.artistName.trim(),
          labelName: newSubmission.labelName.trim(),
          notes: newSubmission.notes.trim(),
        }),
      });
      if (!res.ok) throw new Error(t("labelPitch.errSaveSubmission"));
      const pitch = (data as { pitch: Submission }).pitch;
      setSubmissions((prev) => [pitch, ...prev]);
      setNewSubmission({ songTitle: "", artistName: "", labelName: "", notes: "" });
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("labelPitch.errSaveSubmission"));
    }
  }

  async function updateSubmissionStatus(id: string, status: string) {
    try {
      const { res, data } = await authedFetch(getAccessToken, `/api/label-pitch/tracker/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(t("labelPitch.errUpdateSubmission"));
      const updated = (data as { pitch: Submission }).pitch;
      setSubmissions((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("labelPitch.errUpdateSubmission"));
    }
  }

  async function deleteSubmission(id: string) {
    if (!window.confirm(t("labelPitch.confirmDeleteSubmission"))) return;
    try {
      const { res } = await authedFetch(getAccessToken, `/api/label-pitch/tracker/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(t("labelPitch.errDeleteSubmission"));
      setSubmissions((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("labelPitch.errDeleteSubmission"));
    }
  }

  const signedCount = submissions.filter((p) => p.status === "signed").length;

  return (
    <div className="min-h-screen bg-black text-white">

      <main className="relative mx-auto max-w-4xl px-5 pb-24 pt-14 md:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero (labels mode — the Playlists mode renders its own hero below) */}
        {mode === "labels" && (
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Disc3 className="h-3 w-3" aria-hidden="true" /> {t("labelPitch.heroBadge")}
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            {t("labelPitch.heroTitleStart")}<span className="text-primary">{t("labelPitch.heroTitleHighlight")}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            {t("labelPitch.heroSubtitle")}
          </p>
        </div>
        )}

        {/* ── mode switch: Labels · Playlists (absorbed from /playlist-pitch) ── */}
        <div className="relative mt-8 flex justify-center gap-2">
          {(
            [
              { key: "labels", label: t("labelPitch.tabLabels"), icon: Building2 },
              { key: "playlists", label: t("playlistPitch.tabPlaylists", { defaultValue: "Playlists" }), icon: ListMusic },
            ] as { key: Mode; label: string; icon: typeof Building2 }[]
          ).map((m) => {
            const Icon = m.icon;
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-bold transition ${
                  active
                    ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                    : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {m.label}
              </button>
            );
          })}
        </div>

        {mode === "labels" && (
        <>
        {/* tabs */}
        <div className="relative mt-8 flex justify-center gap-2">
          {([
            { key: "kit", label: t("labelPitch.tabDemoKit"), icon: Sparkles },
            { key: "labels", label: t("labelPitch.tabLabels"), icon: Building2 },
            { key: "tracker", label: submissions.length ? t("labelPitch.tabTrackerCount", { count: submissions.length }) : t("labelPitch.tabTracker"), icon: ClipboardList },
          ] as { key: Tab; label: string; icon: typeof Sparkles }[]).map((tb) => {
            const Icon = tb.icon;
            const active = tab === tb.key;
            return (
              <button
                key={tb.key}
                onClick={() => setTab(tb.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                    : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tb.label}
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

        {/* ═══ DEMO KIT TAB ═══ */}
        {tab === "kit" && (
          <div className="relative mt-8">
            <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
              {/* song source */}
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("labelPitch.yourSong")}
              </p>
              <div className="flex gap-2 flex-wrap">
                {([
                  { key: "auto", label: t("labelPitch.sourceAuto") },
                  { key: "manual", label: t("labelPitch.sourceManual") },
                  { key: "library", label: library.length ? t("labelPitch.sourceLibraryCount", { count: library.length }) : t("labelPitch.sourceLibrary") },
                ] as const).map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setSongSource(s.key)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      songSource === s.key
                        ? "bg-primary text-black"
                        : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {songSource === "auto" ? (
                <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
                  <p className="text-sm text-white/70">
                    <span className="font-semibold text-primary">{t("labelPitch.autoInfoTitle")}</span>{" "}
                    {library.length > 0
                      ? <>{t("labelPitch.autoPicksStart")}<span className="text-white font-medium">{library[0].title || t("labelPitch.autoUntitled")}</span>{t("labelPitch.autoPicksEnd")}</>
                      : <>{t("labelPitch.autoNoLibrary")}</>}
                  </p>
                </div>
              ) : songSource === "library" ? (
                <select
                  value={librarySongId}
                  onChange={(e) => setLibrarySongId(e.target.value)}
                  className={`${inputClass} mt-4`}
                >
                  <option value="">{t("labelPitch.pickSong")}</option>
                  {library.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title || t("labelPitch.untitledSong")}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={songTitle}
                  onChange={(e) => setSongTitle(e.target.value)}
                  maxLength={200}
                  placeholder={t("labelPitch.songTitlePlaceholder")}
                  className={`${inputClass} mt-4`}
                />
              )}

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <input
                  value={artistName}
                  onChange={(e) => setArtistName(e.target.value)}
                  maxLength={200}
                  placeholder={t("labelPitch.artistNamePlaceholder")}
                  className={inputClass}
                />
                <input
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  maxLength={100}
                  placeholder={t("labelPitch.genrePlaceholder")}
                  className={inputClass}
                  list="label-genres"
                />
                <datalist id="label-genres">
                  {GENRES.map((g) => (
                    <option key={g} value={g}>{t(`labelPitch.genres.${g}`)}</option>
                  ))}
                </datalist>
                <input
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                  maxLength={200}
                  placeholder={t("labelPitch.moodPlaceholder")}
                  className={inputClass}
                />
                <input
                  value={tempo}
                  onChange={(e) => setTempo(e.target.value)}
                  maxLength={50}
                  placeholder={t("labelPitch.tempoPlaceholder")}
                  className={inputClass}
                />
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                  {t("labelPitch.energyLabel", { energy })}
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={energy}
                  onChange={(e) => setEnergy(Number(e.target.value))}
                  className="w-full accent-yellow-500"
                />
              </div>

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder={t("labelPitch.descriptionPlaceholder")}
                className={`${inputClass} mt-4 resize-y`}
              />

              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="mt-4 text-sm font-semibold text-white/50 transition hover:text-white"
              >
                {showAdvanced ? t("labelPitch.hideAdvanced") : t("labelPitch.showAdvanced")}{t("labelPitch.advancedSuffix")}
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-4">
                  <textarea
                    value={artistBio}
                    onChange={(e) => setArtistBio(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder={t("labelPitch.artistBioPlaceholder")}
                    className={`${inputClass} resize-y`}
                  />
                  <input
                    value={socialStats}
                    onChange={(e) => setSocialStats(e.target.value)}
                    maxLength={500}
                    placeholder={t("labelPitch.socialStatsPlaceholder")}
                    className={inputClass}
                  />
                  <textarea
                    value={lyrics}
                    onChange={(e) => setLyrics(e.target.value)}
                    maxLength={5000}
                    rows={4}
                    placeholder={t("labelPitch.lyricsPlaceholder")}
                    className={`${inputClass} resize-y`}
                  />
                </div>
              )}

              <div className="mt-6 border-t border-white/10 pt-6">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
                  {t("labelPitch.targetLabel")}<span className="text-white/25 normal-case tracking-normal">{t("labelPitch.targetLabelHint")}</span>
                </p>
                <input
                  value={labelName}
                  onChange={(e) => setLabelName(e.target.value)}
                  maxLength={200}
                  placeholder={t("labelPitch.labelNamePlaceholder")}
                  className={inputClass}
                  list="label-names"
                />
                <datalist id="label-names">
                  {labels.map((l) => (
                    <option key={l.id} value={l.name} />
                  ))}
                </datalist>
              </div>

              <button
                onClick={generateKit}
                disabled={generating}
                className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-bold text-black transition hover:brightness-110 disabled:opacity-50"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                    {t("labelPitch.buildingPackage")}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-5 w-5" aria-hidden="true" />
                    {t("labelPitch.generatePackage", { credits: CREDIT_COST })}
                  </>
                )}
              </button>
              <p className="mt-3 text-center text-xs text-white/35">
                {t("labelPitch.includesNote")}
              </p>
            </div>

            {/* ── results ── */}
            {kit && (
              <div id="demo-kit-results" className="mt-8 space-y-6">
                {/* analysis */}
                <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
                  <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
                    <Music2 className="h-5 w-5 text-primary" aria-hidden="true" />
                    {t("labelPitch.songAnalysis")}
                  </h3>
                  <p className="mb-4 border-l-2 border-primary/60 pl-4 text-[15px] italic leading-relaxed text-white/80">
                    &ldquo;{kit.analysis.oneLiner}&rdquo;
                  </p>
                  <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-xl bg-black/40 p-3">
                      <dt className="text-[11px] font-bold uppercase tracking-widest text-white/35">{t("labelPitch.analysisGenre")}</dt>
                      <dd className="mt-1 text-white/85">{kit.analysis.genre}</dd>
                    </div>
                    <div className="rounded-xl bg-black/40 p-3">
                      <dt className="text-[11px] font-bold uppercase tracking-widest text-white/35">{t("labelPitch.analysisMood")}</dt>
                      <dd className="mt-1 text-white/85">{kit.analysis.mood}</dd>
                    </div>
                    <div className="rounded-xl bg-black/40 p-3">
                      <dt className="text-[11px] font-bold uppercase tracking-widest text-white/35">{t("labelPitch.analysisEnergy")}</dt>
                      <dd className="mt-1 text-white/85">{kit.analysis.energy}/100 · {kit.analysis.tempoFeel}</dd>
                    </div>
                    <div className="rounded-xl bg-black/40 p-3">
                      <dt className="text-[11px] font-bold uppercase tracking-widest text-white/35">{t("labelPitch.analysisSoundsLike")}</dt>
                      <dd className="mt-1 text-white/85">{kit.analysis.comparableArtists.join(" · ") || "—"}</dd>
                    </div>
                  </dl>
                  {kit.analysis.labelFit.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/35">{t("labelPitch.bestLabelFit")}</p>
                      <div className="flex flex-wrap gap-2">
                        {kit.analysis.labelFit.map((f) => (
                          <span key={f} className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* submission email */}
                <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-lg font-bold">
                      <Mail className="h-5 w-5 text-primary" aria-hidden="true" />
                      {t("labelPitch.submissionEmailTitle")}
                    </h3>
                    <CopyButton text={`Subject: ${kit.submissionEmail.subject}\n\n${kit.submissionEmail.body}`} label={t("labelPitch.labelEmail")} />
                  </div>
                  <p className="mb-3 rounded-xl bg-black/40 p-3 text-sm font-semibold text-white/90">
                    <span className="text-white/40">{t("labelPitch.subjectLabel")}</span>{kit.submissionEmail.subject}
                  </p>
                  <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/75">
                    {kit.submissionEmail.body}
                  </p>
                </div>

                {/* one-sheet */}
                <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-lg font-bold">
                      <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
                      {t("labelPitch.oneSheetTitle")}
                    </h3>
                    <CopyButton text={kit.oneSheet} label={t("labelPitch.labelOneSheet")} />
                  </div>
                  <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/75">
                    {kit.oneSheet}
                  </p>
                </div>

                {/* follow-up */}
                <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-lg font-bold">
                      <Send className="h-5 w-5 text-primary" aria-hidden="true" />
                      {t("labelPitch.followUpTitle")}
                    </h3>
                    <CopyButton text={kit.followUp} label={t("labelPitch.labelFollowUp")} />
                  </div>
                  <p className="text-[15px] leading-relaxed text-white/75">{kit.followUp}</p>
                </div>

                {/* honesty disclaimer */}
                <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-5 text-sm leading-relaxed text-amber-200/90">
                  <AlertTriangle className="mb-2 h-4 w-4" aria-hidden="true" />
                  {kit.disclaimer}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ LABELS TAB ═══ */}
        {tab === "labels" && (
          <div className="relative mt-8">
            <div className="mb-6 rounded-2xl border border-sky-500/25 bg-sky-500/[0.06] p-4 text-sm leading-relaxed text-sky-200/90">
              <Building2 className="mb-2 h-4 w-4" aria-hidden="true" />
              {t("labelPitch.labelsDisclaimer")}
            </div>

            <div className="mb-6 flex flex-wrap gap-2">
              {GENRES.map((g) => (
                <button
                  key={g}
                  onClick={() => { setGenreFilter(g); loadLabels(g, typeFilter); }}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    genreFilter === g
                      ? "bg-primary text-black"
                      : "border border-white/10 bg-white/[0.03] text-white/55 hover:border-primary/40 hover:text-white"
                  }`}
                >
                  {t(`labelPitch.genres.${g}`)}
                </button>
              ))}
              <button
                onClick={() => { setGenreFilter("all"); loadLabels("all", typeFilter); }}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  genreFilter === "all"
                    ? "bg-primary text-black"
                    : "border border-white/10 bg-white/[0.03] text-white/55 hover:border-primary/40 hover:text-white"
                }`}
              >
                {t("labelPitch.allGenres")}
              </button>
            </div>

            <div className="mb-6 flex flex-wrap gap-2">
              {([
                { key: "all", label: t("labelPitch.typeAll") },
                { key: "major", label: t("labelPitch.typeMajors") },
                { key: "imprint", label: t("labelPitch.typeImprints") },
                { key: "indie", label: t("labelPitch.typeIndependents") },
              ] as const).map((tf) => (
                <button
                  key={tf.key}
                  onClick={() => { setTypeFilter(tf.key); loadLabels(genreFilter, tf.key); }}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    typeFilter === tf.key
                      ? "bg-white text-black"
                      : "border border-white/10 bg-white/[0.03] text-white/55 hover:border-white/40 hover:text-white"
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {labels.map((label) => {
                const tm = TYPE_META[label.type] ?? TYPE_META["indie"]!;
                return (
                  <div key={label.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-white">{label.name}</h3>
                        <p className="mt-0.5 text-xs text-white/40">{label.parent}</p>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${tm.cls}`}>
                        {tm.label}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-white/65">{label.knownFor}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {label.genres.map((g) => (
                        <span key={g} className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[11px] font-semibold text-white/55">
                          {g}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 rounded-xl border border-white/[0.07] bg-black/40 p-3.5">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-white/35">{t("labelPitch.howToSubmit")}</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-white/75">{label.submitVia}</p>
                    </div>
                  </div>
                );
              })}
              {labels.length === 0 && (
                <p className="py-10 text-center text-sm text-white/40">
                  {t("labelPitch.noLabelsMatch")}
                </p>
              )}
            </div>

            {labelNotice && (
              <p className="mt-6 text-center text-xs text-white/30">{labelNotice}</p>
            )}
          </div>
        )}

        {/* ═══ TRACKER TAB ═══ */}
        {tab === "tracker" && (
          <div className="relative mt-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold">{t("labelPitch.trackerTitle")}</h3>
                <p className="mt-1 text-sm text-white/45">
                  {submissions.length === 1
                    ? t("labelPitch.trackerOne", { count: submissions.length })
                    : t("labelPitch.trackerMany", { count: submissions.length })}
                  {signedCount > 0 && (
                    <span className="text-emerald-300">{t("labelPitch.signedSuffix", { count: signedCount })}</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("labelPitch.logSubmission")}
              </button>
            </div>

            {showAddForm && (
              <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <input
                    value={newSubmission.songTitle}
                    onChange={(e) => setNewSubmission({ ...newSubmission, songTitle: e.target.value })}
                    maxLength={200}
                    placeholder={t("labelPitch.songTitlePlaceholder")}
                    className={inputClass}
                  />
                  <input
                    value={newSubmission.labelName}
                    onChange={(e) => setNewSubmission({ ...newSubmission, labelName: e.target.value })}
                    maxLength={200}
                    placeholder={t("labelPitch.trackerLabelNamePlaceholder")}
                    className={inputClass}
                    list="tracker-label-names"
                  />
                  <datalist id="tracker-label-names">
                    {labels.map((l) => (
                      <option key={l.id} value={l.name} />
                    ))}
                  </datalist>
                  <input
                    value={newSubmission.artistName}
                    onChange={(e) => setNewSubmission({ ...newSubmission, artistName: e.target.value })}
                    maxLength={200}
                    placeholder={t("labelPitch.artistNamePlaceholder")}
                    className={`${inputClass} sm:col-span-2`}
                  />
                  <textarea
                    value={newSubmission.notes}
                    onChange={(e) => setNewSubmission({ ...newSubmission, notes: e.target.value })}
                    maxLength={1000}
                    rows={2}
                    placeholder={t("labelPitch.notesPlaceholder")}
                    className={`${inputClass} resize-y sm:col-span-2`}
                  />
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={addSubmission}
                    className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                  >
                    {t("labelPitch.save")}
                  </button>
                  <button
                    onClick={() => setShowAddForm(false)}
                    className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold text-white/60 transition hover:text-white"
                  >
                    {t("labelPitch.cancel")}
                  </button>
                </div>
              </div>
            )}

            {trackerLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-white/30" aria-hidden="true" />
              </div>
            ) : submissions.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center">
                <ClipboardList className="mx-auto mb-3 h-8 w-8 text-white/20" aria-hidden="true" />
                <p className="font-semibold text-white/60">{t("labelPitch.noSubmissions")}</p>
                <p className="mt-1 text-sm text-white/35">
                  {t("labelPitch.noSubmissionsHint")}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {submissions.map((s) => {
                  const meta = STATUS_META[s.status] ?? STATUS_META["sent"]!;
                  const Icon = meta.icon;
                  return (
                    <div key={s.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 md:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-bold text-white">{s.songTitle}</p>
                          <p className="mt-0.5 text-sm text-white/50">
                            → {s.labelName}
                            {s.artistName && <span className="text-white/30"> · {s.artistName}</span>}
                          </p>
                          {s.notes && (
                            <p className="mt-2 text-sm text-white/45">{s.notes}</p>
                          )}
                          {s.contactedAt && (
                            <p className="mt-1 text-xs text-white/30">
                              {t("labelPitch.sentOn", { date: new Date(s.contactedAt).toLocaleDateString() })}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${meta.cls}`}>
                            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            {meta.label}
                          </span>
                          <button
                            onClick={() => deleteSubmission(s.id)}
                            className="rounded-lg p-2 text-white/30 transition hover:bg-red-500/10 hover:text-red-300"
                            aria-label={t("labelPitch.deleteSubmissionAria")}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.07] pt-3">
                        {Object.entries(STATUS_META).map(([key, m]) => (
                          <button
                            key={key}
                            onClick={() => updateSubmissionStatus(s.id, key)}
                            className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition ${
                              s.status === key
                                ? m.cls + " border"
                                : "border border-white/10 text-white/35 hover:text-white"
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        </>
        )}

        {/* ═══ PLAYLISTS MODE — absorbed from /playlist-pitch ═══ */}
        {mode === "playlists" && (
          <PlaylistsPitchTab />
        )}
      </main>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   PLAYLISTS MODE — the full /playlist-pitch page, absorbed into label-pitch.
   AI helps musicians pitch songs to Spotify/editorial playlists:
   pick a song (library or manual) → AI analyzes it (genre, mood, energy,
   comparable artists) → generates a professional pitch email + DM version.
   Curator directory (free, starter list) + pitch tracker (free) included.

   Pricing: 2 credits per pitch kit. Tracker + curators are free.

   Deep links (kept from /playlist-pitch): ?song=TITLE pre-fills the song
   title; ?tab=sync opens the Sync Pitch Kit. Song-result pages still link
   to /playlist-pitch — the alias lands here and the parent flips mode. */

const PLAYLIST_KIT_COST = 2;

type PlaylistInnerTab = "kit" | "curators" | "tracker" | "sync";

const PLAYLIST_GENRES = [
  "hip-hop", "r&b", "pop", "edm", "rock", "indie", "country", "latin", "afrobeats",
];

interface PlaylistSongAnalysis {
  genre: string;
  mood: string;
  energy: number;
  tempoFeel: string;
  comparableArtists: string[];
  playlistFit: string[];
  oneLiner: string;
}

interface PlaylistPitchKit {
  analysis: PlaylistSongAnalysis;
  pitchEmail: { subject: string; body: string };
  dmPitch: string;
  followUp: string;
  disclaimer: string;
}

interface PlaylistLibrarySong {
  id: string;
  title?: string;
  audio_url?: string;
}

interface PlaylistCurator {
  id: string;
  name: string;
  platform: string;
  genres: string[];
  focus: string;
  submitVia: string;
}

interface PlaylistPitch {
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

const PLAYLIST_STATUS_META: Record<string, { labelKey: string; icon: typeof Send; cls: string }> = {
  sent: { labelKey: "playlistPitch.statusSent", icon: Send, cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  pending: { labelKey: "playlistPitch.statusPending", icon: Clock, cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  accepted: { labelKey: "playlistPitch.statusAccepted", icon: Trophy, cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  rejected: { labelKey: "playlistPitch.statusRejected", icon: XCircle, cls: "border-red-500/40 bg-red-500/10 text-red-300" },
};

function PlaylistCopyButton({ text, labelKey }: { text: string; labelKey: string }) {
  const { t } = useTranslation();
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
      aria-label={t("playlistPitch.copyAria", { label: t(labelKey) })}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t("playlistPitch.copied") : t("playlistPitch.copyLabel", { label: t(labelKey) })}
    </button>
  );
}

async function playlistAuthedFetch(
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

function PlaylistsPitchTab() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [tab, setTab] = useState<PlaylistInnerTab>("kit");

  /* ── pitch kit state ── */
  const [library, setLibrary] = useState<PlaylistLibrarySong[]>([]);
  const [songSource, setSongSource] = useState<"library" | "manual">("manual");
  const [librarySongId, setLibrarySongId] = useState("");
  const [songTitle, setSongTitle] = useState("");

  /* Deep-link protocol: /playlist-pitch?song=… pre-fills the song title
     (e.g. coming from a release plan); ?tab=sync opens the Sync Pitch Kit
     (e.g. "Pitch for sync" from song results). */
  const [syncInitialSong, setSyncInitialSong] = useState("");
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab")?.trim();
      if (tabParam === "sync") setTab("sync");
      const song = params.get("song")?.trim().slice(0, 200);
      if (song) {
        if (tabParam === "sync") setSyncInitialSong(song);
        else setSongTitle(song);
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch { /* non-browser — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const [kit, setKit] = useState<PlaylistPitchKit | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* ── curators state ── */
  const [genreFilter, setGenreFilter] = useState("all");
  const [curators, setCurators] = useState<PlaylistCurator[]>([]);
  const [curatorNotice, setCuratorNotice] = useState("");

  /* ── tracker state ── */
  const [pitches, setPitches] = useState<PlaylistPitch[]>([]);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPitch, setNewPitch] = useState({
    songTitle: "", artistName: "", curatorName: "", playlistName: "", notes: "",
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { res, data } = await playlistAuthedFetch(getAccessToken, "/api/songs");
        if (res.ok && Array.isArray((data as { songs?: unknown }).songs)) {
          setLibrary((data as { songs: PlaylistLibrarySong[] }).songs.slice(0, 100));
        }
      } catch { /* library is optional */ }
    })();
    loadCurators("all");
    loadTracker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function loadCurators(g: string) {
    try {
      const { res, data } = await playlistAuthedFetch(
        getAccessToken, `/api/playlist-pitch/curators?genre=${encodeURIComponent(g)}`,
      );
      if (res.ok) {
        setCurators((data as { curators: PlaylistCurator[] }).curators ?? []);
        setCuratorNotice((data as { notice: string }).notice ?? "");
      }
    } catch { /* non-fatal */ }
  }

  async function loadTracker() {
    setTrackerLoading(true);
    try {
      const { res, data } = await playlistAuthedFetch(getAccessToken, "/api/playlist-pitch/tracker");
      if (res.ok) setPitches((data as { pitches: PlaylistPitch[] }).pitches ?? []);
    } catch { /* non-fatal */ }
    finally { setTrackerLoading(false); }
  }

  async function generateKit() {
    if (generating || !user) return;
    const finalTitle = songSource === "library"
      ? (library.find((s) => s.id === librarySongId)?.title ?? "").trim()
      : songTitle.trim();
    if (!finalTitle) {
      setError(t("playlistPitch.titleRequired"));
      return;
    }
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const { res, data } = await playlistAuthedFetch(getAccessToken, "/api/playlist-pitch/kit", {
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
      if (!res.ok || !(data as { kit?: PlaylistPitchKit }).kit) {
        throw new Error(data.message || (typeof data.error === "string" ? data.error : "") || t("playlistPitch.kitFailed"));
      }
      setKit((data as { kit: PlaylistPitchKit }).kit);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("pitch-kit-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("playlistPitch.kitFailed"));
    } finally {
      setGenerating(false);
    }
  }

  async function addPitch() {
    if (!newPitch.songTitle.trim() || !newPitch.playlistName.trim()) {
      setError(t("playlistPitch.trackerRequired"));
      return;
    }
    setError(null);
    try {
      const { res, data } = await playlistAuthedFetch(getAccessToken, "/api/playlist-pitch/tracker", {
        method: "POST",
        body: JSON.stringify({
          songTitle: newPitch.songTitle.trim(),
          artistName: newPitch.artistName.trim(),
          curatorName: newPitch.curatorName.trim(),
          playlistName: newPitch.playlistName.trim(),
          notes: newPitch.notes.trim(),
        }),
      });
      if (!res.ok) throw new Error(t("playlistPitch.saveFailed"));
      const pitch = (data as { pitch: PlaylistPitch }).pitch;
      setPitches((prev) => [pitch, ...prev]);
      setNewPitch({ songTitle: "", artistName: "", curatorName: "", playlistName: "", notes: "" });
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("playlistPitch.saveFailed"));
    }
  }

  async function updatePitchStatus(id: string, status: string) {
    try {
      const { res, data } = await playlistAuthedFetch(getAccessToken, `/api/playlist-pitch/tracker/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(t("playlistPitch.updateFailed"));
      const updated = (data as { pitch: PlaylistPitch }).pitch;
      setPitches((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch { /* non-fatal */ }
  }

  async function deletePitch(id: string) {
    try {
      const { res } = await playlistAuthedFetch(getAccessToken, `/api/playlist-pitch/tracker/${id}`, {
        method: "DELETE",
      });
      if (res.ok) setPitches((prev) => prev.filter((p) => p.id !== id));
    } catch { /* non-fatal */ }
  }

  function addCuratorToTracker(c: PlaylistCurator) {
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
    <div className="relative">
      {/* hero */}
      <div className="relative text-center">
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
          <ListMusic className="h-3 w-3" aria-hidden="true" /> {t("playlistPitch.heroBadge")}
        </p>
        <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
          {t("playlistPitch.heroTitle")} <span className="text-primary">{t("playlistPitch.heroTitleAccent")}</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
          {t("playlistPitch.heroDescription")}
        </p>
      </div>

      {/* tabs */}
      <div className="relative mt-8 flex justify-center gap-2">
        {([
          { key: "kit", labelKey: "playlistPitch.tabKit", icon: Sparkles },
          { key: "sync", labelKey: "syncPitch.tabSync", icon: Clapperboard },
          { key: "curators", labelKey: "playlistPitch.tabCurators", icon: Users },
          { key: "tracker", labelKey: "playlistPitch.tabTracker", icon: ClipboardList },
        ] as { key: PlaylistInnerTab; labelKey: string; icon: typeof Sparkles }[]).map((tabItem) => {
          const Icon = tabItem.icon;
          const active = tab === tabItem.key;
          const label = tabItem.key === "tracker" && pitches.length
            ? t("playlistPitch.tabTrackerCount", { count: pitches.length })
            : t(tabItem.labelKey);
          return (
            <button
              key={tabItem.key}
              onClick={() => setTab(tabItem.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
                active
                  ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                  : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
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
              {t("playlistPitch.yourSong")}
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
                  {s === "manual" ? t("playlistPitch.enterManually") : t("playlistPitch.fromLibrary", { count: library.length })}
                </button>
              ))}
            </div>

            {songSource === "library" ? (
              <select
                value={librarySongId}
                onChange={(e) => setLibrarySongId(e.target.value)}
                className={`${inputClass} mt-4`}
              >
                <option value="">{t("playlistPitch.pickSong")}</option>
                {library.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title || t("playlistPitch.untitledSong")}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={songTitle}
                onChange={(e) => setSongTitle(e.target.value)}
                maxLength={200}
                placeholder={t("playlistPitch.songTitlePlaceholder")}
                className={`${inputClass} mt-4`}
              />
            )}

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input
                value={artistName}
                onChange={(e) => setArtistName(e.target.value)}
                maxLength={200}
                placeholder={t("playlistPitch.artistNamePlaceholder")}
                className={inputClass}
              />
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                maxLength={100}
                placeholder={t("playlistPitch.genrePlaceholder")}
                className={inputClass}
                list="playlists-pitch-genres"
              />
              <datalist id="playlists-pitch-genres">
                {PLAYLIST_GENRES.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                  {t("playlistPitch.energyLabel", { energy })}
                </label>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={energy}
                onChange={(e) => setEnergy(parseInt(e.target.value, 10))}
                className="mt-2 w-full accent-[#d4af37]"
                aria-label={t("playlistPitch.energyAria")}
              />
              <div className="flex justify-between text-[11px] text-white/35">
                <span>{t("playlistPitch.energyChill")}</span>
                <span>{t("playlistPitch.energyBalanced")}</span>
                <span>{t("playlistPitch.energyTurnt")}</span>
              </div>
            </div>

            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              {t("playlistPitch.advancedDetails")}
              <ChevronDown className={`h-4 w-4 transition ${showAdvanced ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <input
                    value={mood}
                    onChange={(e) => setMood(e.target.value)}
                    maxLength={200}
                    placeholder={t("playlistPitch.moodPlaceholder")}
                    className={inputClass}
                  />
                  <input
                    value={tempo}
                    onChange={(e) => setTempo(e.target.value)}
                    maxLength={50}
                    placeholder={t("playlistPitch.tempoPlaceholder")}
                    className={inputClass}
                  />
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder={t("playlistPitch.descriptionPlaceholder")}
                  className={`${inputClass} resize-y`}
                />
                <textarea
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  maxLength={5000}
                  rows={4}
                  placeholder={t("playlistPitch.lyricsPlaceholder")}
                  className={`${inputClass} resize-y`}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <input
                    value={curatorName}
                    onChange={(e) => setCuratorName(e.target.value)}
                    maxLength={200}
                    placeholder={t("playlistPitch.curatorNamePlaceholder")}
                    className={inputClass}
                  />
                  <input
                    value={playlistName}
                    onChange={(e) => setPlaylistName(e.target.value)}
                    maxLength={200}
                    placeholder={t("playlistPitch.playlistNamePlaceholder")}
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
              {generating ? t("playlistPitch.writingKit") : t("playlistPitch.generateKit", { cost: PLAYLIST_KIT_COST })}
            </button>
            {!user && (
              <p className="mt-3 text-center text-sm text-white/40">
                {t("playlistPitch.signInPrompt")}
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
                  {t("playlistPitch.songAnalysis")}
                </h2>
                <p className="mt-3 border-l-2 border-primary/60 pl-4 text-[15px] italic leading-relaxed text-white/85">
                  “{kit.analysis.oneLiner}”
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: t("playlistPitch.statGenre"), value: kit.analysis.genre },
                    { label: t("playlistPitch.statMood"), value: kit.analysis.mood },
                    { label: t("playlistPitch.statEnergy"), value: `${kit.analysis.energy}/100` },
                    { label: t("playlistPitch.statTempo"), value: kit.analysis.tempoFeel },
                  ].map((s) => (
                    <div key={s.label} className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">{s.label}</p>
                      <p className="mt-1 text-sm font-semibold text-white">{s.value}</p>
                    </div>
                  ))}
                </div>
                {kit.analysis.comparableArtists.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("playlistPitch.soundsLike")}</p>
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
                    <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("playlistPitch.playlistFit")}</p>
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
                    {t("playlistPitch.pitchEmail")}
                  </h2>
                  <PlaylistCopyButton text={`${t("playlistPitch.subjectPrefix")}${kit.pitchEmail.subject}\n\n${kit.pitchEmail.body}`} labelKey="playlistPitch.copyEmailLabel" />
                </div>
                <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-white/40">{t("playlistPitch.subjectLabel")}</p>
                <p className="mt-1 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm font-semibold text-white">
                  {kit.pitchEmail.subject}
                </p>
                <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-white/40">{t("playlistPitch.bodyLabel")}</p>
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
                      {t("playlistPitch.dmVersion")}
                    </h3>
                    <PlaylistCopyButton text={kit.dmPitch} labelKey="playlistPitch.copyDmLabel" />
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-white/75">{kit.dmPitch}</p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 font-black">
                      <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                      {t("playlistPitch.followUpTitle")}
                    </h3>
                    <PlaylistCopyButton text={kit.followUp} labelKey="playlistPitch.copyFollowUpLabel" />
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
            <span className="font-black text-amber-300">{t("playlistPitch.starterList")}</span>{" "}
            {curatorNotice || t("playlistPitch.curatorFallback")}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {["all", ...PLAYLIST_GENRES].map((g) => (
              <button
                key={g}
                onClick={() => { setGenreFilter(g); loadCurators(g); }}
                className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${
                  genreFilter === g
                    ? "bg-primary text-black"
                    : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                }`}
              >
                {g === "all" ? t("playlistPitch.allGenres") : g}
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
                  <span className="font-semibold text-white/70">{t("playlistPitch.howToSubmit")}</span>
                  {c.submitVia}
                </p>
                <button
                  onClick={() => addCuratorToTracker(c)}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition hover:bg-primary/20"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t("playlistPitch.addToTracker")}
                </button>
              </div>
            ))}
            {curators.length === 0 && (
              <p className="py-10 text-center text-sm text-white/40">
                {t("playlistPitch.noCurators")}
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
                <span className="font-black text-white">{pitches.length}</span> {t("playlistPitch.pitchesCount")}
              </span>
              <span className="text-white/50">
                <span className="font-black text-emerald-300">{acceptedCount}</span> {t("playlistPitch.acceptedCount")}
              </span>
            </div>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-black text-black transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("playlistPitch.logPitch")}
            </button>
          </div>

          {showAddForm && (
            <div className="mt-4 rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  value={newPitch.songTitle}
                  onChange={(e) => setNewPitch({ ...newPitch, songTitle: e.target.value })}
                  maxLength={200}
                  placeholder={t("playlistPitch.songTitlePlaceholder")}
                  className={inputClass}
                />
                <input
                  value={newPitch.playlistName}
                  onChange={(e) => setNewPitch({ ...newPitch, playlistName: e.target.value })}
                  maxLength={200}
                  placeholder={t("playlistPitch.playlistNamePlaceholder")}
                  className={inputClass}
                />
                <input
                  value={newPitch.artistName}
                  onChange={(e) => setNewPitch({ ...newPitch, artistName: e.target.value })}
                  maxLength={200}
                  placeholder={t("playlistPitch.artistNamePlaceholder")}
                  className={inputClass}
                />
                <input
                  value={newPitch.curatorName}
                  onChange={(e) => setNewPitch({ ...newPitch, curatorName: e.target.value })}
                  maxLength={200}
                  placeholder={t("playlistPitch.curatorNamePlaceholder")}
                  className={inputClass}
                />
              </div>
              <textarea
                value={newPitch.notes}
                onChange={(e) => setNewPitch({ ...newPitch, notes: e.target.value })}
                maxLength={1000}
                rows={2}
                placeholder={t("playlistPitch.notesPlaceholder")}
                className={`${inputClass} mt-3 resize-y`}
              />
              <div className="mt-4 flex gap-2">
                <button
                  onClick={addPitch}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  {t("playlistPitch.savePitch")}
                </button>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold text-white/60 transition hover:text-white"
                >
                  {t("playlistPitch.cancel")}
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
              const meta = PLAYLIST_STATUS_META[p.status] ?? PLAYLIST_STATUS_META["sent"]!;
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
                        {t(meta.labelKey)}
                      </span>
                      <button
                        onClick={() => deletePitch(p.id)}
                        className="rounded-lg p-1.5 text-white/30 transition hover:bg-red-500/10 hover:text-red-300"
                        aria-label={t("playlistPitch.deletePitch")}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(PLAYLIST_STATUS_META).map(([key, m]) => (
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
                        {t("playlistPitch.markStatus", { status: t(m.labelKey).toLowerCase() })}
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
                  {t("playlistPitch.noPitches")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ SYNC PITCH KIT TAB ═══ */}
      {tab === "sync" && (
        <SyncTab library={library} initialSongTitle={syncInitialSong} />
      )}
    </div>
  );
}
