import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import {
  bgImageProviderConfigured,
  bgImageProviderName,
  BgImageNotConfiguredError,
  BgImageNotImplementedError,
  generateBackgroundImage,
} from "../../lib/bg-image-client";

const router = Router();

/**
 * PLACEHOLDER price — Visual Bucs, per AI-generated background plate.
 * NOT FINAL: the user must approve the real price (and the image provider
 * + key) before this goes live. Chosen to match Images Pro (2 cr = 200 VB).
 * Do NOT add to credit-costs.ts until the user approves the price.
 */
export const BG_GENERATE_CREDIT_COST = 200; // PLACEHOLDER — needs user price approval

export const BG_GENERATE_STYLES = ["studio", "neon-city", "golden-palace", "beach-sunset"] as const;

const bgGenerateSchema = z.object({
  prompt: z.string().min(3).max(500),
  style: z.enum(BG_GENERATE_STYLES).optional(),
});

/* ── Routes ─────────────────────────────────────────────────────────── */

/**
 * GET /api/bg-generate/status
 * Public gate check for the UI: is an image provider key configured?
 * Never 503s — the frontend disables the Generate button when
 * configured === false.
 */
router.get("/bg-generate/status", requireAuth, async (_req: Request, res: Response) => {
  res.json({
    configured: bgImageProviderConfigured(),
    provider: bgImageProviderName(),
    styles: BG_GENERATE_STYLES,
    creditCost: BG_GENERATE_CREDIT_COST,
    pricePlaceholder: true,
  });
});

/**
 * POST /api/bg-generate
 *
 * AI-generate a background plate ({prompt, style} → {imageUrl}) for the
 * video editor's background-replace feature. The returned plate feeds the
 * existing ON-DEVICE MediaPipe composite pipeline — nothing is re-encoded
 * or uploaded here.
 *
 * GATED: returns 503 BG_IMAGE_PROVIDER_NOT_CONFIGURED when no provider key
 * exists. When a key exists but the provider submit is still stubbed,
 * returns 501 BG_IMAGE_PROVIDER_NOT_IMPLEMENTED. In BOTH cases no job is
 * created, no credits are charged, and ZERO paid provider calls are made.
 */
router.post("/bg-generate", requireAuth, async (req: Request, res: Response) => {
  if (!bgImageProviderConfigured()) {
    const err = new BgImageNotConfiguredError();
    res.status(503).json({ error: err.code, message: err.message });
    return;
  }

  const parsed = bgGenerateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_BODY",
      message: "prompt (3–500 chars) is required; style must be one of the listed presets.",
    });
    return;
  }

  // NOTE: no credit charge here — the provider submit is a stub. Charging
  // happens only once a real provider is wired AND the user has approved
  // the price (see BG_GENERATE_CREDIT_COST). Never charge for a stub.
  try {
    const result = await generateBackgroundImage({
      prompt: parsed.data.prompt,
      style: parsed.data.style ?? "studio",
      userId: req.userId!,
    });
    res.json({ imageUrl: result.imageUrl });
  } catch (err) {
    if (err instanceof BgImageNotImplementedError) {
      res.status(501).json({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof BgImageNotConfiguredError) {
      res.status(503).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({
      error: "BG_GENERATE_FAILED",
      message: err instanceof Error ? err.message : "Background generation failed.",
    });
  }
});

export default router;
