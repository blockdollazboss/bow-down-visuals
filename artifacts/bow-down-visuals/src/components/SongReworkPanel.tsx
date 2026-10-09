import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Shuffle, Scissors, Loader2, Mic2, Palette, Disc3,
  Share2, Check, ChevronDown, AlertCircle,
} from "lucide-react";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

/* ─── SongReworkPanel ───────────────────────────────────────────────────────
   Suno-parity rework tools, docked inside the Song Maker results panel and
   on every /songs library card (reverse handoff). Two tools:
     • Remix — same lyrics/vibe, fresh arrangement (400 Visual Bucs)
     • Replace Section — regenerate one tagged section, crossfade-spliced
       back into the original (300 Visual Bucs)
   Results land in the songs table, so the lyric-video page picks them up
   from the library, and handoff buttons chain to lyric video / cover art /
   album (song library) with a referral-tagged one-click share link. */

export interface SongReworkSource {
  /** songs-table id when the song lives in the library (enables length match + parent link). */
  songId?: string;
  /** Playable audio URL — required for Replace Section. */
  audioUrl?: string | null;
  title: string;
  artistName?: string;
  genre?: string;
  mood?: string;
  /** Tagged lyrics ("[Verse 2]" …) — drives the section picker. */
  lyrics?: string;
}

interface SongReworkPanelProps {
  source: SongReworkSource;
  /** Compact rendering for library song cards. */
  compact?: boolean;
}

interface ParsedSection {
  name: string;
  lyrics: string;
}

const COMMON_SECTIONS = ["Intro", "Verse 1", "Pre-Chorus", "Chorus", "Verse 2", "Chorus", "Bridge", "Outro"];

/** Split tagged lyrics into ordered sections: [Verse 2] … up to the next tag. */
function parseSections(lyrics: string): ParsedSection[] {
  const tagRe = /^\s*\[([^\]\n]{1,40})\]\s*$/gm;
  const tags: Array<{ name: string; start: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(lyrics)) !== null) {
    tags.push({ name: m[1]!.trim(), start: m.index, bodyStart: m.index + m[0].length });
  }
  if (tags.length === 0) return [];
  return tags.map((t, i) => ({
    name: t.name,
    lyrics: lyrics.slice(t.bodyStart, i + 1 < tags.length ? tags[i + 1]!.start : undefined).trim().slice(0, 1500),
  }));
}

interface ReworkSong {
  id: string;
  title: string;
  audio_url: string;
}

const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-black " +
  "transition-all hover:bg-primary/90 hover:shadow-[0_0_24px_-6px_hsl(45_95%_50%/0.6)] " +
  "disabled:opacity-50 disabled:pointer-events-none";
const ghostBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-3.5 py-2.5 " +
  "text-xs font-semibold text-white/80 transition-colors hover:border-primary/50 hover:text-white";
const fieldClass =
  "w-full rounded-xl bg-black/40 border border-white/10 px-3.5 py-2.5 text-sm text-white " +
  "placeholder:text-white/25 outline-none focus:border-primary/50 transition-colors";

