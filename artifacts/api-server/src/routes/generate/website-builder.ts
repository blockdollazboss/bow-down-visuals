import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import {
  db,
  type WebsiteBuildBrief,
  type WebsiteBuildFiles,
  type WebsiteBuildSource,
} from "@workspace/db";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  loadCreatorSeed,
  buildSeedContext,
  seedSummary,
  BUILDER_FACT_RULES,
} from "../../lib/website-builder-seed";
import { WEBSITE_TEMPLATES, WEBSITE_TEMPLATE_IDS, siteFilesSchema } from "./website-templates";

/* ─── AI Website Builder ─────────────────────────────────────────────────
   Export model: the customer describes a site, AI builds a complete static
   site package (HTML/CSS/JS + README with deploy guides), they preview it
   privately, pay a one-time build fee, and download the zip to host on
   their own domain. NOTHING customer-made is ever published or hosted on
   bowdownvisuals.com — the handoff is the product.

   Scoped to creator-niche templates. Two ways in: describe a site from a
   brief (the original templates), or start from the template GALLERY —
   real, finished starter builds per creator vertical (website-templates.ts)
   that a creator can remix instantly and then refine with the same
   conversational edits.

   Persistence (migration 0195, dossier ai-builders.md gap G2): every
   build is saved server-side as an owner-scoped project, and every
   re-generation or edit appends a new VERSION — the file map no longer
   lives only in the browser, and no version is ever overwritten.
   Persistence adds no charge and changes no generation behavior: if
   the save itself fails, the member still gets their files (they
   paid for them) with saved:false so the client can retry the save.

   The persistence layer speaks raw SQL (house pattern, cf.
   hub-projects.ts): the drizzle query builder emits rowMode:'array',
   which the pg-mem test harness cannot drive — raw SQL behaves
   identically on both.

   Build-from-the-creator: generation is seeded from the member's REAL
   material — brand kit, song/video catalog, store products, upcoming
   shows, profile facts (lib/website-builder-seed) — and the prompt
   FORBIDS inventing facts. Anything the creator hasn't provided becomes
   an honestly labeled placeholder in the draft, never a fabricated date,
   price, release, or quote on their public site. */

const router = Router();

/* 30 credits per site build — env-overridable. Covers ~$1-1.50 in AI cost
   at ~10x margin. One-time sale, not SaaS. */
const WEBSITE_BUILD_CREDITS = Number(process.env["WEBSITE_BUILD_CREDIT_COST"]) || 3000;
export { WEBSITE_BUILD_CREDITS };

/* 2 credits per conversational edit after the initial build. */
const WEBSITE_EDIT_CREDITS = Number(process.env["WEBSITE_EDIT_CREDIT_COST"]) || 200;
export { WEBSITE_EDIT_CREDITS };

/* Template keys = the gallery templates (canonical data in
   website-templates.ts) + the original brief-only templates. */
const TEMPLATES = [
  ...WEBSITE_TEMPLATE_IDS,
  "press-kit",
  "link-in-bio",
  "tour-page",
] as const;
type TemplateKey = (typeof TEMPLATES)[number];

/* Gallery labels/descriptions come from the canonical gallery data;
   the cast is safe because WEBSITE_TEMPLATE_IDS covers every remaining
   TemplateKey (pinned by the gallery tests). */
const TEMPLATE_LABELS = ((): Record<TemplateKey, string> => {
  const labels: Record<string, string> = {
    "press-kit": "Press Kit",
    "link-in-bio": "Link-in-Bio Plus",
    "tour-page": "Tour Page",
  };
  for (const t of WEBSITE_TEMPLATES) labels[t.id] = t.name;
  return labels as Record<TemplateKey, string>;
})();

const TEMPLATE_DESCRIPTIONS = ((): Record<TemplateKey, string> => {
  const descriptions: Record<string, string> = {
    "press-kit":
      "Electronic press kit: bio, high-res photo placeholders, music/videos, press quotes, tour dates, contact for booking. What bookers and press actually want.",
    "link-in-bio":
      "Link-in-bio on steroids: profile header, smart link cards (music, videos, merch, tour), latest release spotlight, social icons, newsletter capture.",
    "tour-page":
      "Tour landing page: date list with ticket links, VIP package section, city-by-city details, mailing list for presale codes.",
  };
  for (const t of WEBSITE_TEMPLATES) descriptions[t.id] = t.description;
  return descriptions as Record<TemplateKey, string>;
})();

