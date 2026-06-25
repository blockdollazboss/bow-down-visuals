import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import {
  Bot, ChevronRight, Zap, Play, Pause, Volume2, VolumeX,
  Minimize2, ChevronUp, GripHorizontal,
} from "lucide-react";
import { useThemePlayer } from "@/contexts/ThemePlayerContext";

/* ─── Snap geometry ─────────────────────────────────────────── */

const SNAP_M    = 20;   // px margin from screen edge
const HIDE_MS   = 3500; // ms idle before auto-hide
const PEEK_PX   = 6;    // px left visible as hover target

type SnapPt = "TL" | "TC" | "TR" | "RC" | "BR" | "BC" | "BL" | "LC";
const ALL_SNAPS: SnapPt[] = ["TL", "TC", "TR", "RC", "BR", "BC", "BL", "LC"];

function snapPos(pt: SnapPt, w: number, h: number) {
  const vw = window.innerWidth, vh = window.innerHeight, m = SNAP_M;
  const cx = Math.round((vw - w) / 2), cy = Math.round((vh - h) / 2);
  const map: Record<SnapPt, { x: number; y: number }> = {
    TL: { x: m,          y: m          },
    TC: { x: cx,         y: m          },
    TR: { x: vw - w - m, y: m          },
    RC: { x: vw - w - m, y: cy         },
    BR: { x: vw - w - m, y: vh - h - m },
    BC: { x: cx,         y: vh - h - m },
    BL: { x: m,          y: vh - h - m },
    LC: { x: m,          y: cy         },
  };
  return map[pt];
}

function nearestSnap(x: number, y: number, w: number, h: number): SnapPt {
  const cx = x + w / 2, cy = y + h / 2;
  let best: SnapPt = "BR", bestD = Infinity;
  for (const pt of ALL_SNAPS) {
    const a = snapPos(pt, w, h);
    const d = (cx - a.x - w / 2) ** 2 + (cy - a.y - h / 2) ** 2;
    if (d < bestD) { bestD = d; best = pt; }
  }
  return best;
}

/** CSS transform that slides the widget off its nearest edge, leaving PEEK_PX visible. */
function slideXform(pt: SnapPt): string {
  const off = `${SNAP_M - PEEK_PX}px`;
  if (pt === "TR" || pt === "RC" || pt === "BR") return `translateX(calc(100% + ${off}))`;
  if (pt === "TL" || pt === "LC" || pt === "BL") return `translateX(calc(-100% - ${off}))`;
  if (pt === "TC")                                return `translateY(calc(-100% - ${off}))`;
  /* BC */                                        return `translateY(calc(100%  + ${off}))`;
}

/** Thin gold peek tab that stays visible at the inside edge after slide. */
function peekStyle(pt: SnapPt): React.CSSProperties {
  const base: React.CSSProperties = {
    position:      "absolute",
    borderRadius:  2,
    background:    "linear-gradient(135deg,rgba(155,117,21,0.90),rgba(218,165,32,0.90))",
    boxShadow:     "0 0 8px rgba(218,165,32,0.60)",
    pointerEvents: "none",
  };
  if (pt === "TR" || pt === "RC" || pt === "BR")
    return { ...base, left: 0,   top: "15%", bottom: "15%", width: PEEK_PX };
  if (pt === "TL" || pt === "LC" || pt === "BL")
    return { ...base, right: 0,  top: "15%", bottom: "15%", width: PEEK_PX };
  if (pt === "TC")
    return { ...base, bottom: 0, left: "25%", right: "25%", height: PEEK_PX };
  /* BC */
  return   { ...base, top: 0,    left: "25%", right: "25%", height: PEEK_PX };
}

/* Snap labels for the indicator dots */
const SNAP_LABELS: Record<SnapPt, string> = {
  TL: "Top Left", TC: "Top Center", TR: "Top Right",
  RC: "Right Center",
  BR: "Bottom Right", BC: "Bottom Center", BL: "Bottom Left",
  LC: "Left Center",
};

