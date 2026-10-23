import { useEffect, useRef, useState } from "react";
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
  AudioResult,
  DeskSelectField,
  QuestProgressChip,
  useDeskAuthHeaders,
  useQuestProgressChip,
} from "./CreateDeskShared";
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
  `rounded-full border px-3 py-1.5 text-xs font-bold transition ${
    active
      ? "border-[#d4af37] bg-[#d4af37] text-black"
      : isLight
        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
        : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50";
const chipBtn =
  "inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-bold text-white/75 transition hover:text-white disabled:opacity-50";
const chipBtnFor = (isLight: boolean) =>
  isLight
    ? "inline-flex items-center gap-1.5 rounded-full border border-[#7A5A12]/30 px-3 py-1.5 text-xs font-bold text-[#6B5B36] transition hover:text-[#2a1e07] disabled:opacity-50"
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
      if (!res.ok) throw new Error(data.message ?? data.error ?? "The remix didn't land.");
      const url = stemRemixUrlOfResponse(data);
      if (!url) throw new Error("The remix came back without audio.");
      setRemixUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The remix didn't land.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-[#d4af37]/30 p-3" data-testid="world-audio-stem-remix">
      <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        Remix the levels — free, the split was paid for
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
              className="flex-1 accent-[#d4af37]"
            />
            <span className={`w-12 shrink-0 text-right ${muted}`}>{Math.round(level * 100)}%</span>
          </label>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-testid="world-audio-stem-remix-run" onClick={() => void exportMix()} disabled={busy} className={goldBtn}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? "Mixing…" : "Export the mix · Free"}
        </button>
        {remixUrl ? (
          <a href={remixUrl} download="remix.wav" className={chipBtnFor(isLight)}>
            <Download className="h-3.5 w-3.5" /> Download remix.wav
          </a>
        ) : null}
      </div>
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      {remixUrl ? <AudioResult url={remixUrl} title="Your remix" /> : null}
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
        setOutOfCredits(data.message ?? `This pack costs ${cost.toLocaleString("en-US")} Visual Bucs — top up and build it here.`);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Pack generation failed.");
      const built = parseGeneratedSamples(data);
      if (built.length === 0) throw new Error("The pack came back empty — nothing was kept, try building it again.");
      setSamples(built);
      setPackName(samplePackName({ genre, bpm, musicalKey }));
      refreshProfile();
      void quest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pack generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const audition = (sample: PackSample) => {
    if (!shelfPlayer) return;
    const input = samplePlayInput(sample);
    if (!input) {
      setNote(`“${sample.name}” has no playable file — the rest of the pack still plays.`);
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
        throw new Error(data.error ?? "The pack download didn't start.");
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
      setError(err instanceof Error ? err.message : "The pack download didn't start.");
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
        Build a royalty-free pack of one-shots and loops — pick the sound, we cook it, you keep it.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <DeskSelectField isLight={isLight} label="Genre" value={genre} onChange={setGenre} options={genreOptions.map((g) => ({ value: g, label: g }))} />
        <DeskSelectField isLight={isLight} label="Key" value={musicalKey} onChange={setMusicalKey} options={keyOptions.map((k) => ({ value: k, label: k }))} />
      </div>
      <label className="block text-xs font-bold">
        Tempo — {bpm} BPM
        <input type="range" min={60} max={180} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="mt-1 w-full accent-[#d4af37]" />
      </label>
      <div>
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Pack size</span>
        <div className="flex flex-wrap gap-1.5">
          {PACK_SIZE_OPTIONS.map((o) => (
            <button key={o.size} type="button" data-testid="world-audio-packs-size" onClick={() => setPackSize(o.size)} className={tabChip(isLight, packSize === o.size)}>
              {o.size} samples · {o.credits.toLocaleString("en-US")} VB
            </button>
          ))}
        </div>
      </div>
      {catalog && catalog.types.length > 0 ? (
        <div>
          <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            In the pack <span className={`normal-case ${muted}`}>(none picked = the full set)</span>
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
        {generating ? "Cooking your pack…" : `Build the pack · ${cost.toLocaleString("en-US")} Visual Bucs`}
      </button>
      {catalog?.license ? <p className={`text-[11px] ${muted}`}>{catalog.license}</p> : null}
      {outOfCredits ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{outOfCredits}</p> : null}
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      {note ? <p className={`text-xs font-semibold ${muted}`}>{note}</p> : null}
      {samples.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              Your pack — {packName}
            </p>
            <button type="button" data-testid="world-audio-packs-zip" onClick={() => void downloadZip()} disabled={zipping} className={`ml-auto ${chipBtnFor(isLight)}`}>
              {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 text-[#d4af37]" />}
              Download the pack (.zip)
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
                    sample.bpm ? `${sample.bpm} BPM` : null,
                    sample.musicalKey ? `Key ${sample.musicalKey}` : null,
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
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                      >
                        {isCurrent && shelfPlayer.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {isCurrent ? (shelfPlayer.playing ? "Pause" : "Resume") : "Audition"}
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
  const [note, setNote] = useState<string | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  /* The Booth's own play semantics, word for word: pressing Play on
     the song that's already on pauses/resumes it; a published play
     counts, a draft hearing never does. */
  const playRow = (row: MyMusicTrack) => {
    if (!shelfPlayer) return;
    const input = playInputFromMyMusic(row);
    if (!input) {
      setNote(`“${row.title}” has no playable file yet — finish the upload and it plays here.`);
      return;
    }
    if (shelfPlayer.current && isSameShelfItem(shelfPlayer.current, input)) {
      shelfPlayer.toggle();
      return;
    }
    shelfPlayer.play(input);
    if (row.isPublished) recordPlay("track", row.id);
    setNote(row.isPublished ? null : `“${row.title}” is playing for you alone — it's yours and it isn't published yet.`);
  };

  const queueRow = (row: MyMusicTrack) => {
    if (!shelfPlayer) return;
    const input = playInputFromMyMusic(row);
    if (!input) return;
    shelfPlayer.queueNext(input);
    setNote(`“${row.title}” is up next on your player.`);
  };

  if (failed) {
    return (
      <div className="space-y-2" data-testid="world-audio-library-tab">
        <p className={`text-xs ${muted}`}>Your library wouldn&rsquo;t open — your songs are fine, the shelf slipped.</p>
        <button type="button" onClick={onRetry} className={tabChip(isLight, false)}>
          Try again
        </button>
      </div>
    );
  }
  if (rows === null) {
    return (
      <p className={`inline-flex items-center gap-2 text-xs ${muted}`} data-testid="world-audio-library-tab">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> Opening your library…
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className={`text-xs ${muted}`} data-testid="world-audio-library-tab">
        No songs in your library yet — make one at the Song Desk and it lands here, ready to play and split.
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
                row.artistName ?? "You",
                row.genre,
                row.durationSec > 0 ? formatShelfClock(row.durationSec) : null,
                row.isPublished ? "Published" : "Not published yet — yours only",
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
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                      >
                        {isCurrent && shelfPlayer.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {isCurrent ? (shelfPlayer.playing ? "Pause" : "Resume") : "Play it here"}
                      </button>
                      <button type="button" data-testid="world-audio-library-queue" onClick={() => queueRow(row)} className={chipBtnFor(isLight)}>
                        <ListPlus className="h-3.5 w-3.5 text-[#d4af37]" /> Queue next
                      </button>
                    </>
                  ) : null}
                  <button type="button" data-testid="world-audio-library-split" onClick={() => onSplitStems(row)} className={chipBtnFor(isLight)}>
                    <Scissors className="h-3.5 w-3.5 text-[#d4af37]" /> Split stems
                  </button>
                  {!row.isPublished && (
                    <span className="inline-flex items-center rounded-full bg-[#d4af37]/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#e8c86a]">
                      Not published yet
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
      setError(read.error ?? "The split didn't finish.");
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
      if (!res.ok) throw new Error("Couldn't fetch that song's audio — try again or pick another track.");
      const blob = await res.blob();
      const type = blob.type || "audio/mpeg";
      const file = new File([blob], stemSourceFileName(picked.title, type), { type });
      const form = new FormData();
      form.append(MASTER_FILE_FIELD, file);
      for (const [k, v] of stemsFields({ pro })) form.append(k, v);
      const post = await fetch(def.endpoint, { method: "POST", headers: await authHeaders(), body: form });
      const data = (await post.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; message?: string };
      if (!post.ok) throw new Error(data.message ?? data.error ?? "The split didn't start.");
      const jobId = audioBenchJobIdOf(data);
      if (!jobId) throw new Error("The split didn't start.");
      setSplitJobId(jobId);
      if (!def.pollPath) throw new Error("The split didn't start.");
      const path = def.pollPath(jobId);
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(path, { headers: await authHeaders() });
          const pollData = (await pollRes.json().catch(() => ({}))) as Record<string, unknown>;
          const read = interpretAudioBenchResponse("stems", pollData);
          if (read.done) {
            stopPolling();
            finishWith(read);
          }
        } catch {
          /* keep polling on transient errors, as the hub panels do */
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The split hit a snag.");
      setBusy(false);
    }
  };

  if (failed) {
    return (
      <div className="space-y-2" data-testid="world-audio-stems-tab">
        <p className={`text-xs ${muted}`}>Your library wouldn&rsquo;t open — the splitter needs one of your tracks to work on.</p>
        <button type="button" onClick={onRetry} className={tabChip(isLight, false)}>
          Try again
        </button>
      </div>
    );
  }
  if (rows === null) {
    return (
      <p className={`inline-flex items-center gap-2 text-xs ${muted}`} data-testid="world-audio-stems-tab">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> Opening your library…
      </p>
    );
  }
  return (
    <div data-testid="world-audio-stems-tab" className="space-y-3">
      <p className={`text-xs ${muted}`}>
        Split one of your tracks into its stems — vocals, drums, bass and the rest — on the same rail the Audio Studio runs.
      </p>
      {rows.length === 0 ? (
        <p className={`text-xs ${muted}`}>You have no tracks to split yet — make a song first, then bring it here.</p>
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
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold">
            <input type="checkbox" checked={pro} onChange={(e) => setPro(e.target.checked)} />
            Pro stems (adds guitar + piano — same {cost.toLocaleString("en-US")} Visual Bucs)
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`text-xs font-semibold ${muted}`}>
              {cost === 0 ? "Free — shown before anything runs." : `Costs ${cost.toLocaleString("en-US")} Visual Bucs — shown before anything runs.`}
            </span>
            <button type="button" data-testid="world-audio-stems-run" onClick={() => void run()} disabled={busy || !picked} className={`${goldBtn} ml-auto`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
              {busy ? "Splitting…" : picked ? `Split “${picked.title}”` : "Pick a track first"}
            </button>
          </div>
        </>
      )}
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      {busy ? <p className={`text-xs font-semibold ${muted}`}>Splitting on the server — keep this tab open and the stems land right here.</p> : null}
      {result ? (
        <div className="space-y-2" data-testid="world-audio-stems-result">
          {result.urls.map((u) => (
            <AudioResult key={u.url} url={u.url} title={u.label} />
          ))}
          {splitJobId ? (
            <StemRemixPanel
              isLight={isLight}
              jobId={splitJobId}
              stemKeys={result.urls.map((u) => stemKeyOfResultLabel(u.label)).filter((k): k is string => k !== null)}
            />
          ) : null}
          <QuestProgressChip isLight={isLight} lines={quest.lines} />
        </div>
      ) : null}
    </div>
  );
}
