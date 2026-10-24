import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { freeAiLimiter } from "../../lib/rate-limit";
import {
  ALT_TEXT_SYSTEM_PROMPT,
  buildAltTextUserPrompt,
  parseAltTextResponse,
} from "../../lib/alt-text";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── POST /api/generate/alt-text — AI accessibility description ──────────
   One tap at any image-bearing publish door (post composer, video/short
   cover, shop + storefront product shots) suggests alt text the creator
   can edit or clear before it ships.

   FREE — no credit charge: no in-tree price covers alt-text and none is
   invented. Abuse is capped by freeAiLimiter (30/hr/user), the house
   limiter for free AI endpoints that still call a paid model.

   Vision rides the stack's existing OpenAI client in the same
   image_url shape as the CTR predictor (routes/generate/ctr-predictor):
   the image is downscaled to a ≤1024px JPEG data URL first so the call
   stays cheap. An imageDataUrl may be sent directly for an image that
   has not been uploaded yet — it goes through the same downscale.

   Failure NEVER blocks a publish door: every error is a JSON error the
   client shows next to a still-working hand-written field. */

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const altTextSchema = z
  .object({
    imageUrl: z.string().trim().url().max(2048).optional(),
    imageDataUrl: z
      .string()
      .trim()
      .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/i, "imageDataUrl must be a base64 image data URL")
      .max(14 * 1024 * 1024)
      .optional(),
    /** Optional creator hint (e.g. "cover art for my new single"). */
    context: z.string().trim().max(200).optional(),
  })
  .refine((d) => !!d.imageUrl !== !!d.imageDataUrl, {
    message: "Send exactly one of imageUrl or imageDataUrl.",
  });

async function imageToDataUrl(source: { url?: string; dataUrl?: string }): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "alt-text-"));
  const rawPath = join(workDir, "raw");
  const smallPath = join(workDir, "small.jpg");
  try {
    let buf: Buffer;
    if (source.dataUrl) {
      buf = Buffer.from(source.dataUrl.split(",", 2)[1] ?? "", "base64");
    } else {
      const res = await fetch(source.url!, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error("Could not download that image.");
      buf = Buffer.from(await res.arrayBuffer());
    }
    if (buf.length === 0) throw new Error("That image came back empty.");
    if (buf.length > MAX_IMAGE_BYTES) throw new Error("That image is too large (max 15 MB).");
    await writeFile(rawPath, buf);
    // Downscale to max 1024px wide JPEG so the vision call stays cheap —
    // the same treatment the CTR predictor gives thumbnails.
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", rawPath, "-vf", "scale=1024:-2", "-q:v", "4", smallPath],
      { timeout: 30_000 },
    );
    const small = await readFile(smallPath);
    return `data:image/jpeg;base64,${small.toString("base64")}`;
  } finally {
    await unlink(rawPath).catch(() => {});
    await unlink(smallPath).catch(() => {});
  }
}

router.post("/generate/alt-text", requireAuth, freeAiLimiter, async (req, res) => {
  const parsed = altTextSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_request",
      message: parsed.error.issues.map((i) => i.message).join(" ") || "Invalid request.",
    });
    return;
  }
  const { imageUrl, imageDataUrl, context } = parsed.data;
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
    res.status(400).json({ error: "invalid_request", message: "imageUrl must be an http(s) URL." });
    return;
  }

  try {
    const dataUrl = await imageToDataUrl({ url: imageUrl, dataUrl: imageDataUrl });

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: ALT_TEXT_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: buildAltTextUserPrompt(context) },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_completion_tokens: 220,
      temperature: 0.3,
    });

    const altText = parseAltTextResponse(completion.choices[0]?.message?.content);
    if (!altText) throw new Error("The AI didn't return a usable description.");

    res.json({ ok: true, altText, creditsCharged: 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Alt-text generation failed.";
    if (message.includes("OPENAI_API_KEY")) {
      res.status(503).json({
        error: "alt_text_unavailable",
        message: "AI descriptions aren't available right now — you can still write your own.",
      });
      return;
    }
    const status = (err as { status?: number })?.status === 429 ? 503 : 502;
    res.status(status).json({
      error: status === 503 ? "provider_rate_limited" : "alt_text_failed",
      message: "Couldn't generate a description — you can still write your own.",
    });
  }
});

export default router;
