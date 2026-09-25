import { Router } from "express";
import { randomUUID } from "crypto";
import { getOpenAI } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, LedgerWriteError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
  normalizeToStorageRef,
} from "../../lib/objectStorage";

const router = Router();

/* ─── Stream Pack Generator ─────────────────────────────────────────────
   One-click branded asset bundles for streamers: overlay frames, alert
   graphics, info panels, and stream screens. Each asset is an AI image
   rendered on demand, so each one burns compute — and each one charges
   credits (standing pricing rule). Synchronous OpenAI path (like the
   Artist Photo Shoot sunburst flow): credits are charged only after a
   successful render, so failures are automatically free. */

/** Site credits per generated stream-pack asset. Env-overridable. */
export const STREAM_PACK_CREDIT_COST =
  Number(process.env["STREAM_PACK_CREDITS_PER_IMAGE"]) || 1;

/** Newest OpenAI image model — env-overridable so upgrades are one-line changes. */
const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL"] || "gpt-image-2.5";

export interface StreamPackTheme {
  id: string;
  name: string;
  blurb: string;
  /** Swatch colors for the theme picker UI. */
  swatches: [string, string, string];
  /** Style fragment injected into every asset prompt. */
  stylePrompt: string;
}

export const STREAM_PACK_THEMES: StreamPackTheme[] = [
  {
    id: "gold-luxury",
    name: "Gold Luxury",
    blurb: "Black & gold. The Bow Down Visuals signature.",
    swatches: ["#0a0a0a", "#d4af37", "#f5e6b8"],
    stylePrompt:
      "luxurious black and gold aesthetic, deep black backgrounds, rich metallic gold accents, " +
      "elegant serif typography touches, premium cinematic lighting, subtle gold particle effects, " +
      "high-end brand identity design",
  },
  {
    id: "neon-cyber",
    name: "Neon Cyber",
    blurb: "Cyan & magenta glow on dark.",
    swatches: ["#050510", "#00f0ff", "#ff2bd6"],
    stylePrompt:
      "futuristic cyberpunk aesthetic, dark navy-black backgrounds, glowing cyan and magenta neon " +
      "accents, sleek tech typography, holographic light streaks, high-contrast esports broadcast design",
  },
  {
    id: "crimson-royal",
    name: "Crimson Royal",
    blurb: "Deep red & gold. Bold and commanding.",
    swatches: ["#0d0208", "#c1121f", "#d4af37"],
    stylePrompt:
      "bold royal aesthetic, near-black backgrounds, deep crimson red and gold accents, " +
      "dramatic regal typography, velvet textures, cinematic spotlight lighting, powerful brand identity",
  },
  {
    id: "emerald-empire",
    name: "Emerald Empire",
    blurb: "Rich green & gold. Fresh but premium.",
    swatches: ["#02120c", "#10b981", "#d4af37"],
    stylePrompt:
      "premium emerald aesthetic, dark forest-black backgrounds, luminous emerald green and gold " +
      "accents, modern elegant typography, soft glowing light rays, luxurious nature-meets-tech design",
  },
  {
    id: "violet-noir",
    name: "Violet Noir",
    blurb: "Purple haze on black. Mysterious.",
    swatches: ["#0b0614", "#8b5cf6", "#e9d5ff"],
    stylePrompt:
      "mysterious noir aesthetic, deep black-purple backgrounds, violet and lavender glow accents, " +
      "stylish modern typography, smoky atmospheric lighting, moody premium stream design",
  },
  {
    id: "arctic-frost",
    name: "Arctic Frost",
    blurb: "Ice blue & white. Clean and sharp.",
    swatches: ["#060d18", "#7dd3fc", "#ffffff"],
    stylePrompt:
      "clean arctic aesthetic, dark navy backgrounds, ice-blue and white frost accents, " +
      "crisp minimal typography, cool glowing light effects, sharp modern broadcast design",
  },
];

export interface StreamPackAsset {
  key: string;
  label: string;
  group: "Overlays" | "Alerts" | "Panels" | "Screens";
  blurb: string;
  /** OpenAI image size — landscape for wide assets, square for the rest. */
  size: "1024x1024" | "1536x1024";
  /** What the asset depicts — the core of the generated prompt. */
  promptCore: string;
}

