import { Router, type Response } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  royaltyEntriesTable,
  royaltyPlatformConnectionsTable,
  royaltyPayoutsTable,
  ROYALTY_PLATFORMS,
  ROYALTY_PLATFORM_LABELS,
  isRoyaltyPlatform,
  isPayoutStatus,
  type RoyaltyPlatform,
} from "@workspace/db";

/* Re-export DB-level royalty constants for tests and consumers. */
export {
  ROYALTY_PLATFORMS,
  ROYALTY_PLATFORM_LABELS,
  isRoyaltyPlatform,
  isPayoutStatus,
  type RoyaltyPlatform,
};
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

/* ─── Royalty Tracker ─────────────────────────────────────────────────────
   /royalties — creators track streaming earnings across platforms in one
   dashboard. Per the pricing rule: pure data display is FREE (it costs
   nothing to run). Only the AI earnings insights cost credits (1 credit).

   v1 data sources (honest):
   - Manual CSV import — the universal path; every distributor exports CSVs.
   - Platform connections where a real API exists. Anything else is labeled
     "coming soon" in the UI — never faked.

   Endpoints (all under /api/royalties):
   GET    /summary    — dashboard aggregates: totals, per-song, per-platform,
                        monthly trend. Free.
   GET    /entries    — paginated entries with song/platform filters. Free.
   POST   /import     — CSV text in, parsed entries in. Free.
   GET    /platforms  — connection status per platform. Free.
   POST   /platforms  — record a platform connection (v1: manual only). Free.
   GET    /payouts    — payout records. Free.
   POST   /payouts    — record or update a payout. Free.
   POST   /insights   — AI earnings insights (1 credit, refund on failure).

   Money uses NUMERIC in the DB (exact cents). The API returns amounts as
   decimal strings and the frontend formats them — never float math. */

export const ROYALTY_INSIGHTS_CREDITS =
  Number(process.env["ROYALTY_INSIGHTS_CREDIT_COST"]) || 1;

/* Platforms with a real connection path in v1. Everything else shows as
   "coming soon" in the UI. Spotify/Apple/YouTube have no public
   self-serve royalty APIs for indie artists — v1 is honest about that. */
export const CONNECTABLE_PLATFORMS: RoyaltyPlatform[] = ["manual"];
export const COMING_SOON_PLATFORMS: RoyaltyPlatform[] = (
  ROYALTY_PLATFORMS as readonly string[]
).filter((p) => p !== "manual") as RoyaltyPlatform[];

export function platformLabel(p: string): string {
  return (ROYALTY_PLATFORM_LABELS as Record<string, string>)[p] ?? p;
}

export const INSIGHTS_SYSTEM_PROMPT =
  `You are a music-revenue analyst for independent creators. Given a summary of ` +
  `their streaming royalty data (totals, per-song earnings, per-platform earnings, ` +
  `monthly trend), write 3-5 short, specific, actionable insights. Name the actual ` +
  `songs and platforms from the data. Call out: which songs are growing, which ` +
  `platforms pay best per stream, any concerning drops, and one concrete next ` +
  `move (e.g. which song deserves a promo push). Be concrete — no generic advice. ` +
  `Keep each insight to 1-2 sentences. Return ONLY JSON: ` +
  `{"insights": [{"title": "...", "detail": "..."}]}.`;

const importRowSchema = z.object({
  song_title: z.string().min(1).max(300),
  artist_name: z.string().max(300).optional().default(""),
  platform: z.string().min(1).max(50),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  streams: z.string().max(50).optional().default(""),
  gross_amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount like 12.34"),
  currency: z.string().max(10).optional().default("USD"),
});

const importSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(500),
});

const payoutSchema = z.object({
  id: z.string().uuid().optional(),
  distributor: z.string().min(1).max(200),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  expected_amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount like 12.34"),
  received_amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Amount like 12.34")
    .optional(),
  currency: z.string().max(10).optional().default("USD"),
  status: z.enum(["expected", "received", "partial", "overdue"]).optional().default("expected"),
  notes: z.string().max(1000).optional().default(""),
});

const connectSchema = z.object({
  platform: z.string().min(1).max(50),
  account_label: z.string().max(200).optional().default(""),
});

