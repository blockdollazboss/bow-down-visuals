/**
 * Live social-proof sync (C5) — pure shaping law.
 *
 * The whole feature stands on one promise: a number reaches a public
 * screen ONLY if a connected rail actually returned it, labeled with
 * its source and the moment it was measured. These tests pin that law
 * at the pure layer (no DB, no providers):
 *
 *  - figuresFromStats: null/absent provider fields become ABSENT
 *    figures — never estimates, never zeros dressed as data;
 *  - mergeFigures: a fresh fetch replaces; a FAILED fetch keeps the
 *    old figure with its ORIGINAL timestamp (never re-dated); an
 *    OK-but-empty fetch retires; a disconnected account's figures drop;
 *  - shapePublicProof (the only path to a public screen): hidden
 *    figures excluded, disconnected excluded, >7-day-old excluded,
 *    older-than-fresh figures carry stale=true WITH their real date.
 */
import { describe, expect, it } from "vitest";
import {
  figuresFromStats,
  mergeFigures,
  shapePublicProof,
  isProofStale,
  KNOWN_FIGURE_KEYS,
  PROOF_FRESH_MS,
  PROOF_MAX_PUBLIC_AGE_MS,
  type ProofStats,
} from "../social-proof";
import type { SocialProofFigure } from "@workspace/db";