export const STREAM_PACK_ASSETS: StreamPackAsset[] = [
  {
    key: "webcam-frame",
    label: "Webcam Frame",
    group: "Overlays",
    blurb: "Decorative border for your camera",
    size: "1536x1024",
    promptCore:
      "a stream webcam overlay frame: an ornate decorative border designed to frame a " +
      "webcam feed, with a clean empty dark rectangular area in the center-left where the " +
      "camera feed goes, decorative corners and side flourishes around it",
  },
  {
    key: "chat-frame",
    label: "Chat Box Frame",
    group: "Overlays",
    blurb: "Styled frame for your chat panel",
    size: "1024x1024",
    promptCore:
      "a stream chat box overlay frame: a tall decorative panel border with an empty dark " +
      "interior where live chat messages appear, elegant header bar at the top reading 'CHAT'",
  },
  {
    key: "alert-follower",
    label: "New Follower Alert",
    group: "Alerts",
    blurb: "Pops when someone follows",
    size: "1024x1024",
    promptCore:
      "a 'NEW FOLLOWER' stream alert graphic: bold celebratory design with the text " +
      "'NEW FOLLOWER' prominently displayed, dynamic shapes and glow effects radiating outward, " +
      "designed to pop on screen for 5 seconds",
  },
  {
    key: "alert-subscriber",
    label: "New Subscriber Alert",
    group: "Alerts",
    blurb: "Pops when someone subscribes",
    size: "1024x1024",
    promptCore:
      "a 'NEW SUBSCRIBER' stream alert graphic: premium celebratory design with the text " +
      "'NEW SUBSCRIBER' prominently displayed, crown and star motifs, radiant glow effects, " +
      "designed to pop on screen for 5 seconds",
  },
  {
    key: "alert-donation",
    label: "Donation Alert",
    group: "Alerts",
    blurb: "Pops when someone donates",
    size: "1024x1024",
    promptCore:
      "a 'DONATION' stream alert graphic: exciting celebratory design with the text 'DONATION' " +
      "prominently displayed, coin and gift motifs with sparkling effects, " +
      "designed to pop on screen for 5 seconds",
  },
  {
    key: "panel-about",
    label: "About Panel",
    group: "Panels",
    blurb: "Wide banner for your About section",
    size: "1536x1024",
    promptCore:
      "a wide Twitch-style 'ABOUT' info panel banner: horizontal banner with the text 'ABOUT' " +
      "in elegant lettering on the left and decorative design filling the right side, " +
      "clean space in the middle for the streamer's bio text",
  },
  {
    key: "panel-rules",
    label: "Rules Panel",
    group: "Panels",
    blurb: "Wide banner for your chat rules",
    size: "1536x1024",
    promptCore:
      "a wide Twitch-style 'RULES' info panel banner: horizontal banner with the text 'RULES' " +
      "in elegant lettering on the left and decorative design filling the right side, " +
      "clean space in the middle for the channel rules text",
  },
  {
    key: "panel-schedule",
    label: "Schedule Panel",
    group: "Panels",
    blurb: "Wide banner for your stream schedule",
    size: "1536x1024",
    promptCore:
      "a wide Twitch-style 'SCHEDULE' info panel banner: horizontal banner with the text " +
      "'SCHEDULE' in elegant lettering on the left and decorative design filling the right side, " +
      "clean space in the middle for stream times",
  },
  {
    key: "panel-socials",
    label: "Socials Panel",
    group: "Panels",
    blurb: "Wide banner for your social links",
    size: "1536x1024",
    promptCore:
      "a wide Twitch-style 'FOLLOW ME' info panel banner: horizontal banner with the text " +
      "'FOLLOW ME' in elegant lettering on the left, social media icon placeholders and " +
      "decorative design filling the right side",
  },
  {
    key: "screen-starting",
    label: "Starting Soon Screen",
    group: "Screens",
    blurb: "Full-screen pre-stream slate",
    size: "1536x1024",
    promptCore:
      "a 'STARTING SOON' stream starting screen: full-screen cinematic slate with the text " +
      "'STARTING SOON' large and centered, atmospheric background design, hype-building mood",
  },
  {
    key: "screen-brb",
    label: "Be Right Back Screen",
    group: "Screens",
    blurb: "Full-screen intermission slate",
    size: "1536x1024",
    promptCore:
      "a 'BE RIGHT BACK' stream intermission screen: full-screen stylish slate with the text " +
      "'BE RIGHT BACK' large and centered, calm atmospheric background design, " +
      "viewer-retention mood",
  },
  {
    key: "screen-ending",
    label: "Stream Ending Screen",
    group: "Screens",
    blurb: "Full-screen outro slate",
    size: "1536x1024",
    promptCore:
      "a 'THANKS FOR WATCHING' stream ending screen: full-screen cinematic slate with the text " +
      "'THANKS FOR WATCHING' large and centered, warm closing-mood background design",
  },
];

export interface StreamPackPlan {
  theme: StreamPackTheme;
  asset: StreamPackAsset;
  channelName: string;
  creditCost: number;
}

/**
 * Pure validation + plan resolution for a single stream-pack asset.
 * Throws on bad input so the route can return 400 before touching credits.
 */
