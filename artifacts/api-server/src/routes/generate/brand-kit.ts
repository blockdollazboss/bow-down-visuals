import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  applyBrandKitToTheme,
  blankBrandKit,
  mergeGeneratedKit,
  readBrandKit,
  writeBrandKit,
  type StoredBrandKit,
} from "../../lib/brand-record";

const router = Router();

/* ─── Brand kit — ONE source of truth for the creator's brand ───
   POST /api/brand-kit          generate a kit (200 Visual Bucs, charged
                                exactly as before, only on generation) and
                                PERSIST it to the creator's brand record
                                (creator_profiles.theme_config.brandKit).
   GET  /api/brand-kit          read the saved kit back — free, no charge.
                                This is the read every consumer uses: the
                                editor's branding picker, the Intros logo
                                field, press kit, link-in-bio.
   PUT  /api/brand-kit          save manual fields (logo, chosen tagline,
                                bio lines, press facts) — free, no charge.
   POST /api/brand-kit/apply    write the kit's colors + fonts into the
                                profile's live theme values — free.

   Linkage fix (audit DE-5): this endpoint used to generate and throw the
   kit away; the logo was a paste-a-URL field in Intros and a fresh upload
   in the editor, and bio/press were re-typed copies of the profile. */

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

/* ── GET /api/brand-kit — the saved kit (free read for every consumer) ── */
router.get("/brand-kit", requireAuth, async (req, res) => {
  try {
    const brandKit = await readBrandKit(req.userId!);
    res.json({ brandKit });
  } catch (err) {
    req.log.error({ err }, "[brand-kit] read failed");
    res.status(500).json({ error: "Couldn't load your brand kit. Please try again." });
  }
});

/* ── PUT /api/brand-kit — manual fields, saved free ────────────────────── */
const brandKitPatchSchema = z
  .object({
    brandName: z.string().trim().min(1).max(120).optional(),
    logoUrl: z.string().trim().max(2000).nullable().optional(),
    selectedTagline: z.string().trim().max(240).nullable().optional(),
    bioLines: z.array(z.string().trim().min(1).max(400)).max(8).optional(),
    pressFacts: z.array(z.string().trim().min(1).max(300)).max(16).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Send at least one field to save." });

router.put("/brand-kit", requireAuth, async (req, res) => {
  const parsed = brandKitPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  try {
    const nowIso = new Date().toISOString();
    const existing = await readBrandKit(req.userId!);
    const next: StoredBrandKit = { ...(existing ?? blankBrandKit(nowIso)), updatedAt: nowIso };
    const patch = parsed.data;
    if (patch.brandName !== undefined) next.brandName = patch.brandName;
    if (patch.logoUrl !== undefined) next.logoUrl = patch.logoUrl || null;
    if (patch.selectedTagline !== undefined) next.selectedTagline = patch.selectedTagline || null;
    if (patch.bioLines !== undefined) next.bioLines = patch.bioLines;
    if (patch.pressFacts !== undefined) next.pressFacts = patch.pressFacts;
    const saved = await writeBrandKit(req.userId!, next);
    if (!saved) {
      res.status(404).json({
        error: "NO_PROFILE",
        message: "Create your creator profile first — your brand kit saves onto it.",
      });
      return;
    }
    res.json({ brandKit: next });
  } catch (err) {
    req.log.error({ err }, "[brand-kit] save failed");
    res.status(500).json({ error: "Couldn't save your brand kit. Please try again." });
  }
});

/* ── POST /api/brand-kit/apply — kit → live profile theme (free) ─────── */
router.post("/brand-kit/apply", requireAuth, async (req, res) => {
  try {
    const result = await applyBrandKitToTheme(req.userId!);
    if (result.status === "no_profile") {
      res.status(404).json({
        error: "NO_PROFILE",
        message: "Create your creator profile first — the kit applies onto it.",
      });
      return;
    }
    if (result.status === "no_kit") {
      res.status(409).json({
        error: "NO_KIT",
        message: "Generate a brand kit first — there's nothing to apply yet.",
      });
      return;
    }
    res.json({ applied: true, brandKit: result.kit });
  } catch (err) {
    req.log.error({ err }, "[brand-kit] apply failed");
    res.status(500).json({ error: "Couldn't apply your brand kit. Please try again." });
  }
});

/* ── POST /api/brand-kit — generate (200 VB) + persist ────────────────── */
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

    /* Persist onto the creator's brand record — the step that makes this
       the source of truth instead of a one-shot answer. Manual fields
       from any earlier kit (logo, tagline pick, bio lines, press facts)
       survive. A creator with no profile yet still gets their kit in the
       response; `saved: false` says plainly it wasn't stored. A storage
       hiccup never fails a generation the creator already paid for. */
    let brandKit: StoredBrandKit | null = null;
    let saved = false;
    try {
      const existing = await readBrandKit(req.userId!);
      brandKit = mergeGeneratedKit(existing, { brandName, vibe, industry }, kit, new Date().toISOString());
      saved = await writeBrandKit(req.userId!, brandKit);
      if (!saved) brandKit = null;
    } catch (persistErr) {
      req.log.error({ err: persistErr }, "[brand-kit] generated but could not persist");
      brandKit = null;
      saved = false;
    }

    res.json({
      brandName,
      kit,
      brandKit,
      saved,
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
