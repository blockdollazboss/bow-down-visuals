import { useState } from "react";
import { Scissors, Wand2, Loader2 } from "lucide-react";
import { EditorCard } from "@/components/editor/controls";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

/**
 * AI-assisted video background removal.
 * Samples the first frame to detect the background color, then applies
 * chroma-key across the whole video. Outputs ProRes 4444 with alpha
 * for use as an overlay. 500 Visual Bucs.
 */

interface Props {
  videoUrl: string | null;
  onResult: (url: string) => void;
}

export function VideoBackgroundRemoval({ videoUrl, onResult }: Props) {
  const { toast } = useToast();
  const { getAccessToken } = useAuth();
  const [removing, setRemoving] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  async function handleRemove() {
    if (!videoUrl) {
      toast({ title: "No video", description: "Add a video first.", variant: "destructive" });
      return;
    }
    setRemoving(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/remove-video-background", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ videoUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Background removal failed.");
      setResultUrl(data.url);
      onResult(data.url);
      toast({ title: "Background removed!", description: "Your transparent video is ready." });
    } catch (err) {
      toast({
        title: "Removal failed",
        description: err instanceof Error ? err.message : "Could not remove background.",
        variant: "destructive",
      });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <EditorCard
      title="AI Video Background Removal"
      subtitle="One-click subject isolation for video"
      icon={<Scissors className="h-4 w-4" />}
    >
      <div className="space-y-3">
        <p className="text-[11px] text-white/50">
          Automatically detects the background color from the first frame and removes it
          across the whole video. Outputs with transparency (ProRes 4444).
          Works best with solid-color backgrounds. 500 Visual Bucs.
        </p>
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing || !videoUrl}
          className="w-full h-10 text-sm font-black bg-primary text-black hover:bg-primary/90 disabled:opacity-50 rounded flex items-center justify-center gap-2"
        >
          {removing ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Removing… (this takes a while)</>
          ) : (
            <><Wand2 className="h-4 w-4" /> Remove video background</>
          )}
        </button>
        {resultUrl && (
          <div className="rounded border border-white/10 overflow-hidden">
            <video src={resultUrl} controls className="w-full" />
            <p className="text-[10px] text-white/40 p-2 bg-black/40">
              Transparent background — use as an overlay
            </p>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