function savedSnap(): SnapPt {
  try {
    const v = localStorage.getItem("bdv-guide-snap") as SnapPt | null;
    if (v && (ALL_SNAPS as string[]).includes(v)) return v;
  } catch { /* noop */ }
  return "BR";
}
function saveSnap(pt: SnapPt) {
  try { localStorage.setItem("bdv-guide-snap", pt); } catch { /* noop */ }
}

/* ─── Guide content ─────────────────────────────────────────── */

type HelpKey =
  | "dashboard" | "artist-vault" | "my-projects"
  | "song-and-video" | "make-song" | "make-video"
  | "pricing" | "credit-history"
  | "editor:clips" | "editor:timeline" | "editor:music"
  | "editor:captions" | "editor:effects" | "editor:branding" | "editor:export"
  | "video-editor";

interface HelpStep { n: number; title: string; desc: string }
interface GuideEntry { title: string; steps: HelpStep[]; tips?: string[] }

const GUIDES: Record<HelpKey, GuideEntry> = {
  dashboard: {
    title: "Creator Studio — Getting Started",
    steps: [
      { n: 1, title: "Choose your artist",  desc: "Go to Artist Profiles, create your artist, and click Set as Active Artist." },
      { n: 2, title: "Pick what to create", desc: "Click Make Song + Video, Make Music Video, or Promo Clips from the menu." },
      { n: 3, title: "Generate with AI",    desc: "Follow the on-screen steps. AI writes lyrics and creates video scene prompts for you." },
      { n: 4, title: "Save your project",   desc: "Your project saves automatically. Find it in My Projects anytime." },
      { n: 5, title: "Edit and export",     desc: "Open the Video Editor from My Projects to add effects, captions, and export your video." },
    ],
    tips: [
      "Set an active artist first — it unlocks character consistency across all AI tools.",
      "Credits are only used when generating video clips. Text generations are free.",
    ],
  },
  "artist-vault": {
    title: "Artist Profiles — Guide",
    steps: [
      { n: 1, title: "Fill in your artist details",  desc: "Enter name, type, genre, visual style, hair, tattoos, clothing, and brand colors." },
      { n: 2, title: "Upload a reference photo",      desc: "Add a front-facing photo so AI tools can match your artist's face and style." },
      { n: 3, title: "Save your artist profile",      desc: "Click Save Artist Profile. Your profile is stored and reusable across all tools." },
      { n: 4, title: "Set as Active Artist",           desc: "Click Set as Active Artist to load your artist's style into every creation tool." },
      { n: 5, title: "Lock character consistency",     desc: "Click Lock Character Consistency to keep your artist looking the same in every clip." },
    ],
    tips: [
      "Use Video Safe mode in the Consistency Lock for Runway clips — reduces distortion.",
      "The more details you fill in, the better AI matches your artist's look.",
    ],
  },
  "my-projects": {
    title: "My Projects — Guide",
    steps: [
      { n: 1, title: "Open a saved project",     desc: "Click Open Project on any card to load it in the Video Editor." },
      { n: 2, title: "Check generated clips",    desc: "Switch to the Clips tab in the editor to see all generated video clips." },
      { n: 3, title: "Check generation history", desc: "Go to Generation History to see every AI generation, credit use, and clip preview." },
      { n: 4, title: "Continue editing",         desc: "Open any project to continue adding clips, music, captions, or effects." },
    ],
    tips: [
      "Generation history logs every clip even if the project save fails.",
      "Clip previews appear inline — click Preview Clip to open the full video.",
    ],
  },
  "song-and-video": {
    title: "Make Song + Video — Guide",
    steps: [
      { n: 1, title: "Enter your song details", desc: "Fill in artist name, song title, genre, mood, and any notes about the concept." },
      { n: 2, title: "Generate lyrics",          desc: "Click Generate Lyrics. AI writes a full song with verses, hooks, and bridge." },
      { n: 3, title: "Generate video plan",      desc: "Click Generate Video Plan. AI creates a scene-by-scene visual breakdown." },
      { n: 4, title: "Review and save",          desc: "Review the lyrics and video plan. Edit anything, then click Save Project." },
      { n: 5, title: "Open in Video Editor",     desc: "Go to My Projects and open your saved project to start generating clips." },
    ],
    tips: [
      "Set an active artist before generating — it adds your character style automatically.",
      "You can regenerate individual sections you don't like without redoing the whole song.",
    ],
  },
  "make-song": {
    title: "Make Song — Guide",
    steps: [
      { n: 1, title: "Enter your song concept", desc: "Fill in the artist, genre, mood, and any theme or story for the song." },
      { n: 2, title: "Generate your lyrics",    desc: "Click Generate and AI writes a full song with verses, hook, bridge, and outro." },
      { n: 3, title: "Review and edit",         desc: "Edit any part of the generated lyrics to match your vision exactly." },
      { n: 4, title: "Copy or save",            desc: "Copy the lyrics or save them to a project for use in the Video Editor." },
    ],
    tips: ["Be specific about mood and theme — detailed inputs give better lyrics."],
  },
  "make-video": {
    title: "Make Music Video — Guide",
    steps: [
      { n: 1, title: "Paste your lyrics",         desc: "Paste your song lyrics so AI can plan scenes around your song structure." },
      { n: 2, title: "Generate a video plan",     desc: "Click Generate Video Plan. AI creates a visual scene breakdown matched to your lyrics." },
      { n: 3, title: "Review scenes",             desc: "Each scene shows a shot type, location, action, and AI video prompt." },
      { n: 4, title: "Save and open editor",      desc: "Save the project and open it in the Video Editor to start generating clips." },
    ],
    tips: ["Set an active artist before generating to bake in character consistency."],
  },
  pricing: {
    title: "Credits & Pricing — Guide",
    steps: [
      { n: 1, title: "What credits are for",     desc: "Credits power Runway AI video clip generation. Each clip costs 5 credits." },
      { n: 2, title: "Free vs paid features",    desc: "Lyrics, video plans, scene prompts, and artist profiles are free." },
      { n: 3, title: "Buy credits",              desc: "Choose a credit pack below and check out. Credits appear instantly." },
      { n: 4, title: "Check your balance",       desc: "Your credit balance is always visible in the top bar." },
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
      { n: 2, title: "View credit usage",          desc: "The Usage table shows every time credits were spent and which action used them." },
      { n: 3, title: "Refunds",                    desc: "If a video clip generation fails, credits are automatically refunded." },
      { n: 4, title: "Buy more credits",           desc: "Click Go to Pricing or visit the Pricing page to buy more credit packs." },
    ],
    tips: ["Generation History in My Projects also shows per-clip credit usage with clip previews."],
  },
  "video-editor": {
    title: "Video Editor — Getting Started",
    steps: [
      { n: 1, title: "Open the Clips tab",        desc: "See all scenes and start generating video clips one by one." },
      { n: 2, title: "Add your music",            desc: "Go to Music Mixer → upload your song → set it as video audio." },
      { n: 3, title: "Add captions",              desc: "Go to Captions → paste lyrics → Generate → AI Sync To Vocals." },
      { n: 4, title: "Add effects and branding",  desc: "Go to Effects and Branding tabs to add visual polish." },
      { n: 5, title: "Export",                    desc: "Go to Export → choose format → click Export to build your final video." },
    ],
    tips: ["The master player on the left previews everything live as you work."],
  },
  "editor:clips": {
    title: "Clips Tab — Guide",
    steps: [
      { n: 1, title: "Review scene clips",         desc: "Browse all your scenes. Each card shows the scene prompt and generated clip thumbnail." },
      { n: 2, title: "Preview in master player",   desc: "Click a clip card to load it into the master player on the left." },
      { n: 3, title: "Generate missing clips",     desc: "Click Generate Clip on any scene that hasn't been generated yet (costs 5 credits)." },
      { n: 4, title: "Regenerate if needed",       desc: "If a clip doesn't look right, click Regenerate to try a new version." },
    ],
    tips: [
      "Generate one clip first to check quality before doing all scenes.",
      "Apply Character Consistency in Artist Profiles before generating.",
    ],
  },
  "editor:timeline": {
    title: "Timeline Tab — Guide",
    steps: [
      { n: 1, title: "Preview your full video",   desc: "The timeline plays all scenes in sequence with your audio track." },
      { n: 2, title: "Click a scene to jump",     desc: "Click any scene in the list to jump to that clip in the master player." },
      { n: 3, title: "Check audio sync",          desc: "Play the full timeline to check that captions and audio align." },
      { n: 4, title: "Go back to adjust",         desc: "If something is off, go to Captions tab to nudge timing or re-run AI Sync." },
    ],
    tips: ["Use fullscreen mode in the master player to see the video at full size."],
  },
  "editor:music": {
    title: "Music Mixer Tab — Guide",
    steps: [
      { n: 1, title: "Upload your song",       desc: "Click Upload Song to attach your MP3. The player loads it automatically." },
      { n: 2, title: "Set as video audio",     desc: "In Video Audio, select your uploaded song as the audio source." },
      { n: 3, title: "Transcribe for lyrics",  desc: "Click Get Lyrics to transcribe your song — this fills in the lyric text." },
      { n: 4, title: "Send to Captions",       desc: "Click Send Lyrics to Captions to auto-fill the caption text box." },
    ],
    tips: [
      "The transcription limit is 25 MB — use a smaller MP3 if your file is larger.",
      "After uploading, song duration auto-detects for caption timing.",
    ],
  },
  "editor:captions": {
    title: "Captions Tab — Guide",
    steps: [
      { n: 1, title: "Generate captions",          desc: "Paste lyrics and click Generate Captions From Lyrics to create timed caption lines." },
      { n: 2, title: "AI Sync to vocals",          desc: "Click AI Sync Captions To Vocals — AI matches each caption to the actual vocal timestamps." },
      { n: 3, title: "Review red-bordered lines",  desc: "Lines with a red left border need manual review — use nudge controls to fix them." },
      { n: 4, title: "Preview in master player",   desc: "Select any caption row to see it live in the master player on the left." },
    ],
    tips: [
      "Green = high confidence, Yellow = medium, Orange = low, Red = needs review.",
      "AI Sync works best when your uploaded lyrics match what's in the song.",
    ],
  },
  "editor:effects": {
    title: "Effects Tab — Guide",
    steps: [
      { n: 1, title: "Browse effects",         desc: "All available visual effects are listed as chips — each one has a live preview." },
      { n: 2, title: "Click to apply",         desc: "Click any effect chip to toggle it on. The master player updates instantly." },
      { n: 3, title: "Stack effects",          desc: "You can combine multiple effects — they're all burned into the final export." },
      { n: 4, title: "Preview the result",     desc: "Watch the master player to see how the effects look on your actual clips." },
    ],
    tips: ["Some effects work better on certain visual styles — try a few and compare."],
  },
  "editor:branding": {
    title: "Branding Tab — Guide",
    steps: [
      { n: 1, title: "Add an intro card",      desc: "Choose an intro card style to display your artist name at the start of the video." },
      { n: 2, title: "Add a watermark",        desc: "Upload your logo or enter text to burn a watermark onto every scene." },
      { n: 3, title: "Add an outro CTA",       desc: "Choose a call-to-action for the end of your video (Stream Now, Follow, etc.)." },
      { n: 4, title: "Preview",                desc: "The master player shows the intro/outro when you play back your video." },
    ],
    tips: ["Watermarks are optional — remove before exporting if you prefer a clean version."],
  },
  "editor:export": {
    title: "Export Tab — Guide",
    steps: [
      { n: 1, title: "Check everything first",  desc: "Make sure clips, audio, captions, and effects are all set before exporting." },
      { n: 2, title: "Choose your format",      desc: "Select 9:16 for TikTok/Reels/Shorts, or 16:9 for YouTube landscape." },
      { n: 3, title: "Click Export",            desc: "Click Export Video to start building your final video. This takes a few minutes." },
      { n: 4, title: "Download your video",     desc: "When export finishes, a download link appears. Click it to save your final video." },
    ],
    tips: [
      "Draft quality is faster — use it for a first look before exporting at full quality.",
      "Export includes all effects, captions, watermarks, intro, and outro.",
    ],
  },
};

