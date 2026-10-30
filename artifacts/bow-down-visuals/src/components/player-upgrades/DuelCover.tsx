import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Play, Swords } from "lucide-react";

/* ─── Thumbnail Duel cover on the showcase grid (#174) ───
   When a video has a running duel, the grid serves the next cover in
   rotation (the serve itself is the counted view) and a click-through
   counts as that cover's click. Without a duel, the normal thumb shows. */

interface ServedCover {
  cover: "a" | "b";
  coverUrl: string;
}

export function DuelCover({ slug, children }: { slug: string; children: ReactNode }) {
  const [served, setServed] = useState<ServedCover | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/showcase/${encodeURIComponent(slug)}/duel-cover`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d?.duel) setServed({ cover: d.duel.cover, coverUrl: d.duel.coverUrl });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [slug]);

  function handleClick() {
    if (!served) return;
    /* keepalive: the click must land even as the browser navigates. */
    fetch(`/api/showcase/${encodeURIComponent(slug)}/duel-click`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cover: served.cover }),
    }).catch(() => {});
  }

  return (
    <div
      className="relative aspect-video bg-black/60 overflow-hidden"
      onClick={handleClick}
      {...(served
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": "Count my click for this cover in the duel",
            onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            },
          }
        : {})}
    >
      {served ? (
        <>
          <img src={served.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-black/60 p-3 border border-white/20">
              <Play className="h-5 w-5 text-white" />
            </span>
          </span>
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/70 border border-[#e8c86a]/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#e8c86a]">
            <Swords className="h-3 w-3" /> Cover duel
          </span>
        </>
      ) : (
        children
      )}
    </div>
  );
}
