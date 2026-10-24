/**
 * Fan segments — saved audiences over the One Fan Graph
 * (Stack-100 #3, fan-graph phase 2), docked in the email desk
 * beside GET /email-list/fan-graph.
 *
 *   GET    /api/email-list/fan-segments            saved segments + presets, each with LIVE count + preview
 *   POST   /api/email-list/fan-segments            save a segment (name + rules)
 *   PATCH  /api/email-list/fan-segments/:id        rename / re-rule a saved segment
 *   DELETE /api/email-list/fan-segments/:id        delete a saved segment
 *   POST   /api/email-list/fan-segments/preview    count + preview for a preset / saved / ad-hoc rule set
 *   POST   /api/email-list/fan-segments/send       one-click send through the existing email desk
 *
 * Saved rows live in `fan_segments`, whose migration is HELD for
 * the join (.lane/MIGRATION-NEEDED.md): until it lands, the saved
 * CRUD answers an honest 503 (code fan_segments_not_ready) while
 * presets, previews, and ad-hoc sends — which need no new table —
 * work fully. Nothing half-applies.
 *
 * Privacy: everything is scoped to the signed-in creator. The
 * graph is loadFanGraph(req.userId) — there is no creator-id
 * parameter — and the store filters every row by owner, so a
 * segment can only ever contain the caller's own fans.
 *
 * Sending: POST /send hands the segment's LIVE membership to the
 * existing desk via lib/fan-segment-send (a kind "fan_segment"
 * campaign on one of the caller's lists, dispatched through the
 * tracked rail). The desk's sending rules, provider gate, and
 * confirmations apply unchanged; unsubscribed fans are never
 * emailed (counted as not-mailable instead).
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { publicApiLimiter } from "../../lib/rate-limit";
import { loadFanGraph, type FanRecord } from "../../lib/fan-graph";
import {
  FAN_SEGMENT_PRESETS,
  fanSegmentPreset,
  normalizeFanSegmentRules,
  previewFanSegment,
  type FanSegmentRules,
} from "../../lib/fan-segments";
import {
  FanSegmentsUnavailableError,
  createFanSegment,
  deleteFanSegment,
  getFanSegment,
  listFanSegments,
  updateFanSegment,
} from "../../lib/fan-segment-store";
import { sendFanSegmentEmail } from "../../lib/fan-segment-send";

const router: IRouter = Router();

const NOT_READY = {
  error: "Saved fan segments aren't ready yet — they're still being set up. Presets and previews work now.",
  code: "fan_segments_not_ready",
} as const;

function fanDto(f: FanRecord) {
  return {
    id: f.id,
    displayName: f.displayName,
    email: f.email,
    follows: f.follows,
    subscribed: f.subscribed,
    member: f.member,
    spentUsdCents: f.spentUsdCents,
    spentVb: f.spentVb,
    purchaseCount: f.purchaseCount,
    lastActivityAt: f.lastActivityAt,
  };
}

/** Resolve a {presetId | segmentId | rules} reference to rules.
    Returns {rules} or an HTTP-ready failure. A saved-segment lookup
    runs the store (owner-scoped); presets and ad-hoc rules never
    touch the table. */
async function resolveRules(
  userId: string,
  ref: { presetId?: string; segmentId?: string; rules?: unknown },
): Promise<{ rules: FanSegmentRules; name: string } | { status: number; body: unknown }> {
  if (ref.presetId !== undefined) {
    const preset = fanSegmentPreset(ref.presetId);
    if (!preset) return { status: 400, body: { error: "Unknown preset segment.", code: "unknown_preset" } };
    return { rules: preset.rules, name: preset.name };
  }
  if (ref.segmentId !== undefined) {
    let seg;
    try {
      seg = await getFanSegment(userId, ref.segmentId);
    } catch (err) {
      if (err instanceof FanSegmentsUnavailableError) return { status: 503, body: NOT_READY };
      throw err;
    }
    if (!seg) return { status: 404, body: { error: "Segment not found." } };
    return { rules: seg.rules, name: seg.name };
  }
  if (ref.rules !== undefined) {
    const rules = normalizeFanSegmentRules(ref.rules);
    if (!rules) return { status: 400, body: { error: "Invalid segment rules.", code: "invalid_rules" } };
    return { rules, name: "Custom segment" };
  }
  return { status: 400, body: { error: "Name a preset, a saved segment, or a rule set.", code: "segment_ref_required" } };
}

const refSchema = z.object({
  presetId: z.string().min(1).max(60).optional(),
  segmentId: z.string().uuid().optional(),
  rules: z.unknown().optional(),
});

/* ── List: presets + saved, each with its LIVE count + preview ──── */

