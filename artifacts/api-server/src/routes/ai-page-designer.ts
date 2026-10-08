import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import multer from "multer";
import { randomUUID } from "crypto";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";
import { getSupabaseAdmin } from "../lib/supabase-admin";

/* ─── AI Page Designer ────────────────────────────────────────────────────
   The flagship of creator profiles — and the DEFAULT setup path (manual
   editing is the advanced option). One "Describe your vibe" textarea, one
   click, and the creator gets a full theme_config + sections layout back,
   a preview, and a Regenerate option.

   ALL-CREATOR platform: music, video, gaming, podcast, film, tv, influencer,
   education, other — everything on the site. The designer takes the creator's
   vertical up front and designs accordingly: a gamer's "describe your vibe"
   produces a stream-first page; an influencer's leads with the media kit.
   Layout order, section titles, and bio voice are all tuned per vertical.
   Copy stays audience-agnostic: "fans", "audience", "community" — never
   assuming music-only.

   Safety rules (standing):
   - Themes are SAFE TOKENS ONLY (colors, fonts, backgrounds, spacing scale,
     corner radius, overlay opacity). No freeform CSS — custom themes must
     never be able to break layout, mobile or otherwise.
   - Every AI call: 402 pre-check → charge BEFORE the call → refund on failure.
   - Missing OPENAI_API_KEY fails cleanly and names the env var.

   Endpoints (mount at /api/ai-page-designer — coordinator wires routes/index.ts):
     GET  /vertical-hints?vertical=     free  — layout order, voice, bio prompts
     POST /theme                        400 VB — full theme_config + sections
     POST /bio                          100 VB — AI bio writer
     POST /banner                       200 VB — AI banner art (image model) */

const router = Router();

const THEME_CREDITS = Number(process.env["AI_PAGE_DESIGNER_THEME_CREDITS"]) || 400;
const BIO_CREDITS = Number(process.env["AI_PAGE_DESIGNER_BIO_CREDITS"]) || 100;
const BANNER_CREDITS = Number(process.env["AI_PAGE_DESIGNER_BANNER_CREDITS"]) || 200;
const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL_25"] || "gpt-image-2.5-sunburst";
const BANNER_BUCKET = "artist-references";

const VERTICALS = [
  "music",
  "video",
  "gaming",
  "podcast",
  "film",
  "tv",
  "influencer",
  "education",
  "other",
] as const;
type Vertical = (typeof VERTICALS)[number];

const verticalSchema = z.enum(VERTICALS);

/* ─── Safe theme tokens (validated server-side — no freeform CSS ever) ─── */
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a #RRGGBB hex value.");

const SAFE_FONTS = [
  "Cinzel",
  "Playfair Display",
  "Bebas Neue",
  "DM Serif Display",
  "Space Grotesk",
  "Inter",
] as const;

const themeConfigSchema = z.object({
  themeId: z.string().trim().min(1).max(60).default("custom"),
  colors: z.object({
    background: hexColor,
    surface: hexColor,
    primary: hexColor,
    accent: hexColor,
    text: hexColor,
    mutedText: hexColor,
    cardBg: hexColor,
    border: hexColor,
  }),
  fonts: z.object({
    heading: z.enum(SAFE_FONTS),
    body: z.enum(SAFE_FONTS),
  }),
  banner: z.object({
    layout: z.enum(["full-bleed", "contained", "split"]),
    overlayOpacity: z.number().min(0).max(0.85),
  }),
  spacing: z.enum(["compact", "comfortable", "roomy"]),
  cornerRadius: z.enum(["sharp", "rounded", "pill"]),
});

/* Every section type stays available to every creator — verticals only
   change the DEFAULT order and titles. */
const SECTION_TYPES = [
  "hero",
  "tracks",
  "videos",
  "series",
  "merch",
  "events",
  "schedule",
  "mediakit",
  "posts",
  "bio",
  "shoutwall",
  "topcreators",
] as const;

const sectionSchema = z.object({
  id: z.string().trim().min(1).max(60),
  type: z.enum(SECTION_TYPES),
  title: z.string().trim().min(1).max(80),
  visible: z.boolean().default(true),
});

