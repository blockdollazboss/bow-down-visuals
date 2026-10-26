/* ─── Loop Exchange — frontend helpers ───────────────────────────────────
   Pure parsing/formatting for the LoopExchangePanel (docked in the
   Beats catalog browse tab and on the Sounds page — the existing
   audio/sample surfaces — never a standalone page). The split math and
   the money live server-side (lib/loop-exchange on the API, on the
   EXISTING sale-splits rail); these helpers only shape what the API
   returns and build the requests — they never compute a share, a fee,
   or an earning on the client.
   Terms are agreed UP FRONT: the poster states their share when they
   post the loop; a builder proposes the full splits list; the poster
   accepts or declines; only an agreed build can record a sale, and the
   poster is paid per the agreed split on EVERY downstream sale.
   Money is TEST MODE Visual Bucs only — never cash. */

export interface LoopExchangeLoop {
  id: string;
  posterUserId: string;
  posterProfileId: string | null;
  title: string;
  description: string;
  audioUrl: string;
  bpm: number | null;
  musicalKey: string | null;
  durationSeconds: number | null;
  posterSharePct: number;
  status: "open" | "paused" | "closed";
  createdAt: string;
}

export interface LoopExchangeSplitInput {
  userId: string;
  sharePct: number;
}

export interface LoopExchangeBuild {
  id: string;
  loopId: string;
  builderUserId: string;
  builderProfileId: string | null;
  title: string;
  audioUrl: string | null;
  splits: LoopExchangeSplitInput[];
  status: "pending_terms" | "agreed" | "declined";
  agreedAt: string | null;
  createdAt: string;
}

export interface LoopExchangeEarning {
  id: string;
  saleId: string;
  buildId: string;
  loopId: string;
  role: "loop_poster" | "builder" | "collaborator";
  sharePct: number;
  amountVb: number;
  createdAt: string;
}

export interface LoopExchangeMine {
  loops: LoopExchangeLoop[];
  builds: LoopExchangeBuild[];
  earnings: LoopExchangeEarning[];
  totalEarnedVb: number;
}