router.get("/email-list/fan-segments", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const { fans } = await loadFanGraph(req.userId!);
    const presets = FAN_SEGMENT_PRESETS.map((p) => {
      const { count, preview } = previewFanSegment(fans, p.rules);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        rules: p.rules,
        count,
        preview: preview.map(fanDto),
      };
    });
    let saved: unknown[] = [];
    let savedAvailable = true;
    try {
      const rows = await listFanSegments(req.userId!);
      saved = rows.map((s) => {
        const { count, preview } = previewFanSegment(fans, s.rules);
        return { ...s, count, preview: preview.map(fanDto) };
      });
    } catch (err) {
      if (err instanceof FanSegmentsUnavailableError) savedAvailable = false;
      else throw err;
    }
    res.json({ presets, saved, savedAvailable });
  } catch (err) {
    req.log?.error({ err }, "fan segments list failed");
    res.status(500).json({ error: "Couldn't load your fan segments." });
  }
});

/* ── Saved CRUD (503 until the fan_segments migration lands) ────── */

const saveSchema = z.object({
  name: z.string().trim().min(1, "Segment name is required.").max(80),
  rules: z.unknown(),
});

router.post("/email-list/fan-segments", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = saveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid segment.", details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  const rules = normalizeFanSegmentRules(parsed.data.rules);
  if (!rules) {
    res.status(400).json({ error: "Invalid segment rules.", code: "invalid_rules" });
    return;
  }
  try {
    const segment = await createFanSegment(req.userId!, parsed.data.name, rules);
    const { fans } = await loadFanGraph(req.userId!);
    const { count, preview } = previewFanSegment(fans, segment.rules);
    res.status(201).json({ segment: { ...segment, count, preview: preview.map(fanDto) } });
  } catch (err) {
    if (err instanceof FanSegmentsUnavailableError) {
      res.status(503).json(NOT_READY);
      return;
    }
    throw err;
  }
});

router.patch("/email-list/fan-segments/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const parsed = saveSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid segment update." });
    return;
  }
  let rules: FanSegmentRules | undefined;
  if (parsed.data.rules !== undefined) {
    rules = normalizeFanSegmentRules(parsed.data.rules) ?? undefined;
    if (!rules) {
      res.status(400).json({ error: "Invalid segment rules.", code: "invalid_rules" });
      return;
    }
  }
  try {
    const segment = await updateFanSegment(req.userId!, id, { name: parsed.data.name, rules });
    if (!segment) {
      res.status(404).json({ error: "Segment not found." });
      return;
    }
    const { fans } = await loadFanGraph(req.userId!);
    const { count, preview } = previewFanSegment(fans, segment.rules);
    res.json({ segment: { ...segment, count, preview: preview.map(fanDto) } });
  } catch (err) {
    if (err instanceof FanSegmentsUnavailableError) {
      res.status(503).json(NOT_READY);
      return;
    }
    throw err;
  }
});

router.delete("/email-list/fan-segments/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  try {
    const deleted = await deleteFanSegment(req.userId!, id);
    if (!deleted) {
      res.status(404).json({ error: "Segment not found." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof FanSegmentsUnavailableError) {
      res.status(503).json(NOT_READY);
      return;
    }
    throw err;
  }
});

/* ── Preview: count + preview list, nothing sent ─────────────────── */

router.post("/email-list/fan-segments/preview", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = refSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid preview request." });
    return;
  }
  const resolved = await resolveRules(req.userId!, parsed.data);
  if ("status" in resolved) {
    res.status(resolved.status).json(resolved.body);
    return;
  }
  const { fans } = await loadFanGraph(req.userId!);
  const { count, preview } = previewFanSegment(fans, resolved.rules, { limit: 10 });
  res.json({ name: resolved.name, rules: resolved.rules, count, preview: preview.map(fanDto) });
});

/* ── One-click send through the existing desk ────────────────────── */

const sendSchema = refSchema.extend({
  listId: z.string().uuid(),
  subject: z.string().trim().min(1, "Subject is required.").max(200),
  body: z.string().min(1, "Body is required.").max(50000),
});

router.post("/email-list/fan-segments/send", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = sendSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid send request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const resolved = await resolveRules(req.userId!, parsed.data);
  if ("status" in resolved) {
    res.status(resolved.status).json(resolved.body);
    return;
  }
  const result = await sendFanSegmentEmail({
    creatorUserId: req.userId!,
    listId: parsed.data.listId,
    rules: resolved.rules,
    subject: parsed.data.subject,
    body: parsed.data.body,
  });
  if (!result.ok) {
    res.status(404).json({ error: result.error, code: result.code });
    return;
  }
  res.status(201).json({
    campaign: result.campaign,
    dispatch: result.dispatch,
    segment: {
      name: resolved.name,
      matchedFans: result.segment.matchedFans,
      mailable: result.segment.audience.length,
      notMailable: result.segment.notMailable,
    },
  });
});

export default router;
