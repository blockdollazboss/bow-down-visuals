import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Video, ArrowLeft, Loader2, ChevronRight, ChevronLeft, BarChart2, Check,
  Music2, Palette, Sparkles, Clapperboard, Film, Download, Volume2,
} from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { callGenerateApi } from "@/lib/generate-api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";
import { GenerationResult } from "@/components/GenerationResult";
import { SceneStudio } from "@/components/SceneStudio";
import { ClipSequencePlayer } from "@/components/ClipSequencePlayer";
import { ReferenceAudioPlayer } from "@/components/ReferenceAudioPlayer";
import { FinalVideoExport } from "@/components/FinalVideoExport";
import { ArtistVaultSelector, type ArtistVault } from "@/components/ArtistVaultSelector";
import { AudioTranscribe } from "@/components/AudioTranscribe";
import type { SongStructure } from "@/lib/song-structure";
import { SongSectionAnalysis } from "@/components/SongSectionAnalysis";
import { parseScenes, extractBreakdownContent, type SceneData } from "@/lib/scene-parser";

/* ─────────────────────────── TYPES ─────────────────────────── */

interface VideoFormValues {
  artistName: string;
  songTitle: string;
  genre: string;
  mood: string;
  videoStyle: string;
  platform: string;
  videoLength: string;
  lyrics: string;
  artistDescription: string;
  specialInstructions: string;
}

/* ─────────────────────────── OPTIONS ─────────────────────────── */

const GENRES = [
  "Hip Hop","Drill","Trap","R&B","Pop",
  "Afrobeats","Dancehall","Gospel","Kids Music","Rock","Country","Other",
];

const MOODS = [
  "Luxury","Dark","Emotional","Street","Romantic",
  "Energetic","Pain","Victory","Party","Inspirational","Funny","Kid-Friendly",
];

const VIDEO_STYLES = [
  "Street Cinematic","Luxury Rap Video","Brooklyn Drill","Dark Emotional Story",
  "Performance Video","Club Video","Cartoon Music Video","Anime Music Video",
  "Kids Nursery Rhyme","Romantic R&B Visual","Documentary Style",
];

const PLATFORMS = [
  "TikTok / Reels / Shorts - 9:16",
  "YouTube Music Video - 16:9",
  "Square Social Post - 1:1",
  "All Formats",
];

const LENGTHS = ["15 seconds","30 seconds","60 seconds","Full song"];

/* ─────────────────────────── PLACEHOLDER RESULT ─────────────────────────── (removed) */

