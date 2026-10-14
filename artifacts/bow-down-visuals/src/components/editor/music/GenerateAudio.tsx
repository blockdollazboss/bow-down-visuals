import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, Loader2, Music, AlertCircle, CheckCircle2, Disc3, Scissors,
  Layers, FileText, ChevronsRight, ChevronDown, Check, Upload, Save,
  Trash2, Wand2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { EditorCard, Field, Segmented, TextInput } from "@/components/editor/controls";
import { OutOfCredits } from "@/components/OutOfCredits";
import { generateMusicAudio } from "@/lib/generate-music-audio";
import { PublishToShowcase } from "@/components/PublishToShowcase";
import { CoverSongModal, type CoverRecord, type CoverSource } from "@/components/song/CoverSongModal";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { defaultStemEffects, type EditorSettings, type AudioStem } from "@/lib/editor-settings";
import { uploadStemFile, makeStem, readAudioDuration, removeStemFile } from "@/lib/audio-stems";
import {
  fetchLanePersonas, createLanePersona, deleteLanePersona,
  loadLocalLaneSession, saveLocalLaneSession, fetchServerLaneSession, saveServerLaneSession,
  type LanePersona, type LaneSession,
} from "@/lib/music-lane";

interface GenerateAudioProps {
  settings: EditorSettings;
  onChange: (next: EditorSettings) => void;
  artistName?: string;
  songTitle?: string;
  /** Active artist vault id — server swaps vocals to its locked voice if set. */
  artistVaultId?: string;
  /** Navigate user to the Captions tab (after lyrics land on the caption track). */
  onGoToCaptions?: () => void;
  /** Project id — scopes the persisted lane session to this project. */
  projectId?: string | null;
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

/* Section tags the Custom-mode lyrics editor inserts at the cursor. */
const SECTION_TAGS = ["Verse", "Chorus", "Pre-Chorus", "Bridge", "Hook", "Intro", "Outro", "Fade Out", "End"];

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
type RemasterPhase = "idle" | "loading" | "mastering" | "done" | "failed";
type ActionPanel = "extend" | "replace" | null;

export function GenerateAudio({ settings, onChange, artistName, songTitle, artistVaultId, onGoToCaptions, projectId }: GenerateAudioProps) {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const ms = settings.musicStudio;

  const [prompt, setPrompt] = useState("");
  const [lengthSeconds, setLengthSeconds] = useState("60");
  const [lyrics, setLyrics] = useState("");
  const [showLyrics, setShowLyrics] = useState(false);

  /* ── Phase B: Simple ⇄ Custom session shape ── */
  const [createMode, setCreateMode] = useState<"simple" | "custom">("simple");
  const [style, setStyle] = useState("");
  const [laneTitle, setLaneTitle] = useState(songTitle ?? "");
  const lyricsRef = useRef<HTMLTextAreaElement | null>(null);

  /* ── Phase B: Personas ── */
  const [personas, setPersonas] = useState<LanePersona[]>([]);
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [showPersonaSave, setShowPersonaSave] = useState(false);
  const [personaName, setPersonaName] = useState("");
  const [savingPersona, setSavingPersona] = useState(false);

  /* ── Phase B: upload-your-audio ── */
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTrack, setUploadTrack] = useState<{ stem: AudioStem; file: File } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [finishNotes, setFinishNotes] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [uploadExtendOpen, setUploadExtendOpen] = useState(false);
  const [uploadExtendPrompt, setUploadExtendPrompt] = useState("");
  const [uploadExtendSeconds, setUploadExtendSeconds] = useState("30");
  const [uploadExtending, setUploadExtending] = useState(false);

  /* Cover modal target — working song or uploaded track. */
  const [coverSource, setCoverSource] = useState<CoverSource | null>(null);
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
  const [sectionIdx, setSectionIdx] = useState(0);
  const [replaceDirection, setReplaceDirection] = useState("");
  const [showTiming, setShowTiming] = useState(false);
  const [startSec, setStartSec] = useState("");
  const [endSec, setEndSec] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [stemsPhase, setStemsPhase] = useState<StemsPhase>("idle");
  const [stemsNote, setStemsNote] = useState<string | null>(null);
  const [remasterPhase, setRemasterPhase] = useState<RemasterPhase>("idle");
  const [remasterNote, setRemasterNote] = useState<string | null>(null);
  const remasterCancelRef = useRef(false);
  const [captionsBusy, setCaptionsBusy] = useState(false);
  const [captionsDone, setCaptionsDone] = useState(false);
  const stemsCancelRef = useRef(false);

