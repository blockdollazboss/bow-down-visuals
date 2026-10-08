import { Link } from "wouter";
import { Music2, Play, ShoppingBag, CalendarDays, ExternalLink } from "lucide-react";
import type { LooseAttachment } from "@/lib/social-api";
import { asAttachment, attachmentLink } from "@/lib/social-api";

/* Attachments render with their link target — images/video inline, everything
   else as a tappable card that goes somewhere real. Unlinked attachments
   (link === null) never render: a product mention with no link is a bug. */
export function AttachmentView({ attachments }: { attachments: LooseAttachment[] }) {
  const items = (attachments ?? [])
    .map((a) => asAttachment(a))
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .filter((a) => {
      if (a.kind === "poll") return false; // polls render in PostCard
      if (a.kind === "image" || a.kind === "video") return true;
      return attachmentLink(a) !== null;
    });
  if (items.length === 0) return null;
  return (
    <div className="mt-3 space-y-2.5">
      {items.map((a, i) => {
        if (a.kind === "image") {
          return (
            <img
              key={i}
              src={a.url}
              alt=""
              loading="lazy"
              className="max-h-[420px] w-full rounded-xl border border-[#2a2a2a] object-cover"
            />
          );
        }
        if (a.kind === "video") {
          return (
            <video
              key={i}
              src={a.url}
              poster={a.thumb}
              controls
              playsInline
              className="max-h-[420px] w-full rounded-xl border border-[#2a2a2a] bg-black"
            />
          );
        }
        const link = attachmentLink(a);
        if (!link) return null;
        if (a.kind === "product") {
          return (
            <Link
              key={i}
              href={link.href}
              className="flex items-center gap-3 rounded-xl border border-[#d4af37]/40 bg-gradient-to-r from-[#1a1408] to-[#0d0d0d] p-3 transition hover:border-[#d4af37]"
            >
              {a.image ? (
                <img src={a.image} alt="" className="h-14 w-14 rounded-lg object-cover" loading="lazy" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#d4af37]/15">
                  <ShoppingBag className="h-6 w-6 text-[#d4af37]" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{a.title || "Product"}</span>
                <span className="block text-xs text-[#d4af37]">Tap to buy — straight from this post 🦈</span>
              </span>
              <span className="shrink-0 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black">BUY</span>
            </Link>
          );
        }
        if (a.kind === "track" || a.kind === "watch") {
          const isAudio = a.kind === "track";
          const thumb = isAudio ? a.artwork : a.thumb;
          return (
            <Link
              key={i}
              href={link.href}
              className="flex items-center gap-3 rounded-xl border border-[#2a2a2a] bg-[#111] p-3 transition hover:border-[#d4af37]/60"
            >
              {thumb ? (
                <img src={thumb} alt="" className="h-12 w-12 rounded-lg object-cover" loading="lazy" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#d4af37]/15">
                  {isAudio ? <Music2 className="h-6 w-6 text-[#d4af37]" /> : <Play className="h-6 w-6 text-[#d4af37]" />}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{a.title || (isAudio ? "Track" : "Video")}</span>
                <span className="block text-xs text-neutral-400">{isAudio ? "Tap to listen" : "Tap to watch"}</span>
              </span>
              <Play className="h-5 w-5 shrink-0 text-[#d4af37]" />
            </Link>
          );
        }
        if (a.kind === "event") {
          return (
            <Link
              key={i}
              href={link.href}
              className="flex items-center gap-3 rounded-xl border border-[#2a2a2a] bg-[#111] p-3 transition hover:border-[#d4af37]/60"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#d4af37]/15">
                <CalendarDays className="h-6 w-6 text-[#d4af37]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{a.title || "Event"}</span>
                <span className="block truncate text-xs text-neutral-400">
                  {[a.date, a.venue].filter(Boolean).join(" · ") || "See events"}
                </span>
              </span>
              <ExternalLink className="h-4 w-4 shrink-0 text-[#d4af37]" />
            </Link>
          );
        }
        return null;
      })}
    </div>
  );
}
