import { useState } from "react";
import { HelpCircle, X, ChevronRight, Bot, Zap } from "lucide-react";

interface HelpStep {
  n: number;
  title: string;
  desc: string;
}

const GUIDES: Record<string, { title: string; steps: HelpStep[] }> = {
  editor: {
    title: "Video Editor — Step by Step",
    steps: [
      { n: 1, title: "Select a clip",          desc: "Go to the Clips tab and click Preview on any scene that has a clip." },
      { n: 2, title: "Preview your clip",       desc: "The clip plays in Live Preview on the right. Use play/pause to review it." },
      { n: 3, title: "Add your music",          desc: "Go to the Music tab. Upload your song or build a mix in the Music Studio." },
      { n: 4, title: "Add captions",            desc: "Go to Captions, paste or auto-load your lyrics, then click Generate Captions From Lyrics." },
      { n: 5, title: "Add effects",             desc: "Go to Effects and click any effect chip. Live Preview updates with a CSS preview instantly." },
      { n: 6, title: "Check export summary",   desc: "Go to Export to see your clips, audio, captions, and format at a glance." },
      { n: 7, title: "Export your video",       desc: "Click Export when everything looks good. Final video is created with all clips, audio, and captions combined." },
    ],
  },
  dashboard: {
    title: "Creator Studio — Getting Started",
    steps: [
      { n: 1, title: "Choose your artist",   desc: "Go to Artist Profiles, create your artist, and click Set as Active Artist." },
      { n: 2, title: "Pick what to create",  desc: "Click Make Song + Video, Make Music Video, or Promo Clips." },
      { n: 3, title: "Generate with AI",     desc: "Follow the steps on screen. AI writes lyrics and creates video prompts for you." },
      { n: 4, title: "Save your project",    desc: "Your project saves automatically. Find it in My Projects anytime." },
      { n: 5, title: "Edit and export",      desc: "Open the Video Editor from My Projects to add effects, captions, and export." },
    ],
  },
  "artist-vault": {
    title: "Artist Profiles — Guide",
    steps: [
      { n: 1, title: "Add your artist details",    desc: "Fill in name, type, genre, visual style, hair, tattoos, clothing, and brand colors." },
      { n: 2, title: "Upload a reference image",   desc: "Add a photo so AI tools can match your artist's look." },
      { n: 3, title: "Lock character consistency", desc: "Click Lock Character Consistency to generate a prompt that keeps your artist looking the same in every video." },
      { n: 4, title: "Set as Active Artist",        desc: "Click Use This Artist to automatically apply your artist's style across all creation tools." },
    ],
  },
};

interface Props {
  page: "editor" | "dashboard" | "artist-vault";
  tips?: string[];
}

export function HelpPanel({ page, tips = [] }: Props) {
  const [open, setOpen] = useState(false);
  const guide = GUIDES[page];

  return (
    <>
      {/* ── Floating trigger button ── */}
      <button
        onClick={() => setOpen(true)}
        title="Need Help?"
        data-testid="help-panel-trigger"
        className="fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full bg-primary text-black shadow-[0_0_20px_rgba(218,165,32,0.40)] hover:shadow-[0_0_30px_rgba(218,165,32,0.60)] hover:scale-105 transition-all flex items-center justify-center"
      >
        <HelpCircle className="h-5 w-5" />
      </button>

      {/* ── Panel + backdrop ── */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-xs bg-[#070707] border-l border-white/[0.08] shadow-2xl flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-black text-white">Bow Down Assistant</p>
                  <p className="text-[10px] text-white/35">Your step-by-step guide</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-white/30 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">

              {/* Steps */}
              <div>
                <p className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-4">{guide.title}</p>
                <div className="space-y-4">
                  {guide.steps.map((step) => (
                    <div key={step.n} className="flex gap-3">
                      <div className="h-6 w-6 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center text-[10px] font-black text-primary shrink-0 mt-0.5">
                        {step.n}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white/80 leading-tight">{step.title}</p>
                        <p className="text-xs text-white/40 mt-1 leading-relaxed">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI Tech tips */}
              {tips.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-primary/50 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <Zap className="h-3 w-3" /> Bow Down AI Tech
                  </p>
                  <div className="space-y-2">
                    {tips.map((tip, i) => (
                      <div
                        key={i}
                        className="flex gap-2.5 px-3 py-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02]"
                      >
                        <ChevronRight className="h-3.5 w-3.5 text-primary/50 shrink-0 mt-0.5" />
                        <p className="text-xs text-white/55 leading-relaxed">{tip}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
