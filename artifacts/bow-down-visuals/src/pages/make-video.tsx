import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Video, ArrowLeft, Loader2, ChevronRight } from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { callGenerateApi } from "@/lib/generate-api";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { GenerationResult } from "@/components/GenerationResult";

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
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<VideoFormValues>({
    defaultValues: {
      artistName: "", songTitle: "", genre: "", mood: "",
      videoStyle: "", platform: "", videoLength: "",
      lyrics: "", artistDescription: "", specialInstructions: "",
    },
  });

  const watched = watch();

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
      }, token);
      setRawResult(rawResult);
      if (creditsRemaining !== undefined) refreshProfile();
      setTimeout(() => {
        document.getElementById("video-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed. Please try again.";
      if (msg === "out_of_credits") { setOutOfCredits(true); refreshProfile(); }
      else setError(msg);
    } finally {
      setLoading(false);
    }
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
        <div className="mb-10">
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
          <p className="text-white/50 text-lg max-w-2xl">
            Turn your lyrics into a cinematic music video treatment, scene list, AI video prompts, thumbnails, captions, and promo ideas.
          </p>
        </div>

        {/* Form */}
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
                <StyledSelect name="genre" placeholder="Select genre..." options={GENRES}
                  value={watched.genre} onChange={(v) => setValue("genre", v)} />
              </FieldWrapper>
              <FieldWrapper label="Mood">
                <StyledSelect name="mood" placeholder="Select mood..." options={MOODS}
                  value={watched.mood} onChange={(v) => setValue("mood", v)} />
              </FieldWrapper>
            </div>

            {/* Row 3: Video Style + Platform */}
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

            {/* Row 4: Video Length */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Video Length">
                <StyledSelect name="videoLength" placeholder="Select length..." options={LENGTHS}
                  value={watched.videoLength} onChange={(v) => setValue("videoLength", v)} />
              </FieldWrapper>
            </div>

            {/* Lyrics */}
            <FieldWrapper label="Lyrics">
              <Textarea
                {...register("lyrics")}
                placeholder="Paste your lyrics here — verses, hook, bridge, outro..."
                className={textareaClass}
                style={{ minHeight: "160px" }}
              />
            </FieldWrapper>

            {/* Artist Description */}
            <FieldWrapper label="Artist Description">
              <Textarea
                {...register("artistDescription", { required: true })}
                placeholder="Describe the artist's look, personality, and visual brand. Include style references, typical wardrobe, vibe, and anything important for the video treatment..."
                className={textareaClass + (errors.artistDescription ? " border-red-500/50" : "")}
                style={{ minHeight: "120px" }}
              />
              {errors.artistDescription && <p className="text-red-400 text-xs mt-1">Artist description is required</p>}
            </FieldWrapper>

            {/* Special Instructions */}
            <FieldWrapper label="Special Instructions">
              <Textarea
                {...register("specialInstructions")}
                placeholder="Any specific shots, locations, themes, cultural elements, things to avoid, or references you want included..."
                className={textareaClass}
                style={{ minHeight: "100px" }}
              />
            </FieldWrapper>

            {/* Submit */}
            <div className="pt-2">
              <Button
                type="submit"
                size="lg"
                disabled={loading}
                className="w-full sm:w-auto gold-glow font-bold text-base px-12 rounded-xl gap-3"
                style={{ height: "52px" }}
              >
                {loading ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Building your video plan...</>
                ) : (
                  <><Video className="h-5 w-5" /> Generate Music Video Plan</>
                )}
              </Button>
              <p className="text-white/25 text-xs mt-3">Uses 1 credit per generation</p>
            </div>
          </form>
        </div>

        {outOfCredits && <OutOfCredits />}

        {error && (
          <div className="mt-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        {rawResult && (
          <div id="video-result">
            <GenerationResult
              result={rawResult}
              onReset={() => { setRawResult(null); setError(null); setOutOfCredits(false); }}
              saveMetadata={{
                projectType: "Make a Music Video",
                artistName: watched.artistName,
                songTitle: watched.songTitle,
                genre: watched.genre,
                mood: watched.mood,
                inputData: watched as unknown as Record<string, unknown>,
                creditsUsed: 1,
              }}
            />
          </div>
        )}

      </div>
    </div>
  );
}
