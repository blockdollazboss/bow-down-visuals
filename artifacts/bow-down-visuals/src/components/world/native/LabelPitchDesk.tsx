import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Building2, Check, ClipboardList, Copy, Disc3, ListMusic, Loader2,
  Mail, Plus, Sparkles, Trash2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import { useDeskAuthHeaders, deskInputCls } from "./CreateDeskLeaf";
import {
  LABEL_PITCH_GENRES,
  LABEL_PITCH_KIT_COST_VISUAL_BUCS,
  LABEL_PITCH_KIT_PATH,
  LABEL_PITCH_STATUSES,
  PLAYLIST_DEADLINE_STATUSES,
  PLAYLIST_PITCH_GENRES,
  PLAYLIST_PITCH_KIT_COST_VISUAL_BUCS,
  PLAYLIST_PITCH_KIT_PATH,
  PLAYLIST_PITCH_STATUSES,
  buildDeadlinePayload,
  buildLabelKitPayload,
  buildLabelSubmissionPayload,
  buildPlaylistKitPayload,
  buildPlaylistPitchPayload,
  deadlineReady,
  labelKitReady,
  labelPitchLabelsPath,
  labelPitchTrackerItemPath,
  labelSubmissionReady,
  packetAsText,
  packetMissingLabel,
  parseCuratorDirectory,
  parseDeadlineBoard,
  parseLabelDirectory,
  parseLabelKit,
  parseLabelSubmissionAnswer,
  parseLabelTracker,
  parseLibrarySongs,
  parsePitchPacket,
  parsePitchReleases,
  parsePlaylistKit,
  parsePlaylistPitchAnswer,
  parsePlaylistTracker,
  playlistKitReady,
  playlistPitchCuratorsPath,
  playlistPitchDeadlineItemPath,
  playlistPitchPacketPath,
  playlistPitchReady,
  playlistPitchTrackerItemPath,
  LABEL_PITCH_TRACKER_PATH,
  PLAYLIST_PITCH_DEADLINES_PATH,
  PLAYLIST_PITCH_RELEASES_PATH,
  PLAYLIST_PITCH_TRACKER_PATH,
  type LabelEntry,
  type LabelKit,
  type LabelSubmission,
  type LibrarySong,
  type PitchDeadline,
  type PitchPacket,
  type PitchRelease,
  type PlaylistCurator,
  type PlaylistKit,
  type PlaylistPitch,
} from "@/lib/world/label-pitch-desk";

/* ─── Label Pitch, in-world (stack1400 world parity, wave #1 item 2) ──
   The Label Pitch family native at the Promote Room, stacked under
   the Promote Desk — on the 2D page's own rails end to end (see
   lib/world/label-pitch-desk for the rail map): pick a song from
   your library (or name it), build the label demo kit (300 VB) or
   the playlist pitch kit (200 VB), browse the free label / curator
   directories, log and move pitches in the free trackers, and build
   the pitch packet from a real release record — plus its submission
   deadlines. Everything completes here: no page pull-up, no exit to
   /label-pitch (the frame's one transfer footer is the host's).

   CHARGES: the two kits ride useConfirmedApi with their rail costs
   as explicit overrides (300 / 200 VB — the server constants), so
   the member confirms the exact price before anything is charged,
   exactly as on the website. Everything else is free, as on the
   website. Failed generations are refunded by the rail itself and
   the desk says so. */

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";

const chipBtn = (isLight: boolean, active = false) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    active
      ? "border-[#d4af37] bg-[#d4af37] text-black"
      : isLight
        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
        : "border-white/15 text-white/75 hover:text-white"
  }`;

const selectCls = (isLight: boolean) =>
  `rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]"
      : "border-white/10 bg-white/5 text-white/80"
  }`;

function GuestGate({ isLight }: { isLight: boolean }) {
  return (
    <NativeCard isLight={isLight} title="Label Pitch — pitch labels & playlists">
      <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        The pitch desk works on your own songs, your own kits and your own tracker — guests can
        look around the palace, but this desk only opens for members.{" "}
        <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">
          Sign in
        </Link>{" "}
        and the desk is yours, right here in the room.
      </p>
    </NativeCard>
  );
}

function CopyTextButton({ text, label, isLight }: { text: string; label: string; isLight: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={chipBtn(isLight)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch { /* clipboard unavailable — the text stays on screen to copy by hand */ }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

/** Two-tap delete, the Promote Desk's history-card shape: first tap
 *  arms, second tap deletes — no window.confirm inside the palace. */
function DeleteButton({
  armed,
  onArm,
  onDelete,
  label,
}: {
  armed: boolean;
  onArm: () => void;
  onDelete: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => (armed ? onDelete() : onArm())}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition bdv-touch-target ${
        armed
          ? "border-red-400/60 bg-red-500/15 text-red-300"
          : "border-white/15 text-white/50 hover:text-white"
      }`}
    >
      <Trash2 className="h-3.5 w-3.5" /> {armed ? "Tap again to delete" : "Delete"}
    </button>
  );
}

function StatusRow({
  statuses,
  current,
  onPick,
  isLight,
}: {
  statuses: readonly string[];
  current: string;
  onPick: (status: string) => void;
  isLight: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {statuses.map((s) => (
        <button
          key={s}
          type="button"
          disabled={s === current}
          onClick={() => onPick(s)}
          className={chipBtn(isLight, s === current)}
        >
          {s === current ? `${s} · now` : `Mark ${s.replace(/_/g, " ")}`}
        </button>
      ))}
    </div>
  );
}