  /* ── Phase B form derivations ──
     Custom mode drives generation from the style field; Simple mode from
     the prompt box. The lane title overrides the project song title. */
  const effectiveTitle = laneTitle.trim() || songTitle;
  const formPrompt = createMode === "custom" ? style.trim() : prompt.trim();
  const formLyrics =
    (createMode === "custom" || showLyrics) && lyrics.trim() ? lyrics.trim() : undefined;

  /* Estimated section ranges for Replace Section — derived from the tagged
     lyrics by line count across the working song's duration (the same
     proportional method the scene generator uses when no AI timestamps
     exist). Estimates only; the user can fine-tune the numbers. */
  const sectionRanges = useMemo(() => {
    const parsed = parseSections(lyrics);
    const dur = lastGenerated?.durationSec;
    if (parsed.length === 0 || !dur || !isFinite(dur) || dur <= 0) return null;
    const weights = parsed.map((s) =>
      Math.max(1, s.lyrics.split("\n").filter((l) => l.trim()).length),
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    return parsed.map((s, i) => {
      const start = acc;
      acc += (weights[i]! / total) * dur;
      return { name: s.name, start, end: acc };
    });
  }, [lyrics, lastGenerated?.durationSec]);

  /* ── Phase B: session persistence (mirrors the song-and-video draft
     pattern: localStorage fast restore + /api/drafts server draft,
     debounced, scoped to this project) ── */
  const restoredRef = useRef(false);
  const suppressSaveUntilRef = useRef(0);
  const serverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function applySession(s: LaneSession) {
    setCreateMode(s.createMode === "custom" ? "custom" : "simple");
    setPrompt(s.prompt ?? "");
    setStyle(s.style ?? "");
    setLaneTitle(s.title ?? "");
    setLyrics(s.lyrics ?? "");
    setShowLyrics(!!s.showLyrics);
    setInstrumental(!!s.instrumental);
    setVocalGender(s.vocalGender || "auto");
    setLengthSeconds(s.lengthSeconds || "60");
    setVariantCount(s.variantCount || "2");
    setActivePersonaId(s.personaId ?? null);
    setLastVariants(Array.isArray(s.variants) ? s.variants : []);
    setPickedLabel(s.pickedLabel || "A");
    if (s.pickedVersion) {
      const existing = ms.stems.find((st) => st.url === s.pickedVersion!.url);
      if (existing) {
        setLastGenerated(existing);
      } else {
        const stem = buildStem(
          s.pickedVersion.url,
          s.pickedVersion.storagePath,
          s.pickedVersion.name,
          s.pickedVersion.durationSec,
        );
        onChange({ ...settings, musicStudio: { ...ms, stems: [stem, ...ms.stems] } });
        setLastGenerated(stem);
      }
    }
  }

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    let cancelled = false;
    (async () => {
      let session = loadLocalLaneSession(projectId ?? null);
      if (!session) {
        try {
          const token = await getAccessToken();
          session = await fetchServerLaneSession(token, projectId ?? null);
        } catch {
          /* server draft is best-effort */
        }
      }
      if (cancelled || !session) return;
      applySession(session);
      suppressSaveUntilRef.current = Date.now() + 2000;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function currentSession(): LaneSession {
    return {
      projectId: projectId ?? null,
      createMode,
      prompt,
      style,
      title: laneTitle,
      lyrics,
      showLyrics,
      instrumental,
      vocalGender,
      lengthSeconds,
      variantCount,
      personaId: activePersonaId,
      pickedVersion: lastGenerated
        ? {
            url: lastGenerated.url,
            storagePath: lastGenerated.storagePath,
            name: lastGenerated.name,
            durationSec: lastGenerated.durationSec,
          }
        : null,
      variants: lastVariants,
      pickedLabel,
      timestamp: Date.now(),
    };
  }

  const sessionHasContent = !!(
    prompt.trim() || style.trim() || lyrics.trim() || laneTitle.trim() || lastGenerated
  );

  /* Auto-save to localStorage (fast, same-browser) */
  useEffect(() => {
    if (!restoredRef.current || !sessionHasContent) return;
    if (Date.now() < suppressSaveUntilRef.current) return;
    saveLocalLaneSession(currentSession());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createMode, prompt, style, laneTitle, lyrics, showLyrics, instrumental, vocalGender, lengthSeconds, variantCount, activePersonaId, lastGenerated, lastVariants, pickedLabel]);

  /* Auto-save to the server draft (debounced 30 s, cross-session) */
  useEffect(() => {
    if (!restoredRef.current || !sessionHasContent || !user) return;
    if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    serverSaveTimer.current = setTimeout(async () => {
      if (Date.now() < suppressSaveUntilRef.current) return;
      try {
        const token = await getAccessToken();
        await saveServerLaneSession(token, currentSession());
      } catch {
        /* silent — local draft still saved */
      }
    }, 30_000);
    return () => {
      if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createMode, prompt, style, laneTitle, lyrics, showLyrics, instrumental, vocalGender, lengthSeconds, variantCount, activePersonaId, lastGenerated, lastVariants, pickedLabel, user]);

  /* ── Phase B: load personas (own + public templates) ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const list = await fetchLanePersonas(token);
        if (!cancelled) setPersonas(list);
      } catch {
        /* personas are optional — the lane works without them */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPersona(p: LanePersona) {
    const s = p.settings ?? {};
    if (s.stylePrompt) {
      setStyle(s.stylePrompt);
      setPrompt(s.stylePrompt);
    }
    if (s.vocalGender) setVocalGender(s.vocalGender);
    if (typeof s.instrumental === "boolean") setInstrumental(s.instrumental);
    if (s.lengthSeconds) setLengthSeconds(s.lengthSeconds);
    setActivePersonaId(p.id);
    toast({ title: `Persona applied — ${p.name}`, description: "Its style and voice settings are loaded into the form." });
  }

  async function handleSavePersona() {
    if (!formPrompt) {
      toast({ title: "Nothing to save yet", description: "Add a prompt or style first — a persona saves the sound you've dialed in.", variant: "destructive" });
      return;
    }
    const name = personaName.trim() || effectiveTitle?.trim() || "My Persona";
    setSavingPersona(true);
    try {
      const token = await getAccessToken();
      const persona = await createLanePersona(token, {
        name,
        gender: vocalGender === "male" || vocalGender === "female" ? vocalGender : "neutral",
        settings: {
          stylePrompt: formPrompt,
          vocalGender,
          instrumental,
          lengthSeconds,
        },
      });
      setPersonas((prev) => [persona, ...prev.filter((p) => p.id !== persona.id)]);
      setActivePersonaId(persona.id);
      setShowPersonaSave(false);
      setPersonaName("");
      toast({ title: "Persona saved", description: `"${persona.name}" is ready in the persona picker.` });
    } catch (err) {
      toast({ title: "Could not save persona", description: err instanceof Error ? err.message : "Try again in a moment.", variant: "destructive" });
    } finally {
      setSavingPersona(false);
    }
  }

  async function handleDeletePersona() {
    const p = personas.find((x) => x.id === activePersonaId);
    if (!p) return;
    try {
      const token = await getAccessToken();
      await deleteLanePersona(token, p.id);
      setPersonas((prev) => prev.filter((x) => x.id !== p.id));
      setActivePersonaId(null);
      toast({ title: "Persona deleted", description: `"${p.name}" was removed.` });
    } catch (err) {
      toast({ title: "Could not delete persona", description: err instanceof Error ? err.message : "Templates can't be deleted.", variant: "destructive" });
    }
  }

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
    if (!formPrompt) {
      toast({
        title: createMode === "custom" ? "Describe the style" : "Add a prompt",
        description: createMode === "custom"
          ? "Add a style (genre, mood, instrumentation) so the AI knows the sound."
          : "Describe the sound you want first.",
        variant: "destructive",
      });
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
        prompt: formPrompt,
        lengthSeconds: Number(lengthSeconds),
        artistName,
        songTitle: effectiveTitle,
        artistVaultId,
        lyrics: formLyrics,
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
        effectiveTitle ? `${effectiveTitle} (AI Generated)` : "AI Generated Audio",
        resp.durationMs / 1000,
      );

      /* Prepend so it becomes the fallback audio source (ms.stems[0]) used by the timeline. */
      onChange({ ...settings, musicStudio: { ...ms, stems: [stem, ...ms.stems] } });
      setLastGenerated(stem);
      setOpenPanel(null);
      setStemsPhase("idle");
      setStemsNote(null);
      setRemasterPhase("idle");
      setRemasterNote(null);
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
    const base = effectiveTitle ? `${effectiveTitle} (AI Generated)` : "AI Generated Audio";
    const stem = buildStem(v.url, v.storagePath, `${base} — Version ${v.label}`, lastGenerated.durationSec);
    swapWorkingStem(stem);
    setPickedLabel(v.label);
    setCaptionsDone(false);
    toast({ title: `Version ${v.label} picked`, description: "It's now your working song — extend it, cover it, split it." });
  }

  /* ── Extend (shared by the working song and an uploaded track) ──
     Returns the extended stem, or null when the user cancels the credit
     confirmation. Throws on API failure — callers surface the error. */
  async function extendStem(target: AudioStem, extendText: string, seconds: string): Promise<AudioStem | null> {
    const token = await getAccessToken();
    if (!token) throw new Error("You need to be signed in to extend audio.");
    const lenMs = Number(seconds) * 1000;
    const cost = lenMs <= 60_000 ? 400 : lenMs <= 180_000 ? 800 : 1200;
    const res = await confirmedFetch("/api/generate-music-audio/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        originalAudioUrl: target.url,
        originalPrompt: formPrompt || target.name,
        extendPrompt: extendText,
        extendSeconds: Number(seconds),
        lyrics: formLyrics,
        instrumental,
        vocalGender: vocalGender === "auto" ? undefined : vocalGender,
        songTitle: effectiveTitle,
        artistName,
      }),
      overrideCost: cost,
      overrideFeature: "Extend Song",
    });
    if (!res) return null; // user cancelled
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Extension failed.");
    return {
      ...target,
      id: `stem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: `${target.name} (Extended)`,
      url: data.url,
      storagePath: data.storagePath,
      durationSec: (target.durationSec ?? 0) + Number(seconds),
    };
  }

  async function handleExtend() {
    if (!lastGenerated || !extendPrompt.trim()) {
      toast({ title: "Describe the extension", description: "Tell the AI what to add (e.g. epic outro, second verse).", variant: "destructive" });
      return;
    }
    setExtending(true);
    setError(null);
    try {
      const extendedStem = await extendStem(lastGenerated, extendPrompt.trim(), extendSeconds);
      if (!extendedStem) return; // user cancelled
      // Replace the stem with the extended version.
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

  /* ── Upload-your-audio: pick a track, then Finish / Extend / Cover it ── */
  async function handleUploadPick(file: File | undefined) {
    if (!file) return;
    if (!user) {
      toast({ title: "Sign in first", description: "You need to be signed in to upload a track.", variant: "destructive" });
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const up = await uploadStemFile(user.id, file);
      const durationSec = await readAudioDuration(file);
      const stem = makeStem(file, up, "Full Song Mix", durationSec);
      onChange({ ...settings, musicStudio: { ...ms, stems: [stem, ...ms.stems] } });
      setUploadTrack({ stem, file });
      setUploadExtendOpen(false);
      toast({ title: "Track uploaded", description: "Finish it, extend it, or cover it — your call." });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function handleRemoveUpload() {
    if (!uploadTrack) return;
    const target = uploadTrack;
    onChange({ ...settings, musicStudio: { ...ms, stems: ms.stems.filter((s) => s.id !== target.stem.id) } });
    setUploadTrack(null);
    setUploadError(null);
    void removeStemFile(target.stem.storagePath);
  }

  async function handleFinishMySong() {
    if (!uploadTrack || finishing) return;
    setFinishing(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("demo", uploadTrack.file);
      if (finishNotes.trim()) form.append("notes", finishNotes.trim());
      const res = await confirmedFetch("/api/finish-my-song/complete", {
        method: "POST",
        body: form,
        overrideCost: 400,
        overrideFeature: "Finish My Song",
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as {
        songUrl?: string; lyrics?: string; influenceNote?: string; error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.songUrl) {
        throw new Error(data.message || data.error || "Could not finish your song.");
      }
      const stem = buildStem(data.songUrl, "", `${uploadTrack.stem.name} (Finished)`);
      onChange({ ...settings, musicStudio: { ...ms, stems: [stem, ...ms.stems] } });
      setLastGenerated(stem);
      setLastVariants([]);
      setPickedLabel("A");
      if (data.lyrics) {
        setLyrics(data.lyrics);
        setCreateMode("custom");
      }
      refreshProfile();
      toast({
        title: "Song finished!",
        description: data.influenceNote || "The completed song is your working song now — extend it, split it, caption it.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not finish your song.";
      if (msg === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
      } else {
        setUploadError(msg);
      }
    } finally {
      setFinishing(false);
    }
  }

  async function handleUploadExtend() {
    if (!uploadTrack || !uploadExtendPrompt.trim()) {
      toast({ title: "Describe the extension", description: "Tell the AI what to add (e.g. epic outro, second verse).", variant: "destructive" });
      return;
    }
    setUploadExtending(true);
    setUploadError(null);
    try {
      const extendedStem = await extendStem(uploadTrack.stem, uploadExtendPrompt.trim(), uploadExtendSeconds);
      if (!extendedStem) return; // user cancelled
      onChange({
        ...settings,
        musicStudio: { ...ms, stems: ms.stems.map((s) => (s.id === uploadTrack.stem.id ? extendedStem : s)) },
      });
      setUploadTrack({ stem: extendedStem, file: uploadTrack.file });
      setUploadExtendPrompt("");
      setUploadExtendOpen(false);
      refreshProfile();
      toast({ title: "Track extended!", description: "The new section was crossfaded onto your track." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not extend audio.";
      if (msg === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
      } else {
        setUploadError(msg);
      }
    } finally {
      setUploadExtending(false);
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
      const fileName = `${(effectiveTitle || "song").replace(/[^\w-]+/g, "-")}.mp3`;
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
      const base = effectiveTitle ? `${effectiveTitle} (AI Generated)` : "AI Generated Audio";
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

  /* ── Remaster: one-tap express mastering of the working song ──
     The same endpoint, preset default and charge as Audio Studio's Quick
     Master panel: POST /api/mastering (credit registry: "AI Mastering",
     400 Visual Bucs — the confirmedFetch dialog shows the cost before any
     charge). The working song is a URL, so it is fetched and re-uploaded
     as the audio file, exactly like handleStems does for /api/stems.
     Preset "streaming" is the Quick Master panel's own default
     (-14 LUFS · -1.0 dBTP) — the one parameter a one-tap honestly
     defaults. The mastered file swaps in as the working song. */
  async function handleRemaster() {
    if (!lastGenerated || remasterPhase === "loading" || remasterPhase === "mastering") return;
    remasterCancelRef.current = false;
    setRemasterPhase("loading");
    setRemasterNote("Loading your song…");
    setError(null);
    try {
      const songRes = await fetch(lastGenerated.url);
      if (!songRes.ok) throw new Error("Could not load the song audio for mastering.");
      const blob = await songRes.blob();
      const fileName = `${(effectiveTitle || "song").replace(/[^\w-]+/g, "-")}.mp3`;
      const form = new FormData();
      form.append("audio", new File([blob], fileName, { type: blob.type || "audio/mpeg" }));
      form.append("preset", "streaming");

      const res = await confirmedFetch("/api/mastering", { method: "POST", body: form });
      if (!res) { setRemasterPhase("idle"); setRemasterNote(null); return; } // user cancelled the credit confirmation
      const start = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string; message?: string };
      if (res.status === 402 || start.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        setRemasterPhase("idle");
        setRemasterNote(null);
        return;
      }
      if (!res.ok || !start.jobId) {
        throw new Error(start.message || start.error || "Could not start mastering.");
      }

      setRemasterPhase("mastering");
      setRemasterNote("Mastering — cleanup, glue, loudness and limiting. This can take a few minutes…");
      const jobId = start.jobId;
      const deadline = Date.now() + 10 * 60 * 1000;
      let doneData: { wavUrl?: string | null; mp3Url?: string | null } | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        if (remasterCancelRef.current) { setRemasterPhase("idle"); setRemasterNote(null); return; }
        let data: { status?: string; wavUrl?: string | null; mp3Url?: string | null; error?: string } | null = null;
        try {
          const pr = await fetch(`/api/mastering/${jobId}`);
          data = (await pr.json().catch(() => null)) as { status?: string; wavUrl?: string | null; mp3Url?: string | null; error?: string } | null;
          if (!pr.ok) throw new Error(data?.error || "Mastering failed.");
        } catch (pollErr) {
          // Job-level failures stop the loop; transient network errors keep polling.
          if (pollErr instanceof Error && /failed|not found/i.test(pollErr.message)) throw pollErr;
          continue;
        }
        if (!data) continue;
        if (data.status === "done") { doneData = data; break; }
        if (data.status === "failed") throw new Error(data.error || "Mastering failed — your Visual Bucs were refunded.");
      }
      if (!doneData) throw new Error("Mastering is taking longer than usual — it keeps running on the server, try again in a bit.");

      const masteredUrl = doneData.mp3Url || doneData.wavUrl;
      if (!masteredUrl) throw new Error("Mastering finished but returned no audio.");
      const stem = buildStem(masteredUrl, "", `${lastGenerated.name} (Remastered)`, lastGenerated.durationSec);
      swapWorkingStem(stem);
      setLastVariants([]);
      setRemasterPhase("done");
      setRemasterNote("Remastered — the polished version is now your working song.");
      refreshProfile();
      toast({ title: "Remastered", description: "Streaming-ready master swapped in as your working song." });
    } catch (err) {
      setRemasterPhase("failed");
      setRemasterNote(null);
      handleApiError(err, "Could not remaster this song.");
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
          title: (effectiveTitle ?? "").trim(),
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
  const remasterBusy = remasterPhase === "loading" || remasterPhase === "mastering";

  const actionBtn = (active: boolean) =>
    `inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[11px] font-bold transition-colors disabled:opacity-40 ${
      active
        ? "border-primary/50 bg-primary/10 text-primary"
        : "border-white/10 bg-white/[0.04] text-white/70 hover:text-white hover:border-white/25"
    }`;

  /* Insert a [Section] tag at the lyrics editor's cursor. */
  function insertSectionTag(tag: string) {
    const insert = `[${tag}]\n`;
    const el = lyricsRef.current;
    if (!el) {
      setLyrics((prev) => (prev && !prev.endsWith("\n") ? `${prev}\n${insert}` : `${prev}${insert}`));
      return;
    }
    const start = el.selectionStart ?? lyrics.length;
    const end = el.selectionEnd ?? lyrics.length;
    const before = lyrics.slice(0, start);
    const prefix = before && !before.endsWith("\n") ? "\n" : "";
    setLyrics(before + prefix + insert + lyrics.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = (before + prefix + insert).length;
      el.setSelectionRange(pos, pos);
    });
  }

  const presetRow = (
    <div className="flex flex-wrap gap-1.5">
      {STYLE_PRESETS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => {
            setPrompt(s);
            setStyle(s);
          }}
          className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/60 hover:border-primary/40 hover:text-white transition"
        >
          {s}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
    <EditorCard title="Generate Real Audio" subtitle="Describe a sound and get an actual AI-generated track" icon={<Music className="h-4 w-4" />}>
      <div className="space-y-4">
        {/* ── Simple ⇄ Custom ── */}
        <Field
          label="Mode"
          hint={createMode === "custom" ? "Your lyrics, your style, your title" : "Describe it — the AI writes the song"}
        >
          <Segmented
            value={createMode}
            options={[
              { value: "simple", label: "Simple" },
              { value: "custom", label: "Custom" },
            ]}
            onChange={(v) => setCreateMode(v === "custom" ? "custom" : "simple")}
          />
        </Field>

        {/* ── Persona picker ── */}
        {personas.length > 0 && (
          <Field label="Persona" hint="A saved style + voice — applying one loads its sound into the form">
            <div className="flex items-center gap-1.5">
              <select
                value={activePersonaId ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) {
                    setActivePersonaId(null);
                    return;
                  }
                  const p = personas.find((x) => x.id === id);
                  if (p) applyPersona(p);
                }}
                className="min-w-0 flex-1 rounded-xl bg-black/40 border border-white/10 px-3.5 py-2.5 text-sm text-white outline-none focus:border-primary/50 transition-colors"
                style={{ colorScheme: "dark" }}
                data-testid="select-persona"
              >
                <option value="">No persona</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.isPublic && p.userId !== user?.id ? " · Template" : ""}
                  </option>
                ))}
              </select>
              {activePersonaId && (
                <button
                  type="button"
                  onClick={() => void handleDeletePersona()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/50 transition-colors hover:border-red-500/40 hover:text-red-300"
                  title="Delete this persona"
                  data-testid="btn-delete-persona"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </Field>
        )}

        {createMode === "simple" ? (
          <>
            <Field label="Music prompt" hint="Genre, mood, instrumentation, tempo...">
              <TextInput
                value={prompt}
                onChange={setPrompt}
                placeholder="e.g. dark trap beat, 140 BPM, heavy 808s, moody piano melody"
                testId="input-generate-audio-prompt"
              />
            </Field>
            {presetRow}
          </>
        ) : (
          <>
            <Field label="Song title">
              <TextInput
                value={laneTitle}
                onChange={setLaneTitle}
                placeholder="e.g. Midnight Crown"
                testId="input-lane-title"
              />
            </Field>
            <Field label="Style" hint="Genre, mood, instrumentation, tempo — drives the whole sound">
              <TextInput
                value={style}
                onChange={setStyle}
                placeholder="e.g. dark trap, 140 BPM, heavy 808s, moody piano melody"
                testId="input-lane-style"
              />
            </Field>
            {presetRow}
          </>
        )}

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

        {/* Lyrics — full editor in Custom mode; collapsible in Simple */}
        {createMode === "custom" ? (
          <Field label="Your lyrics" hint="Sung verbatim. Tap a tag to mark a section.">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {SECTION_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => insertSectionTag(tag)}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-bold text-white/60 hover:border-primary/40 hover:text-white transition"
                  data-testid={`btn-tag-${tag.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  [{tag}]
                </button>
              ))}
            </div>
            <textarea
              ref={lyricsRef}
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder={"[Verse]\nWalking through the midnight rain...\n\n[Chorus]\nWe rise, we rise..."}
              rows={8}
              className="w-full rounded-xl bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 text-sm p-3 focus:border-primary/50 focus:outline-none resize-y"
              data-testid="input-generate-audio-lyrics"
            />
          </Field>
        ) : (
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
                    ref={lyricsRef}
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
        )}

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
                onClick={() => lastGenerated && setCoverSource({
                  title: effectiveTitle?.trim() || lastGenerated.name,
                  audioUrl: lastGenerated.url,
                  artistName,
                })}
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
                onClick={() => void handleRemaster()}
                disabled={remasterBusy}
                className={actionBtn(remasterPhase === "done")}
                data-testid="btn-action-remaster"
              >
                {remasterBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Remaster
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
              <button
                type="button"
                onClick={() => setShowPersonaSave((v) => !v)}
                className={actionBtn(showPersonaSave)}
                data-testid="btn-action-persona"
              >
                <Save className="h-3.5 w-3.5" /> Save as Persona
              </button>
            </div>

            {/* ── Save as Persona form ── */}
            {showPersonaSave && (
              <div className="space-y-2 rounded-xl border border-white/[0.07] bg-black/30 p-3">
                <Field label="Persona name" hint="Saves this sound — style + voice settings — so any new song can wear it">
                  <TextInput
                    value={personaName}
                    onChange={setPersonaName}
                    placeholder={effectiveTitle ? `${effectiveTitle} sound` : "e.g. Midnight Crooner"}
                    testId="input-persona-name"
                  />
                </Field>
                <Button
                  onClick={() => void handleSavePersona()}
                  disabled={savingPersona}
                  className="w-full h-9 text-xs font-black bg-primary text-black hover:bg-primary/90"
                  data-testid="btn-save-persona"
                >
                  {savingPersona ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Saving…</> : <><Save className="h-3.5 w-3.5 mr-2" /> Save persona</>}
                </Button>
              </div>
            )}

            {stemsNote && (
              <p className={`text-[11px] leading-relaxed ${stemsPhase === "failed" ? "text-red-300" : stemsPhase === "done" ? "text-emerald-300" : "text-white/45"}`}>
                {stemsNote}
              </p>
            )}
            {remasterNote && (
              <p className={`text-[11px] leading-relaxed ${remasterPhase === "failed" ? "text-red-300" : remasterPhase === "done" ? "text-emerald-300" : "text-white/45"}`}>
                {remasterNote}
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
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      setSectionIdx(idx);
                      const r = sectionRanges?.[idx];
                      if (r) {
                        setStartSec(String(Math.round(r.start)));
                        setEndSec(String(Math.round(r.end)));
                      }
                    }}
                    disabled={replacing}
                    className="w-full rounded-xl bg-black/40 border border-white/10 px-3.5 py-2.5 text-sm text-white outline-none focus:border-primary/50 transition-colors"
                    style={{ colorScheme: "dark" }}
                    data-testid="select-replace-section"
                  >
                    {sections.map((s, i) => (
                      <option key={`${s.name}-${i}`} value={i}>
                        [{s.name}]{sectionRanges?.[i] ? ` · ${formatTime(sectionRanges[i]!.start)}–${formatTime(sectionRanges[i]!.end)}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                {sectionRanges && (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1.5" data-testid="replace-section-marks">
                      {sectionRanges.map((r, i) => {
                        const active = i === Math.min(sectionIdx, sections.length - 1);
                        return (
                          <button
                            key={`${r.name}-${i}`}
                            type="button"
                            disabled={replacing}
                            onClick={() => {
                              setSectionIdx(i);
                              setStartSec(String(Math.round(r.start)));
                              setEndSec(String(Math.round(r.end)));
                              setShowTiming(true);
                            }}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-40 ${
                              active
                                ? "border-primary/50 bg-primary/10 text-primary"
                                : "border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                            }`}
                          >
                            [{r.name}] {formatTime(r.start)}–{formatTime(r.end)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-white/35">
                      Section times are estimated from your lyrics — picking one fills the timing below; adjust it if the cut feels off.
                    </p>
                  </div>
                )}
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
        <CoverSongModal
          open={coverSource !== null}
          onClose={() => setCoverSource(null)}
          source={coverSource}
          initialLyrics={lyrics}
          initialTitle={coverSource?.title ?? ""}
          onCoverCreated={handleCoverCreated}
        />
      </div>
    </EditorCard>

    {/* ── Upload-your-audio: Finish / Extend / Cover your own track ── */}
    <EditorCard title="Start From Your Track" subtitle="Upload a song or rough demo — finish it, extend it, or cover it" icon={<Upload className="h-4 w-4" />}>
      <div className="space-y-4">
        <input
          ref={uploadInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.oga,.flac,.aac,.opus,.webm"
          className="hidden"
          onChange={(e) => {
            void handleUploadPick(e.target.files?.[0]);
            e.target.value = "";
          }}
          data-testid="input-upload-track"
        />

        {uploadError && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/25">
            <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-200/90 leading-relaxed">{uploadError}</p>
          </div>
        )}

        {!uploadTrack ? (
          <div>
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploading}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-6 text-center transition hover:border-primary/40 disabled:opacity-50"
              data-testid="btn-upload-track"
            >
              {uploading
                ? <Loader2 className="h-6 w-6 animate-spin text-primary" />
                : <Upload className="h-6 w-6 text-primary" />}
              <span className="text-sm font-black text-white">{uploading ? "Uploading…" : "Upload your audio"}</span>
              <span className="text-[11px] leading-relaxed text-white/40">
                A finished track, a voice memo, a rough demo — MP3, WAV, M4A and more, up to 50 MB.
              </span>
            </button>
            <p className="mt-2 text-[11px] text-white/35">
              Uploading is free. The AI work — Finish, Extend, Cover — charges Visual Bucs only when you run it.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Music className="h-4 w-4 shrink-0 text-primary" />
              <p className="min-w-0 flex-1 truncate text-xs font-black text-white">{uploadTrack.stem.name}</p>
              <span className="text-[10px] font-mono tabular-nums text-white/35">{formatTime(uploadTrack.stem.durationSec)}</span>
              <button
                type="button"
                onClick={handleRemoveUpload}
                className="shrink-0 text-white/35 transition-colors hover:text-white"
                aria-label="Remove uploaded track"
                data-testid="btn-upload-remove"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <audio controls src={uploadTrack.stem.url} className="w-full" data-testid="audio-upload-preview" />

            <Field label="What's missing?" hint="Optional — what the finished song still needs">
              <TextInput
                value={finishNotes}
                onChange={setFinishNotes}
                placeholder="needs a chorus and a bridge, bigger drums"
                testId="input-finish-notes"
              />
            </Field>

            <div className="flex flex-wrap gap-1.5">
              <Button
                onClick={() => void handleFinishMySong()}
                disabled={finishing}
                className="h-9 px-3 text-[11px] font-black bg-primary text-black hover:bg-primary/90"
                data-testid="btn-finish-my-song"
              >
                {finishing
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Finishing…</>
                  : <><Wand2 className="h-3.5 w-3.5 mr-1.5" /> Finish My Song · 400 Visual Bucs</>}
              </Button>
              <button
                type="button"
                onClick={() => setUploadExtendOpen((v) => !v)}
                className={actionBtn(uploadExtendOpen)}
                data-testid="btn-upload-extend"
              >
                <ChevronsRight className="h-3.5 w-3.5" /> Extend
              </button>
              <button
                type="button"
                onClick={() => setCoverSource({
                  title: uploadTrack.stem.name,
                  audioUrl: uploadTrack.stem.url,
                  artistName,
                })}
                className={actionBtn(false)}
                data-testid="btn-upload-cover"
              >
                <Disc3 className="h-3.5 w-3.5" /> Cover
              </button>
            </div>

            {uploadExtendOpen && (
              <div className="space-y-3 rounded-xl border border-white/[0.07] bg-black/30 p-3">
                <Field label="What to add" hint="e.g. epic outro, second verse, bridge">
                  <TextInput
                    value={uploadExtendPrompt}
                    onChange={setUploadExtendPrompt}
                    placeholder="epic orchestral outro with choir"
                    testId="input-upload-extend-prompt"
                  />
                </Field>
                <Field label="Extension length">
                  <Segmented
                    value={uploadExtendSeconds}
                    options={[
                      { value: "15", label: "15s" },
                      { value: "30", label: "30s" },
                      { value: "60", label: "60s" },
                    ]}
                    onChange={setUploadExtendSeconds}
                  />
                </Field>
                <Button
                  onClick={() => void handleUploadExtend()}
                  disabled={uploadExtending}
                  className="w-full h-10 text-sm font-black bg-primary text-black hover:bg-primary/90"
                  data-testid="btn-upload-extend-run"
                >
                  {uploadExtending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Extending…</> : "Extend track"}
                </Button>
                <p className="text-[11px] text-white/35">
                  Generates a continuation and crossfades it onto the end of your track. Charged for the new section only.
                </p>
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-white/35">
              Finish My Song writes the missing parts and produces the completed song — it becomes your
              working song above, ready to extend, split into stems, and turn into captions.
            </p>
          </div>
        )}
      </div>
    </EditorCard>
    </div>
  );
}
