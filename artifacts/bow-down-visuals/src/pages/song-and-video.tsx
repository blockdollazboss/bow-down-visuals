import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Loader2, Mic2 } from "lucide-react";
import { GenerationResult, type SaveMetadata } from "@/components/GenerationResult";
import { OutOfCredits } from "@/components/OutOfCredits";
import { CREDIT_COSTS } from "@/constants/credits";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";

const CREDIT_COST = CREDIT_COSTS["song-video"];

const formSchema = z.object({
  artistName: z.string().min(1, "Artist name is required"),
  songTitle: z.string().min(1, "Song title is required"),
  genre: z.string().min(1, "Genre is required"),
  mood: z.string().min(1, "Mood is required"),
  explicit: z.enum(["clean", "explicit"]),
  songTopic: z.string().min(10, "Please describe the song topic"),
  voiceStyle: z.string().min(1, "Voice style is required"),
  beatStyle: z.string().min(1, "Beat style is required"),
  songLength: z.string().min(1, "Song length is required"),
  videoStyle: z.string().min(1, "Video style is required"),
  platform: z.string().min(1, "Platform is required"),
  videoLength: z.string().min(1, "Video length is required"),
  artistDescription: z.string().min(10, "Please describe the artist"),
  instructions: z.string().optional(),
});

const STEPS = [
  "Generating lyrics...",
  "Creating video treatment...",
  "Building promo pack...",
  "Finalizing assets...",
];

