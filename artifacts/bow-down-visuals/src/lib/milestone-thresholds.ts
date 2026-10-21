/* ─── Milestone thresholds + brag helpers ────────────────────────────────────
   Client mirror of the server's cross-vertical brag ladder (streams,
   followers, earnings, releases). The server returns fully-formed
   achievements; this module adds display meta, tier colors, and the
   share captions that carry the virality loop. */

export type MilestoneVertical = "streams" | "followers" | "earnings" | "releases";

export interface MilestoneAchievement {
  vertical: MilestoneVertical;
  threshold: number;
  tier: string;
  tierLabel: string;
  /** The creator's actual current value for this vertical/track. */
  value: number;
  /** Big number for the brag card, e.g. "10,000" / "$1,240". */
  displayValue: string;
  /** Human line, e.g. "10,000 streams" / "$100 earned". */
  headline: string;
  /** Track · platform for streams; scope note for the rest. */
  context: string;
  milestoneId?: string;
  achievedAt?: string | null;
}

export const VERTICAL_META: Record<
  MilestoneVertical,
  { label: string; unit: string; emoji: string }
> = {
  streams: { label: "Streams", unit: "STREAMS", emoji: "🎵" },
  followers: { label: "Followers", unit: "FOLLOWERS", emoji: "👥" },
  earnings: { label: "Earnings", unit: "EARNED", emoji: "💰" },
  releases: { label: "Releases", unit: "RELEASES", emoji: "💿" },
};

/* Mirror of the server's AWARD_STEPS — for per-row brag buttons without a
   round-trip. */
export const STREAMS_LADDER: Array<{ at: number; tier: string; tierLabel: string }> = [
  { at: 1_000, tier: "bronze", tierLabel: "Bronze" },
  { at: 10_000, tier: "silver", tierLabel: "Silver" },
  { at: 100_000, tier: "gold", tierLabel: "Gold" },
  { at: 1_000_000, tier: "platinum", tierLabel: "Platinum" },
  { at: 10_000_000, tier: "diamond", tierLabel: "Diamond" },
];

export function highestStreamStep(streams: number): (typeof STREAMS_LADDER)[number] | null {
  let hit: (typeof STREAMS_LADDER)[number] | null = null;
  for (const step of STREAMS_LADDER) {
    if (streams >= step.at) hit = step;
  }
  return hit;
}

const TIER_COLORS: Record<string, string> = {
  bronze: "#cd7f32",
  silver: "#c0c0c0",
  gold: "#d4af37",
  platinum: "#e5e4e2",
  diamond: "#b9f2ff",
  rising: "#d4af37",
  buzzing: "#e8c86a",
  established: "#f6d47c",
  star: "#ffd700",
  superstar: "#fff7cc",
  "first-hundred": "#d4af37",
  "one-k": "#e8c86a",
  "ten-k": "#f6d47c",
  "six-figures": "#ffd700",
  millionaire: "#fff7cc",
  debut: "#d4af37",
  "catalog-5": "#e8c86a",
  "catalog-10": "#f6d47c",
  "catalog-25": "#ffd700",
  "catalog-50": "#fff7cc",
};

export function tierColor(tier: string): string {
  return TIER_COLORS[tier] ?? "#d4af37";
}

/** Build a brag-ready achievement from a raw milestone history row. */
export function achievementFromMilestoneRow(row: {
  id: string;
  trackTitle: string;
  platform: string;
  streamCount: number;
  awardTier: string;
}): MilestoneAchievement | null {
  const step = highestStreamStep(row.streamCount);
  if (!step) return null;
  const full = Math.floor(step.at).toLocaleString("en-US");
  return {
    vertical: "streams",
    threshold: step.at,
    tier: step.tier,
    tierLabel: step.tierLabel,
    value: row.streamCount,
    displayValue: full,
    headline: `${full} streams`,
    context: `${row.trackTitle} · ${row.platform}`,
    milestoneId: row.id,
  };
}

/* ─── Share copy — the loop: milestone → brag → followers see the brand ─── */

const SITE = "bowdownvisuals.com";

function firstLine(a: MilestoneAchievement): string {
  switch (a.vertical) {
    case "streams":
      return `I just hit ${a.headline} on "${a.context.split(" · ")[0]}" 🏆`;
    case "followers":
      return `I just hit ${a.headline} ${VERTICAL_META.followers.emoji}`;
    case "earnings":
      return `I just crossed ${a.headline} ${VERTICAL_META.earnings.emoji}`;
    case "releases":
      return `${a.headline === "First release out" ? "My first release is out" : `I just dropped my ${a.displayValue}th release`} ${VERTICAL_META.releases.emoji}`;
  }
}

/** Caption tuned for X / IG / TikTok paste. */
export function bragCaption(a: MilestoneAchievement): string {
  return [
    firstLine(a),
    "",
    "Every win counts. I track mine on Bow Down Visuals — free to start.",
    "",
    SITE,
    "",
    "#BowDownVisuals #Milestone #IndieArtist #CreatorEconomy",
  ].join("\n");
}

/** Shorter body for a BDV feed post (500-char cap). */
export function feedPostBody(a: MilestoneAchievement): string {
  const body = [
    firstLine(a),
    "",
    `Milestone unlocked: ${a.tierLabel} — tracked free on Bow Down Visuals. What's your next win?`,
    "",
    `#Milestone #${a.tierLabel.replace(/[^a-zA-Z]/g, "")}`,
  ].join("\n");
  return body.slice(0, 500);
}

export function bragFileName(a: MilestoneAchievement): string {
  return `bdv-milestone-${a.vertical}-${a.threshold}.png`;
}
