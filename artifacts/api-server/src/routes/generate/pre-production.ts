import { Router } from "express";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { randomUUID } from "crypto";
import { toFile } from "openai";
import { requireAuth } from "../../middlewares/require-auth";
import { buildCoStarContext } from "../../lib/co-stars";
import { chargeCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { uploadMediaToSupabaseStorage, refreshSupabaseStorageUrl } from "../../lib/objectStorage";
import { db, preproductionPacksTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import type {
  PackBible,
  PackShot,
  PackProp,
  PackIngredients,
  PackAsset,
} from "@workspace/db";

const router = Router();

const TEXT_CREDIT_COST = 1;
const IMAGE_CREDIT_COST = 2;

interface VaultInput {
  artistType?: string | null;
  artistDescription?: string | null;
  visualStyle?: string | null;
  hair?: string | null;
  tattoos?: string | null;
  jewelry?: string | null;
  clothingStyle?: string | null;
  brandColors?: string | null;
  doNotChangeRules?: string | null;
  consistencyPrompt?: string | null;
  referenceImageUrl?: string | null;
}

interface BibleInput {
  concept: string;
  visualStyle: string;
  colorPalette: string;
  locations: string;
  wardrobe: string;
  propsNeeded: string;
  cast: string;
  mood: string;
  doNotChange: string;
}

function buildVaultContext(vault: VaultInput | null | undefined): string {
  if (!vault) return "";
  const lines: string[] = ["\nARTIST LOCK (must stay consistent across every asset):"];
  if (vault.artistDescription) lines.push(`- Artist: ${vault.artistDescription}`);
  if (vault.artistType) lines.push(`- Type: ${vault.artistType}`);
  if (vault.visualStyle) lines.push(`- Visual style: ${vault.visualStyle}`);
  if (vault.hair) lines.push(`- Hair: ${vault.hair}`);
  if (vault.tattoos) lines.push(`- Tattoos: ${vault.tattoos}`);
  if (vault.jewelry) lines.push(`- Jewelry: ${vault.jewelry}`);
  if (vault.clothingStyle) lines.push(`- Clothing: ${vault.clothingStyle}`);
  if (vault.brandColors) lines.push(`- Brand colors: ${vault.brandColors}`);
  if (vault.doNotChangeRules) lines.push(`- NEVER CHANGE: ${vault.doNotChangeRules}`);
  if (vault.consistencyPrompt) lines.push(`- Consistency prompt: ${vault.consistencyPrompt}`);
  return lines.join("\n");
}

function buildBibleContext(bible: BibleInput | null | undefined): string {
  if (!bible) return "";
  const has = (v: string) => v && v.trim().length > 0;
  const lines: string[] = ["\nPRODUCTION BIBLE (locked creative source of truth — every asset must match):"];
  if (has(bible.concept)) lines.push(`- Concept: ${bible.concept}`);
  if (has(bible.visualStyle)) lines.push(`- Visual style: ${bible.visualStyle}`);
  if (has(bible.colorPalette)) lines.push(`- Color palette: ${bible.colorPalette}`);
  if (has(bible.locations)) lines.push(`- Locations: ${bible.locations}`);
  if (has(bible.wardrobe)) lines.push(`- Wardrobe: ${bible.wardrobe}`);
  if (has(bible.propsNeeded)) lines.push(`- Props: ${bible.propsNeeded}`);
  if (has(bible.cast)) lines.push(`- Cast: ${bible.cast}`);
  if (has(bible.mood)) lines.push(`- Mood: ${bible.mood}`);
  if (has(bible.doNotChange)) lines.push(`- NEVER CHANGE: ${bible.doNotChange}`);
  return lines.join("\n");
}

function outOfCredits(res: any, required: number) {
  res.status(402).json({
    error: "out_of_credits",
    message: "You are out of credits. Upgrade to keep creating.",
    required,
  });
}

/* ── Generate a production bible ─────────────────────────────────────────── */
router.post("/pre-production/bible", requireAuth, async (req, res) => {
  const { songTitle, genre, mood, artistName, artistVault } = req.body as {
    songTitle?: string; genre?: string; mood?: string; artistName?: string;
    artistVault?: VaultInput | null;
  };

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < TEXT_CREDIT_COST) { outOfCredits(res, TEXT_CREDIT_COST); return; }

  const prompt =
`Think like an Oscar-winning director and cinematographer building the locked creative bible for a feature-caliber music video: every location, wardrobe choice, and prop must feel intentional, cinematic, and unforgettable.

Create a complete PRODUCTION BIBLE for a music video. This bible is the locked creative source of truth — every storyboard shot, prop, wardrobe piece, and location in the project must match it.

Artist: ${artistName || "Unknown Artist"}
Song: "${songTitle || "Untitled"}"
Genre: ${genre || "Hip-hop"}
Mood: ${mood || "Dark, cinematic"}
${buildVaultContext(artistVault)}${await buildCoStarContext((artistVault as Record<string, string | null | undefined> | null | undefined)?.["vaultId"] ?? (artistVault as Record<string, string | null | undefined> | null | undefined)?.["id"], req.userId)}

Return ONLY valid JSON (no markdown, no commentary) with exactly these keys:
{
  "concept": "2-3 sentence story concept / logline for the video",
  "visualStyle": "cinematic style description (e.g. gritty 35mm film, neon-noir, documentary realism)",
  "colorPalette": "exact palette with color names/hex (primary, secondary, accent, shadows)",
  "locations": "3-5 specific locations with brief visual description each",
  "wardrobe": "hero outfit + 2 alternates, fabrics, colors, accessories",
  "propsNeeded": "comma-separated list of every hero prop the video needs",
  "cast": "who appears (artist, extras, roles)",
  "mood": "emotional tone in a few words",
  "doNotChange": "continuity rules that must never break (e.g. tattoo placement, jewelry, hair)"
}`;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 2000,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const bible = JSON.parse(raw);
    let after: number;
    try {
      after = await chargeCredits(req.userId!, TEXT_CREDIT_COST, { action: "Production Bible" });
    } catch (chargeErr) {
      if (chargeErr instanceof OutOfCreditsError) { outOfCredits(res, TEXT_CREDIT_COST); return; }
      if (chargeErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed \u2014 no credits were charged. Please try again." });
        return;
      }
      throw chargeErr;
    }
    res.json({ bible, creditsAfter: after });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Bible generation failed." });
  }
});