const T0 = Date.parse("2026-10-21T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const igAccount = { id: "acct-ig", username: "nova.reign", page_name: null };
const ttAccount = { id: "acct-tt", username: "novareign", page_name: null };

function fig(partial: Partial<SocialProofFigure> & { key: string }): SocialProofFigure {
  return {
    platform: "instagram",
    accountId: "acct-ig",
    accountLabel: "nova.reign",
    label: "Instagram followers",
    value: 100,
    fetchedAt: iso(T0),
    ...partial,
  } as SocialProofFigure;
}

describe("figuresFromStats — real numbers only", () => {
  it("turns returned numbers into figures with source + timestamp", () => {
    const stats: ProofStats = { followers: 12345, following: 312, mediaCount: 67, totalLikes: null };
    const figs = figuresFromStats("instagram", igAccount, stats, iso(T0));
    expect(figs).toEqual([
      expect.objectContaining({ key: "instagram.followers", value: 12345, accountLabel: "nova.reign", fetchedAt: iso(T0) }),
      expect.objectContaining({ key: "instagram.posts", value: 67 }),
    ]);
    /* `following` is never proof, and a null totalLikes invents nothing. */
    expect(figs.map((f) => f.key)).not.toContain("instagram.following");
    expect(figs).toHaveLength(2);
  });

  it("absent fields stay absent — TikTok without the stats scope shows nothing", () => {
    const stats: ProofStats = { followers: null, following: null, mediaCount: null, totalLikes: null };
    expect(figuresFromStats("tiktok", ttAccount, stats, iso(T0))).toEqual([]);
    expect(figuresFromStats("tiktok", ttAccount, null, iso(T0))).toEqual([]);
  });

  it("rejects non-finite and negative values outright", () => {
    const stats: ProofStats = { followers: Number.NaN, following: null, mediaCount: -3, totalLikes: null };
    expect(figuresFromStats("instagram", igAccount, stats, iso(T0))).toEqual([]);
  });

  it("zero is a real number a rail can return — it is kept, not hidden", () => {
    const stats: ProofStats = { followers: 0, following: null, mediaCount: 0, totalLikes: null };
    const figs = figuresFromStats("instagram", igAccount, stats, iso(T0));
    expect(figs.map((f) => f.value)).toEqual([0, 0]);
  });

  it("facebook yields exactly its one audience figure", () => {
    const stats: ProofStats = { followers: 890, following: null, mediaCount: null, totalLikes: null };
    const figs = figuresFromStats("facebook", { id: "acct-fb", username: null, page_name: "Nova Reign" }, stats, iso(T0));
    expect(figs).toEqual([
      expect.objectContaining({ key: "facebook.followers", value: 890, accountLabel: "Nova Reign" }),
    ]);
  });

  it("unknown platforms produce no figures", () => {
    const stats: ProofStats = { followers: 5, following: 5, mediaCount: 5, totalLikes: 5 };
    expect(figuresFromStats("myspace", igAccount, stats, iso(T0))).toEqual([]);
  });
});

describe("mergeFigures — refresh never launders a date", () => {
  const existing = [
    fig({ key: "instagram.followers", value: 100, fetchedAt: iso(T0) }),
    fig({ key: "tiktok.followers", platform: "tiktok", accountId: "acct-tt", accountLabel: "novareign", label: "TikTok followers", value: 50, fetchedAt: iso(T0) }),
  ];
  const both = new Set(["acct-ig", "acct-tt"]);

  it("a fresh fetch replaces the account's figures wholesale", () => {
    const fresh = new Map<string, SocialProofFigure[] | null>([
      ["acct-ig", [fig({ key: "instagram.followers", value: 140, fetchedAt: iso(T0 + 1000) })]],
    ]);
    const merged = mergeFigures(existing, fresh, both);
    expect(merged.find((f) => f.key === "instagram.followers")?.value).toBe(140);
    expect(merged.find((f) => f.key === "tiktok.followers")?.value).toBe(50);
  });

  it("a FAILED fetch keeps the old figure with its ORIGINAL fetchedAt", () => {
    const fresh = new Map<string, SocialProofFigure[] | null>([["acct-ig", null]]);
    const merged = mergeFigures(existing, fresh, both);
    const kept = merged.find((f) => f.key === "instagram.followers");
    expect(kept?.value).toBe(100);
    expect(kept?.fetchedAt).toBe(iso(T0)); // not re-dated to the failed attempt
  });

  it("an OK fetch that returned no numbers retires the old figures", () => {
    const fresh = new Map<string, SocialProofFigure[] | null>([["acct-ig", []]]);
    const merged = mergeFigures(existing, fresh, both);
    expect(merged.map((f) => f.key)).toEqual(["tiktok.followers"]);
  });

  it("a disconnected account's figures drop even when never re-fetched", () => {
    const merged = mergeFigures(existing, new Map(), new Set(["acct-ig"]));
    expect(merged.map((f) => f.key)).toEqual(["instagram.followers"]);
  });
});

describe("shapePublicProof — the only path to a public screen", () => {
  const figures = [
    fig({ key: "instagram.followers", value: 12345, fetchedAt: iso(T0) }),
    fig({ key: "tiktok.likes", platform: "tiktok", accountId: "acct-tt", accountLabel: "novareign", label: "TikTok likes", value: 777, fetchedAt: iso(T0) }),
  ];
  const both = new Set(["acct-ig", "acct-tt"]);

  it("fresh figures render with their real value, source label and update time", () => {
    const out = shapePublicProof(figures, [], both, T0 + 60_000);
    expect(out).toEqual([
      expect.objectContaining({ key: "instagram.followers", value: 12345, label: "Instagram followers", accountLabel: "nova.reign", updatedAt: iso(T0), stale: false }),
      expect.objectContaining({ key: "tiktok.likes", value: 777, stale: false }),
    ]);
  });

  it("a creator-hidden figure is excluded — everywhere, for everyone", () => {
    const out = shapePublicProof(figures, ["instagram.followers"], both, T0 + 60_000);
    expect(out.map((f) => f.key)).toEqual(["tiktok.likes"]);
  });

  it("a disconnected account's figure is excluded even while cached", () => {
    const out = shapePublicProof(figures, [], new Set(["acct-ig"]), T0 + 60_000);
    expect(out.map((f) => f.key)).toEqual(["instagram.followers"]);
  });

  it("past the fresh window the figure stays — date-labeled stale, never re-dated", () => {
    const out = shapePublicProof(figures, [], both, T0 + PROOF_FRESH_MS + 1);
    expect(out).toHaveLength(2);
    expect(out[0]?.stale).toBe(true);
    expect(out[0]?.updatedAt).toBe(iso(T0));
  });

  it("past the max public age the figure stops showing at all", () => {
    const out = shapePublicProof(figures, [], both, T0 + PROOF_MAX_PUBLIC_AGE_MS + 1);
    expect(out).toEqual([]);
  });

  it("a figure with an unparseable date never renders", () => {
    const bad = [fig({ key: "instagram.followers", fetchedAt: "not-a-date" })];
    expect(shapePublicProof(bad, [], both, T0)).toEqual([]);
  });
});

describe("staleness + catalog", () => {
  it("isProofStale: never-refreshed is stale; inside 6h is fresh", () => {
    expect(isProofStale(null, T0)).toBe(true);
    expect(isProofStale(new Date(T0), T0 + PROOF_FRESH_MS - 1)).toBe(false);
    expect(isProofStale(new Date(T0), T0 + PROOF_FRESH_MS + 1)).toBe(true);
  });

  it("every catalog key is a known figure key", () => {
    expect(KNOWN_FIGURE_KEYS.has("instagram.followers")).toBe(true);
    expect(KNOWN_FIGURE_KEYS.has("tiktok.likes")).toBe(true);
    expect(KNOWN_FIGURE_KEYS.has("facebook.followers")).toBe(true);
    expect(KNOWN_FIGURE_KEYS.has("instagram.following")).toBe(false);
  });
});
