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
import { Loader2, Film } from "lucide-react";

const formSchema = z.object({
  artistName: z.string().min(1, "Artist name is required"),
  songTitle: z.string().min(1, "Song title is required"),
  releaseDate: z.string().min(1, "Release date is required"),
  platform: z.string().min(1, "Platform is required"),
  vibe: z.string().min(1, "Vibe/Energy is required"),
  keyMessage: z.string().min(10, "Please provide a key message"),
  notes: z.string().optional(),
});

export default function PromoClip() {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      artistName: "",
      songTitle: "",
      releaseDate: "",
      platform: "",
      vibe: "",
      keyMessage: "",
      notes: "",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      toast({
        title: "Success!",
        description: "Your promo content has been generated!",
        variant: "default",
      });
      form.reset();
    }, 2000);
  }

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Film className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-3xl font-black text-white">Promo Clip Maker</h1>
        </div>
        <p className="text-muted-foreground text-lg">Plan your social media rollout with teaser concepts and captions.</p>
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
              <FormField control={form.control} name="releaseDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Release Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="platform" render={({ field }) => (
                <FormItem>
                  <FormLabel>Platform</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select platform" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {["Instagram", "TikTok", "YouTube Shorts", "All"].map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="vibe" render={({ field }) => (
              <FormItem>
                <FormLabel>Vibe/Energy</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select vibe" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {["Hype Drop", "Countdown", "Teaser", "Behind the Scenes"].map(v => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="keyMessage" render={({ field }) => (
              <FormItem>
                <FormLabel>Key Message</FormLabel>
                <FormControl>
                  <Textarea placeholder="What do you want fans to know? e.g. Pre-save link in bio, Dropping Friday..." className="h-24" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Any Visuals or Notes (Optional)</FormLabel>
                <FormControl>
                  <Textarea placeholder="Any specific imagery or ideas you have in mind?" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <Button type="submit" size="lg" className="w-full text-lg h-14 purple-glow" disabled={isGenerating}>
              {isGenerating ? (
                <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Generating...</>
              ) : "Generate Promo Content"}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
