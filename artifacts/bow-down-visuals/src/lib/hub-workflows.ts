import {
  Drum, Scissors, Disc3, Clapperboard, Megaphone, Lightbulb, PenLine,
  Mic2, Film, Image as ImageIcon, ShieldCheck, Palette, FlaskConical,
  Users, MapPin, Copyright, Rocket, ListChecks, CalendarDays, Coins,
  TrendingUp, BarChart3, GraduationCap, BookOpen, Scale, Briefcase,
  FileText, Newspaper, Mail, Handshake, Store, Banknote, Shirt, Flame,
  Type as TypeIcon,
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
  embed?: "beat-maker" | "thumbnail-maker";
}

export type HubFamily = "create" | "launch" | "grow" | "monetize" | "learn" | "business";

export const FAMILIES: { key: HubFamily; label: string; blurb: string }[] = [
  { key: "create", label: "Create", blurb: "Make the thing" },
  { key: "launch", label: "Launch", blurb: "Ship it right" },
  { key: "grow", label: "Grow", blurb: "Get seen" },
  { key: "monetize", label: "Monetize", blurb: "Get paid" },
  { key: "learn", label: "Learn", blurb: "Level up" },
  { key: "business", label: "Business", blurb: "Handle the paperwork" },
];

export interface ProjectWorkflow {
  type: HubProjectType;
  family: HubFamily;
  title: string;
  tagline: string;
  icon: LucideIcon;
  steps: WorkflowStep[];
}

