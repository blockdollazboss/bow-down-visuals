/**
 * Keyword automations (migration 0232, Wave 4 #32) — the creator's
 * rule desk, docked beside the email automations in the PROMOTE
 * workflow (the email-list page links here; the engine lives in
 * lib/keyword-automations.ts).
 *
 * Rules are creator-scoped: a rule belongs to the signed-in creator,
 * fires only while its explicit ON/OFF switch is on, and captures
 * email only into a list the creator owns. The events read is the
 * honest audit log: every fire the engine recorded — sent,
 * rate-limited, blocked, failed, captured — newest first.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  emailListsTable,
  keywordAutomationEventsTable,
  keywordAutomationRulesTable,
  KEYWORD_AUTOMATION_SURFACES,
  type KeywordAutomationRule,
  type KeywordAutomationSurface,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { KW_MAX_RULES_PER_CREATOR, normalizeKeyword } from "../lib/keyword-automations";
import { logger } from "../lib/logger";

const router = Router();

const surfacesSchema = z
  .array(z.enum(KEYWORD_AUTOMATION_SURFACES))
  .min(1)
  .max(KEYWORD_AUTOMATION_SURFACES.length)
  .transform((arr) => [...new Set(arr)] as KeywordAutomationSurface[]);

const ruleBodySchema = z.object({
  keyword: z.string().min(1).max(80),
  dmBody: z.string().trim().min(1).max(1000),
  surfaces: surfacesSchema,
  captureEmail: z.boolean().default(false),
  listId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional(),
});

const rulePatchSchema = ruleBodySchema.partial().extend({
  keyword: z.string().min(1).max(80).optional(),
  dmBody: z.string().trim().min(1).max(1000).optional(),
  surfaces: surfacesSchema.optional(),
});

function ruleDto(rule: KeywordAutomationRule, stats?: { sent: number; captured: number }) {
  return {
    id: rule.id,
    keyword: rule.keyword,
    dmBody: rule.dmBody,
    surfaces: rule.surfaces ?? [],
    captureEmail: rule.captureEmail,
    listId: rule.listId,
    enabled: rule.enabled,
    enabledAt: rule.enabledAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    sent: stats?.sent ?? 0,
    captured: stats?.captured ?? 0,
  };
}

async function loadOwnedRule(req: Request, res: Response, id: string) {
  const [rule] = await db
    .select()
    .from(keywordAutomationRulesTable)
    .where(and(eq(keywordAutomationRulesTable.id, id), eq(keywordAutomationRulesTable.creatorUserId, req.userId!)))
    .limit(1);
  if (!rule) {
    res.status(404).json({ error: "That keyword rule doesn't exist." });
    return null;
  }
  return rule;
}

/** A capture target must be the caller's own list. Returns an error
 *  string, or null when the (listId, captureEmail) pair is honest. */
async function validateCaptureTarget(userId: string, listId: string | null | undefined, captureEmail: boolean): Promise<string | null> {
  if (captureEmail && !listId) return "Pick the email list captures should land in.";
  if (!listId) return null;
  const [list] = await db
    .select({ id: emailListsTable.id })
    .from(emailListsTable)
    .where(and(eq(emailListsTable.id, listId), eq(emailListsTable.userId, userId)))
    .limit(1);
  return list ? null : "That email list isn't yours.";
}

router.get("/keyword-automations/rules", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const rules = await db
      .select()
      .from(keywordAutomationRulesTable)
      .where(eq(keywordAutomationRulesTable.creatorUserId, req.userId!))
      .orderBy(keywordAutomationRulesTable.createdAt);
    const ids = rules.map((r) => r.id);
    const stats = new Map<string, { sent: number; captured: number }>();
    if (ids.length > 0) {
      const sentRows = await db
        .select({ ruleId: keywordAutomationEventsTable.ruleId, value: count() })
        .from(keywordAutomationEventsTable)
        .where(and(inArray(keywordAutomationEventsTable.ruleId, ids), eq(keywordAutomationEventsTable.outcome, "sent")))
        .groupBy(keywordAutomationEventsTable.ruleId);
      const capturedRows = await db
        .select({ ruleId: keywordAutomationEventsTable.ruleId, value: count() })
        .from(keywordAutomationEventsTable)
        .where(and(inArray(keywordAutomationEventsTable.ruleId, ids), eq(keywordAutomationEventsTable.outcome, "captured")))
        .groupBy(keywordAutomationEventsTable.ruleId);
      for (const r of sentRows) stats.set(r.ruleId, { sent: r.value, captured: 0 });
      for (const r of capturedRows) {
        const s = stats.get(r.ruleId) ?? { sent: 0, captured: 0 };
        s.captured = r.value;
        stats.set(r.ruleId, s);
      }
    }
    res.json({ rules: rules.map((r) => ruleDto(r, stats.get(r.id))) });
  } catch (err) {
    logger.error({ err }, "[keyword-automations] list rules failed");
    res.status(500).json({ error: "Couldn't load your keyword rules." });
  }
});

