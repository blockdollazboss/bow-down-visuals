/**
 * Promoter ladder titles (stack1400 ruling — Charts OD1).
 *
 * The Promoter ladder (PROMOTER_TIERS in routes/referrals) once reused
 * Creator Rank names at ★2 "Hustler", ★3 "Shot Caller" and ★5
 * "Kingpin", so a referral badge read as an earned creator rank. The
 * ruled ladder is its own set of names. These pins hold:
 *   1. the exact Promoter titles, in star order;
 *   2. NO Promoter title ever intersects the Creator Rank titles
 *      (STAR_TITLES in lib/creator-rank);
 *   3. the Creator Rank ladder itself is untouched by the rename.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({}),
  addCreditsToProfile: vi.fn(async () => ({ oldCredits: 0, newCredits: 0, created: false })),
}));

import { PROMOTER_TIERS } from "../referrals";
import { STAR_TITLES } from "../../lib/creator-rank";

describe("Promoter ladder titles", () => {
  it("is exactly the ruled ladder, in star order", () => {
    expect(PROMOTER_TIERS.map((t) => t.stars)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(PROMOTER_TIERS.map((t) => t.title)).toEqual([
      "Street Soldier",
      "Connector",
      "Rainmaker",
      "Big Boss",
      "Mogul",
      "The Don",
    ]);
  });

  it("never intersects the Creator Rank titles", () => {
    const creatorTitles = new Set(STAR_TITLES.map((t) => t.toLowerCase()));
    const collisions = PROMOTER_TIERS.map((t) => t.title).filter((t) =>
      creatorTitles.has(t.toLowerCase()),
    );
    expect(collisions).toEqual([]);
  });

  it("leaves the Creator Rank ladder itself unchanged", () => {
    expect([...STAR_TITLES]).toEqual([
      "Street Punk",
      "Hustler",
      "Gangster",
      "Shot Caller",
      "Crime Boss",
      "Kingpin",
    ]);
  });
});
