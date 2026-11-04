import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  packetMissingStrings,
  packetTextStrings,
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

/* Directory type-filter plurals (stack100 locale unit 47): the
   desk renders `${type}s` today; the plural words are catalog
   keys so a language can spell them properly. */
const TYPE_PLURAL_KEYS: Record<string, string> = {
  major: "worldSponsorPress.lpTypeMajor",
  imprint: "worldSponsorPress.lpTypeImprint",
  indie: "worldSponsorPress.lpTypeIndie",
};

function GuestGate({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  return (
    <NativeCard isLight={isLight} title={t("worldSponsorPress.lpGuestTitle")}>
      <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        {t("worldSponsorPress.lpGuestLead")}{" "}
        <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">
          {t("worldSponsorPress.lpGuestSignIn")}
        </Link>{" "}
        {t("worldSponsorPress.lpGuestTrail")}
      </p>
    </NativeCard>
  );
}

function CopyTextButton({ text, label, isLight }: { text: string; label: string; isLight: boolean }) {
  const { t } = useTranslation();
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
      {copied ? t("labelPitch.copied") : label}
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
  const { t } = useTranslation();
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
      <Trash2 className="h-3.5 w-3.5" /> {armed ? t("worldSponsorPress.lpDeleteArmed") : t("common.delete")}
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
  const { t } = useTranslation();
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
          {s === current ? t("worldSponsorPress.lpStatusNow", { status: s }) : t("playlistPitch.markStatus", { status: s.replace(/_/g, " ") })}
        </button>
      ))}
    </div>
  );
}

