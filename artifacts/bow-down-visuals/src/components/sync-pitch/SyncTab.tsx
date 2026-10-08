import { useEffect, useState } from "react";
import {
  Sparkles, Loader2, Copy, Check, Mail, ClipboardList, Plus, Trash2,
  Send, Clock, Trophy, XCircle, AlertTriangle, ChevronDown, Music2,
  Share2, FileText, Briefcase, Target, DollarSign, Disc3, Link2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useTranslation } from "react-i18next";

/* ─── Sync Pitch Kit tab (docked inside Playlist Pitcher) ─────────────────
   DistroKid-style sync licensing pitching:
   - One-sheet generator: song → AI-written sync one-sheet (mood tags, BPM,
     key, comparable artists, "sounds like", instrumental/stems flags,
     contact info), 150 VB, shareable public link with ?ref=CODE.
   - Sync brief board: user creates TV/film/ad/game briefs and matches
     their catalog songs (one-sheets) against them.
   - Pitch tracker: sent → pending → placed (placed syncs can log income
     to the Money Tracker).

   Handoffs: from song results → /playlist-pitch?tab=sync&song=TITLE;
   one-sheet → sponsor outreach (/sponsors/pitch) and stems/mix tools
   (/stems, /mix-master); placed syncs → Money Tracker (POST /api/money). */

const ONE_SHEET_COST = 150;

type SubTab = "onesheet" | "briefs" | "tracker";

interface LibrarySong {
  id: string;
  title?: string;
  audio_url?: string;
}

interface OneSheetContent {
  logline: string;
  moodTags: string[];
  soundsLike: string;
  comparableArtists: string[];
  syncUses: string[];
  pitchEmail: { subject: string; body: string };
  licensingNotes: string;
  disclaimer: string;
}

interface OneSheet {
  id: string;
  songTitle: string;
  artistName?: string | null;
  songLibraryId?: string | null;
  content: OneSheetContent;
  moodTags: string[];
  bpm?: string | null;
  musicalKey?: string | null;
  comparableArtists: string[];
  soundsLike?: string | null;
  instrumentalAvailable: boolean;
  stemsAvailable: boolean;
  contactName?: string | null;
  contactEmail?: string | null;
  shareToken: string;
  createdAt?: string | null;
}

interface SyncBrief {
  id: string;
  title: string;
  projectType: string;
  mood: string;
  budgetRange: string;
  deadline?: string | null;
  notes?: string | null;
  createdAt?: string | null;
}

interface BriefMatch {
  oneSheet: OneSheet;
  score: number;
  overlap: number;
}

interface SyncPitch {
  id: string;
  oneSheetId?: string | null;
  briefId?: string | null;
  songTitle: string;
  targetName?: string | null;
  status: string;
  notes?: string | null;
  contactedAt?: string | null;
  createdAt?: string | null;
}

