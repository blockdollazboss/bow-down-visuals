import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── AI Press Release Generator ──────────────────────────────────────────
   Writes a properly formatted press release for an announcement (single,
   album, tour, product launch, milestone): headline, dateline, lede, body
   paragraphs, artist boilerplate, contact block, plus a 280-char social
   version — ready to send to press or save into the user's press kit.
   100 Visual Bucs. */

export const PRESS_RELEASE_CREDITS =
  Number(process.env["PRESS_RELEASE_CREDITS"]) || 100;

const ANNOUNCEMENT_TYPES = ["single", "album", "tour", "launch", "milestone"] as const;

const pressReleaseSchema = z.object({
  /** What the announcement is about. */
  announcementType: z.enum(ANNOUNCEMENT_TYPES),
  /** The story details: what/when/where — the meat of the announcement. */
  topic: z.string().trim().min(10).max(2000),
  /** Artist / brand name behind the announcement. */
  artistName: z.string().trim().min(1).max(120),
  /** Headline facts: dates, venues, numbers, names to include. */
  keyFacts: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
  /** A direct quote from the artist (will be written if omitted). */
  quote: z.string().trim().min(1).max(600).optional(),
  /** Press contact details. */
  contactInfo: z.object({
    name: z.string().trim().max(120).optional().default(""),
    email: z.string().trim().max(160).optional().default(""),
    phone: z.string().trim().max(40).optional().default(""),
  }).optional().default({ name: "", email: "", phone: "" }),
  /** City for the dateline, e.g. "Atlanta, GA". */
  datelineCity: z.string().trim().max(80).optional(),
});

interface GeneratedPressRelease {
  headline: string;
  dateline: string;
  lede: string;
  body: string[];
  quote: string;
  boilerplate: string;
  contactBlock: string[];
  social: string;
}

const TYPE_LABELS: Record<string, string> = {
  single: "new single",
  album: "new album",
  tour: "tour",
  launch: "product/brand launch",
  milestone: "milestone announcement",
};

function extractJsonObject(text: string): string {
  // Tolerate a code fence or stray prose around the JSON.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("Model returned no JSON.");
  return candidate.slice(start, end + 1);
}

router.post("/press-release", requireAuth, async (req, res) => {
  const parsed = pressReleaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < PRESS_RELEASE_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, PRESS_RELEASE_CREDITS, {
      action: "Press Release Generator",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    const { announcementType, topic, artistName, keyFacts, quote, contactInfo, datelineCity } =
      parsed.data;
    const typeLabel = TYPE_LABELS[announcementType] ?? "announcement";

    const contactLine = [
      contactInfo.name && `Contact: ${contactInfo.name}`,
      contactInfo.email && `Email: ${contactInfo.email}`,
      contactInfo.phone && `Phone: ${contactInfo.phone}`,
    ]
      .filter(Boolean)
      .join("\n");

    const prompt =
      `You are a veteran music-industry publicist. Write a professional press release for a ${typeLabel}.\n\n` +
      `Artist/brand: ${artistName}\n` +
      `Announcement details: ${topic}\n` +
      `Key facts to include:\n${keyFacts.map((f) => `- ${f}`).join("\n")}\n` +
      (quote ? `Artist quote to use (verbatim): "${quote}"\n` : "Write a strong, authentic-sounding artist quote in the artist's voice.\n") +
      (datelineCity ? `Dateline city: ${datelineCity}\n` : "") +
      `Format rules:\n` +
      `- Headline: punchy, news-style, under 100 characters, no clickbait\n` +
      `- Dateline: "CITY, ST — Month Day, Year" format (use today's date; use the given city or "${artistName}'s city" fallback "New York, NY")\n` +
      `- Lede: first paragraph, who/what/when/where/why, 2-3 sentences\n` +
      `- Body: 3-4 short paragraphs with context, story, and the key facts woven in naturally\n` +
      `- Quote: the provided quote verbatim, or one you wrote — attributed to ${artistName}\n` +
      `- Boilerplate: 2-3 sentence "About ${artistName}" paragraph\n` +
      `- Social: a punchy 280-characters-or-fewer announcement post for X/Twitter, no hashtags\n` +
      `- Third person throughout; no hype clichés ("taking the world by storm"); never invent awards, chart positions, venues, or numbers not in the facts\n\n` +
      `Return ONLY valid JSON:\n` +
      `{"headline": "...", "dateline": "...", "lede": "...", "body": ["para 1", "para 2", "para 3"], "quote": "...", "boilerplate": "...", "social": "..."}`;

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
      temperature: 0.7,
    });

    const content = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!content) throw new Error("Empty press release result.");

    const parsedContent = JSON.parse(extractJsonObject(content)) as Record<string, unknown>;

    const body = Array.isArray(parsedContent["body"])
      ? (parsedContent["body"] as unknown[]).map((p) => String(p).trim()).filter(Boolean).slice(0, 6)
      : [];
    const headline = String(parsedContent["headline"] ?? "").trim();
    const lede = String(parsedContent["lede"] ?? "").trim();
    if (!headline || !lede || body.length === 0) {
      throw new Error("Model returned an incomplete press release.");
    }

    // Hard-enforce the 280-char social limit server-side (trim at a word boundary).
    let social = String(parsedContent["social"] ?? "").trim().replace(/\s+/g, " ");
    if (social.length > 280) {
      const cut = social.slice(0, 280);
      const lastSpace = cut.lastIndexOf(" ");
      social = (lastSpace > 200 ? cut.slice(0, lastSpace) : cut).trim();
    }
    if (!social) throw new Error("No social version was generated.");

    const release: GeneratedPressRelease = {
      headline,
      dateline: String(parsedContent["dateline"] ?? "").trim(),
      lede,
      body,
      quote: String(parsedContent["quote"] ?? quote ?? "").trim(),
      boilerplate: String(parsedContent["boilerplate"] ?? "").trim(),
      contactBlock: contactLine ? contactLine.split("\n") : [],
      social,
    };

    res.json({
      release,
      announcementType: parsed.data.announcementType,
      artistName: parsed.data.artistName,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Press release generation failed.";
    req.log.error({ err: message }, "[press-release] failed");
    await refundCredits(req.userId!, PRESS_RELEASE_CREDITS, {
      action: "Press Release Generator — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
