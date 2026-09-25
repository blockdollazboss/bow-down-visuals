/**
 * Tests for Fan Contests (/contests).
 *
 * Money-integrity properties:
 * - Contests are FREE to run: create/entry/verify/draw never touch credits.
 * - Only the AI announcement graphic charges (1 credit), charged on success,
 *   402 when short, refunded when storage upload fails after charging.
 *
 * Fairness properties:
 * - The winner draw is deterministic and verifiable: buildDrawSeed is a
 *   pure sha256, pickWinner is a pure seeded PRNG, and verifyDrawAudit
 *   re-runs a stored audit and rejects tampered payloads.
 *
 * Fraud-prevention properties:
 * - isDuplicateEntry blocks the same handle entering twice via the same
 *   method (case-insensitive).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  CONTEST_ANNOUNCE_CREDIT_COST,
  DRAW_ALGORITHM,
  ENTRY_METHODS,
  ENTRY_METHOD_LABELS,
  buildDrawSeed,
  mulberry32,
  pickWinner,
  verifyDrawAudit,
  isDuplicateEntry,
  buildAnnouncePrompt,
  type DrawAudit,
} from "../contests";

describe("CONTEST_ANNOUNCE_CREDIT_COST", () => {
  it("charges 1 credit per announcement graphic", () => {
    expect(CONTEST_ANNOUNCE_CREDIT_COST).toBe(1);
  });
});

describe("ENTRY_METHODS", () => {
  it("ships follow, comment, share, purchase", () => {
    expect([...ENTRY_METHODS]).toEqual(["follow", "comment", "share", "purchase"]);
  });

  it("every method has a label", () => {
    for (const m of ENTRY_METHODS) {
      expect(ENTRY_METHOD_LABELS[m]).toBeTruthy();
    }
  });
});

describe("buildDrawSeed", () => {
  it("is deterministic", () => {
    const a = buildDrawSeed("c1", ["e1", "e2"], "2026-01-01T00:00:00.000Z");
    const b = buildDrawSeed("c1", ["e1", "e2"], "2026-01-01T00:00:00.000Z");
    expect(a).toBe(b);
  });

  it("produces a 64-char hex sha256", () => {
    const seed = buildDrawSeed("c1", ["e1"], "2026-01-01T00:00:00.000Z");
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any input changes", () => {
    const base = buildDrawSeed("c1", ["e1", "e2"], "2026-01-01T00:00:00.000Z");
    expect(buildDrawSeed("c2", ["e1", "e2"], "2026-01-01T00:00:00.000Z")).not.toBe(base);
    expect(buildDrawSeed("c1", ["e1", "e3"], "2026-01-01T00:00:00.000Z")).not.toBe(base);
    expect(buildDrawSeed("c1", ["e1", "e2"], "2026-01-02T00:00:00.000Z")).not.toBe(base);
    // Entry ORDER matters — the audit stores the sorted order, so a
    // reordered list is a different draw (and won't verify).
    expect(buildDrawSeed("c1", ["e2", "e1"], "2026-01-01T00:00:00.000Z")).not.toBe(base);
  });
});

describe("mulberry32", () => {
  it("produces values in [0, 1)", () => {
    const rand = mulberry32("deadbeef");
    for (let i = 0; i < 100; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = mulberry32("cafef00d");
    const b = mulberry32("cafef00d");
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  it("differs across seeds", () => {
    const a = mulberry32("00000001");
    const b = mulberry32("00000002");
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });
});

describe("pickWinner", () => {
  const ids = ["e1", "e2", "e3", "e4", "e5"];
  const seed = buildDrawSeed("contest-1", ids, "2026-01-01T00:00:00.000Z");

  it("is deterministic: same inputs, same winner", () => {
    const r1 = pickWinner(ids, seed);
    const r2 = pickWinner(ids, seed);
    expect(r1).toEqual(r2);
  });

  it("returns a valid winner index and id", () => {
    const r = pickWinner(ids, seed);
    expect(r.winnerIndex).toBeGreaterThanOrEqual(0);
    expect(r.winnerIndex).toBeLessThan(ids.length);
    expect(r.winnerEntryId).toBe(ids[r.winnerIndex]);
    expect(r.entryCount).toBe(ids.length);
    expect(r.seed).toBe(seed);
  });

  it("distributes across entries over many seeds (not stuck on one slot)", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const s = buildDrawSeed("c", ids, `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`);
      seen.add(pickWinner(ids, s).winnerIndex);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("throws when there are no entries", () => {
    expect(() => pickWinner([], seed)).toThrow(/no verified entries/i);
  });

  it("works with a single entry (always that entry)", () => {
    const r = pickWinner(["only"], seed);
    expect(r.winnerEntryId).toBe("only");
    expect(r.winnerIndex).toBe(0);
  });
});

describe("verifyDrawAudit", () => {
  function makeAudit(): DrawAudit & { contestId: string } {
    const entryIds = ["e1", "e2", "e3"];
    const drawnAt = "2026-01-01T00:00:00.000Z";
    const seed = buildDrawSeed("contest-9", entryIds, drawnAt);
    const result = pickWinner(entryIds, seed);
    return {
      algorithm: DRAW_ALGORITHM,
      contestId: "contest-9",
      seed,
      entryCount: result.entryCount,
      entryIds,
      winnerEntryId: result.winnerEntryId,
      winnerIndex: result.winnerIndex,
      drawnAt,
      drawnBy: "user-1",
    };
  }

  it("verifies a genuine audit", () => {
    expect(verifyDrawAudit(makeAudit())).toBe(true);
  });

  it("rejects a tampered winner", () => {
    const audit = makeAudit();
    // Force the recorded winner to differ from the genuine draw result.
    const genuineIndex = audit.winnerIndex;
    const tamperedIndex = (genuineIndex + 1) % audit.entryIds.length;
    audit.winnerEntryId = audit.entryIds[tamperedIndex]!;
    audit.winnerIndex = tamperedIndex;
    expect(verifyDrawAudit(audit)).toBe(false);
  });

  it("rejects a tampered seed", () => {
    const audit = makeAudit();
    audit.seed = "0".repeat(64);
    expect(verifyDrawAudit(audit)).toBe(false);
  });

  it("rejects a tampered entry list", () => {
    const audit = makeAudit();
    audit.entryIds = [...audit.entryIds, "e4"];
    expect(verifyDrawAudit(audit)).toBe(false);
  });
});

describe("isDuplicateEntry", () => {
  const existing = [
    { handle: "@SharkFan", entry_method: "follow" },
    { handle: "@sharkfan", entry_method: "comment" },
  ];

  it("blocks the same handle + method (case-insensitive)", () => {
    expect(isDuplicateEntry(existing, "@sharkfan", "follow")).toBe(true);
    expect(isDuplicateEntry(existing, "@SHARKFAN", "follow")).toBe(true);
    expect(isDuplicateEntry(existing, "  @sharkfan  ", "follow")).toBe(true);
  });

  it("allows the same handle via a different method", () => {
    expect(isDuplicateEntry(existing, "@sharkfan", "share")).toBe(false);
  });

  it("allows a different handle via the same method", () => {
    expect(isDuplicateEntry(existing, "@other", "follow")).toBe(false);
  });
});

describe("buildAnnouncePrompt", () => {
  it("weaves contest title, prize, and winner handle into the prompt", () => {
    const p = buildAnnouncePrompt({
      contestTitle: "Gold Chain Giveaway",
      prize: "24k gold chain",
      winnerHandle: "@sharkfan",
    });
    expect(p).toContain("Gold Chain Giveaway");
    expect(p).toContain("24k gold chain");
    expect(p).toContain("@sharkfan");
    expect(p).toContain("WINNER");
  });

  it("stays within the model prompt budget and keeps the luxury style", () => {
    const p = buildAnnouncePrompt({ contestTitle: "T", prize: "P", winnerHandle: "W" });
    expect(p.length).toBeLessThanOrEqual(4000);
    expect(p).toMatch(/black and gold/i);
    expect(p).toMatch(/no watermark/i);
  });
});

describe("DRAW_ALGORITHM", () => {
  it("is versioned", () => {
    expect(DRAW_ALGORITHM).toBe("fan-contests-draw-v1");
  });
});

/* ─── Route-level money tests: the announce endpoint ───────────────────
   The draw/create/entry endpoints never touch credits; the announce
   endpoint charges 1 credit only on success. Heavy modules are mocked
   and the real Express router runs against an ephemeral server. */

