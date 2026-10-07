import { useState } from "react";
import { Scissors, Wand2, Loader2 } from "lucide-react";
import { EditorCard } from "@/components/editor/controls";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

/**
 * AI-assisted background removal.
 * Uses smart color analysis to detect the background, then applies
 * optimized chroma-key removal. For solid-color backgrounds (green screen,
 * studio backdrops) this gives clean results without manual tuning.
 */

interface Props {
  imageUrl: string | null;
  onResult: (url: string) => void;
}

export function BackgroundRemoval({ imageUrl, onResult }: Props) {
  const { toast } = useToast();
  const { getAccessToken } = useAuth();
  const [removing, setRemoving] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  async function handleRemove() {
    if (!imageUrl) {
      toast({ title: "No image", description: "Add an image first.", variant: "destructive" });
      return;
    }
    setRemoving(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/remove-background", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ imageUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Background removal failed.");
      setResultUrl(data.url);
      onResult(data.url);
      toast({ title: "Background removed!", description: "Your cutout is ready." });
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
      title="AI Background Removal"
      subtitle="One-click subject isolation"
      icon={<Scissors className="h-4 w-4" />}
    >
      <div className="space-y-3">
        <p className="text-[11px] text-white/50">
          Automatically detects the background color and removes it.
          Works best with solid-color backgrounds.
        </p>
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing || !imageUrl}
          className="w-full h-10 text-sm font-black bg-primary text-black hover:bg-primary/90 disabled:opacity-50 rounded flex items-center justify-center gap-2"
        >
          {removing ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Removing…</>
          ) : (
            <><Wand2 className="h-4 w-4" /> Remove background</>
          )}
        </button>
        {resultUrl && (
          <div className="rounded border border-white/10 overflow-hidden">
            <img src={resultUrl} alt="Background removed" className="w-full" />
            <p className="text-[10px] text-white/40 p-2 bg-black/40">
              Checkered areas are transparent
            </p>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
