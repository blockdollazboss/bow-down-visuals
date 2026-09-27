import { useEffect, useState } from "react";
import {
  Disc3, Sparkles, Loader2, Copy, Check, Mail, FileText,
  Building2, ClipboardList, Plus, Trash2, Send, Clock, Trophy, XCircle,
  AlertTriangle, Music2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

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

const STATUS_META: Record<string, { label: string; icon: typeof Send; cls: string }> = {
  sent: { label: "Sent", icon: Send, cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  pending: { label: "Pending", icon: Clock, cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  signed: { label: "Signed", icon: Trophy, cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  passed: { label: "Passed", icon: XCircle, cls: "border-red-500/40 bg-red-500/10 text-red-300" },
};

const TYPE_META: Record<string, { label: string; cls: string }> = {
  major: { label: "Major Label", cls: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300" },
  imprint: { label: "Imprint", cls: "border-purple-500/40 bg-purple-500/10 text-purple-300" },
  indie: { label: "Independent", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
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

export default function LabelPitch() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>("kit");

  /* ── demo kit state ── */
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
    const finalTitle = songSource === "library"
      ? (library.find((s) => s.id === librarySongId)?.title ?? "").trim()
      : songTitle.trim();
    if (!finalTitle) {
      setError("Give your song a title first — the demo package is built around it.");
      return;
    }
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
        }),
      });
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !(data as { kit?: DemoKit }).kit) {
        throw new Error(data.message || (typeof data.error === "string" ? data.error : "") || "Demo kit failed — try again.");
      }
      setKit((data as { kit: DemoKit }).kit);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("demo-kit-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo kit failed — try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function addSubmission() {
    if (!newSubmission.songTitle.trim() || !newSubmission.labelName.trim()) {
      setError("Song title and label name are required for a tracker entry.");
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
      if (!res.ok) throw new Error("Couldn't save that submission — try again.");
      const pitch = (data as { pitch: Submission }).pitch;
      setSubmissions((prev) => [pitch, ...prev]);
      setNewSubmission({ songTitle: "", artistName: "", labelName: "", notes: "" });
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that submission — try again.");
    }
  }

  async function updateSubmissionStatus(id: string, status: string) {
    try {
      const { res, data } = await authedFetch(getAccessToken, `/api/label-pitch/tracker/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Couldn't update that submission.");
      const updated = (data as { pitch: Submission }).pitch;
      setSubmissions((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that submission.");
    }
  }

  async function deleteSubmission(id: string) {
    if (!window.confirm("Delete this submission from your tracker?")) return;
    try {
      const { res } = await authedFetch(getAccessToken, `/api/label-pitch/tracker/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Couldn't delete that submission.");
      setSubmissions((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete that submission.");
    }
  }

  const signedCount = submissions.filter((p) => p.status === "signed").length;

  return (
    <div className="min-h-screen bg-black text-white">

      <main className="relative mx-auto max-w-4xl px-5 pb-24 pt-14 md:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Disc3 className="h-3 w-3" aria-hidden="true" /> Label Pitch
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Pitch Your Demo <span className="text-primary">Like a Pro</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            AI analyzes your song, then builds a professional demo submission
            package — the email, your one-sheet, and the follow-up. Labels
            rarely sign from cold demos, but the right package opens doors
            that talent alone can&rsquo;t.
          </p>
        </div>

        {/* tabs */}
        <div className="relative mt-8 flex justify-center gap-2">
          {([
            { key: "kit", label: "Demo Kit", icon: Sparkles },
            { key: "labels", label: "Labels", icon: Building2 },
            { key: "tracker", label: `Tracker${submissions.length ? ` (${submissions.length})` : ""}`, icon: ClipboardList },
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

        {/* ═══ DEMO KIT TAB ═══ */}
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
                  placeholder="Genre (e.g. Melodic Rap)"
                  className={inputClass}
                  list="label-genres"
                />
                <datalist id="label-genres">
                  {GENRES.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
                <input
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                  maxLength={200}
                  placeholder="Mood (e.g. dark, triumphant)"
                  className={inputClass}
                />
                <input
                  value={tempo}
                  onChange={(e) => setTempo(e.target.value)}
                  maxLength={50}
                  placeholder="Tempo (e.g. 140 BPM)"
                  className={inputClass}
                />
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                  Energy — {energy}/100
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
                placeholder="Describe the song — what it's about, what makes it special…"
                className={`${inputClass} mt-4 resize-y`}
              />

              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="mt-4 text-sm font-semibold text-white/50 transition hover:text-white"
              >
                {showAdvanced ? "− Hide" : "+ Add"} bio, stats &amp; lyrics (better package)
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-4">
                  <textarea
                    value={artistBio}
                    onChange={(e) => setArtistBio(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder="Artist bio — where you're from, your story, career highlights…"
                    className={`${inputClass} resize-y`}
                  />
                  <input
                    value={socialStats}
                    onChange={(e) => setSocialStats(e.target.value)}
                    maxLength={500}
                    placeholder="Social/streaming stats (e.g. 50K monthly listeners, 120K TikTok followers)"
                    className={inputClass}
                  />
                  <textarea
                    value={lyrics}
                    onChange={(e) => setLyrics(e.target.value)}
                    maxLength={5000}
                    rows={4}
                    placeholder="Lyrics (optional — helps the AI nail the themes)"
                    className={`${inputClass} resize-y`}
                  />
                </div>
              )}

              <div className="mt-6 border-t border-white/10 pt-6">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
                  Target label <span className="text-white/25 normal-case tracking-normal">(optional — personalizes the email)</span>
                </p>
                <input
                  value={labelName}
                  onChange={(e) => setLabelName(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. Def Jam, Atlantic, EMPIRE…"
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
                    Building your demo package…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-5 w-5" aria-hidden="true" />
                    Generate Demo Package — {CREDIT_COST} credits
                  </>
                )}
              </button>
              <p className="mt-3 text-center text-xs text-white/35">
                Includes song analysis, submission email, artist one-sheet &amp; follow-up template.
              </p>
            </div>

            {/* ── results ── */}
            {kit && (
              <div id="demo-kit-results" className="mt-8 space-y-6">
                {/* analysis */}
                <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
                  <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
                    <Music2 className="h-5 w-5 text-primary" aria-hidden="true" />
                    Song Analysis
                  </h3>
                  <p className="mb-4 border-l-2 border-primary/60 pl-4 text-[15px] italic leading-relaxed text-white/80">
                    &ldquo;{kit.analysis.oneLiner}&rdquo;
                  </p>
                  <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-xl bg-black/40 p-3">
                      <dt className="text-[11px] font-bold uppercase tracking-widest text-white/35">Genre</dt>
                      <dd className="mt-1 text-white/85">{kit.analysis.genre}</dd>
                    </div>
                    <div className="rounded-xl bg-black/40 p-3">
                      <dt className="text-[11px] font-bold uppercase tracking-widest text-white/35">Mood</dt>
                      <dd className="mt-1 text-white/85">{kit.analysis.mood}</dd>
                    </div>
                    <div className="rounded-xl bg-black/40 p-3">
                      <dt className="text-[11px] font-bold uppercase tracking-widest text-white/35">Energy</dt>
                      <dd className="mt-1 text-white/85">{kit.analysis.energy}/100 · {kit.analysis.tempoFeel}</dd>
                    </div>
                    <div className="rounded-xl bg-black/40 p-3">
                      <dt className="text-[11px] font-bold uppercase tracking-widest text-white/35">Sounds like</dt>
                      <dd className="mt-1 text-white/85">{kit.analysis.comparableArtists.join(" · ") || "—"}</dd>
                    </div>
                  </dl>
                  {kit.analysis.labelFit.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/35">Best label fit</p>
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
                      Submission Email
                    </h3>
                    <CopyButton text={`Subject: ${kit.submissionEmail.subject}\n\n${kit.submissionEmail.body}`} label="email" />
                  </div>
                  <p className="mb-3 rounded-xl bg-black/40 p-3 text-sm font-semibold text-white/90">
                    <span className="text-white/40">Subject: </span>{kit.submissionEmail.subject}
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
                      Artist One-Sheet
                    </h3>
                    <CopyButton text={kit.oneSheet} label="one-sheet" />
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
                      Follow-Up Template
                    </h3>
                    <CopyButton text={kit.followUp} label="follow-up" />
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
              Starter list — verify each label&rsquo;s current submission policy before
              sending anything. Major labels almost never accept unsolicited demos;
              relationships and referrals matter most. We never list private emails —
              only real submission channels.
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
                  {g}
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
                all genres
              </button>
            </div>

            <div className="mb-6 flex flex-wrap gap-2">
              {([
                { key: "all", label: "All types" },
                { key: "major", label: "Majors" },
                { key: "imprint", label: "Imprints" },
                { key: "indie", label: "Independents" },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  onClick={() => { setTypeFilter(t.key); loadLabels(genreFilter, t.key); }}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    typeFilter === t.key
                      ? "bg-white text-black"
                      : "border border-white/10 bg-white/[0.03] text-white/55 hover:border-white/40 hover:text-white"
                  }`}
                >
                  {t.label}
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
                      <p className="text-[11px] font-bold uppercase tracking-widest text-white/35">How to submit</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-white/75">{label.submitVia}</p>
                    </div>
                  </div>
                );
              })}
              {labels.length === 0 && (
                <p className="py-10 text-center text-sm text-white/40">
                  No labels match that filter — try widening it.
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
                <h3 className="text-lg font-bold">Submission Tracker</h3>
                <p className="mt-1 text-sm text-white/45">
                  {submissions.length} submission{submissions.length === 1 ? "" : "s"}
                  {signedCount > 0 && (
                    <span className="text-emerald-300"> · {signedCount} signed</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Log submission
              </button>
            </div>

            {showAddForm && (
              <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <input
                    value={newSubmission.songTitle}
                    onChange={(e) => setNewSubmission({ ...newSubmission, songTitle: e.target.value })}
                    maxLength={200}
                    placeholder="Song title *"
                    className={inputClass}
                  />
                  <input
                    value={newSubmission.labelName}
                    onChange={(e) => setNewSubmission({ ...newSubmission, labelName: e.target.value })}
                    maxLength={200}
                    placeholder="Label name *"
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
                    placeholder="Artist name"
                    className={`${inputClass} sm:col-span-2`}
                  />
                  <textarea
                    value={newSubmission.notes}
                    onChange={(e) => setNewSubmission({ ...newSubmission, notes: e.target.value })}
                    maxLength={1000}
                    rows={2}
                    placeholder="Notes (contact name, how you sent it…)"
                    className={`${inputClass} resize-y sm:col-span-2`}
                  />
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={addSubmission}
                    className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                  >
                    Save
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

            {trackerLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-white/30" aria-hidden="true" />
              </div>
            ) : submissions.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center">
                <ClipboardList className="mx-auto mb-3 h-8 w-8 text-white/20" aria-hidden="true" />
                <p className="font-semibold text-white/60">No submissions logged yet</p>
                <p className="mt-1 text-sm text-white/35">
                  Generate a demo kit, send it out, then log it here to track your pipeline.
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
                              Sent {new Date(s.contactedAt).toLocaleDateString()}
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
                            aria-label="Delete submission"
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
      </main>
    </div>
  );
}