const clientRefSchema = z.string().min(1).max(80);

export const generateSchema = z.object({
  template: z.enum(TEMPLATES),
  businessName: z.string().min(1).max(120),
  description: z
    .string()
    .min(20, "Describe your site in at least a sentence or two.")
    .max(3000),
  style: z.string().max(500).optional().default(""),
  colorScheme: z.string().max(200).optional().default(""),
  /* Persistence targeting (optional): projectId re-generates INTO an
     existing owned project as a new version; clientRef is the builder
     client's per-build id so a retried generate lands on the same
     project instead of duplicating it. Neither affects the AI call. */
  projectId: z.string().uuid().optional(),
  clientRef: clientRefSchema.optional(),
});

export type GenerateInput = z.infer<typeof generateSchema>;

const SYSTEM_PROMPT = `You are an expert web designer and front-end developer building complete static websites for creators (musicians, podcasters, streamers, video creators, and more). You output a full multi-page static site as JSON.

CRITICAL RULES:
- Output ONLY valid JSON. No markdown fences, no commentary, no explanations.
- Every HTML file must be complete and valid: doctype, head, body, all tags closed.
- All CSS goes in styles.css. All JS goes in script.js. HTML files link to them relatively.
- Mobile-responsive: use a viewport meta tag and responsive CSS (flexbox/grid + media queries).
- No external dependencies except Google Fonts (via link tag). No frameworks, no build step.
${BUILDER_FACT_RULES}
- Images: prefer the real image URLs from the creator's material (cover art, logo, photos, thumbnails). For imagery they have not provided, use CSS gradients and emoji/SVG decorations, or an "images/…" placeholder path with placeholder-labeled alt text — listed in the README's "Placeholders to replace" section.
- Contact forms: post to a placeholder endpoint "#contact-form" with a comment explaining to plug in Formspree/Getform free tier. Never invent a backend.
- Footer on every page: "© <year> <name>. Built with Bow Down Visuals AI Website Builder."
- The README.md must include: what each file is, how to deploy to Netlify Drop / Vercel / Cloudflare Pages / cPanel (step by step for non-technical owners), how to wire the contact form, where to paste an analytics snippet, a plain-language "what you own / what we don't do" section, and a "Placeholders to replace" section listing every labeled placeholder used in the site.

JSON shape (keys are file paths, values are full file contents as strings):
{
  "index.html": "<complete homepage>",
  "about.html": "<complete about page>",
  "styles.css": "<complete stylesheet>",
  "script.js": "<complete JS: mobile nav toggle, smooth scroll, form handler, any template interactivity>",
  "README.md": "<complete deploy + ownership guide in markdown>"
}

For press-kit and link-in-bio templates, index.html alone may suffice plus about.html — but ALWAYS include all 5 files. Extra pages (shows.html, gallery.html) are welcome when the template calls for them.

Design bar: dark, premium aesthetic suited to the creator's niche and the requested color scheme. Generous whitespace, big typography, smooth hover states. This must look like a $2,000 custom site, not a template.`;

function buildUserPrompt(input: GenerateInput, seedContext: string): string {
  const { template, businessName, description, style, colorScheme } = input;
  return `Template: ${TEMPLATE_LABELS[template]}
${TEMPLATE_DESCRIPTIONS[template]}

Site owner / business name: ${businessName}

Creator's brief:
${description}
${style ? `\nStyle preferences: ${style}` : ""}
${colorScheme ? `\nColor scheme: ${colorScheme}` : ""}

${seedContext}

Generate the complete static site now as JSON. Build it from the creator's real material above: their catalog, products, shows, brand, and links — not invented substitutes. Remember: ONLY valid JSON, no other text.`;
}

/* ─── Persistence layer (migration 0195) ───────────────────────────────
   Projects and their append-only versions, raw SQL throughout. Every
   read and write is scoped by user_id: another member's project is
   indistinguishable from a missing one (404, never 403 — existence
   is not leaked). */

interface WebsiteProjectDbRow {
  id: string;
  user_id: string;
  client_ref: string | null;
  name: string;
  template: string;
  brief: unknown;
  created_at: string | Date;
  updated_at: string | Date;
}

