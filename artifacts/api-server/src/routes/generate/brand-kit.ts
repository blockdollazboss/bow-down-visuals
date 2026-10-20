import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { normalizeToStorageRef, uploadPublicMediaToR2 } from "../../lib/objectStorage";
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
                                bio lines, press facts) AND the palette +
                                font pairings themselves — the creator can
                                retune colors/fonts by hand after a
                                generation instead of paying to regenerate —
                                free, no charge.
   POST /api/brand-kit/logo     save a generated logo as the kit's logo
                                (replaces the current one; external URLs
                                are re-hosted into permanent storage
                                first) — free, no charge.
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

/* ── PUT /api/brand-kit — manual fields, saved free ──────────────────────
   Colors and fonts are patchable too (Ring 4): the generated palette was
   previously display-only — the only way to change a hex was paying 200
   VB to regenerate and hoping. A patch REPLACES the palette / pairings
   wholesale (same discipline as bioLines/pressFacts). Roles come from
   the generator's own vocabulary and must be unique within the palette:
   consumers resolve colors BY role (apply-to-theme, the UGC snapshot's
   primary), so two colors claiming one role would be ambiguous. */
export const BRAND_COLOR_ROLES = ["primary", "secondary", "accent", "neutral", "background"] as const;

const brandColorPatchSchema = z.object({
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  name: z.string().trim().min(1).max(80),
  role: z.enum(BRAND_COLOR_ROLES),
});

const brandFontPatchSchema = z.object({
  heading: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(120),
  usage: z.string().trim().max(240).optional().default(""),
});

const brandKitPatchSchema = z
  .object({
    brandName: z.string().trim().min(1).max(120).optional(),
    logoUrl: z.string().trim().max(2000).nullable().optional(),
    selectedTagline: z.string().trim().max(240).nullable().optional(),
    bioLines: z.array(z.string().trim().min(1).max(400)).max(8).optional(),
    pressFacts: z.array(z.string().trim().min(1).max(300)).max(16).optional(),
    colors: z
      .array(brandColorPatchSchema)
      .min(1)
      .max(6)
      .refine((cs) => new Set(cs.map((c) => c.role)).size === cs.length, {
        message: "Each color role can appear once — consumers read colors by role.",
      })
      .optional(),
    fonts: z.array(brandFontPatchSchema).min(1).max(3).optional(),
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
    if (patch.colors !== undefined) next.colors = patch.colors;
    if (patch.fonts !== undefined) next.fonts = patch.fonts;
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

/* ── POST /api/brand-kit/logo — a generated logo lands in the kit ─────
   The kit holds ONE logo (logoUrl): saving replaces the current one, so
   a second save can never duplicate. Free — no charge.

   Mirror-on-save (owner law, 2026-10-13): the kit never stores a temp
   URL. A logo URL already on our own storage is permanent as-is; any
   other http(s) URL (the logo generator's raw provider fallback is the
   live case) is downloaded and re-hosted into the same bucket the logo
   generator writes to, and the PERMANENT public URL is what the kit
   stores. Re-hosting is best-effort exactly like mirrorMedia: a failed
   re-host keeps the original value, logs loudly, and never fails a save
   the creator asked for — `mirrored` in the response says which
   happened. */
const GENERATED_LOGOS_BUCKET = "generated-clips"; // generate/logo.ts LOGO_BUCKET
const LOGO_MIRROR_MAX_BYTES = 200 * 1024 * 1024; // mirrorMedia's house cap
const LOGO_EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const brandKitLogoSchema = z.object({
  logoUrl: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((v) => /^https?:\/\//i.test(v), { message: "logoUrl must be an http(s) URL." }),
});

function isPermanentLogoUrl(logoUrl: string): boolean {
  if (logoUrl.startsWith("r2://") || logoUrl.startsWith("supabase://")) return true;
  const ref = normalizeToStorageRef(logoUrl);
  return ref !== null && ref !== logoUrl;
}

async function permanentLogoUrl(
  userId: string,
  logoUrl: string,
  log: { error: (obj: unknown, msg?: string) => void },
): Promise<{ url: string; mirrored: boolean }> {
  if (isPermanentLogoUrl(logoUrl)) return { url: logoUrl, mirrored: false };
  try {
    const res = await fetch(logoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`source answered ${res.status}`);
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (contentType && !contentType.startsWith("image/")) {
      throw new Error(`source is not an image (${contentType})`);
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > LOGO_MIRROR_MAX_BYTES) throw new Error("source too large");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > LOGO_MIRROR_MAX_BYTES) throw new Error("bad payload");
    const ext = LOGO_EXT_BY_CONTENT_TYPE[contentType] ?? "png";
    const url = await uploadPublicMediaToR2(
      GENERATED_LOGOS_BUCKET,
      `logos/${userId}/${randomUUID()}.${ext}`,
      buf,
      contentType || "image/png",
    );
    return { url, mirrored: true };
  } catch (err) {
    log.error({ err, userId }, "[brand-kit] logo re-host failed — storing the original URL");
    return { url: logoUrl, mirrored: false };
  }
}

router.post("/brand-kit/logo", requireAuth, async (req, res) => {
  const parsed = brandKitLogoSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  try {
    const existing = await readBrandKit(req.userId!);
    const { url: storedUrl, mirrored } = await permanentLogoUrl(req.userId!, parsed.data.logoUrl, req.log);
    const replaced = !!existing?.logoUrl && existing.logoUrl !== storedUrl;
    const nowIso = new Date().toISOString();
    const next: StoredBrandKit = {
      ...(existing ?? blankBrandKit(nowIso)),
      logoUrl: storedUrl,
      updatedAt: nowIso,
    };
    const saved = await writeBrandKit(req.userId!, next);
    if (!saved) {
      res.status(404).json({
        error: "NO_PROFILE",
        message: "Create your creator profile first — your brand kit saves onto it.",
      });
      return;
    }
    res.json({ brandKit: next, logoUrl: storedUrl, mirrored, replaced });
  } catch (err) {
    req.log.error({ err }, "[brand-kit] logo save failed");
    res.status(500).json({ error: "Couldn't save the logo to your brand kit. Please try again." });
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
