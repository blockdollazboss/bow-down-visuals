import type { SongStructure } from "@/lib/song-structure";
import { Clock, Zap, Play, BarChart2 } from "lucide-react";

const SECTION_STYLE: Record<string, { dot: string; badge: string }> = {
  "Intro":         { dot: "bg-blue-400",   badge: "text-blue-300 bg-blue-400/10 border-blue-400/20" },
  "Hook":          { dot: "bg-yellow-400", badge: "text-yellow-300 bg-yellow-400/10 border-yellow-400/20" },
  "Hook / Chorus": { dot: "bg-yellow-400", badge: "text-yellow-300 bg-yellow-400/10 border-yellow-400/20" },
  "Chorus":        { dot: "bg-yellow-400", badge: "text-yellow-300 bg-yellow-400/10 border-yellow-400/20" },
  "Pre-Hook":      { dot: "bg-orange-400", badge: "text-orange-300 bg-orange-400/10 border-orange-400/20" },
  "Verse 1":       { dot: "bg-purple-400", badge: "text-purple-300 bg-purple-400/10 border-purple-400/20" },
  "Verse 2":       { dot: "bg-purple-400", badge: "text-purple-300 bg-purple-400/10 border-purple-400/20" },
  "Verse 3":       { dot: "bg-purple-400", badge: "text-purple-300 bg-purple-400/10 border-purple-400/20" },
  "Bridge":        { dot: "bg-pink-400",   badge: "text-pink-300 bg-pink-400/10 border-pink-400/20" },
  "Outro":         { dot: "bg-green-400",  badge: "text-green-300 bg-green-400/10 border-green-400/20" },
};

function sectionStyle(name: string) {
  return SECTION_STYLE[name] ?? { dot: "bg-primary", badge: "text-primary bg-primary/10 border-primary/20" };
}

interface Props {
  analysis: SongStructure;
  compact?: boolean;
}

export function SongSectionAnalysis({ analysis, compact = false }: Props) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden" data-testid="song-section-analysis">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.05] bg-white/[0.01]">
        <div className="h-7 w-7 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
          <BarChart2 className="h-3.5 w-3.5 text-primary" />
        </div>
        <div>
          <p className="text-xs font-bold tracking-widest text-primary uppercase">Song Structure Analysis</p>
          {analysis.hasTimestamps && (
            <p className="text-[10px] text-white/30 mt-0.5 flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" /> Timestamps detected
            </p>
          )}
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Sections grid */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Song Sections</p>
          <div className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"}`}>
            {analysis.sections.map((sec) => {
              const style = sectionStyle(sec.name);
              return (
                <div
                  key={sec.name}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex gap-3"
                >
                  <div className={`h-2 w-2 rounded-full shrink-0 mt-1.5 ${style.dot}`} />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${style.badge}`}>
                        {sec.name}
                      </span>
                      {(sec.startTime || sec.endTime) && (
                        <span className="text-xs text-white/30 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {sec.startTime}{sec.endTime ? `–${sec.endTime}` : ""}
                        </span>
                      )}
                    </div>
                    {sec.lyrics && (
                      <p className="text-xs text-white/40 italic leading-relaxed line-clamp-2">
                        "{sec.lyrics.split("\n").slice(0, 2).join(" / ")}"
                      </p>
                    )}
                    {sec.notes && (
                      <p className="text-xs text-white/55 leading-relaxed">{sec.notes}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Promo clips */}
        {(analysis.promo15?.section || analysis.promo30?.section) && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Best Promo Clips</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {analysis.promo15?.section && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black bg-primary text-black px-2 py-0.5 rounded-full tracking-wide">15s</span>
                    <Play className="h-3 w-3 text-primary" />
                    <span className="text-sm font-bold text-white">{analysis.promo15.section}</span>
                  </div>
                  {analysis.promo15.startTime && (
                    <p className="text-xs text-white/30 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {analysis.promo15.startTime}{analysis.promo15.endTime ? `–${analysis.promo15.endTime}` : ""}
                    </p>
                  )}
                  <p className="text-xs text-white/50 leading-relaxed">{analysis.promo15.reason}</p>
                </div>
              )}
              {analysis.promo30?.section && (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black bg-white/10 text-white/70 px-2 py-0.5 rounded-full tracking-wide">30s</span>
                    <Play className="h-3 w-3 text-white/40" />
                    <span className="text-sm font-bold text-white">{analysis.promo30.section}</span>
                  </div>
                  {analysis.promo30.startTime && (
                    <p className="text-xs text-white/30 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {analysis.promo30.startTime}{analysis.promo30.endTime ? `–${analysis.promo30.endTime}` : ""}
                    </p>
                  )}
                  <p className="text-xs text-white/50 leading-relaxed">{analysis.promo30.reason}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Video Pacing + Energy Map */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {analysis.videoPacing && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest flex items-center gap-1.5">
                <Zap className="h-3 w-3" /> Video Pacing
              </p>
              <p className="text-xs text-white/55 leading-relaxed">{analysis.videoPacing}</p>
            </div>
          )}
          {analysis.energyMap && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest flex items-center gap-1.5">
                <BarChart2 className="h-3 w-3" /> Energy Arc
              </p>
              <p className="text-xs text-white/55 leading-relaxed">{analysis.energyMap}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