const SYNC_STATUS_META: Record<string, { labelKey: string; icon: typeof Send; cls: string }> = {
  sent: { labelKey: "syncPitch.statusSent", icon: Send, cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  pending: { labelKey: "syncPitch.statusPending", icon: Clock, cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  placed: { labelKey: "syncPitch.statusPlaced", icon: Trophy, cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  dead: { labelKey: "syncPitch.statusDead", icon: XCircle, cls: "border-red-500/40 bg-red-500/10 text-red-300" },
};

const PROJECT_TYPE_META: Record<string, { labelKey: string; cls: string }> = {
  tv: { labelKey: "syncPitch.typeTv", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  film: { labelKey: "syncPitch.typeFilm", cls: "border-purple-500/40 bg-purple-500/10 text-purple-300" },
  ad: { labelKey: "syncPitch.typeAd", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  game: { labelKey: "syncPitch.typeGame", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
};

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const checkClass = "h-4 w-4 rounded accent-[#d4af37]";

function CopyButton({ text, labelKey }: { text: string; labelKey: string }) {
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
      aria-label={t("syncPitch.copyAria", { label: t(labelKey) })}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t("syncPitch.copied") : t("syncPitch.copyLabel", { label: t(labelKey) })}
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

export default function SyncTab({
  library,
  initialSongTitle,
}: {
  library: LibrarySong[];
  initialSongTitle?: string;
}) {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [subTab, setSubTab] = useState<SubTab>("onesheet");

  /* ── generator state ── */
  const [songSource, setSongSource] = useState<"library" | "manual">("manual");
  const [librarySongId, setLibrarySongId] = useState("");
  const [songTitle, setSongTitle] = useState(initialSongTitle ?? "");
  const [artistName, setArtistName] = useState("");
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [bpm, setBpm] = useState("");
  const [musicalKey, setMusicalKey] = useState("");
  const [energy, setEnergy] = useState(60);
  const [description, setDescription] = useState("");
  const [instrumentalAvailable, setInstrumentalAvailable] = useState(false);
  const [stemsAvailable, setStemsAvailable] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sheet, setSheet] = useState<OneSheet | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [shared, setShared] = useState(false);

  /* ── one-sheet library state ── */
  const [sheets, setSheets] = useState<OneSheet[]>([]);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [viewSheetId, setViewSheetId] = useState<string | null>(null);

  /* ── brief board state ── */
  const [briefs, setBriefs] = useState<SyncBrief[]>([]);
  const [briefsLoading, setBriefsLoading] = useState(false);
  const [showBriefForm, setShowBriefForm] = useState(false);
  const [newBrief, setNewBrief] = useState({
    title: "", projectType: "tv", mood: "", budgetRange: "", deadline: "", notes: "",
  });
  const [matchBriefId, setMatchBriefId] = useState<string | null>(null);
  const [matches, setMatches] = useState<BriefMatch[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);

  /* ── tracker state ── */
  const [pitches, setPitches] = useState<SyncPitch[]>([]);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPitch, setNewPitch] = useState({ songTitle: "", targetName: "", notes: "" });
  const [referralCode, setReferralCode] = useState("");
  const [loggingIncome, setLoggingIncome] = useState<string | null>(null);
  const [incomeAmount, setIncomeAmount] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialSongTitle) setSongTitle(initialSongTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSongTitle]);

  useEffect(() => {
    if (!user) return;
    loadSheets();
    loadBriefs();
    loadTracker();
    (async () => {
      try {
        const { res, data } = await authedFetch(getAccessToken, "/api/referrals/me");
        if (res.ok && typeof (data as { code?: unknown }).code === "string") {
          setReferralCode((data as { code: string }).code);
        }
      } catch { /* referral code is optional */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function loadSheets() {
    setSheetsLoading(true);
    try {
      const { res, data } = await authedFetch(getAccessToken, "/api/sync-pitch/one-sheets");
      if (res.ok) setSheets((data as { oneSheets: OneSheet[] }).oneSheets ?? []);
    } catch { /* non-fatal */ }
    finally { setSheetsLoading(false); }
  }

  async function loadBriefs() {
    setBriefsLoading(true);
    try {
      const { res, data } = await authedFetch(getAccessToken, "/api/sync-pitch/briefs");
      if (res.ok) setBriefs((data as { briefs: SyncBrief[] }).briefs ?? []);
    } catch { /* non-fatal */ }
    finally { setBriefsLoading(false); }
  }

  async function loadTracker() {
    setTrackerLoading(true);
    try {
      const { res, data } = await authedFetch(getAccessToken, "/api/sync-pitch/tracker");
      if (res.ok) setPitches((data as { pitches: SyncPitch[] }).pitches ?? []);
    } catch { /* non-fatal */ }
    finally { setTrackerLoading(false); }
  }

  async function generateSheet() {
    if (generating || !user) return;
    const finalTitle = songSource === "library"
      ? (library.find((s) => s.id === librarySongId)?.title ?? "").trim()
      : songTitle.trim();
    if (!finalTitle) {
      setError(t("syncPitch.titleRequired"));
      return;
    }
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const { res, data } = await authedFetch(getAccessToken, "/api/sync-pitch/one-sheet", {
        method: "POST",
        body: JSON.stringify({
          songTitle: finalTitle,
          artistName: artistName.trim(),
          songLibraryId: songSource === "library" && librarySongId ? librarySongId : undefined,
          genre: genre.trim(),
          mood: mood.trim(),
          bpm: bpm.trim(),
          musicalKey: musicalKey.trim(),
          energy,
          description: description.trim(),
          instrumentalAvailable,
          stemsAvailable,
          contactName: contactName.trim(),
          contactEmail: contactEmail.trim(),
        }),
      });
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !(data as { oneSheet?: OneSheet }).oneSheet) {
        throw new Error(data.message || (typeof data.error === "string" ? data.error : "") || t("syncPitch.kitFailed"));
      }
      const oneSheet = (data as { oneSheet: OneSheet }).oneSheet;
      setSheet(oneSheet);
      setSheets((prev) => [oneSheet, ...prev]);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("sync-onesheet-result")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("syncPitch.kitFailed"));
    } finally {
      setGenerating(false);
    }
  }

  async function deleteSheet(id: string) {
    try {
      const { res } = await authedFetch(getAccessToken, `/api/sync-pitch/one-sheets/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSheets((prev) => prev.filter((s) => s.id !== id));
        if (sheet?.id === id) setSheet(null);
        if (viewSheetId === id) setViewSheetId(null);
      }
    } catch { /* non-fatal */ }
  }

  function shareUrlFor(s: OneSheet): string {
    const base = `${window.location.origin}/sync-one-sheet/${s.shareToken}`;
    return referralCode ? `${base}?ref=${encodeURIComponent(referralCode)}` : base;
  }

  async function copyShareLink(s: OneSheet) {
    try {
      await navigator.clipboard.writeText(shareUrlFor(s));
      setShared(true);
      setTimeout(() => setShared(false), 1600);
    } catch { /* clipboard unavailable */ }
  }

  async function addBrief() {
    if (!newBrief.title.trim()) {
      setError(t("syncPitch.briefTitleRequired"));
      return;
    }
    setError(null);
    try {
      const { res, data } = await authedFetch(getAccessToken, "/api/sync-pitch/briefs", {
        method: "POST",
        body: JSON.stringify({
          title: newBrief.title.trim(),
          projectType: newBrief.projectType,
          mood: newBrief.mood.trim(),
          budgetRange: newBrief.budgetRange.trim(),
          deadline: newBrief.deadline || undefined,
          notes: newBrief.notes.trim(),
        }),
      });
      if (!res.ok) throw new Error(t("syncPitch.saveFailed"));
      const brief = (data as { brief: SyncBrief }).brief;
      setBriefs((prev) => [brief, ...prev]);
      setNewBrief({ title: "", projectType: "tv", mood: "", budgetRange: "", deadline: "", notes: "" });
      setShowBriefForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("syncPitch.saveFailed"));
    }
  }

  async function deleteBrief(id: string) {
    try {
      const { res } = await authedFetch(getAccessToken, `/api/sync-pitch/briefs/${id}`, { method: "DELETE" });
      if (res.ok) {
        setBriefs((prev) => prev.filter((b) => b.id !== id));
        if (matchBriefId === id) { setMatchBriefId(null); setMatches([]); }
      }
    } catch { /* non-fatal */ }
  }

  async function loadMatches(briefId: string) {
    setMatchBriefId(briefId);
    setMatchesLoading(true);
    try {
      const { res, data } = await authedFetch(
        getAccessToken, `/api/sync-pitch/briefs/${briefId}/matches`,
      );
      if (res.ok) setMatches((data as { matches: BriefMatch[] }).matches ?? []);
    } catch { setMatches([]); }
    finally { setMatchesLoading(false); }
  }

  async function addPitch() {
    if (!newPitch.songTitle.trim()) {
      setError(t("syncPitch.titleRequired"));
      return;
    }
    setError(null);
    try {
      const { res, data } = await authedFetch(getAccessToken, "/api/sync-pitch/tracker", {
        method: "POST",
        body: JSON.stringify({
          songTitle: newPitch.songTitle.trim(),
          targetName: newPitch.targetName.trim(),
          notes: newPitch.notes.trim(),
        }),
      });
      if (!res.ok) throw new Error(t("syncPitch.saveFailed"));
      const pitch = (data as { pitch: SyncPitch }).pitch;
      setPitches((prev) => [pitch, ...prev]);
      setNewPitch({ songTitle: "", targetName: "", notes: "" });
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("syncPitch.saveFailed"));
    }
  }

  async function updatePitchStatus(id: string, status: string) {
    try {
      const { res, data } = await authedFetch(getAccessToken, `/api/sync-pitch/tracker/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(t("syncPitch.updateFailed"));
      const updated = (data as { pitch: SyncPitch }).pitch;
      setPitches((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch { /* non-fatal */ }
  }

  async function deletePitch(id: string) {
    try {
      const { res } = await authedFetch(getAccessToken, `/api/sync-pitch/tracker/${id}`, {
        method: "DELETE",
      });
      if (res.ok) setPitches((prev) => prev.filter((p) => p.id !== id));
    } catch { /* non-fatal */ }
  }

  /* Handoff: placed sync → Money Tracker income entry. */
  async function logToMoneyTracker(p: SyncPitch) {
    const raw = (incomeAmount[p.id] ?? "").replace(/[^0-9.]/g, "");
    const dollars = parseFloat(raw);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError(t("syncPitch.incomeAmountRequired"));
      return;
    }
    setLoggingIncome(p.id);
    setError(null);
    try {
      const { res, data } = await authedFetch(getAccessToken, "/api/money", {
        method: "POST",
        body: JSON.stringify({
          type: "income",
          category: "sync_placement",
          amountCents: Math.round(dollars * 100),
          note: `Sync placement: ${p.songTitle}${p.targetName ? ` — ${p.targetName}` : ""}`,
          source: "Sync Pitch Kit",
        }),
      });
      if (!res.ok) throw new Error(t("syncPitch.moneyLogFailed"));
      void data;
      setIncomeAmount((prev) => ({ ...prev, [p.id]: "" }));
      window.location.href = "/coach";
    } catch (err) {
      setError(err instanceof Error ? err.message : t("syncPitch.moneyLogFailed"));
    } finally {
      setLoggingIncome(null);
    }
  }

  function prefillFromBrief(b: SyncBrief) {
    setMood(b.mood);
    setSubTab("onesheet");
    setTimeout(() => {
      document.getElementById("sync-onesheet-generator")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  const placedCount = pitches.filter((p) => p.status === "placed").length;

  return (
    <div className="relative mt-8">
      {/* sub-tabs */}
      <div className="flex flex-wrap justify-center gap-2">
        {([
          { key: "onesheet", labelKey: "syncPitch.subTabOneSheet", icon: FileText },
          { key: "briefs", labelKey: "syncPitch.subTabBriefs", icon: Briefcase },
          { key: "tracker", labelKey: "syncPitch.subTabTracker", icon: ClipboardList },
        ] as { key: SubTab; labelKey: string; icon: typeof FileText }[]).map((item) => {
          const Icon = item.icon;
          const active = subTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setSubTab(item.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
                active
                  ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                  : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {t(item.labelKey)}
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

      {/* ═══ ONE-SHEET TAB ═══ */}
      {subTab === "onesheet" && (
        <div id="sync-onesheet-generator" className="relative mt-6">
          <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("syncPitch.yourSong")}
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
                  {s === "manual" ? t("syncPitch.enterManually") : t("syncPitch.fromLibrary", { count: library.length })}
                </button>
              ))}
            </div>

            {songSource === "library" ? (
              <select
                value={librarySongId}
                onChange={(e) => setLibrarySongId(e.target.value)}
                className={`${inputClass} mt-4`}
              >
                <option value="">{t("syncPitch.pickSong")}</option>
                {library.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title || t("syncPitch.untitledSong")}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={songTitle}
                onChange={(e) => setSongTitle(e.target.value)}
                maxLength={200}
                placeholder={t("syncPitch.songTitlePlaceholder")}
                className={`${inputClass} mt-4`}
              />
            )}

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input
                value={artistName}
                onChange={(e) => setArtistName(e.target.value)}
                maxLength={200}
                placeholder={t("syncPitch.artistNamePlaceholder")}
                className={inputClass}
              />
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                maxLength={100}
                placeholder={t("syncPitch.genrePlaceholder")}
                className={inputClass}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <input
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                maxLength={200}
                placeholder={t("syncPitch.moodPlaceholder")}
                className={inputClass}
              />
              <input
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                maxLength={20}
                placeholder={t("syncPitch.bpmPlaceholder")}
                className={inputClass}
              />
              <input
                value={musicalKey}
                onChange={(e) => setMusicalKey(e.target.value)}
                maxLength={20}
                placeholder={t("syncPitch.keyPlaceholder")}
                className={inputClass}
              />
            </div>

            {/* instrumental / stems availability flags */}
            <div className="mt-4 flex flex-wrap gap-5">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-white/75">
                <input
                  type="checkbox"
                  checked={instrumentalAvailable}
                  onChange={(e) => setInstrumentalAvailable(e.target.checked)}
                  className={checkClass}
                />
                {t("syncPitch.instrumentalAvailable")}
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-white/75">
                <input
                  type="checkbox"
                  checked={stemsAvailable}
                  onChange={(e) => setStemsAvailable(e.target.checked)}
                  className={checkClass}
                />
                {t("syncPitch.stemsAvailable")}
              </label>
            </div>
            <p className="mt-2 text-xs text-white/40">{t("syncPitch.stemsHint")}</p>

            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              {t("syncPitch.advancedDetails")}
              <ChevronDown className={`h-4 w-4 transition ${showAdvanced ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder={t("syncPitch.descriptionPlaceholder")}
                  className={`${inputClass} resize-y`}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    maxLength={200}
                    placeholder={t("syncPitch.contactNamePlaceholder")}
                    className={inputClass}
                  />
                  <input
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    maxLength={200}
                    placeholder={t("syncPitch.contactEmailPlaceholder")}
                    className={inputClass}
                  />
                </div>
              </div>
            )}

            <button
              onClick={generateSheet}
              disabled={generating || !user}
              className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-base font-black text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              )}
              {generating ? t("syncPitch.writingSheet") : t("syncPitch.generateSheet", { cost: ONE_SHEET_COST })}
            </button>
            {!user && (
              <p className="mt-3 text-center text-sm text-white/40">
                {t("syncPitch.signInPrompt")}
              </p>
            )}
          </div>

          {/* one-sheet result */}
          {sheet && (
            <div id="sync-onesheet-result" className="mt-8">
              <OneSheetView
                sheet={sheet}
                shareUrl={shareUrlFor(sheet)}
                onCopyShare={() => copyShareLink(sheet)}
                shared={shared}
                onAddToTracker={() => {
                  setNewPitch({ songTitle: sheet.songTitle, targetName: "", notes: "" });
                  setSubTab("tracker");
                  setShowAddForm(true);
                }}
              />
            </div>
          )}

          {/* my one-sheets */}
          <div className="mt-10">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-black">
                <Disc3 className="h-5 w-5 text-primary" aria-hidden="true" />
                {t("syncPitch.myOneSheets")}
              </h2>
              <span className="text-sm text-white/50">
                <span className="font-black text-white">{sheets.length}</span>
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {sheetsLoading && (
                <p className="py-10 text-center text-sm text-white/40">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-hidden="true" />
                </p>
              )}
              {!sheetsLoading && sheets.map((s) => (
                <div key={s.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-black text-white">
                        {s.songTitle}
                        {s.artistName ? <span className="font-normal text-white/45"> — {s.artistName}</span> : null}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {s.moodTags.slice(0, 5).map((m) => (
                          <span key={m} className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                            {m}
                          </span>
                        ))}
                        {s.instrumentalAvailable && (
                          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                            {t("syncPitch.tagInstrumental")}
                          </span>
                        )}
                        {s.stemsAvailable && (
                          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                            {t("syncPitch.tagStems")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyShareLink(s)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20"
                      >
                        <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {shared ? t("syncPitch.linkCopied") : t("syncPitch.shareSheet")}
                      </button>
                      <button
                        onClick={() => setViewSheetId(viewSheetId === s.id ? null : s.id)}
                        className="rounded-xl border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-white"
                      >
                        {viewSheetId === s.id ? t("syncPitch.hide") : t("syncPitch.view")}
                      </button>
                      <button
                        onClick={() => deleteSheet(s.id)}
                        className="rounded-lg p-1.5 text-white/30 transition hover:bg-red-500/10 hover:text-red-300"
                        aria-label={t("syncPitch.deleteSheet")}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {viewSheetId === s.id && (
                    <div className="mt-5 border-t border-white/10 pt-5">
                      <OneSheetView
                        sheet={s}
                        shareUrl={shareUrlFor(s)}
                        onCopyShare={() => copyShareLink(s)}
                        shared={shared}
                        onAddToTracker={() => {
                          setNewPitch({ songTitle: s.songTitle, targetName: "", notes: "" });
                          setSubTab("tracker");
                          setShowAddForm(true);
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
              {!sheetsLoading && sheets.length === 0 && (
                <div className="rounded-3xl border border-dashed border-white/15 p-10 text-center">
                  <FileText className="mx-auto h-8 w-8 text-white/25" aria-hidden="true" />
                  <p className="mt-3 text-sm text-white/50">{t("syncPitch.noSheets")}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ BRIEF BOARD TAB ═══ */}
      {subTab === "briefs" && (
        <div className="relative mt-6">
          <div className="flex items-center justify-between">
            <p className="max-w-xl text-sm text-white/55">{t("syncPitch.briefsIntro")}</p>
            <button
              onClick={() => setShowBriefForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-black text-black transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("syncPitch.newBrief")}
            </button>
          </div>

          {showBriefForm && (
            <div className="mt-4 rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  value={newBrief.title}
                  onChange={(e) => setNewBrief({ ...newBrief, title: e.target.value })}
                  maxLength={200}
                  placeholder={t("syncPitch.briefTitlePlaceholder")}
                  className={inputClass}
                />
                <select
                  value={newBrief.projectType}
                  onChange={(e) => setNewBrief({ ...newBrief, projectType: e.target.value })}
                  className={inputClass}
                >
                  {(["tv", "film", "ad", "game"] as const).map((pt) => (
                    <option key={pt} value={pt}>{t(PROJECT_TYPE_META[pt]!.labelKey)}</option>
                  ))}
                </select>
                <input
                  value={newBrief.mood}
                  onChange={(e) => setNewBrief({ ...newBrief, mood: e.target.value })}
                  maxLength={200}
                  placeholder={t("syncPitch.briefMoodPlaceholder")}
                  className={inputClass}
                />
                <input
                  value={newBrief.budgetRange}
                  onChange={(e) => setNewBrief({ ...newBrief, budgetRange: e.target.value })}
                  maxLength={100}
                  placeholder={t("syncPitch.budgetPlaceholder")}
                  className={inputClass}
                />
                <input
                  type="date"
                  value={newBrief.deadline}
                  onChange={(e) => setNewBrief({ ...newBrief, deadline: e.target.value })}
                  className={inputClass}
                />
              </div>
              <textarea
                value={newBrief.notes}
                onChange={(e) => setNewBrief({ ...newBrief, notes: e.target.value })}
                maxLength={1000}
                rows={2}
                placeholder={t("syncPitch.briefNotesPlaceholder")}
                className={`${inputClass} mt-3 resize-y`}
              />
              <div className="mt-4 flex gap-2">
                <button
                  onClick={addBrief}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  {t("syncPitch.saveBrief")}
                </button>
                <button
                  onClick={() => setShowBriefForm(false)}
                  className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold text-white/60 transition hover:text-white"
                >
                  {t("syncPitch.cancel")}
                </button>
              </div>
            </div>
          )}

          <div className="mt-5 space-y-4">
            {briefsLoading && (
              <p className="py-10 text-center text-sm text-white/40">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-hidden="true" />
              </p>
            )}
            {!briefsLoading && briefs.map((b) => {
              const ptm = PROJECT_TYPE_META[b.projectType] ?? PROJECT_TYPE_META["tv"]!;
              const open = matchBriefId === b.id;
              return (
                <div key={b.id} className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-black text-white">{b.title}</h3>
                        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${ptm.cls}`}>
                          {t(ptm.labelKey)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-white/55">
                        {b.mood || t("syncPitch.noMood")}
                        {b.budgetRange ? <span className="text-white/35"> · {b.budgetRange}</span> : null}
                        {b.deadline ? <span className="text-white/35"> · {t("syncPitch.deadlineLabel", { date: b.deadline })}</span> : null}
                      </p>
                      {b.notes ? <p className="mt-2 text-[13px] italic text-white/40">{b.notes}</p> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => (open ? (setMatchBriefId(null), setMatches([])) : loadMatches(b.id))}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition hover:bg-primary/20"
                      >
                        <Target className="h-4 w-4" aria-hidden="true" />
                        {open ? t("syncPitch.hideMatches") : t("syncPitch.matchSongs")}
                      </button>
                      <button
                        onClick={() => prefillFromBrief(b)}
                        className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-white"
                      >
                        {t("syncPitch.newSheetFromBrief")}
                      </button>
                      <button
                        onClick={() => deleteBrief(b.id)}
                        className="rounded-lg p-1.5 text-white/30 transition hover:bg-red-500/10 hover:text-red-300"
                        aria-label={t("syncPitch.deleteBrief")}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {open && (
                    <div className="mt-5 border-t border-white/10 pt-5">
                      {matchesLoading && (
                        <p className="py-6 text-center text-sm text-white/40">
                          <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-hidden="true" />
                        </p>
                      )}
                      {!matchesLoading && matches.length > 0 && (
                        <div className="space-y-3">
                          {matches.map((m) => (
                            <div key={m.oneSheet.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/40 p-4">
                              <div className="min-w-0">
                                <p className="font-bold text-white">{m.oneSheet.songTitle}</p>
                                <p className="mt-0.5 text-xs text-white/45">
                                  {m.oneSheet.moodTags.slice(0, 4).join(" · ") || t("syncPitch.noMoodTags")}
                                </p>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className={`rounded-full px-3 py-1 text-xs font-black ${m.score >= 6 ? "bg-emerald-500/15 text-emerald-300" : m.score >= 3 ? "bg-amber-500/15 text-amber-300" : "bg-white/[0.06] text-white/50"}`}>
                                  {t("syncPitch.matchScore", { score: m.score })}
                                </span>
                                <button
                                  onClick={() => {
                                    setNewPitch({ songTitle: m.oneSheet.songTitle, targetName: b.title, notes: "" });
                                    setSubTab("tracker");
                                    setShowAddForm(true);
                                  }}
                                  className="rounded-xl bg-primary px-3 py-1.5 text-xs font-black text-black transition hover:brightness-110"
                                >
                                  {t("syncPitch.pitchThis")}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {!matchesLoading && matches.length === 0 && (
                        <p className="py-6 text-center text-sm text-white/40">{t("syncPitch.noMatches")}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!briefsLoading && briefs.length === 0 && (
              <div className="rounded-3xl border border-dashed border-white/15 p-10 text-center">
                <Briefcase className="mx-auto h-8 w-8 text-white/25" aria-hidden="true" />
                <p className="mt-3 text-sm text-white/50">{t("syncPitch.noBriefs")}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ PITCH TRACKER TAB ═══ */}
      {subTab === "tracker" && (
        <div className="relative mt-6">
          <div className="flex items-center justify-between">
            <div className="flex gap-4 text-sm">
              <span className="text-white/50">
                <span className="font-black text-white">{pitches.length}</span> {t("syncPitch.pitchesCount")}
              </span>
              <span className="text-white/50">
                <span className="font-black text-emerald-300">{placedCount}</span> {t("syncPitch.placedCount")}
              </span>
            </div>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-black text-black transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("syncPitch.logPitch")}
            </button>
          </div>

          {showAddForm && (
            <div className="mt-4 rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  value={newPitch.songTitle}
                  onChange={(e) => setNewPitch({ ...newPitch, songTitle: e.target.value })}
                  maxLength={200}
                  placeholder={t("syncPitch.songTitlePlaceholder")}
                  className={inputClass}
                />
                <input
                  value={newPitch.targetName}
                  onChange={(e) => setNewPitch({ ...newPitch, targetName: e.target.value })}
                  maxLength={200}
                  placeholder={t("syncPitch.targetPlaceholder")}
                  className={inputClass}
                />
              </div>
              <textarea
                value={newPitch.notes}
                onChange={(e) => setNewPitch({ ...newPitch, notes: e.target.value })}
                maxLength={1000}
                rows={2}
                placeholder={t("syncPitch.notesPlaceholder")}
                className={`${inputClass} mt-3 resize-y`}
              />
              <div className="mt-4 flex gap-2">
                <button
                  onClick={addPitch}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  {t("syncPitch.savePitch")}
                </button>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold text-white/60 transition hover:text-white"
                >
                  {t("syncPitch.cancel")}
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
              const meta = SYNC_STATUS_META[p.status] ?? SYNC_STATUS_META["sent"]!;
              const Icon = meta.icon;
              return (
                <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-black text-white">{p.songTitle}</p>
                      <p className="mt-1 text-sm text-white/55">
                        {p.targetName || t("syncPitch.noTarget")}
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
                        aria-label={t("syncPitch.deletePitch")}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(SYNC_STATUS_META).map(([key, m]) => (
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
                        {t("syncPitch.markStatus", { status: t(m.labelKey).toLowerCase() })}
                      </button>
                    ))}
                  </div>
                  {/* placed → Money Tracker handoff */}
                  {p.status === "placed" && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3.5">
                      <DollarSign className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                      <span className="text-xs font-semibold text-emerald-200/90">
                        {t("syncPitch.placedPrompt")}
                      </span>
                      <input
                        value={incomeAmount[p.id] ?? ""}
                        onChange={(e) => setIncomeAmount((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        inputMode="decimal"
                        placeholder={t("syncPitch.amountPlaceholder")}
                        className="w-32 rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-emerald-500/60"
                      />
                      <button
                        onClick={() => logToMoneyTracker(p)}
                        disabled={loggingIncome === p.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-black text-black transition hover:brightness-110 disabled:opacity-50"
                      >
                        {loggingIncome === p.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          : <DollarSign className="h-3.5 w-3.5" aria-hidden="true" />}
                        {t("syncPitch.logToMoney")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {!trackerLoading && pitches.length === 0 && (
              <div className="rounded-3xl border border-dashed border-white/15 p-10 text-center">
                <ClipboardList className="mx-auto h-8 w-8 text-white/25" aria-hidden="true" />
                <p className="mt-3 text-sm text-white/50">{t("syncPitch.noPitches")}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── One-sheet display (print-friendly card) ──────────────────────────────── */

function OneSheetView({
  sheet,
  shareUrl,
  onCopyShare,
  shared,
  onAddToTracker,
}: {
  sheet: OneSheet;
  shareUrl: string;
  onCopyShare: () => void;
  shared: boolean;
  onAddToTracker: () => void;
}) {
  const { t } = useTranslation();
  const c = sheet.content;
  return (
    <div className="space-y-6">
      {/* share bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/25 bg-primary/[0.06] p-4">
        <Link2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/60">{shareUrl}</span>
        <button
          onClick={onCopyShare}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-black text-black transition hover:brightness-110"
        >
          {shared ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Share2 className="h-3.5 w-3.5" aria-hidden="true" />}
          {shared ? t("syncPitch.linkCopied") : t("syncPitch.copyShareLink")}
        </button>
        <button
          onClick={onAddToTracker}
          className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary/20"
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          {t("syncPitch.trackThisPitch")}
        </button>
      </div>

      {/* the one-sheet */}
      <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
          {t("syncPitch.oneSheetBadge")}
        </p>
        <h2 className="mt-2 font-display text-3xl font-black tracking-tight">
          {sheet.songTitle}
        </h2>
        {sheet.artistName && (
          <p className="mt-1 text-sm font-semibold text-white/60">{sheet.artistName}</p>
        )}
        <p className="mt-4 border-l-2 border-primary/60 pl-4 text-[15px] italic leading-relaxed text-white/85">
          “{c.logline}”
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: t("syncPitch.statBpm"), value: sheet.bpm || "—" },
            { label: t("syncPitch.statKey"), value: sheet.musicalKey || "—" },
            { label: t("syncPitch.statInstrumental"), value: sheet.instrumentalAvailable ? t("syncPitch.yes") : t("syncPitch.no") },
            { label: t("syncPitch.statStems"), value: sheet.stemsAvailable ? t("syncPitch.yes") : t("syncPitch.no") },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">{s.label}</p>
              <p className="mt-1 text-sm font-semibold text-white">{s.value}</p>
            </div>
          ))}
        </div>

        {sheet.moodTags.length > 0 && (
          <div className="mt-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("syncPitch.moodTagsLabel")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {sheet.moodTags.map((m) => (
                <span key={m} className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}

        {c.soundsLike && (
          <div className="mt-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("syncPitch.soundsLikeLabel")}</p>
            <p className="mt-1.5 text-sm text-white/80">{c.soundsLike}</p>
          </div>
        )}

        {sheet.comparableArtists.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("syncPitch.comparableArtists")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {sheet.comparableArtists.map((a) => (
                <span key={a} className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-sm font-semibold text-white/75">
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}

        {c.syncUses.length > 0 && (
          <div className="mt-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("syncPitch.syncUsesLabel")}</p>
            <ul className="mt-2 space-y-1.5">
              {c.syncUses.map((u, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                  {u}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(sheet.contactName || sheet.contactEmail) && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/40 p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("syncPitch.contactLabel")}</p>
            <p className="mt-1.5 text-sm text-white/80">
              {sheet.contactName}
              {sheet.contactEmail ? <span className="text-white/50"> · {sheet.contactEmail}</span> : null}
            </p>
          </div>
        )}
      </div>

      {/* pitch email */}
      <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-black">
            <Mail className="h-5 w-5 text-primary" aria-hidden="true" />
            {t("syncPitch.supervisorEmail")}
          </h3>
          <CopyButton text={`Subject: ${c.pitchEmail.subject}\n\n${c.pitchEmail.body}`} labelKey="syncPitch.copyEmailLabel" />
        </div>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-white/40">{t("syncPitch.subjectLabel")}</p>
        <p className="mt-1 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm font-semibold text-white">
          {c.pitchEmail.subject}
        </p>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-white/40">{t("syncPitch.bodyLabel")}</p>
        <p className="mt-1 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm leading-relaxed text-white/80">
          {c.pitchEmail.body}
        </p>
      </div>

      {/* licensing notes + handoffs */}
      {c.licensingNotes && (
        <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
          <h3 className="flex items-center gap-2 font-black">
            <Music2 className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("syncPitch.licensingNotesLabel")}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-white/75">{c.licensingNotes}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <a
          href="/stems"
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-primary/40"
        >
          <Disc3 className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-black text-white">{t("syncPitch.handoffStems")}</p>
            <p className="text-xs text-white/50">{t("syncPitch.handoffStemsDesc")}</p>
          </div>
        </a>
        <a
          href="/sponsorship-outreach"
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-primary/40"
        >
          <Send className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-black text-white">{t("syncPitch.handoffSponsor")}</p>
            <p className="text-xs text-white/50">{t("syncPitch.handoffSponsorDesc")}</p>
          </div>
        </a>
      </div>

      <p className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4 text-center text-[13px] leading-relaxed text-amber-200/80">
        {c.disclaimer}
      </p>
    </div>
  );
}