function keyFromPath(path: string, editorTab: string | null): HelpKey {
  if (path.startsWith("/video-editor")) {
    if (editorTab) return `editor:${editorTab}` as HelpKey;
    return "video-editor";
  }
  if (path.startsWith("/artist-vault"))   return "artist-vault";
  if (path.startsWith("/my-projects"))    return "my-projects";
  if (path.startsWith("/song-and-video")) return "song-and-video";
  if (path.startsWith("/make-song"))      return "make-song";
  if (path.startsWith("/make-video"))     return "make-video";
  if (path.startsWith("/pricing"))        return "pricing";
  if (path.startsWith("/credit-history")) return "credit-history";
  return "dashboard";
}

/* ─── localStorage open/closed ─── */
const LS_OPEN = "bdv_guide_open";
function readOpen() {
  try { return localStorage.getItem(LS_OPEN) !== "false"; } catch { return true; }
}
function saveOpen(v: boolean) {
  try { localStorage.setItem(LS_OPEN, v ? "true" : "false"); } catch { /* noop */ }
}

/* ─── Theme player row ─── */
function ThemePlayerRow() {
  const { status, playing, muted, volume, togglePlay, toggleMute, setVolume } = useThemePlayer();
  const loaded      = status === "ready" || status === "playing";
  const unavailable = status === "missing" || status === "error";

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black text-white/30 uppercase tracking-widest flex items-center gap-1.5">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${loaded ? "bg-green-400" : unavailable ? "bg-red-400/60" : "bg-yellow-400/60"}`} />
        Theme Song
        {unavailable && <span className="text-red-400/60 font-normal normal-case tracking-normal ml-1">— not found</span>}
      </p>
      {!unavailable && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03]">
          <button
            onClick={togglePlay}
            aria-label={playing ? "Pause theme" : "Play theme"}
            className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-transform hover:scale-110 active:scale-95"
            style={{ background: "linear-gradient(135deg,#9B7515,#DAA520)", boxShadow: "0 0 8px rgba(218,165,32,0.50)" }}
          >
            {playing
              ? <Pause className="h-3 w-3 text-black" fill="black" />
              : <Play  className="h-3 w-3 text-black" fill="black" style={{ marginLeft: 1 }} />
            }
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.12em] text-yellow-400/70 leading-none">Bow Down Visuals</p>
            {playing && (
              <div className="flex items-end gap-[2px] mt-1" style={{ height: 7 }}>
                {["0s","0.12s","0.22s","0.08s"].map((delay, i) => (
                  <div key={i} style={{
                    width: 2, borderRadius: 1,
                    background: "linear-gradient(to top,#9B7515,#FFD700)",
                    height: 7,
                    animation: `bdvEq${i} 0.6s ease-in-out ${delay} infinite alternate`,
                  }} />
                ))}
              </div>
            )}
          </div>
          <input
            type="range" min={0} max={1} step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-16 h-1 accent-yellow-500 cursor-pointer"
            aria-label="Theme volume"
          />
          <button
            onClick={toggleMute}
            aria-label={muted ? "Unmute theme" : "Mute theme"}
            className="h-6 w-6 flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/50 hover:text-white hover:border-white/20 transition-colors shrink-0"
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Snap position indicator dots ─── */
function SnapDots({ current }: { current: SnapPt }) {
  const positions: { pt: SnapPt; style: React.CSSProperties }[] = [
    { pt: "TL", style: { top: 0,    left: 0  } },
    { pt: "TC", style: { top: 0,    left: "50%", transform: "translateX(-50%)" } },
    { pt: "TR", style: { top: 0,    right: 0 } },
    { pt: "RC", style: { top: "50%", right: 0, transform: "translateY(-50%)" } },
    { pt: "BR", style: { bottom: 0, right: 0 } },
    { pt: "BC", style: { bottom: 0, left: "50%", transform: "translateX(-50%)" } },
    { pt: "BL", style: { bottom: 0, left: 0  } },
    { pt: "LC", style: { top: "50%", left: 0, transform: "translateY(-50%)" } },
  ];
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
      style={{ borderRadius: "inherit" }}
    >
      {positions.map(({ pt, style }) => (
        <div
          key={pt}
          title={SNAP_LABELS[pt]}
          style={{
            position: "absolute",
            width: 6, height: 6, borderRadius: "50%",
            background: pt === current
              ? "rgba(218,165,32,0.95)"
              : "rgba(255,255,255,0.15)",
            boxShadow: pt === current ? "0 0 6px rgba(218,165,32,0.80)" : "none",
            transition: "background 0.25s, box-shadow 0.25s",
            margin: 4,
            ...style,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────── */

export function BowDownAIGuide() {
  const elRef      = useRef<HTMLDivElement>(null);
  const dragging   = useRef(false);
  const startPtr   = useRef({ px: 0, py: 0, ex: 0, ey: 0 });
  const posRef     = useRef({ x: 0, y: 0 });
  const hideTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initSnap   = savedSnap();
  const [pos,          rawSetPos]      = useState(() => snapPos(initSnap, 220, 44));
  const [currentSnap,  setCurrentSnap] = useState<SnapPt>(initSnap);
  const [isSnapping,   setIsSnapping]  = useState(false);
  const [isDragging,   setIsDragging]  = useState(false);
  const [isHidden,     setIsHidden]    = useState(false);  // auto-hidden (peeking)
  const [open,         setOpen]        = useState<boolean>(readOpen);

  const [location]   = useLocation();
  const [editorTab,  setEditorTab] = useState<string | null>(null);

  const { status, playing, muted } = useThemePlayer();
  const loaded = status === "ready" || status === "playing";

  /* ── helpers ── */
  function updatePos(p: { x: number; y: number }) {
    posRef.current = p;
    rawSetPos(p);
  }

  function snapTo(pt: SnapPt, w: number, h: number) {
    saveSnap(pt);
    setCurrentSnap(pt);
    setIsSnapping(true);
    updatePos(snapPos(pt, w, h));
    setTimeout(() => setIsSnapping(false), 400);
  }

  const startHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setOpen(false);          // collapse panel on auto-hide
      setIsHidden(true);
    }, HIDE_MS);
  }, []);

  const cancelHideTimer = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);

  /* ── boot: place at saved snap, start idle timer ── */
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    updatePos(snapPos(initSnap, el.offsetWidth, el.offsetHeight));
    startHideTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── resize: re-snap ── */
  useEffect(() => {
    const onResize = () => {
      const el = elRef.current;
      if (!el || dragging.current) return;
      updatePos(snapPos(currentSnap, el.offsetWidth, el.offsetHeight));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [currentSnap]);

  /* ── editor tab events ── */
  useEffect(() => {
    function onTabChange(e: Event) {
      const tab = (e as CustomEvent<string>).detail;
      setEditorTab(typeof tab === "string" ? tab : null);
    }
    window.addEventListener("bdv-editor-tab", onTabChange);
    return () => window.removeEventListener("bdv-editor-tab", onTabChange);
  }, []);

  useEffect(() => {
    if (!location.startsWith("/video-editor")) setEditorTab(null);
  }, [location]);

  /* ── drag handlers ── */
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button,input")) return;
    dragging.current = true;
    setIsDragging(true);
    cancelHideTimer();
    setIsHidden(false);
    const el = elRef.current!;
    const rect = el.getBoundingClientRect();
    startPtr.current = { px: e.clientX, py: e.clientY, ex: rect.left, ey: rect.top };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const el = elRef.current!;
    const w = el.offsetWidth, h = el.offsetHeight;
    const { px, py, ex, ey } = startPtr.current;
    const half = SNAP_M / 2;
    updatePos({
      x: Math.max(half, Math.min(window.innerWidth  - w - half, ex + e.clientX - px)),
      y: Math.max(half, Math.min(window.innerHeight - h - half, ey + e.clientY - py)),
    });
  }

  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    const el = elRef.current!;
    const pt = nearestSnap(posRef.current.x, posRef.current.y, el.offsetWidth, el.offsetHeight);
    snapTo(pt, el.offsetWidth, el.offsetHeight);
    startHideTimer();
  }

  function onMouseEnter() {
    cancelHideTimer();
    setIsHidden(false);
  }

  function onMouseLeave() {
    if (!dragging.current) startHideTimer();
  }

  /* ── open/close ── */
  function toggleOpen() {
    const next = !open;
    saveOpen(next);
    setOpen(next);
    // re-snap after next tick when size has settled
    requestAnimationFrame(() => {
      const el = elRef.current;
      if (!el) return;
      updatePos(snapPos(currentSnap, el.offsetWidth, el.offsetHeight));
    });
    cancelHideTimer();
    startHideTimer();
  }

  /* ── transitions ── */
  const transition = [
    isSnapping
      ? "left 0.30s cubic-bezier(0.34,1.56,0.64,1), top 0.30s cubic-bezier(0.34,1.56,0.64,1)"
      : "",
    "transform 0.32s cubic-bezier(0.34,1.56,0.64,1)",
    "opacity 0.20s ease",
  ].filter(Boolean).join(", ");

  const helpKey = keyFromPath(location, editorTab);
  const guide   = GUIDES[helpKey] ?? GUIDES["dashboard"];

  return (
    <>
      <style>{`
        @keyframes bdvEq0 { from{height:2px} to{height:7px} }
        @keyframes bdvEq1 { from{height:4px} to{height:7px} }
        @keyframes bdvEq2 { from{height:7px} to{height:2px} }
        @keyframes bdvEq3 { from{height:3px} to{height:7px} }
      `}</style>

      <div
        ref={elRef}
        style={{
          position:         "fixed",
          left:             pos.x,
          top:              pos.y,
          zIndex:           9990,
          width:            open ? 300 : "auto",
          maxHeight:        open ? "min(72vh, 580px)" : "auto",
          display:          "flex",
          flexDirection:    "column",
          transform:        isHidden ? slideXform(currentSnap) : "none",
          transition,
          touchAction:      "none",
          userSelect:       "none",
          WebkitUserSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Gold peek tab — visible only when auto-hidden */}
        <div
          style={{
            ...peekStyle(currentSnap),
            opacity:    isHidden ? 1 : 0,
            transition: "opacity 0.20s ease",
          }}
          aria-hidden="true"
        />

        {/* Drag grip */}
        <div
          style={{
            display:        "flex",
            justifyContent: "center",
            alignItems:     "center",
            paddingBottom:  2,
            cursor:         isDragging ? "grabbing" : "grab",
            opacity:        isHidden ? 0 : 1,
            transition:     "opacity 0.15s ease",
          }}
          title="Drag to move — snaps to 8 positions"
        >
          <GripHorizontal size={13} style={{ color: "rgba(218,165,32,0.40)" }} />
        </div>

        {/* ── Expanded panel ── */}
        {open && (
          <div
            className="flex flex-col rounded-2xl border shadow-2xl overflow-hidden"
            style={{
              background:     "rgba(6,6,6,0.96)",
              backdropFilter: "blur(20px)",
              borderColor:    "rgba(218,165,32,0.18)",
              maxHeight:      "min(72vh, 560px)",
              position:       "relative",
            }}
          >
            {/* Snap dots indicator */}
            <SnapDots current={currentSnap} />

            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 shrink-0"
              style={{ borderBottom: "1px solid rgba(218,165,32,0.12)" }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    background: "linear-gradient(135deg,rgba(155,117,21,0.6),rgba(218,165,32,0.3))",
                    border:     "1px solid rgba(218,165,32,0.30)",
                  }}
                >
                  <Bot className="h-3.5 w-3.5 text-yellow-400" />
                </div>
                <div>
                  <p className="text-[11px] font-black text-white leading-none">Bow Down AI Guide</p>
                  <p className="text-[9px] text-yellow-400/50 leading-none mt-0.5">
                    {SNAP_LABELS[currentSnap]} · active ✓
                  </p>
                </div>
              </div>
              <button
                onClick={toggleOpen}
                className="flex items-center justify-center h-6 w-6 rounded-lg border border-white/10 bg-white/[0.04] text-white/40 hover:text-white hover:border-white/20 transition-colors"
                aria-label="Minimize guide"
              >
                <Minimize2 className="h-3 w-3" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

              <ThemePlayerRow />

              <div style={{ height: 1, background: "rgba(255,255,255,0.05)" }} />

              {/* Page guide */}
              <div className="space-y-3">
                <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">{guide.title}</p>
                <div className="space-y-3">
                  {guide.steps.map((step) => (
                    <div key={step.n} className="flex gap-3">
                      <div
                        className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 mt-0.5"
                        style={{ background: "rgba(218,165,32,0.12)", border: "1px solid rgba(218,165,32,0.25)", color: "rgba(218,165,32,0.90)" }}
                      >
                        {step.n}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white/80 leading-tight">{step.title}</p>
                        <p className="text-[11px] text-white/40 mt-0.5 leading-relaxed">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {guide.tips && guide.tips.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5" style={{ color: "rgba(218,165,32,0.45)" }}>
                    <Zap className="h-3 w-3" /> Tips
                  </p>
                  {guide.tips.map((tip, i) => (
                    <div key={i} className="flex gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <ChevronRight className="h-3 w-3 shrink-0 mt-0.5" style={{ color: "rgba(218,165,32,0.45)" }} />
                      <p className="text-[11px] text-white/50 leading-relaxed">{tip}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Status */}
              <div
                className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 rounded-xl text-[10px] font-mono"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
              >
                <span className="text-white/25">Guide: <span className="text-green-400/70">active ✓</span></span>
                <span className="text-white/25">Theme song: <span className={loaded ? "text-green-400/70" : "text-white/25"}>{loaded ? "loaded ✓" : "loading…"}</span></span>
                <span className="text-white/25">Playing: <span className={playing ? "text-green-400/70" : "text-white/25"}>{playing ? "yes" : "no"}</span></span>
                <span className="text-white/25">Muted: <span className={muted ? "text-amber-400/70" : "text-white/25"}>{muted ? "yes" : "no"}</span></span>
                <span className="text-white/25">Snap: <span className="text-yellow-400/50">{SNAP_LABELS[currentSnap]}</span></span>
              </div>

            </div>
          </div>
        )}

        {/* ── Collapsed pill ── */}
        {!open && (
          <div
            style={{
              position: "relative",
              opacity:  isHidden ? 0 : 1,
              transition: "opacity 0.15s ease",
            }}
          >
            {/* Snap dots on pill */}
            <SnapDots current={currentSnap} />

            <button
              onClick={toggleOpen}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl shadow-2xl"
              style={{
                background:     "rgba(6,6,6,0.92)",
                border:         "1px solid rgba(218,165,32,0.28)",
                backdropFilter: "blur(16px)",
                boxShadow:      "0 0 20px rgba(218,165,32,0.12), 0 4px 24px rgba(0,0,0,0.60)",
                cursor:         isDragging ? "grabbing" : "pointer",
              }}
              aria-label="Open Bow Down AI Guide"
            >
              <div
                className="h-6 w-6 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "linear-gradient(135deg,rgba(155,117,21,0.7),rgba(218,165,32,0.4))", border: "1px solid rgba(218,165,32,0.35)" }}
              >
                <Bot className="h-3.5 w-3.5 text-yellow-400" />
              </div>
              <span className="text-[11px] font-black text-white whitespace-nowrap">Bow Down AI Guide</span>
              {playing && (
                <div className="flex items-end gap-[1.5px]" style={{ height: 8 }}>
                  {[0,1,2,3].map((i) => (
                    <div key={i} style={{
                      width: 2, borderRadius: 1,
                      background: "linear-gradient(to top,#9B7515,#FFD700)",
                      height: 8,
                      animation: `bdvEq${i} 0.6s ease-in-out ${i * 0.1}s infinite alternate`,
                    }} />
                  ))}
                </div>
              )}
              <ChevronUp className="h-3.5 w-3.5 text-yellow-400/60 shrink-0" />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
