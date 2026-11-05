import { getCreditCost } from "../credit-costs";
import { isGalleryTemplateKey } from "../website-builder-gallery";

/* ─── Website Builder desk seam (stack100 wave 4, item 23) ─────────
   The AI Website Builder native at My Studio, on the builder's own
   rails — the same endpoints pages/website-builder.tsx calls:

     GET    /api/website-builder/templates                → gallery
                                   starter builds (public, no auth)
     POST   /api/website-builder/generate                 → AI build:
                                   3,000 Visual Bucs (registry-pinned
                                   in lib/credit-costs.ts; the rail
                                   charges before the AI call and
                                   refunds on any failure)
     POST   /api/website-builder/edit                     → conversational
                                   edit: 200 Visual Bucs (registry-
                                   pinned; same charge/refund rail)
     GET    /api/website-builder/projects                 → the caller's
                                   saved projects (FREE)
     POST   /api/website-builder/projects                 → explicit
                                   save / retry save (FREE; idempotent
                                   by clientRef)
     GET    /api/website-builder/projects/:id             → project +
                                   brief + version metas (FREE)
     GET    /api/website-builder/projects/:id/versions/:v → one
                                   version's exact files (FREE)
     POST   /api/website-builder/projects/:id/versions/:v/restore
                                   → restore appends a NEW head
                                   version; history never rewinds (FREE)
     DELETE /api/website-builder/projects/:id             → delete (FREE)

   The export model is the page's, unchanged: describe a site → the
   AI builds a complete static package → private preview → download
   the zip → host it on your own domain. NOTHING is published or
   hosted on bowdownvisuals.com.

   Prices are DERIVED from the registry below — the seam and the desk
   carry no price literal, and the desk rides useConfirmedApi WITHOUT
   overrideCost/overrideFeature, so the standing CreditConfirm popup
   names exactly what the registry row says (the 2D page's page-local
   literals are deliberately NOT copied). The confirm is the spend
   gate: declining it returns null from confirmedFetch and nothing is
   sent or charged. Exactly-once is the rails' own contract: a build
   carries the desk's per-build clientRef, so a retried save lands on
   the same server project instead of duplicating it.

   Every builder rail is requireAuth — members only, exactly the 2D
   page's boundary. The desk mounts in the My Studio board stack,
   which a guest never reaches (guest-pitch instead), so there is no
   guest face to dress up. */

export const WEBSITE_BUILDER_TEMPLATES_PATH = "/api/website-builder/templates";
export const WEBSITE_BUILDER_GENERATE_PATH = "/api/website-builder/generate";
export const WEBSITE_BUILDER_EDIT_PATH = "/api/website-builder/edit";
export const WEBSITE_BUILDER_PROJECTS_PATH = "/api/website-builder/projects";

export function websiteProjectPath(id: string): string {
  return `${WEBSITE_BUILDER_PROJECTS_PATH}/${encodeURIComponent(id)}`;
}

export function websiteProjectVersionPath(id: string, version: number): string {
  return `${websiteProjectPath(id)}/versions/${version}`;
}

export function websiteProjectRestorePath(id: string, version: number): string {
  return `${websiteProjectVersionPath(id, version)}/restore`;
}

/** Registry-pinned prices (lib/credit-costs.ts:
 *  "/api/website-builder/generate": { cost: 3000, feature: "Website Build" }
 *  "/api/website-builder/edit": { cost: 200, feature: "Website Edit" }
 *  "/api/website-builder/projects": { cost: 0, feature: "Save Website Project (free)" }).
 *  Derived, never literals: a vanished row reads −1 / "" and fails the
 *  desk's price pins loudly instead of quietly mispricing a build. */
export const WEBSITE_BUILD_COST_VB = getCreditCost(WEBSITE_BUILDER_GENERATE_PATH)?.cost ?? -1;
export const WEBSITE_BUILD_FEATURE = getCreditCost(WEBSITE_BUILDER_GENERATE_PATH)?.feature ?? "";
export const WEBSITE_EDIT_COST_VB = getCreditCost(WEBSITE_BUILDER_EDIT_PATH)?.cost ?? -1;
export const WEBSITE_EDIT_FEATURE = getCreditCost(WEBSITE_BUILDER_EDIT_PATH)?.feature ?? "";
export const WEBSITE_PROJECTS_COST_VB = getCreditCost(WEBSITE_BUILDER_PROJECTS_PATH)?.cost ?? -1;

