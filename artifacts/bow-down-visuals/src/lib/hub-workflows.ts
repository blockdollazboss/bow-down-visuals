import {
  Drum, Scissors, Disc3, Clapperboard, Megaphone, Lightbulb, PenLine,
  Mic2, Film, Image as ImageIcon, ShieldCheck, Palette, FlaskConical,
  type LucideIcon,
} from "lucide-react";
import type { HubAssetKind, HubProjectType } from "./hub-project";

/* ─── Project-type workflows ───────────────────────────────────────────────
   One hub, many crafts. The project's type decides the chain: a song flows
   Beat → Stems → Song → Video → Promo; a video flows Hook → Script →
   Voiceover → Clips → Thumbnail; a visual package flows Vault → Thumbnail →
   Cover → Brand → Test. Every step feeds the next — that's the whole point. */

export interface WorkflowStep {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Which asset kind marks this step done (null = launcher only). */
  assetKind: HubAssetKind | null;
  href: string;
  blurb: string;
  creditNote: string;
  /** Inline module rendered in the hub stage instead of a launcher card. */
  embed?: "beat-maker";
}

export interface ProjectWorkflow {
  type: HubProjectType;
  title: string;
  tagline: string;
  icon: LucideIcon;
  steps: WorkflowStep[];
}

export const PROJECT_WORKFLOWS: ProjectWorkflow[] = [
  {
    type: "song",
    title: "Song",
    tagline: "Beat → stems → song → video → promo. The full record, start to finish.",
    icon: Disc3,
    steps: [
      { key: "beat", label: "Beat", icon: Drum, assetKind: "beat", href: "/hub",
        blurb: "AI-generate an instrumental or program drums on the step sequencer.",
        creditNote: "3 credits · sequencer free", embed: "beat-maker" },
      { key: "stems", label: "Stems", icon: Scissors, assetKind: "stems", href: "/stems",
        blurb: "Split any audio into vocals, drums, bass, and melody stems.",
        creditNote: "4 credits" },
      { key: "song", label: "Song", icon: Disc3, assetKind: "song", href: "/make-song",
        blurb: "Turn the beat into a full song with AI vocals and arrangement.",
        creditNote: "4 credits" },
      { key: "video", label: "Video", icon: Clapperboard, assetKind: "video", href: "/make-video",
        blurb: "Generate the music video — scenes, lip sync, full edit.",
        creditNote: "from 4 credits" },
      { key: "promo", label: "Promo", icon: Megaphone, assetKind: "clip", href: "/promo-clip",
        blurb: "Cut promo clips, make the thumbnail, ship it everywhere.",
        creditNote: "from 1 credit" },
    ],
  },
  {
    type: "video",
    title: "Video",
    tagline: "Hook → script → voiceover → clips → thumbnail. Content that stops the scroll.",
    icon: Clapperboard,
    steps: [
      { key: "hook", label: "Hook", icon: Lightbulb, assetKind: null, href: "/hooks",
        blurb: "Generate hooks engineered to stop the scroll in the first 3 seconds.",
        creditNote: "1 credit" },
      { key: "script", label: "Script", icon: PenLine, assetKind: null, href: "/script-writer",
        blurb: "Turn the hook into a full script — pacing, beats, and CTAs included.",
        creditNote: "1 credit" },
      { key: "voiceover", label: "Voiceover", icon: Mic2, assetKind: "song", href: "/voiceover",
        blurb: "AI voiceover in your locked voice, timed to the script.",
        creditNote: "2 credits" },
      { key: "clips", label: "Clips", icon: Film, assetKind: "clip", href: "/promo-clip",
        blurb: "Cut the video into platform-ready clips — vertical, captioned, posted.",
        creditNote: "from 1 credit" },
      { key: "thumbnail", label: "Thumbnail", icon: ImageIcon, assetKind: "thumbnail", href: "/thumbnail-maker",
        blurb: "The thumbnail that gets the click — then A/B test it.",
        creditNote: "2 credits" },
    ],
  },
  {
    type: "visual",
    title: "Visuals & Brand",
    tagline: "Vault → thumbnail → cover → brand → test. The look, locked and shipped.",
    icon: Palette,
    steps: [
      { key: "vault", label: "Identity", icon: ShieldCheck, assetKind: null, href: "/artist-vault",
        blurb: "Lock your look in the Creator Vault — face, style, and rules AI must never break.",
        creditNote: "free" },
      { key: "thumbnail", label: "Thumbnail", icon: ImageIcon, assetKind: "thumbnail", href: "/thumbnail-maker",
        blurb: "Scroll-stopping thumbnails in your locked identity.",
        creditNote: "2 credits" },
      { key: "cover", label: "Cover Art", icon: Disc3, assetKind: "image", href: "/cover-art",
        blurb: "Single and album artwork with art direction that matches the music.",
        creditNote: "2–3 credits" },
      { key: "brand", label: "Brand Kit", icon: Palette, assetKind: null, href: "/branding-kit",
        blurb: "Logos, intros, outros, and stream assets in one consistent brand.",
        creditNote: "varies" },
      { key: "test", label: "A/B Test", icon: FlaskConical, assetKind: null, href: "/thumbnail-test",
        blurb: "Let the data pick the winner before you publish.",
        creditNote: "1 credit" },
    ],
  },
];

export function getWorkflow(type: HubProjectType): ProjectWorkflow {
  return PROJECT_WORKFLOWS.find((w) => w.type === type) ?? PROJECT_WORKFLOWS[0]!;
}

/* ─── Shared asset language ─────────────────────────────────────────────── */

export const KIND_LABEL: Record<HubAssetKind, string> = {
  beat: "Beat", stems: "Stems", song: "Song", video: "Video",
  clip: "Clip", thumbnail: "Thumbnail", image: "Image", other: "Asset",
};

export const AUDIO_KINDS: HubAssetKind[] = ["beat", "song", "stems", "clip"];

/* Where each finished asset naturally wants to go next. */
export const NEXT_STEPS: Record<HubAssetKind, { label: string; href: string }[]> = {
  beat: [
    { label: "Split into stems", href: "/stems" },
    { label: "Make it a song", href: "/make-song" },
  ],
  stems: [{ label: "Make it a song", href: "/make-song" }],
  song: [
    { label: "Make the video", href: "/make-video" },
    { label: "Cut a promo clip", href: "/promo-clip" },
  ],
  video: [
    { label: "Cut a promo clip", href: "/promo-clip" },
    { label: "Make a thumbnail", href: "/thumbnail-maker" },
  ],
  clip: [
    { label: "Make a thumbnail", href: "/thumbnail-maker" },
    { label: "Post it", href: "/promo-clip" },
  ],
  thumbnail: [
    { label: "A/B test it", href: "/thumbnail-test" },
    { label: "Cut a promo clip", href: "/promo-clip" },
  ],
  image: [
    { label: "Make the video", href: "/make-video" },
    { label: "Make a thumbnail", href: "/thumbnail-maker" },
  ],
  other: [],
};