export default function SongAndVideo() {
  const { toast } = useToast();
  const { profile, refreshProfile } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [lastValues, setLastValues] = useState<Record<string, unknown>>({});

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      artistName: "",
      songTitle: "",
      genre: "",
      mood: "",
      explicit: "explicit",
      songTopic: "",
      voiceStyle: "",
      beatStyle: "",
      songLength: "",
      videoStyle: "",
      platform: "",
      videoLength: "",
      artistDescription: "",
      instructions: "",
    },
  });

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isGenerating) {
      interval = setInterval(() => {
        setLoadingStep((prev) => Math.min(prev + 1, STEPS.length - 1));
      }, 2000);
    } else {
      setLoadingStep(0);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!profile || profile.credits < CREDIT_COST) {
      toast({ title: "Not enough credits", description: "Upgrade your plan to keep creating.", variant: "destructive" });
      return;
    }
    setLastValues(values as Record<string, unknown>);
    setIsGenerating(true);
    setResult(null);
    try {
      const res = await fetch("/api/generate-song-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      try {
        const sb = getSupabase();
        await sb.rpc("deduct_credits", { credits_to_deduct: CREDIT_COST });
        await refreshProfile();
      } catch { /* deduction failed silently */ }
      setResult(data.result);
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Mic2 className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-3xl font-black text-white">Make Song + Video</h1>
        </div>
        <p className="text-muted-foreground text-lg">Generate lyrics, music prompt, video treatment, and promo content in one go.</p>
      </div>

      {result ? (
        <GenerationResult
          result={result}
          onReset={() => setResult(null)}
          saveMetadata={{
            projectType: "song-video",
            artistName: String(lastValues.artistName ?? ""),
            songTitle: String(lastValues.songTitle ?? ""),
            genre: String(lastValues.genre ?? ""),
            mood: String(lastValues.mood ?? ""),
            inputData: lastValues,
          }}
        />
      ) : profile && profile.credits < CREDIT_COST ? (
        <OutOfCredits />
      ) : (
        <div className="bg-card border border-card-border p-6 md:p-8 rounded-2xl shadow-xl">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-12">

              {/* Section 1: Artist Info */}
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-white mb-1">Artist Info</h2>
                  <p className="text-sm text-muted-foreground">The basics for your project.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField control={form.control} name="artistName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Artist Name</FormLabel>
                      <FormControl><Input data-testid="input-artist-name" placeholder="e.g. Lil Metro" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="songTitle" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Song Title</FormLabel>
                      <FormControl><Input data-testid="input-song-title" placeholder="e.g. Midnight Run" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField control={form.control} name="genre" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Genre</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger data-testid="select-genre"><SelectValue placeholder="Select genre" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {["Hip-Hop", "R&B", "Pop", "Trap", "Drill", "Afrobeats", "Gospel", "Other"].map(g => (
                            <SelectItem key={g} value={g}>{g}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="mood" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mood</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger data-testid="select-mood"><SelectValue placeholder="Select mood" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {["Hype", "Chill", "Romantic", "Aggressive", "Inspirational", "Dark", "Playful"].map(m => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="explicit" render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Content Rating</FormLabel>
                    <FormControl>
                      <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-4">
                        <FormItem className="flex items-center space-x-2 space-y-0 bg-secondary px-4 py-3 rounded-lg flex-1 cursor-pointer">
                          <FormControl><RadioGroupItem value="clean" /></FormControl>
                          <FormLabel className="font-normal cursor-pointer w-full">Clean</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-2 space-y-0 bg-secondary px-4 py-3 rounded-lg flex-1 cursor-pointer">
                          <FormControl><RadioGroupItem value="explicit" /></FormControl>
                          <FormLabel className="font-normal cursor-pointer w-full">Explicit</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <Separator className="bg-border" />

              {/* Section 2: Song Details */}
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-white mb-1">Song Details</h2>
                  <p className="text-sm text-muted-foreground">Shape the sound and lyrics.</p>
                </div>
                <FormField control={form.control} name="songTopic" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Song Topic</FormLabel>
                    <FormControl>
                      <Textarea data-testid="textarea-song-topic" placeholder="What is this song about?" className="h-20" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField control={form.control} name="voiceStyle" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Voice Style</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select style" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {["Male Rapper", "Female Rapper", "Male Singer", "Female Singer", "Hook Singer"].map(v => (
                            <SelectItem key={v} value={v}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="songLength" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Song Length</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select length" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {["Short Hook Only", "1 Verse + Hook", "2 Verses + Hook", "Full Song"].map(l => (
                            <SelectItem key={l} value={l}>{l}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="beatStyle" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Beat Style</FormLabel>
                    <FormControl><Input data-testid="input-beat-style" placeholder="e.g. Trap 808s with melodic piano" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <Separator className="bg-border" />

              {/* Section 3: Video Details */}
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-white mb-1">Video Details</h2>
                  <p className="text-sm text-muted-foreground">Visualize the concept.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField control={form.control} name="videoStyle" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Video Style</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select style" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {["Cinematic", "Performance", "Narrative", "Animated", "Lyric Video", "Documentary", "Mixed"].map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="platform" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Platform</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select platform" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {["YouTube", "Instagram Reels", "TikTok", "All Platforms"].map(p => (
                            <SelectItem key={p} value={p}>{p}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="videoLength" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Video Length</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select length" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {["30 seconds", "1 minute", "3 minutes", "Full Music Video"].map(l => (
                          <SelectItem key={l} value={l}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="artistDescription" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Artist Description</FormLabel>
                    <FormControl>
                      <Textarea data-testid="textarea-artist-description" placeholder="Describe yourself, your look, vibe, and typical visual style..." className="h-24" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="instructions" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Special Instructions (Optional)</FormLabel>
                    <FormControl>
                      <Textarea data-testid="textarea-instructions" placeholder="Any specific requirements for song or video?" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <Button data-testid="btn-generate-everything" type="submit" size="lg" className="w-full text-lg h-16 purple-glow" disabled={isGenerating}>
                {isGenerating ? (
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex items-center">
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      <span>Working...</span>
                    </div>
                    <span className="text-xs text-white/80 font-normal">{STEPS[loadingStep]}</span>
                  </div>
                ) : "Generate Everything"}
              </Button>
            </form>
          </Form>
        </div>
      )}
    </div>
  );
}
