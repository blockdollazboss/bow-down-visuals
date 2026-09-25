import { useState } from "react";
import { Sparkles, Loader2, Music, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { EditorCard, Field, Segmented, TextInput } from "@/components/editor/controls";
import { OutOfCredits } from "@/components/OutOfCredits";
import { generateMusicAudio } from "@/lib/generate-music-audio";
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

export function GenerateAudio({ settings, onChange, artistName, songTitle, artistVaultId }: GenerateAudioProps) {
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  const ms = settings.musicStudio;

  const [prompt, setPrompt] = useState("");
  const [lengthSeconds, setLengthSeconds] = useState("60");
  const [generating, setGenerating] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<AudioStem | null>(null);

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
      const resp = await generateMusicAudio(token, {
        prompt: prompt.trim(),
        lengthSeconds: Number(lengthSeconds),
        artistName,
        songTitle,
        artistVaultId,
      });

      const stem: AudioStem = {
        id: `stem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: songTitle ? `${songTitle} (AI Generated)` : "AI Generated Audio",
        type: "Full Song Mix",
        url: resp.url,
        storagePath: resp.storagePath,
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
        <Field label="Length">
          <Segmented value={lengthSeconds} options={LENGTH_OPTIONS} onChange={setLengthSeconds} />
        </Field>

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
            <audio controls src={lastGenerated.url} className="w-full" data-testid="audio-generate-real-preview" />
          </div>
        )}
      </div>
    </EditorCard>
  );
}
