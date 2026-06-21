import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Music, Settings, FolderOpen, Zap, ArrowLeft,
  Copy, CheckCheck, ChevronRight, Loader2, Download, Save
} from "lucide-react";

/* ─────────────────────────── TYPES ─────────────────────────── */

interface SongFormValues {
  artistName: string;
  songTitle: string;
  genre: string;
  mood: string;
  songTopic: string;
  cleanOrExplicit: string;
  voiceStyle: string;
  beatStyle: string;
  songLength: string;
  specialInstructions: string;
}

/* ─────────────────────────── DROPDOWN OPTIONS ─────────────────────────── */

const GENRES = [
  "Hip Hop", "Drill", "Trap", "R&B", "Pop",
  "Afrobeats", "Dancehall", "Gospel", "Kids Music",
  "Rock", "Country", "Other",
];

const MOODS = [
  "Luxury", "Dark", "Emotional", "Street", "Romantic",
  "Energetic", "Pain", "Victory", "Party",
  "Inspirational", "Funny", "Kid-Friendly",
];

const LENGTHS = ["30 seconds", "60 seconds", "2 minutes", "Full song"];

/* ─────────────────────────── PLACEHOLDER RESULT ─────────────────────────── */

function buildPlaceholder(v: SongFormValues) {
  const artist = v.artistName || "The Artist";
  const title = v.songTitle || "Untitled";
  const genre = v.genre || "Hip Hop";
  const mood = v.mood || "Emotional";
  const topic = v.songTopic || "the come-up";

  return {
    "Song Concept": `A ${mood.toLowerCase()} ${genre} track about ${topic}. The story follows ${artist} navigating real moments with raw honesty — built for listeners who feel everything deeply. The energy stays consistent throughout, locking in a signature sound that defines this era of ${artist}'s brand.`,

    "Title Ideas": `• "${title}"\n• "${title} (The Anthem)"\n• "No More Waiting"\n• "From the Ground Up"\n• "${artist}'s World"`,

    "Full Lyrics": `[Intro]\nYeah, it's ${artist}\nThis one's for the real ones\n\n[Hook]\nEvery night I'm up, chasing what I need\nCan't stop now, I got too much to believe\n${mood === "Dark" ? "Shadows on my back, still I plant my seed" : "Sun behind my name, let the whole world see"}\nThis is for the ones who know what it means to bleed\n\n[Verse 1]\nStarted from the bottom, didn't have a clue\nNow they all watching, wonder what I'll do\n${genre === "Drill" ? "In the trenches, every day I push through" : "In the studio, making every line true"}\nDedicated to the ones who never doubted you\n\n[Verse 2]\nEverybody talks but few know the real\nI've been working silent, that's the only deal\nLate nights, early mornings — that's how you build\n${mood === "Luxury" ? "Now the lifestyle matches everything I feel" : "Still I move in silence, staying focused and skilled"}\n\n[Bridge]\nThey said I'd never make it, look at me now\nEvery doubt they gave me turned into my crown\nNot just for the money, I'm doing this for life\nEvery sacrifice I made was sharpening my knife\n\n[Outro]\nYeah… ${artist}\n${title}\nThis is just the beginning\nBow Down.`,

    "Hook": `Every night I'm up, chasing what I need\nCan't stop now, I got too much to believe\n${mood === "Dark" ? "Shadows on my back, still I plant my seed" : "Sun behind my name, let the whole world see"}\nThis is for the ones who know what it means to bleed`,

    "Verse 1": `Started from the bottom, didn't have a clue\nNow they all watching, wonder what I'll do\n${genre === "Drill" ? "In the trenches, every day I push through" : "In the studio, making every line true"}\nDedicated to the ones who never doubted you`,

    "Verse 2": `Everybody talks but few know the real\nI've been working silent, that's the only deal\nLate nights, early mornings — that's how you build\n${mood === "Luxury" ? "Now the lifestyle matches everything I feel" : "Still I move in silence, staying focused and skilled"}`,

    "Bridge": `They said I'd never make it, look at me now\nEvery doubt they gave me turned into my crown\nNot just for the money, I'm doing this for life\nEvery sacrifice I made was sharpening my knife`,

    "Outro": `Yeah… ${artist}\n${title}\nThis is just the beginning\nBow Down.`,

    "AI Music Prompt": `Generate a ${mood.toLowerCase()} ${genre} instrumental with ${v.beatStyle || "punchy 808s and layered hi-hats"}. BPM range: ${genre === "Drill" ? "140–145" : genre === "R&B" ? "75–85" : "90–105"}. Key: ${mood === "Dark" ? "F minor" : "G major"}. Include atmospheric pads, ${v.beatStyle || "trap-style drums"}, and melodic elements that evoke ${topic}. The drop should hit at 0:32. Master for streaming at -14 LUFS.`,

    "Suggested Beat Style": `${v.beatStyle || `Dark melodic ${genre} — rolling 808 bass, crisp snare, layered hi-hats, and a haunting piano or synth lead. Tempo: 140 BPM. Key: F minor. The intro should breathe for 8 bars before the full beat drops.`}`,

    "Suggested Vocal Style": `${v.voiceStyle || `Confident and controlled delivery with subtle ad-libs. Punch in on every 2nd and 4th beat. Use light autotune for texture — not pitch correction. Layer the hook 3x with harmony on the last syllable of each line. Record ${v.cleanOrExplicit === "Clean" ? "clean takes with radio-friendly substitutions" : "explicit takes with full raw delivery"}.`}`,

    "Cover Art Prompt": `Dark studio environment, dramatic single-point lighting from above. ${artist} standing center frame, wearing all black, head slightly tilted. Neon purple light leaks in the background spelling "${title}". Cinematic color grade — deep blacks, cool highlights, purple tones. Aspect ratio: 1:1 for streaming, 16:9 for YouTube. Text: "${title}" in bold white serif at the bottom third.`,

    "Music Video Idea": `Open on a time-lapse of an empty city at 3AM — streets wet from rain, streetlights reflecting. Cut to ${artist} alone in a studio, headphones on, writing in a notebook. As the hook hits, quick-cut montage: early mornings, late nights, practice sessions. The bridge pulls back to a rooftop at golden hour — city panorama — representing the breakthrough. Final shot: ${artist} walking away from camera as lights come on across the skyline. Director's style: cinematic, intimate, story-driven.`,
  };
}