export interface LoopExchangeSaleResult {
  outcome: "recorded" | "already-recorded";
  sale: { id: string; saleRef: string; grossVb: number; feeVb: number; netVb: number };
  allocations: Array<{
    userId: string;
    role: "loop_poster" | "builder" | "collaborator";
    sharePct: number;
    amountVb: number;
  }>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseLoop(v: unknown): LoopExchangeLoop | null {
  if (!isRecord(v)) return null;
  if (typeof v["id"] !== "string" || typeof v["posterUserId"] !== "string") return null;
  if (typeof v["title"] !== "string" || typeof v["audioUrl"] !== "string") return null;
  if (typeof v["posterSharePct"] !== "number") return null;
  return v as unknown as LoopExchangeLoop;
}

function parseBuild(v: unknown): LoopExchangeBuild | null {
  if (!isRecord(v)) return null;
  if (typeof v["id"] !== "string" || typeof v["loopId"] !== "string") return null;
  if (typeof v["builderUserId"] !== "string" || typeof v["title"] !== "string") return null;
  if (!Array.isArray(v["splits"])) return null;
  return v as unknown as LoopExchangeBuild;
}

/** Parse GET /api/loop-exchange/loops — null on any shape drift, so the
 *  panel shows its empty state instead of half-invented loops. */
export function parseLoopsResponse(payload: unknown): LoopExchangeLoop[] | null {
  if (!isRecord(payload) || !Array.isArray(payload["loops"])) return null;
  const out: LoopExchangeLoop[] = [];
  for (const raw of payload["loops"]) {
    const loop = parseLoop(raw);
    if (!loop) return null;
    out.push(loop);
  }
  return out;
}

/** Parse GET /api/loop-exchange/loops/:id (loop + its builds). */
export function parseLoopDetailResponse(
  payload: unknown,
): { loop: LoopExchangeLoop; builds: LoopExchangeBuild[] } | null {
  if (!isRecord(payload)) return null;
  const loop = parseLoop(payload["loop"]);
  if (!loop || !Array.isArray(payload["builds"])) return null;
  const builds: LoopExchangeBuild[] = [];
  for (const raw of payload["builds"]) {
    const b = parseBuild(raw);
    if (!b) return null;
    builds.push(b);
  }
  return { loop, builds };
}

/** Parse GET /api/loop-exchange/mine. */
export function parseMineResponse(payload: unknown): LoopExchangeMine | null {
  if (!isRecord(payload)) return null;
  if (!Array.isArray(payload["loops"]) || !Array.isArray(payload["builds"]) || !Array.isArray(payload["earnings"])) return null;
  if (typeof payload["totalEarnedVb"] !== "number") return null;
  const loops: LoopExchangeLoop[] = [];
  for (const raw of payload["loops"]) {
    const l = parseLoop(raw);
    if (!l) return null;
    loops.push(l);
  }
  const builds: LoopExchangeBuild[] = [];
  for (const raw of payload["builds"]) {
    const b = parseBuild(raw);
    if (!b) return null;
    builds.push(b);
  }
  return {
    loops,
    builds,
    earnings: payload["earnings"] as LoopExchangeEarning[],
    totalEarnedVb: payload["totalEarnedVb"],
  };
}

/** Parse POST …/builds/:id/sales. */
export function parseSaleResponse(payload: unknown): LoopExchangeSaleResult | null {
  if (!isRecord(payload)) return null;
  if (payload["outcome"] !== "recorded" && payload["outcome"] !== "already-recorded") return null;
  if (!isRecord(payload["sale"]) || !Array.isArray(payload["allocations"])) return null;
  return payload as unknown as LoopExchangeSaleResult;
}

/** Build the splits list a builder proposes: the builder's own share is
 *  whatever remains after the poster (at their posted terms, or a share
 *  the builder chooses above them) and any collaborators. Returns null
 *  when the numbers can't form a valid proposal — the server rail makes
 *  the final call either way; this only keeps the form honest. */
export function buildProposedSplits(input: {
  builderUserId: string;
  posterUserId: string;
  posterSharePct: number;
  collaborators?: LoopExchangeSplitInput[];
}): LoopExchangeSplitInput[] | null {
  const collabs = input.collaborators ?? [];
  const seen = new Set<string>([input.builderUserId, input.posterUserId]);
  let used = input.posterSharePct;
  for (const c of collabs) {
    if (!c.userId || seen.has(c.userId)) return null;
    if (!Number.isFinite(c.sharePct) || c.sharePct <= 0 || c.sharePct >= 100) return null;
    seen.add(c.userId);
    used += c.sharePct;
  }
  if (!Number.isFinite(input.posterSharePct) || input.posterSharePct <= 0 || input.posterSharePct >= 100) return null;
  const builderShare = Math.round((100 - used) * 100) / 100;
  if (builderShare <= 0) return null;
  return [
    { userId: input.builderUserId, sharePct: builderShare },
    { userId: input.posterUserId, sharePct: input.posterSharePct },
    ...collabs,
  ];
}

/** The terms line shown on every loop — the poster's share, exactly as
 *  they posted it, never recomputed. */
export function termsLine(loop: Pick<LoopExchangeLoop, "posterSharePct">): string {
  return `Original poster gets ${loop.posterSharePct}% of every downstream sale's net`;
}

/** Loop meta line: only the fields the poster actually listed. */
export function loopMetaLine(loop: Pick<LoopExchangeLoop, "bpm" | "musicalKey" | "durationSeconds">): string {
  const parts: string[] = [];
  if (loop.bpm != null) parts.push(`${loop.bpm} BPM`);
  if (loop.musicalKey) parts.push(loop.musicalKey);
  if (loop.durationSeconds != null) parts.push(`${loop.durationSeconds}s`);
  return parts.join(" · ");
}

export const LOOP_BUILD_STATUS_LABELS: Record<LoopExchangeBuild["status"], string> = {
  pending_terms: "Waiting on the poster to accept the terms",
  agreed: "Terms agreed — this build can sell",
  declined: "Terms declined by the poster",
};

export const LOOP_ROLE_LABELS: Record<LoopExchangeEarning["role"], string> = {
  loop_poster: "As the loop's original poster",
  builder: "As the builder",
  collaborator: "As a collaborator",
};