/* Parse a distributor CSV into import rows. Accepts flexible headers —
   we match case-insensitively on common distributor column names. */
const HEADER_ALIASES: Record<string, string[]> = {
  song_title: ["song", "song title", "track", "track title", "title", "work"],
  artist_name: ["artist", "artist name", "performer"],
  platform: ["platform", "store", "service", "dsp"],
  period_start: ["period start", "start date", "from", "reporting period start"],
  period_end: ["period end", "end date", "to", "reporting period end"],
  streams: ["streams", "quantity", "units", "plays"],
  gross_amount: ["amount", "gross", "earnings", "revenue", "royalty", "net", "total"],
  currency: ["currency", "curr"],
};

export function parseRoyaltyCsv(csv: string): { rows: z.infer<typeof importRowSchema>[]; errors: string[] } {
  const rows: z.infer<typeof importRowSchema>[] = [];
  const errors: string[] = [];
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { rows, errors: ["CSV needs a header row plus at least one data row."] };
  }
  const headers = splitCsvLine(lines[0]!).map((h) => h.toLowerCase().trim());
  const colIndex: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = headers.findIndex((h) => aliases.includes(h));
    if (idx >= 0) colIndex[field] = idx;
  }
  const missing = ["song_title", "platform", "period_start", "period_end", "gross_amount"].filter(
    (f) => colIndex[f] === undefined,
  );
  if (missing.length) {
    return { rows, errors: [`Missing columns: ${missing.join(", ")}. Need at least song, platform, period start/end, and amount.`] };
  }
  for (let i = 1; i < lines.length && rows.length < 500; i++) {
    const cells = splitCsvLine(lines[i]!);
    const get = (f: string) => (colIndex[f] !== undefined ? (cells[colIndex[f]] ?? "").trim() : "");
    const candidate = {
      song_title: get("song_title"),
      artist_name: get("artist_name"),
      platform: get("platform").toLowerCase().replace(/\s+/g, "-"),
      period_start: normalizeDate(get("period_start")),
      period_end: normalizeDate(get("period_end")),
      streams: get("streams").replace(/,/g, ""),
      gross_amount: get("gross_amount").replace(/[$,]/g, ""),
      currency: (get("currency") || "USD").toUpperCase(),
    };
    const parsed = importRowSchema.safeParse(candidate);
    if (parsed.success) {
      rows.push(parsed.data);
    } else {
      errors.push(`Row ${i + 1}: ${parsed.error.issues.map((e) => e.message).join("; ")}`);
    }
  }
  return { rows, errors: errors.slice(0, 20) };
}