/* Per-vertical default layouts — the heuristic layer. The text model
   refines from these; the client mirrors them as instant starter templates. */
const VERTICAL_LAYOUTS: Record<
  Vertical,
  { sections: string[]; voice: string; tip: string }
> = {
  music: {
    sections: ["hero", "tracks", "videos", "merch", "events", "bio", "shoutwall", "posts", "topcreators"],
    voice: "bold and magnetic — headline energy, tour-ready confidence",
    tip: "Music-first: your featured track up top, then the catalog — fans press play in one tap.",
  },
  video: {
    sections: ["hero", "videos", "series", "merch", "bio", "shoutwall", "posts", "topcreators", "events"],
    voice: "high-energy and clickable — hook them in the first line",
    tip: "Video-first wins: featured video hero, then series and playlists above the fold.",
  },
  gaming: {
    sections: ["hero", "videos", "schedule", "series", "merch", "bio", "shoutwall", "posts", "topcreators"],
    voice: "live-wire hype — chat energy, clutch-moment swagger",
    tip: "Stream-first: the stream hero shows your schedule and live state, then clips and highlights.",
  },
  podcast: {
    sections: ["hero", "tracks", "series", "videos", "bio", "events", "merch", "shoutwall", "posts", "topcreators"],
    voice: "conversational and curious — the voice people trust on long drives",
    tip: "Episodes-first: latest episodes up top, series grouped underneath for the binge.",
  },
  film: {
    sections: ["hero", "series", "videos", "bio", "events", "merch", "shoutwall", "posts", "topcreators"],
    voice: "cinematic and prestigious — festival-program confidence",
    tip: "Trailer hero, then the filmography as series/seasons — behind-the-scenes after.",
  },
  tv: {
    sections: ["hero", "series", "videos", "bio", "events", "merch", "shoutwall", "posts", "topcreators"],
    voice: "episodic and bingeable — 'next episode' energy",
    tip: "Same episodic treatment as film: trailer hero, seasons grouped, extras below.",
  },
  influencer: {
    sections: ["hero", "mediakit", "videos", "tracks", "merch", "bio", "shoutwall", "posts", "topcreators", "events"],
    voice: "polished and brand-safe — partnership-ready confidence",
    tip: "Media-kit first: brands see your stats and rates immediately, then the content that proves it.",
  },
  education: {
    sections: ["hero", "videos", "series", "merch", "bio", "events", "shoutwall", "posts", "topcreators", "tracks"],
    voice: "clear, credible, encouraging — the teacher everyone wishes they had",
    tip: "Featured lesson hero, then the course library — proof of value first, story after.",
  },
  other: {
    sections: ["hero", "videos", "tracks", "bio", "merch", "events", "shoutwall", "posts", "topcreators", "series"],
    voice: "warm and real — let the personality lead",
    tip: "Balanced default: hero, best content, then your story. Rearrange anything.",
  },
};

