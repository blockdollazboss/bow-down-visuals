import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Share2, Loader2, Check } from "lucide-react";

/* ─── Publish to showcase (opt-in) ───
   Drop this next to any user creation (thumbnail, clip, song) to let the
   creator publish it to the public showcase. Free — no credits. */

interface PublishToShowcaseProps {
  mediaType: "image" | "video" | "song";
  mediaUrl: string;
  thumbnailUrl?: string | null;
  defaultTitle?: string;
}

export function PublishToShowcase({ mediaType, mediaUrl, thumbnailUrl, defaultTitle }: PublishToShowcaseProps) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [description, setDescription] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);

  async function handlePublish() {
    if (!title.trim()) {
      toast({ title: "Add a title", description: "Give your creation a title first.", variant: "destructive" });
      return;
    }
    setPublishing(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/showcase/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          mediaType,
          mediaUrl,
          thumbnailUrl: thumbnailUrl ?? null,
          creatorName: creatorName.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not publish.");
      setPublishedSlug(data.item.slug);
      toast({ title: "Published!", description: "Your creation is live on the showcase." });
    } catch (err) {
      toast({
        title: "Publish failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPublishing(false);
    }
  }

  if (publishedSlug) {
    return (
      <a
        href={`/showcase/${publishedSlug}`}
        className="inline-flex items-center gap-2 text-xs font-bold text-emerald-400 hover:underline"
      >
        <Check className="h-3.5 w-3.5" /> View on showcase
      </a>
    );
  }

  return (
    <div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(!open)}
        className="gap-2 border-white/15 text-white/60 hover:border-[#e8c86a]/50 hover:text-white text-xs h-8"
      >
        <Share2 className="h-3.5 w-3.5" /> Publish to showcase
      </Button>
      {open && (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/60 p-4 space-y-3">
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Name your creation"
              maxLength={120}
              className="mt-1 w-full rounded-lg bg-white/[0.05] border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[#e8c86a]/50 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Description <span className="text-white/25 normal-case">(optional)</span></label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell the story behind it"
              maxLength={500}
              rows={2}
              className="mt-1 w-full rounded-lg bg-white/[0.05] border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[#e8c86a]/50 focus:outline-none resize-none"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Creator name <span className="text-white/25 normal-case">(optional)</span></label>
            <input
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value)}
              placeholder="How should you be credited?"
              maxLength={60}
              className="mt-1 w-full rounded-lg bg-white/[0.05] border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[#e8c86a]/50 focus:outline-none"
            />
          </div>
          <Button
            size="sm"
            onClick={handlePublish}
            disabled={publishing}
            className="w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 text-xs h-9"
          >
            {publishing ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Publishing…</> : "Publish (free)"}
          </Button>
          <p className="text-[11px] text-white/30 text-center">
            Publishing is opt-in and free. Your page will be public and shareable.
          </p>
        </div>
      )}
    </div>
  );
}
