import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

/* ─── AI brand kit generator ───
   Generates a complete brand kit from a brand name + vibe: color palette,
   font pairings, logo concept prompt, and tagline suggestions.
   200 Visual Bucs. */

const BRAND_KIT_COST = Number(process.env["BRAND_KIT_CREDITS"]) || 200;

const brandKitSchema = z.object({
  brandName: z.string().trim().min(1).max(80),
  vibe: z.string().trim().min(3).max(500),
  /** industry helps tune the palette and tone */
  industry: z.string().trim().max(80).optional().default(""),
});

const brandKitJsonSchema = z.object({
  colors: z
    .array(
      z.object({
        hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        name: z.string(),
        role: z.string(),
      })
    )
    .length(5),
  fonts: z
    .array(
      z.object({
        heading: z.string(),
        body: z.string(),
        usage: z.string(),
      })
    )
    .length(3),
  logoPrompt: z.string(),
  taglines: z.array(z.string()).length(5),
});

type BrandKit = z.infer<typeof brandKitJsonSchema>;

router.post("/brand-kit", requireAuth, async (req, res) => {
  const parsed = brandKitSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < BRAND_KIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, BRAND_KIT_COST, {
      action: "Brand Kit Generator",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    const { brandName, vibe, industry } = parsed.data;

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a professional brand identity designer. Create complete, original brand kits. Return ONLY valid JSON with this exact shape:
{
  "colors": [
    {"hex": "#RRGGBB", "name": "Name", "role": "primary|secondary|accent|neutral|background"},
    ... exactly 5 colors covering primary, secondary, accent, neutral, and background
  ],
  "fonts": [
    {"heading": "Google Font name", "body": "Google Font name", "usage": "when to use this pairing"},
    ... exactly 3 distinct pairings, fonts must exist on Google Fonts
  ],
  "logoPrompt": "a detailed image-generation prompt for a logo (style, colors, composition, mood)",
  "taglines": ["tagline 1", ... exactly 5 punchy original taglines]
}`,
        },
        {
          role: "user",
          content: `Create a brand kit for "${brandName}"${industry ? `\nIndustry: ${industry}` : ""}\nVibe: "${vibe}"\n\nMake the palette cohesive and distinctive. Taglines should be short, memorable, and match the vibe.`,
        },
      ],
      max_completion_tokens: 2000,
      temperature: 0.8,
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) throw new Error("Brand kit generation returned empty.");

    let kit: BrandKit;
    try {
      kit = brandKitJsonSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error("Brand kit came back malformed. Please try again.");
    }

    res.json({
      brandName,
      kit,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Brand kit generation failed.";
    req.log.error({ err: message }, "[brand-kit] failed");
    await refundCredits(req.userId!, BRAND_KIT_COST, {
      action: "Brand Kit Generator — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