/* ─── Templates ────────────────────────────────────────────────────
   The rail's template enum: the gallery keys (website-templates.ts)
   plus the three brief-only keys. The desk's picker offers the four
   brief templates the 2D page offers, with the page's own English
   words; a gallery remix can also make a gallery key the active
   template, exactly like the page. */

export const WEBSITE_BUILDER_TEMPLATE_KEYS = [
  "artist-site",
  "podcast-home",
  "streamer-hub",
  "showreel-portfolio",
  "press-kit",
  "link-in-bio",
  "tour-page",
] as const;
export type WebsiteTemplateKey = (typeof WEBSITE_BUILDER_TEMPLATE_KEYS)[number];

export function isWebsiteTemplateKey(id: string): id is WebsiteTemplateKey {
  return (WEBSITE_BUILDER_TEMPLATE_KEYS as readonly string[]).includes(id);
}

export const WEBSITE_BUILDER_TEMPLATES: ReadonlyArray<{
  key: WebsiteTemplateKey;
  label: string;
  blurb: string;
}> = [
  {
    key: "artist-site",
    label: "Artist Site",
    blurb: "Full homepage: hero, music, about, shows, gallery, mailing list.",
  },
  {
    key: "press-kit",
    label: "Press Kit",
    blurb: "EPK: bio, photos, music, press quotes, tour dates, booking contact.",
  },
  {
    key: "link-in-bio",
    label: "Link-in-Bio Plus",
    blurb: "Smart links, release spotlight, socials, newsletter capture.",
  },
  {
    key: "tour-page",
    label: "Tour Page",
    blurb: "Date list, ticket links, VIP packages, presale signup.",
  },
];

/* ─── Shapes ─────────────────────────────────────────────────────── */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export type WebsiteFiles = Record<string, string>;

/** A file map only counts as a build when it is a plain string record
 *  carrying the rail's completeness pair — index.html + styles.css
 *  (the server enforces the same siteFilesSchema before it saves). */
export function normalizeWebsiteFiles(v: unknown): WebsiteFiles | null {
  const r = asRecord(v);
  if (!r) return null;
  const out: WebsiteFiles = {};
  for (const [k, val] of Object.entries(r)) {
    if (typeof val !== "string") return null;
    out[k] = val;
  }
  if (!out["index.html"] || !out["styles.css"]) return null;
  return out;
}

export interface WebsiteBrief {
  description: string;
  style: string;
  colorScheme: string;
}

export interface WebsiteProjectSummary {
  id: string;
  name: string;
  template: string;
  templateLabel: string;
  versionCount: number;
  latestVersion: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

function normalizeProjectRow(r: Record<string, unknown>): WebsiteProjectSummary | null {
  const id = str(r["id"]);
  const name = str(r["name"]);
  if (!id || !name) return null;
  return {
    id,
    name,
    template: str(r["template"]),
    templateLabel: str(r["templateLabel"]),
    versionCount: num(r["versionCount"]),
    latestVersion: num(r["latestVersion"]),
    fileCount: num(r["fileCount"]),
    createdAt: str(r["createdAt"]),
    updatedAt: str(r["updatedAt"]),
  };
}

/** The saved-projects list: a malformed row is dropped, never dressed
 *  up — the member's real projects still show. A payload without the
 *  projects array at all is not a list (null → the desk's error state). */
export function normalizeWebsiteProjects(payload: unknown): WebsiteProjectSummary[] | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["projects"])) return null;
  const out: WebsiteProjectSummary[] = [];
  for (const raw of root["projects"]) {
    const r = asRecord(raw);
    if (!r) continue;
    const row = normalizeProjectRow(r);
    if (row) out.push(row);
  }
  return out;
}

export interface WebsiteVersionMeta {
  id: string;
  version: number;
  source: string;
  note: string | null;
  fileCount: number;
  createdAt: string;
}

function normalizeVersionRow(r: Record<string, unknown>): WebsiteVersionMeta | null {
  const id = str(r["id"]);
  if (!id) return null;
  return {
    id,
    version: num(r["version"]),
    source: str(r["source"]),
    note: strOrNull(r["note"]),
    fileCount: num(r["fileCount"]),
    createdAt: str(r["createdAt"]),
  };
}

export interface WebsiteProjectDetail {
  project: WebsiteProjectSummary & { brief: WebsiteBrief };
  versions: WebsiteVersionMeta[];
}

