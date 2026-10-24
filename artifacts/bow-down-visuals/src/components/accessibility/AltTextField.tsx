import { useState } from "react";
import { Accessibility, Loader2, Sparkles, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiJson } from "@/lib/social-api";

/* ─── AltTextField (#29) ────────────────────────────────────────────────────
   The one accessibility-description field every image-bearing publish
   door shares: post composer, video/short cover, shop + storefront
   product shots. Docks INSIDE those flows — never a standalone page.

   - One tap on "Describe with AI" asks POST /api/generate/alt-text
     (free) for a suggestion. The suggestion lands in the SAME editable
     textarea — it is never locked in and never sent anywhere until the
     creator publishes with it in the field.
   - The creator can always type their own, edit the suggestion, or
     clear it entirely. If generation fails or is unavailable, the
     field keeps working by hand — publishing is never blocked.
   - Guidance baked into the helper line: describe the scene, never
     name a person (the server prompt enforces the same rule). */

export const ALT_TEXT_MAX_CHARS = 400;

export function AltTextField({
  imageUrl,
  value,
  onChange,
  label = "Describe this image for fans using screen readers",
  context,
  compact = false,
}: {
  /** The image to describe. Null/empty disables AI generation only —
   *  hand-writing always works. */
  imageUrl?: string | null;
  value: string;
  onChange: (next: string) => void;
  label?: string;
  /** Optional hint for the AI (e.g. the product or video title). */
  context?: string;
  compact?: boolean;
}) {
  const { getAccessToken } = useAuth();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!imageUrl || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const data = await apiJson<{ altText: string }>(getAccessToken, "/api/generate/alt-text", {
        method: "POST",
        body: JSON.stringify({ imageUrl, context: context?.trim() || undefined }),
      });
      if (data.altText) onChange(data.altText.slice(0, ALT_TEXT_MAX_CHARS));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't generate a description — you can still write your own.",
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className={compact ? "mt-2" : "mt-3"}>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
          <Accessibility className="h-3.5 w-3.5 text-[#d4af37]" />
          {label}
        </label>
        <span className={`text-[11px] ${value.length >= ALT_TEXT_MAX_CHARS ? "text-red-400" : "text-white/30"}`}>
          {value.length}/{ALT_TEXT_MAX_CHARS}
        </span>
      </div>
      <div className="relative mt-1.5">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, ALT_TEXT_MAX_CHARS))}
          rows={compact ? 2 : 3}
          maxLength={ALT_TEXT_MAX_CHARS}
          placeholder="e.g. A performer in a gold jacket on a dark stage, red lights, crowd silhouettes below."
          aria-label={label}
          className="w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 pr-9 text-sm text-white placeholder:text-white/25 focus:border-[#d4af37]/60 focus:outline-none"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear description"
            className="absolute right-2 top-2 text-white/40 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={!imageUrl || generating}
          title={imageUrl ? "Suggest a description with AI (free)" : "Add the image first, then AI can describe it"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#d4af37]/40 px-3 py-1.5 text-xs font-bold text-[#d4af37] hover:bg-[#d4af37]/10 disabled:opacity-40"
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {generating ? "Describing…" : "Describe with AI — free"}
        </button>
        <span className="text-[11px] text-white/35">
          For fans using screen readers. Describe the scene — never name a person. You can edit or clear it.
        </span>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
