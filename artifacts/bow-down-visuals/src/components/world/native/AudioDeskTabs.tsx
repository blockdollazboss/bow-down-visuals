import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, ListPlus, Loader2, Pause, Play, Scissors } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { recordPlay } from "@/lib/streaming";
import { creditsForSize, formatDuration, originBadge, PACK_SIZE_OPTIONS } from "@/lib/sample-pack";
import {
  buildSamplePackPayload,
  buildSamplePackZipPayload,
  parseGeneratedSamples,
  parseSamplePackCatalog,
  samplePackName,
  samplePlayInput,
  stemSourceFileName,
  type PackSample,
  type SamplePackCatalog,
} from "@/lib/world/audio-desk-tabs";
import {
  formatShelfClock,
  isSameShelfItem,
  playInputFromMyMusic,
  type MyMusicTrack,
} from "@/lib/world/shelf";
import {
  audioBenchJobIdOf,
  audioBenchOf,
  audioBenchResultStrings,
  buildStemRemixPayload,
  interpretAudioBenchResponse,
  MASTER_FILE_FIELD,
  stemKeyOfResultLabel,
  stemRemixPath,
  stemRemixUrlOfResponse,
  stemsFields,
  type AudioBenchResult,
} from "@/lib/world/audio-benches";
import {
  DeskSelectField,
  useDeskAuthHeaders,
} from "./CreateDeskLeaf";
import {
  AudioResult,
  QuestProgressChip,
  useQuestProgressChip,
} from "./CreateResultLeaf";
import { NativeShelf, NativeShelfRow } from "./NativeShelf";
import type { ShelfPlayerController } from "./ShelfPlayer";

/* ─── The Audio Desk's Song Desk tabs (STACK-20 #18) ────────────────
   Three tabs docked into the Audio Desk, each riding the website's
   own rails — no parallel stores:
   - Sound packs: the AI Audio Samples tab (catalog → build a pack
     → audition on the palace's one Shelf player → zip download).
   - Library: the member's own tracks on GET /api/world/my-music,
     played through the Booth's exact seams (playInputFromMyMusic,
     queue-next, published-only play counts).
   - Stem splitter: an owned track split on POST /api/stems, the
     registry's own bench rail, polled the way the hub polls it.
   The desk station is members-only, so these tabs never render for
   a guest — the station's own pitch is the guest treatment, exactly
   as it is for the desk's benches. */