/* ── Generate a storyboard shot list from the bible ──────────────────────── */
router.post("/pre-production/storyboard", requireAuth, async (req, res) => {
  const { songTitle, bible, shotCount, artistVault } = req.body as {
    songTitle?: string; bible?: BibleInput | null; shotCount?: number;
    artistVault?: VaultInput | null;
  };

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < TEXT_CREDIT_COST) { outOfCredits(res, TEXT_CREDIT_COST); return; }

  const count = Math.min(Math.max(shotCount ?? 10, 4), 20);
  const prompt =
`Shoot-list like an Oscar-winning cinematographer: every shot composed for the big screen, camera moves motivated by emotion, lighting described with intent.

Create a ${count}-shot STORYBOARD for the music video "${songTitle || "Untitled"}".
${buildBibleContext(bible)}
${buildVaultContext(artistVault)}${await buildCoStarContext((artistVault as Record<string, string | null | undefined> | null | undefined)?.["vaultId"] ?? (artistVault as Record<string, string | null | undefined> | null | undefined)?.["id"], req.userId)}

Return ONLY valid JSON (no markdown, no commentary) as an array of shot objects:
[
  { "shotNumber": 1, "description": "what happens in this shot, 1-2 vivid sentences", "cameraAngle": "e.g. low-angle dolly-in, overhead drone, handheld close-up", "durationSec": 4 }
]
Cover the full arc: opening hook, verses, chorus peaks, bridge, outro. Vary camera angles. Keep every shot consistent with the bible.`;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 3000,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const shots = Array.isArray(parsed) ? parsed : parsed.shots ?? [];
    let after: number;
    try {
      after = await chargeCredits(req.userId!, TEXT_CREDIT_COST, { action: "Storyboard" });
    } catch (chargeErr) {
      if (chargeErr instanceof OutOfCreditsError) { outOfCredits(res, TEXT_CREDIT_COST); return; }
      if (chargeErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed \u2014 no credits were charged. Please try again." });
        return;
      }
      throw chargeErr;
    }
    res.json({ shots, creditsAfter: after });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Storyboard generation failed." });
  }
});