function buildPlaceholder(v: VideoFormValues) {
  const artist = v.artistName || "The Artist";
  const title = v.songTitle || "Untitled";
  const genre = v.genre || "Hip Hop";
  const mood = v.mood || "Dark";
  const style = v.videoStyle || "Street Cinematic";
  const platform = v.platform || "YouTube Music Video - 16:9";
  const length = v.videoLength || "Full song";

  const isVertical = platform.includes("9:16");
  const aspectNote = isVertical ? "9:16 vertical (1080×1920)" : platform.includes("1:1") ? "1:1 square (1080×1080)" : "16:9 widescreen (1920×1080)";

  return {
    "Director's Treatment": `"${title}" by ${artist} is a ${mood.toLowerCase()} ${style.toLowerCase()} visual built for ${platform.split(" -")[0]}. The concept follows ${artist} through a raw, unfiltered narrative that mirrors the emotional core of the lyrics. Every frame is intentional — color, light, and movement serve the story. The pacing locks with the beat: slow-burn on the verses, explosive on the hook. This is not just a music video; it's a world-building exercise for the ${artist} brand.

Director's Note: Shoot ${length === "Full song" ? "over 2 production days" : "in a focused single-day shoot"}. Prioritize practical lighting and real locations over studio sets. The goal is authenticity — raw, premium, and undeniable.`,

    "Visual Style": `Color Grade: ${mood === "Dark" || mood === "Pain" ? "Deep blacks, cool blue shadows, minimal highlights. Think 2AM streetlight energy." : mood === "Luxury" ? "Warm gold tones, rich shadows, cinematic depth. Think high-fashion editorial." : mood === "Romantic" ? "Soft warm tones, natural light, shallow depth of field. Think intimate and vulnerable." : "High contrast, punchy colors, dynamic range. Think raw energy captured on film."}

Lighting: ${style.includes("Luxury") ? "High-key with rim lights, neon accents, practicals in the background." : style.includes("Drill") ? "Low-key motivated lighting — street practicals only. Harsh shadows." : "Mixed natural and practical lighting for an organic, documentary feel."}

Camera Movement: ${genre === "Drill" || mood === "Dark" ? "Handheld for verse sections — locked off for the hook. Close-ups heavy." : "Fluid steadicam on verses, drone establishing shots, tight close-ups on the hook."}

Aspect Ratio: ${aspectNote}`,

    "Main Locations": `Location 1 — Hero Environment
${style.includes("Street") || style.includes("Drill") ? "Urban alley or rooftop — city skyline in background. Graffiti walls, chain-link fences, industrial texture." : style.includes("Luxury") ? "High-rise penthouse interior, luxury car exterior, upscale restaurant or lounge." : style.includes("Kids") ? "Bright colorful classroom, playground, animated bedroom set." : "Studio environment with custom set dressing — controlled lighting, branded backdrop."}

Location 2 — Contrast/Flashback Environment  
${mood === "Emotional" || mood === "Pain" ? "Childhood bedroom or empty church — personal and intimate. Minimal props. Natural window light." : mood === "Victory" ? "Stadium exterior or city overlook — wide-open space showing scale and achievement." : "Abstract environment — fog machine, colored gels, minimal set for the hook sequence."}

Location 3 — Outro/Closer
Wide open exterior — the artist alone. Backlit silhouette against the skyline. Final frame: face to camera, direct eye contact. No cuts. Hold for 3 seconds.`,

    "Wardrobe & Artist Look": `Main Look — Verse Sections
${style.includes("Luxury") ? "Designer fit — monochromatic. All black or all white preferred. Statement jewelry. Clean sneakers or dress shoes." : style.includes("Drill") ? "Street-authentic fit — puffer jacket or hoodie, fitted pants, fresh sneakers. Minimal color, no logos." : style.includes("Kids") || genre === "Kids Music" ? "Bright primary colors, fun patterns, comfortable movement-friendly fit." : "Genre-appropriate streetwear — authentic to the artist's real brand, not costumized."}

Hook Look — Changed fit for visual variety
Contrast to the verse look. If verse is dark, hook is lighter. If verse is casual, hook elevates.

Accessories
${mood === "Luxury" ? "Chains, rings, watches — intentional and styled, not random." : genre === "Gospel" ? "Minimal jewelry — clean and dignified. The message is the statement." : "Keep it authentic to the artist's everyday look. No styling that feels borrowed."}`,

    "Scene-by-Scene Breakdown": `[00:00–00:08] — Cold Open
Static wide shot of the ${style.includes("Street") ? "empty city block at dawn" : style.includes("Luxury") ? "penthouse window overlooking the city" : "artist's environment"}. No artist yet. Just atmosphere. Sound design: ambient ${mood === "Dark" ? "city noise, distant sirens" : "morning birds, wind"}.

[00:08–00:20] — Intro / Artist Introduction
${artist} enters frame from the left. Slow motion, 50% speed. Camera pushes in. Direct eye contact with lens. Beat drops on the cut to normal speed.

[00:20–01:00] — Verse 1
${length !== "15 seconds" ? "Handheld camera. Close-ups on face, hands, environment. Intercut between artist performing and b-roll of the world they're describing. Each line gets a matching visual." : "Single-location tight performance. Camera orbits slowly. Every cut lands on a beat."}

${length === "Full song" ? `[01:00–01:20] — Pre-Hook
Energy builds. Camera movement speeds up. Quick cuts — 12 frames each. Artist moving toward camera. Visual metaphor for momentum.

[01:20–01:50] — Hook
WIDE SHOT. Artist center frame, environment in full view. Locked-off camera. Slow zoom. This is the moment. If there are background performers, they activate here.

[01:50–02:30] — Verse 2
Return to handheld. New location or new lighting condition. The story deepens. Close-ups more extreme — eyes, hands, details.

[02:30–02:50] — Bridge
The emotional peak. Slow motion. Single location. Minimal movement. Just the artist and the camera. Color grade shifts slightly — more desaturated.

[02:50–03:20] — Final Hook / Outro
Full energy. All elements together. Camera pulls back to reveal the full scope of the environment. Artist walks away from camera. Final frame: their back, heading toward the horizon.` : ""}`,

    "AI Video Prompts": `Prompt 1 — Main Performance Shot
"${style} music video, ${artist} performing to camera, ${mood.toLowerCase()} atmosphere, ${genre} aesthetic, cinematic lighting, ${isVertical ? "vertical 9:16 frame" : "widescreen 16:9 frame"}, 4K quality, professional color grade, realistic, detailed --ar ${isVertical ? "9:16" : "16:9"}"

Prompt 2 — Environment / Location Shot
"${style.includes("Street") ? "empty urban alley at night, street lights, wet pavement reflection, cinematic" : style.includes("Luxury") ? "luxury penthouse interior, golden hour light, city skyline through floor-to-ceiling windows, cinematic" : "atmospheric music video environment, moody lighting, cinematic"}, no people, establishing shot, ${genre} music video aesthetic, 4K --ar ${isVertical ? "9:16" : "16:9"}"

Prompt 3 — Close-Up Detail Shot
"extreme close-up, artist hands and jewelry, ${mood.toLowerCase()} music video, dramatic side lighting, shallow depth of field, bokeh background, cinematic 4K --ar ${isVertical ? "9:16" : "16:9"}"

Prompt 4 — Hook Wide Shot
"wide shot music video, ${artist.toLowerCase()} centered, ${style.toLowerCase()} visual style, dynamic composition, ${mood.toLowerCase()} color palette, cinematic, professional music video, 4K --ar ${isVertical ? "9:16" : "16:9"}"`,

    "Negative Prompts": `Avoid in all generations:
• Blurry faces or hands
• Distorted fingers or jewelry
• Low resolution or pixelated textures
• Overly saturated or neon-colored skin tones
• Text or watermarks in frame
• Generic stock footage look
• Incorrect aspect ratio
• Cheap or flat lighting
• Unnatural posing or stiff body language
• Background clutter that distracts from the artist`,

    "Promo Clip Ideas": `Clip 1 — Teaser (15 sec, ${isVertical ? "9:16" : "16:9"})
Best 3 shots from the video — no lyrics, just music and visuals. End card: "${title} — Out Now" with release date. No dialogue.

Clip 2 — Behind the Scenes (30–60 sec)
Raw behind-the-scenes footage from shoot day. Show the process, not just the product. Makes the release feel real and earned.

Clip 3 — Hook Highlight (15 sec)
Just the hook section on loop with lyrics overlaid as captions. High rewatch value. Optimized for TikTok sound-off viewing.

Clip 4 — Day-of-Release Drop
"It's here." — Black screen, white text. Then the first 5 seconds of the video. Link in bio. Maximum curiosity with minimal explanation.`,

    "Thumbnail Prompts": `YouTube Thumbnail (16:9)
"${artist} music video thumbnail, close-up face, intense expression, ${mood.toLowerCase()} background, ${style.toLowerCase()} aesthetic, bold title text '${title}' in bottom third, high contrast, professional, YouTube thumbnail design, 1920×1080"

Instagram / Square Thumbnail (1:1)
"square music video cover art, ${artist}, ${style.toLowerCase()} visual, centered composition, title '${title}' in clean bold font, ${mood.toLowerCase()} color palette, professional, 1080×1080"

Vertical Thumbnail / TikTok Cover (9:16)
"vertical music video thumbnail, ${artist} full body shot, ${style.toLowerCase()} style, dramatic lighting, '${title}' text at top, 1080×1920, TikTok cover format, premium"`,

    "Caption Ideas": `Drop caption (Post day):
🎬 "${title}" — The visual is here.
Watch the full music video now. Link in bio.
#${genre.replace(/\s/g, "")} #${artist.replace(/\s/g, "")} #MusicVideo #NewMusic

Teaser caption (3–5 days before):
The video is coming.
"${title}" 🎥
[Release date] — set your reminder.
#${genre.replace(/\s/g, "")} #ComingSoon

Hook highlight caption:
This hook is different. 🔥
"${title}" — full video link in bio.
#${genre.replace(/\s/g, "")} #NewMusic #${mood}

Story / Reel caption:
Started in the studio. Ended on a rooftop.
"${title}" is out now.
→ Link in bio`,
  };
}