const SECTION_LABELS: Record<Vertical, Record<string, string>> = {
  music: {
    hero: "Featured Track", tracks: "Music", videos: "Videos", series: "Series",
    merch: "Merch Shelf", events: "Tour Dates", schedule: "Schedule", mediakit: "Media Kit",
    bio: "About", shoutwall: "Shout Wall", posts: "Latest Posts", topcreators: "Top Creators",
  },
  video: {
    hero: "Featured Video", tracks: "Audio", videos: "Videos", series: "Series & Playlists",
    merch: "Merch Shelf", events: "Events", schedule: "Schedule", mediakit: "Media Kit",
    bio: "About", shoutwall: "Shout Wall", posts: "Latest Posts", topcreators: "Top Creators",
  },
  gaming: {
    hero: "Stream", tracks: "Hype Tracks", videos: "Clips & Highlights", series: "Series",
    merch: "Merch Shelf", events: "Events", schedule: "Stream Schedule", mediakit: "Media Kit",
    bio: "About", shoutwall: "Shout Wall", posts: "Latest Posts", topcreators: "Top Creators",
  },
  podcast: {
    hero: "Featured Episode", tracks: "Episodes", videos: "Video Clips", series: "Series",
    merch: "Merch Shelf", events: "Live Shows", schedule: "Release Schedule", mediakit: "Media Kit",
    bio: "About the Show", shoutwall: "Shout Wall", posts: "Latest Posts", topcreators: "Top Creators",
  },
  film: {
    hero: "Featured Trailer", tracks: "Soundtrack", videos: "Behind the Scenes", series: "Films & Seasons",
    merch: "Merch Shelf", events: "Premieres", schedule: "Schedule", mediakit: "Media Kit",
    bio: "About", shoutwall: "Shout Wall", posts: "Latest Posts", topcreators: "Top Creators",
  },
  tv: {
    hero: "Featured Trailer", tracks: "Soundtrack", videos: "Behind the Scenes", series: "Seasons & Episodes",
    merch: "Merch Shelf", events: "Premieres", schedule: "Air Schedule", mediakit: "Media Kit",
    bio: "About", shoutwall: "Shout Wall", posts: "Latest Posts", topcreators: "Top Creators",
  },
  influencer: {
    hero: "Featured", tracks: "Audio", videos: "Content", series: "Series",
    merch: "My Picks", events: "Appearances", schedule: "Schedule", mediakit: "Media Kit",
    bio: "About", shoutwall: "Shout Wall", posts: "Latest Posts", topcreators: "Top Creators",
  },
  education: {
    hero: "Featured Lesson", tracks: "Audio Lessons", videos: "Lessons", series: "Courses",
    merch: "Resources", events: "Workshops", schedule: "Class Schedule", mediakit: "Media Kit",
    bio: "About", shoutwall: "Shout Wall", posts: "Latest Posts", topcreators: "Top Creators",
  },
  other: {
    hero: "Featured", tracks: "Audio", videos: "Videos", series: "Series",
    merch: "Merch Shelf", events: "Events", schedule: "Schedule", mediakit: "Media Kit",
    bio: "About", shoutwall: "Shout Wall", posts: "Latest Posts", topcreators: "Top Creators",
  },
};

/* GET /vertical-hints — free heuristics for the designer's instant
   starter templates (no AI call, no charge). */
router.get("/vertical-hints", (req, res) => {
  const vertical = verticalSchema.safeParse(req.query["vertical"]);
  const v: Vertical = vertical.success ? vertical.data : "music";
  res.json({
    vertical: v,
    verticals: VERTICALS.map((id) => ({
      id,
      sectionOrder: VERTICAL_LAYOUTS[id].sections,
      labels: SECTION_LABELS[id],
      voice: VERTICAL_LAYOUTS[id].voice,
      tip: VERTICAL_LAYOUTS[id].tip,
    })),
  });
});

/* ─── Paid helper: 402 pre-check + charge + refund-on-failure ─── */
async function precheckAndCharge(
  req: { userCredits?: number; userId?: string },
  res: { status: (c: number) => { json: (b: unknown) => void } },
  cost: number,
  action: string
): Promise<number | null> {
  if ((req.userCredits ?? 0) < cost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs — top up to use the AI Page Designer.",
    });
    return null;
  }
  try {
    return await chargeCredits(req.userId!, cost, { action });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs — top up to use the AI Page Designer.",
      });
      return null;
    }
    throw err;
  }
}

async function refundOnFail(userId: string, cost: number, action: string, logCtx: object) {
  logger.error(logCtx, `[ai-page-designer] ${action} failed — refunding`);
  try {
    await refundCredits(userId, cost, { action: `${action} — Refund` });
  } catch (refundErr) {
    logger.error(
      { userId, cost, refundErr },
      "[ai-page-designer] CRITICAL: refund failed after generation failure"
    );
  }
}

function openAiUnavailable(res: { status: (c: number) => { json: (b: unknown) => void } }): boolean {
  /* getOpenAI() throws naming OPENAI_API_KEY when the key is missing. */
  try {
    getOpenAI();
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      error: "ai_unavailable",
      message: msg.includes("OPENAI_API_KEY")
        ? "OPENAI_API_KEY is not configured — the AI Page Designer is unavailable."
        : "The AI Page Designer is unavailable right now.",
    });
    return true;
  }
}

