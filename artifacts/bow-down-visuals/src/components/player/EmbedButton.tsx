import { useRef, useState } from "react";
import { Code2, Check } from "lucide-react";
import { copyText } from "@/lib/streaming";

/* ─── EmbedButton — one-click copy of the <iframe> billboard (virality) ─────
   Drops on track / video / artist / playlist pages. The iframe points at the
   tiny standalone /embed/* pages (no login, no app chrome) and carries the
   creator's ?ref= code so every view can become a referred signup. */

type EmbedKind = "track" | "video" | "playlist" | "profile";

const DIMS: Record<EmbedKind, { w: number; h: number }> = {
  track: { w: 420, h: 200 },
  video: { w: 560, h: 360 },
  playlist: { w: 420, h: 430 },
  profile: { w: 360, h: 480 },
};

async function fetchRefCode(slug: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/embed/refcode/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { code?: string | null };
    return typeof d.code === "string" && d.code ? d.code : null;
  } catch {
    return null;
  }
}

export function EmbedButton({
  kind,
  id,
  artistSlug,
  refCode,
  title,
  className = "",
}: {
  kind: EmbedKind;
  id: string;
  artistSlug?: string | null;
  refCode?: string | null;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const refCache = useRef<string | null | undefined>(refCode);

  async function handleCopy() {
    if (busy) return;
    setBusy(true);
    try {
      let code = refCache.current;
      if (code === undefined && artistSlug) {
        code = await fetchRefCode(artistSlug);
        refCache.current = code;
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "https://bowdownvisuals.com";
      const { w, h } = DIMS[kind];
      const src = `${origin}/embed/${kind}/${encodeURIComponent(id)}${code ? `?ref=${encodeURIComponent(code)}` : ""}`;
      const label = title ? `${title} — Bow Down Visuals` : "Bow Down Visuals";
      const iframe = `<iframe src="${src}" width="${w}" height="${h}" frameborder="0" allow="autoplay; encrypted-media; fullscreen" loading="lazy" title="${label.replace(/"/g, "&quot;")}"></iframe>`;
      if (await copyText(iframe)) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy embed code — paste this player on your blog or website"
      className={`flex items-center gap-2 rounded-full border text-sm font-semibold px-4 py-2 transition-colors ${
        copied
          ? "border-[#e8c86a] bg-[#e8c86a]/15 text-[#e8c86a]"
          : "border-white/15 text-white/70 hover:border-[#e8c86a]/60 hover:text-[#e8c86a]"
      } ${className}`}
    >
      {copied ? <Check className="h-4 w-4" /> : <Code2 className="h-4 w-4" />}
      {copied ? "Copied!" : "Embed"}
    </button>
  );
}