/* ─────────────────────────── FORM HELPERS ─────────────────────────── */

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

const textareaClass =
  "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl resize-none";

const selectClass =
  "h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] transition-colors appearance-none cursor-pointer";

function StyledSelect({
  name, placeholder, options, value, onChange,
}: {
  name: string; placeholder: string; options: string[];
  value: string; onChange: (v: string) => void;
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
        <option value="" disabled style={{ background: "#111" }}>{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o} style={{ background: "#111" }}>{o}</option>
        ))}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 rotate-90 pointer-events-none" />
    </div>
  );
}

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function MakeVideo() {
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [loadedVault, setLoadedVault] = useState<ArtistVault | null>(null);
  const [songStructure, setSongStructure] = useState<SongStructure | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [scenes, setScenes] = useState<SceneData[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [savingScenes, setSavingScenes] = useState(false);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<VideoFormValues>({
    defaultValues: {
      artistName: "", songTitle: "", genre: "", mood: "",
      videoStyle: "", platform: "", videoLength: "",
      lyrics: "", artistDescription: "", specialInstructions: "",
    },
  });

  const watched = watch();

  function handleVaultLoad(vault: ArtistVault) {
    if (!watched.artistName) setValue("artistName", vault.artist_name);
    if (!watched.genre && vault.genre) setValue("genre", vault.genre);
    if (!watched.videoStyle && vault.visual_style) setValue("videoStyle", vault.visual_style);
    if (!watched.artistDescription) {
      const parts = [
        vault.artist_description,
        vault.hair ? `Hair: ${vault.hair}` : null,
        vault.tattoos ? `Tattoos: ${vault.tattoos}` : null,
        vault.jewelry ? `Jewelry: ${vault.jewelry}` : null,
        vault.clothing_style ? `Clothing: ${vault.clothing_style}` : null,
        vault.brand_colors ? `Brand colors: ${vault.brand_colors}` : null,
      ].filter(Boolean);
      if (parts.length > 0) setValue("artistDescription", parts.join(". "));
    }
    setLoadedVault(vault);
  }

  async function handleAnalyze() {
    const lyrics = watched.lyrics;
    if (!lyrics || lyrics.length < 10) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/analyze-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ lyrics }),
      });
      if (!res.ok) throw new Error("Analysis failed");
      const data = (await res.json()) as SongStructure;
      setSongStructure(data);
    } catch {
      setAnalyzeError("Analysis failed. You can still generate without it.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function onSubmit(values: VideoFormValues) {
    setLoading(true);
    setRawResult(null);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const { rawResult, creditsRemaining } = await callGenerateApi("/api/generate-video-plan", {
        artistName: values.artistName,
        songTitle: values.songTitle,
        genre: values.genre,
        mood: values.mood,
        videoStyle: values.videoStyle,
        platform: values.platform,
        videoLength: values.videoLength,
        lyrics: values.lyrics,
        artistDescription: values.artistDescription,
        instructions: values.specialInstructions,
        artistVault: loadedVault,
        songStructure: songStructure ?? undefined,
      }, token);
      setRawResult(rawResult);
      setScenes(parseScenes(extractBreakdownContent(rawResult)));
      setSavedProjectId(null);
      if (creditsRemaining !== undefined) refreshProfile();
      setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 80);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed. Please try again.";
      if (msg === "out_of_credits") { setOutOfCredits(true); refreshProfile(); }
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  /* Autosave scene edits to the saved project (mirrors MusicVideoTimeline) */
  async function handleScenesChange(updated: SceneData[]) {
    setScenes(updated);
    if (!savedProjectId) return;
    try {
      const token = await getAccessToken();
      await fetch(`/api/projects/${savedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ scenes: updated }),
      });
    } catch {
      /* silent — user can Save to persist */
    }
  }

  /* Explicit scene save (mirrors MusicVideoTimeline "Save Timeline") */
  async function saveScenes() {
    if (!savedProjectId) {
      toast({ title: "Save your project first", description: "Use Save Project in step 3 to enable saving scene changes.", variant: "destructive" });
      return;
    }
    setSavingScenes(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/projects/${savedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ scenes }),
      });
      if (!res.ok) throw new Error("save failed");
      toast({ title: "Scenes saved", description: "Your scene changes have been persisted." });
    } catch {
      toast({ title: "Save failed", description: "Could not save scene changes. Please try again.", variant: "destructive" });
    } finally {
      setSavingScenes(false);
    }
  }

  /* ── Wizard navigation ── */
  const STEPS = [
    { n: 1, label: "Song Setup",      icon: Music2 },
    { n: 2, label: "Visual Style",    icon: Palette },
    { n: 3, label: "Generate Plan",   icon: Sparkles },
    { n: 4, label: "Scene Clips",     icon: Clapperboard },
    { n: 5, label: "Timeline",        icon: Film },
    { n: 6, label: "Export",          icon: Download },
  ];

  const videoStyleVal = watched.videoStyle || undefined;
  const platformVal = watched.platform || undefined;
  const approvedScenes = scenes.filter((s) => s.approved && s.demoClipUrl);

  function canAdvance(from: number): boolean {
    if (from === 1) return !!watched.artistName?.trim();
    if (from === 2) return !!watched.artistDescription?.trim();
    if (from === 3) return !!rawResult;
    return true;
  }

  function canReach(target: number): boolean {
    if (target <= step) return true;
    for (let s = step; s < target; s++) if (!canAdvance(s)) return false;
    return true;
  }

  function goToStep(target: number) {
    if (target < 1 || target > 6 || !canReach(target)) return;
    setStep(target);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 40);
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Breadcrumb */}
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Dashboard
        </Link>

        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <Video className="h-5 w-5 text-white" />
            </div>
            <Badge className="bg-primary/10 text-primary border-primary/25 text-xs font-bold tracking-wide">
              1 credit
            </Badge>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">
            Make a Music Video
          </h1>
          <p className="text-white/50 text-base md:text-lg max-w-2xl">
            A guided, step-by-step studio — from song setup to a cinematic AI music video.
          </p>
        </div>

        {/* ── Progress stepper ── */}
        <div className="mb-8 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max sm:min-w-0">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isActive = step === s.n;
              const isDone = step > s.n;
              const reachable = canReach(s.n);
              return (
                <div key={s.n} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => goToStep(s.n)}
                    disabled={!reachable}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-colors ${
                      isActive
                        ? "bg-primary/15 border border-primary/40"
                        : isDone
                          ? "bg-white/[0.04] border border-white/10 hover:border-white/20"
                          : "bg-transparent border border-white/[0.06] opacity-60"
                    } ${!reachable ? "cursor-not-allowed" : "cursor-pointer"}`}
                    data-testid={`step-tab-${s.n}`}
                  >
                    <span className={`h-6 w-6 rounded-lg flex items-center justify-center shrink-0 ${
                      isActive ? "bg-primary text-black" : isDone ? "bg-primary/20 text-primary" : "bg-white/5 text-white/40"
                    }`}>
                      {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                    </span>
                    <span className={`text-xs font-bold whitespace-nowrap ${
                      isActive ? "text-primary" : isDone ? "text-white/70" : "text-white/40"
                    } hidden sm:inline`}>
                      {s.n}. {s.label}
                    </span>
                    <span className={`text-xs font-bold sm:hidden ${isActive ? "text-primary" : "text-white/40"}`}>
                      {s.n}
                    </span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <ChevronRight className="h-4 w-4 text-white/15 mx-0.5 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {outOfCredits && <div className="mb-6"><OutOfCredits /></div>}

        {error && (
          <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        {/* ── Step content ── */}
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8">

          {/* STEP 1 — Song Setup */}
          {step === 1 && (
            <div className="space-y-8">
              <div>
                <h2 className="text-xl font-black text-white mb-1">Song Setup</h2>
                <p className="text-sm text-white/40">Tell us about the track and add your lyrics.</p>
              </div>

              <ArtistVaultSelector onLoad={handleVaultLoad} loadedVaultId={loadedVault?.id} />

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
                  <Input {...register("songTitle")} placeholder="e.g. On My Way Up" className={inputClass} />
                </FieldWrapper>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Genre">
                  <StyledSelect name="genre" placeholder="Select genre..." options={GENRES}
                    value={watched.genre} onChange={(v) => setValue("genre", v)} />
                </FieldWrapper>
                <FieldWrapper label="Mood">
                  <StyledSelect name="mood" placeholder="Select mood..." options={MOODS}
                    value={watched.mood} onChange={(v) => setValue("mood", v)} />
                </FieldWrapper>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">Lyrics</Label>
                <AudioTranscribe
                  onTranscript={(text) => { setValue("lyrics", text); setSongStructure(null); }}
                  onFileUrl={setAudioUrl}
                />
                {audioUrl && <ReferenceAudioPlayer url={audioUrl} label="Your Song" />}
                <Textarea
                  {...register("lyrics")}
                  placeholder="Paste your lyrics here — or upload audio above to auto-transcribe them..."
                  className={textareaClass}
                  style={{ minHeight: "160px" }}
                />
                {watched.lyrics.length > 10 && (
                  <div className="flex items-center gap-3 flex-wrap pt-1">
                    <button
                      type="button"
                      onClick={handleAnalyze}
                      disabled={analyzing}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors border border-primary/25 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      {analyzing
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing...</>
                        : <><BarChart2 className="h-4 w-4" /> Analyze Song Sections</>}
                    </button>
                    {songStructure && !analyzing && (
                      <span className="text-xs text-primary/60 flex items-center gap-1.5">
                        <Check className="h-3 w-3" /> Analysis complete
                      </span>
                    )}
                    {analyzeError && <p className="text-xs text-red-400/80">{analyzeError}</p>}
                  </div>
                )}
              </div>

              {songStructure && <SongSectionAnalysis analysis={songStructure} />}
            </div>
          )}

          {/* STEP 2 — Visual Style */}
          {step === 2 && (
            <div className="space-y-8">
              <div>
                <h2 className="text-xl font-black text-white mb-1">Visual Style</h2>
                <p className="text-sm text-white/40">Define the look, platform, and artist's visual brand.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Video Style">
                  <StyledSelect name="videoStyle" placeholder="Select style..." options={VIDEO_STYLES}
                    value={watched.videoStyle} onChange={(v) => setValue("videoStyle", v)} />
                </FieldWrapper>
                <FieldWrapper label="Platform">
                  <StyledSelect name="platform" placeholder="Select platform..." options={PLATFORMS}
                    value={watched.platform} onChange={(v) => setValue("platform", v)} />
                </FieldWrapper>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Video Length">
                  <StyledSelect name="videoLength" placeholder="Select length..." options={LENGTHS}
                    value={watched.videoLength} onChange={(v) => setValue("videoLength", v)} />
                </FieldWrapper>
              </div>

              <FieldWrapper label="Artist Description">
                <Textarea
                  {...register("artistDescription", { required: true })}
                  placeholder="Describe the artist's look, personality, and visual brand. Include style references, typical wardrobe, vibe, and anything important for the video treatment..."
                  className={textareaClass + (errors.artistDescription ? " border-red-500/50" : "")}
                  style={{ minHeight: "120px" }}
                />
                {errors.artistDescription && <p className="text-red-400 text-xs mt-1">Artist description is required</p>}
              </FieldWrapper>

              <FieldWrapper label="Special Instructions">
                <Textarea
                  {...register("specialInstructions")}
                  placeholder="Any specific shots, locations, themes, cultural elements, things to avoid, or references you want included..."
                  className={textareaClass}
                  style={{ minHeight: "100px" }}
                />
              </FieldWrapper>
            </div>
          )}

          {/* STEP 3 — Generate Plan */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-black text-white mb-1">Generate Plan</h2>
                <p className="text-sm text-white/40">Create your Director's Treatment, scene breakdown, and AI prompts.</p>
              </div>

              {!rawResult ? (
                <div className="rounded-2xl border border-primary/15 bg-primary/5 p-6 text-center space-y-4">
                  <p className="text-white/60 text-sm max-w-md mx-auto">
                    We'll use your song setup and visual style to generate a full cinematic plan. This uses 1 credit.
                  </p>
                  <Button
                    type="button"
                    size="lg"
                    onClick={handleSubmit(onSubmit)}
                    disabled={loading}
                    className="gold-glow font-bold text-base px-10 rounded-xl gap-3"
                    style={{ height: "52px" }}
                    data-testid="btn-generate-plan"
                  >
                    {loading
                      ? <><Loader2 className="h-5 w-5 animate-spin" /> Building your video plan...</>
                      : <><Sparkles className="h-5 w-5" /> Generate Music Video Plan</>}
                  </Button>
                  <p className="text-white/25 text-xs">Uses 1 credit per generation</p>
                </div>
              ) : (
                <>
                  <GenerationResult
                    result={rawResult}
                    onReset={() => { setRawResult(null); setError(null); setOutOfCredits(false); setScenes([]); setSavedProjectId(null); }}
                    saveMetadata={{
                      projectType: "Make a Music Video",
                      artistName: watched.artistName,
                      songTitle: watched.songTitle,
                      genre: watched.genre,
                      mood: watched.mood,
                      inputData: watched as unknown as Record<string, unknown>,
                      creditsUsed: 1,
                      songStructure: songStructure ?? undefined,
                    }}
                    scenes={scenes}
                    onScenesChange={setScenes}
                    artistVault={loadedVault}
                    onSaved={setSavedProjectId}
                    showScenes={false}
                    collapsibleSections
                  />

                  {/* Clean scene grid preview */}
                  {scenes.length > 0 && (
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center gap-2">
                        <Clapperboard className="h-4 w-4 text-primary/70" />
                        <h3 className="text-sm font-black text-white uppercase tracking-wider">
                          {scenes.length} Scene{scenes.length !== 1 ? "s" : ""} Ready
                        </h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {scenes.map((s, i) => (
                          <div key={s.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 flex items-start gap-3">
                            <span className="h-6 w-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-[11px] font-black text-primary">
                              {i + 1}
                            </span>
                            <div className="min-w-0">
                              {s.section && <p className="text-[10px] font-bold text-white/40 uppercase tracking-wide">{s.section}</p>}
                              <p className="text-xs text-white/60 line-clamp-2">
                                {s.lyricLine || s.action || s.location || `Scene ${i + 1}`}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-white/30">Next: generate and approve clips for each scene in step 4.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* STEP 4 — Scene Clips */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-black text-white mb-1">Scene Clips</h2>
                <p className="text-sm text-white/40">Refine prompts, generate Runway clips, and approve the ones you want.</p>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
                <Volume2 className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
                <p className="text-xs text-white/55 leading-relaxed">
                  Runway clips are <span className="text-white/80 font-semibold">silent previews</span>. Your uploaded song will be added during final export.
                </p>
              </div>

              {scenes.length > 0 ? (
                <SceneStudio
                  scenes={scenes}
                  onScenesChange={handleScenesChange}
                  artistVault={loadedVault}
                  videoStyle={videoStyleVal}
                  platform={platformVal}
                  manageable
                  onSave={saveScenes}
                  saving={savingScenes}
                />
              ) : (
                <p className="text-sm text-white/40">No scenes yet — go back to step 3 and generate your plan.</p>
              )}
            </div>
          )}

          {/* STEP 5 — Timeline Preview */}
          {step === 5 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-black text-white mb-1">Timeline Preview</h2>
                <p className="text-sm text-white/40">Watch your approved clips back-to-back, with your song playing separately.</p>
              </div>

              <ClipSequencePlayer
                scenes={approvedScenes}
                allScenes={scenes}
                title="Approved Clips Preview"
                emptyTitle="No approved clips yet."
                emptyHint="Approve clips in step 4 — they'll play here in sequence."
              />

              <div className="flex items-start gap-2.5 rounded-xl border border-yellow-500/15 bg-yellow-500/5 px-4 py-3">
                <Volume2 className="h-4 w-4 text-yellow-400/70 shrink-0 mt-0.5" />
                <p className="text-xs text-white/55 leading-relaxed">
                  The clip preview above has <span className="text-white/80 font-semibold">no sound</span> — clips are silent.
                  Play your song below to hear how it pairs. The audio is combined automatically during final export.
                </p>
              </div>

              {audioUrl
                ? <ReferenceAudioPlayer url={audioUrl} label="Your Song" />
                : <p className="text-xs text-white/30">Upload a song in step 1 to preview it here alongside the clips.</p>}
            </div>
          )}

          {/* STEP 6 — Export (Beta) */}
          {step === 6 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black text-white">Export</h2>
                <Badge className="bg-yellow-500/10 text-yellow-300 border-yellow-500/25 text-[10px] font-black tracking-widest uppercase">
                  Beta
                </Badge>
              </div>
              <p className="text-sm text-white/40 -mt-2">
                Stitch your approved clips together with your song into a single video. This feature is in Beta — results may vary.
              </p>

              <FinalVideoExport
                scenes={scenes}
                projectId={savedProjectId}
                audioUrl={audioUrl}
              />

              {/* Premium Video Editor entry */}
              <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <Clapperboard className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-black text-white">Open Video Editor</h3>
                  <p className="text-xs text-white/45 mt-0.5">
                    AI Auto Edit presets or the Manual Pro editor — captions, transitions, effects and more.
                  </p>
                </div>
                {savedProjectId ? (
                  <Link href={`/video-editor?project=${savedProjectId}`}>
                    <Button className="gold-glow font-bold gap-2 shrink-0" data-testid="btn-open-video-editor">
                      <Sparkles className="h-4 w-4" /> Open Editor
                    </Button>
                  </Link>
                ) : (
                  <div className="text-right shrink-0">
                    <Button disabled className="font-bold gap-2 opacity-50" data-testid="btn-open-video-editor-disabled">
                      <Sparkles className="h-4 w-4" /> Open Editor
                    </Button>
                    <p className="text-[11px] text-white/35 mt-1.5">Save your project first to edit it</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Footer nav ── */}
          <div className="flex items-center justify-between gap-4 mt-10 pt-6 border-t border-white/[0.06]">
            <Button
              type="button"
              variant="outline"
              onClick={() => goToStep(step - 1)}
              disabled={step === 1}
              className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white gap-2 disabled:opacity-30"
              data-testid="btn-wizard-back"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>

            {step < 6 && (
              <Button
                type="button"
                onClick={() => goToStep(step + 1)}
                disabled={!canAdvance(step)}
                className="gold-glow font-bold gap-2 disabled:opacity-40"
                data-testid="btn-wizard-next"
              >
                {step === 3 && !rawResult ? "Generate plan to continue" : "Next"}
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