/* ─────────────────────────── SHARED TOP BAR ─────────────────────────── */

function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex flex-col leading-none cursor-pointer shrink-0">
          <span className="text-white font-black text-base tracking-tight">BOW DOWN</span>
          <span className="text-primary font-black text-sm tracking-widest -mt-0.5">VISUALS</span>
        </Link>
        <div className="flex items-center gap-3 md:gap-5">
          <div className="flex items-center gap-2 bg-primary/10 border border-primary/25 rounded-full px-3.5 py-1.5">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-bold text-white">3</span>
            <span className="text-xs text-primary/70 font-medium hidden sm:inline">credits</span>
          </div>
          <button className="hidden sm:flex items-center gap-1.5 text-sm font-medium text-white/50 hover:text-white transition-colors">
            <FolderOpen className="h-4 w-4" />
            <span>My Projects</span>
          </button>
          <button className="flex items-center justify-center h-8 w-8 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors">
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

/* ─────────────────────────── FORM FIELD WRAPPERS ─────────────────────────── */

function FieldWrapper({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{label}</Label>
      {children}
    </div>
  );
}

const inputClass =
  "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl";

const selectClass =
  "h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] transition-colors appearance-none cursor-pointer";

function StyledSelect({
  name,
  placeholder,
  options,
  value,
  onChange,
}: {
  name: string;
  placeholder: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClass}
        style={{ colorScheme: "dark" }}
      >
        <option value="" disabled style={{ background: "#111" }}>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o} value={o} style={{ background: "#111" }}>
            {o}
          </option>
        ))}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 rotate-90 pointer-events-none" />
    </div>
  );
}

/* ─────────────────────────── RESULT SECTION ─────────────────────────── */

