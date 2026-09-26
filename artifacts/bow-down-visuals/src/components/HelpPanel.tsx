import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { X, Bot, Zap, ChevronRight, Sparkles } from "lucide-react";
import { requestOnboardingTour } from "@/lib/onboarding";

/* ─── Types ─── */

export type HelpPage =
  | "dashboard"
  | "artist-vault"
  | "video-editor"
  | "my-projects"
  | "song-and-video"
  | "make-song"
  | "make-video"
  | "pricing"
  | "credit-history";

interface HelpStep {
  n: number;
  title: string;
  desc: string;
}

/* ─── Page guides ─── */

const GUIDES: Record<HelpPage, { title: string; steps: HelpStep[]; tips?: string[] }> = {
  dashboard: {
    title: "Creator Studio — Getting Started",
    steps: [
      { n: 1, title: "Choose your artist",  desc: "Go to Artist Profiles, create your artist, and click Set as Active Artist." },
      { n: 2, title: "Pick what to create", desc: "Click Start from Scratch, Video for My Song, or Promo Clips from the menu." },
      { n: 3, title: "Generate with AI",    desc: "Follow the on-screen steps. AI writes lyrics and creates video scene prompts for you." },
      { n: 4, title: "Save your project",   desc: "Your project saves automatically. Find it in My Projects anytime." },
      { n: 5, title: "Edit and export",     desc: "Open the Video Editor from My Projects to add effects, captions, and export your final video." },
    ],
    tips: [
      "Set an active artist first — it unlocks character consistency across all AI tools.",
      "Songs, video plans, promos, and thumbnails cost 1–2 credits each. Video clips cost 5 credits.",
    ],
  },

  "artist-vault": {
    title: "Artist Profiles — Guide",
    steps: [
      { n: 1, title: "Fill in your artist details",  desc: "Enter name, type, genre, visual style, hair, tattoos, clothing, and brand colors." },
      { n: 2, title: "Upload a reference photo",      desc: "Add a front-facing photo so AI tools can match your artist's face and style." },
      { n: 3, title: "Save your artist profile",      desc: "Click Save Artist Profile. Your profile is stored and reusable across all tools." },
      { n: 4, title: "Set as Active Artist",           desc: "Click Set as Active Artist. This loads your artist's style into every creation tool automatically." },
      { n: 5, title: "Lock character consistency",     desc: "Click Lock Character Consistency to generate a prompt that keeps your artist looking the same in every video." },
    ],
    tips: [
      "Use Video Safe mode in the Consistency Lock for Runway clips — less distorted tattoos and jewelry.",
      "The more details you fill in, the better AI tools match your artist's look.",
    ],
  },

  "video-editor": {
    title: "Video Editor — Step by Step",
    steps: [
      { n: 1, title: "Rebuild scenes if needed",  desc: "If your scene list is empty, click Rebuild Scenes to regenerate from your video plan." },
      { n: 2, title: "Select one scene",          desc: "Click on any scene in the timeline to expand it and see its details." },
      { n: 3, title: "Generate a video clip",     desc: "Click Generate Clip in the scene card. This uses 5 credits and takes 30–90 seconds." },
      { n: 4, title: "Preview your clip",         desc: "When the clip is ready, the master player at the top updates automatically." },
      { n: 5, title: "Add music and captions",    desc: "Go to the Music tab to upload your track. Go to Captions to add lyrics-based captions." },
      { n: 6, title: "Add visual effects",        desc: "Go to Effects and click any effect chip. The preview updates instantly." },
      { n: 7, title: "Export your video",         desc: "Go to the Export tab. When everything looks good, click Export to build your final video." },
    ],
    tips: [
      "Apply Character Consistency before generating clips to keep your artist looking the same across scenes.",
      "Generate clips one at a time first to check quality before doing all scenes.",
    ],
  },

  "my-projects": {
    title: "My Projects — Guide",
    steps: [
      { n: 1, title: "Open a saved project",     desc: "Click Open Project on any card. This loads your project in the Video Editor." },
      { n: 2, title: "Check generated clips",    desc: "Switch to the Clips tab in the editor to see all generated video clips for your scenes." },
      { n: 3, title: "Check generation history", desc: "Go to the Generation History tab to see every AI generation, credit use, and clip preview." },
      { n: 4, title: "Continue editing",         desc: "Open any project to continue adding clips, music, captions, or effects where you left off." },
    ],
    tips: [
      "Generation history logs every clip even if the project save fails — your credits are always traceable.",
      "Clip previews appear inline in Generation History. Click Preview Clip to open the full video.",
    ],
  },

  "song-and-video": {
    title: "Start from Scratch — Guide",
    steps: [
      { n: 1, title: "Enter your song details", desc: "Fill in artist name, song title, genre, mood, and any notes about the song concept." },
      { n: 2, title: "Generate lyrics",          desc: "Click Generate Lyrics. AI writes a full song structure with verses, hooks, and bridge." },
      { n: 3, title: "Generate video plan",      desc: "Click Generate Video Plan. AI creates a scene-by-scene visual breakdown for your music video." },
      { n: 4, title: "Review and save",          desc: "Review the lyrics and video plan. Edit anything you want, then click Save Project." },
      { n: 5, title: "Open in Video Editor",     desc: "Go to My Projects and open your saved project to start generating video clips scene by scene." },
    ],
    tips: [
      "Set an active artist before generating — it adds your character style to the video plan automatically.",
      "You can regenerate individual sections you don't like without redoing the whole song.",
    ],
  },

  "make-song": {
    title: "Make Song — Guide",
    steps: [
      { n: 1, title: "Enter your song concept", desc: "Fill in the artist, genre, mood, and any theme or story you want the song to be about." },
      { n: 2, title: "Generate your lyrics",    desc: "Click Generate and AI writes a full song with verses, hook, bridge, and outro." },
      { n: 3, title: "Review and edit",         desc: "Edit any part of the generated lyrics to match your vision exactly." },
      { n: 4, title: "Copy or save",            desc: "Copy the lyrics to use anywhere, or save them to a project for use in the Video Editor." },
    ],
    tips: [
      "Be specific about mood and theme — detailed inputs give better lyrics output.",
    ],
  },

  "make-video": {
    title: "Video for My Song — Guide",
    steps: [
      { n: 1, title: "Paste your lyrics",         desc: "Paste your song lyrics into the text area so AI can plan scenes around your song structure." },
      { n: 2, title: "Generate a video plan",     desc: "Click Generate Video Plan. AI creates a visual scene breakdown matched to your lyrics." },
      { n: 3, title: "Review scenes",             desc: "Each scene shows a shot type, location, action, and AI video prompt. Edit any scene you want." },
      { n: 4, title: "Save and open editor",      desc: "Save the project and open it in the Video Editor to start generating clips scene by scene." },
    ],
    tips: [
      "Set an active artist before generating to bake in character consistency across all scenes.",
    ],
  },

  pricing: {
    title: "Credits & Pricing — Guide",
    steps: [
      { n: 1, title: "What credits are for",     desc: "Credits power every AI generation. Songs, video plans, promos, and thumbnails cost 1–2 credits each; video clips cost 5 credits and take 30–90 seconds." },
      { n: 2, title: "Free vs paid features",    desc: "Creating artist profiles is free. Every AI generation — songs, video plans, promos, thumbnails, and video clips — uses credits." },
      { n: 3, title: "Buy credits",              desc: "Choose a credit pack below and check out. Credits appear in your account instantly." },
      { n: 4, title: "Check your balance",       desc: "Your credit balance is always visible in the top bar. Click it to view your full credit history." },
    ],
    tips: [
      "Credits never expire — they stay in your account until you use them.",
      "If a clip generation fails, your credits are automatically refunded.",
    ],
  },

  "credit-history": {
    title: "Credit History — Guide",
    steps: [
      { n: 1, title: "View your credit purchases", desc: "See all credit packs you've bought, dates, and amounts in the Purchases section." },
      { n: 2, title: "View credit usage",          desc: "The Usage table shows every time credits were spent, including which action used them." },
      { n: 3, title: "Refunds",                    desc: "If a video clip generation fails, credits are automatically refunded. Check the refunded column." },
      { n: 4, title: "Buy more credits",           desc: "Click Go to Pricing or visit the Pricing page to buy more credit packs." },
    ],
    tips: [
      "Generation History in My Projects also shows per-clip credit usage with clip previews.",
    ],
  },
};