/* ─── POST /theme — the flagship: vibe description → full design ─── */
const themeRequestSchema = z.object({
  vertical: verticalSchema,
  vibe: z.string().trim().min(10, "Describe your vibe in a sentence or two.").max(800),
  displayName: z.string().trim().min(1).max(80),
  palette: z.array(hexColor).max(6).optional().default([]),
  baseThemeId: z.string().trim().max(60).optional(),
  regenerate: z.boolean().optional().default(false),
});

router.post("/theme", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = themeRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid designer request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (openAiUnavailable(res)) return;

  const remaining = await precheckAndCharge(req, res, THEME_CREDITS, "AI Page Designer — Theme");
  if (remaining === null) return;
  const { vertical, vibe, displayName, palette, baseThemeId, regenerate } = parsed.data;
  const hints = VERTICAL_LAYOUTS[vertical];
  const labels = SECTION_LABELS[vertical];

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are the AI Page Designer for Bow Down Visuals — "the cheat code, the best ` +
            `thing that hit the internet. All in one, everything you need. It should feel ` +
            `illegal." You design public creator profile pages with confident, sharp, ` +
            `playful cheat-code energy. This creator's vertical is "${vertical}". ` +
            `Design voice for this vertical: ${hints.voice}. ` +
            `Copy must be audience-agnostic: say "fans", "audience", or "community" — ` +
            `never assume the creator only makes music. ` +
            `Layout guidance (refine it, don't just copy): sections should flow in roughly ` +
            `this order — ${hints.sections.join(", ")}. Every section type is available; ` +
            `only include sections that serve this creator (a gamer gets "schedule", an ` +
            `influencer gets "mediakit" near the top, film/tv get "series" for seasons). ` +
            `You must return ONLY valid JSON with this exact shape:\n` +
            `{ "themeConfig": { "themeId": "<'custom' or a preset id>", ` +
            `"colors": { "background": "#RRGGBB", "surface": "#RRGGBB", "primary": "#RRGGBB", ` +
            `"accent": "#RRGGBB", "text": "#RRGGBB", "mutedText": "#RRGGBB", ` +
            `"cardBg": "#RRGGBB", "border": "#RRGGBB" }, ` +
            `"fonts": { "heading": "<one of: ${SAFE_FONTS.join(", ")}>", ` +
            `"body": "<one of: ${SAFE_FONTS.join(", ")}>" }, ` +
            `"banner": { "layout": "<full-bleed | contained | split>", "overlayOpacity": <0 to 0.85> }, ` +
            `"spacing": "<compact | comfortable | roomy>", ` +
            `"cornerRadius": "<sharp | rounded | pill>" }, ` +
            `"sections": [ { "id": "<unique>", "type": "<one of: ${SECTION_TYPES.join(", ")}>", ` +
            `"title": "<display title>", "visible": true } ], ` +
            `"rationale": "<one sharp sentence on why this design hits for this creator>" }\n` +
            `Rules: exactly one "hero" section and it must be FIRST; every color a #RRGGBB ` +
            `hex; keep it luxury — deep backgrounds, gold-forward unless the vibe demands ` +
            `otherwise; overlayOpacity as a number 0-0.85; no CSS, no gradients-as-text, ` +
            `no fields outside this shape.`,
        },
        {
          role: "user",
          content:
            `Creator: "${displayName}" (${vertical}).\n` +
            `Their vibe: "${vibe}"\n` +
            (palette.length ? `Palette sampled from their art: ${palette.join(", ")}\n` : "") +
            (baseThemeId ? `Starting from preset: ${baseThemeId}\n` : "") +
            `Suggested section titles for this vertical: ${JSON.stringify(labels)}\n` +
            (regenerate ? "They asked for a fresh take — surprise them, different direction.\n" : "") +
            `Design their page.`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200,
      temperature: regenerate ? 0.9 : 0.7,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let themeConfig: z.infer<typeof themeConfigSchema>;
    let sections: z.infer<typeof sectionSchema>[];
    let rationale = "";
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      themeConfig = themeConfigSchema.parse(json["themeConfig"]);
      const parsedSections = z.array(sectionSchema).min(1).max(12).parse(json["sections"]);
      /* Enforce: exactly one hero, first. */
      const heroIdx = parsedSections.findIndex((s) => s.type === "hero");
      if (heroIdx === -1) throw new Error("no hero section");
      const hero = parsedSections[heroIdx]!;
      sections = [hero, ...parsedSections.filter((_, i) => i !== heroIdx)];
      if (typeof json["rationale"] === "string") rationale = json["rationale"].slice(0, 280);
    } catch {
      throw new Error("Model returned an unusable design");
    }

    res.json({
      themeConfig,
      sections,
      rationale,
      creditsUsed: THEME_CREDITS,
      creditsRemaining: remaining,
    });
  } catch (err) {
    await refundOnFail(req.userId!, THEME_CREDITS, "AI Page Designer — Theme", {
      err: err instanceof Error ? err.message : String(err),
      userId: req.userId,
    });
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment.", refunded: true });
      return;
    }
    logger.error({ err }, "[ai-page-designer] theme generation failed");
    res.status(502).json({ error: "The studio hiccupped — your Visual Bucs were refunded.", refunded: true });
  }
});

