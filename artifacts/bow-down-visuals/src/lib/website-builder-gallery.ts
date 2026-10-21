/* ─── Website Builder — template gallery (client logic) ──────────────────
   The gallery data comes from GET /api/website-builder/templates: real
   starter builds (file maps) authored server-side in
   api-server/src/routes/generate/website-templates.ts. This module holds
   the pure client logic around it — defensive parsing of the payload,
   remix seeding, and starter-brief extraction — so it can be unit-tested
   without rendering the page. */

export interface GalleryTemplateBrief {
  description: string;
  style: string;
  colorScheme: string;
}

export interface GalleryTemplate {
  id: string;
  name: string;
  vertical: string;
  verticalLabel: string;
  bestFor: string;
  description: string;
  sections: string[];
  brief: GalleryTemplateBrief;
  files: Record<string, string>;
}

/** Template keys the builder page can hold as its active template:
    the gallery ids (generate/edit accept them server-side too). */
export const GALLERY_TEMPLATE_KEYS = [
  "artist-site",
  "podcast-home",
  "streamer-hub",
  "showreel-portfolio",
] as const;
export type GalleryTemplateKey = (typeof GALLERY_TEMPLATE_KEYS)[number];

export function isGalleryTemplateKey(id: string): id is GalleryTemplateKey {
  return (GALLERY_TEMPLATE_KEYS as readonly string[]).includes(id);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    (val) => typeof val === "string",
  );
}

/** A template only enters the gallery if it is a complete, real build:
    metadata in plain language plus a file map carrying index.html and
    styles.css (the builder's build-schema completeness rule). */
export function isValidGalleryTemplate(v: unknown): v is GalleryTemplate {
  if (!v || typeof v !== "object") return false;
  const t = v as Partial<GalleryTemplate>;
  if (!isNonEmptyString(t.id) || !isGalleryTemplateKey(t.id)) return false;
  if (!isNonEmptyString(t.name)) return false;
  if (!isNonEmptyString(t.vertical)) return false;
  if (!isNonEmptyString(t.verticalLabel)) return false;
  if (!isNonEmptyString(t.bestFor)) return false;
  if (!isNonEmptyString(t.description)) return false;
  if (
    !Array.isArray(t.sections) ||
    t.sections.length === 0 ||
    !t.sections.every(isNonEmptyString)
  ) {
    return false;
  }
  const brief = t.brief as Partial<GalleryTemplateBrief> | undefined;
  if (
    !brief ||
    !isNonEmptyString(brief.description) ||
    typeof brief.style !== "string" ||
    typeof brief.colorScheme !== "string"
  ) {
    return false;
  }
  if (!isStringRecord(t.files)) return false;
  if (!t.files["index.html"] || !t.files["styles.css"]) return false;
  return true;
}

/** Parse the GET /templates payload, keeping only valid gallery entries.
    Anything malformed is dropped — a bad payload hides the gallery,
    never breaks the builder. */
export function parseGalleryTemplates(payload: unknown): GalleryTemplate[] {
  if (!payload || typeof payload !== "object") return [];
  const list = (payload as { templates?: unknown }).templates;
  if (!Array.isArray(list)) return [];
  return list.filter(isValidGalleryTemplate);
}

/** Remix seeding: the build starts from the template's real files.
    Returns a fresh map so edits/downloads never mutate the gallery data. */
export function cloneTemplateFiles(
  template: GalleryTemplate,
): Record<string, string> {
  return { ...template.files };
}

/** Remix also prefills the brief form from the template's starter brief,
    so "Build my version" (AI generate) and edits steer from the same
    starting point the creator picked. */
export function starterBrief(
  template: GalleryTemplate,
): GalleryTemplateBrief {
  return { ...template.brief };
}