export function normalizeWebsiteProjectDetail(payload: unknown): WebsiteProjectDetail | null {
  const root = asRecord(payload);
  if (!root) return null;
  const projectRaw = asRecord(root["project"]);
  if (!projectRaw) return null;
  const summary = normalizeProjectRow(projectRaw);
  if (!summary) return null;
  const briefRaw = asRecord(projectRaw["brief"]);
  const brief: WebsiteBrief = {
    description: briefRaw ? str(briefRaw["description"]) : "",
    style: briefRaw ? str(briefRaw["style"]) : "",
    colorScheme: briefRaw ? str(briefRaw["colorScheme"]) : "",
  };
  const versions: WebsiteVersionMeta[] = [];
  if (Array.isArray(root["versions"])) {
    for (const raw of root["versions"]) {
      const r = asRecord(raw);
      if (!r) continue;
      const row = normalizeVersionRow(r);
      if (row) versions.push(row);
    }
  }
  return { project: { ...summary, brief }, versions };
}

export interface WebsiteVersionPayload {
  projectId: string;
  version: number;
  source: string;
  note: string | null;
  brief: WebsiteBrief;
  files: WebsiteFiles;
  fileCount: number;
  createdAt: string;
}

/** One version's exact build. Files that fail the completeness pair
 *  are not a build — null, so the desk says the open failed instead
 *  of previewing a husk. */
export function normalizeWebsiteVersionPayload(payload: unknown): WebsiteVersionPayload | null {
  const root = asRecord(payload);
  if (!root) return null;
  const files = normalizeWebsiteFiles(root["files"]);
  if (!files) return null;
  const briefRaw = asRecord(root["brief"]);
  return {
    projectId: str(root["projectId"]),
    version: num(root["version"]),
    source: str(root["source"]),
    note: strOrNull(root["note"]),
    brief: {
      description: briefRaw ? str(briefRaw["description"]) : "",
      style: briefRaw ? str(briefRaw["style"]) : "",
      colorScheme: briefRaw ? str(briefRaw["colorScheme"]) : "",
    },
    files,
    fileCount: num(root["fileCount"]) || Object.keys(files).length,
    createdAt: str(root["createdAt"]),
  };
}

export interface WebsiteSeededFrom {
  profile: boolean;
  brandKit: boolean;
  songs: number;
  videos: number;
  products: number;
  shows: number;
}

export function normalizeWebsiteSeededFrom(v: unknown): WebsiteSeededFrom | null {
  const r = asRecord(v);
  if (!r) return null;
  return {
    profile: r["profile"] === true,
    brandKit: r["brandKit"] === true,
    songs: num(r["songs"]),
    videos: num(r["videos"]),
    products: num(r["products"]),
    shows: num(r["shows"]),
  };
}

export interface WebsiteGenerateResult {
  files: WebsiteFiles;
  templateLabel: string;
  businessName: string;
  fileCount: number;
  seededFrom: WebsiteSeededFrom | null;
  ownership: string;
  projectId: string | null;
  version: number | null;
  saved: boolean;
}

/** The page's success rule, kept: a generate response without files
 *  is a failure, never a result. saved is false ONLY when the rail
 *  says so — an absent flag means the save landed (pre-persistence
 *  responses read as saved, like the page treats them). */
export function normalizeWebsiteGenerateResult(payload: unknown): WebsiteGenerateResult | null {
  const root = asRecord(payload);
  if (!root) return null;
  const files = normalizeWebsiteFiles(root["files"]);
  if (!files) return null;
  return {
    files,
    templateLabel: str(root["templateLabel"]),
    businessName: str(root["businessName"]),
    fileCount: num(root["fileCount"]) || Object.keys(files).length,
    seededFrom: normalizeWebsiteSeededFrom(root["seededFrom"]),
    ownership: str(root["ownership"]),
    projectId: strOrNull(root["projectId"]),
    version: typeof root["version"] === "number" ? root["version"] : null,
    saved: root["saved"] !== false,
  };
}

export interface WebsiteEditResult {
  files: WebsiteFiles;
  fileCount: number;
  projectId: string | null;
  version: number | null;
  saved: boolean;
}

export function normalizeWebsiteEditResult(payload: unknown): WebsiteEditResult | null {
  const root = asRecord(payload);
  if (!root) return null;
  const files = normalizeWebsiteFiles(root["files"]);
  if (!files) return null;
  return {
    files,
    fileCount: num(root["fileCount"]) || Object.keys(files).length,
    projectId: strOrNull(root["projectId"]),
    version: typeof root["version"] === "number" ? root["version"] : null,
    saved: root["saved"] !== false,
  };
}