/* ─── POST /bio — AI bio writer, voice matched to the vertical ─── */
const bioRequestSchema = z.object({
  vertical: verticalSchema,
  displayName: z.string().trim().min(1).max(80),
  facts: z.string().trim().min(10, "Give the writer something to work with.").max(1000),
  tone: z.string().trim().max(60).optional(),
  length: z.enum(["short", "medium", "long"]).optional().default("medium"),
});

router.post("/bio", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = bioRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid bio request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (openAiUnavailable(res)) return;

  const remaining = await precheckAndCharge(req, res, BIO_CREDITS, "AI Page Designer — Bio");
  if (remaining === null) return;
  const { vertical, displayName, facts, tone, length } = parsed.data;
  const hints = VERTICAL_LAYOUTS[vertical];
  const targetLen = length === "short" ? "1-2 sentences" : length === "long" ? "150-200 words" : "60-100 words";

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You write creator bios for Bow Down Visuals — "the cheat code, the best thing ` +
            `that hit the internet." Voice: confident, sharp, playful. This creator's ` +
            `vertical is "${vertical}"; write in this voice: ${hints.voice}. ` +
            `Audience-agnostic copy: "fans", "audience", "community" — never assume music-only. ` +
            `Write in third person, ${targetLen}, no hashtags, no emojis, no made-up stats ` +
            `or achievements — only use the facts given. End with a line that makes a new ` +
            `fan want to tap follow. Return ONLY JSON: { "bio": "<the bio>" }.`,
        },
        {
          role: "user",
          content:
            `Creator: "${displayName}"\n` +
            `Facts: "${facts}"\n` +
            (tone ? `Tone nudge: "${tone}"\n` : "") +
            `Write the bio.`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 500,
      temperature: 0.75,
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    let bio = "";
    try {
      const json = JSON.parse(raw) as { bio?: unknown };
      if (typeof json.bio === "string" && json.bio.trim()) bio = json.bio.trim().slice(0, 1200);
    } catch { /* fall through */ }
    if (!bio) throw new Error("Model returned no bio");

    res.json({ bio, creditsUsed: BIO_CREDITS, creditsRemaining: remaining });
  } catch (err) {
    await refundOnFail(req.userId!, BIO_CREDITS, "AI Page Designer — Bio", {
      err: err instanceof Error ? err.message : String(err),
      userId: req.userId,
    });
    logger.error({ err }, "[ai-page-designer] bio generation failed");
    res.status(502).json({ error: "The studio hiccupped — your Visual Bucs were refunded.", refunded: true });
  }
});

/* ─── POST /banner — AI banner art via the site's image model ─── */
const bannerRequestSchema = z.object({
  vertical: verticalSchema,
  vibe: z.string().trim().min(10).max(500),
  palette: z.array(hexColor).max(6).optional().default([]),
});