function AnalysisBlock({ kit, fitLabel, isLight }: { kit: LabelKit | PlaylistKit; fitLabel: string; isLight: boolean }) {
  const { t } = useTranslation();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const a = kit.analysis;
  return (
    <div className="space-y-2">
      <p className={`border-l-2 border-[#d4af37]/60 pl-3 text-sm italic ${strong}`}>“{a.oneLiner}”</p>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <span className={`text-xs ${muted}`}>{t("worldSponsorPress.lpAnalysisGenre")} <span className={strong}>{a.genre || "—"}</span></span>
        <span className={`text-xs ${muted}`}>{t("worldSponsorPress.lpAnalysisMood")} <span className={strong}>{a.mood || "—"}</span></span>
        <span className={`text-xs ${muted}`}>{t("worldSponsorPress.lpAnalysisEnergy")} <span className={strong}>{t("worldSponsorPress.lpAnalysisEnergyValue", { energy: a.energy, tempo: a.tempoFeel })}</span></span>
      </div>
      {a.comparableArtists.length > 0 ? (
        <p className={`text-xs ${muted}`}>{t("worldSponsorPress.lpAnalysisSoundsLike")} {a.comparableArtists.join(" · ")}</p>
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
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={chipBtn(isLight, source === "library")} onClick={() => setSource("library")}>
          {t("worldSponsorPress.lpPickerFromLibrary")}{library.length ? t("worldSponsorPress.lpPickerCountSuffix", { count: library.length }) : ""}
        </button>
        <button type="button" className={chipBtn(isLight, source === "manual")} onClick={() => setSource("manual")}>
          {t("worldSponsorPress.lpSourceManual")}
        </button>
      </div>
      {source === "library" ? (
        <select aria-label={t("worldSponsorPress.lpLibrarySongAria")} className={`${selectCls(isLight)} w-full`} value={librarySongId} onChange={(e) => setLibrarySongId(e.target.value)}>
          <option value="">{t("labelPitch.pickSong")}</option>
          {library.map((s) => (
            <option key={s.id} value={s.id}>{s.title || t("labelPitch.untitledSong")}</option>
          ))}
        </select>
      ) : (
        <input aria-label={t("worldSponsorPress.lpSongTitle")} className={deskInputCls(isLight)} value={songTitle} maxLength={200} onChange={(e) => setSongTitle(e.target.value)} placeholder={t("worldSponsorPress.lpSongTitle")} />
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
  const { t, i18n } = useTranslation();
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
        setKitError(t("worldSponsorPress.lpLabelKitError"));
        return;
      }
      setKit(parsed);
      refreshProfile();
    } catch {
      setKitError(t("worldSponsorPress.lpDeskNoAnswer"));
    } finally { setGenerating(false); }
  };

  const addSubmission = async () => {
    if (!labelSubmissionReady(draft)) { setTrackerNote(t("worldSponsorPress.lpSubmissionNeeds")); return; }
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
    } catch { setTrackerNote(t("worldSponsorPress.lpSubmissionSaveError")); }
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
    } catch { setTrackerNote(t("worldSponsorPress.lpStatusSaveError")); }
  };

  const deleteSubmission = async (id: string) => {
    setArmedDeleteId(null);
    try {
      const res = await fetch(labelPitchTrackerItemPath(id), { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) throw new Error("delete");
      setSubmissions((prev) => (prev ?? []).filter((p) => p.id !== id));
    } catch { setTrackerNote(t("worldSponsorPress.lpSubmissionDeleteError")); }
  };

  return (
    <div className="space-y-3">
      <NativeCard isLight={isLight} title={t("worldSponsorPress.lpLabelKitCardTitle")}>
        <div className="space-y-3">
          <SongPicker isLight={isLight} library={library} source={source} setSource={setSource} librarySongId={librarySongId} setLibrarySongId={setLibrarySongId} songTitle={songTitle} setSongTitle={setSongTitle} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input aria-label={t("worldSponsorPress.lpArtistName")} className={deskInputCls(isLight)} value={artistName} maxLength={200} onChange={(e) => setArtistName(e.target.value)} placeholder={t("worldSponsorPress.lpArtistName")} />
            <input aria-label={t("worldSponsorPress.lpGenreAria")} className={deskInputCls(isLight)} value={genre} maxLength={100} onChange={(e) => setGenre(e.target.value)} placeholder={t("worldSponsorPress.lpGenrePlaceholder")} />
            <input aria-label={t("worldSponsorPress.lpMood")} className={deskInputCls(isLight)} value={mood} maxLength={200} onChange={(e) => setMood(e.target.value)} placeholder={t("worldSponsorPress.lpMood")} />
            <input aria-label={t("worldSponsorPress.lpTempo")} className={deskInputCls(isLight)} value={tempo} maxLength={50} onChange={(e) => setTempo(e.target.value)} placeholder={t("worldSponsorPress.lpTempoPlaceholder")} />
          </div>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-wider ${muted}`}>{t("labelPitch.energyLabel", { energy })}</span>
            <input aria-label={t("worldSponsorPress.lpEnergyAria")} type="range" min={0} max={100} value={energy} onChange={(e) => setEnergy(Number(e.target.value))} className="w-full accent-[#d4af37] bdv-touch-target" />
          </label>
          <textarea aria-label={t("worldSponsorPress.lpSongDescriptionAria")} className={deskInputCls(isLight)} value={description} maxLength={1000} rows={2} onChange={(e) => setDescription(e.target.value)} placeholder={t("worldSponsorPress.lpSongDescriptionPlaceholder")} />
          <input aria-label={t("worldSponsorPress.lpTargetLabelAria")} className={deskInputCls(isLight)} value={labelName} maxLength={200} onChange={(e) => setLabelName(e.target.value)} placeholder={t("worldSponsorPress.lpTargetLabelPlaceholder")} />
          <button type="button" className={`text-xs font-bold bdv-touch-target ${muted}`} aria-expanded={showAdvanced} onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? t("worldSponsorPress.lpHideAdvanced") : t("worldSponsorPress.lpShowAdvancedLabels")}
          </button>
          {showAdvanced ? (
            <div className="space-y-2">
              <textarea aria-label={t("worldSponsorPress.lpArtistBioAria")} className={deskInputCls(isLight)} value={artistBio} maxLength={2000} rows={2} onChange={(e) => setArtistBio(e.target.value)} placeholder={t("worldSponsorPress.lpArtistBioPlaceholder")} />
              <input aria-label={t("worldSponsorPress.lpSocialStatsAria")} className={deskInputCls(isLight)} value={socialStats} maxLength={500} onChange={(e) => setSocialStats(e.target.value)} placeholder={t("worldSponsorPress.lpSocialStatsPlaceholder")} />
              <textarea aria-label={t("worldSponsorPress.lpLyricsAria")} className={deskInputCls(isLight)} value={lyrics} maxLength={5000} rows={3} onChange={(e) => setLyrics(e.target.value)} placeholder={t("worldSponsorPress.lpLyricsPlaceholder")} />
            </div>
          ) : null}
          {kitError ? <p className="text-xs font-semibold text-red-400">{kitError}</p> : null}
          {outOfCredits ? <p className="text-xs font-semibold text-red-400">{t("worldSponsorPress.lpLabelOutOfCredits")}</p> : null}
          <button type="button" data-testid="world-label-pitch-generate" className={goldBtn} disabled={generating || !labelKitReady({ songTitle: pickedTitle(source, library, librarySongId, songTitle) })} onClick={() => void generateKit()}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generating ? t("worldSponsorPress.lpLabelKitBuilding") : t("worldSponsorPress.lpLabelKitButton", { cost: LABEL_PITCH_KIT_COST_VISUAL_BUCS })}
          </button>
          <p className={`text-[11px] ${muted}`}>{t("worldSponsorPress.lpLabelKitNote")}</p>
        </div>
        {kit ? (
          <div className="mt-4 space-y-4" data-testid="world-label-pitch-kit-result">
            <AnalysisBlock kit={kit} fitLabel={t("labelPitch.bestLabelFit")} isLight={isLight} />
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider ${strong}`}><Mail className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldSponsorPress.lpSubmissionEmailTitle")}</p>
                <CopyTextButton isLight={isLight} label={t("labelPitch.copyTemplate", { label: t("labelPitch.labelEmail") })} text={`${t("labelPitch.subjectLabel")}${kit.emailSubject}\n\n${kit.emailBody}`} />
              </div>
              <p className={`text-sm font-semibold ${strong}`}>{kit.emailSubject}</p>
              <p className={`mt-1 whitespace-pre-wrap text-sm ${muted}`}>{kit.emailBody}</p>
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className={`text-xs font-black uppercase tracking-wider ${strong}`}>{t("worldSponsorPress.lpOneSheetTitle")}</p>
                <CopyTextButton isLight={isLight} label={t("labelPitch.copyTemplate", { label: t("labelPitch.labelOneSheet") })} text={kit.oneSheet} />
              </div>
              <p className={`whitespace-pre-wrap text-sm ${muted}`}>{kit.oneSheet}</p>
            </div>
            {kit.followUp ? (
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className={`text-xs font-black uppercase tracking-wider ${strong}`}>{t("worldSponsorPress.lpFollowUpTitle")}</p>
                  <CopyTextButton isLight={isLight} label={t("labelPitch.copyTemplate", { label: t("labelPitch.labelFollowUp") })} text={kit.followUp} />
                </div>
                <p className={`text-sm ${muted}`}>{kit.followUp}</p>
              </div>
            ) : null}
            {kit.disclaimer ? <p className={`rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs ${muted}`}>{kit.disclaimer}</p> : null}
          </div>
        ) : null}
      </NativeCard>

      <NativeCard isLight={isLight} title={t("worldSponsorPress.lpLabelDirectoryTitle")}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {["all", ...LABEL_PITCH_GENRES].map((g) => (
            <button key={g} type="button" className={chipBtn(isLight, genreFilter === g)} onClick={() => setGenreFilter(g)}>{g === "all" ? t("playlistPitch.allGenres") : g}</button>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(["all", "major", "imprint", "indie"] as const).map((tp) => (
            <button key={tp} type="button" className={chipBtn(isLight, typeFilter === tp)} onClick={() => setTypeFilter(tp)}>{tp === "all" ? t("worldSponsorPress.lpAllTypes") : t(TYPE_PLURAL_KEYS[tp])}</button>
          ))}
        </div>
        {labelsFailed ? (
          <NativeErrorState isLight={isLight} title={t("worldSponsorPress.lpLabelsErrorTitle")} message={t("worldSponsorPress.lpDirectoryErrorMessage")} onRetry={() => setLabelsTick((n) => n + 1)} />
        ) : labels === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldSponsorPress.lpLabelsLoading")} />
        ) : labels.length === 0 ? (
          <NativeEmptyState isLight={isLight} message={t("worldSponsorPress.lpNoLabelsMessage")} detail={t("worldSponsorPress.lpNoLabelsDetail")} />
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
                <p className={`mt-1.5 text-xs ${strong}`}>{t("worldSponsorPress.lpHowToSubmit")} <span className={muted}>{l.submitVia}</span></p>
                <button type="button" className={`${chipBtn(isLight)} mt-2`} onClick={() => { setLabelName(l.name); setDraft((d) => ({ ...d, labelName: l.name })); }}>
                  {t("worldSponsorPress.lpPitchLabelButton", { name: l.name })}
                </button>
              </div>
            ))}
          </div>
        )}
        {labelNotice ? <p className={`mt-2 text-[11px] ${muted}`}>{labelNotice}</p> : null}
      </NativeCard>

      <NativeCard isLight={isLight} title={t("worldSponsorPress.lpTrackerCardTitle")}>
        {trackerFailed ? (
          <NativeErrorState isLight={isLight} title={t("worldSponsorPress.lpTrackerErrorTitle")} message={t("worldSponsorPress.lpTrackerErrorMessage")} onRetry={() => setTrackerTick((n) => n + 1)} />
        ) : submissions === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldSponsorPress.lpTrackerLoading")} />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={`text-xs ${muted}`}>
                {t("worldSponsorPress.lpSubmissionsLogged", { count: submissions.length })}{submissions.filter((s) => s.status === "signed").length > 0 ? t("labelPitch.signedSuffix", { count: submissions.filter((s) => s.status === "signed").length }) : ""}
              </p>
              <button type="button" className={chipBtn(isLight, showAdd)} aria-expanded={showAdd} onClick={() => setShowAdd((v) => !v)}>
                <Plus className="h-3.5 w-3.5" /> {t("worldSponsorPress.lpLogSubmission")}
              </button>
            </div>
            {showAdd ? (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input aria-label={t("worldSponsorPress.lpSongTitle")} className={deskInputCls(isLight)} value={draft.songTitle} maxLength={200} onChange={(e) => setDraft({ ...draft, songTitle: e.target.value })} placeholder={t("worldSponsorPress.lpSongTitle")} />
                  <input aria-label={t("worldSponsorPress.lpLabelName")} className={deskInputCls(isLight)} value={draft.labelName} maxLength={200} onChange={(e) => setDraft({ ...draft, labelName: e.target.value })} placeholder={t("worldSponsorPress.lpLabelName")} />
                  <input aria-label={t("worldSponsorPress.lpArtistName")} className={deskInputCls(isLight)} value={draft.artistName} maxLength={200} onChange={(e) => setDraft({ ...draft, artistName: e.target.value })} placeholder={t("worldSponsorPress.lpArtistNameOptional")} />
                  <input aria-label={t("worldSponsorPress.lpNotesAria")} className={deskInputCls(isLight)} value={draft.notes} maxLength={1000} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder={t("worldSponsorPress.lpNotesOptional")} />
                </div>
                <button type="button" className={goldBtn} onClick={() => void addSubmission()}>{t("worldSponsorPress.lpSaveSubmission")}</button>
              </div>
            ) : null}
            {trackerNote ? <p className="text-xs font-semibold text-red-400">{trackerNote}</p> : null}
            {submissions.length === 0 ? (
              <NativeEmptyState isLight={isLight} message={t("worldSponsorPress.lpNoSubmissionsMessage")} detail={t("worldSponsorPress.lpNoSubmissionsDetail")} />
            ) : (
              submissions.map((s) => (
                <div key={s.id} className={`space-y-2 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-black ${strong}`}>{s.songTitle}</p>
                      <p className={`text-xs ${muted}`}>→ {s.labelName}{s.artistName ? ` · ${s.artistName}` : ""}{s.contactedAt ? t("worldSponsorPress.lpSentSuffix", { date: new Date(s.contactedAt).toLocaleDateString(i18n.language) }) : ""}</p>
                      {s.notes ? <p className={`mt-1 text-xs ${muted}`}>{s.notes}</p> : null}
                    </div>
                    <DeleteButton armed={armedDeleteId === s.id} onArm={() => setArmedDeleteId(s.id)} onDelete={() => void deleteSubmission(s.id)} label={t("worldSponsorPress.lpDeleteSubmissionAria", { name: s.songTitle })} />
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
  const { t, i18n } = useTranslation();
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
        setKitError(t("worldSponsorPress.lpPlaylistKitError"));
        return;
      }
      setKit(parsed);
      refreshProfile();
    } catch {
      setKitError(t("worldSponsorPress.lpDeskNoAnswer"));
    } finally { setGenerating(false); }
  };

  const addPitch = async () => {
    if (!playlistPitchReady(draft)) { setTrackerNote(t("worldSponsorPress.lpPitchNeeds")); return; }
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
    } catch { setTrackerNote(t("worldSponsorPress.lpPitchSaveError")); }
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
    } catch { setTrackerNote(t("worldSponsorPress.lpStatusSaveError")); }
  };

  const deletePitch = async (id: string) => {
    setArmedDeleteId(null);
    try {
      const res = await fetch(playlistPitchTrackerItemPath(id), { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) throw new Error("delete");
      setPitches((prev) => (prev ?? []).filter((p) => p.id !== id));
    } catch { setTrackerNote(t("worldSponsorPress.lpPitchDeleteError")); }
  };

  const addDeadline = async () => {
    if (!deadlineReady(deadlineDraft)) { setDeadlineNote(t("worldSponsorPress.lpDeadlineNeeds")); return; }
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
    } catch { setDeadlineNote(t("worldSponsorPress.lpDeadlineSaveError")); }
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
    } catch { setDeadlineNote(t("worldSponsorPress.lpDeadlineStatusError")); }
  };

  const deleteDeadline = async (id: string) => {
    setArmedDeadlineId(null);
    try {
      const res = await fetch(playlistPitchDeadlineItemPath(id), { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) throw new Error("deadline delete");
      void loadDeadlines();
    } catch { setDeadlineNote(t("worldSponsorPress.lpDeadlineDeleteError")); }
  };

  const logCurator = (c: PlaylistCurator) => {
    setCuratorName(c.name);
    setDraft((d) => ({ ...d, curatorName: c.name, playlistName: d.playlistName || c.focus.split("(")[0]!.trim().slice(0, 80) }));
    setShowAdd(true);
  };

  return (
    <div className="space-y-3">
      <NativeCard isLight={isLight} title={t("worldSponsorPress.lpPlaylistKitCardTitle")}>
        <div className="space-y-3">
          <SongPicker isLight={isLight} library={library} source={source} setSource={setSource} librarySongId={librarySongId} setLibrarySongId={setLibrarySongId} songTitle={songTitle} setSongTitle={setSongTitle} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input aria-label={t("worldSponsorPress.lpArtistName")} className={deskInputCls(isLight)} value={artistName} maxLength={200} onChange={(e) => setArtistName(e.target.value)} placeholder={t("worldSponsorPress.lpArtistName")} />
            <input aria-label={t("worldSponsorPress.lpGenreAria")} className={deskInputCls(isLight)} value={genre} maxLength={100} onChange={(e) => setGenre(e.target.value)} placeholder={t("worldSponsorPress.lpGenrePlaceholder")} />
            <input aria-label={t("worldSponsorPress.lpCuratorNameAria")} className={deskInputCls(isLight)} value={curatorName} maxLength={200} onChange={(e) => setCuratorName(e.target.value)} placeholder={t("worldSponsorPress.lpCuratorNameOptional")} />
            <input aria-label={t("worldSponsorPress.lpPlaylistName")} className={deskInputCls(isLight)} value={playlistName} maxLength={200} onChange={(e) => setPlaylistName(e.target.value)} placeholder={t("worldSponsorPress.lpPlaylistNameOptional")} />
          </div>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-wider ${muted}`}>{t("labelPitch.energyLabel", { energy })}</span>
            <input aria-label={t("worldSponsorPress.lpEnergyAria")} type="range" min={0} max={100} value={energy} onChange={(e) => setEnergy(Number(e.target.value))} className="w-full accent-[#d4af37] bdv-touch-target" />
          </label>
          <button type="button" className={`text-xs font-bold bdv-touch-target ${muted}`} aria-expanded={showAdvanced} onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? t("worldSponsorPress.lpHideAdvanced") : t("worldSponsorPress.lpShowAdvancedPlaylists")}
          </button>
          {showAdvanced ? (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <input aria-label={t("worldSponsorPress.lpMood")} className={deskInputCls(isLight)} value={mood} maxLength={200} onChange={(e) => setMood(e.target.value)} placeholder={t("worldSponsorPress.lpMood")} />
                <input aria-label={t("worldSponsorPress.lpTempo")} className={deskInputCls(isLight)} value={tempo} maxLength={50} onChange={(e) => setTempo(e.target.value)} placeholder={t("worldSponsorPress.lpTempoPlaceholder")} />
              </div>
              <textarea aria-label={t("worldSponsorPress.lpSongDescriptionAria")} className={deskInputCls(isLight)} value={description} maxLength={1000} rows={2} onChange={(e) => setDescription(e.target.value)} placeholder={t("worldSponsorPress.lpSongDescriptionPlaceholder")} />
              <textarea aria-label={t("worldSponsorPress.lpLyricsAria")} className={deskInputCls(isLight)} value={lyrics} maxLength={5000} rows={3} onChange={(e) => setLyrics(e.target.value)} placeholder={t("worldSponsorPress.lpLyricsPlainOptional")} />
            </div>
          ) : null}
          {kitError ? <p className="text-xs font-semibold text-red-400">{kitError}</p> : null}
          {outOfCredits ? <p className="text-xs font-semibold text-red-400">{t("worldSponsorPress.lpPlaylistOutOfCredits")}</p> : null}
          <button type="button" data-testid="world-playlist-pitch-generate" className={goldBtn} disabled={generating || !playlistKitReady({ songTitle: pickedTitle(source, library, librarySongId, songTitle) })} onClick={() => void generateKit()}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generating ? t("worldSponsorPress.lpPlaylistKitBuilding") : t("worldSponsorPress.lpPlaylistKitButton", { cost: PLAYLIST_PITCH_KIT_COST_VISUAL_BUCS })}
          </button>
          <p className={`text-[11px] ${muted}`}>{t("worldSponsorPress.lpPlaylistKitNote")}</p>
        </div>
        {kit ? (
          <div className="mt-4 space-y-4" data-testid="world-playlist-pitch-kit-result">
            <AnalysisBlock kit={kit} fitLabel={t("playlistPitch.playlistFit")} isLight={isLight} />
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider ${strong}`}><Mail className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldSponsorPress.lpPitchEmailTitle")}</p>
                <CopyTextButton isLight={isLight} label={t("playlistPitch.copyLabel", { label: t("playlistPitch.copyEmailLabel") })} text={`${t("labelPitch.subjectLabel")}${kit.emailSubject}\n\n${kit.emailBody}`} />
              </div>
              <p className={`text-sm font-semibold ${strong}`}>{kit.emailSubject}</p>
              <p className={`mt-1 whitespace-pre-wrap text-sm ${muted}`}>{kit.emailBody}</p>
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className={`text-xs font-black uppercase tracking-wider ${strong}`}>{t("playlistPitch.dmVersion")}</p>
                <CopyTextButton isLight={isLight} label={t("playlistPitch.copyLabel", { label: t("playlistPitch.copyDmLabel") })} text={kit.dmPitch} />
              </div>
              <p className={`text-sm ${muted}`}>{kit.dmPitch}</p>
            </div>
            {kit.followUp ? (
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className={`text-xs font-black uppercase tracking-wider ${strong}`}>{t("worldSponsorPress.lpFollowUpTitle")}</p>
                  <CopyTextButton isLight={isLight} label={t("playlistPitch.copyLabel", { label: t("playlistPitch.copyFollowUpLabel") })} text={kit.followUp} />
                </div>
                <p className={`text-sm ${muted}`}>{kit.followUp}</p>
              </div>
            ) : null}
            {kit.disclaimer ? <p className={`rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs ${muted}`}>{kit.disclaimer}</p> : null}
          </div>
        ) : null}
      </NativeCard>

      <NativeCard isLight={isLight} title={t("worldSponsorPress.lpCuratorDirectoryTitle")}>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {["all", ...PLAYLIST_PITCH_GENRES].map((g) => (
            <button key={g} type="button" className={chipBtn(isLight, genreFilter === g)} onClick={() => setGenreFilter(g)}>{g === "all" ? t("playlistPitch.allGenres") : g}</button>
          ))}
        </div>
        {curatorsFailed ? (
          <NativeErrorState isLight={isLight} title={t("worldSponsorPress.lpCuratorsErrorTitle")} message={t("worldSponsorPress.lpDirectoryErrorMessage")} onRetry={() => setCuratorsTick((n) => n + 1)} />
        ) : curators === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldSponsorPress.lpCuratorsLoading")} />
        ) : curators.length === 0 ? (
          <NativeEmptyState isLight={isLight} message={t("worldSponsorPress.lpNoCuratorsMessage")} detail={t("worldSponsorPress.lpNoCuratorsDetail")} />
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
                <p className={`mt-1.5 text-xs ${strong}`}>{t("worldSponsorPress.lpHowToSubmit")} <span className={muted}>{c.submitVia}</span></p>
                <button type="button" className={`${chipBtn(isLight)} mt-2`} onClick={() => logCurator(c)}>
                  <Plus className="h-3.5 w-3.5" /> {t("worldSponsorPress.lpLogCuratorButton")}
                </button>
              </div>
            ))}
          </div>
        )}
        {curatorNotice ? <p className={`mt-2 text-[11px] ${muted}`}>{curatorNotice}</p> : null}
      </NativeCard>

      <NativeCard isLight={isLight} title={t("worldSponsorPress.lpPacketCardTitle")}>
        <p className={`mb-3 text-xs ${muted}`}>{t("playlistPitch.packetIntro")}</p>
        {releasesFailed ? (
          <NativeErrorState isLight={isLight} title={t("worldSponsorPress.lpReleasesErrorTitle")} message={t("worldSponsorPress.lpReleasesErrorMessage")} onRetry={() => setReleasesTick((n) => n + 1)} />
        ) : releases === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldSponsorPress.lpReleasesLoading")} />
        ) : releases.length === 0 ? (
          <NativeEmptyState isLight={isLight} message={t("worldSponsorPress.lpNoReleasesMessage")} detail={t("worldSponsorPress.lpNoReleasesDetail")} />
        ) : (
          <div className="space-y-3">
            <select aria-label={t("worldSponsorPress.lpReleaseSelectAria")} className={`${selectCls(isLight)} w-full`} value={packetReleaseId} onChange={(e) => void loadPacket(e.target.value)}>
              <option value="">{t("playlistPitch.packetReleasePick")}</option>
              {releases.map((r) => (
                <option key={r.id} value={r.id}>{r.title}{r.artistName ? ` — ${r.artistName}` : ""}</option>
              ))}
            </select>
            {packetLoading ? <NativeLoadingState isLight={isLight} message={t("worldSponsorPress.lpPacketBuilding")} /> : null}
            {packetFailed ? (
              <NativeErrorState isLight={isLight} title={t("worldSponsorPress.lpPacketErrorTitle")} message={t("worldSponsorPress.lpPacketErrorMessage")} onRetry={() => void loadPacket(packetReleaseId)} />
            ) : null}
            {packet ? (
              <div className="space-y-3" data-testid="world-playlist-pitch-packet">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className={`text-sm font-black ${strong}`}>{packet.releaseTitle} — {packet.artistName}</p>
                    <p className={`text-xs ${muted}`}>
                      {packet.releaseStatus}
                      {packet.releaseDate ? ` · ${packet.releaseDate}` : ""}
                      {packet.followerCount != null ? ` · ${t("playlistPitch.packetFollowers", { count: packet.followerCount.toLocaleString(i18n.language) })}` : ""}
                      {packet.totalPlays != null ? ` · ${t("playlistPitch.packetPlays", { count: packet.totalPlays.toLocaleString(i18n.language) })}` : ""}
                    </p>
                    {packet.artistBio ? <p className={`mt-1 text-xs ${muted}`}>{packet.artistBio}</p> : null}
                  </div>
                  <CopyTextButton isLight={isLight} label={t("playlistPitch.packetCopy")} text={packetAsText(packet, packetTextStrings(t))} />
                </div>
                {packet.genre.length ? <p className={`text-xs ${muted}`}>{t("worldSponsorPress.lpPacketGenreLine", { genres: packet.genre.join(", ") })}</p> : null}
                {packet.description ? <p className={`text-xs ${muted}`}>{packet.description}</p> : null}
                <div className="space-y-0.5">
                  {packet.presaveUrl ? <p className={`truncate text-xs ${muted}`}>{t("worldSponsorPress.lpPacketPresaveLine", { url: packet.presaveUrl })}</p> : null}
                  {Object.entries(packet.streaming).map(([platform, url]) => (
                    <p key={platform} className={`truncate text-xs ${muted}`}><span className={`capitalize ${strong}`}>{platform.replace(/_/g, " ")}</span> — {url}</p>
                  ))}
                  {packet.audioUrl ? <p className={`truncate text-xs ${muted}`}>{t("worldSponsorPress.lpPacketAudioLine", { url: packet.audioUrl })}</p> : null}
                  {packet.profileUrl ? <p className={`truncate text-xs ${muted}`}>{t("worldSponsorPress.lpPacketProfileLine", { url: packet.profileUrl })}</p> : null}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  <span className={`text-xs ${strong}`}>{t("worldSponsorPress.lpPacketStatPresaves", { count: packet.stats.presaves })}</span>
                  <span className={`text-xs ${strong}`}>{t("worldSponsorPress.lpPacketStatShares", { count: packet.stats.shares })}</span>
                  <span className={`text-xs ${strong}`}>{t("worldSponsorPress.lpPacketStatViews", { count: packet.stats.linkViews })}</span>
                  <span className={`text-xs ${strong}`}>{t("worldSponsorPress.lpPacketStatClicks", { count: packet.stats.linkClicks })}</span>
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
                    <p className={`text-xs font-bold ${strong}`}>{t("playlistPitch.packetMissingTitle")}</p>
                    <ul className={`mt-1 list-disc space-y-0.5 pl-5 text-xs ${muted}`}>
                      {packet.missing.map((m) => (<li key={m}>{packetMissingLabel(m, packetMissingStrings(t))}</li>))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : !packetLoading && !packetFailed ? (
              <p className={`text-xs ${muted}`}>{t("playlistPitch.packetNone")}</p>
            ) : null}
          </div>
        )}
      </NativeCard>

      <NativeCard isLight={isLight} title={t("worldSponsorPress.lpTrackerDeadlinesTitle")}>
        <div className="space-y-3">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={`text-xs font-black uppercase tracking-wider ${strong}`}>{t("playlistPitch.deadlinesTitle")}</p>
              <button type="button" className={chipBtn(isLight, showDeadlineForm)} aria-expanded={showDeadlineForm} onClick={() => setShowDeadlineForm((v) => !v)}>
                <Plus className="h-3.5 w-3.5" /> {t("playlistPitch.deadlineAdd")}
              </button>
            </div>
            {dueNext ? (
              <p className={`mt-2 rounded-xl border px-3 py-2 text-xs ${dueNext.overdue ? "border-red-500/40 bg-red-500/10 text-red-200" : isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                <span className="font-black uppercase">{t("worldSponsorPress.lpDueNextLabel")}</span> {dueNext.playlistName}
                {dueNext.curatorName ? ` · ${dueNext.curatorName}` : ""} · {new Date(dueNext.deadlineAt).toLocaleDateString(i18n.language)}
                {dueNext.overdue ? t("worldSponsorPress.lpOverdueSuffix") : ""}
              </p>
            ) : null}
            {showDeadlineForm ? (
              <div className="mt-2 space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input aria-label={t("worldSponsorPress.lpPlaylistName")} className={deskInputCls(isLight)} value={deadlineDraft.playlistName} maxLength={200} onChange={(e) => setDeadlineDraft({ ...deadlineDraft, playlistName: e.target.value })} placeholder={t("worldSponsorPress.lpPlaylistName")} />
                  <input aria-label={t("worldSponsorPress.lpCuratorNameAria")} className={deskInputCls(isLight)} value={deadlineDraft.curatorName} maxLength={200} onChange={(e) => setDeadlineDraft({ ...deadlineDraft, curatorName: e.target.value })} placeholder={t("worldSponsorPress.lpCuratorNameOptional")} />
                  <input aria-label={t("worldSponsorPress.lpDeadlineDateAria")} type="date" className={deskInputCls(isLight)} value={deadlineDraft.deadlineDate} onChange={(e) => setDeadlineDraft({ ...deadlineDraft, deadlineDate: e.target.value })} />
                  <select aria-label={t("worldSponsorPress.lpDeadlineReleaseAria")} className={selectCls(isLight)} value={deadlineDraft.releaseId} onChange={(e) => setDeadlineDraft({ ...deadlineDraft, releaseId: e.target.value })}>
                    <option value="">{t("worldSponsorPress.lpNoReleaseLinked")}</option>
                    {(releases ?? []).map((r) => (<option key={r.id} value={r.id}>{r.title}</option>))}
                  </select>
                </div>
                <button type="button" className={goldBtn} onClick={() => void addDeadline()}>{t("worldSponsorPress.lpSaveDeadline")}</button>
              </div>
            ) : null}
            {deadlineNote ? <p className="mt-1 text-xs font-semibold text-red-400">{deadlineNote}</p> : null}
            {deadlinesFailed ? (
              <NativeErrorState isLight={isLight} title={t("worldSponsorPress.lpDeadlinesErrorTitle")} message={t("worldSponsorPress.lpDeadlinesErrorMessage")} onRetry={() => setDeadlinesTick((n) => n + 1)} />
            ) : deadlines === null ? (
              <NativeLoadingState isLight={isLight} message={t("worldSponsorPress.lpDeadlinesLoading")} />
            ) : deadlines.length === 0 ? (
              <NativeEmptyState isLight={isLight} message={t("worldSponsorPress.lpNoDeadlinesMessage")} detail={t("worldSponsorPress.lpNoDeadlinesDetail")} />
            ) : (
              <div className="mt-2 space-y-2">
                {deadlines.map((d) => (
                  <div key={d.id} className={`space-y-2 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className={`text-sm font-black ${strong}`}>{d.playlistName}{d.curatorName ? <span className={`font-normal ${muted}`}> · {d.curatorName}</span> : null}</p>
                        <p className={`text-xs ${muted}`}>{t("worldSponsorPress.lpDeadlineDueLine", { date: new Date(d.deadlineAt).toLocaleDateString(i18n.language) })}{d.overdue ? t("worldSponsorPress.lpOverdueSuffix") : ""}{d.notes ? ` · ${d.notes}` : ""}</p>
                      </div>
                      <DeleteButton armed={armedDeadlineId === d.id} onArm={() => setArmedDeadlineId(d.id)} onDelete={() => void deleteDeadline(d.id)} label={t("worldSponsorPress.lpDeleteDeadlineAria", { name: d.playlistName })} />
                    </div>
                    <StatusRow isLight={isLight} statuses={PLAYLIST_DEADLINE_STATUSES} current={d.status} onPick={(st) => void updateDeadlineStatus(d.id, st)} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-[#d4af37]/20 pt-3">
            {trackerFailed ? (
              <NativeErrorState isLight={isLight} title={t("worldSponsorPress.lpTrackerErrorTitle")} message={t("worldSponsorPress.lpTrackerErrorMessage")} onRetry={() => setTrackerTick((n) => n + 1)} />
            ) : pitches === null ? (
              <NativeLoadingState isLight={isLight} message={t("worldSponsorPress.lpTrackerLoading")} />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={`inline-flex items-center gap-1.5 text-xs ${muted}`}><ClipboardList className="h-3.5 w-3.5" /> {t("worldSponsorPress.lpPitchesCount", { count: pitches.length, accepted: pitches.filter((p) => p.status === "accepted").length })}</p>
                  <button type="button" className={chipBtn(isLight, showAdd)} aria-expanded={showAdd} onClick={() => setShowAdd((v) => !v)}>
                    <Plus className="h-3.5 w-3.5" /> {t("worldSponsorPress.lpLogPitch")}
                  </button>
                </div>
                {showAdd ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input aria-label={t("worldSponsorPress.lpSongTitle")} className={deskInputCls(isLight)} value={draft.songTitle} maxLength={200} onChange={(e) => setDraft({ ...draft, songTitle: e.target.value })} placeholder={t("worldSponsorPress.lpSongTitle")} />
                      <input aria-label={t("worldSponsorPress.lpPlaylistName")} className={deskInputCls(isLight)} value={draft.playlistName} maxLength={200} onChange={(e) => setDraft({ ...draft, playlistName: e.target.value })} placeholder={t("worldSponsorPress.lpPlaylistName")} />
                      <input aria-label={t("worldSponsorPress.lpArtistName")} className={deskInputCls(isLight)} value={draft.artistName} maxLength={200} onChange={(e) => setDraft({ ...draft, artistName: e.target.value })} placeholder={t("worldSponsorPress.lpArtistNameOptional")} />
                      <input aria-label={t("worldSponsorPress.lpCuratorNameAria")} className={deskInputCls(isLight)} value={draft.curatorName} maxLength={200} onChange={(e) => setDraft({ ...draft, curatorName: e.target.value })} placeholder={t("worldSponsorPress.lpCuratorNameOptional")} />
                    </div>
                    <textarea aria-label={t("worldSponsorPress.lpNotesAria")} className={deskInputCls(isLight)} value={draft.notes} maxLength={1000} rows={2} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder={t("worldSponsorPress.lpNotesOptional")} />
                    <button type="button" className={goldBtn} onClick={() => void addPitch()}>{t("worldSponsorPress.lpSavePitch")}</button>
                  </div>
                ) : null}
                {trackerNote ? <p className="text-xs font-semibold text-red-400">{trackerNote}</p> : null}
                {pitches.length === 0 ? (
                  <NativeEmptyState isLight={isLight} message={t("worldSponsorPress.lpNoPitchesMessage")} detail={t("worldSponsorPress.lpNoPitchesDetail")} />
                ) : (
                  pitches.map((p) => (
                    <div key={p.id} className={`space-y-2 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-black ${strong}`}>{p.songTitle}{p.artistName ? <span className={`font-normal ${muted}`}> — {p.artistName}</span> : null}</p>
                          <p className={`text-xs ${muted}`}>{p.playlistName}{p.curatorName ? ` · ${p.curatorName}` : ""}{p.contactedAt ? ` · ${new Date(p.contactedAt).toLocaleDateString(i18n.language)}` : ""}</p>
                          {p.notes ? <p className={`mt-1 text-xs italic ${muted}`}>{p.notes}</p> : null}
                        </div>
                        <DeleteButton armed={armedDeleteId === p.id} onArm={() => setArmedDeleteId(p.id)} onDelete={() => void deletePitch(p.id)} label={t("worldSponsorPress.lpDeletePitchAria", { name: p.songTitle })} />
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
  const { t } = useTranslation();
  const [mode, setMode] = useState<"labels" | "playlists">("labels");
  if (isGuest) return <GuestGate isLight={isLight} />;
  return (
    <div className="space-y-3" data-testid="world-label-pitch-desk">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("worldSponsorPress.lpModeAria")}>
        <button type="button" role="tab" aria-selected={mode === "labels"} className={chipBtn(isLight, mode === "labels")} onClick={() => setMode("labels")}>
          <Building2 className="h-3.5 w-3.5" /> {t("worldSponsorPress.lpTabLabels")}
        </button>
        <button type="button" role="tab" aria-selected={mode === "playlists"} className={chipBtn(isLight, mode === "playlists")} onClick={() => setMode("playlists")}>
          <ListMusic className="h-3.5 w-3.5" /> {t("worldSponsorPress.lpTabPlaylists")}
        </button>
        <span className={`inline-flex items-center gap-1.5 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/45"}`}>
          <Disc3 className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldSponsorPress.lpTagline")}
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
