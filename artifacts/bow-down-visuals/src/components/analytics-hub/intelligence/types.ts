/* ─── Content Intelligence chain — shared types ──────────────────────────
   One guided flow: Validate Idea → Hook Lab → Niche Check →
   Competitor Gaps → Content Calendar → Plan Review. Every step reads and
   writes the same IntelContext so nothing is ever re-typed. */

export type IntelPlatform = "tiktok" | "instagram" | "youtube" | "x";

/** The single context object every step shares. */
export interface IntelContext {
  /** The working idea text — chosen/edited in Step 1. */
  idea: string;
  /** Creator's niche — set in Step 1, reused by Steps 3-5. */
  niche: string;
  /** Target audience — optional, sharpens every AI call. */
  audience: string;
  /** Target platform — shared across steps. */
  platform: IntelPlatform;
  /** The winning hook — chosen in Step 2, feeds Steps 4-5 and handoffs. */
  hook: string;
}

export interface ScoreBreakdown {
  label: string;
  score: number;
  reasoning: string;
}

export interface ValidateVerdict {
  verdict: "go" | "pivot" | "no-go";
  overallScore: number;
  scores: {
    virality: ScoreBreakdown;
    competition: ScoreBreakdown;
    audienceFit: ScoreBreakdown;
  };
  strengths: string[];
  risks: string[];
  pivots: { angle: string; whyItWorks: string }[];
  summary: string;
}

export interface HookAnalysis {
  curiosityGap: number;
  patternInterrupt: number;
  clarity: number;
  overallScore: number;
  verdict: string;
  weaknesses: string[];
  rewrittenHook: string;
  rewriteNotes: string[];
  alternativeHooks: string[];
}

export interface NicheGap {
  angle: string;
  whyUnderserved: string;
  opportunity: string;
}

export interface NicheMonetization {
  path: string;
  fitScore: number;
  why: string;
  firstStep: string;
}

export interface NicheAnalysis {
  niche: string;
  targetPlatform: string;
  experienceLevel: string;
  audienceProfile: { demographics: string; interests: string[] };
  contentGaps: NicheGap[];
  monetizationPaths: NicheMonetization[];
  competitionLevel: { score: number; label: string };
  contentPillars: { name: string; description: string; exampleIdeas: string[] }[];
  summary: string;
}

export interface CompetitorOpportunity {
  gap: string;
  howToExploit: string;
}

export interface CompetitorAnalysis {
  competitorName: string;
  niche: string;
  contentPillars: { pillar: string; whatTheyPost: string }[];
  postingCadence: { assessment: string; estimatedPostsPerWeek: number | null };
  topFormats: { format: string; whyItWorks: string }[];
  strengths: string[];
  weaknesses: string[];
  opportunities: CompetitorOpportunity[];
  takeaways: string[];
  disclaimer: string;
}

export type CalendarPlatform = "tiktok" | "youtube" | "instagram";

export interface CalendarDay {
  date: string;
  dayLabel: string;
  post: boolean;
  title: string;
  format: string;
  platform: string;
  hook: string;
  bestTime: string;
}

/** Everything the plan review needs. */
export interface IntelResults {
  validate: ValidateVerdict | null;
  hook: HookAnalysis | null;
  niche: NicheAnalysis | null;
  competitor: CompetitorAnalysis | null;
  calendar: CalendarDay[] | null;
}

export const INTEL_PLATFORMS: { id: IntelPlatform; labelKey: string }[] = [
  { id: "tiktok", labelKey: "contentIntelligence.platformTikTok" },
  { id: "instagram", labelKey: "contentIntelligence.platformInstagram" },
  { id: "youtube", labelKey: "contentIntelligence.platformYouTube" },
  { id: "x", labelKey: "contentIntelligence.platformX" },
];

export const INTEL_PLATFORM_LABELS: Record<IntelPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
};