interface WebsiteVersionDbRow {
  id: string;
  project_id: string;
  version: number;
  source: string;
  note: string | null;
  brief: unknown;
  files: unknown;
  file_count: number;
  created_at: string | Date;
}

type VersionMetaDbRow = Pick<
  WebsiteVersionDbRow,
  "id" | "version" | "source" | "note" | "file_count" | "created_at"
>;

const PROJECT_COLUMNS = sql`id, user_id, client_ref, name, template, brief, created_at, updated_at`;
const VERSION_COLUMNS = sql`id, project_id, version, source, note, brief, files, file_count, created_at`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function briefOf(input: GenerateInput): WebsiteBuildBrief {
  return {
    description: input.description,
    style: input.style ?? "",
    colorScheme: input.colorScheme ?? "",
  };
}

/* jsonb read back from the store may arrive as a parsed value or (on
   some drivers) a string, and may predate a brief field — normalize
   so callers always see the full brief shape. */
function normalizeBrief(raw: unknown): WebsiteBuildBrief {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const b = (value ?? {}) as Partial<WebsiteBuildBrief>;
  return {
    description: typeof b.description === "string" ? b.description : "",
    style: typeof b.style === "string" ? b.style : "",
    colorScheme: typeof b.colorScheme === "string" ? b.colorScheme : "",
  };
}

function asFiles(raw: unknown): WebsiteBuildFiles {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return (value ?? {}) as WebsiteBuildFiles;
}

/* Key-order-insensitive file-map equality: Postgres jsonb does not
   preserve object key order, so a stored payload can never be
   compared to a fresh one by stringification. */
function filesEqual(a: WebsiteBuildFiles, b: WebsiteBuildFiles): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

async function getOwnedProject(
  userId: string,
  projectId: string,
): Promise<WebsiteProjectDbRow | null> {
  if (!UUID_RE.test(projectId)) return null;
  const r = await db.execute(sql`
    SELECT ${PROJECT_COLUMNS} FROM website_builder_projects
    WHERE id = ${projectId} AND user_id = ${userId}
    LIMIT 1
  `);
  return (r.rows[0] as unknown as WebsiteProjectDbRow | undefined) ?? null;
}

async function findProjectByClientRef(
  userId: string,
  clientRef: string,
): Promise<WebsiteProjectDbRow | null> {
  const r = await db.execute(sql`
    SELECT ${PROJECT_COLUMNS} FROM website_builder_projects
    WHERE user_id = ${userId} AND client_ref = ${clientRef}
    LIMIT 1
  `);
  return (r.rows[0] as unknown as WebsiteProjectDbRow | undefined) ?? null;
}

