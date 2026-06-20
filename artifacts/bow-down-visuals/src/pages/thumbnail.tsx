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
import { Loader2, Image as ImageIcon } from "lucide-react";

const formSchema = z.object({
  artistName: z.string().min(1, "Artist name is required"),
  songTitle: z.string().min(1, "Title is required"),
  platform: z.string().min(1, "Platform is required"),
  artStyle: z.string().min(1, "Art style is required"),
  colorTheme: z.string().min(1, "Color theme is required"),
  mood: z.string().min(1, "Mood is required"),
  featuredText: z.string().optional(),
  requests: z.string().optional(),
});

export default function Thumbnail() {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      artistName: "",
      songTitle: "",
      platform: "",
      artStyle: "",
      colorTheme: "",
      mood: "",
      featuredText: "",
      requests: "",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      toast({
        title: "Success!",
        description: "Your thumbnail ideas have been generated!",
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
            <ImageIcon className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-3xl font-black text-white">Thumbnail Maker</h1>
        </div>
        <p className="text-muted-foreground text-lg">Generate compelling thumbnail ideas and cover art concepts.</p>
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
                  <FormLabel>Song/Video Title</FormLabel>
                  <FormControl><Input placeholder="e.g. Midnight Run" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField control={form.control} name="platform" render={({ field }) => (
                <FormItem>
                  <FormLabel>Platform</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select platform" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {["YouTube", "Spotify", "Apple Music", "SoundCloud", "All"].map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="artStyle" render={({ field }) => (
                <FormItem>
                  <FormLabel>Art Style</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select style" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {["Photo-realistic", "Illustrated", "Minimalist", "Bold Graphic", "Vintage", "Futuristic"].map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField control={form.control} name="colorTheme" render={({ field }) => (
                <FormItem>
                  <FormLabel>Color Theme</FormLabel>
                  <FormControl><Input placeholder="e.g. Black and gold" {...field} /></FormControl>
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

            <FormField control={form.control} name="featuredText" render={({ field }) => (
              <FormItem>
                <FormLabel>Featured Text</FormLabel>
                <FormControl><Input placeholder="e.g. OUT NOW" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="requests" render={({ field }) => (
              <FormItem>
                <FormLabel>Special Requests (Optional)</FormLabel>
                <FormControl>
                  <Textarea placeholder="Any specific elements to include?" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <Button type="submit" size="lg" className="w-full text-lg h-14 purple-glow" disabled={isGenerating}>
              {isGenerating ? (
                <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Generating...</>
              ) : "Generate Thumbnail Ideas"}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