export interface WebsiteSaveResult {
  project: WebsiteProjectSummary;
  version: number | null;
  created: boolean;
  deduplicated: boolean;
}

export function normalizeWebsiteSaveResult(payload: unknown): WebsiteSaveResult | null {
  const root = asRecord(payload);
  if (!root) return null;
  const projectRaw = asRecord(root["project"]);
  if (!projectRaw) return null;
  const project = normalizeProjectRow(projectRaw);
  if (!project) return null;
  return {
    project,
    version: typeof root["version"] === "number" ? root["version"] : null,
    created: root["created"] === true,
    deduplicated: root["deduplicated"] === true,
  };
}

/** The rail's refusal, read the way the page's family reads it: the
 *  402 status, or the machine error name in the body. */
export function websiteBuilderOutOfCredits(status: number, payload: unknown): boolean {
  if (status === 402) return true;
  const root = asRecord(payload);
  return root?.["error"] === "out_of_credits";
}

/* ─── The brief form — the rail's zod rules ────────────────────────
   generateSchema: businessName 1–120, description 20–3000,
   style ≤500, colorScheme ≤200. The desk arms its Build button on
   the same rules the page arms its own (trimmed name/description),
   so a tap never sails into a 400 the form could have named first. */

export const WEBSITE_NAME_MAX = 120;
export const WEBSITE_DESCRIPTION_MIN = 20;
export const WEBSITE_DESCRIPTION_MAX = 3000;
export const WEBSITE_STYLE_MAX = 500;
export const WEBSITE_COLORS_MAX = 200;
export const WEBSITE_EDIT_MIN = 5;
export const WEBSITE_EDIT_MAX = 1000;

export interface WebsiteBriefForm {
  businessName: string;
  description: string;
  style: string;
  colorScheme: string;
}

export function websiteBriefReady(form: WebsiteBriefForm): boolean {
  const name = form.businessName.trim();
  const description = form.description.trim();
  return (
    name.length >= 1 &&
    name.length <= WEBSITE_NAME_MAX &&
    description.length >= WEBSITE_DESCRIPTION_MIN &&
    description.length <= WEBSITE_DESCRIPTION_MAX &&
    form.style.length <= WEBSITE_STYLE_MAX &&
    form.colorScheme.length <= WEBSITE_COLORS_MAX
  );
}

/** editSchema: the working build must exist (with its completeness
 *  pair) and the request runs 5–1000 trimmed characters. */
export function websiteEditReady(files: WebsiteFiles | null, editRequest: string): boolean {
  if (!files || !files["index.html"]) return false;
  const req = editRequest.trim();
  return req.length >= WEBSITE_EDIT_MIN && req.length <= WEBSITE_EDIT_MAX;
}

/* ─── Request bodies — the page's exact key sets ─────────────────── */

export function buildWebsiteGenerateBody(args: {
  template: string;
  businessName: string;
  description: string;
  style: string;
  colorScheme: string;
  projectId?: string | null;
  clientRef: string;
}): Record<string, unknown> {
  return {
    template: args.template,
    businessName: args.businessName.trim(),
    description: args.description.trim(),
    style: args.style.trim(),
    colorScheme: args.colorScheme.trim(),
    ...(args.projectId ? { projectId: args.projectId } : {}),
    clientRef: args.clientRef,
  };
}

export function buildWebsiteEditBody(args: {
  template: string;
  businessName: string;
  currentFiles: WebsiteFiles;
  editRequest: string;
  projectId?: string | null;
}): Record<string, unknown> {
  return {
    template: args.template,
    businessName: args.businessName.trim(),
    currentFiles: args.currentFiles,
    editRequest: args.editRequest.trim(),
    ...(args.projectId ? { projectId: args.projectId } : {}),
  };
}

export function buildWebsiteSaveBody(args: {
  projectId?: string | null;
  clientRef: string;
  template: string;
  businessName: string;
  brief: WebsiteBrief;
  files: WebsiteFiles;
}): Record<string, unknown> {
  return {
    ...(args.projectId ? { projectId: args.projectId } : {}),
    clientRef: args.clientRef,
    template: args.template,
    businessName: args.businessName.trim(),
    brief: {
      description: args.brief.description.trim(),
      style: args.brief.style.trim(),
      colorScheme: args.brief.colorScheme.trim(),
    },
    files: args.files,
  };
}