/* ── Generate an image: storyboard keyframe or production asset ──────────── */
async function fetchReferenceImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch { return null; }
}

router.post("/pre-production/image", requireAuth, async (req, res) => {
  const { kind, category, prompt, shotDescription, cameraAngle, bible, artistVault } = req.body as {
    kind: "startframe" | "endframe" | "asset";
    category?: string;
    prompt?: string;
    shotDescription?: string;
    cameraAngle?: string;
    bible?: BibleInput | null;
    artistVault?: VaultInput | null;
  };

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < IMAGE_CREDIT_COST) { outOfCredits(res, IMAGE_CREDIT_COST); return; }

  const subject = kind === "asset"
    ? `Isolated production asset photo for a music video — Category: ${category || "Prop"}. Asset: ${prompt || ""}. Clean studio-style product shot on a neutral background, premium catalog photography.`
    : kind === "endframe"
    ? `Cinematic film still: the CLOSING frame of this storyboard shot, moments after the opening frame — same location, same characters, same wardrobe, same lighting and color grade, but the action has progressed to its natural endpoint: Shot: ${shotDescription || ""}. Camera: ${cameraAngle || "cinematic"}. This must feel like the same continuous take, not a new scene.`
    : `Cinematic film still: the OPENING frame of this storyboard shot — the first image a video generator will animate from: Shot: ${shotDescription || ""}. Camera: ${cameraAngle || "cinematic"}. Strong readable composition with clear subject placement.`;

  const imagePrompt =
`${subject}
${buildBibleContext(bible)}
${buildVaultContext(artistVault)}${await buildCoStarContext((artistVault as Record<string, string | null | undefined> | null | undefined)?.["vaultId"] ?? (artistVault as Record<string, string | null | undefined> | null | undefined)?.["id"], req.userId)}
Style: ultra-detailed cinematic still, professional music video production quality. No text, no watermark, no cartoon, no anime.`.slice(0, 4000);

  try {
    const referenceBuffer = artistVault?.referenceImageUrl
      ? await fetchReferenceImageBuffer(artistVault.referenceImageUrl)
      : null;

    let b64: string | undefined;
    if (referenceBuffer) {
      const referenceFile = await toFile(referenceBuffer, "artist-reference.png", { type: "image/png" });
      const lockedPrompt =
        `Using the exact artist/person shown in the reference photo (same face, skin tone, body type — do not change their identity), create this scene: ${imagePrompt}`.slice(0, 4000);
      const editResp = await getOpenAI().images.edit({
        model: "gpt-image-1",
        image: referenceFile,
        prompt: lockedPrompt,
        size: "1536x1024",
        n: 1,
      });
      b64 = editResp.data?.[0]?.b64_json;
    } else {
      const imageResp = await getOpenAI().images.generate({
        model: "gpt-image-1",
        prompt: imagePrompt,
        size: "1536x1024",
        n: 1,
      });
      b64 = imageResp.data?.[0]?.b64_json;
    }

    if (!b64) { res.status(500).json({ error: "Image generation returned no image data." }); return; }

    const buffer = Buffer.from(b64, "base64");
    const objectName = `pre-production/${kind}s/${randomUUID()}.png`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/png");
    const url = await refreshSupabaseStorageUrl(storageRef);

    let after: number;
    try {
      after = await chargeCredits(req.userId!, IMAGE_CREDIT_COST, {
        action: kind === "asset" ? "Production Asset" : kind === "endframe" ? "Storyboard End Frame" : "Storyboard Start Frame",
      });
    } catch (chargeErr) {
      if (chargeErr instanceof OutOfCreditsError) { outOfCredits(res, IMAGE_CREDIT_COST); return; }
      if (chargeErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed \u2014 no credits were charged. Please try again." });
        return;
      }
      throw chargeErr;
    }
    res.json({ imageUrl: url, creditsAfter: after });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Image generation failed." });
  }
});