function ResultSection({ data }: { data: Record<string, string> }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const text = Object.entries(data)
      .map(([k, v]) => `## ${k}\n\n${v}`)
      .join("\n\n---\n\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const sections = Object.entries(data);

  return (
    <div className="space-y-6 mt-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-bold tracking-widest text-primary uppercase">Result Ready</span>
          </div>
          <h2 className="text-2xl font-black text-white">Song Package</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={handleCopy}
            variant="outline"
            size="sm"
            className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-2"
          >
            {copied ? <CheckCheck className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied!" : "Copy Result"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled
            className="border-white/5 text-white/25 cursor-not-allowed gap-2"
          >
            <Save className="h-4 w-4" /> Save Project
            <Badge variant="outline" className="border-white/10 text-white/25 text-[10px] ml-1">Soon</Badge>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled
            className="border-white/5 text-white/25 cursor-not-allowed gap-2"
          >
            <Download className="h-4 w-4" /> Download
            <Badge variant="outline" className="border-white/10 text-white/25 text-[10px] ml-1">Soon</Badge>
          </Button>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {sections.map(([heading, content], i) => (
          <div
            key={heading}
            className="p-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:border-primary/20 transition-colors"
          >
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs font-bold text-primary/50 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="text-base font-bold text-white">{heading}</h3>
            </div>
            <p className="text-white/60 text-sm leading-relaxed whitespace-pre-line">{content}</p>
          </div>
        ))}
      </div>

      {/* Bottom action row */}
      <div className="flex items-center gap-2 flex-wrap pt-2">
        <Button
          onClick={handleCopy}
          className="purple-glow font-semibold gap-2"
        >
          {copied ? <CheckCheck className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied!" : "Copy Result"}
        </Button>
        <Button variant="outline" size="sm" disabled className="border-white/5 text-white/25 cursor-not-allowed gap-1.5">
          <Save className="h-3.5 w-3.5" /> Save Project Coming Soon
        </Button>
        <Button variant="outline" size="sm" disabled className="border-white/5 text-white/25 cursor-not-allowed gap-1.5">
          <Download className="h-3.5 w-3.5" /> Download Coming Soon
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function MakeSong() {
  const [result, setResult] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<SongFormValues>({
    defaultValues: {
      artistName: "", songTitle: "", genre: "", mood: "",
      songTopic: "", cleanOrExplicit: "", voiceStyle: "",
      beatStyle: "", songLength: "", specialInstructions: "",
    },
  });

  const watched = watch();

  function onSubmit(values: SongFormValues) {
    setLoading(true);
    setResult(null);
    setTimeout(() => {
      setResult(buildPlaceholder(values));
      setLoading(false);
      setTimeout(() => {
        document.getElementById("song-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }, 1400);
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-purple-600/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Breadcrumb */}
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Dashboard
        </Link>

        {/* Page header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <Music className="h-5 w-5 text-white" />
            </div>
            <Badge className="bg-primary/10 text-primary border-primary/25 text-xs font-bold tracking-wide">
              1 credit
            </Badge>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">
            Make a Song
          </h1>
          <p className="text-white/50 text-lg max-w-2xl">
            Create lyrics, hooks, verses, beat direction, vocal style, and AI music prompts for your next release.
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">

            {/* Row 1: Artist + Song Title */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Artist Name">
                <Input
                  {...register("artistName", { required: true })}
                  placeholder="e.g. Lil Nova"
                  className={inputClass + (errors.artistName ? " border-red-500/50" : "")}
                />
                {errors.artistName && <p className="text-red-400 text-xs mt-1">Artist name is required</p>}
              </FieldWrapper>
              <FieldWrapper label="Song Title">
                <Input
                  {...register("songTitle")}
                  placeholder="e.g. On My Way Up"
                  className={inputClass}
                />
              </FieldWrapper>
            </div>

            {/* Row 2: Genre + Mood */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Genre">
                <StyledSelect
                  name="genre"
                  placeholder="Select genre..."
                  options={GENRES}
                  value={watched.genre}
                  onChange={(v) => setValue("genre", v)}
                />
              </FieldWrapper>
              <FieldWrapper label="Mood">
                <StyledSelect
                  name="mood"
                  placeholder="Select mood..."
                  options={MOODS}
                  value={watched.mood}
                  onChange={(v) => setValue("mood", v)}
                />
              </FieldWrapper>
            </div>

            {/* Row 3: Song Topic */}
            <FieldWrapper label="Song Topic">
              <Input
                {...register("songTopic", { required: true })}
                placeholder="e.g. coming up from nothing, losing someone, street life, first love..."
                className={inputClass + (errors.songTopic ? " border-red-500/50" : "")}
              />
              {errors.songTopic && <p className="text-red-400 text-xs mt-1">Song topic is required</p>}
            </FieldWrapper>

            {/* Row 4: Clean/Explicit + Song Length */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Clean or Explicit">
                <StyledSelect
                  name="cleanOrExplicit"
                  placeholder="Select..."
                  options={["Clean", "Explicit"]}
                  value={watched.cleanOrExplicit}
                  onChange={(v) => setValue("cleanOrExplicit", v)}
                />
              </FieldWrapper>
              <FieldWrapper label="Song Length">
                <StyledSelect
                  name="songLength"
                  placeholder="Select length..."
                  options={LENGTHS}
                  value={watched.songLength}
                  onChange={(v) => setValue("songLength", v)}
                />
              </FieldWrapper>
            </div>

            {/* Row 5: Voice Style + Beat Style */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Voice Style">
                <Input
                  {...register("voiceStyle")}
                  placeholder="e.g. deep, raspy, melodic, aggressive, smooth..."
                  className={inputClass}
                />
              </FieldWrapper>
              <FieldWrapper label="Beat Style">
                <Input
                  {...register("beatStyle")}
                  placeholder="e.g. dark 808s, trap drums, live piano, boom bap..."
                  className={inputClass}
                />
              </FieldWrapper>
            </div>

            {/* Row 6: Special Instructions */}
            <FieldWrapper label="Special Instructions">
              <Textarea
                {...register("specialInstructions")}
                placeholder="Any extra details — references, specific themes, things to avoid, cultural notes..."
                className="min-h-[100px] bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl resize-none"
              />
            </FieldWrapper>

            {/* Submit */}
            <div className="pt-2">
              <Button
                type="submit"
                size="lg"
                disabled={loading}
                className="w-full sm:w-auto purple-glow font-bold text-base h-13 px-12 rounded-xl gap-3"
                style={{ height: "52px" }}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Building your song package...
                  </>
                ) : (
                  <>
                    <Music className="h-5 w-5" />
                    Generate Song Package
                  </>
                )}
              </Button>
              <p className="text-white/25 text-xs mt-3">Uses 1 credit per generation</p>
            </div>
          </form>
        </div>

        {/* Result */}
        {result && (
          <div id="song-result">
            <ResultSection data={result} />
          </div>
        )}

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/[0.05] text-center">
          <p className="text-white/20 text-sm">© 2026 Bow Down Visuals. Create the Song. Create the Video. Promote the Release.</p>
        </div>
      </div>
    </div>
  );
}