/* ─── Preview + download helpers — the page's own logic ──────────── */

/** Inline styles.css + script.js into index.html for the private
 *  iframe preview — the page's inliner, verbatim. */
export function buildPreviewHtml(files: WebsiteFiles): string {
  let html = files["index.html"] ?? "";
  const css = files["styles.css"] ?? "";
  const js = files["script.js"] ?? "";
  if (css) {
    html = html.replace(
      /<link[^>]*styles\.css[^>]*>/i,
      `<style>\n${css}\n</style>`,
    );
  }
  if (js) {
    html = html.replace(
      /<script[^>]*script\.js[^>]*><\/script>/i,
      `<script>\n${js.replace(/<\/script>/gi, "<\\/script>")}\n</script>`,
    );
  }
  return html;
}

/** The page's zip names: "<slug>-site" folder, "<slug>-website.zip". */
export function websiteZipSlug(businessName: string): string {
  return businessName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function websiteZipFolderName(businessName: string): string {
  return `${websiteZipSlug(businessName)}-site`;
}

export function websiteZipFileName(businessName: string): string {
  return `${websiteZipSlug(businessName)}-website.zip`;
}

export interface WebsiteSourceLabelStrings {
  initial: string;
  rebuild: string;
  edit: string;
  restore: string;
  savedCopy: string;
}

export const WEBSITE_SOURCE_LABEL_DEFAULTS: WebsiteSourceLabelStrings = {
  initial: "Initial build",
  rebuild: "Rebuild",
  edit: "Edit",
  restore: "Restore",
  savedCopy: "Saved copy",
};

/** Version sources, in the page's own English words. */
export function websiteSourceLabel(source: string, s: WebsiteSourceLabelStrings = WEBSITE_SOURCE_LABEL_DEFAULTS): string {
  switch (source) {
    case "generate":
      return s.initial;
    case "regenerate":
      return s.rebuild;
    case "edit":
      return s.edit;
    case "restore":
      return s.restore;
    case "save":
      return s.savedCopy;
    default:
      return source;
  }
}

/* ─── Desk copy — the page's and the rail's own words ────────────── */

/** The rail's ownership line, verbatim from the generate response. */
export const WEBSITE_BUILDER_OWNERSHIP_LINE =
  "You own these files outright. Host them on your own domain — nothing is published or hosted on bowdownvisuals.com.";
export const WEBSITE_BUILDER_FEE_NOTE =
  "One-time fee. You preview before anything is final, and you own the files outright.";
export const WEBSITE_BUILDER_OUT_OF_CREDITS_LINE =
  "Not enough Visual Bucs for that — nothing was charged. Top up at the Treasury and try again.";
export const WEBSITE_BUILDER_GENERATION_FAILED_LINE =
  "Generation failed — Visual Bucs were refunded.";
export const WEBSITE_BUILDER_EDIT_FAILED_LINE = "Edit failed — Visual Bucs were refunded.";
export const WEBSITE_BUILDER_SAVE_FAILED_LINE =
  "Your site was built, but it couldn't be saved to your account. Download the zip to be safe, or retry the save.";
export const WEBSITE_BUILDER_PREVIEW_OPENS_NOTE = "Preview renders live when you open it";

export const WEBSITE_BUILDER_DESK_PROMOTION =
  "#97 Website Builder in the My Studio stack: describe a site and the AI builds the full package on the /api/website-builder rails — generate at the registry's Website Build price and conversational edits at the Website Edit price through the standing spend confirm, projects + version history + restore on the free projects rails, private in-desk preview and the zip download in the room — nothing is published or hosted on bowdownvisuals.com";

export const WEBSITE_BUILDER_DESK_FOLLOW_ONS = [
  "The zip download is a file act done in-desk with the page's own JSZip loader (cdnjs 3.10.1) — a download, not a page pull-up; World law forbids the exit, not the file",
  "The registry rows must move with the server env constants (WEBSITE_BUILD_CREDIT_COST / WEBSITE_EDIT_CREDIT_COST) if those ever change — the page, the desk and the rail all read the one registry/rail pair",
  "Gallery remix seeds from the GET /templates starter builds via lib/website-builder-gallery, exactly like the page — the desk keeps no second template source",
] as const;

/* Re-exported so the desk's gallery shelf speaks the gallery module's
   one key vocabulary (a remix may only seed a real gallery key). */
export { isGalleryTemplateKey };
