import { useRef, useState } from "react";
import {
  Sparkles, Loader2, Music, AlertCircle, CheckCircle2, Disc3, Scissors,
  Layers, FileText, ChevronsRight, ChevronDown, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { EditorCard, Field, Segmented, TextInput } from "@/components/editor/controls";
import { OutOfCredits } from "@/components/OutOfCredits";
import { generateMusicAudio } from "@/lib/generate-music-audio";
import { PublishToShowcase } from "@/components/PublishToShowcase";
import { CoverSongModal, type CoverRecord } from "@/components/song/CoverSongModal";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { defaultStemEffects, type EditorSettings, type AudioStem } from "@/lib/editor-settings";

interface GenerateAudioProps {
  settings: EditorSettings;
  onChange: (next: EditorSettings) => void;
  artistName?: string;
  songTitle?: string;
  /** Active artist vault id — server swaps vocals to its locked voice if set. */
  artistVaultId?: string;
  /** Navigate user to the Captions tab (after lyrics land on the caption track). */
  onGoToCaptions?: () => void;
}

const LENGTH_OPTIONS = [
  { value: "30", label: "30s" },
  { value: "60", label: "60s" },
  { value: "120", label: "2min" },
  { value: "180", label: "3min" },
];

const VOCAL_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

const VARIANT_OPTIONS = [
  { value: "1", label: "1 take" },
  { value: "2", label: "2 takes (2×)" },
];

/* One-tap style starters for the prompt box. */
const STYLE_PRESETS = [
  "Dark trap, 140 BPM, heavy 808s",
  "Lo-fi hip hop, chill, vinyl crackle",
  "Epic orchestral, cinematic build",
  "Afrobeats, danceable, log drums",
  "Pop anthem, uplifting, big chorus",
  "R&B slow jam, silky, late night",
];

const COMMON_SECTIONS = ["Intro", "Verse 1", "Pre-Chorus", "Chorus", "Verse 2", "Chorus", "Bridge", "Outro"];

interface ParsedSection {
  name: string;
  lyrics: string;
}

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

function sectionsFor(lyrics: string): ParsedSection[] {
  const parsed = lyrics.trim() ? parseSections(lyrics) : [];
  if (parsed.length > 0) return parsed;
  return COMMON_SECTIONS.map((name, i, arr) => ({
    name: arr.indexOf(name) === i ? name : `${name} ${arr.slice(0, i).filter((n) => n === name).length + 1}`,
    lyrics: "",
  }));
}

function formatTime(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* Deterministic mini waveform for a version card (visual only — playback is
   the native audio element under it, same as the stem rows). */
function VersionWaveform({ seedKey, active }: { seedKey: string; active: boolean }) {
  let seed = seedKey.split("").reduce((a, c) => a + c.charCodeAt(0), 7);
  const bars: number[] = [];
  for (let i = 0; i < 36; i++) {
    seed = (seed * 16807) % 2147483647;
    bars.push(0.25 + ((seed % 100) / 100) * 0.75);
  }
  return (
    <div className="flex items-center gap-[2px] h-9" aria-hidden="true">
      {bars.map((h, i) => (
        <span
          key={i}
          className={`flex-1 rounded-full ${active ? "bg-primary/70" : "bg-white/20"}`}
          style={{ height: `${Math.round(h * 100)}%` }}
        />
      ))}
    </div>
  );
}

type StemsPhase = "idle" | "loading" | "splitting" | "done" | "failed";
type ActionPanel = "extend" | "replace" | null;

export function GenerateAudio({ settings, onChange, artistName, songTitle, artistVaultId, onGoToCaptions }: GenerateAudioProps) {
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const ms = settings.musicStudio;

  const [prompt, setPrompt] = useState("");
  const [lengthSeconds, setLengthSeconds] = useState("60");
  const [lyrics, setLyrics] = useState("");
  const [showLyrics, setShowLyrics] = useState(false);
  const [instrumental, setInstrumental] = useState(false);
  const [vocalGender, setVocalGender] = useState("auto");
  const [variantCount, setVariantCount] = useState("2");
  const [generating, setGenerating] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<AudioStem | null>(null);
  const [lastVariants, setLastVariants] = useState<Array<{ url: string; storagePath: string; label: string }>>([]);
  const [pickedLabel, setPickedLabel] = useState("A");

  /* Working-song action row state */
  const [openPanel, setOpenPanel] = useState<ActionPanel>(null);
  const [extendPrompt, setExtendPrompt] = useState("");
  const [extendSeconds, setExtendSeconds] = useState("30");
  const [extending, setExtending] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [replaceDirection, setReplaceDirection] = useState("");
  const [showTiming, setShowTiming] = useState(false);
  const [startSec, setStartSec] = useState("");
  const [endSec, setEndSec] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [stemsPhase, setStemsPhase] = useState<StemsPhase>("idle");
  const [stemsNote, setStemsNote] = useState<string | null>(null);
  const [captionsBusy, setCaptionsBusy] = useState(false);
  const [captionsDone, setCaptionsDone] = useState(false);
  const stemsCancelRef = useRef(false);

  function buildStem(url: string, storagePath: string, name: string, durationSec?: number): AudioStem {
    return {
      id: `stem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      type: "Full Song Mix",
      url,
      storagePath,
      fileType: "audio/mpeg",
      fileSize: 0,
      uploadedAt: new Date().toISOString(),
      durationSec,
      muted: false,
      solo: false,
      locked: false,
      volume: 100,
      pan: 0,
      trimStart: 0,
      trimEnd: 0,
      startTime: 0,
      effects: defaultStemEffects(),
    };
  }

  /** Swap the working stem in place (keeps its slot at the top of the stems). */
  function swapWorkingStem(next: AudioStem) {
    if (!lastGenerated) return;
    onChange({
      ...settings,
      musicStudio: {
        ...ms,
        stems: [next, ...ms.stems.filter((s) => s.id !== lastGenerated.id)],
      },
    });
    setLastGenerated(next);
  }

  function handleApiError(err: unknown, fallback: string) {
    const msg = err instanceof Error ? err.message : fallback;
    if (msg === "out_of_credits") {
      setOutOfCredits(true);
      refreshProfile();
    } else {
      setError(msg);
    }
  }

  async function handleGenerate() {
    if (!prompt.trim()) {
      toast({ title: "Add a prompt", description: "Describe the sound you want first.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You need to be signed in to generate audio.");
      // Mirror the server's tiered pricing so the confirm dialog shows the real cost.
      const lenMs = Number(lengthSeconds) * 1000;
      const baseCost = lenMs <= 60_000 ? 400 : lenMs <= 180_000 ? 800 : 1200;
      const actualCost = baseCost * Number(variantCount);
      const resp = await generateMusicAudio(token, {
        prompt: prompt.trim(),
        lengthSeconds: Number(lengthSeconds),
        artistName,
        songTitle,
        artistVaultId,
        lyrics: showLyrics && lyrics.trim() ? lyrics.trim() : undefined,
        instrumental,
        vocalGender: vocalGender === "auto" ? undefined : vocalGender,
        variants: Number(variantCount),
      }, confirmedFetch, actualCost);
      if (!resp) return; // user cancelled the credit confirmation

      const variants = resp.variants?.length ? resp.variants : [{ url: resp.url, storagePath: resp.storagePath, label: "A" }];
      setLastVariants(variants.map((v) => ({ url: v.url, storagePath: v.storagePath, label: v.label })));
      setPickedLabel(variants[0].label);

      const stem = buildStem(
        variants[0].url,
        variants[0].storagePath,
        songTitle ? `${songTitle} (AI Generated)` : "AI Generated Audio",
        resp.durationMs / 1000,
      );

      /* Prepend so it becomes the fallback audio source (ms.stems[0]) used by the timeline. */
      onChange({ ...settings, musicStudio: { ...ms, stems: [stem, ...ms.stems] } });
      setLastGenerated(stem);
      setOpenPanel(null);
      setStemsPhase("idle");
      setStemsNote(null);
      setCaptionsDone(false);
      refreshProfile();
      toast({ title: "Audio generated!", description: "Added to your stems — it'll play in Timeline Preview." });
    } catch (err) {
      handleApiError(err, "Could not generate audio.");
    } finally {
      setGenerating(false);
    }
  }

  /* ── Version picking: the picked take becomes the lane's working song ── */
  function pickVariant(v: { url: string; storagePath: string; label: string }) {
    if (!lastGenerated || v.label === pickedLabel) return;
    const base = songTitle ? `${songTitle} (AI Generated)` : "AI Generated Audio";
    const stem = buildStem(v.url, v.storagePath, `${base} — Version ${v.label}`, lastGenerated.durationSec);
    swapWorkingStem(stem);
    setPickedLabel(v.label);
    setCaptionsDone(false);
    toast({ title: `Version ${v.label} picked`, description: "It's now your working song — extend it, cover it, split it." });
  }

  /* ── Extend ── */
  async function handleExtend() {
    if (!lastGenerated || !extendPrompt.trim()) {
      toast({ title: "Describe the extension", description: "Tell the AI what to add (e.g. epic outro, second verse).", variant: "destructive" });
      return;
    }
    setExtending(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You need to be signed in to extend audio.");
      const lenMs = Number(extendSeconds) * 1000;
      const cost = lenMs <= 60_000 ? 400 : lenMs <= 180_000 ? 800 : 1200;
      const res = await confirmedFetch("/api/generate-music-audio/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          originalAudioUrl: lastGenerated.url,
          originalPrompt: prompt.trim(),
          extendPrompt: extendPrompt.trim(),
          extendSeconds: Number(extendSeconds),
          lyrics: showLyrics && lyrics.trim() ? lyrics.trim() : undefined,
          instrumental,
          vocalGender: vocalGender === "auto" ? undefined : vocalGender,
          songTitle,
          artistName,
        }),
        overrideCost: cost,
        overrideFeature: "Extend Song",
      });
      if (!res) return; // user cancelled
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extension failed.");

      // Replace the stem with the extended version.
      const extendedStem: AudioStem = {
        ...lastGenerated,
        id: `stem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: `${lastGenerated.name} (Extended)`,
        url: data.url,
        storagePath: data.storagePath,
        durationSec: (lastGenerated.durationSec ?? 0) + Number(extendSeconds),
      };
      onChange({ ...settings, musicStudio: { ...ms, stems: [extendedStem, ...ms.stems.filter((s) => s.id !== lastGenerated.id)] } });
      setLastGenerated(extendedStem);
      setLastVariants([]);
      setOpenPanel(null);
      setExtendPrompt("");
      refreshProfile();
      toast({ title: "Song extended!", description: "The new section was crossfaded onto your track." });
    } catch (err) {
      handleApiError(err, "Could not extend audio.");
    } finally {
      setExtending(false);
    }
  }

  /* ── Cover: the shared cover flow, result lands back here as a track ── */
  function handleCoverCreated(cover: CoverRecord) {
    const stem = buildStem(cover.audio_url, "", cover.title);
    onChange({ ...settings, musicStudio: { ...ms, stems: [stem, ...ms.stems] } });
    refreshProfile();
    toast({ title: "Cover added to your tracks", description: `"${cover.title}" is at the top of your stems.` });
  }

  /* ── Replace Section ── */
  async function handleReplaceSection() {
    if (!lastGenerated) return;
    const sections = sectionsFor(lyrics);
    const idx = Math.min(sectionIdx, sections.length - 1);
    const section = sections[idx];
    if (!section) return;
    setReplacing(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        title: lastGenerated.name,
        section: section.name,
        sectionIndex: idx,
        totalSections: sections.length,
        sectionLyrics: section.lyrics || undefined,
        styleTweak: replaceDirection.trim() || undefined,
        audioUrl: lastGenerated.url,
      };
      const s = Number(startSec);
      const e = Number(endSec);
      if (Number.isFinite(s) && s >= 0 && startSec !== "") body.startSec = s;
      if (Number.isFinite(e) && e > 0 && endSec !== "") body.endSec = e;

      const res = await confirmedFetch("/api/song-replace-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as {
        song?: { id: string; title: string; audio_url: string };
        error?: string; code?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits" || data.code === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.song) {
        throw new Error(data.message || data.error || "Could not replace that section.");
      }
      const stem = buildStem(data.song.audio_url, "", `${lastGenerated.name} (Section Replaced)`, lastGenerated.durationSec);
      swapWorkingStem(stem);
      setLastVariants([]);
      setOpenPanel(null);
      setCaptionsDone(false);
      refreshProfile();
      toast({ title: "Section replaced", description: `The ${section.name} was regenerated and spliced back in.` });
    } catch (err) {
      handleApiError(err, "Could not replace that section.");
    } finally {
      setReplacing(false);
    }
  }

  /* ── Stems: split the working song, drop each stem on the tracks ── */
  async function handleStems() {
    if (!lastGenerated || stemsPhase === "loading" || stemsPhase === "splitting") return;
    stemsCancelRef.current = false;
    setStemsPhase("loading");
    setStemsNote("Loading your song…");
    setError(null);
    try {
      const songRes = await fetch(lastGenerated.url);
      if (!songRes.ok) throw new Error("Could not load the song audio for splitting.");
      const blob = await songRes.blob();
      const fileName = `${(songTitle || "song").replace(/[^\w-]+/g, "-")}.mp3`;
      const form = new FormData();
      form.append("audio", new File([blob], fileName, { type: blob.type || "audio/mpeg" }));

      const res = await confirmedFetch("/api/stems", { method: "POST", body: form });
      if (!res) { setStemsPhase("idle"); setStemsNote(null); return; } // user cancelled
      const start = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string; message?: string };
      if (res.status === 402 || start.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        setStemsPhase("idle");
        setStemsNote(null);
        return;
      }
      if (!res.ok || !start.jobId) {
        throw new Error(start.message || start.error || "Could not start the stem split.");
      }

      setStemsPhase("splitting");
      setStemsNote("Splitting into vocals, drums, bass and other — this can take a few minutes…");
      const jobId = start.jobId;
      const deadline = Date.now() + 10 * 60 * 1000;
      let doneData: { stems?: Record<string, string | null> | null; durationSeconds?: number } | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        if (stemsCancelRef.current) { setStemsPhase("idle"); setStemsNote(null); return; }
        let data: { status?: string; stems?: Record<string, string | null> | null; durationSeconds?: number; error?: string } | null = null;
        try {
          const pr = await fetch(`/api/stems/${jobId}`);
          data = (await pr.json().catch(() => null)) as { status?: string; stems?: Record<string, string | null> | null; durationSeconds?: number; error?: string } | null;
          if (!pr.ok) throw new Error(data?.error || "Stem split failed.");
        } catch (pollErr) {
          // Job-level failures stop the loop; transient network errors keep polling.
          if (pollErr instanceof Error && /failed|not found/i.test(pollErr.message)) throw pollErr;
          continue;
        }
        if (!data) continue;
        if (data.status === "done") { doneData = data; break; }
        if (data.status === "failed") throw new Error(data.error || "Stem split failed — your Visual Bucs were refunded.");
      }
      if (!doneData) throw new Error("The stem split is taking longer than usual — it keeps running on the server, try again in a bit.");

      const order: Array<{ key: string; label: string; type: string }> = [
        { key: "vocals", label: "Vocals", type: "Lead Vocals" },
        { key: "drums", label: "Drums", type: "Drums" },
        { key: "bass", label: "Bass", type: "808 / Bass" },
        { key: "other", label: "Other", type: "Other Stem" },
      ];
      const base = songTitle ? `${songTitle} (AI Generated)` : "AI Generated Audio";
      const newStems: AudioStem[] = [];
      for (const part of order) {
        const url = doneData.stems?.[part.key];
        if (!url) continue;
        const stem = buildStem(url, "", `${base} — ${part.label}`, doneData.durationSeconds);
        stem.type = part.type;
        newStems.push(stem);
      }
      if (newStems.length === 0) throw new Error("The split finished but returned no stems.");
      onChange({ ...settings, musicStudio: { ...ms, stems: [...newStems, ...ms.stems] } });
      setStemsPhase("done");
      setStemsNote(`${newStems.length} stems added to your tracks — mix them in the Library.`);
      refreshProfile();
      toast({ title: "Stems ready", description: "Vocals, drums, bass and other are now separate tracks." });
    } catch (err) {
      setStemsPhase("failed");
      setStemsNote(null);
      handleApiError(err, "Could not split stems.");
    }
  }

  /* ── Lyrics to Captions: time the lyrics, land them on the caption track ── */
  async function handleLyricsToCaptions() {
    if (!lastGenerated || captionsBusy) return;
    const text = lyrics.trim();
    if (!text) {
      setShowLyrics(true);
      toast({
        title: "Add your lyrics first",
        description: "Open “Add custom lyrics”, paste the words, then send them to captions.",
        variant: "destructive",
      });
      return;
    }
    setCaptionsBusy(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/wave9a/lyrics/timing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: 50,
        overrideFeature: "Lyrics-to-Timeline",
        body: JSON.stringify({
          lyrics: text,
          durationSec: Math.round(lastGenerated.durationSec ?? Number(lengthSeconds)),
          title: (songTitle ?? "").trim(),
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as {
        lines?: Array<{ text: string; start: number; end: number }>;
        error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.lines) || data.lines.length === 0) {
        throw new Error(data.message || data.error || "Could not time those lyrics.");
      }
      const newLines = data.lines.map((l, i) => ({
        id: `wave9a-${Date.now()}-${i}`,
        startSec: Number.isFinite(Number(l.start)) ? Number(l.start) : 0,
        endSec: Number.isFinite(Number(l.end)) ? Number(l.end) : 0,
        text: String(l.text).trim(),
      }));
      onChange({
        ...settings,
        captions: {
          ...settings.captions,
          lyricsText: text,
          lines: [...settings.captions.lines, ...newLines],
        },
      });
      setCaptionsDone(true);
      refreshProfile();
      toast({ title: "Lyrics on the caption track", description: `${newLines.length} timed lines added — style them in the Captions tab.` });
      onGoToCaptions?.();
    } catch (err) {
      handleApiError(err, "Could not time those lyrics.");
    } finally {
      setCaptionsBusy(false);
    }
  }

  const sections = sectionsFor(lyrics);
  const activeSection = sections[Math.min(sectionIdx, sections.length - 1)];
  const stemsBusy = stemsPhase === "loading" || stemsPhase === "splitting";

  const actionBtn = (active: boolean) =>
    `inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[11px] font-bold transition-colors disabled:opacity-40 ${
      active
        ? "border-primary/50 bg-primary/10 text-primary"
        : "border-white/10 bg-white/[0.04] text-white/70 hover:text-white hover:border-white/25"
    }`;

  return (
    <EditorCard title="Generate Real Audio" subtitle="Describe a sound and get an actual AI-generated track" icon={<Music className="h-4 w-4" />}>
      <div className="space-y-4">
        <Field label="Music prompt" hint="Genre, mood, instrumentation, tempo...">
          <TextInput
            value={prompt}
            onChange={setPrompt}
            placeholder="e.g. dark trap beat, 140 BPM, heavy 808s, moody piano melody"
            testId="input-generate-audio-prompt"
          />
        </Field>

        {/* Style presets */}
        <div className="flex flex-wrap gap-1.5">
          {STYLE_PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setPrompt(s)}
              className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/60 hover:border-primary/40 hover:text-white transition"
            >
              {s}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Length">
            <Segmented value={lengthSeconds} options={LENGTH_OPTIONS} onChange={setLengthSeconds} />
          </Field>
          <Field label="Vocals" hint={instrumental ? "Off — instrumental" : undefined}>
            <Segmented value={vocalGender} options={VOCAL_OPTIONS} onChange={setVocalGender} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Takes" hint="2 takes costs 2× Visual Bucs">
            <Segmented value={variantCount} options={VARIANT_OPTIONS} onChange={setVariantCount} />
          </Field>
          <Field label="Instrumental">
            <button
              type="button"
              role="switch"
              aria-checked={instrumental}
              onClick={() => setInstrumental(!instrumental)}
              className={`relative h-6 w-11 rounded-full transition ${instrumental ? "bg-primary" : "bg-white/15"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${instrumental ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </Field>
        </div>

        {/* Custom lyrics */}
        <div>
          <button
            type="button"
            onClick={() => setShowLyrics(!showLyrics)}
            className="text-xs font-bold text-primary hover:underline"
          >
            {showLyrics ? "− Hide custom lyrics" : "+ Add custom lyrics"}
          </button>
          {showLyrics && (
            <div className="mt-2">
              <Field label="Your lyrics" hint="Sung verbatim. Use [Verse], [Chorus] etc. for structure.">
                <textarea
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  placeholder={"[Verse]\nWalking through the midnight rain...\n\n[Chorus]\nWe rise, we rise..."}
                  rows={6}
                  className="w-full rounded-xl bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 text-sm p-3 focus:border-primary/50 focus:outline-none resize-y"
                  data-testid="input-generate-audio-lyrics"
                />
              </Field>
            </div>
          )}
        </div>

        {outOfCredits && <OutOfCredits />}

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/25">
            <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-200/90 leading-relaxed">{error}</p>
          </div>
        )}

        <Button
          onClick={handleGenerate}
          disabled={generating || outOfCredits}
          className="w-full h-11 text-sm font-black bg-primary text-black hover:bg-primary/90"
          data-testid="btn-generate-real-audio"
        >
          {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating audio…</> : <><Sparkles className="h-4 w-4 mr-2" /> Generate Audio</>}
        </Button>

        {lastGenerated && !generating && (
          <div className="space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <p className="text-xs font-black text-emerald-300">{lastGenerated.name}</p>
            </div>

            {/* ── Version A / Version B cards ── */}
            {lastVariants.length > 1 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {lastVariants.map((v) => {
                  const picked = v.label === pickedLabel;
                  return (
                    <div
                      key={v.label}
                      className={`rounded-xl border p-3 space-y-2 ${picked ? "border-primary/50 bg-primary/[0.06]" : "border-white/10 bg-black/30"}`}
                      data-testid={`version-card-${v.label}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${picked ? "bg-primary text-black" : "bg-primary/20 text-primary"}`}>
                          {v.label}
                        </span>
                        <p className="text-xs font-black text-white">Version {v.label}</p>
                        <span className="ml-auto text-[10px] font-mono text-white/35 tabular-nums">{formatTime(lastGenerated.durationSec)}</span>
                      </div>
                      <VersionWaveform seedKey={v.label + v.url} active={picked} />
                      <audio controls src={v.url} className="w-full h-8" data-testid={`version-player-${v.label}`} />
                      {picked ? (
                        <p className="flex items-center gap-1.5 text-[11px] font-bold text-primary">
                          <Check className="h-3.5 w-3.5" /> Working song — in your stems
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => pickVariant(v)}
                          className="w-full h-8 rounded-lg bg-primary text-black text-[11px] font-black hover:bg-primary/90 transition-colors"
                          data-testid={`btn-pick-version-${v.label}`}
                        >
                          Pick this one
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <audio controls src={lastGenerated.url} className="w-full" data-testid="audio-generate-real-preview" />
            )}

            {/* ── Working-song action row ── */}
            <div className="flex flex-wrap gap-1.5" data-testid="song-action-row">
              <button
                type="button"
                onClick={() => setOpenPanel(openPanel === "extend" ? null : "extend")}
                className={actionBtn(openPanel === "extend")}
                data-testid="btn-action-extend"
              >
                <ChevronsRight className="h-3.5 w-3.5" /> Extend
              </button>
              <button
                type="button"
                onClick={() => setCoverOpen(true)}
                className={actionBtn(false)}
                data-testid="btn-action-cover"
              >
                <Disc3 className="h-3.5 w-3.5" /> Cover
              </button>
              <button
                type="button"
                onClick={() => setOpenPanel(openPanel === "replace" ? null : "replace")}
                className={actionBtn(openPanel === "replace")}
                data-testid="btn-action-replace"
              >
                <Scissors className="h-3.5 w-3.5" /> Replace Section
              </button>
              <button
                type="button"
                onClick={() => void handleStems()}
                disabled={stemsBusy}
                className={actionBtn(stemsPhase === "done")}
                data-testid="btn-action-stems"
              >
                {stemsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />} Stems
              </button>
              <button
                type="button"
                onClick={() => void handleLyricsToCaptions()}
                disabled={captionsBusy}
                className={actionBtn(captionsDone)}
                data-testid="btn-action-captions"
              >
                {captionsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Lyrics to Captions
              </button>
            </div>

            {stemsNote && (
              <p className={`text-[11px] leading-relaxed ${stemsPhase === "failed" ? "text-red-300" : stemsPhase === "done" ? "text-emerald-300" : "text-white/45"}`}>
                {stemsNote}
              </p>
            )}
            {captionsDone && (
              <p className="text-[11px] text-emerald-300">Lyrics are timed on the caption track — style them in the Captions tab.</p>
            )}

            {/* ── Extend panel ── */}
            {openPanel === "extend" && (
              <div className="space-y-3 rounded-xl border border-white/[0.07] bg-black/30 p-3">
                <Field label="What to add" hint="e.g. epic outro, second verse, bridge">
                  <TextInput
                    value={extendPrompt}
                    onChange={setExtendPrompt}
                    placeholder="epic orchestral outro with choir"
                    testId="input-extend-prompt"
                  />
                </Field>
                <Field label="Extension length">
                  <Segmented
                    value={extendSeconds}
                    options={[
                      { value: "15", label: "15s" },
                      { value: "30", label: "30s" },
                      { value: "60", label: "60s" },
                    ]}
                    onChange={setExtendSeconds}
                  />
                </Field>
                <Button
                  onClick={handleExtend}
                  disabled={extending}
                  className="w-full h-10 text-sm font-black bg-primary text-black hover:bg-primary/90"
                >
                  {extending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Extending…</> : "Extend song"}
                </Button>
                <p className="text-[11px] text-white/35">
                  Generates a continuation and crossfades it onto the end of your track. Charged for the new section only.
                </p>
              </div>
            )}

            {/* ── Replace Section panel ── */}
            {openPanel === "replace" && (
              <div className="space-y-3 rounded-xl border border-white/[0.07] bg-black/30 p-3">
                <Field label="Section to redo">
                  <select
                    value={Math.min(sectionIdx, sections.length - 1)}
                    onChange={(e) => setSectionIdx(Number(e.target.value))}
                    disabled={replacing}
                    className="w-full rounded-xl bg-black/40 border border-white/10 px-3.5 py-2.5 text-sm text-white outline-none focus:border-primary/50 transition-colors"
                    style={{ colorScheme: "dark" }}
                    data-testid="select-replace-section"
                  >
                    {sections.map((s, i) => (
                      <option key={`${s.name}-${i}`} value={i}>[{s.name}]</option>
                    ))}
                  </select>
                </Field>
                {activeSection?.lyrics ? (
                  <p className="text-[11px] text-white/40 leading-relaxed rounded-lg border border-white/[0.07] bg-black/30 p-2.5 max-h-24 overflow-y-auto whitespace-pre-wrap">
                    {activeSection.lyrics}
                  </p>
                ) : (
                  <p className="text-[11px] text-white/35">
                    Sections are placed by position in the song. Add tagged lyrics above ([Verse], [Chorus]…) to redo a section by its exact words.
                  </p>
                )}
                <Field label="New direction" hint="Optional — how the new section should feel">
                  <TextInput
                    value={replaceDirection}
                    onChange={setReplaceDirection}
                    placeholder="bigger drums, key change up, gospel choir lift"
                    testId="input-replace-direction"
                  />
                </Field>
                <button
                  type="button"
                  onClick={() => setShowTiming((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/45 hover:text-white transition-colors"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showTiming ? "rotate-180" : ""}`} />
                  Fine-tune timing
                </button>
                {showTiming && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Start (sec)">
                      <TextInput value={startSec} onChange={setStartSec} placeholder="0" testId="input-replace-start" />
                    </Field>
                    <Field label="End (sec)">
                      <TextInput value={endSec} onChange={setEndSec} placeholder="30" testId="input-replace-end" />
                    </Field>
                  </div>
                )}
                <Button
                  onClick={handleReplaceSection}
                  disabled={replacing}
                  className="w-full h-10 text-sm font-black bg-primary text-black hover:bg-primary/90"
                  data-testid="btn-replace-section"
                >
                  {replacing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Replacing…</> : <><Scissors className="h-4 w-4 mr-2" /> Replace section · 300 Visual Bucs</>}
                </Button>
                <p className="text-[11px] text-white/35">
                  Only the picked section is regenerated — it's crossfade-spliced back into your song and becomes the working version.
                </p>
              </div>
            )}

            <PublishToShowcase
              mediaType="song"
              mediaUrl={lastGenerated.url}
              defaultTitle={lastGenerated.name}
            />
            <a
              href="/video-editor?tab=lyric-video"
              className="inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline"
            >
              → Make a lyric video with timestamped lyrics
            </a>
          </div>
        )}

        {/* Cover flow — shared modal, result chained back into the tracks */}
        {lastGenerated && (
          <CoverSongModal
            open={coverOpen}
            onClose={() => setCoverOpen(false)}
            source={{
              title: songTitle?.trim() || lastGenerated.name,
              audioUrl: lastGenerated.url,
              artistName,
            }}
            initialLyrics={lyrics}
            initialTitle={songTitle?.trim() || lastGenerated.name}
            onCoverCreated={handleCoverCreated}
          />
        )}
      </div>
    </EditorCard>
  );
}
