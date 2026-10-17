/**
 * brand-record.ts — the creator's brand kit as ONE source of truth.
 *
 * Linkage fix (audit DE-5): POST /api/brand-kit used to generate a kit and
 * throw it away — zero persistence, zero readers, while the editor asked
 * for a fresh logo upload, Intros asked for a pasted logo URL, and the
 * press/bio surfaces re-typed the same facts. The kit now lives on the
 * creator's own brand record: `creator_profiles.theme_config.brandKit`
 * (free-form JSONB — no migration; the theme normalizer spreads unknown
 * keys through untouched, so the kit survives every profile read/write).
 *
 * Shape stored (all camelCase at every boundary — DTO discipline):
 *   {
 *     brandName, vibe, industry,
 *     colors: [{hex, name, role} x5], fonts: [{heading, body, usage} x3],
 *     logoPrompt, taglines: [x5],
 *     selectedTagline: string | null,   // creator's pick (manual)
 *     logoUrl: string | null,           // creator's logo (manual)
 *     bioLines: string[],               // short bio lines (manual)
 *     pressFacts: string[],             // achievements / press facts (manual)
 *     generatedAt: ISO string,
 *     updatedAt: ISO string,
 *   }
 *
 * Consumers read through GET /api/brand-kit (free — reads never charge).
 * Generation still charges exactly once, in the route, as before.
 */
import { db, creatorProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export interface BrandColor {
  hex: string;
  name: string;
  role: string;
}

export interface BrandFont {
  heading: string;
  body: string;
  usage: string;
}

export interface StoredBrandKit {
  brandName: string;
  vibe: string;
  industry: string | null;
  colors: BrandColor[];
  fonts: BrandFont[];
  logoPrompt: string;
  taglines: string[];
  selectedTagline: string | null;
  logoUrl: string | null;
  bioLines: string[];
  pressFacts: string[];
  generatedAt: string | null;
  updatedAt: string | null;
}

/** What the generator produces (the pre-existing POST response's `kit`). */
export interface GeneratedBrandKit {
  colors: BrandColor[];
  fonts: BrandFont[];
  logoPrompt: string;
  taglines: string[];
}

function str(v: unknown, max = 500): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function strOrNull(v: unknown, max = 2000): string | null {
  const s = str(v, max).trim();
  return s ? s : null;
}

function strList(v: unknown, maxItems: number, maxLen = 300): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * Normalize whatever sits in theme_config.brandKit into the DTO, or null
 * when there is no usable kit. Pure — safe to unit-test without a DB.
 * A stored blob missing its generated core (colors/fonts/taglines) is not
 * a kit; manual fields alone don't resurrect one.
 */
export function brandKitDto(raw: unknown): StoredBrandKit | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const colors: BrandColor[] = Array.isArray(r["colors"])
    ? (r["colors"] as unknown[])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c) => ({ hex: str(c["hex"], 16), name: str(c["name"], 80), role: str(c["role"], 32) }))
        .filter((c) => c.hex)
    : [];
  const fonts: BrandFont[] = Array.isArray(r["fonts"])
    ? (r["fonts"] as unknown[])
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
        .map((f) => ({ heading: str(f["heading"], 120), body: str(f["body"], 120), usage: str(f["usage"], 240) }))
        .filter((f) => f.heading || f.body)
    : [];
  const taglines = strList(r["taglines"], 10, 240);
  const dto: StoredBrandKit = {
    brandName: str(r["brandName"], 120),
    vibe: str(r["vibe"], 500),
    industry: strOrNull(r["industry"], 120),
    colors,
    fonts,
    logoPrompt: str(r["logoPrompt"], 2000),
    taglines,
    selectedTagline: strOrNull(r["selectedTagline"], 240),
    logoUrl: strOrNull(r["logoUrl"], 2000),
    bioLines: strList(r["bioLines"], 8, 400),
    pressFacts: strList(r["pressFacts"], 16, 300),
    generatedAt: strOrNull(r["generatedAt"], 64),
    updatedAt: strOrNull(r["updatedAt"], 64),
  };
  /* A record with no content at all — no generated core AND no manual
     fields — is not a kit. A manual-only record (logo + bio lines saved
     before ever generating) IS a real partial record: consumers read the
     fields that exist and the DTO says plainly which those are. */
  const hasContent =
    colors.length > 0 || fonts.length > 0 || taglines.length > 0 ||
    dto.logoUrl !== null || dto.bioLines.length > 0 || dto.pressFacts.length > 0 ||
    dto.brandName.trim().length > 0;
  return hasContent ? dto : null;
}

/** An empty record base for manual-first saves (logo/bio before any
 *  generation). brandKitDto treats it as no kit until a field lands. */