/* ── Full pre-production pack: everything it takes to make the clip ──────────
   One call generates the locked bible, storyboard, hero props, and per-shot
   ingredients (generation recipes). The client then generates one reference
   asset image per hero prop via /pre-production/image and calls
   /pack/:id/finalize, which locks everything in. Only locked packs feed
   scene generation. */

const PACK_TEXT_CREDIT_COST = 3; // bible + storyboard + props/ingredients
const PACK_MAX_SHOTS = 10;
const PACK_MAX_PROPS = 6;

interface PackRequestBody {
  songTitle?: string;
  genre?: string;
  mood?: string;
  artistName?: string;
  artistVault?: VaultInput | null;
  artistVaultId?: string | null;
  projectId?: string | null;
  shotCount?: number;
  propCount?: number;
  ratio?: string;
}

async function generateBibleJson(prompt: string): Promise<PackBible> {
  const completion = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 2000,
    response_format: { type: "json_object" },
  });
  return JSON.parse(completion.choices[0]?.message?.content ?? "{}");
}

async function generateStoryboardJson(prompt: string): Promise<PackShot[]> {
  const completion = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 3000,
    response_format: { type: "json_object" },
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  return Array.isArray(parsed) ? parsed : parsed.shots ?? [];
}

router.post("/pre-production/pack", requireAuth, async (req, res) => {
  const {
    songTitle, genre, mood, artistName, artistVault, artistVaultId,
    projectId, shotCount, propCount, ratio,
  } = req.body as PackRequestBody;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < PACK_TEXT_CREDIT_COST) { outOfCredits(res, PACK_TEXT_CREDIT_COST); return; }

  const shots = Math.min(Math.max(shotCount ?? 6, 4), PACK_MAX_SHOTS);
  const props = Math.min(Math.max(propCount ?? 4, 1), PACK_MAX_PROPS);
  const outRatio = ratio || "720:1280";

  try {
    /* 1 — Bible (locked creative source of truth). */
    const bible = await generateBibleJson(
`Create a complete PRODUCTION BIBLE for a music video. This bible is the locked creative source of truth — every storyboard shot, prop, wardrobe piece, and location in the project must match it.

Artist: ${artistName || "Unknown Artist"}
Song: "${songTitle || "Untitled"}"
Genre: ${genre || "Hip-hop"}
Mood: ${mood || "Dark, cinematic"}
${buildVaultContext(artistVault)}${await buildCoStarContext((artistVault as Record<string, string | null | undefined> | null | undefined)?.["vaultId"] ?? (artistVault as Record<string, string | null | undefined> | null | undefined)?.["id"], req.userId)}

Return ONLY valid JSON (no markdown, no commentary) with exactly these keys:
{
  "concept": "2-3 sentence story concept / logline for the video",
  "visualStyle": "cinematic style description (e.g. gritty 35mm film, neon-noir, documentary realism)",
  "colorPalette": "exact palette with color names/hex (primary, secondary, accent, shadows)",
  "locations": "3-5 specific locations with brief visual description each",
  "wardrobe": "hero outfit + 2 alternates, fabrics, colors, accessories",
  "propsNeeded": "comma-separated list of every hero prop the video needs",
  "cast": "who appears (artist, extras, roles)",
  "mood": "emotional tone in a few words",
  "doNotChange": "continuity rules that must never break (e.g. tattoo placement, jewelry, hair)"
}`);

    /* 2 — Storyboard. */
    const storyboard = await generateStoryboardJson(
`Create a ${shots}-shot STORYBOARD for the music video "${songTitle || "Untitled"}".
${buildBibleContext(bible)}
${buildVaultContext(artistVault)}${await buildCoStarContext((artistVault as Record<string, string | null | undefined> | null | undefined)?.["vaultId"] ?? (artistVault as Record<string, string | null | undefined> | null | undefined)?.["id"], req.userId)}

Return ONLY valid JSON (no markdown, no commentary) as an array of shot objects:
[
  { "shotNumber": 1, "description": "what happens in this shot, 1-2 vivid sentences", "cameraAngle": "e.g. low-angle dolly-in, overhead drone, handheld close-up", "durationSec": 5 }
]
Cover the full arc: opening hook, verses, chorus peaks, bridge, outro. Vary camera angles. Keep every shot consistent with the bible.`);

    /* 3 — Hero props + per-shot ingredients (one call). */
    const planCompletion = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content:
`You are the pre-production department for the music video "${songTitle || "Untitled"}".
${buildBibleContext(bible)}
${buildVaultContext(artistVault)}${await buildCoStarContext((artistVault as Record<string, string | null | undefined> | null | undefined)?.["vaultId"] ?? (artistVault as Record<string, string | null | undefined> | null | undefined)?.["id"], req.userId)}

Storyboard shots:
${storyboard.map((s: PackShot) => `#${s.shotNumber} (${s.cameraAngle}, ${s.durationSec}s): ${s.description}`).join("\n")}

Do two jobs and return ONLY valid JSON (no markdown, no commentary):

1. "props": the ${props} most important HERO PROPS in the video — physical objects the camera must see consistently. Each: { "name": "short prop name", "description": "exact visual description: materials, colors, size, condition, distinguishing marks", "shots": [shot numbers where it appears] }.

2. "ingredients": the locked GENERATION RECIPE for every storyboard shot — everything the video model needs, decided now. Each: {
  "shotNumber": 1,
  "prompt": "the final locked video prompt, 2-4 vivid sentences. Weave in: the shot action, camera move, bible visual style + color palette + wardrobe, the exact hero props visible in this shot (by name and look), and the artist's locked identity traits. Write it as one direct prompt to a video model.",
  "negativePrompt": "short locked negative prompt (artifacts, deformities, text, watermark, style breaks)",
  "referenceAssets": ["hero prop names from the props list that this shot should match"],
  "continuityNotes": "one line reminding the generator what must stay identical to other shots",
  "model": "seedance2_5",
  "durationSec": <clamp the shot's duration to 3-30>,
  "ratio": "${outRatio}"
}

Return: { "props": [...], "ingredients": [...] }` }],
      max_tokens: 4000,
      response_format: { type: "json_object" },
    });
    const plan = JSON.parse(planCompletion.choices[0]?.message?.content ?? "{}");
    const packProps: PackProp[] = (plan.props ?? []).map((p: any) => ({
      name: String(p.name ?? "Prop"),
      description: String(p.description ?? ""),
      shots: Array.isArray(p.shots) ? p.shots.map(Number) : [],
      assetImageUrl: null,
    }));
    const ingredients: PackIngredients[] = (plan.ingredients ?? []).map((g: any) => ({
      shotNumber: Number(g.shotNumber ?? 0),
      prompt: String(g.prompt ?? ""),
      negativePrompt: String(g.negativePrompt ?? ""),
      referenceAssetUrls: [],
      continuityNotes: String(g.continuityNotes ?? ""),
      model: g.model === "gen4.5" ? "gen4.5" : "seedance2_5",
      durationSec: Math.min(Math.max(Number(g.durationSec ?? 5) || 5, 3), 30),
      ratio: String(g.ratio || outRatio),
    }));
    // Stash the prop-name references; finalize resolves them to asset URLs.
    const propNameRefs: Record<number, string[]> = {};
    for (const g of plan.ingredients ?? []) {
      if (Array.isArray(g.referenceAssets)) propNameRefs[Number(g.shotNumber)] = g.referenceAssets.map(String);
    }

    const [pack] = await db
      .insert(preproductionPacksTable)
      .values({
        user_id: req.userId!,
        project_id: projectId ?? null,
        artist_vault_id: artistVaultId ?? null,
        song_title: songTitle ?? null,
        genre: genre ?? null,
        mood: mood ?? null,
        bible,
        storyboard,
        props: packProps,
        ingredients,
        assets: [],
        status: "ready",
        credits_charged: String(PACK_TEXT_CREDIT_COST),
      })
      .returning();

    const after = await chargeCredits(req.userId!, PACK_TEXT_CREDIT_COST, { action: "Pre-production Pack" });

    res.json({
      pack,
      propNameRefs,
      creditsAfter: after,
      /* What it will cost to finish: one asset image per hero prop. */
      assetsRemaining: packProps.length,
      assetCreditCost: IMAGE_CREDIT_COST,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Pack generation failed." });
  }
});

/* ── Finalize: attach prop/asset images and lock everything in ───────────── */
router.post("/pre-production/pack/:id/finalize", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);
  const { props, assets, propNameRefs } = req.body as {
    props?: PackProp[];
    assets?: PackAsset[];
    propNameRefs?: Record<number, string[]>;
  };

  const rows = await db
    .select()
    .from(preproductionPacksTable)
    .where(and(eq(preproductionPacksTable.id, id), eq(preproductionPacksTable.user_id, req.userId!)))
    .limit(1);
  const pack = rows[0];
  if (!pack) { res.status(404).json({ error: "Pack not found." }); return; }
  if (pack.status === "locked") { res.status(409).json({ error: "Pack is already locked in." }); return; }

  const finalProps = (props ?? []).map((p) => ({
    name: String(p.name ?? "Prop"),
    description: String(p.description ?? ""),
    shots: Array.isArray(p.shots) ? p.shots.map(Number) : [],
    assetImageUrl: p.assetImageUrl ?? null,
  }));
  const urlByName = new Map(finalProps.map((p) => [p.name.toLowerCase(), p.assetImageUrl].filter(Boolean) as [string, string | null]));
  // Resolve referenceAssetUrls from the prop names the ingredients recorded.
  const nameRefs: Record<number, string[]> = propNameRefs ?? {};
  const ingredients: PackIngredients[] = ((pack.ingredients as PackIngredients[] | null) ?? []).map((g) => ({
    ...g,
    referenceAssetUrls: (nameRefs[g.shotNumber] ?? [])
      .map((n) => urlByName.get(String(n).toLowerCase()))
      .filter((u): u is string => !!u),
  }));
  const finalAssets: PackAsset[] = (assets ?? []).map((a) => ({
    id: a.id || randomUUID(),
    category: a.category || "Other",
    label: String(a.label ?? "Asset"),
    prompt: String(a.prompt ?? ""),
    imageUrl: a.imageUrl ?? null,
    createdAt: a.createdAt || new Date().toISOString(),
  }));

  const [updated] = await db
    .update(preproductionPacksTable)
    .set({
      props: finalProps,
      ingredients,
      assets: finalAssets,
      status: "locked",
      locked_at: new Date(),
      updated_at: new Date(),
    })
    .where(and(eq(preproductionPacksTable.id, id), eq(preproductionPacksTable.user_id, req.userId!)))
    .returning();

  res.json({ pack: updated });
});

/* ── List + fetch packs ──────────────────────────────────────────────────── */
router.get("/pre-production/packs", requireAuth, async (req, res) => {
  const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : null;
  const where = projectId
    ? and(eq(preproductionPacksTable.user_id, req.userId!), eq(preproductionPacksTable.project_id, projectId))
    : eq(preproductionPacksTable.user_id, req.userId!);
  const packs = await db
    .select()
    .from(preproductionPacksTable)
    .where(where)
    .orderBy(desc(preproductionPacksTable.created_at))
    .limit(20);
  res.json({ packs });
});

router.get("/pre-production/pack/:id", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);
  const rows = await db
    .select()
    .from(preproductionPacksTable)
    .where(and(eq(preproductionPacksTable.id, id), eq(preproductionPacksTable.user_id, req.userId!)))
    .limit(1);
  if (!rows[0]) { res.status(404).json({ error: "Pack not found." }); return; }
  res.json({ pack: rows[0] });
});

/** Load a locked pack for scene generation. Throws on missing/unowned/unlocked. */
export async function getLockedPack(userId: string, packId: string) {
  const rows = await db
    .select()
    .from(preproductionPacksTable)
    .where(and(eq(preproductionPacksTable.id, packId), eq(preproductionPacksTable.user_id, userId)))
    .limit(1);
  const pack = rows[0];
  if (!pack) throw Object.assign(new Error("Pre-production pack not found."), { status: 404 });
  if (pack.status !== "locked") throw Object.assign(new Error("Pre-production pack is not locked in yet."), { status: 409 });
  return pack;
}

export default router;