/* ─── Route → page mapping ─── */

function pageFromPath(path: string): HelpPage {
  if (path.startsWith("/artist-vault"))   return "artist-vault";
  if (path.startsWith("/video-editor"))   return "video-editor";
  if (path.startsWith("/my-projects"))    return "my-projects";
  if (path.startsWith("/song-and-video")) return "song-and-video";
  if (path.startsWith("/make-song"))      return "make-song";
  if (path.startsWith("/make-video"))     return "make-video";
  if (path.startsWith("/pricing"))        return "pricing";
  if (path.startsWith("/credit-history")) return "credit-history";
  return "dashboard";
}

/* ─── localStorage keys ─── */

const LS_OPEN = "bdv_help_open";
const LS_SIDE = "bdv_help_side";

function readOpen(): boolean {
  try { return localStorage.getItem(LS_OPEN) === "true"; } catch { return false; }
}
function readSide(): "left" | "right" {
  try {
    const v = localStorage.getItem(LS_SIDE);
    if (v === "left" || v === "right") return v;
  } catch { /* noop */ }
  return "right";
}
function writeOpen(v: boolean) {
  try { localStorage.setItem(LS_OPEN, v ? "true" : "false"); } catch { /* noop */ }
}
function writeSide(s: "left" | "right") {
  try { localStorage.setItem(LS_SIDE, s); } catch { /* noop */ }
}