const routeState = vi.hoisted(() => ({
  authedUserId: "user-1" as string | null,
  credits: 10,
  contest: null as null | {
    id: string;
    user_id: string;
    title: string;
    prize: string;
    winner_entry_id: string | null;
  },
  winnerHandle: "@sharkfan",
  imageB64: "aGVsbG8=" as string | null, // "hello"
  chargeImpl: null as null | (() => Promise<number>),
  failUpload: false,
  charged: [] as number[],
  refunded: [] as number[],
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!routeState.authedUserId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = routeState.authedUserId;
    req.userCredits = routeState.credits;
    next();
  },
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => {
    if (routeState.chargeImpl) return routeState.chargeImpl();
    routeState.charged.push(1);
    return routeState.credits - 1;
  }),
  refundCredits: vi.fn(async () => {
    routeState.refunded.push(1);
  }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    images: {
      generate: vi.fn(async () => ({
        data: routeState.imageB64 ? [{ b64_json: routeState.imageB64 }] : [],
      })),
    },
  }),
}));

vi.mock("../../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async () => {
    if (routeState.failUpload) throw new Error("bucket exploded");
    return "storage-ref";
  }),
  refreshSupabaseStorageUrl: vi.fn(async () => "https://cdn.example/announce.png"),
  normalizeToStorageRef: vi.fn((v: string) => v),
}));

