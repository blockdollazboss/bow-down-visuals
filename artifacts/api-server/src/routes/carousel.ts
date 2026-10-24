import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, buildChargeIdempotencyKey } from "../lib/credits.js";
import { aiDisclosureMetadataText, PROVENANCE_PLATFORM } from "../lib/provenance";

const router = Router();

/** The disclosure payload for a carousel export (lane F7 kit,
    more-provenance follow-up). Carousel slides render client-side
    (canvas → PNG in the browser), so the PNG bytes never pass through
    this server: the stamp is applied by the client into each slide's
    PNG metadata before download, using exactly this text/tool. The
    server states what was requested and hands over the payload — it
    never claims the stamp itself happened here. */
export function carouselDisclosurePayload(aiDisclosureEnabled: boolean) {
  if (!aiDisclosureEnabled) return null;
  return {
    text: aiDisclosureMetadataText({
      createdWith: { tool: "Carousel Maker", model: null, platform: PROVENANCE_PLATFORM },
    }),
    tool: "Carousel Maker",
  };
}

/**
 * POST /api/carousel/export
 * Charges 100 Visual Bucs for a carousel PNG export. The actual slide
 * rendering is client-side (canvas → PNG); this endpoint records the
 * spend so the ledger stays honest (strict ledger + idempotency).
 *
 * AI disclosure (lane F7 kit): aiDisclosure absent = ON (the client
 * stamps the disclosure into every downloaded slide's PNG metadata);
 * an explicit false opts out and no payload is returned.
 */
router.post("/carousel/export", requireAuth, async (req, res) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    const slideCount = Math.min(Math.max(Number(req.body?.slideCount) || 1, 1), 10);
    const aiDisclosureEnabled = (req.body as { aiDisclosure?: unknown } | undefined)?.aiDisclosure !== false;
    /* Derive the idempotency key server-side when the client sends none
       (U1) — a retry of the same export can't double-charge. */
    const clientKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey : null;
    const idempotencyKey = buildChargeIdempotencyKey("carousel_export", userId, clientKey, { slideCount });
    const newBalance = await chargeCredits(
      userId,
      100,
      { action: "carousel_export" },
      { idempotencyKey, personalOnly: true },
    );
    res.json({
      ok: true,
      slideCount,
      charged: 100,
      balance: newBalance,
      aiDisclosure: aiDisclosureEnabled ? "requested" : "off",
      disclosure: carouselDisclosurePayload(aiDisclosureEnabled),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    const status = /insufficient|balance/i.test(message) ? 402 : 500;
    res.status(status).json({ ok: false, error: message });
  }
});

export default router;