function AnalysisBlock({ kit, fitLabel, isLight }: { kit: LabelKit | PlaylistKit; fitLabel: string; isLight: boolean }) {
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const a = kit.analysis;
  return (
    <div className="space-y-2">
      <p className={`border-l-2 border-[#d4af37]/60 pl-3 text-sm italic ${strong}`}>“{a.oneLiner}”</p>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <span className={`text-xs ${muted}`}>Genre: <span className={strong}>{a.genre || "—"}</span></span>
        <span className={`text-xs ${muted}`}>Mood: <span className={strong}>{a.mood || "—"}</span></span>
        <span className={`text-xs ${muted}`}>Energy: <span className={strong}>{a.energy}/100 · {a.tempoFeel}</span></span>
      </div>
      {a.comparableArtists.length > 0 ? (
        <p className={`text-xs ${muted}`}>Sounds like: {a.comparableArtists.join(" · ")}</p>
      ) : null}
      {a.fit.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-[11px] font-bold uppercase tracking-wider ${muted}`}>{fitLabel}</span>
          {a.fit.map((f) => (
            <span key={f} className="rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#e8c86a]">
              {f}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SongPicker({
  isLight,
  library,
  source,
  setSource,
  librarySongId,
  setLibrarySongId,
  songTitle,
  setSongTitle,
}: {
  isLight: boolean;
  library: LibrarySong[];
  source: "library" | "manual";
  setSource: (s: "library" | "manual") => void;
  librarySongId: string;
  setLibrarySongId: (v: string) => void;
  songTitle: string;
  setSongTitle: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={chipBtn(isLight, source === "library")} onClick={() => setSource("library")}>
          From my library{library.length ? ` (${library.length})` : ""}
        </button>
        <button type="button" className={chipBtn(isLight, source === "manual")} onClick={() => setSource("manual")}>
          Type the title
        </button>
      </div>
      {source === "library" ? (
        <select aria-label="Library song" className={`${selectCls(isLight)} w-full`} value={librarySongId} onChange={(e) => setLibrarySongId(e.target.value)}>
          <option value="">Pick a song…</option>
          {library.map((s) => (
            <option key={s.id} value={s.id}>{s.title || "Untitled song"}</option>
          ))}
        </select>
      ) : (
        <input aria-label="Song title" className={deskInputCls(isLight)} value={songTitle} maxLength={200} onChange={(e) => setSongTitle(e.target.value)} placeholder="Song title" />
      )}
    </div>
  );
}

function useLibrarySongs(isGuest: boolean) {
  const authHeaders = useDeskAuthHeaders();
  const [library, setLibrary] = useState<LibrarySong[]>([]);
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/songs", { headers: await authHeaders() });
        if (!res.ok) return;
        const songs = parseLibrarySongs(await res.json());
        if (!cancelled) setLibrary(songs);
      } catch { /* the library is optional — manual entry stands either way */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);
  return library;
}

function pickedTitle(source: "library" | "manual", library: LibrarySong[], librarySongId: string, songTitle: string): string {
  return source === "library"
    ? (library.find((s) => s.id === librarySongId)?.title ?? "").trim()
    : songTitle.trim();
}

/* ═══ Labels mode ══════════════════════════════════════════════════ */

function LabelsMode({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const library = useLibrarySongs(isGuest);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  /* kit form */
  const [source, setSource] = useState<"library" | "manual">("manual");
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
  const [labelName, setLabelName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [kit, setKit] = useState<LabelKit | null>(null);
  const [generating, setGenerating] = useState(false);
  const [kitError, setKitError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* directory */
  const [genreFilter, setGenreFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [labels, setLabels] = useState<LabelEntry[] | null>(null);
  const [labelNotice, setLabelNotice] = useState("");
  const [labelsFailed, setLabelsFailed] = useState(false);
  const [labelsTick, setLabelsTick] = useState(0);

  /* tracker */
  const [submissions, setSubmissions] = useState<LabelSubmission[] | null>(null);
  const [trackerFailed, setTrackerFailed] = useState(false);
  const [trackerTick, setTrackerTick] = useState(0);
  const [trackerNote, setTrackerNote] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ songTitle: "", artistName: "", labelName: "", notes: "" });
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    setLabelsFailed(false);
    (async () => {
      try {
        const res = await fetch(labelPitchLabelsPath(genreFilter, typeFilter), { headers: await authHeaders() });
        if (!res.ok) throw new Error("labels");
        const parsed = parseLabelDirectory(await res.json());
        if (!parsed) throw new Error("labels shape");
        if (!cancelled) { setLabels(parsed.labels); setLabelNotice(parsed.notice); }
      } catch { if (!cancelled) setLabelsFailed(true); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, genreFilter, typeFilter, labelsTick]);

  const loadTracker = async () => {
    try {
      const res = await fetch(LABEL_PITCH_TRACKER_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("tracker");
      const parsed = parseLabelTracker(await res.json());
      if (!parsed) throw new Error("tracker shape");
      setSubmissions(parsed);
      setTrackerFailed(false);
    } catch { setTrackerFailed(true); }
  };
  useEffect(() => {
    if (isGuest) return;
    void loadTracker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, trackerTick]);

  const generateKit = async () => {
    const finalTitle = pickedTitle(source, library, librarySongId, songTitle);
    if (generating || !labelKitReady({ songTitle: finalTitle })) return;
    setGenerating(true);
    setKitError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(LABEL_PITCH_KIT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: LABEL_PITCH_KIT_COST_VISUAL_BUCS,
        overrideFeature: "Label Pitch Demo Kit",
        body: JSON.stringify(buildLabelKitPayload({
          songTitle: finalTitle, artistName, genre, mood, energy, tempo,
          description, lyrics, artistBio, socialStats, labelName,
        })),
      });
      if (!res) return; /* declined the confirmation — nothing charged */
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) { setOutOfCredits(true); refreshProfile(); return; }
      const parsed = parseLabelKit(data);
      if (!res.ok || !parsed) {
        setKitError("The demo kit didn't come together — a failed kit is refunded by the rail. Try again.");
        return;
      }
      setKit(parsed);
      refreshProfile();
    } catch {
      setKitError("The pitch desk didn't answer. Try again.");
    } finally { setGenerating(false); }
  };

  const addSubmission = async () => {
    if (!labelSubmissionReady(draft)) { setTrackerNote("A submission needs a song title and a label name."); return; }
    setTrackerNote(null);
    try {
      const res = await fetch(LABEL_PITCH_TRACKER_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildLabelSubmissionPayload(draft)),
      });
      if (!res.ok) throw new Error("save");
      const row = parseLabelSubmissionAnswer(await res.json());
      if (!row) throw new Error("save shape");
      setSubmissions((prev) => [row, ...(prev ?? [])]);
      setDraft({ songTitle: "", artistName: "", labelName: "", notes: "" });
      setShowAdd(false);
    } catch { setTrackerNote("That submission didn't save. Try again."); }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(labelPitchTrackerItemPath(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("update");
      const row = parseLabelSubmissionAnswer(await res.json());
      if (!row) throw new Error("update shape");
      setSubmissions((prev) => (prev ?? []).map((p) => (p.id === id ? row : p)));
    } catch { setTrackerNote("That status didn't save. Try again."); }
  };

  const deleteSubmission = async (id: string) => {
    setArmedDeleteId(null);
    try {
      const res = await fetch(labelPitchTrackerItemPath(id), { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) throw new Error("delete");
      setSubmissions((prev) => (prev ?? []).filter((p) => p.id !== id));
    } catch { setTrackerNote("That submission couldn't be removed — it's still on your tracker. Try again."); }
  };

  return (
    <div className="space-y-3">
      <NativeCard isLight={isLight} title="Demo kit — pitch a label">
        <div className="space-y-3">
          <SongPicker isLight={isLight} library={library} source={source} setSource={setSource} librarySongId={librarySongId} setLibrarySongId={setLibrarySongId} songTitle={songTitle} setSongTitle={setSongTitle} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input aria-label="Artist name" className={deskInputCls(isLight)} value={artistName} maxLength={200} onChange={(e) => setArtistName(e.target.value)} placeholder="Artist name" />
            <input aria-label="Genre" className={deskInputCls(isLight)} value={genre} maxLength={100} onChange={(e) => setGenre(e.target.value)} placeholder="Genre (hip-hop, r&b, pop…)" />
            <input aria-label="Mood" className={deskInputCls(isLight)} value={mood} maxLength={200} onChange={(e) => setMood(e.target.value)} placeholder="Mood" />
            <input aria-label="Tempo" className={deskInputCls(isLight)} value={tempo} maxLength={50} onChange={(e) => setTempo(e.target.value)} placeholder="Tempo feel" />
          </div>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-wider ${muted}`}>Energy — {energy}/100</span>
            <input aria-label="Energy" type="range" min={0} max={100} value={energy} onChange={(e) => setEnergy(Number(e.target.value))} className="w-full accent-[#d4af37] bdv-touch-target" />
          </label>
          <textarea aria-label="Song description" className={deskInputCls(isLight)} value={description} maxLength={1000} rows={2} onChange={(e) => setDescription(e.target.value)} placeholder="What is this song? (optional)" />
          <input aria-label="Target label" className={deskInputCls(isLight)} value={labelName} maxLength={200} onChange={(e) => setLabelName(e.target.value)} placeholder="Target label (optional — the email personalizes to it)" />
          <button type="button" className={`text-xs font-bold bdv-touch-target ${muted}`} aria-expanded={showAdvanced} onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "Hide advanced details" : "Advanced details — bio, stats, lyrics"}
          </button>
          {showAdvanced ? (
            <div className="space-y-2">
              <textarea aria-label="Artist bio" className={deskInputCls(isLight)} value={artistBio} maxLength={2000} rows={2} onChange={(e) => setArtistBio(e.target.value)} placeholder="Artist bio (optional)" />
              <input aria-label="Social and streaming stats" className={deskInputCls(isLight)} value={socialStats} maxLength={500} onChange={(e) => setSocialStats(e.target.value)} placeholder="Social / streaming stats (optional)" />
              <textarea aria-label="Lyrics" className={deskInputCls(isLight)} value={lyrics} maxLength={5000} rows={3} onChange={(e) => setLyrics(e.target.value)} placeholder="Lyrics (optional — analyzed for themes)" />
            </div>
          ) : null}
          {kitError ? <p className="text-xs font-semibold text-red-400">{kitError}</p> : null}
          {outOfCredits ? <p className="text-xs font-semibold text-red-400">Out of Visual Bucs — top up and the demo kit maker is ready again.</p> : null}
          <button type="button" data-testid="world-label-pitch-generate" className={goldBtn} disabled={generating || !labelKitReady({ songTitle: pickedTitle(source, library, librarySongId, songTitle) })} onClick={() => void generateKit()}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generating ? "Building your package…" : `Build my demo kit — ${LABEL_PITCH_KIT_COST_VISUAL_BUCS} Visual Bucs`}
          </button>
          <p className={`text-[11px] ${muted}`}>Song analysis, submission email, artist one-sheet and a follow-up — confirmed before it charges, refunded if it fails.</p>
        </div>
        {kit ? (
          <div className="mt-4 space-y-4" data-testid="world-label-pitch-kit-result">
            <AnalysisBlock kit={kit} fitLabel="Best label fit" isLight={isLight} />
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider ${strong}`}><Mail className="h-3.5 w-3.5 text-[#d4af37]" /> Submission email</p>
                <CopyTextButton isLight={isLight} label="Copy email" text={`Subject: ${kit.emailSubject}\n\n${kit.emailBody}`} />
              </div>
              <p className={`text-sm font-semibold ${strong}`}>{kit.emailSubject}</p>
              <p className={`mt-1 whitespace-pre-wrap text-sm ${muted}`}>{kit.emailBody}</p>
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className={`text-xs font-black uppercase tracking-wider ${strong}`}>Artist one-sheet</p>
                <CopyTextButton isLight={isLight} label="Copy one-sheet" text={kit.oneSheet} />
              </div>
              <p className={`whitespace-pre-wrap text-sm ${muted}`}>{kit.oneSheet}</p>
            </div>
            {kit.followUp ? (
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className={`text-xs font-black uppercase tracking-wider ${strong}`}>Follow-up</p>
                  <CopyTextButton isLight={isLight} label="Copy follow-up" text={kit.followUp} />
                </div>
                <p className={`text-sm ${muted}`}>{kit.followUp}</p>
              </div>
            ) : null}
            {kit.disclaimer ? <p className={`rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs ${muted}`}>{kit.disclaimer}</p> : null}
          </div>
        ) : null}
      </NativeCard>

      <NativeCard isLight={isLight} title="Label directory — free">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {["all", ...LABEL_PITCH_GENRES].map((g) => (
            <button key={g} type="button" className={chipBtn(isLight, genreFilter === g)} onClick={() => setGenreFilter(g)}>{g === "all" ? "All genres" : g}</button>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(["all", "major", "imprint", "indie"] as const).map((tp) => (
            <button key={tp} type="button" className={chipBtn(isLight, typeFilter === tp)} onClick={() => setTypeFilter(tp)}>{tp === "all" ? "All types" : `${tp}s`}</button>
          ))}
        </div>
        {labelsFailed ? (
          <NativeErrorState isLight={isLight} title="The label directory wouldn't open" message="The directory is safe on the real rails — it just didn't answer. Try again." onRetry={() => setLabelsTick((n) => n + 1)} />
        ) : labels === null ? (
          <NativeLoadingState isLight={isLight} message="Opening the label directory…" />
        ) : labels.length === 0 ? (
          <NativeEmptyState isLight={isLight} message="No labels match that filter." detail="Widen the genre or type — the starter list is small and honest." />
        ) : (
          <div className="space-y-2">
            {labels.map((l) => (
              <div key={l.id} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={`text-sm font-black ${strong}`}>{l.name}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${muted}`}>{l.type}</span>
                </div>
                <p className={`text-[11px] ${muted}`}>{l.parent}</p>
                <p className={`mt-1 text-xs ${muted}`}>{l.knownFor}</p>
                {l.genres.length ? <p className={`mt-1 text-[11px] ${muted}`}>{l.genres.join(" · ")}</p> : null}
                <p className={`mt-1.5 text-xs ${strong}`}>How to submit: <span className={muted}>{l.submitVia}</span></p>
                <button type="button" className={`${chipBtn(isLight)} mt-2`} onClick={() => { setLabelName(l.name); setDraft((d) => ({ ...d, labelName: l.name })); }}>
                  Pitch {l.name}
                </button>
              </div>
            ))}
          </div>
        )}
        {labelNotice ? <p className={`mt-2 text-[11px] ${muted}`}>{labelNotice}</p> : null}
      </NativeCard>

      <NativeCard isLight={isLight} title="Submission tracker — free">
        {trackerFailed ? (
          <NativeErrorState isLight={isLight} title="Your pitch tracker wouldn't open" message="Your logged pitches are safe — the tracker just didn't answer. Try again." onRetry={() => setTrackerTick((n) => n + 1)} />
        ) : submissions === null ? (
          <NativeLoadingState isLight={isLight} message="Opening your tracker…" />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={`text-xs ${muted}`}>
                {submissions.length} logged{submissions.filter((s) => s.status === "signed").length > 0 ? ` · ${submissions.filter((s) => s.status === "signed").length} signed` : ""}
              </p>
              <button type="button" className={chipBtn(isLight, showAdd)} aria-expanded={showAdd} onClick={() => setShowAdd((v) => !v)}>
                <Plus className="h-3.5 w-3.5" /> Log a submission
              </button>
            </div>
            {showAdd ? (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input aria-label="Song title" className={deskInputCls(isLight)} value={draft.songTitle} maxLength={200} onChange={(e) => setDraft({ ...draft, songTitle: e.target.value })} placeholder="Song title" />
                  <input aria-label="Label name" className={deskInputCls(isLight)} value={draft.labelName} maxLength={200} onChange={(e) => setDraft({ ...draft, labelName: e.target.value })} placeholder="Label name" />
                  <input aria-label="Artist name" className={deskInputCls(isLight)} value={draft.artistName} maxLength={200} onChange={(e) => setDraft({ ...draft, artistName: e.target.value })} placeholder="Artist name (optional)" />
                  <input aria-label="Notes" className={deskInputCls(isLight)} value={draft.notes} maxLength={1000} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Notes (optional)" />
                </div>
                <button type="button" className={goldBtn} onClick={() => void addSubmission()}>Save submission — free</button>
              </div>
            ) : null}
            {trackerNote ? <p className="text-xs font-semibold text-red-400">{trackerNote}</p> : null}
            {submissions.length === 0 ? (
              <NativeEmptyState isLight={isLight} message="No submissions logged yet." detail="Build a kit above, send it, and log it here — the tracker keeps the whole outreach in one place." />
            ) : (
              submissions.map((s) => (
                <div key={s.id} className={`space-y-2 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-black ${strong}`}>{s.songTitle}</p>
                      <p className={`text-xs ${muted}`}>→ {s.labelName}{s.artistName ? ` · ${s.artistName}` : ""}{s.contactedAt ? ` · sent ${new Date(s.contactedAt).toLocaleDateString()}` : ""}</p>
                      {s.notes ? <p className={`mt-1 text-xs ${muted}`}>{s.notes}</p> : null}
                    </div>
                    <DeleteButton armed={armedDeleteId === s.id} onArm={() => setArmedDeleteId(s.id)} onDelete={() => void deleteSubmission(s.id)} label={`Delete submission ${s.songTitle}`} />
                  </div>
                  <StatusRow isLight={isLight} statuses={LABEL_PITCH_STATUSES} current={s.status} onPick={(st) => void updateStatus(s.id, st)} />
                </div>
              ))
            )}
          </div>
        )}
      </NativeCard>
    </div>
  );
}

