import type { PageGuide } from "./types";

export const videoEditorGuide: PageGuide = {
  route: "/video-editor",
  pageName: "Video Editor",
  summary:
    "A full timeline editor in your browser — arrange clips, add captions and transitions, then export your finished video.",
  steps: [
    {
      target: '[aria-label="Editor sections"]',
      title: "Your editing toolkit",
      body: "This is a real video editor, not a toy. The left rail holds your sections — media, text, captions, transitions, audio. Everything you need to cut a finished video lives here.",
      tip: "Work left to right: import media first, then cut, then captions, then export.",
      askPrompt: "How do I edit my video clips together?",
    },
    {
      target: '[aria-label="Start preview"]',
      title: "Preview anytime",
      body: "The preview player shows your timeline as it will export. Scrub through, check your cuts, and watch captions land before you commit to an export.",
      tip: "Watch the whole thing at full speed once before exporting — you'll catch timing issues your eyes miss while scrubbing.",
    },
    {
      target: '[aria-label="Inspector"]',
      title: "The Inspector",
      body: "Select any clip and the Inspector shows its controls — trim, speed, volume, effects. This is where fine-tuning happens.",
      tip: "Small trims make the biggest difference — cut 5 frames off every clip start and your edit instantly feels tighter.",
    },
    {
      targetText: "Export",
      title: "Export your video",
      body: "When the cut is locked, export your finished video. Pick your format — 16:9 for YouTube, 9:16 for TikTok and Reels.",
      tip: "Export 9:16 versions of everything — that's where the views are.",
    },
  ],
};
