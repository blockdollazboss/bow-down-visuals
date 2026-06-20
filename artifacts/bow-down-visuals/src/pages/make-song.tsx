import { useState } from "react";
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
import { Loader2, Music } from "lucide-react";

const formSchema = z.object({
  artistName: z.string().min(1, "Artist name is required"),
  songTitle: z.string().min(1, "Song title is required"),
  genre: z.string().min(1, "Genre is required"),
  mood: z.string().min(1, "Mood is required"),
  songTopic: z.string().min(10, "Please describe the song topic"),
  explicit: z.enum(["clean", "explicit"]),
  voiceStyle: z.string().min(1, "Voice style is required"),
  beatStyle: z.string().min(1, "Beat style is required"),
  songLength: z.string().min(1, "Song length is required"),
  instructions: z.string().optional(),
});

export default function MakeSong() {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      artistName: "",
      songTitle: "",
      genre: "",
      mood: "",
      songTopic: "",
      explicit: "explicit",
      voiceStyle: "",
      beatStyle: "",
      songLength: "",
      instructions: "",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      toast({
        title: "Success!",
        description: "Your song content has been generated.",
        variant: "default",
      });
      form.reset();
    }, 2500);
  }

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Music className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-3xl font-black text-white">Make a Song</h1>
        </div>
        <p className="text-muted-foreground text-lg">Generate lyrics, hooks, and structure based on your vision.</p>
      </div>

      <div className="bg-card border border-card-border p-6 md:p-8 rounded-2xl shadow-xl">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField control={form.control} name="artistName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Artist Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Lil Metro" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="songTitle" render={({ field }) => (
                <FormItem>
                  <FormLabel>Song Title</FormLabel>
                  <FormControl><Input placeholder="e.g. Midnight Run" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField control={form.control} name="genre" render={({ field }) => (
                <FormItem>
                  <FormLabel>Genre</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select genre" /></SelectTrigger></FormControl>
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
                    <FormControl><SelectTrigger><SelectValue placeholder="Select mood" /></SelectTrigger></FormControl>
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

            <FormField control={form.control} name="songTopic" render={({ field }) => (
              <FormItem>
                <FormLabel>Song Topic</FormLabel>
                <FormControl>
                  <Textarea placeholder="What is this song about? Describe the story, message, or vibe..." className="h-24" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

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
                <FormControl><Input placeholder="e.g. Trap 808s with melodic piano" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="instructions" render={({ field }) => (
              <FormItem>
                <FormLabel>Special Instructions (Optional)</FormLabel>
                <FormControl>
                  <Textarea placeholder="Any specific words to include? Rhyme schemes? Flow patterns?" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <Button type="submit" size="lg" className="w-full text-lg h-14 purple-glow" disabled={isGenerating}>
              {isGenerating ? (
                <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Generating...</>
              ) : "Generate Song"}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