export const PROJECT_WORKFLOWS: ProjectWorkflow[] = [
  {
    type: "song",
    family: "create",
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
    family: "create",
    title: "Video",
    tagline: "Hook → script → voiceover → clips → thumbnail. Content that stops the scroll.",
    icon: Clapperboard,
    steps: [
      { key: "hook", label: "Hook", icon: Lightbulb, assetKind: null, href: "/hooks",
        blurb: "Generate hooks engineered to stop the scroll in the first 3 seconds.",
        creditNote: "1 credit" },
      { key: "script", label: "Script", icon: PenLine, assetKind: "script", href: "/script-writer",
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
        creditNote: "2 credits", embed: "thumbnail-maker" },
    ],
  },
  {
    type: "visual",
    family: "create",
    title: "Visuals & Brand",
    tagline: "Vault → thumbnail → cover → brand → test. The look, locked and shipped.",
    icon: Palette,
    steps: [
      { key: "vault", label: "Identity", icon: ShieldCheck, assetKind: null, href: "/artist-vault",
        blurb: "Lock your look in the Creator Vault — face, style, and rules AI must never break.",
        creditNote: "free" },
      { key: "thumbnail", label: "Thumbnail", icon: ImageIcon, assetKind: "thumbnail", href: "/thumbnail-maker",
        blurb: "Scroll-stopping thumbnails in your locked identity.",
        creditNote: "2 credits", embed: "thumbnail-maker" },
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
  {
    type: "movie",
    family: "create",
    title: "Movie",
    tagline: "Idea → script → cast → locations → scenes → dialogue → score → edit → premiere. The whole production, one step after the other.",
    icon: Film,
    steps: [
      { key: "idea", label: "Idea", icon: Lightbulb, assetKind: null, href: "/randomizer",
        blurb: "The spark — concept, title, and logline for your film.",
        creditNote: "free" },
      { key: "script", label: "Script", icon: PenLine, assetKind: "script", href: "/script-writer",
        blurb: "The full screenplay — beats, dialogue, and pacing.",
        creditNote: "2 credits" },
      { key: "cast", label: "Cast", icon: Users, assetKind: null, href: "/artist-vault",
        blurb: "Lock your characters' faces so the AI never recasts them mid-film.",
        creditNote: "free" },
      { key: "locations", label: "Locations", icon: MapPin, assetKind: null, href: "/locations",
        blurb: "Scout and lock every set before cameras roll.",
        creditNote: "free" },
      { key: "scenes", label: "Scenes", icon: Clapperboard, assetKind: "video", href: "/make-video",
        blurb: "Generate every scene — storyboard to final frame.",
        creditNote: "from 4 credits" },
      { key: "dialogue", label: "Dialogue", icon: Mic2, assetKind: "song", href: "/voiceover",
        blurb: "Every line delivered, in every character's own voice.",
        creditNote: "2 credits" },
      { key: "score", label: "Score", icon: Drum, assetKind: "beat", href: "/hub",
        blurb: "The soundtrack — AI-composed or programmed to picture.",
        creditNote: "3 credits · sequencer free", embed: "beat-maker" },
      { key: "edit", label: "Edit", icon: Scissors, assetKind: null, href: "/video-editor",
        blurb: "The final cut — scenes, dialogue, and score assembled.",
        creditNote: "4 credits" },
      { key: "premiere", label: "Premiere", icon: Megaphone, assetKind: "clip", href: "/promo-clip",
        blurb: "Trailer, poster, and the big launch.",
        creditNote: "from 1 credit" },
    ],
  },
  {
    type: "release",
    family: "launch",
    title: "Release",
    tagline: "Protect it, ship it, promote it, get paid — the whole paperwork walkthrough, in order.",
    icon: Rocket,
    steps: [
      { key: "protect", label: "Protect", icon: Copyright, assetKind: null, href: "/copyright",
        blurb: "Register your ownership before anything goes public.",
        creditNote: "free · 1 credit AI draft" },
      { key: "distribute", label: "Distribute", icon: Rocket, assetKind: null, href: "/distribute",
        blurb: "Ship your song to Spotify, Apple Music, and everywhere else.",
        creditNote: "from 1 credit" },
      { key: "plan", label: "Release Plan", icon: ListChecks, assetKind: null, href: "/release-checklist",
        blurb: "Your AI-built week-by-week launch plan.",
        creditNote: "2 credits" },
      { key: "promos", label: "Promos", icon: Megaphone, assetKind: "clip", href: "/promo-clip",
        blurb: "Clips, teasers, and trailers cut from your project.",
        creditNote: "from 1 credit" },
      { key: "schedule", label: "Schedule", icon: CalendarDays, assetKind: null, href: "/scheduler",
        blurb: "Line up every post across your channels.",
        creditNote: "1 credit/post" },
      { key: "monetize", label: "Monetize", icon: Coins, assetKind: null, href: "/coach",
        blurb: "Turn the release into revenue — pricing, sponsors, strategy.",
        creditNote: "1 credit" },
    ],
  },
  {
    type: "grow",
    family: "grow",
    title: "Audience",
    tagline: "Get seen — hooks, content, and the numbers that tell you what's working.",
    icon: TrendingUp,
    steps: [
      { key: "hooks", label: "Hooks", icon: Flame, assetKind: null, href: "/hooks",
        blurb: "Hooks that stop the scroll in the first three seconds.",
        creditNote: "1 credit" },
      { key: "titles", label: "Titles", icon: TypeIcon, assetKind: null, href: "/titles",
        blurb: "Titles people actually click.",
        creditNote: "1 credit" },
      { key: "calendar", label: "Content Plan", icon: CalendarDays, assetKind: null, href: "/content-calendar",
        blurb: "A month of content, planned in minutes.",
        creditNote: "1 credit" },
      { key: "virality", label: "Virality Check", icon: FlaskConical, assetKind: null, href: "/virality-check",
        blurb: "Pre-flight check before you post.",
        creditNote: "2 credits" },
      { key: "trends", label: "Trends", icon: TrendingUp, assetKind: null, href: "/trends",
        blurb: "Ride what's blowing up right now.",
        creditNote: "2 credits" },
      { key: "analytics", label: "Analytics", icon: BarChart3, assetKind: null, href: "/analytics",
        blurb: "See what's working — then double down.",
        creditNote: "free" },
    ],
  },
  {
    type: "monetize",
    family: "monetize",
    title: "Money",
    tagline: "Get paid — sponsors, deals, royalties, merch, and your own shop.",
    icon: Coins,
    steps: [
      { key: "strategy", label: "Strategy", icon: Coins, assetKind: null, href: "/coach",
        blurb: "Your money gameplan, built around your content.",
        creditNote: "1 credit" },
      { key: "sponsors", label: "Sponsors", icon: Handshake, assetKind: null, href: "/sponsors",
        blurb: "Get brands paying you to create.",
        creditNote: "5 credits/listing" },
      { key: "deals", label: "Brand Deals", icon: Briefcase, assetKind: null, href: "/brand-deals",
        blurb: "Find and pitch brand deals that fit your niche.",
        creditNote: "2 credits/search" },
      { key: "royalties", label: "Royalties", icon: Banknote, assetKind: null, href: "/royalties",
        blurb: "Track every dollar your music earns.",
        creditNote: "1 credit" },
      { key: "merch", label: "Merch", icon: Shirt, assetKind: null, href: "/merch",
        blurb: "Merch designed by AI, sold by you.",
        creditNote: "3 credits/batch" },
      { key: "shop", label: "My Shop", icon: Store, assetKind: null, href: "/my-shop",
        blurb: "Your own storefront on your own terms.",
        creditNote: "1 credit" },
    ],
  },
  {
    type: "learn",
    family: "learn",
    title: "Knowledge",
    tagline: "Level up — courses, playbooks, and the legal basics every creator needs.",
    icon: GraduationCap,
    steps: [
      { key: "academy", label: "Academy", icon: GraduationCap, assetKind: null, href: "/academy",
        blurb: "Courses that level you up as a creator.",
        creditNote: "1 credit" },
      { key: "guides", label: "Guides", icon: BookOpen, assetKind: null, href: "/guides",
        blurb: "Playbooks for every platform.",
        creditNote: "free" },
      { key: "llc", label: "LLC Setup", icon: Scale, assetKind: null, href: "/llc-guide",
        blurb: "Set up your business the right way.",
        creditNote: "free" },
      { key: "copyright", label: "Copyright", icon: Copyright, assetKind: null, href: "/copyright",
        blurb: "Own your work, legally — from day one.",
        creditNote: "free · 1 credit AI draft" },
    ],
  },
  {
    type: "business",
    family: "business",
    title: "Paperwork",
    tagline: "Handle the paperwork — LLC, contracts, press kit, and your audience list.",
    icon: Briefcase,
    steps: [
      { key: "llc", label: "LLC", icon: Scale, assetKind: null, href: "/llc-guide",
        blurb: "Form your LLC the right way, step by step.",
        creditNote: "free" },
      { key: "contracts", label: "Contracts", icon: FileText, assetKind: null, href: "/contracts",
        blurb: "Contracts that protect you on every deal.",
        creditNote: "3 credits" },
      { key: "presskit", label: "Press Kit", icon: Newspaper, assetKind: null, href: "/press-kit",
        blurb: "Look legit to press, brands, and bookers.",
        creditNote: "3 credits" },
      { key: "emaillist", label: "Email List", icon: Mail, assetKind: null, href: "/email-list",
        blurb: "Own your audience — no algorithm required.",
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
  clip: "Clip", thumbnail: "Thumbnail", image: "Image", script: "Script", other: "Asset",
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
    { label: "Plan the release", href: "/release-checklist" },
  ],
  video: [
    { label: "Edit the final cut", href: "/video-editor" },
    { label: "Cut a promo clip", href: "/promo-clip" },
    { label: "Make a thumbnail", href: "/thumbnail-maker" },
    { label: "Plan the release", href: "/release-checklist" },
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
  script: [{ label: "Voice it", href: "/voiceover" }],
  other: [],
};
