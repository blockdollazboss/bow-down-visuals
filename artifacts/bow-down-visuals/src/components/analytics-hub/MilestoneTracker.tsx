import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Trophy, Loader2, AlertTriangle, CheckCircle2, Upload, Download,
  Medal, Sparkles, Megaphone, Plus, FileText,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── Milestone Tracker ────────────────────────────────────────────────────
   DistroKid RIAA-monitoring parity. Creators log the stream/download counts
   they see in Spotify for Artists (or import a CSV) per track + platform;
   the tracker awards gold/black badges along the ladder and renders progress
   bars toward the next award.

   HONESTY: there is NO live Spotify sync — that needs a distribution
   partner — so the UI says exactly that and every row is user-logged or
   CSV-imported (source is stored server-side). Logging is FREE.

   Handoffs: every milestone gets a shareable gold/black card (SVG download
   with "Made with Bow Down Visuals" attribution) and a "Celebrate" deep link
   into /promote (the social kit) with a caption prefilled. */

interface Milestone {
  id: string;
  trackTitle: string;
  artistName: string | null;
  platform: string;
  streamCount: number;
  awardTier: string;
  source: string;
  note: string | null;
  createdAt: string;
}

interface TrackProgress {
  trackTitle: string;
  artistName: string | null;
  platform: string;
  streams: number;
  awardTier: string;
  nextAt: number | null;
  nextLabel: string | null;
  progressPct: number;
}

const PLATFORMS = ["spotify", "apple music", "youtube", "soundcloud", "tiktok", "other"];

const AWARD_STYLES: Record<string, { ring: string; text: string; glow: string; label: string }> = {
  bronze: { ring: "border-[#cd7f32]/60", text: "text-[#cd7f32]", glow: "bg-[#cd7f32]/10", label: "Bronze" },
  silver: { ring: "border-[#c0c0c0]/60", text: "text-[#c0c0c0]", glow: "bg-[#c0c0c0]/10", label: "Silver" },
  gold: { ring: "border-primary/70", text: "text-primary", glow: "bg-primary/10", label: "Gold" },
  platinum: { ring: "border-[#e5e4e2]/70", text: "text-[#e5e4e2]", glow: "bg-[#e5e4e2]/10", label: "Platinum" },
  diamond: { ring: "border-[#b9f2ff]/70", text: "text-[#b9f2ff]", glow: "bg-[#b9f2ff]/10", label: "Diamond" },
};

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