async function headVersionNumber(projectId: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT COALESCE(MAX(version), 0) AS max_version
    FROM website_builder_versions
    WHERE project_id = ${projectId}
  `);
  const max = (r.rows[0] as unknown as { max_version: number | string } | undefined)?.max_version;
  return Number(max ?? 0);
}

async function insertVersion(
  projectId: string,
  version: number,
  input: {
    source: WebsiteBuildSource;
    note: string | null;
    brief: WebsiteBuildBrief;
    files: WebsiteBuildFiles;
  },
): Promise<void> {
  /* Ids are minted here, not left to the column default: the pg-mem
     harness constant-folds its registered gen_random_uuid(), so a
     second default-generated id in the same table collides. Explicit
     ids behave identically on real Postgres. */
  await db.execute(sql`
    INSERT INTO website_builder_versions
      (id, project_id, version, source, note, brief, files, file_count)
    VALUES (
      ${randomUUID()}, ${projectId}, ${version}, ${input.source}, ${input.note},
      ${JSON.stringify(input.brief)}::jsonb,
      ${JSON.stringify(input.files)}::jsonb,
      ${Object.keys(input.files).length}
    )
  `);
}

/* Append a new head version and mirror its brief onto the project row
   (the project brief always describes the current head). The version
   number comes from MAX(version)+1 under the (project_id, version)
   unique index — a racing double-append fails loudly on the index
   instead of silently overwriting. */
async function appendVersion(
  project: WebsiteProjectDbRow,
  input: {
    source: WebsiteBuildSource;
    note: string | null;
    brief: WebsiteBuildBrief;
    files: WebsiteBuildFiles;
    patchProject?: { name?: string; template?: string };
  },
): Promise<number> {
  const version = (await headVersionNumber(project.id)) + 1;
  await insertVersion(project.id, version, input);
  await db.execute(sql`
    UPDATE website_builder_projects
    SET name = COALESCE(${input.patchProject?.name ?? null}, name),
        template = COALESCE(${input.patchProject?.template ?? null}, template),
        brief = ${JSON.stringify(input.brief)}::jsonb,
        updated_at = now()
    WHERE id = ${project.id}
  `);
  return version;
}

async function createProject(
  userId: string,
  input: {
    clientRef: string | null;
    name: string;
    template: string;
    brief: WebsiteBuildBrief;
    files: WebsiteBuildFiles;
    firstSource: WebsiteBuildSource;
  },
): Promise<{ project: WebsiteProjectDbRow; version: number }> {
  const r = await db.execute(sql`
    INSERT INTO website_builder_projects (id, user_id, client_ref, name, template, brief)
    VALUES (
      ${randomUUID()}, ${userId}, ${input.clientRef}, ${input.name}, ${input.template},
      ${JSON.stringify(input.brief)}::jsonb
    )
    RETURNING ${PROJECT_COLUMNS}
  `);
  const project = r.rows[0] as unknown as WebsiteProjectDbRow;
  await insertVersion(project.id, 1, {
    source: input.firstSource,
    note: null,
    brief: input.brief,
    files: input.files,
  });
  return { project, version: 1 };
}

/* The generate-time save: into the named project when one was given,
   onto the client's existing project when the clientRef already has
   one (a retried generate), else a brand-new project. */
async function saveGeneratedBuild(
  userId: string,
  args: {
    project: WebsiteProjectDbRow | null;
    clientRef?: string;
    name: string;
    template: string;
    brief: WebsiteBuildBrief;
    files: WebsiteBuildFiles;
  },
): Promise<{ projectId: string; version: number }> {
  if (args.project) {
    const version = await appendVersion(args.project, {
      source: "regenerate",
      note: null,
      brief: args.brief,
      files: args.files,
      patchProject: { name: args.name, template: args.template },
    });
    return { projectId: args.project.id, version };
  }
  if (args.clientRef) {
    const existing = await findProjectByClientRef(userId, args.clientRef);
    if (existing) {
      const version = await appendVersion(existing, {
        source: "regenerate",
        note: null,
        brief: args.brief,
        files: args.files,
        patchProject: { name: args.name, template: args.template },
      });
      return { projectId: existing.id, version };
    }
  }
  const created = await createProject(userId, {
    clientRef: args.clientRef ?? null,
    name: args.name,
    template: args.template,
    brief: args.brief,
    files: args.files,
    firstSource: "generate",
  });
  return { projectId: created.project.id, version: created.version };
}

function summarizeProject(
  row: WebsiteProjectDbRow,
  versionCount: number,
  head: { version: number; file_count: number } | null,
) {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    templateLabel: TEMPLATE_LABELS[row.template as TemplateKey] ?? row.template,
    versionCount,
    latestVersion: head?.version ?? 0,
    fileCount: head?.file_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function versionMetas(projectId: string): Promise<VersionMetaDbRow[]> {
  const r = await db.execute(sql`
    SELECT id, version, source, note, file_count, created_at
    FROM website_builder_versions
    WHERE project_id = ${projectId}
    ORDER BY version DESC
  `);
  return r.rows as unknown as VersionMetaDbRow[];
}

async function listProjectSummaries(userId: string) {
  const r = await db.execute(sql`
    SELECT ${PROJECT_COLUMNS} FROM website_builder_projects
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC, created_at DESC
  `);
  const projects = r.rows as unknown as WebsiteProjectDbRow[];
  const summaries = [];
  for (const p of projects) {
    /* Version metadata only — payloads stay out of list responses. */
    const metas = await versionMetas(p.id);
    const head = metas[0];
    summaries.push(
      summarizeProject(
        p,
        metas.length,
        head ? { version: head.version, file_count: head.file_count } : null,
      ),
    );
  }
  return summaries;
}

async function loadProjectSummary(userId: string, projectId: string) {
  const project = await getOwnedProject(userId, projectId);
  if (!project) return null;
  const metas = await versionMetas(projectId);
  const head = metas[0];
  return summarizeProject(
    project,
    metas.length,
    head ? { version: head.version, file_count: head.file_count } : null,
  );
}

async function loadVersionRow(
  projectId: string,
  version: number,
): Promise<WebsiteVersionDbRow | null> {
  const r = await db.execute(sql`
    SELECT ${VERSION_COLUMNS} FROM website_builder_versions
    WHERE project_id = ${projectId} AND version = ${version}
    LIMIT 1
  `);
  return (r.rows[0] as unknown as WebsiteVersionDbRow | undefined) ?? null;
}

async function headVersionRow(projectId: string): Promise<WebsiteVersionDbRow | null> {
  const r = await db.execute(sql`
    SELECT ${VERSION_COLUMNS} FROM website_builder_versions
    WHERE project_id = ${projectId}
    ORDER BY version DESC
    LIMIT 1
  `);
  return (r.rows[0] as unknown as WebsiteVersionDbRow | undefined) ?? null;
}

function parseVersionParam(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/* Express types route params as string | string[]; a repeated-param
   array is never a valid id/version here — coerce to "" (→ 404). */
function paramString(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/* Resolve a body's persistence target BEFORE any charge (the house
   rule the reference-video lane sealed: ownership is checked before
   money moves). Returns the owned project, undefined when no target
   was named, or null after sending a 404/500. */
async function resolveTargetProject(
  req: { userId?: string },
  res: { status: (code: number) => { json: (body: unknown) => void } },
  projectId: string | undefined,
): Promise<WebsiteProjectDbRow | null | undefined> {
  if (!projectId) return undefined;
  let project: WebsiteProjectDbRow | null;
  try {
    project = await getOwnedProject(req.userId!, projectId);
  } catch (err) {
    logger.error({ err }, "[website-builder] project lookup failed");
    res.status(500).json({ error: "project_lookup_failed" });
    return null;
  }
  if (!project) {
    res.status(404).json({ error: "project_not_found" });
    return null;
  }
  return project;
}

/* ─── Template gallery ───────────────────────────────────────────────────
   The gallery's starting builds for the builder page: metadata plus the
   real file maps, so "Remix this template" can seed a build client-side
   with the template's actual structure. Static data — free, no AI call,
   no charge. */
router.get("/templates", publicApiLimiter, (_req, res) => {
  res.json({ templates: WEBSITE_TEMPLATES });
});

router.post("/generate", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;

  const target = await resolveTargetProject(req, res, input.projectId);
  if (target === null) return; // 404/500 already sent — before any charge
  const targetProject = target ?? null;

  let charged = false;
  try {
    await chargeCredits(req.userId!, WEBSITE_BUILD_CREDITS, {
      action: `Website Build (${TEMPLATE_LABELS[input.template]})`,
    });
    charged = true;

    /* Seed from the creator's real material (brand kit, catalog, store,
       profile). Never throws — a failed seed degrades to the
       honest-placeholder path rather than failing a paid build. */
    const seed = await loadCreatorSeed(req.userId!);

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input, buildSeedContext(seed)) },
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

    // Sanity: output must satisfy the build schema (index.html + styles.css).
    if (!siteFilesSchema.safeParse(files).success) {
      throw new Error("AI output missing required files (index.html / styles.css)");
    }

    /* Persist the build. A save failure never eats a paid-for site:
       the member still receives the files, with saved:false so the
       client can retry the save explicitly. */
    let savedProjectId: string | null = null;
    let savedVersion: number | null = null;
    let saved = false;
    try {
      const result = await saveGeneratedBuild(req.userId!, {
        project: targetProject,
        clientRef: input.clientRef,
        name: input.businessName,
        template: input.template,
        brief: briefOf(input),
        files,
      });
      savedProjectId = result.projectId;
      savedVersion = result.version;
      saved = true;
    } catch (persistErr) {
      logger.error({ err: persistErr }, "[website-builder] failed to persist build");
    }

    res.json({
      files,
      template: input.template,
      templateLabel: TEMPLATE_LABELS[input.template],
      businessName: input.businessName,
      creditsCharged: WEBSITE_BUILD_CREDITS,
      fileCount: Object.keys(files).length,
      seededFrom: seedSummary(seed),
      ownership:
        "You own these files outright. Host them on your own domain — nothing is published or hosted on bowdownvisuals.com.",
      projectId: savedProjectId,
      version: savedVersion,
      saved,
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
  /* Persistence targeting (optional): when the edit belongs to a
     saved project, the result is appended as that project's new head
     version. Without it the edit behaves exactly as before (the
     browser-held build stays browser-held until explicitly saved). */
  projectId: z.string().uuid().optional(),
});

router.post("/edit", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const { template, businessName, currentFiles, editRequest } = parsed.data;

  const target = await resolveTargetProject(req, res, parsed.data.projectId);
  if (target === null) return; // 404/500 already sent — before any charge
  const targetProject = target ?? null;

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
            `Do not introduce any new facts (dates, prices, titles, quotes, stats) that are not already in the current site or this edit request — the FACT RULES still apply. ` +
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

    if (!siteFilesSchema.safeParse(files).success) {
      throw new Error("AI output missing required files after edit");
    }

    /* Append the edit as a new version of its project. Same rule as
       generate: a persistence failure never eats a paid-for edit. */
    let savedVersion: number | null = null;
    let saved = false;
    if (targetProject) {
      try {
        savedVersion = await appendVersion(targetProject, {
          source: "edit",
          note: editRequest,
          /* An edit inherits the brief of the build it edited. */
          brief: normalizeBrief(targetProject.brief),
          files,
        });
        saved = true;
      } catch (persistErr) {
        logger.error({ err: persistErr }, "[website-builder] failed to persist edit");
      }
    }

    res.json({
      files,
      creditsCharged: WEBSITE_EDIT_CREDITS,
      fileCount: Object.keys(files).length,
      ...(targetProject
        ? { projectId: targetProject.id, version: savedVersion, saved }
        : {}),
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

/* ─── Saved projects ─────────────────────────────────────────────────────
   The member's builder projects: list, open, version history,
   restore, explicit save, delete. All owner-scoped; a foreign id is
   a 404 everywhere. No thumbnails exist (nothing renders a preview
   server-side) — clients render the preview live from the payload. */

router.get("/projects", requireAuth, async (req, res) => {
  try {
    const projects = await listProjectSummaries(req.userId!);
    res.json({ projects });
  } catch (err) {
    logger.error({ err }, "[website-builder] failed to list projects");
    res.status(500).json({ error: "projects_load_failed" });
  }
});

const briefSchema = z.object({
  description: z.string().max(3000).optional().default(""),
  style: z.string().max(500).optional().default(""),
  colorScheme: z.string().max(200).optional().default(""),
});

const filesSchema = z
  .record(z.string(), z.string())
  .refine((f) => typeof f["index.html"] === "string" && typeof f["styles.css"] === "string", {
    message: "files must include index.html and styles.css",
  })
  .refine((f) => JSON.stringify(f).length <= 4_000_000, {
    message: "site payload too large",
  });

export const saveProjectSchema = z.object({
  projectId: z.string().uuid().optional(),
  clientRef: clientRefSchema.optional(),
  template: z.enum(TEMPLATES),
  businessName: z.string().min(1).max(120),
  brief: briefSchema,
  files: filesSchema,
  note: z.string().max(1000).optional(),
});

/* Explicit save — the client's retry path when an auto-save reported
   saved:false, and the way a browser-held build (e.g. one made before
   persistence existed) gets its first server copy. Idempotent by
   clientRef: re-saving the identical payload under the same
   clientRef returns the existing head instead of stacking a
   duplicate version. */
router.post("/projects", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = saveProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;
  const brief = normalizeBrief(input.brief);
  try {
    if (input.projectId) {
      const project = await getOwnedProject(req.userId!, input.projectId);
      if (!project) {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      const version = await appendVersion(project, {
        source: "save",
        note: input.note ?? null,
        brief,
        files: input.files,
        patchProject: { name: input.businessName, template: input.template },
      });
      res.json({
        project: await loadProjectSummary(req.userId!, project.id),
        version,
        created: false,
        deduplicated: false,
      });
      return;
    }
    if (input.clientRef) {
      const existing = await findProjectByClientRef(req.userId!, input.clientRef);
      if (existing) {
        const head = await headVersionRow(existing.id);
        if (head && filesEqual(asFiles(head.files), input.files)) {
          res.json({
            project: await loadProjectSummary(req.userId!, existing.id),
            version: head.version,
            created: false,
            deduplicated: true,
          });
          return;
        }
        const version = await appendVersion(existing, {
          source: "save",
          note: input.note ?? null,
          brief,
          files: input.files,
          patchProject: { name: input.businessName, template: input.template },
        });
        res.json({
          project: await loadProjectSummary(req.userId!, existing.id),
          version,
          created: false,
          deduplicated: false,
        });
        return;
      }
    }
    const created = await createProject(req.userId!, {
      clientRef: input.clientRef ?? null,
      name: input.businessName,
      template: input.template,
      brief,
      files: input.files,
      firstSource: "save",
    });
    res.status(201).json({
      project: await loadProjectSummary(req.userId!, created.project.id),
      version: created.version,
      created: true,
      deduplicated: false,
    });
  } catch (err) {
    logger.error({ err }, "[website-builder] failed to save project");
    res.status(500).json({ error: "project_save_failed" });
  }
});

router.get("/projects/:id", requireAuth, async (req, res) => {
  try {
    const project = await getOwnedProject(req.userId!, paramString(req.params.id));
    if (!project) {
      res.status(404).json({ error: "project_not_found" });
      return;
    }
    const metas = await versionMetas(project.id);
    const head = metas[0];
    res.json({
      project: {
        ...summarizeProject(
          project,
          metas.length,
          head ? { version: head.version, file_count: head.file_count } : null,
        ),
        brief: normalizeBrief(project.brief),
      },
      versions: metas.map((v) => ({
        id: v.id,
        version: v.version,
        source: v.source,
        note: v.note,
        fileCount: v.file_count,
        createdAt: v.created_at,
      })),
    });
  } catch (err) {
    logger.error({ err }, "[website-builder] failed to load project");
    res.status(500).json({ error: "project_load_failed" });
  }
});

router.get("/projects/:id/versions/:version", requireAuth, async (req, res) => {
  const version = parseVersionParam(paramString(req.params.version));
  if (version === null) {
    res.status(404).json({ error: "version_not_found" });
    return;
  }
  try {
    const project = await getOwnedProject(req.userId!, paramString(req.params.id));
    if (!project) {
      res.status(404).json({ error: "project_not_found" });
      return;
    }
    const row = await loadVersionRow(project.id, version);
    if (!row) {
      res.status(404).json({ error: "version_not_found" });
      return;
    }
    res.json({
      projectId: project.id,
      version: row.version,
      source: row.source,
      note: row.note,
      brief: normalizeBrief(row.brief),
      files: asFiles(row.files),
      fileCount: row.file_count,
      createdAt: row.created_at,
    });
  } catch (err) {
    logger.error({ err }, "[website-builder] failed to load version");
    res.status(500).json({ error: "version_load_failed" });
  }
});

/* Restore: the target version's payload becomes a NEW head version —
   history is appended to, never rewound. */
router.post(
  "/projects/:id/versions/:version/restore",
  requireAuth,
  publicApiLimiter,
  async (req, res) => {
    const version = parseVersionParam(paramString(req.params.version));
    if (version === null) {
      res.status(404).json({ error: "version_not_found" });
      return;
    }
    try {
      const project = await getOwnedProject(req.userId!, paramString(req.params.id));
      if (!project) {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      const target = await loadVersionRow(project.id, version);
      if (!target) {
        res.status(404).json({ error: "version_not_found" });
        return;
      }
      const brief = normalizeBrief(target.brief);
      const files = asFiles(target.files);
      const newVersion = await appendVersion(project, {
        source: "restore",
        note: `Restored from version ${target.version}`,
        brief,
        files,
      });
      res.json({
        projectId: project.id,
        version: newVersion,
        source: "restore",
        note: `Restored from version ${target.version}`,
        restoredFrom: target.version,
        brief,
        files,
        fileCount: target.file_count,
      });
    } catch (err) {
      logger.error({ err }, "[website-builder] failed to restore version");
      res.status(500).json({ error: "version_restore_failed" });
    }
  },
);

/* Delete is the owner's explicit action only: removes the project and
   (via ON DELETE CASCADE) every version with it. */
router.delete("/projects/:id", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    const project = await getOwnedProject(req.userId!, paramString(req.params.id));
    if (!project) {
      res.status(404).json({ error: "project_not_found" });
      return;
    }
    await db.execute(sql`
      DELETE FROM website_builder_projects WHERE id = ${project.id}
    `);
    res.json({ deleted: true, projectId: project.id });
  } catch (err) {
    logger.error({ err }, "[website-builder] failed to delete project");
    res.status(500).json({ error: "project_delete_failed" });
  }
});

export default router;
