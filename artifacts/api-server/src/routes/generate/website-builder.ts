import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

/* ─── AI Website Builder ─────────────────────────────────────────────────
   Export model: the customer describes a site, AI builds a complete static
   site package (HTML/CSS/JS + README with deploy guides), they preview it
   privately, pay a one-time build fee, and download the zip to host on
   their own domain. NOTHING customer-made is ever published or hosted on
   bowdownvisuals.com — the handoff is the product.

   Scoped to creator-niche templates: artist sites, press kits,
   link-in-bio-plus, and tour pages. */

const router = Router();

/* 30 credits per site build — env-overridable. Covers ~$1-1.50 in AI cost
   at ~10x margin. One-time sale, not SaaS. */
const WEBSITE_BUILD_CREDITS = Number(process.env["WEBSITE_BUILD_CREDIT_COST"]) || 30;
export { WEBSITE_BUILD_CREDITS };

/* 2 credits per conversational edit after the initial build. */
const WEBSITE_EDIT_CREDITS = Number(process.env["WEBSITE_EDIT_CREDIT_COST"]) || 2;
export { WEBSITE_EDIT_CREDITS };

const TEMPLATES = [
  "artist-site",
  "press-kit",
  "link-in-bio",
  "tour-page",
] as const;
type TemplateKey = (typeof TEMPLATES)[number];

const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  "artist-site": "Artist Site",
  "press-kit": "Press Kit",
  "link-in-bio": "Link-in-Bio Plus",
  "tour-page": "Tour Page",
};

const TEMPLATE_DESCRIPTIONS: Record<TemplateKey, string> = {
  "artist-site":
    "Full artist homepage: hero with name + tagline, music player embed section, about, upcoming shows, gallery, mailing list signup, contact.",
  "press-kit":
    "Electronic press kit: bio, high-res photo placeholders, music/videos, press quotes, tour dates, contact for booking. What bookers and press actually want.",
  "link-in-bio":
    "Link-in-bio on steroids: profile header, smart link cards (music, videos, merch, tour), latest release spotlight, social icons, newsletter capture.",
  "tour-page":
    "Tour landing page: date list with ticket links, VIP package section, city-by-city details, mailing list for presale codes.",
};

export const generateSchema = z.object({
  template: z.enum(TEMPLATES),
  businessName: z.string().min(1).max(120),
  description: z
    .string()
    .min(20, "Describe your site in at least a sentence or two.")
    .max(3000),
  style: z.string().max(500).optional().default(""),
  colorScheme: z.string().max(200).optional().default(""),
});

export type GenerateInput = z.infer<typeof generateSchema>;

const SYSTEM_PROMPT = `You are an expert web designer and front-end developer building complete static websites for music creators. You output a full multi-page static site as JSON.

CRITICAL RULES:
- Output ONLY valid JSON. No markdown fences, no commentary, no explanations.
- Every HTML file must be complete and valid: doctype, head, body, all tags closed.
- All CSS goes in styles.css. All JS goes in script.js. HTML files link to them relatively.
- Mobile-responsive: use a viewport meta tag and responsive CSS (flexbox/grid + media queries).
- No external dependencies except Google Fonts (via link tag). No frameworks, no build step.
- No placeholder lorem ipsum — write REAL copy based on the brief. If details are missing, invent plausible creator-specific content (show dates, song titles, bio).
- Images: use CSS gradients and emoji/SVG decorations for visuals. Reference "images/hero.jpg" etc. as placeholders the owner will replace — note this in the README.
- Contact forms: post to a placeholder endpoint "#contact-form" with a comment explaining to plug in Formspree/Getform free tier. Never invent a backend.
- Footer on every page: "© <year> <name>. Built with Bow Down Visuals AI Website Builder."
- The README.md must include: what each file is, how to deploy to Netlify Drop / Vercel / Cloudflare Pages / cPanel (step by step for non-technical owners), how to wire the contact form, where to paste an analytics snippet, and a plain-language "what you own / what we don't do" section.

JSON shape (keys are file paths, values are full file contents as strings):
{
  "index.html": "<complete homepage>",
  "about.html": "<complete about page>",
  "styles.css": "<complete stylesheet>",
  "script.js": "<complete JS: mobile nav toggle, smooth scroll, form handler, any template interactivity>",
  "README.md": "<complete deploy + ownership guide in markdown>"
}

For press-kit and link-in-bio templates, index.html alone may suffice plus about.html — but ALWAYS include all 5 files. Extra pages (shows.html, gallery.html) are welcome when the template calls for them.

Design bar: dark, premium, gold-accented aesthetic suitable for music creators. Generous whitespace, big typography, smooth hover states. This must look like a $2,000 custom site, not a template.`;

