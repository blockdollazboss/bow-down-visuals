import { Link } from "wouter";
import { Mic2, Video, Film, Upload, ArrowRight, Check } from "lucide-react";

/* ─────────────────────────── STUDIO PIPELINE ───────────────────────────
 * The 1 → 2 → 3 release workflow:
 *   1. Make or upload a song
 *   2. Make or upload a video
 *   3. Build a promo plan / promo clips
 * Every step is also individually clickable so users can jump straight in.
 * ───────────────────────────────────────────────────────────────────────── */

export interface PipelineStep {
  n: 1 | 2 | 3;
  icon: React.ElementType;
  title: string;
  makeLabel: string;
  makeHref: string;
  makeDesc: string;
  uploadLabel: string;
  uploadDesc: string;
}

const STEPS: PipelineStep[] = [
  {
    n: 1,
    icon: Mic2,
    title: "Song",
    makeLabel: "Make a Song",
    makeHref: "/make-song",
    makeDesc: "Write lyrics, hooks, verses and beat direction.",
    uploadLabel: "Upload your song",
    uploadDesc: "MP3, WAV, M4A — or any audio file.",
  },
  {
    n: 2,
    icon: Video,
    title: "Video",
    makeLabel: "Make a Video",
    makeHref: "/make-video",
    makeDesc: "Turn your song into scenes and AI clips.",
    uploadLabel: "Upload your clips",
    uploadDesc: "MP4, WebM — edit in the CapCut-style editor.",
  },
  {
    n: 3,
    icon: Film,
    title: "Promo",
    makeLabel: "Promo Plans",
    makeHref: "/promo-clip",
    makeDesc: "TikTok, Reels & Shorts ideas for your release.",
    uploadLabel: "Upload your assets",
    uploadDesc: "Artwork, clips, stems — promo uses them.",
  },
];

export function StudioPipeline({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.035] to-transparent p-5 md:p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-bold tracking-[0.2em] text-primary/60 uppercase mb-1">
            The Release Workflow
          </p>
          <h2 className="text-lg md:text-xl font-black text-white tracking-tight">
            1 · 2 · 3 — or jump straight in
          </h2>
          {!compact && (
            <p className="text-sm text-white/40 mt-1">
              Follow the steps in order, or tap any step to use it on its own.
            </p>
          )}
        </div>
        <Link href="/song-and-video">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-bold text-primary/70 hover:text-primary transition-colors shrink-0 border border-primary/25 hover:border-primary/50 rounded-xl px-3 py-2">
            Full guided flow <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <div key={step.n} className="relative">
              {/* connector arrow between steps (desktop) */}
              {i < STEPS.length - 1 && (
                <div className="hidden md:flex absolute top-1/2 -right-[18px] z-10 h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-white/[0.08] bg-black">
                  <ArrowRight className="h-3.5 w-3.5 text-white/30" />
                </div>
              )}
              <div className="h-full rounded-xl border border-white/[0.07] bg-black/40 p-4 flex flex-col gap-3 hover:border-primary/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                    <span className="text-sm font-black text-primary">{step.n}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-bold text-white truncate">{step.title}</span>
                  </div>
                </div>

                {/* Make path */}
                <Link href={step.makeHref}>
                  <div className="group rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-primary/[0.06] hover:border-primary/25 transition-all p-3 cursor-pointer">
                    <p className="text-sm font-bold text-white group-hover:text-primary transition-colors">
                      {step.makeLabel}
                    </p>
                    <p className="text-xs text-white/35 mt-0.5 leading-relaxed">{step.makeDesc}</p>
                  </div>
                </Link>

                {/* Upload path */}
                <Link href={step.makeHref}>
                  <div className="group rounded-lg border border-dashed border-white/[0.10] hover:border-primary/35 hover:bg-primary/[0.03] transition-all p-3 cursor-pointer">
                    <p className="text-sm font-bold text-white/70 group-hover:text-white transition-colors flex items-center gap-1.5">
                      <Upload className="h-3.5 w-3.5 text-primary/70" />
                      {step.uploadLabel}
                    </p>
                    <p className="text-xs text-white/30 mt-0.5 leading-relaxed">{step.uploadDesc}</p>
                  </div>
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {!compact && (
        <div className="mt-4 flex items-center gap-2 text-xs text-white/30">
          <Check className="h-3.5 w-3.5 text-primary/60 shrink-0" />
          <span>
            Your files stay yours — uploads are used in your project and never shared without you.
          </span>
        </div>
      )}
    </div>
  );
}