function AwardBadge({ tier, size = "sm" }: { tier: string; size?: "sm" | "lg" }) {
  const s = AWARD_STYLES[tier];
  if (!s) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${s.ring} ${s.glow} px-3 py-1 ${
        size === "lg" ? "text-sm" : "text-[11px]"
      } font-bold uppercase tracking-widest ${s.text}`}
    >
      <Medal className={size === "lg" ? "h-4 w-4" : "h-3 w-3"} aria-hidden="true" />
      {s.label}
    </span>
  );
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";
const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

export default function MilestoneTracker() {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tracks, setTracks] = useState<TrackProgress[]>([]);

  const [trackTitle, setTrackTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [platform, setPlatform] = useState("spotify");
  const [streamCount, setStreamCount] = useState("");
  const [saving, setSaving] = useState(false);

  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const authFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken().catch(() => null);
      return fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
    },
    [getAccessToken],
  );

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/milestones");
      const data = (await res.json().catch(() => ({}))) as {
        milestones?: Milestone[]; tracks?: TrackProgress[]; error?: string; message?: string;
      };
      if (!res.ok) throw new Error(data.message ?? data.error ?? t("milestones.loadFailed"));
      setMilestones(data.milestones ?? []);
      setTracks(data.tracks ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("milestones.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [user, authFetch, t]);

  useEffect(() => { void load(); }, [load]);

  async function logMilestone() {
    if (!trackTitle.trim() || !streamCount.trim() || saving) return;
    const count = Math.floor(Number(streamCount.replace(/[, ]/g, "")));
    if (!Number.isFinite(count) || count < 0) {
      setError(t("milestones.invalidCount"));
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch("/api/milestones/log", {
        method: "POST",
        body: JSON.stringify({
          trackTitle: trackTitle.trim(),
          artistName: artistName.trim(),
          platform,
          streamCount: count,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        milestone?: Milestone; awardTier?: string; error?: string; message?: string;
      };
      if (!res.ok) throw new Error(data.message ?? data.error ?? t("milestones.logFailed"));
      setNotice(
        data.awardTier && data.awardTier !== "none"
          ? t("milestones.loggedWithAward", { award: AWARD_STYLES[data.awardTier]?.label ?? data.awardTier })
          : t("milestones.logged"),
      );
      setTrackTitle(""); setArtistName(""); setStreamCount("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("milestones.logFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function importCsv() {
    if (!csvText.trim() || importing) return;
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch("/api/milestones/import-csv", {
        method: "POST",
        body: JSON.stringify({ csv: csvText }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        imported?: number; skipped?: number; error?: string; message?: string;
      };
      if (!res.ok) throw new Error(data.message ?? data.error ?? t("milestones.importFailed"));
      setNotice(t("milestones.imported", { imported: data.imported ?? 0, skipped: data.skipped ?? 0 }));
      setCsvText("");
      setShowImport(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("milestones.importFailed"));
    } finally {
      setImporting(false);
    }
  }

  function handleCsvFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  if (!user) {
    return (
      <div className="mx-auto mt-10 max-w-xl rounded-3xl border border-white/10 bg-white/[0.02] p-10 text-center">
        <p className="text-white/60">{t("milestones.signIn")}</p>
        <Link href="/login" className={`${goldBtn} mt-6`}>{t("milestones.signInCta")}</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-10 max-w-5xl">
      {/* honesty banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/[0.06] p-4 text-sm text-white/75">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p>{t("milestones.honesty")}</p>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}
      {notice && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{notice}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-white/50">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          {t("milestones.loading")}
        </div>
      ) : (
        <>
          {/* ── progress toward next award ── */}
          {tracks.length > 0 && (
            <section className="mt-8">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/60">
                <Trophy className="h-4 w-4 text-primary" aria-hidden="true" />
                {t("milestones.yourRace")}
              </h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {tracks.map((trk) => (
                  <div key={`${trk.trackTitle}|${trk.platform}`} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-bold">{trk.trackTitle}</p>
                        <p className="truncate text-xs text-white/40">
                          {trk.artistName ? `${trk.artistName} · ` : ""}{trk.platform}
                        </p>
                      </div>
                      {trk.awardTier !== "none" ? (
                        <AwardBadge tier={trk.awardTier} />
                      ) : (
                        <span className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white/40">
                          {t("milestones.unranked")}
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-2xl font-black text-primary">{formatCount(trk.streams)}
                      <span className="ml-1.5 text-xs font-semibold uppercase tracking-widest text-white/40">{t("milestones.streams")}</span>
                    </p>
                    {trk.nextAt ? (
                      <div className="mt-3">
                        <div className="mb-1.5 flex items-center justify-between text-xs text-white/50">
                          <span>{t("milestones.nextUp", { label: trk.nextLabel })}</span>
                          <span className="font-bold text-white/70">{Math.round(trk.progressPct)}%</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(trk.progressPct)} aria-valuemin={0} aria-valuemax={100}>
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#9c7c1e] via-primary to-[#f6d47c] transition-all"
                            style={{ width: `${Math.max(2, trk.progressPct)}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-xs font-bold uppercase tracking-widest text-primary">
                        {t("milestones.maxTier")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── log form ── */}
          <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.02] p-6">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/60">
              <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("milestones.logTitle")}
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input
                value={trackTitle}
                onChange={(e) => setTrackTitle(e.target.value)}
                placeholder={t("milestones.trackPlaceholder")}
                className={inputClass}
                maxLength={200}
              />
              <input
                value={artistName}
                onChange={(e) => setArtistName(e.target.value)}
                placeholder={t("milestones.artistPlaceholder")}
                className={inputClass}
                maxLength={200}
              />
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={inputClass}>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p} className="bg-black">{p}</option>
                ))}
              </select>
              <input
                value={streamCount}
                onChange={(e) => setStreamCount(e.target.value)}
                placeholder={t("milestones.countPlaceholder")}
                inputMode="numeric"
                className={inputClass}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={() => void logMilestone()} disabled={saving} className={goldBtn}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {saving ? t("milestones.logging") : t("milestones.logButton")}
              </button>
              <button
                onClick={() => setShowImport((v) => !v)}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:border-primary/50 hover:text-white"
              >
                <Upload className="h-4 w-4" />
                {t("milestones.importCsv")}
              </button>
            </div>
            {showImport && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-4">
                <p className="flex items-start gap-2 text-xs leading-relaxed text-white/50">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  {t("milestones.csvHelp")}
                </p>
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  rows={4}
                  placeholder="track_title,platform,streams&#10;Midnight Run,spotify,102400&#10;Midnight Run,apple music,38200"
                  className={`${inputClass} mt-3 font-mono text-xs`}
                />
                <div className="mt-3 flex flex-wrap gap-3">
                  <button onClick={() => void importCsv()} disabled={importing || !csvText.trim()} className={goldBtn}>
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {importing ? t("milestones.importing") : t("milestones.importButton")}
                  </button>
                  <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:border-primary/50 hover:text-white">
                    <FileText className="h-4 w-4" />
                    {t("milestones.chooseFile")}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => { handleCsvFile(e.target.files?.[0]); e.target.value = ""; }}
                  />
                </div>
              </div>
            )}
          </section>

          {/* ── history ── */}
          <section className="mt-8">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/60">
              <Trophy className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("milestones.history")}
            </h3>
            {milestones.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-white/[0.01] p-10 text-center">
                <Trophy className="mx-auto h-8 w-8 text-white/20" aria-hidden="true" />
                <p className="mt-3 text-sm text-white/50">{t("milestones.empty")}</p>
              </div>
            ) : (
              <ul className="mt-4 space-y-3">
                {milestones.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">
                        {m.trackTitle}
                        <span className="ml-2 text-xs font-semibold uppercase tracking-widest text-white/35">{m.platform}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-white/45">
                        {formatCount(m.streamCount)} {t("milestones.streams")} · {t("milestones.loggedFrom", { source: m.source === "csv" ? "CSV" : t("milestones.manual") })} · {new Date(m.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {m.awardTier !== "none" && <AwardBadge tier={m.awardTier} />}
                    <div className="flex items-center gap-2">
                      <a
                        href={`/api/milestones/${m.id}/card`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white"
                        title={t("milestones.cardTitle")}
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("milestones.card")}
                      </a>
                      <Link
                        href={`/promote?focus=${encodeURIComponent(t("milestones.celebrateCaption", { title: m.trackTitle, streams: formatCount(m.streamCount) }))}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110"
                      >
                        <Megaphone className="h-3.5 w-3.5" />
                        {t("milestones.celebrate")}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