const tabChip = (isLight: boolean, active: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    active
      ? "border-[#d4af37] bg-[#d4af37] text-black"
      : isLight
        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
        : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";
const chipBtn =
  "inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-bold text-white/75 transition hover:text-white disabled:opacity-50 bdv-touch-target";
const chipBtnFor = (isLight: boolean) =>
  isLight
    ? "inline-flex items-center gap-1.5 rounded-full border border-[#7A5A12]/30 px-3 py-1.5 text-xs font-bold text-[#6B5B36] transition hover:text-[#2a1e07] disabled:opacity-50 bdv-touch-target"
    : chipBtn;

/* ─── Stack-100 #51 — the stems remix-levels mixdown ───────────────
   audio-studio.tsx's StemsPanel remix mode, docked: one level
   slider per stem the split JOB returned, then the free mixdown
   on POST /api/stems/:jobId/remix (the split was paid for; the
   remix charges nothing — the studio's own terms). Levels are
   0–2 (mute → unity → double), sent for exactly the returned
   stems so the server's per-job validation passes. */

export function StemRemixPanel({
  isLight,
  jobId,
  stemKeys,
}: {
  isLight: boolean;
  jobId: string;
  stemKeys: readonly string[];
}) {
  const { t } = useTranslation();
  const authHeaders = useDeskAuthHeaders();
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remixUrl, setRemixUrl] = useState<string | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  if (stemKeys.length === 0) return null;

  const exportMix = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setRemixUrl(null);
    try {
      const res = await fetch(stemRemixPath(jobId), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildStemRemixPayload(stemKeys, levels)),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldAudioDesk.remixDidntLand")));
      const url = stemRemixUrlOfResponse(data);
      if (!url) throw new Error(t("worldAudioDesk.remixNoAudio"));
      setRemixUrl(url);
    } catch (err) {
      setError(plainErrorText(err, t("worldAudioDesk.remixDidntLand")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-[#d4af37]/30 p-3" data-testid="world-audio-stem-remix">
      <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {t("worldAudioDesk.remixTitle")}
      </p>
      {stemKeys.map((key) => {
        const level = typeof levels[key] === "number" ? levels[key]! : 1;
        return (
          <label key={key} className="flex items-center gap-3 text-xs font-bold">
            <span className="w-16 shrink-0 capitalize">{key}</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={level}
              data-testid={`world-audio-stem-remix-level-${key}`}
              onChange={(e) => setLevels((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
              className="flex-1 accent-[#d4af37] bdv-touch-target"
            />
            <span className={`w-12 shrink-0 text-right ${muted}`}>{Math.round(level * 100)}%</span>
          </label>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-testid="world-audio-stem-remix-run" onClick={() => void exportMix()} disabled={busy} className={goldBtn}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? t("worldAudioDesk.mixingLabel") : t("worldAudioDesk.exportMixFree")}
        </button>
        {remixUrl ? (
          <a href={remixUrl} download="remix.wav" className={chipBtnFor(isLight)}>
            <Download className="h-3.5 w-3.5" /> {t("worldAudioDesk.downloadRemix")}
          </a>
        ) : null}
      </div>
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      {remixUrl ? <AudioResult url={remixUrl} title={t("worldAudioDesk.yourRemix")} /> : null}
    </div>
  );
}

/* ─── Sound packs ─────────────────────────────────────────────────── */

export function SoundPacksTab({
  isLight,
  shelfPlayer,
}: {
  isLight: boolean;
  shelfPlayer?: ShelfPlayerController;
}) {
  const { t, i18n } = useTranslation();
  const { refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const quest = useQuestProgressChip();
  const [catalog, setCatalog] = useState<SamplePackCatalog | null>(null);
  const [genre, setGenre] = useState("trap");
  const [bpm, setBpm] = useState(140);
  const [musicalKey, setMusicalKey] = useState("A");
  const [packSize, setPackSize] = useState<number>(10);
  const [selectedTypes, setSelectedTypes] = useState<ReadonlySet<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [samples, setSamples] = useState<PackSample[]>([]);
  const [packName, setPackName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /* The catalog is free and public — the website fetches it bare.
     It is progressive enhancement here exactly as it is there: if
     it slips, the builder still stands on the standard set. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sample-pack/catalog");
        if (!res.ok) return;
        const parsed = parseSamplePackCatalog(await res.json().catch(() => null));
        if (cancelled || !parsed) return;
        setCatalog(parsed);
        if (parsed.genres.length > 0) setGenre(parsed.genres[0]!);
        if (parsed.keys.length > 0) setMusicalKey(parsed.keys[0]!);
      } catch {
        /* the builder works without it, as the page's does */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleType = (key: string) =>
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const cost = creditsForSize(packSize);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setOutOfCredits(null);
    setNote(null);
    void quest.snapshot();
    try {
      const res = await fetch("/api/sample-pack/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildSamplePackPayload({ genre, bpm, musicalKey, packSize, types: [...selectedTypes] })),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (res.status === 402) {
        setOutOfCredits(apiErrorMessage(data, t("worldAudioDesk.packOutOfCredits", { cost: cost.toLocaleString(i18n.language) })));
        return;
      }
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldAudioDesk.packGenFailed")));
      const built = parseGeneratedSamples(data);
      if (built.length === 0) throw new Error(t("worldAudioDesk.packEmpty"));
      setSamples(built);
      setPackName(samplePackName({ genre, bpm, musicalKey }));
      refreshProfile();
      void quest.checkAfter();
    } catch (err) {
      setError(plainErrorText(err, t("worldAudioDesk.packGenFailed")));
    } finally {
      setGenerating(false);
    }
  };

  const audition = (sample: PackSample) => {
    if (!shelfPlayer) return;
    const input = samplePlayInput(sample);
    if (!input) {
      setNote(t("worldAudioDesk.sampleNoFile", { name: sample.name }));
      return;
    }
    if (shelfPlayer.current && isSameShelfItem(shelfPlayer.current, input)) {
      shelfPlayer.toggle();
      return;
    }
    shelfPlayer.play(input);
    setNote(null);
  };

  const downloadZip = async () => {
    if (zipping || samples.length === 0) return;
    setZipping(true);
    setError(null);
    try {
      const res = await fetch("/api/sample-pack/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSamplePackZipPayload(samples, packName)),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(apiErrorMessage(data, t("worldAudioDesk.packDownloadFailed")));
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${packName || "sample-pack"}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) {
      setError(plainErrorText(err, t("worldAudioDesk.packDownloadFailed")));
    } finally {
      setZipping(false);
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const genreOptions = catalog && catalog.genres.length > 0 ? catalog.genres : [genre];
  const keyOptions = catalog && catalog.keys.length > 0 ? catalog.keys : [musicalKey];

  return (
    <div data-testid="world-audio-packs-tab" className="space-y-3">
      <p className={`text-xs ${muted}`}>
        {t("worldAudioDesk.packsIntro")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <DeskSelectField isLight={isLight} label={t("worldAudioDesk.genreLabel")} value={genre} onChange={setGenre} options={genreOptions.map((g) => ({ value: g, label: g }))} />
        <DeskSelectField isLight={isLight} label={t("worldAudioDesk.keyLabel")} value={musicalKey} onChange={setMusicalKey} options={keyOptions.map((k) => ({ value: k, label: k }))} />
      </div>
      <label className="block text-xs font-bold">
        {t("worldAudioDesk.packTempo", { bpm })}
        <input type="range" min={60} max={180} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="mt-1 w-full accent-[#d4af37] bdv-touch-target" />
      </label>
      <div>
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("worldAudioDesk.packSizeLabel")}</span>
        <div className="flex flex-wrap gap-1.5">
          {PACK_SIZE_OPTIONS.map((o) => (
            <button key={o.size} type="button" data-testid="world-audio-packs-size" onClick={() => setPackSize(o.size)} className={tabChip(isLight, packSize === o.size)}>
              {t("worldAudioDesk.packSizeOption", { size: o.size, credits: o.credits.toLocaleString(i18n.language) })}
            </button>
          ))}
        </div>
      </div>
      {catalog && catalog.types.length > 0 ? (
        <div>
          <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("worldAudioDesk.inThePackLabel")} <span className={`normal-case ${muted}`}>{t("worldAudioDesk.fullSetNote")}</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {catalog.types.map((type) => (
              <button key={type.key} type="button" title={type.blurb} onClick={() => toggleType(type.key)} className={tabChip(isLight, selectedTypes.has(type.key))}>
                {type.label} · {originBadge(type.origin).label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <button type="button" data-testid="world-audio-packs-generate" onClick={() => void generate()} disabled={generating} className={goldBtn}>
        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {generating ? t("worldAudioDesk.cookingPack") : t("worldAudioDesk.buildPack", { cost: cost.toLocaleString(i18n.language) })}
      </button>
      {catalog?.license ? <p className={`text-[11px] ${muted}`}>{catalog.license}</p> : null}
      {outOfCredits ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{outOfCredits}</p> : null}
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      {note ? <p className={`text-xs font-semibold ${muted}`}>{note}</p> : null}
      {samples.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {t("worldAudioDesk.yourPack", { name: packName })}
            </p>
            <button type="button" data-testid="world-audio-packs-zip" onClick={() => void downloadZip()} disabled={zipping} className={`ml-auto ${chipBtnFor(isLight)}`}>
              {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 text-[#d4af37]" />}
              {t("worldAudioDesk.downloadPackZip")}
            </button>
          </div>
          <NativeShelf>
            {samples.map((sample) => {
              const input = samplePlayInput(sample);
              const isCurrent = !!input && !!shelfPlayer?.current && isSameShelfItem(shelfPlayer.current, input);
              return (
                <NativeShelfRow
                  key={sample.id}
                  isLight={isLight}
                  title={sample.name}
                  detail={[
                    sample.typeLabel,
                    sample.bpm ? t("worldAudioDesk.bpmValue", { bpm: sample.bpm }) : null,
                    sample.musicalKey ? t("worldAudioDesk.packKeyDetail", { key: sample.musicalKey }) : null,
                    sample.durationSec ? formatDuration(sample.durationSec) : null,
                    originBadge(sample.origin).label,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  artworkUrl={null}
                  action={
                    shelfPlayer ? (
                      <button
                        type="button"
                        data-testid="world-audio-packs-audition"
                        onClick={() => audition(sample)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
                      >
                        {isCurrent && shelfPlayer.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {isCurrent ? (shelfPlayer.playing ? t("worldAudioDesk.pauseLabel") : t("worldAudioDesk.resumeLabel")) : t("worldAudioDesk.auditionLabel")}
                      </button>
                    ) : undefined
                  }
                />
              );
            })}
          </NativeShelf>
        </div>
      ) : null}
      <QuestProgressChip isLight={isLight} lines={quest.lines} />
    </div>
  );
}

/* ─── Library ─────────────────────────────────────────────────────── */

export function LibraryTab({
  isLight,
  shelfPlayer,
  rows,
  failed,
  onRetry,
  onSplitStems,
}: {
  isLight: boolean;
  shelfPlayer?: ShelfPlayerController;
  rows: MyMusicTrack[] | null;
  failed: boolean;
  onRetry: () => void;
  onSplitStems: (row: MyMusicTrack) => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState<string | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  /* The Booth's own play semantics, word for word: pressing Play on
     the song that's already on pauses/resumes it; a published play
     counts, a draft hearing never does. */
  const playRow = (row: MyMusicTrack) => {
    if (!shelfPlayer) return;
    const input = playInputFromMyMusic(row);
    if (!input) {
      setNote(t("worldAudioDesk.noPlayableFile", { title: row.title }));
      return;
    }
    if (shelfPlayer.current && isSameShelfItem(shelfPlayer.current, input)) {
      shelfPlayer.toggle();
      return;
    }
    shelfPlayer.play(input);
    if (row.isPublished) recordPlay("track", row.id);
    setNote(row.isPublished ? null : t("worldAudioDesk.playingForYouAlone", { title: row.title }));
  };

  const queueRow = (row: MyMusicTrack) => {
    if (!shelfPlayer) return;
    const input = playInputFromMyMusic(row);
    if (!input) return;
    shelfPlayer.queueNext(input);
    setNote(t("worldAudioDesk.upNextNote", { title: row.title }));
  };

  if (failed) {
    return (
      <div className="space-y-2" data-testid="world-audio-library-tab">
        <p className={`text-xs ${muted}`}>{t("worldAudioDesk.libraryLoadFailed")}</p>
        <button type="button" onClick={onRetry} className={tabChip(isLight, false)}>
          {t("worldAudioDesk.tryAgain")}
        </button>
      </div>
    );
  }
  if (rows === null) {
    return (
      <p className={`inline-flex items-center gap-2 text-xs ${muted}`} data-testid="world-audio-library-tab">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> {t("worldAudioDesk.openingLibrary")}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className={`text-xs ${muted}`} data-testid="world-audio-library-tab">
        {t("worldAudioDesk.libraryEmptySongs")}
      </p>
    );
  }
  return (
    <div className="space-y-2" data-testid="world-audio-library-tab">
      <NativeShelf>
        {rows.map((row) => {
          const input = playInputFromMyMusic(row);
          const isCurrent = !!input && !!shelfPlayer?.current && isSameShelfItem(shelfPlayer.current, input);
          return (
            <NativeShelfRow
              key={row.id}
              isLight={isLight}
              title={row.title}
              detail={[
                row.artistName ?? t("worldAudioDesk.youFallback"),
                row.genre,
                row.durationSec > 0 ? formatShelfClock(row.durationSec) : null,
                row.isPublished ? t("worldAudioDesk.publishedLabel") : t("worldAudioDesk.notPublishedDetail"),
              ]
                .filter(Boolean)
                .join(" · ")}
              artworkUrl={row.artworkUrl}
              action={
                <>
                  {shelfPlayer ? (
                    <>
                      <button
                        type="button"
                        data-testid="world-audio-library-play"
                        onClick={() => playRow(row)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
                      >
                        {isCurrent && shelfPlayer.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {isCurrent ? (shelfPlayer.playing ? t("worldAudioDesk.pauseLabel") : t("worldAudioDesk.resumeLabel")) : t("worldAudioDesk.playItHere")}
                      </button>
                      <button type="button" data-testid="world-audio-library-queue" onClick={() => queueRow(row)} className={chipBtnFor(isLight)}>
                        <ListPlus className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldAudioDesk.queueNext")}
                      </button>
                    </>
                  ) : null}
                  <button type="button" data-testid="world-audio-library-split" onClick={() => onSplitStems(row)} className={chipBtnFor(isLight)}>
                    <Scissors className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldAudioDesk.splitStems")}
                  </button>
                  {!row.isPublished && (
                    <span className="inline-flex items-center rounded-full bg-[#d4af37]/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#e8c86a]">
                      {t("worldAudioDesk.notPublishedBadge")}
                    </span>
                  )}
                </>
              }
            />
          );
        })}
      </NativeShelf>
      {note ? <p className={`text-xs font-semibold ${muted}`}>{note}</p> : null}
    </div>
  );
}

/* ─── Stem splitter ───────────────────────────────────────────────── */

export function StemsTab({
  isLight,
  rows,
  failed,
  onRetry,
  picked,
  onPick,
}: {
  isLight: boolean;
  rows: MyMusicTrack[] | null;
  failed: boolean;
  onRetry: () => void;
  picked: MyMusicTrack | null;
  onPick: (row: MyMusicTrack) => void;
}) {
  const { t, i18n } = useTranslation();
  const { refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const quest = useQuestProgressChip();
  const [pro, setPro] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AudioBenchResult | null>(null);
  const [splitJobId, setSplitJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const def = audioBenchOf("stems");
  const cost = def.cost();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => stopPolling, []);

  const finishWith = (read: AudioBenchResult) => {
    if (read.failed) {
      setError(apiErrorMessage(read, t("worldAudioDesk.splitDidntFinish")));
      setBusy(false);
      return;
    }
    setResult(read);
    refreshProfile();
    setBusy(false);
    void quest.checkAfter();
  };

  const run = async () => {
    if (busy || !picked) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setSplitJobId(null);
    void quest.snapshot();
    try {
      const res = await fetch(picked.audioUrl);
      if (!res.ok) throw new Error(t("worldAudioDesk.splitFetchFailed"));
      const blob = await res.blob();
      const type = blob.type || "audio/mpeg";
      const file = new File([blob], stemSourceFileName(picked.title, type), { type });
      const form = new FormData();
      form.append(MASTER_FILE_FIELD, file);
      for (const [k, v] of stemsFields({ pro })) form.append(k, v);
      const post = await fetch(def.endpoint, { method: "POST", headers: await authHeaders(), body: form });
      const data = (await post.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; message?: string };
      if (!post.ok) throw new Error(apiErrorMessage(data, t("worldAudioDesk.splitDidntStart")));
      const jobId = audioBenchJobIdOf(data);
      if (!jobId) throw new Error(t("worldAudioDesk.splitDidntStart"));
      setSplitJobId(jobId);
      if (!def.pollPath) throw new Error(t("worldAudioDesk.splitDidntStart"));
      const path = def.pollPath(jobId);
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(path, { headers: await authHeaders() });
          const pollData = (await pollRes.json().catch(() => ({}))) as Record<string, unknown>;
          const read = interpretAudioBenchResponse("stems", pollData, audioBenchResultStrings(t));
          if (read.done) {
            stopPolling();
            finishWith(read);
          }
        } catch {
          /* keep polling on transient errors, as the hub panels do */
        }
      }, 3000);
    } catch (err) {
      setError(plainErrorText(err, t("worldAudioDesk.splitSnag")));
      setBusy(false);
    }
  };

  if (failed) {
    return (
      <div className="space-y-2" data-testid="world-audio-stems-tab">
        <p className={`text-xs ${muted}`}>{t("worldAudioDesk.stemsLoadFailed")}</p>
        <button type="button" onClick={onRetry} className={tabChip(isLight, false)}>
          {t("worldAudioDesk.tryAgain")}
        </button>
      </div>
    );
  }
  if (rows === null) {
    return (
      <p className={`inline-flex items-center gap-2 text-xs ${muted}`} data-testid="world-audio-stems-tab">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> {t("worldAudioDesk.openingLibrary")}
      </p>
    );
  }
  return (
    <div data-testid="world-audio-stems-tab" className="space-y-3">
      <p className={`text-xs ${muted}`}>
        {t("worldAudioDesk.stemsIntro")}
      </p>
      {rows.length === 0 ? (
        <p className={`text-xs ${muted}`}>{t("worldAudioDesk.stemsNoTracks")}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                data-testid="world-audio-stems-pick"
                aria-pressed={picked?.id === row.id}
                onClick={() => {
                  onPick(row);
                  setResult(null);
                  setError(null);
                }}
                className={tabChip(isLight, picked?.id === row.id)}
              >
                {row.title}
                {row.durationSec > 0 ? ` · ${formatShelfClock(row.durationSec)}` : ""}
              </button>
            ))}
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold bdv-touch-target">
            <input type="checkbox" checked={pro} onChange={(e) => setPro(e.target.checked)} />
            {t("worldAudioDesk.proStems", { cost: cost.toLocaleString(i18n.language) })}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`text-xs font-semibold ${muted}`}>
              {cost === 0 ? t("worldAudioDesk.freeLine") : t("worldAudioDesk.costsLine", { cost: cost.toLocaleString(i18n.language) })}
            </span>
            <button type="button" data-testid="world-audio-stems-run" onClick={() => void run()} disabled={busy || !picked} className={`${goldBtn} ml-auto`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
              {busy ? t("worldAudioDesk.splittingLabel") : picked ? t("worldAudioDesk.splitTitleBtn", { title: picked.title }) : t("worldAudioDesk.pickTrackFirst")}
            </button>
          </div>
        </>
      )}
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      {busy ? <p className={`text-xs font-semibold ${muted}`}>{t("worldAudioDesk.splittingOnServer")}</p> : null}
      {result ? (
        <div className="space-y-2" data-testid="world-audio-stems-result">
          {result.urls.map((u) => (
            <AudioResult key={u.url} url={u.url} title={u.label} />
          ))}
          {splitJobId ? (
            <StemRemixPanel
              isLight={isLight}
              jobId={splitJobId}
              stemKeys={result.urls.map((u) => stemKeyOfResultLabel(u.label, t("worldAudioDesk.stemLabel"))).filter((k): k is string => k !== null)}
            />
          ) : null}
          <QuestProgressChip isLight={isLight} lines={quest.lines} />
        </div>
      ) : null}
    </div>
  );
}