export function blankBrandKit(nowIso: string): StoredBrandKit {
  return {
    brandName: "",
    vibe: "",
    industry: null,
    colors: [],
    fonts: [],
    logoPrompt: "",
    taglines: [],
    selectedTagline: null,
    logoUrl: null,
    bioLines: [],
    pressFacts: [],
    generatedAt: null,
    updatedAt: nowIso,
  };
}

/** Merge a fresh generation into any existing kit: the creator's manual
 *  fields (logo, chosen tagline, bio lines, press facts) survive a
 *  re-generation — regenerating colors must never wipe the logo. */
export function mergeGeneratedKit(
  existing: StoredBrandKit | null,
  input: { brandName: string; vibe: string; industry?: string },
  generated: GeneratedBrandKit,
  nowIso: string,
): StoredBrandKit {
  return {
    brandName: input.brandName,
    vibe: input.vibe,
    industry: input.industry?.trim() ? input.industry.trim().slice(0, 120) : null,
    colors: generated.colors,
    fonts: generated.fonts,
    logoPrompt: generated.logoPrompt,
    taglines: generated.taglines,
    selectedTagline:
      existing?.selectedTagline && generated.taglines.includes(existing.selectedTagline)
        ? existing.selectedTagline
        : null,
    logoUrl: existing?.logoUrl ?? null,
    bioLines: existing?.bioLines ?? [],
    pressFacts: existing?.pressFacts ?? [],
    generatedAt: nowIso,
    updatedAt: nowIso,
  };
}

interface OwnProfileRow {
  id: string;
  themeConfig: Record<string, unknown> | null;
}

async function getOwnProfileRow(userId: string): Promise<OwnProfileRow | null> {
  const [row] = await db
    .select({ id: creatorProfilesTable.id, themeConfig: creatorProfilesTable.themeConfig })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return (row as OwnProfileRow | undefined) ?? null;
}

/** The creator's saved kit, or null (no profile yet, or no kit saved). */
export async function readBrandKit(userId: string): Promise<StoredBrandKit | null> {
  const row = await getOwnProfileRow(userId);
  if (!row) return null;
  return brandKitDto((row.themeConfig ?? {})["brandKit"]);
}

/**
 * Persist a kit onto the creator's profile record. Returns false when the
 * creator has no profile yet — the caller reports that honestly instead of
 * pretending the kit was saved (generation itself still succeeds).
 */
export async function writeBrandKit(userId: string, kit: StoredBrandKit): Promise<boolean> {
  const row = await getOwnProfileRow(userId);
  if (!row) return false;
  const nextConfig = { ...(row.themeConfig ?? {}), brandKit: kit };
  await db
    .update(creatorProfilesTable)
    .set({ themeConfig: nextConfig, updatedAt: new Date() })
    .where(eq(creatorProfilesTable.id, row.id));
  return true;
}

/**
 * Apply the kit to the profile's live theme values: colors by role where
 * the two vocabularies honestly meet (kit primary → theme primary, accent
 * → accent, background → background; the kit's secondary/neutral roles
 * have no theme slot and are not forced into one) and the kit's lead font
 * pairing into theme fonts. Other theme keys are preserved untouched.
 * Returns "no_profile" | "no_kit" | "applied".
 */
export async function applyBrandKitToTheme(
  userId: string,
): Promise<{ status: "applied"; kit: StoredBrandKit } | { status: "no_profile" } | { status: "no_kit" }> {
  const row = await getOwnProfileRow(userId);
  if (!row) return { status: "no_profile" };
  const config = { ...(row.themeConfig ?? {}) };
  const kit = brandKitDto(config["brandKit"]);
  if (!kit || kit.colors.length === 0 || kit.fonts.length === 0) return { status: "no_kit" };

  const byRole = new Map(kit.colors.map((c) => [c.role, c.hex]));
  const existingColors =
    config["colors"] && typeof config["colors"] === "object" && !Array.isArray(config["colors"])
      ? (config["colors"] as Record<string, unknown>)
      : {};
  const nextColors: Record<string, unknown> = { ...existingColors };
  for (const role of ["primary", "accent", "background"] as const) {
    const hex = byRole.get(role);
    if (hex) nextColors[role] = hex;
  }
  const lead = kit.fonts[0];
  const existingFonts =
    config["fonts"] && typeof config["fonts"] === "object" && !Array.isArray(config["fonts"])
      ? (config["fonts"] as Record<string, unknown>)
      : {};
  const nextFonts: Record<string, unknown> = { ...existingFonts };
  if (lead?.heading) nextFonts["heading"] = lead.heading;
  if (lead?.body) nextFonts["body"] = lead.body;

  config["colors"] = nextColors;
  config["fonts"] = nextFonts;
  await db
    .update(creatorProfilesTable)
    .set({ themeConfig: config, updatedAt: new Date() })
    .where(eq(creatorProfilesTable.id, row.id));
  logger.info({ userId }, "[brand-kit] applied kit to profile theme");
  return { status: "applied", kit };
}