/* ═══ Playlists mode ═══════════════════════════════════════════════ */

function PlaylistsMode({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const library = useLibrarySongs(isGuest);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  /* kit form */
  const [source, setSource] = useState<"library" | "manual">("manual");
  const [librarySongId, setLibrarySongId] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [energy, setEnergy] = useState(60);
  const [tempo, setTempo] = useState("");
  const [description, setDescription] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [curatorName, setCuratorName] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [kit, setKit] = useState<PlaylistKit | null>(null);
  const [generating, setGenerating] = useState(false);
  const [kitError, setKitError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* curators */
  const [genreFilter, setGenreFilter] = useState("all");
  const [curators, setCurators] = useState<PlaylistCurator[] | null>(null);
  const [curatorNotice, setCuratorNotice] = useState("");
  const [curatorsFailed, setCuratorsFailed] = useState(false);
  const [curatorsTick, setCuratorsTick] = useState(0);

  /* tracker */
  const [pitches, setPitches] = useState<PlaylistPitch[] | null>(null);
  const [trackerFailed, setTrackerFailed] = useState(false);
  const [trackerTick, setTrackerTick] = useState(0);
  const [trackerNote, setTrackerNote] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ songTitle: "", artistName: "", curatorName: "", playlistName: "", notes: "" });
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);

  /* packet + deadlines */
  const [releases, setReleases] = useState<PitchRelease[] | null>(null);
  const [releasesFailed, setReleasesFailed] = useState(false);
  const [releasesTick, setReleasesTick] = useState(0);
  const [packetReleaseId, setPacketReleaseId] = useState("");
  const [packet, setPacket] = useState<PitchPacket | null>(null);
  const [packetLoading, setPacketLoading] = useState(false);
  const [packetFailed, setPacketFailed] = useState(false);
  const [deadlines, setDeadlines] = useState<PitchDeadline[] | null>(null);
  const [dueNext, setDueNext] = useState<PitchDeadline | null>(null);
  const [deadlinesFailed, setDeadlinesFailed] = useState(false);
  const [deadlinesTick, setDeadlinesTick] = useState(0);
  const [deadlineNote, setDeadlineNote] = useState<string | null>(null);
  const [showDeadlineForm, setShowDeadlineForm] = useState(false);
  const [deadlineDraft, setDeadlineDraft] = useState({ playlistName: "", curatorName: "", deadlineDate: "", releaseId: "" });
  const [armedDeadlineId, setArmedDeadlineId] = useState<string | null>(null);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    setCuratorsFailed(false);
    (async () => {
      try {
        const res = await fetch(playlistPitchCuratorsPath(genreFilter), { headers: await authHeaders() });
        if (!res.ok) throw new Error("curators");
        const parsed = parseCuratorDirectory(await res.json());
        if (!parsed) throw new Error("curators shape");
        if (!cancelled) { setCurators(parsed.curators); setCuratorNotice(parsed.notice); }
      } catch { if (!cancelled) setCuratorsFailed(true); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, genreFilter, curatorsTick]);

  const loadTracker = async () => {
    try {
      const res = await fetch(PLAYLIST_PITCH_TRACKER_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("tracker");
      const parsed = parsePlaylistTracker(await res.json());
      if (!parsed) throw new Error("tracker shape");
      setPitches(parsed);
      setTrackerFailed(false);
    } catch { setTrackerFailed(true); }
  };
  useEffect(() => {
    if (isGuest) return;
    void loadTracker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, trackerTick]);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    setReleasesFailed(false);
    (async () => {
      try {
        const res = await fetch(PLAYLIST_PITCH_RELEASES_PATH, { headers: await authHeaders() });
        if (!res.ok) throw new Error("releases");
        const parsed = parsePitchReleases(await res.json());
        if (!parsed) throw new Error("releases shape");
        if (!cancelled) setReleases(parsed);
      } catch { if (!cancelled) setReleasesFailed(true); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, releasesTick]);

  const loadDeadlines = async () => {
    try {
      const res = await fetch(PLAYLIST_PITCH_DEADLINES_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("deadlines");
      const parsed = parseDeadlineBoard(await res.json());
      if (!parsed) throw new Error("deadlines shape");
      setDeadlines(parsed.deadlines);
      setDueNext(parsed.dueNext);
      setDeadlinesFailed(false);
    } catch { setDeadlinesFailed(true); }
  };
  useEffect(() => {
    if (isGuest) return;
    void loadDeadlines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, deadlinesTick]);

  const loadPacket = async (releaseId: string) => {
    setPacketReleaseId(releaseId);
    if (!releaseId) { setPacket(null); setPacketFailed(false); return; }
    setPacketLoading(true);
    setPacketFailed(false);
    try {
      const res = await fetch(playlistPitchPacketPath(releaseId), { headers: await authHeaders() });
      if (!res.ok) throw new Error("packet");
      const parsed = parsePitchPacket(await res.json());
      if (!parsed) throw new Error("packet shape");
      setPacket(parsed);
    } catch { setPacket(null); setPacketFailed(true); }
    finally { setPacketLoading(false); }
  };

  const generateKit = async () => {
    const finalTitle = pickedTitle(source, library, librarySongId, songTitle);
    if (generating || !playlistKitReady({ songTitle: finalTitle })) return;
    setGenerating(true);
    setKitError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(PLAYLIST_PITCH_KIT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: PLAYLIST_PITCH_KIT_COST_VISUAL_BUCS,
        overrideFeature: "Playlist Pitch Kit",
        body: JSON.stringify(buildPlaylistKitPayload({
          songTitle: finalTitle, artistName, genre, mood, energy, tempo,
          description, lyrics, curatorName, playlistName,
        })),
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) { setOutOfCredits(true); refreshProfile(); return; }
      const parsed = parsePlaylistKit(data);
      if (!res.ok || !parsed) {
        setKitError("The pitch kit didn't come together — a failed kit is refunded by the rail. Try again.");
        return;
      }
      setKit(parsed);
      refreshProfile();
    } catch {
      setKitError("The pitch desk didn't answer. Try again.");
    } finally { setGenerating(false); }
  };

  const addPitch = async () => {
    if (!playlistPitchReady(draft)) { setTrackerNote("A pitch needs a song title and a playlist name."); return; }
    setTrackerNote(null);
    try {
      const res = await fetch(PLAYLIST_PITCH_TRACKER_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildPlaylistPitchPayload(draft)),
      });
      if (!res.ok) throw new Error("save");
      const row = parsePlaylistPitchAnswer(await res.json());
      if (!row) throw new Error("save shape");
      setPitches((prev) => [row, ...(prev ?? [])]);
      setDraft({ songTitle: "", artistName: "", curatorName: "", playlistName: "", notes: "" });
      setShowAdd(false);
    } catch { setTrackerNote("That pitch didn't save. Try again."); }
  };

  const updatePitchStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(playlistPitchTrackerItemPath(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("update");
      const row = parsePlaylistPitchAnswer(await res.json());
      if (!row) throw new Error("update shape");
      setPitches((prev) => (prev ?? []).map((p) => (p.id === id ? row : p)));
    } catch { setTrackerNote("That status didn't save. Try again."); }
  };

  const deletePitch = async (id: string) => {
    setArmedDeleteId(null);
    try {
      const res = await fetch(playlistPitchTrackerItemPath(id), { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) throw new Error("delete");
      setPitches((prev) => (prev ?? []).filter((p) => p.id !== id));
    } catch { setTrackerNote("That pitch couldn't be removed — it's still on your tracker. Try again."); }
  };

  const addDeadline = async () => {
    if (!deadlineReady(deadlineDraft)) { setDeadlineNote("A deadline needs a playlist name and a date."); return; }
    setDeadlineNote(null);
    try {
      const res = await fetch(PLAYLIST_PITCH_DEADLINES_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildDeadlinePayload(deadlineDraft)),
      });
      if (!res.ok) throw new Error("deadline save");
      setDeadlineDraft({ playlistName: "", curatorName: "", deadlineDate: "", releaseId: "" });
      setShowDeadlineForm(false);
      void loadDeadlines();
    } catch { setDeadlineNote("That deadline didn't save. Try again."); }
  };

  const updateDeadlineStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(playlistPitchDeadlineItemPath(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("deadline update");
      void loadDeadlines();
    } catch { setDeadlineNote("That deadline status didn't save. Try again."); }
  };

  const deleteDeadline = async (id: string) => {
    setArmedDeadlineId(null);
    try {
      const res = await fetch(playlistPitchDeadlineItemPath(id), { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) throw new Error("deadline delete");
      void loadDeadlines();
    } catch { setDeadlineNote("That deadline couldn't be removed — it's still on your board. Try again."); }
  };

  const logCurator = (c: PlaylistCurator) => {
    setCuratorName(c.name);
    setDraft((d) => ({ ...d, curatorName: c.name, playlistName: d.playlistName || c.focus.split("(")[0]!.trim().slice(0, 80) }));
    setShowAdd(true);
  };

  return (
    <div className="space-y-3">
      <NativeCard isLight={isLight} title="Playlist pitch kit">
        <div className="space-y-3">
          <SongPicker isLight={isLight} library={library} source={source} setSource={setSource} librarySongId={librarySongId} setLibrarySongId={setLibrarySongId} songTitle={songTitle} setSongTitle={setSongTitle} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input aria-label="Artist name" className={deskInputCls(isLight)} value={artistName} maxLength={200} onChange={(e) => setArtistName(e.target.value)} placeholder="Artist name" />
            <input aria-label="Genre" className={deskInputCls(isLight)} value={genre} maxLength={100} onChange={(e) => setGenre(e.target.value)} placeholder="Genre (hip-hop, r&b, pop…)" />
            <input aria-label="Curator name" className={deskInputCls(isLight)} value={curatorName} maxLength={200} onChange={(e) => setCuratorName(e.target.value)} placeholder="Curator name (optional)" />
            <input aria-label="Playlist name" className={deskInputCls(isLight)} value={playlistName} maxLength={200} onChange={(e) => setPlaylistName(e.target.value)} placeholder="Playlist name (optional)" />
          </div>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-wider ${muted}`}>Energy — {energy}/100</span>
            <input aria-label="Energy" type="range" min={0} max={100} value={energy} onChange={(e) => setEnergy(Number(e.target.value))} className="w-full accent-[#d4af37] bdv-touch-target" />
          </label>
          <button type="button" className={`text-xs font-bold bdv-touch-target ${muted}`} aria-expanded={showAdvanced} onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "Hide advanced details" : "Advanced details — mood, tempo, description, lyrics"}
          </button>
          {showAdvanced ? (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <input aria-label="Mood" className={deskInputCls(isLight)} value={mood} maxLength={200} onChange={(e) => setMood(e.target.value)} placeholder="Mood" />
                <input aria-label="Tempo" className={deskInputCls(isLight)} value={tempo} maxLength={50} onChange={(e) => setTempo(e.target.value)} placeholder="Tempo feel" />
              </div>
              <textarea aria-label="Song description" className={deskInputCls(isLight)} value={description} maxLength={1000} rows={2} onChange={(e) => setDescription(e.target.value)} placeholder="What is this song? (optional)" />
              <textarea aria-label="Lyrics" className={deskInputCls(isLight)} value={lyrics} maxLength={5000} rows={3} onChange={(e) => setLyrics(e.target.value)} placeholder="Lyrics (optional)" />
            </div>
          ) : null}
          {kitError ? <p className="text-xs font-semibold text-red-400">{kitError}</p> : null}
          {outOfCredits ? <p className="text-xs font-semibold text-red-400">Out of Visual Bucs — top up and the pitch kit maker is ready again.</p> : null}
          <button type="button" data-testid="world-playlist-pitch-generate" className={goldBtn} disabled={generating || !playlistKitReady({ songTitle: pickedTitle(source, library, librarySongId, songTitle) })} onClick={() => void generateKit()}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generating ? "Writing your kit…" : `Build my pitch kit — ${PLAYLIST_PITCH_KIT_COST_VISUAL_BUCS} Visual Bucs`}
          </button>
          <p className={`text-[11px] ${muted}`}>Song analysis, pitch email, a DM version and a follow-up — confirmed before it charges, refunded if it fails.</p>
        </div>
        {kit ? (
          <div className="mt-4 space-y-4" data-testid="world-playlist-pitch-kit-result">
            <AnalysisBlock kit={kit} fitLabel="Playlist fit" isLight={isLight} />
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider ${strong}`}><Mail className="h-3.5 w-3.5 text-[#d4af37]" /> Pitch email</p>
                <CopyTextButton isLight={isLight} label="Copy email" text={`Subject: ${kit.emailSubject}\n\n${kit.emailBody}`} />
              </div>
              <p className={`text-sm font-semibold ${strong}`}>{kit.emailSubject}</p>
              <p className={`mt-1 whitespace-pre-wrap text-sm ${muted}`}>{kit.emailBody}</p>
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className={`text-xs font-black uppercase tracking-wider ${strong}`}>DM version</p>
                <CopyTextButton isLight={isLight} label="Copy DM" text={kit.dmPitch} />
              </div>
              <p className={`text-sm ${muted}`}>{kit.dmPitch}</p>
            </div>
            {kit.followUp ? (
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className={`text-xs font-black uppercase tracking-wider ${strong}`}>Follow-up</p>
                  <CopyTextButton isLight={isLight} label="Copy follow-up" text={kit.followUp} />
                </div>
                <p className={`text-sm ${muted}`}>{kit.followUp}</p>
              </div>
            ) : null}
            {kit.disclaimer ? <p className={`rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs ${muted}`}>{kit.disclaimer}</p> : null}
          </div>
        ) : null}
      </NativeCard>

      <NativeCard isLight={isLight} title="Curator directory — free">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {["all", ...PLAYLIST_PITCH_GENRES].map((g) => (
            <button key={g} type="button" className={chipBtn(isLight, genreFilter === g)} onClick={() => setGenreFilter(g)}>{g === "all" ? "All genres" : g}</button>
          ))}
        </div>
        {curatorsFailed ? (
          <NativeErrorState isLight={isLight} title="The curator directory wouldn't open" message="The directory is safe on the real rails — it just didn't answer. Try again." onRetry={() => setCuratorsTick((n) => n + 1)} />
        ) : curators === null ? (
          <NativeLoadingState isLight={isLight} message="Opening the curator directory…" />
        ) : curators.length === 0 ? (
          <NativeEmptyState isLight={isLight} message="No curators found for that genre." detail="Widen the filter — the starter list is small and honest." />
        ) : (
          <div className="space-y-2">
            {curators.map((c) => (
              <div key={c.id} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={`text-sm font-black ${strong}`}>{c.name}</p>
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${muted}`}>{c.platform}</span>
                </div>
                <p className={`mt-1 text-xs ${muted}`}>{c.focus}</p>
                {c.genres.length ? <p className={`mt-1 text-[11px] ${muted}`}>{c.genres.join(" · ")}</p> : null}
                <p className={`mt-1.5 text-xs ${strong}`}>How to submit: <span className={muted}>{c.submitVia}</span></p>
                <button type="button" className={`${chipBtn(isLight)} mt-2`} onClick={() => logCurator(c)}>
                  <Plus className="h-3.5 w-3.5" /> Log this curator in my tracker
                </button>
              </div>
            ))}
          </div>
        )}
        {curatorNotice ? <p className={`mt-2 text-[11px] ${muted}`}>{curatorNotice}</p> : null}
      </NativeCard>

      <NativeCard isLight={isLight} title="Pitch packet — built from your release record">
        <p className={`mb-3 text-xs ${muted}`}>Built from your release record — real data only. Anything the record doesn&rsquo;t have is listed as missing, never made up.</p>
        {releasesFailed ? (
          <NativeErrorState isLight={isLight} title="Your releases wouldn't open" message="Your release records are safe — the packet desk just didn't reach them. Try again." onRetry={() => setReleasesTick((n) => n + 1)} />
        ) : releases === null ? (
          <NativeLoadingState isLight={isLight} message="Opening your releases…" />
        ) : releases.length === 0 ? (
          <NativeEmptyState isLight={isLight} message="No releases yet." detail="Create one in Distribute and its packet will build itself here." />
        ) : (
          <div className="space-y-3">
            <select aria-label="Release for the packet" className={`${selectCls(isLight)} w-full`} value={packetReleaseId} onChange={(e) => void loadPacket(e.target.value)}>
              <option value="">Pick a release…</option>
              {releases.map((r) => (
                <option key={r.id} value={r.id}>{r.title}{r.artistName ? ` — ${r.artistName}` : ""}</option>
              ))}
            </select>
            {packetLoading ? <NativeLoadingState isLight={isLight} message="Building the packet…" /> : null}
            {packetFailed ? (
              <NativeErrorState isLight={isLight} title="We couldn't load this packet" message="The release record is safe — this desk just couldn't reach it. Try again." onRetry={() => void loadPacket(packetReleaseId)} />
            ) : null}
            {packet ? (
              <div className="space-y-3" data-testid="world-playlist-pitch-packet">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className={`text-sm font-black ${strong}`}>{packet.releaseTitle} — {packet.artistName}</p>
                    <p className={`text-xs ${muted}`}>
                      {packet.releaseStatus}
                      {packet.releaseDate ? ` · ${packet.releaseDate}` : ""}
                      {packet.followerCount != null ? ` · ${packet.followerCount.toLocaleString()} followers` : ""}
                      {packet.totalPlays != null ? ` · ${packet.totalPlays.toLocaleString()} plays` : ""}
                    </p>
                    {packet.artistBio ? <p className={`mt-1 text-xs ${muted}`}>{packet.artistBio}</p> : null}
                  </div>
                  <CopyTextButton isLight={isLight} label="Copy packet" text={packetAsText(packet)} />
                </div>
                {packet.genre.length ? <p className={`text-xs ${muted}`}>Genre: {packet.genre.join(", ")}</p> : null}
                {packet.description ? <p className={`text-xs ${muted}`}>{packet.description}</p> : null}
                <div className="space-y-0.5">
                  {packet.presaveUrl ? <p className={`truncate text-xs ${muted}`}>Pre-save / smartlink: {packet.presaveUrl}</p> : null}
                  {Object.entries(packet.streaming).map(([platform, url]) => (
                    <p key={platform} className={`truncate text-xs ${muted}`}><span className={`capitalize ${strong}`}>{platform.replace(/_/g, " ")}</span> — {url}</p>
                  ))}
                  {packet.audioUrl ? <p className={`truncate text-xs ${muted}`}>Track audio: {packet.audioUrl}</p> : null}
                  {packet.profileUrl ? <p className={`truncate text-xs ${muted}`}>Artist profile: {packet.profileUrl}</p> : null}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  <span className={`text-xs ${strong}`}>{packet.stats.presaves} pre-saves</span>
                  <span className={`text-xs ${strong}`}>{packet.stats.shares} shares</span>
                  <span className={`text-xs ${strong}`}>{packet.stats.linkViews} smartlink views</span>
                  <span className={`text-xs ${strong}`}>{packet.stats.linkClicks} link clicks</span>
                </div>
                {(packet.artworkUrl || packet.headline || packet.bannerUrl || packet.avatarUrl) ? (
                  <div>
                    <div className="flex flex-wrap gap-2">
                      {packet.artworkUrl ? <img src={packet.artworkUrl} alt="" className="h-16 w-16 rounded-xl border border-[#d4af37]/30 object-cover" /> : null}
                      {packet.avatarUrl ? <img src={packet.avatarUrl} alt="" className="h-16 w-16 rounded-full border border-[#d4af37]/30 object-cover" /> : null}
                      {packet.bannerUrl ? <img src={packet.bannerUrl} alt="" className="h-16 w-28 rounded-xl border border-[#d4af37]/30 object-cover" /> : null}
                    </div>
                    {packet.headline ? <p className={`mt-1 text-xs italic ${muted}`}>“{packet.headline}”</p> : null}
                  </div>
                ) : null}
                {packet.missing.length > 0 ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3">
                    <p className={`text-xs font-bold ${strong}`}>Not on the record yet</p>
                    <ul className={`mt-1 list-disc space-y-0.5 pl-5 text-xs ${muted}`}>
                      {packet.missing.map((m) => (<li key={m}>{packetMissingLabel(m)}</li>))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : !packetLoading && !packetFailed ? (
              <p className={`text-xs ${muted}`}>Pick a release above and its packet builds itself from the record.</p>
            ) : null}
          </div>
        )}
      </NativeCard>

      <NativeCard isLight={isLight} title="Pitch tracker & deadlines — free">
        <div className="space-y-3">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={`text-xs font-black uppercase tracking-wider ${strong}`}>Submission deadlines</p>
              <button type="button" className={chipBtn(isLight, showDeadlineForm)} aria-expanded={showDeadlineForm} onClick={() => setShowDeadlineForm((v) => !v)}>
                <Plus className="h-3.5 w-3.5" /> Add a deadline
              </button>
            </div>
            {dueNext ? (
              <p className={`mt-2 rounded-xl border px-3 py-2 text-xs ${dueNext.overdue ? "border-red-500/40 bg-red-500/10 text-red-200" : isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                <span className="font-black uppercase">Due next:</span> {dueNext.playlistName}
                {dueNext.curatorName ? ` · ${dueNext.curatorName}` : ""} · {new Date(dueNext.deadlineAt).toLocaleDateString()}
                {dueNext.overdue ? " · OVERDUE" : ""}
              </p>
            ) : null}
            {showDeadlineForm ? (
              <div className="mt-2 space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input aria-label="Playlist name" className={deskInputCls(isLight)} value={deadlineDraft.playlistName} maxLength={200} onChange={(e) => setDeadlineDraft({ ...deadlineDraft, playlistName: e.target.value })} placeholder="Playlist name" />
                  <input aria-label="Curator name" className={deskInputCls(isLight)} value={deadlineDraft.curatorName} maxLength={200} onChange={(e) => setDeadlineDraft({ ...deadlineDraft, curatorName: e.target.value })} placeholder="Curator name (optional)" />
                  <input aria-label="Deadline date" type="date" className={deskInputCls(isLight)} value={deadlineDraft.deadlineDate} onChange={(e) => setDeadlineDraft({ ...deadlineDraft, deadlineDate: e.target.value })} />
                  <select aria-label="Deadline release" className={selectCls(isLight)} value={deadlineDraft.releaseId} onChange={(e) => setDeadlineDraft({ ...deadlineDraft, releaseId: e.target.value })}>
                    <option value="">No release linked</option>
                    {(releases ?? []).map((r) => (<option key={r.id} value={r.id}>{r.title}</option>))}
                  </select>
                </div>
                <button type="button" className={goldBtn} onClick={() => void addDeadline()}>Save deadline — free</button>
              </div>
            ) : null}
            {deadlineNote ? <p className="mt-1 text-xs font-semibold text-red-400">{deadlineNote}</p> : null}
            {deadlinesFailed ? (
              <NativeErrorState isLight={isLight} title="Your deadlines wouldn't open" message="Your deadline board is safe — it just didn't answer. Try again." onRetry={() => setDeadlinesTick((n) => n + 1)} />
            ) : deadlines === null ? (
              <NativeLoadingState isLight={isLight} message="Opening your deadlines…" />
            ) : deadlines.length === 0 ? (
              <NativeEmptyState isLight={isLight} message="No deadlines yet." detail="Add one above and the board keeps what's due — and what's due next — in one place." />
            ) : (
              <div className="mt-2 space-y-2">
                {deadlines.map((d) => (
                  <div key={d.id} className={`space-y-2 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className={`text-sm font-black ${strong}`}>{d.playlistName}{d.curatorName ? <span className={`font-normal ${muted}`}> · {d.curatorName}</span> : null}</p>
                        <p className={`text-xs ${muted}`}>Due {new Date(d.deadlineAt).toLocaleDateString()}{d.overdue ? " · OVERDUE" : ""}{d.notes ? ` · ${d.notes}` : ""}</p>
                      </div>
                      <DeleteButton armed={armedDeadlineId === d.id} onArm={() => setArmedDeadlineId(d.id)} onDelete={() => void deleteDeadline(d.id)} label={`Delete deadline ${d.playlistName}`} />
                    </div>
                    <StatusRow isLight={isLight} statuses={PLAYLIST_DEADLINE_STATUSES} current={d.status} onPick={(st) => void updateDeadlineStatus(d.id, st)} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-[#d4af37]/20 pt-3">
            {trackerFailed ? (
              <NativeErrorState isLight={isLight} title="Your pitch tracker wouldn't open" message="Your logged pitches are safe — the tracker just didn't answer. Try again." onRetry={() => setTrackerTick((n) => n + 1)} />
            ) : pitches === null ? (
              <NativeLoadingState isLight={isLight} message="Opening your tracker…" />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={`inline-flex items-center gap-1.5 text-xs ${muted}`}><ClipboardList className="h-3.5 w-3.5" /> {pitches.length} pitches · {pitches.filter((p) => p.status === "accepted").length} accepted</p>
                  <button type="button" className={chipBtn(isLight, showAdd)} aria-expanded={showAdd} onClick={() => setShowAdd((v) => !v)}>
                    <Plus className="h-3.5 w-3.5" /> Log a pitch
                  </button>
                </div>
                {showAdd ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input aria-label="Song title" className={deskInputCls(isLight)} value={draft.songTitle} maxLength={200} onChange={(e) => setDraft({ ...draft, songTitle: e.target.value })} placeholder="Song title" />
                      <input aria-label="Playlist name" className={deskInputCls(isLight)} value={draft.playlistName} maxLength={200} onChange={(e) => setDraft({ ...draft, playlistName: e.target.value })} placeholder="Playlist name" />
                      <input aria-label="Artist name" className={deskInputCls(isLight)} value={draft.artistName} maxLength={200} onChange={(e) => setDraft({ ...draft, artistName: e.target.value })} placeholder="Artist name (optional)" />
                      <input aria-label="Curator name" className={deskInputCls(isLight)} value={draft.curatorName} maxLength={200} onChange={(e) => setDraft({ ...draft, curatorName: e.target.value })} placeholder="Curator name (optional)" />
                    </div>
                    <textarea aria-label="Notes" className={deskInputCls(isLight)} value={draft.notes} maxLength={1000} rows={2} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Notes (optional)" />
                    <button type="button" className={goldBtn} onClick={() => void addPitch()}>Save pitch — free</button>
                  </div>
                ) : null}
                {trackerNote ? <p className="text-xs font-semibold text-red-400">{trackerNote}</p> : null}
                {pitches.length === 0 ? (
                  <NativeEmptyState isLight={isLight} message="No pitches logged yet." detail="Build a kit above, send it, and log it here." />
                ) : (
                  pitches.map((p) => (
                    <div key={p.id} className={`space-y-2 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-black ${strong}`}>{p.songTitle}{p.artistName ? <span className={`font-normal ${muted}`}> — {p.artistName}</span> : null}</p>
                          <p className={`text-xs ${muted}`}>{p.playlistName}{p.curatorName ? ` · ${p.curatorName}` : ""}{p.contactedAt ? ` · ${new Date(p.contactedAt).toLocaleDateString()}` : ""}</p>
                          {p.notes ? <p className={`mt-1 text-xs italic ${muted}`}>{p.notes}</p> : null}
                        </div>
                        <DeleteButton armed={armedDeleteId === p.id} onArm={() => setArmedDeleteId(p.id)} onDelete={() => void deletePitch(p.id)} label={`Delete pitch ${p.songTitle}`} />
                      </div>
                      <StatusRow isLight={isLight} statuses={PLAYLIST_PITCH_STATUSES} current={p.status} onPick={(st) => void updatePitchStatus(p.id, st)} />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </NativeCard>
    </div>
  );
}

/* ═══ The desk ═════════════════════════════════════════════════════ */

export function LabelPitchDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const [mode, setMode] = useState<"labels" | "playlists">("labels");
  if (isGuest) return <GuestGate isLight={isLight} />;
  return (
    <div className="space-y-3" data-testid="world-label-pitch-desk">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Label Pitch mode">
        <button type="button" role="tab" aria-selected={mode === "labels"} className={chipBtn(isLight, mode === "labels")} onClick={() => setMode("labels")}>
          <Building2 className="h-3.5 w-3.5" /> Labels
        </button>
        <button type="button" role="tab" aria-selected={mode === "playlists"} className={chipBtn(isLight, mode === "playlists")} onClick={() => setMode("playlists")}>
          <ListMusic className="h-3.5 w-3.5" /> Playlists
        </button>
        <span className={`inline-flex items-center gap-1.5 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/45"}`}>
          <Disc3 className="h-3.5 w-3.5 text-[#d4af37]" /> Pick a song, pitch it, track it — labels, playlists and the packet, all right here.
        </span>
      </div>
      {mode === "labels" ? (
        <LabelsMode isLight={isLight} isGuest={isGuest} />
      ) : (
        <PlaylistsMode isLight={isLight} isGuest={isGuest} />
      )}
    </div>
  );
}