vi.mock("@workspace/db", () => {
  const findContest = () =>
    routeState.contest && routeState.contest.user_id === routeState.authedUserId
      ? routeState.contest
      : null;
  const chain: any = {};
  chain.from = vi.fn((table: any) => {
    chain._kind = table?.__table === "contest_entries" ? "winner" : "contest";
    return chain;
  });
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(async () => {
    if (chain._kind === "contest") {
      const c = findContest();
      return c ? [c] : [];
    }
    if (chain._kind === "winner") {
      const c = findContest();
      return c?.winner_entry_id ? [{ handle: routeState.winnerHandle }] : [];
    }
    return [];
  });
  chain.set = vi.fn(() => chain);
  chain.returning = vi.fn(async () => []);
  const valuesChain: any = {};
  valuesChain.returning = vi.fn(async () => []);
  return {
    db: {
      select: vi.fn(() => chain),
      update: vi.fn(() => chain),
      insert: vi.fn(() => ({ values: vi.fn(() => valuesChain) })),
    },
    contestsTable: { __table: "contests", id: "id", user_id: "user_id" },
    contestEntriesTable: { __table: "contest_entries", id: "id" },
  };
});

import express from "express";
import type { AddressInfo } from "node:net";
import router from "../contests";
import { chargeCredits, refundCredits } from "../../../lib/credits";

let server: ReturnType<express["listen"]> | null = null;
let baseUrl = "";

beforeEach(() => {
  vi.clearAllMocks();
  routeState.authedUserId = "user-1";
  routeState.credits = 10;
  routeState.contest = {
    id: "contest-1",
    user_id: "user-1",
    title: "Gold Chain Giveaway",
    prize: "24k gold chain",
    winner_entry_id: "entry-7",
  };
  routeState.winnerHandle = "@sharkfan";
  routeState.imageB64 = "aGVsbG8=";
  routeState.chargeImpl = null;
  routeState.failUpload = false;
  routeState.charged = [];
  routeState.refunded = [];
});

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function stopServer() {
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
}

describe("POST /api/contests/:id/announce (money flow)", () => {
  it("404s when the contest does not exist", async () => {
    await startServer();
    try {
      routeState.contest = null;
      const res = await fetch(`${baseUrl}/api/contests/nope/announce`, { method: "POST" });
      expect(res.status).toBe(404);
      expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
    } finally {
      await stopServer();
    }
  });

  it("400s when no winner has been drawn — before credits are touched", async () => {
    await startServer();
    try {
      routeState.contest!.winner_entry_id = null;
      const res = await fetch(`${baseUrl}/api/contests/contest-1/announce`, { method: "POST" });
      expect(res.status).toBe(400);
      expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
    } finally {
      await stopServer();
    }
  });

  it("402s when the user is short on credits", async () => {
    await startServer();
    try {
      routeState.credits = 0;
      const res = await fetch(`${baseUrl}/api/contests/contest-1/announce`, { method: "POST" });
      expect(res.status).toBe(402);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("out_of_credits");
      expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
    } finally {
      await stopServer();
    }
  });

  it("charges 1 credit and returns the graphic URL on success", async () => {
    await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/contests/contest-1/announce`, { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string; creditCost: number };
      expect(body.url).toBe("https://cdn.example/announce.png");
      expect(body.creditCost).toBe(1);
      expect(routeState.charged).toEqual([1]);
      expect(routeState.refunded).toEqual([]);
    } finally {
      await stopServer();
    }
  });

  it("charges nothing when image generation fails", async () => {
    await startServer();
    try {
      routeState.imageB64 = null;
      const res = await fetch(`${baseUrl}/api/contests/contest-1/announce`, { method: "POST" });
      expect(res.status).toBe(500);
      expect(routeState.charged).toEqual([]);
    } finally {
      await stopServer();
    }
  });

  it("refunds the credit when storage upload fails after charging", async () => {
    await startServer();
    try {
      routeState.failUpload = true;
      const res = await fetch(`${baseUrl}/api/contests/contest-1/announce`, { method: "POST" });
      expect(res.status).toBe(500);
      expect(routeState.charged).toEqual([1]);
      expect(routeState.refunded).toEqual([1]);
      expect(vi.mocked(refundCredits)).toHaveBeenCalled();
    } finally {
      await stopServer();
    }
  });
});