export function resolveStreamPackPlan(opts: {
  channelName?: string;
  theme?: string;
  asset?: string;
}): StreamPackPlan {
  const channelName = (opts.channelName ?? "").trim().slice(0, 40);
  if (!channelName) throw new Error("channelName is required");
  const theme = STREAM_PACK_THEMES.find((t) => t.id === opts.theme)
    ?? STREAM_PACK_THEMES[0]!;
  const asset = STREAM_PACK_ASSETS.find((a) => a.key === opts.asset);
  if (!asset) throw new Error(`Unknown asset: ${opts.asset ?? "(missing)"}`);
  return { theme, asset, channelName, creditCost: STREAM_PACK_CREDIT_COST };
}

/**
 * Builds the full image prompt for one asset. Pure — unit-tested.
 * The channel name is woven in so every asset feels like YOUR brand.
 */
export function buildStreamPackPrompt(plan: StreamPackPlan): string {
  const { theme, asset, channelName } = plan;
  return (
    `Professional stream graphics pack asset for the streamer "${channelName}". ` +
    `${asset.promptCore}. ` +
    `Style: ${theme.stylePrompt}. ` +
    `Include the channel name "${channelName}" tastefully in the design where it fits naturally ` +
    `(screens and panels; keep alert text as specified). ` +
    `Crisp vector-style digital art, clean edges, high contrast, no photographic faces, ` +
    `no watermark, no signature.`
  ).slice(0, 4000);
}

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/stream-pack/catalog — free: themes + assets for the picker UI.
───────────────────────────────────────────────────────────────────────────── */
router.get("/stream-pack/catalog", (_req, res) => {
  res.json({
    themes: STREAM_PACK_THEMES.map(({ id, name, blurb, swatches }) => ({ id, name, blurb, swatches })),
    assets: STREAM_PACK_ASSETS.map(({ key, label, group, blurb, size }) => ({ key, label, group, blurb, size })),
    creditCostPerImage: STREAM_PACK_CREDIT_COST,
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/stream-pack/generate
   Generates ONE asset (the frontend loops for a full bundle — one click,
   per-asset progress, per-asset retry).
   1. Validate input (400 before credits).
   2. Credit pre-check (402 when short).
   3. Render via OpenAI image model.
   4. Charge 1 credit ONLY on success → upload → return URL.
   Failures charge nothing.
───────────────────────────────────────────────────────────────────────────── */
router.post("/stream-pack/generate", requireAuth, async (req, res) => {
  let plan: StreamPackPlan;
  try {
    plan = resolveStreamPackPlan(req.body as { channelName?: string; theme?: string; asset?: string });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid request" });
    return;
  }

  /* ── Credit pre-check — always enforced ── */
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < plan.creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits. Please buy more credits to continue.",
    });
    return;
  }

  const prompt = buildStreamPackPrompt(plan);
  req.log.info(
    { userId: req.userId, asset: plan.asset.key, theme: plan.theme.id },
    "[stream-pack] image generation started",
  );

  try {
    const imageResp = await getOpenAI().images.generate({
      model: IMAGE_MODEL,
      prompt,
      size: plan.asset.size,
      quality: "high",
      n: 1,
    });
    const b64 = imageResp.data?.[0]?.b64_json;
    if (!b64) {
      res.status(500).json({ error: "Image generation returned no image data." });
      return;
    }

    /* ── Charge AFTER success (mirrors artist-image sunburst path) ── */
    try {
      const creditsAfter = await chargeCredits(
        req.userId!,
        plan.creditCost,
        { action: `Stream Pack: ${plan.asset.label}` },
        { rollbackOnLedgerFailure: false },
      );
      req.log.info(
        { userId: req.userId, creditsAfter, deducted: plan.creditCost },
        "[stream-pack] credits deducted",
      );
    } catch (err) {
      if (err instanceof LedgerWriteError) {
        req.log.error({ err }, "[stream-pack] CRITICAL: ledger write failed after deduction — asset delivered, charge has no ledger trace");
      } else {
        req.log.error({ err }, "[stream-pack] credit deduction FAILED — asset delivered without charge");
      }
    }

    /* ── Store in generated-clips/stream-packs (self-healing bucket) ── */
    const objectName = `stream-packs/${req.userId}/${randomUUID()}.png`;
    const storageRef = await uploadMediaToSupabaseStorage(
      objectName,
      Buffer.from(b64, "base64"),
      "image/png",
    );
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      asset: plan.asset.key,
      label: plan.asset.label,
      url,
      path: normalizeToStorageRef(storageRef),
      creditCost: plan.creditCost,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Stream pack image generation failed";
    req.log.error({ err: msg }, "[stream-pack] generation failed — no credits charged");
    res.status(500).json({ error: msg });
  }
});

export default router;
