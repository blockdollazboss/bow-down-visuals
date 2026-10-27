import { useEffect, useState } from "react";
import { ListVideo } from "lucide-react";
import { formatLyricTime } from "@/lib/karaoke";

/* ─── Auto Chapters on the watch surface (N5) ───
   Shows ONLY a creator-approved chapter set (the API returns null for
   drafts and for the off switch). Chapters come from the video's own
   transcript; clicking one seeks the player. */

interface WatchChapter {
  title: string;
  startSec: number;
  endSec: number;
}

export function WatchChapters({ slug, onSeek }: { slug: string; onSeek: (sec: number) => void }) {
  const [data, setData] = useState<{ chapters: WatchChapter[]; summary: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/showcase/${encodeURIComponent(slug)}/auto-chapters`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d?.autoChapters) setData(d.autoChapters);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [slug]);

  if (!data || data.chapters.length === 0) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 mb-8">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/50 mb-3">
        <ListVideo className="h-4 w-4 text-[#e8c86a]" /> Chapters
      </p>
      {data.summary && <p className="text-sm text-white/60 leading-relaxed mb-4">{data.summary}</p>}
      <div className="flex flex-wrap gap-2">
        {data.chapters.map((c, i) => (
          <button
            key={`${c.startSec}-${i}`}
            type="button"
            onClick={() => onSeek(c.startSec)}
            className="rounded-full border border-white/15 px-3.5 py-1.5 text-xs text-white/70 transition hover:border-[#e8c86a]/60 hover:text-white"
          >
            <span className="text-[#e8c86a] font-bold mr-1.5">{formatLyricTime(c.startSec)}</span>
            {c.title}
          </button>
        ))}
      </div>
    </div>
  );
}
