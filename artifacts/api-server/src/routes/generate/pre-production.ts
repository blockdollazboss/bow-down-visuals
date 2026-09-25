import { Router } from "express";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { randomUUID } from "crypto";
import { toFile } from "openai";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { uploadMediaToSupabaseStorage, refreshSupabaseStorageUrl } from "../../lib/objectStorage";

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
${buildVaultContext(artistVault)}

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
${buildVaultContext(artistVault)}

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
${buildVaultContext(artistVault)}
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

export default router;