/* Split one CSV line honoring quoted fields. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur); cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/* Accept MM/DD/YYYY and YYYY-MM-DD, return YYYY-MM-DD or "" if unparseable. */
export function normalizeDate(s: string): string {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mo, d, y] = m;
    return `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  return "";
}

/* Pure aggregation helpers — exported for tests. Amounts stay as integer
   cents through the whole pipeline; formatting happens at the edge. */
export function toCents(amount: string): number {
  const [whole = "0", frac = ""] = amount.split(".");
  return parseInt(whole, 10) * 100 + parseInt((frac + "00").slice(0, 2), 10);
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export interface RoyaltySummary {
  totalCents: number;
  totalStreams: number;
  entryCount: number;
  perSong: { song: string; cents: number; streams: number }[];
  perPlatform: { platform: string; cents: number; streams: number }[];
  monthly: { month: string; cents: number }[];
}

export function summarizeEntries(
  entries: { song_title: string; platform: string; period_start: string; gross_amount: string; streams: string | null }[],
): RoyaltySummary {
  let totalCents = 0;
  let totalStreams = 0;
  const perSong = new Map<string, { cents: number; streams: number }>();
  const perPlatform = new Map<string, { cents: number; streams: number }>();
  const monthly = new Map<string, number>();
  for (const e of entries) {
    const cents = toCents(e.gross_amount);
    const streams = parseInt((e.streams || "0").replace(/\D/g, ""), 10) || 0;
    totalCents += cents;
    totalStreams += streams;
    const s = perSong.get(e.song_title) ?? { cents: 0, streams: 0 };
    s.cents += cents; s.streams += streams;
    perSong.set(e.song_title, s);
    const p = perPlatform.get(e.platform) ?? { cents: 0, streams: 0 };
    p.cents += cents; p.streams += streams;
    perPlatform.set(e.platform, p);
    const month = e.period_start.slice(0, 7);
    monthly.set(month, (monthly.get(month) ?? 0) + cents);
  }
  const byCentsDesc = (a: { cents: number }, b: { cents: number }) => b.cents - a.cents;
  return {
    totalCents,
    totalStreams,
    entryCount: entries.length,
    perSong: [...perSong.entries()].map(([song, v]) => ({ song, ...v })).sort(byCentsDesc),
    perPlatform: [...perPlatform.entries()].map(([platform, v]) => ({ platform, ...v })).sort(byCentsDesc),
    monthly: [...monthly.entries()].map(([month, cents]) => ({ month, cents })).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

const router = Router();

async function chargeOr402(
  userId: string,
  balance: number,
  cost: number,
  res: Response,
): Promise<number | null> {
  if (balance < cost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to keep using AI earnings insights.",
    });
    return null;
  }
  try {
    return await chargeCredits(userId, cost, { action: "Royalty AI Insights" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to keep using AI earnings insights.",
      });
      return null;
    }
    throw err;
  }
}

/* GET /api/royalties/summary → dashboard aggregates. Free. */
router.get("/royalties/summary", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const entries = await db
      .select({
        song_title: royaltyEntriesTable.song_title,
        platform: royaltyEntriesTable.platform,
        period_start: royaltyEntriesTable.period_start,
        gross_amount: royaltyEntriesTable.gross_amount,
        streams: royaltyEntriesTable.streams,
      })
      .from(royaltyEntriesTable)
      .where(eq(royaltyEntriesTable.user_id, req.userId!))
      .orderBy(desc(royaltyEntriesTable.period_start))
      .limit(5000);
    const summary = summarizeEntries(entries);
    res.json({
      total: fromCents(summary.totalCents),
      totalStreams: summary.totalStreams,
      entryCount: summary.entryCount,
      perSong: summary.perSong.map((s) => ({ ...s, amount: fromCents(s.cents) })),
      perPlatform: summary.perPlatform.map((p) => ({ ...p, amount: fromCents(p.cents), label: platformLabel(p.platform) })),
      monthly: summary.monthly.map((m) => ({ ...m, amount: fromCents(m.cents) })),
    });
  } catch (err) {
    logger.error({ err }, "[royalties] summary failed");
    res.status(500).json({ error: "Couldn't load your royalty summary." });
  }
});

/* GET /api/royalties/entries?song=&platform=&limit= → entries. Free. */
router.get("/royalties/entries", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const { song, platform, limit } = req.query as { song?: string; platform?: string; limit?: string };
    const conds = [eq(royaltyEntriesTable.user_id, req.userId!)];
    if (song) conds.push(eq(royaltyEntriesTable.song_title, song));
    if (platform) conds.push(eq(royaltyEntriesTable.platform, platform));
    const lim = Math.min(Math.max(parseInt(limit ?? "100", 10) || 100, 1), 500);
    const entries = await db
      .select()
      .from(royaltyEntriesTable)
      .where(and(...conds))
      .orderBy(desc(royaltyEntriesTable.period_start))
      .limit(lim);
    res.json({ entries });
  } catch (err) {
    logger.error({ err }, "[royalties] entries failed");
    res.status(500).json({ error: "Couldn't load royalty entries." });
  }
});

/* POST /api/royalties/import { csv } → parse + insert. Free. */
router.post("/royalties/import", publicApiLimiter, requireAuth, async (req, res) => {
  const { csv } = (req.body ?? {}) as { csv?: unknown };
  if (typeof csv !== "string" || !csv.trim()) {
    res.status(400).json({ error: "Paste your distributor CSV first." });
    return;
  }
  if (csv.length > 500_000) {
    res.status(400).json({ error: "That CSV is too large — keep it under 500KB." });
    return;
  }
  const { rows, errors } = parseRoyaltyCsv(csv);
  if (!rows.length) {
    res.status(400).json({ error: "No usable rows found.", details: errors });
    return;
  }
  try {
    await db.insert(royaltyEntriesTable).values(
      rows.map((r) => ({
        user_id: req.userId!,
        song_title: r.song_title,
        artist_name: r.artist_name || null,
        platform: r.platform,
        period_start: r.period_start,
        period_end: r.period_end,
        streams: r.streams || null,
        gross_amount: r.gross_amount,
        currency: r.currency,
        source: "csv",
      })),
    );
    res.json({ imported: rows.length, warnings: errors });
  } catch (err) {
    logger.error({ err }, "[royalties] import failed");
    res.status(500).json({ error: "Couldn't save those entries — try again." });
  }
});

/* GET /api/royalties/platforms → connection status. Free. */
router.get("/royalties/platforms", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const conns = await db
      .select()
      .from(royaltyPlatformConnectionsTable)
      .where(eq(royaltyPlatformConnectionsTable.user_id, req.userId!));
    const connected = new Map(conns.map((c) => [c.platform, c]));
    res.json({
      platforms: (ROYALTY_PLATFORMS as readonly string[]).map((p) => ({
        key: p,
        label: platformLabel(p),
        connected: connected.has(p),
        connectionType: connected.get(p)?.connection_type ?? null,
        accountLabel: connected.get(p)?.account_label ?? null,
        connectable: (CONNECTABLE_PLATFORMS as readonly string[]).includes(p),
      })),
    });
  } catch (err) {
    logger.error({ err }, "[royalties] platforms failed");
    res.status(500).json({ error: "Couldn't load platform status." });
  }
});

/* POST /api/royalties/platforms { platform, account_label? } → connect. Free.
   v1 only supports manual connections; OAuth paths are honestly "coming soon". */
router.post("/royalties/platforms", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = connectSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid connection request." });
    return;
  }
  const platform = parsed.data.platform.toLowerCase();
  if (!isRoyaltyPlatform(platform)) {
    res.status(400).json({ error: `Unknown platform. Choose one of: ${(ROYALTY_PLATFORMS as readonly string[]).join(", ")}` });
    return;
  }
  if (!(CONNECTABLE_PLATFORMS as readonly string[]).includes(platform)) {
    res.status(400).json({
      error: "not_yet_supported",
      message: `${platformLabel(platform)} auto-sync is coming soon — import its CSV for now.`,
    });
    return;
  }
  try {
    const existing = await db
      .select()
      .from(royaltyPlatformConnectionsTable)
      .where(
        and(
          eq(royaltyPlatformConnectionsTable.user_id, req.userId!),
          eq(royaltyPlatformConnectionsTable.platform, platform),
        ),
      )
      .limit(1);
    if (!existing.length) {
      await db.insert(royaltyPlatformConnectionsTable).values({
        user_id: req.userId!,
        platform,
        connection_type: "manual",
        account_label: parsed.data.account_label || null,
      });
    }
    res.json({ ok: true, platform });
  } catch (err) {
    logger.error({ err }, "[royalties] connect failed");
    res.status(500).json({ error: "Couldn't save that connection." });
  }
});

/* GET /api/royalties/payouts → payout records. Free. */
router.get("/royalties/payouts", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const payouts = await db
      .select()
      .from(royaltyPayoutsTable)
      .where(eq(royaltyPayoutsTable.user_id, req.userId!))
      .orderBy(desc(royaltyPayoutsTable.period_end))
      .limit(200);
    res.json({ payouts });
  } catch (err) {
    logger.error({ err }, "[royalties] payouts failed");
    res.status(500).json({ error: "Couldn't load payouts." });
  }
});

/* POST /api/royalties/payouts → create or update a payout. Free. */
router.post("/royalties/payouts", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = payoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid payout.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const d = parsed.data;
  if (!isPayoutStatus(d.status)) {
    res.status(400).json({ error: "Invalid payout status." });
    return;
  }
  try {
    if (d.id) {
      const updated = await db
        .update(royaltyPayoutsTable)
        .set({
          distributor: d.distributor,
          period_start: d.period_start,
          period_end: d.period_end,
          expected_amount: d.expected_amount,
          received_amount: d.received_amount ?? null,
          currency: d.currency,
          status: d.status,
          notes: d.notes || null,
          updated_at: new Date(),
        })
        .where(and(eq(royaltyPayoutsTable.id, d.id), eq(royaltyPayoutsTable.user_id, req.userId!)))
        .returning();
      if (!updated.length) {
        res.status(404).json({ error: "Payout not found." });
        return;
      }
      res.json({ payout: updated[0] });
      return;
    }
    const inserted = await db
      .insert(royaltyPayoutsTable)
      .values({
        user_id: req.userId!,
        distributor: d.distributor,
        period_start: d.period_start,
        period_end: d.period_end,
        expected_amount: d.expected_amount,
        received_amount: d.received_amount ?? null,
        currency: d.currency,
        status: d.status,
        notes: d.notes || null,
      })
      .returning();
    res.json({ payout: inserted[0] });
  } catch (err) {
    logger.error({ err }, "[royalties] payout save failed");
    res.status(500).json({ error: "Couldn't save that payout." });
  }
});

/* POST /api/royalties/insights → AI earnings insights. 1 credit, refund on failure. */
router.post("/royalties/insights", publicApiLimiter, requireAuth, async (req, res) => {
  const creditsRemaining = await chargeOr402(req.userId!, req.userCredits ?? 0, ROYALTY_INSIGHTS_CREDITS, res);
  if (creditsRemaining === null) return;

  try {
    const entries = await db
      .select({
        song_title: royaltyEntriesTable.song_title,
        platform: royaltyEntriesTable.platform,
        period_start: royaltyEntriesTable.period_start,
        gross_amount: royaltyEntriesTable.gross_amount,
        streams: royaltyEntriesTable.streams,
      })
      .from(royaltyEntriesTable)
      .where(eq(royaltyEntriesTable.user_id, req.userId!))
      .orderBy(desc(royaltyEntriesTable.period_start))
      .limit(2000);
    if (!entries.length) {
      await refundCredits(req.userId!, ROYALTY_INSIGHTS_CREDITS, {
        action: "Royalty AI Insights (no data refund)",
      }).catch(() => {});
      res.status(400).json({ error: "Import some royalty data first — I need numbers to analyze." });
      return;
    }
    const summary = summarizeEntries(entries);
    const dataBrief =
      `Total earnings: $${fromCents(summary.totalCents)} across ${summary.totalStreams.toLocaleString()} streams ` +
      `(${summary.entryCount} entries).\n` +
      `Per song: ${summary.perSong.slice(0, 10).map((s) => `${s.song} $${fromCents(s.cents)} (${s.streams.toLocaleString()} streams)`).join("; ")}.\n` +
      `Per platform: ${summary.perPlatform.map((p) => `${platformLabel(p.platform)} $${fromCents(p.cents)}`).join("; ")}.\n` +
      `Monthly: ${summary.monthly.slice(-6).map((m) => `${m.month} $${fromCents(m.cents)}`).join("; ")}.`;

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: INSIGHTS_SYSTEM_PROMPT },
        { role: "user", content: `Analyze this creator's royalty data:\n\n${dataBrief}` },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 800,
      temperature: 0.4,
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    let insights: { title: string; detail: string }[] = [];
    try {
      const j = JSON.parse(raw) as { insights?: unknown };
      if (Array.isArray(j.insights)) {
        insights = j.insights
          .filter(
            (x): x is { title: unknown; detail: unknown } =>
              typeof x === "object" && x !== null,
          )
          .map((x) => ({
            title: String((x as { title?: unknown }).title ?? "").slice(0, 120),
            detail: String((x as { detail?: unknown }).detail ?? "").slice(0, 600),
          }))
          .filter((x) => x.title && x.detail)
          .slice(0, 6);
      }
    } catch {
      /* fall through to the empty check */
    }
    if (!insights.length) {
      throw new Error("Model returned no usable insights");
    }
    res.json({ insights, creditsUsed: ROYALTY_INSIGHTS_CREDITS, creditsRemaining });
  } catch (err) {
    await refundCredits(req.userId!, ROYALTY_INSIGHTS_CREDITS, {
      action: "Royalty AI Insights (provider failure refund)",
    }).catch(() => {});
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[royalties] OpenAI rate limit / quota");
      res.status(503).json({ error: "The analyst is catching its breath — try again in a moment. (Credit refunded.)" });
      return;
    }
    logger.error({ err }, "[royalties] insights failed");
    res.status(502).json({ error: "The analyst hiccupped — try again. (Credit refunded.)" });
  }
});

export default router;