/* ─── Component ─── */

export function HelpPanel() {
  const [open, setOpen] = useState<boolean>(readOpen);
  const [side, setSide] = useState<"left" | "right">(readSide);
  const [location] = useLocation();

  const guide = GUIDES[pageFromPath(location)];

  function setOpenPersist(v: boolean) {
    writeOpen(v);
    setOpen(v);
  }

  function setSidePersist(s: "left" | "right") {
    writeSide(s);
    setSide(s);
  }

  useEffect(() => {
    function handleOpenEvent(e: Event) {
      const detail = (e as CustomEvent<{ side?: "left" | "right" }>).detail;
      if (detail?.side) setSidePersist(detail.side);
      setOpenPersist(true);
    }
    window.addEventListener("open-help-panel", handleOpenEvent);
    return () => window.removeEventListener("open-help-panel", handleOpenEvent);
  }, []);

  return (
    <>
      {open && (
        <>
          <div
            className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm"
            onClick={() => setOpenPersist(false)}
          />

          <div className={`fixed top-0 bottom-0 z-[10001] w-full max-w-[320px] bg-[#070707] shadow-2xl flex flex-col ${side === "left" ? "left-0 border-r border-white/[0.08]" : "right-0 border-l border-white/[0.08]"}`}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-black text-white">Bow Down AI Tech</p>
                  <p className="text-[10px] text-white/35">Your step-by-step guide</p>
                </div>
              </div>
              <button
                onClick={() => setOpenPersist(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-white/50 hover:text-white hover:border-white/20 hover:bg-white/[0.08] transition-colors text-xs font-semibold"
              >
                <X className="h-3.5 w-3.5" />
                Close Help
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
              {guide.tips && guide.tips.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-primary/50 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <Zap className="h-3 w-3" /> Bow Down AI Tech Tips
                  </p>
                  <div className="space-y-2">
                    {guide.tips.map((tip, i) => (
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

              {/* Replay the full onboarding tour */}
              <button
                type="button"
                onClick={() => {
                  setOpenPersist(false);
                  requestOnboardingTour();
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-primary/30 bg-primary/[0.08] text-primary text-xs font-bold transition hover:bg-primary/[0.16]"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Replay full walkthrough
              </button>

              {/* Footer note */}
              <p className="text-[10px] text-white/20 leading-relaxed pb-2">
                This panel remembers its open/closed state. Tap anywhere outside or click Close Help to dismiss it.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