router.post("/banner", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = bannerRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid banner request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (openAiUnavailable(res)) return;

  const remaining = await precheckAndCharge(req, res, BANNER_CREDITS, "AI Page Designer — Banner");
  if (remaining === null) return;
  const { vertical, vibe, palette } = parsed.data;

  const refundAndFail = async (status: number, message: string) => {
    await refundOnFail(req.userId!, BANNER_CREDITS, "AI Page Designer — Banner", {
      userId: req.userId,
      message,
    });
    res.status(status).json({ error: message, refunded: true });
  };

  try {
    const prompt = (
      `Ultra-wide creator profile banner background for a ${vertical} creator, no text, ` +
      `no words, no letters, no logos, no watermark. Vibe: ${vibe}. ` +
      (palette.length ? `Color palette: ${palette.join(", ")}. ` : "") +
      `Luxurious gold-and-black cinematic atmosphere, rich depth, clean negative space ` +
      `in the center-left where profile content will sit. Professional, premium, striking.`
    ).slice(0, 2000);

    const imageResp = await getOpenAI().images.generate({
      model: IMAGE_MODEL,
      prompt,
      size: "1792x1024",
      quality: "medium",
      n: 1,
    });
    const b64 = imageResp.data?.[0]?.b64_json;
    if (!b64) {
      await refundAndFail(502, "Banner generation returned no image data.");
      return;
    }

    let stored: { url: string; path: string };
    try {
      const filePath = `${req.userId}/profile-banner/${randomUUID()}.png`;
      const { error: upErr } = await getSupabaseAdmin().storage
        .from(BANNER_BUCKET)
        .upload(filePath, Buffer.from(b64, "base64"), { contentType: "image/png", upsert: false });
      if (upErr) throw upErr;
      const {
        data: { publicUrl },
      } = getSupabaseAdmin().storage.from(BANNER_BUCKET).getPublicUrl(filePath);
      stored = { url: publicUrl, path: filePath };
    } catch (upErr) {
      await refundAndFail(502, "Could not save your banner — Visual Bucs refunded.");
      logger.error({ err: upErr, userId: req.userId }, "[ai-page-designer] banner upload failed");
      return;
    }

    logger.info({ userId: req.userId, vertical }, "[ai-page-designer] banner generated");
    res.json({
      url: stored.url,
      path: stored.path,
      creditsUsed: BANNER_CREDITS,
      creditsRemaining: remaining,
    });
  } catch (err) {
    await refundAndFail(502, "Banner generation failed — your Visual Bucs were refunded.");
    logger.error({ err, userId: req.userId }, "[ai-page-designer] banner failed");
  }
});

/* ─── POST /upload — profile image upload (avatar / banner / background) ───
   Free: pure storage, no AI compute. Auth required. 5 MB max, images only. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  },
});

const uploadSchema = z.object({
  kind: z.enum(["avatar", "banner", "background"]).default("banner"),
});

router.post("/upload", publicApiLimiter, requireAuth, (req, res) => {
  upload.single("file")(req, res, async (err: unknown) => {
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed." });
      return;
    }
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "No file received." });
      return;
    }
    const parsed = uploadSchema.safeParse(req.body ?? {});
    const kind = parsed.success ? parsed.data.kind : "banner";
    try {
      const ext = file.mimetype === "image/png" ? "png" : file.mimetype === "image/webp" ? "webp" : "jpg";
      const filePath = `${req.userId}/profile-uploads/${kind}-${randomUUID()}.${ext}`;
      const { error: upErr } = await getSupabaseAdmin().storage
        .from(BANNER_BUCKET)
        .upload(filePath, file.buffer, { contentType: file.mimetype, upsert: false });
      if (upErr) throw upErr;
      const {
        data: { publicUrl },
      } = getSupabaseAdmin().storage.from(BANNER_BUCKET).getPublicUrl(filePath);
      res.json({ url: publicUrl, path: filePath });
    } catch (upErr) {
      logger.error({ err: upErr, userId: req.userId }, "[ai-page-designer] upload failed");
      res.status(502).json({ error: "Upload failed — try again." });
    }
  });
});

export default router;