function buildUserPrompt(input: GenerateInput): string {
  const { template, businessName, description, style, colorScheme } = input;
  return `Template: ${TEMPLATE_LABELS[template]}
${TEMPLATE_DESCRIPTIONS[template]}

Site owner / business name: ${businessName}

Creator's brief:
${description}
${style ? `\nStyle preferences: ${style}` : ""}
${colorScheme ? `\nColor scheme: ${colorScheme}` : ""}

Generate the complete static site now as JSON. Remember: ONLY valid JSON, no other text.`;
}

router.post("/generate", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;

  let charged = false;
  try {
    await chargeCredits(req.userId!, WEBSITE_BUILD_CREDITS, {
      action: `Website Build (${TEMPLATE_LABELS[input.template]})`,
    });
    charged = true;

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
      response_format: { type: "json_object" },
      max_tokens: 16000,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let files: Record<string, string>;
    try {
      files = JSON.parse(raw);
    } catch {
      throw new Error("AI returned unparseable site files");
    }

    // Sanity: must have at least index.html and styles.css
    if (!files["index.html"] || !files["styles.css"]) {
      throw new Error("AI output missing required files (index.html / styles.css)");
    }

    res.json({
      files,
      template: input.template,
      templateLabel: TEMPLATE_LABELS[input.template],
      businessName: input.businessName,
      creditsCharged: WEBSITE_BUILD_CREDITS,
      fileCount: Object.keys(files).length,
      ownership:
        "You own these files outright. Host them on your own domain — nothing is published or hosted on bowdownvisuals.com.",
    });
  } catch (err) {
    if (charged) {
      try {
        await refundCredits(req.userId!, WEBSITE_BUILD_CREDITS, {
          action: "Website Build (refund: generation failed)",
        });
      } catch (refundErr) {
        logger.error({ err: refundErr }, "[website-builder] refund failed");
      }
    }
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits" });
      return;
    }
    logger.error({ err }, "[website-builder] generation failed");
    res.status(500).json({ error: "generation_failed" });
  }
});

/* ─── Conversational edits ───────────────────────────────────────────────
   "Make the hero darker", "change the headline" — regenerates the site
   with the edit applied. Small fee per edit, disclosed up front. */

export const editSchema = z.object({
  template: z.enum(TEMPLATES),
  businessName: z.string().min(1).max(120),
  currentFiles: z.record(z.string(), z.string()),
  editRequest: z.string().min(5).max(1000),
});

router.post("/edit", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const { template, businessName, currentFiles, editRequest } = parsed.data;

  let charged = false;
  try {
    await chargeCredits(req.userId!, WEBSITE_EDIT_CREDITS, {
      action: "Website Edit",
    });
    charged = true;

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Template: ${TEMPLATE_LABELS[template]}\nSite owner: ${businessName}\n\n` +
            `Here is the current site (JSON of file path -> contents):\n${JSON.stringify(currentFiles).slice(0, 60000)}\n\n` +
            `Apply this edit: "${editRequest}"\n\n` +
            `Return the FULL updated site as JSON (same shape: file path -> complete file contents). ` +
            `Only valid JSON, no other text.`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 16000,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let files: Record<string, string>;
    try {
      files = JSON.parse(raw);
    } catch {
      throw new Error("AI returned unparseable site files");
    }

    if (!files["index.html"] || !files["styles.css"]) {
      throw new Error("AI output missing required files after edit");
    }

    res.json({
      files,
      creditsCharged: WEBSITE_EDIT_CREDITS,
      fileCount: Object.keys(files).length,
    });
  } catch (err) {
    if (charged) {
      try {
        await refundCredits(req.userId!, WEBSITE_EDIT_CREDITS, {
          action: "Website Edit (refund: edit failed)",
        });
      } catch (refundErr) {
        logger.error({ err: refundErr }, "[website-builder] edit refund failed");
      }
    }
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits" });
      return;
    }
    logger.error({ err }, "[website-builder] edit failed");
    res.status(500).json({ error: "edit_failed" });
  }
});

export default router;