router.post("/keyword-automations/rules", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const parsed = ruleBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid keyword rule.", details: parsed.error.issues });
      return;
    }
    const keyword = normalizeKeyword(parsed.data.keyword);
    if (!keyword) {
      res.status(400).json({ error: "A keyword is one word — letters, numbers, _ or -, up to 40 characters." });
      return;
    }
    const captureError = await validateCaptureTarget(req.userId!, parsed.data.listId, parsed.data.captureEmail);
    if (captureError) {
      res.status(400).json({ error: captureError });
      return;
    }
    const [existing] = await db
      .select({ value: count() })
      .from(keywordAutomationRulesTable)
      .where(eq(keywordAutomationRulesTable.creatorUserId, req.userId!));
    if ((existing?.value ?? 0) >= KW_MAX_RULES_PER_CREATOR) {
      res.status(400).json({ error: `You can keep up to ${KW_MAX_RULES_PER_CREATOR} keyword rules.` });
      return;
    }
    const enabled = parsed.data.enabled ?? false;
    const [rule] = await db
      .insert(keywordAutomationRulesTable)
      .values({
        creatorUserId: req.userId!,
        keyword,
        dmBody: parsed.data.dmBody,
        surfaces: parsed.data.surfaces,
        captureEmail: parsed.data.captureEmail,
        listId: parsed.data.listId ?? null,
        enabled,
        enabledAt: enabled ? new Date() : null,
      })
      .returning();
    res.status(201).json({ rule: ruleDto(rule!) });
  } catch (err) {
    logger.error({ err }, "[keyword-automations] create rule failed");
    res.status(500).json({ error: "Couldn't save that keyword rule." });
  }
});

router.patch("/keyword-automations/rules/:id", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const rule = await loadOwnedRule(req, res, String(req.params["id"] ?? ""));
    if (!rule) return;
    const parsed = rulePatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid keyword rule update.", details: parsed.error.issues });
      return;
    }
    const patch: Partial<typeof keywordAutomationRulesTable.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.keyword !== undefined) {
      const keyword = normalizeKeyword(parsed.data.keyword);
      if (!keyword) {
        res.status(400).json({ error: "A keyword is one word — letters, numbers, _ or -, up to 40 characters." });
        return;
      }
      patch.keyword = keyword;
    }
    if (parsed.data.dmBody !== undefined) patch.dmBody = parsed.data.dmBody;
    if (parsed.data.surfaces !== undefined) patch.surfaces = parsed.data.surfaces;
    if (parsed.data.captureEmail !== undefined) patch.captureEmail = parsed.data.captureEmail;
    if (parsed.data.listId !== undefined) patch.listId = parsed.data.listId;

    const nextCapture = patch.captureEmail ?? rule.captureEmail;
    const nextList = patch.listId !== undefined ? patch.listId : rule.listId;
    const captureError = await validateCaptureTarget(req.userId!, nextList, nextCapture);
    if (captureError) {
      res.status(400).json({ error: captureError });
      return;
    }
    if (parsed.data.enabled !== undefined && parsed.data.enabled !== rule.enabled) {
      patch.enabled = parsed.data.enabled;
      /* Switching ON re-arms the gate at the switch-on moment, exactly
         like the email automations: nothing about the past fires. */
      if (parsed.data.enabled) patch.enabledAt = new Date();
    }
    const [fresh] = await db
      .update(keywordAutomationRulesTable)
      .set(patch)
      .where(eq(keywordAutomationRulesTable.id, rule.id))
      .returning();
    res.json({ rule: ruleDto(fresh ?? rule) });
  } catch (err) {
    logger.error({ err }, "[keyword-automations] update rule failed");
    res.status(500).json({ error: "Couldn't save that keyword rule." });
  }
});

router.delete("/keyword-automations/rules/:id", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const rule = await loadOwnedRule(req, res, String(req.params["id"] ?? ""));
    if (!rule) return;
    await db.delete(keywordAutomationRulesTable).where(eq(keywordAutomationRulesTable.id, rule.id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[keyword-automations] delete rule failed");
    res.status(500).json({ error: "Couldn't delete that keyword rule." });
  }
});

/** The audit log: every recorded fire for the caller's rules. */
router.get("/keyword-automations/events", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 50) || 50));
    const rows = await db
      .select({
        id: keywordAutomationEventsTable.id,
        ruleId: keywordAutomationEventsTable.ruleId,
        keyword: keywordAutomationRulesTable.keyword,
        fanUserId: keywordAutomationEventsTable.fanUserId,
        surface: keywordAutomationEventsTable.surface,
        surfaceRef: keywordAutomationEventsTable.surfaceRef,
        outcome: keywordAutomationEventsTable.outcome,
        capturedEmail: keywordAutomationEventsTable.capturedEmail,
        detail: keywordAutomationEventsTable.detail,
        createdAt: keywordAutomationEventsTable.createdAt,
      })
      .from(keywordAutomationEventsTable)
      .innerJoin(keywordAutomationRulesTable, eq(keywordAutomationEventsTable.ruleId, keywordAutomationRulesTable.id))
      .where(eq(keywordAutomationEventsTable.creatorUserId, req.userId!))
      .orderBy(desc(keywordAutomationEventsTable.createdAt))
      .limit(limit);
    res.json({ events: rows });
  } catch (err) {
    logger.error({ err }, "[keyword-automations] list events failed");
    res.status(500).json({ error: "Couldn't load the activity log." });
  }
});

export default router;
