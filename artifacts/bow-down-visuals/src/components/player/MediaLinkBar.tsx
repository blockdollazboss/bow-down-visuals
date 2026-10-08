import { useEffect, useState } from "react";
import { Link } from "wouter";
import { User, Store, Scissors, Music2, Clapperboard } from "lucide-react";
import { resolveStoreSlug, type MediaKind } from "@/lib/streaming";

/* ─── Creator link strip (Worker 2) ───
   The link-graph glue on every media page. Every link is two-way safe:
   profile, store (only rendered when the storefront resolves — never a
   dead link), use-this-sound (audio pages + videos with linked sound),
   duet/stitch (video pages). No dead ends.
   Deep-link params (?sound= / ?duet=) are consumed by the clip-maker /
   editor teams — the pages load fine regardless. */

export function MediaLinkBar({
  kind,
  id,
  artistSlug,
  artistName,
  soundId,
  soundTitle,
}: {
  kind: MediaKind;
  id: string;
  artistSlug?: string | null;
  artistName?: string;
  soundId?: string | null;
  soundTitle?: string | null;
}) {
  const [storeSlug, setStoreSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!artistSlug) return;
    let alive = true;
    resolveStoreSlug(artistSlug).then((s) => { if (alive) setStoreSlug(s); });
    return () => { alive = false; };
  }, [artistSlug]);

  const items: Array<{ href: string; label: string; icon: React.ReactNode; title: string }> = [];

  if (artistSlug) {
    items.push({
      href: `/artist/${artistSlug}`,
      label: "Profile",
      title: `More from ${artistName ?? "this creator"}`,
      icon: <User className="h-4 w-4" />,
    });
  }
  if (storeSlug) {
    items.push({
      href: `/shop/${storeSlug}`,
      label: "Store",
      title: `${artistName ?? "Creator"}'s store`,
      icon: <Store className="h-4 w-4" />,
    });
  }
  if (kind === "track") {
    // Use this sound → clip-maker pre-loads the audio (deep link; page loads regardless).
    items.push({
      href: `/clip-maker?sound=track:${id}`,
      label: "Use this sound",
      title: "Make a clip with this audio",
      icon: <Music2 className="h-4 w-4" />,
    });
  } else {
    if (soundId) {
      items.push({
        href: `/track/${soundId}`,
        label: soundTitle ? `♪ ${soundTitle}` : "This sound",
        title: "The sound in this video",
        icon: <Music2 className="h-4 w-4" />,
      });
    }
    items.push({
      href: `/clip-maker?duet=video:${id}`,
      label: "Duet / Stitch",
      title: "Duet or stitch this video",
      icon: <Scissors className="h-4 w-4" />,
    });
  }

  if (items.length === 0) return null;

  return (
    <nav aria-label="Creator links" className="flex flex-wrap gap-2">
      {items.map((it) => (
        <Link key={it.label} href={it.href}>
          <span
            title={it.title}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3.5 py-1.5 text-xs font-semibold text-white/60 hover:text-[#e8c86a] hover:border-[#e8c86a]/50 transition-colors"
          >
            {it.icon}
            <span className="max-w-40 truncate">{it.label}</span>
          </span>
        </Link>
      ))}
      {kind === "video" && (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-white/30 px-1 py-1.5">
          <Clapperboard className="h-3.5 w-3.5" /> made for remixing
        </span>
      )}
    </nav>
  );
}
