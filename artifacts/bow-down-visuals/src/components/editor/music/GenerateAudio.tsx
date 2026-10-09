import { useState } from "react";
import { Sparkles, Loader2, Music, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { EditorCard, Field, Segmented, TextInput } from "@/components/editor/controls";
import { OutOfCredits } from "@/components/OutOfCredits";
import { generateMusicAudio } from "@/lib/generate-music-audio";
import { PublishToShowcase } from "@/components/PublishToShowcase";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { defaultStemEffects, type EditorSettings, type AudioStem } from "@/lib/editor-settings";

interface GenerateAudioProps {
  settings: EditorSettings;
  onChange: (next: EditorSettings) => void;
  artistName?: string;
  songTitle?: string;
  /** Active artist vault id — server swaps vocals to its locked voice if set. */
  artistVaultId?: string;
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

/* One-tap style starters — Suno-style prompt helpers. */
const STYLE_PRESETS = [
  "Dark trap, 140 BPM, heavy 808s",
  "Lo-fi hip hop, chill, vinyl crackle",
  "Epic orchestral, cinematic build",
  "Afrobeats, danceable, log drums",
  "Pop anthem, uplifting, big chorus",
  "R&B slow jam, silky, late night",
];

export function GenerateAudio({ settings, onChange, artistName, songTitle, artistVaultId }: GenerateAudioProps) {
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
  const [variantCount, setVariantCount] = useState("1");
  const [generating, setGenerating] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<AudioStem | null>(null);
  const [lastVariants, setLastVariants] = useState<Array<{ url: string; label: string }>>([]);
  const [showExtend, setShowExtend] = useState(false);
  const [extendPrompt, setExtendPrompt] = useState("");
  const [extendSeconds, setExtendSeconds] = useState("30");
  const [extending, setExtending] = useState(false);

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
      setLastVariants(variants.map((v) => ({ url: v.url, label: v.label })));

      const stem: AudioStem = {
        id: `stem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: songTitle ? `${songTitle} (AI Generated)` : "AI Generated Audio",
        type: "Full Song Mix",
        url: variants[0].url,
        storagePath: variants[0].storagePath,
        fileType: "audio/mpeg",
        fileSize: 0,
        uploadedAt: new Date().toISOString(),
        durationSec: resp.durationMs / 1000,
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

      /* Prepend so it becomes the fallback audio source (ms.stems[0]) used by the timeline. */
      onChange({ ...settings, musicStudio: { ...ms, stems: [stem, ...ms.stems] } });
      setLastGenerated(stem);
      refreshProfile();
      toast({ title: "Audio generated!", description: "Added to your stems — it'll play in Timeline Preview." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not generate audio.";
      if (msg === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
      } else {
        setError(msg);
      }
    } finally {
      setGenerating(false);
    }
  }

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
      setShowExtend(false);
      setExtendPrompt("");
      refreshProfile();
      toast({ title: "Song extended!", description: "The new section was crossfaded onto your track." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not extend audio.";
      if (msg === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
      } else {
        setError(msg);
      }
    } finally {
      setExtending(false);
    }
  }

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
          <Field label="Takes" hint="2 takes costs 2× credits">
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

        {/* Custom lyrics (Suno-style custom mode) */}
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
          <div className="space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <p className="text-xs font-black text-emerald-300">{lastGenerated.name}</p>
            </div>
            {lastVariants.length > 1 ? (
              <div className="space-y-2">
                {lastVariants.map((v) => (
                  <div key={v.label} className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[11px] font-black text-primary">
                      {v.label}
                    </span>
                    <audio controls src={v.url} className="w-full" />
                  </div>
                ))}
                <p className="text-[11px] text-white/40">Pick your favorite — take A was added to your stems.</p>
              </div>
            ) : (
              <audio controls src={lastGenerated.url} className="w-full" data-testid="audio-generate-real-preview" />
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
            {/* Extend (Suno-style) */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowExtend(!showExtend)}
                className="text-xs font-bold text-primary hover:underline"
              >
                {showExtend ? "− Hide extend" : "+ Extend this song"}
              </button>
              {showExtend && (
                <div className="mt-2 space-y-3">
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
                    Generates a continuation and crossfades it onto your track. Charged for the new section only.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