export function SongReworkPanel({ source, compact = false }: SongReworkPanelProps) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset, referralCode } = useHubProject();
  const { refreshProfile } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<"remix" | "replace">("remix");
  const [styleTweak, setStyleTweak] = useState("");
  const [remixLength, setRemixLength] = useState<string>(source.songId ? "original" : "60");
  const [sectionIdx, setSectionIdx] = useState(0);
  const [direction, setDirection] = useState("");
  const [showTiming, setShowTiming] = useState(false);
  const [startSec, setStartSec] = useState("");
  const [endSec, setEndSec] = useState("");
  const [working, setWorking] = useState<"remix" | "replace" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReworkSong | null>(null);
  const [resultKind, setResultKind] = useState<"remix" | "replace" | null>(null);
  const [estimated, setEstimated] = useState(false);
  const [copied, setCopied] = useState(false);

  const sections = useMemo<ParsedSection[]>(() => {
    const parsed = source.lyrics ? parseSections(source.lyrics) : [];
    if (parsed.length > 0) return parsed;
    return COMMON_SECTIONS.map((name, i, arr) => ({
      name: arr.indexOf(name) === i ? name : `${name} ${arr.slice(0, i).filter((n) => n === name).length + 1}`,
      lyrics: "",
    }));
  }, [source.lyrics]);

  const activeSection = sections[Math.min(sectionIdx, sections.length - 1)];
  const hasAudio = !!source.audioUrl && !source.audioUrl.startsWith("blob:");

  function apiErrorMessage(data: { error?: string; code?: string; message?: string }, fallback: string): string {
    if (data.code === "out_of_credits" || data.error === "out_of_credits") return t("songRework.outOfCredits");
    return data.message || data.error || fallback;
  }

  async function runRemix() {
    setWorking("remix");
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        title: source.title,
        lyrics: source.lyrics || undefined,
        genre: source.genre || undefined,
        mood: source.mood || undefined,
        styleTweak: styleTweak.trim() || undefined,
      };
      if (source.songId) body.songId = source.songId;
      else if (source.audioUrl) body.audioUrl = source.audioUrl;
      if (remixLength !== "original") body.lengthSeconds = Number(remixLength);

      const res = await confirmedFetch("/api/song-remix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as {
        song?: ReworkSong; error?: string; code?: string; message?: string;
      };
      if (!res.ok || !data.song) throw new Error(apiErrorMessage(data, t("songRework.failed")));
      setResult(data.song);
      setResultKind("remix");
      setEstimated(false);
      try {
        addAsset({ kind: "song", url: data.song.audio_url, label: data.song.title, detail: "Remix" });
      } catch { /* hub push is best-effort */ }
      refreshProfile();
      toast({ title: t("songRework.remixDone"), description: t("songRework.addedToLibrary") });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("songRework.failed"));
    } finally {
      setWorking(null);
    }
  }

  async function runReplace() {
    if (!hasAudio) return;
    setWorking("replace");
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        title: source.title,
        section: activeSection?.name ?? "Section",
        sectionIndex: Math.min(sectionIdx, sections.length - 1),
        totalSections: sections.length,
        sectionLyrics: activeSection?.lyrics || undefined,
        genre: source.genre || undefined,
        mood: source.mood || undefined,
        styleTweak: direction.trim() || undefined,
      };
      if (source.songId) body.songId = source.songId;
      else if (source.audioUrl) body.audioUrl = source.audioUrl;
      const s = Number(startSec);
      const e = Number(endSec);
      if (Number.isFinite(s) && s >= 0) body.startSec = s;
      if (Number.isFinite(e) && e > 0) body.endSec = e;

      const res = await confirmedFetch("/api/song-replace-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as {
        song?: ReworkSong; estimated?: boolean; error?: string; code?: string; message?: string;
      };
      if (!res.ok || !data.song) throw new Error(apiErrorMessage(data, t("songRework.failed")));
      setResult(data.song);
      setResultKind("replace");
      setEstimated(data.estimated === true);
      try {
        addAsset({ kind: "song", url: data.song.audio_url, label: data.song.title, detail: "Section replaced" });
      } catch { /* best-effort */ }
      refreshProfile();
      toast({ title: t("songRework.replaceDone"), description: t("songRework.addedToLibrary") });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("songRework.failed"));
    } finally {
      setWorking(null);
    }
  }

  function shareLink(): string {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const id = result?.id ?? source.songId ?? "";
    const base = `${origin}/songs${id ? `?song=${encodeURIComponent(id)}` : ""}`;
    return referralCode ? `${base}${id ? "&" : "?"}ref=${encodeURIComponent(referralCode)}` : base;
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareLink());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: t("songRework.copied") });
    } catch { /* clipboard unavailable — link is still visible below */ }
  }

  const tabBtn = (active: boolean) =>
    `flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all ${
      active
        ? "bg-primary text-black shadow-[0_0_20px_-6px_hsl(45_95%_50%/0.7)]"
        : "bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white"
    }`;

  return (
    <div
      className={`rounded-2xl border border-primary/[0.22] bg-[linear-gradient(180deg,hsl(45_95%_50%/0.05),hsl(0_0%_0%/0)_40%)] ${
        compact ? "p-4 mt-3" : "p-6 md:p-7"
      }`}
      data-testid="song-rework-panel"
    >
      {!compact && (
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">{t("songRework.panelTitle")}</p>
          <p className="text-sm text-white/45 mt-1">{t("songRework.panelSub")}</p>
        </div>
      )}

      {/* Tab switch */}
      <div className="flex gap-2 mb-5">
        <button type="button" onClick={() => setTab("remix")} className={tabBtn(tab === "remix")}>
          <Shuffle className="h-4 w-4" /> {t("songRework.remixTitle")}
        </button>
        <button type="button" onClick={() => setTab("replace")} className={tabBtn(tab === "replace")}>
          <Scissors className="h-4 w-4" /> {t("songRework.replaceTitle")}
        </button>
      </div>

      {tab === "remix" ? (
        <div className="space-y-4">
          <p className="text-sm text-white/50">{t("songRework.remixDesc")}</p>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-1.5">
              {t("songRework.styleTweakLabel")}
            </label>
            <input
              value={styleTweak}
              onChange={(e) => setStyleTweak(e.target.value)}
              placeholder={t("songRework.styleTweakPlaceholder")}
              disabled={working !== null}
              className={fieldClass}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-1.5">
              {t("songRework.lengthLabel")}
            </label>
            <select
              value={remixLength}
              onChange={(e) => setRemixLength(e.target.value)}
              disabled={working !== null}
              className={fieldClass}
              style={{ colorScheme: "dark" }}
            >
              {source.songId && <option value="original">{t("songRework.lengthOriginal")}</option>}
              {["30", "60", "90", "120", "180"].map((s) => (
                <option key={s} value={s}>{s}s</option>
              ))}
            </select>
          </div>
          <button type="button" onClick={() => void runRemix()} disabled={working !== null} className={`${goldBtn} w-full`}>
            {working === "remix" ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> {t("songRework.remixWorking")}</>
            ) : (
              <><Shuffle className="h-4 w-4" /> {t("songRework.remixCta")}</>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {!hasAudio ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex gap-3">
              <AlertCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-white">{t("songRework.noAudioTitle")}</p>
                <p className="text-xs text-white/45 mt-1 leading-relaxed">{t("songRework.noAudioDesc")}</p>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-white/50">{t("songRework.replaceDesc")}</p>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-1.5">
                  {t("songRework.sectionLabel")}
                </label>
                <select
                  value={sectionIdx}
                  onChange={(e) => setSectionIdx(Number(e.target.value))}
                  disabled={working !== null}
                  className={fieldClass}
                  style={{ colorScheme: "dark" }}
                >
                  {sections.map((s, i) => (
                    <option key={`${s.name}-${i}`} value={i}>[{s.name}]</option>
                  ))}
                </select>
                <p className="text-[11px] text-white/30 mt-1.5">{t("songRework.estimatedNote")}</p>
              </div>
              {activeSection?.lyrics && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-1.5">
                    {t("songRework.sectionLyricsLabel")}
                  </label>
                  <p className="text-xs text-white/45 leading-relaxed rounded-xl border border-white/[0.07] bg-black/30 p-3 max-h-28 overflow-y-auto whitespace-pre-wrap">
                    {activeSection.lyrics}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-1.5">
                  {t("songRework.directionLabel")}
                </label>
                <input
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  placeholder={t("songRework.directionPlaceholder")}
                  disabled={working !== null}
                  className={fieldClass}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowTiming((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/45 hover:text-white transition-colors"
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showTiming ? "rotate-180" : ""}`} />
                {t("songRework.fineTune")}
              </button>
              {showTiming && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-1.5">
                      {t("songRework.startSec")}
                    </label>
                    <input
                      type="number" min={0} step={0.5} value={startSec}
                      onChange={(e) => setStartSec(e.target.value)}
                      disabled={working !== null} className={fieldClass} placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-1.5">
                      {t("songRework.endSec")}
                    </label>
                    <input
                      type="number" min={0} step={0.5} value={endSec}
                      onChange={(e) => setEndSec(e.target.value)}
                      disabled={working !== null} className={fieldClass} placeholder="30"
                    />
                  </div>
                </div>
              )}
              <button type="button" onClick={() => void runReplace()} disabled={working !== null} className={`${goldBtn} w-full`}>
                {working === "replace" ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {t("songRework.replaceWorking")}</>
                ) : (
                  <><Scissors className="h-4 w-4" /> {t("songRework.replaceCta")}</>
                )}
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* ── Result + handoff chain ── */}
      {result && (
        <div className="mt-5 rounded-xl border border-primary/35 bg-primary/[0.05] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary mb-1">
            {resultKind === "remix" ? t("songRework.remixDone") : t("songRework.replaceDone")}
            {estimated && <span className="ml-2 normal-case tracking-normal text-white/40">· {t("songRework.estimatedBadge")}</span>}
          </p>
          <p className="text-sm font-bold text-white mb-3">{result.title}</p>
          <audio controls src={result.audio_url} className="w-full h-9 mb-4" />
          <div className="flex flex-wrap gap-2">
            <Link href="/video-editor?tab=lyric-video" className={ghostBtn}>
              <Mic2 className="h-3.5 w-3.5" /> {t("songRework.makeLyricVideo")}
            </Link>
            <Link href="/cover-art" className={ghostBtn}>
              <Palette className="h-3.5 w-3.5" /> {t("songRework.designCoverArt")}
            </Link>
            <Link href={`/songs?song=${encodeURIComponent(result.id)}&addToAlbum=1`} className={ghostBtn}>
              <Disc3 className="h-3.5 w-3.5" /> {t("songRework.addToAlbum")}
            </Link>
            <button type="button" onClick={() => void copyShare()} className={ghostBtn}>
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Share2 className="h-3.5 w-3.5" />}
              {t("songRework.share")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
