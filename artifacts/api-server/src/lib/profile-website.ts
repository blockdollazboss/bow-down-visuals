import { db, creatorSubscriptionsTable, creatorHostingTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { tierFromLegacyPlan, tierFromPlanTier } from "./platform-fees";
import { logger } from "./logger";

/* ── "The profile IS the website" — shared model (Stack 3) ───────────────
   The data/engine layer behind the profile-as-website stack:

   - Item 2 (DESIGN-GATED visuals): the block layout model. A profile's
     layout is an ordered list of blocks; the block-type registry below is
     derived from the sections the artist profile page ALREADY renders —
     the section switch in components/artist/profile-sections.tsx plus
     the page-level sections in pages/artist-public.tsx (The Front Row,
     Trophy Shelf, social links) plus the new page-level blocks this
     stack adds (spotlight pin, store catalog, memberships). No freeform
     code/HTML can exist in a block: types come from this registry only,
     titles are capped plain text, and config values are scalar
     primitives only.
   - Item 3 (DESIGN-GATED visuals): theme settings — colorway + font
     choices as validated KEYS resolved server-side from the registries
     below (mirroring the frontend THEME_PRESETS / SAFE_FONTS in
     lib/artist-profiles.ts). Raw CSS from users is never stored.
   - Item 7: resolvePaidPlan — the ONE definition of "paid" the
     branding rule and the Hosting plan share.

   Nothing here renders anything; the editor UI and the themed rendering
   wait for the owner's design pick.                                    */

/* ── Block registry ─────────────────────────────────────────────────────── */

export type ProfileBlockSource = "section" | "page";

export interface ProfileBlockTypeDef {
  type: string;
  label: string;
  /** "section" blocks live in the profile's sections array today;
      "page" blocks are rendered by the page shell around them. */
  source: ProfileBlockSource;
}

export const PROFILE_BLOCK_TYPES: ProfileBlockTypeDef[] = [
  /* Section-sourced — the ProfileSections switch, in its canonical order. */
  { type: "hero", label: "Featured Hero", source: "section" },
  { type: "tracks", label: "Tracks / Episodes", source: "section" },
  { type: "videos", label: "Videos / Clips", source: "section" },
  { type: "series", label: "Series & Seasons", source: "section" },
  { type: "merch", label: "Merch Shelf", source: "section" },
  { type: "events", label: "Events / Tour", source: "section" },
  { type: "schedule", label: "Stream Schedule", source: "section" },
  { type: "mediakit", label: "Media Kit", source: "section" },
  { type: "posts", label: "Social Posts", source: "section" },
  { type: "bio", label: "About", source: "section" },
  { type: "shoutwall", label: "Shout Wall", source: "section" },
  { type: "stories", label: "Stories", source: "section" },
  { type: "topcreators", label: "Top Creators", source: "section" },
  /* Page-sourced — rendered by artist-public.tsx around the sections. */
  { type: "spotlight", label: "Spotlight Pin", source: "page" },
  { type: "court", label: "The Front Row", source: "page" },
  { type: "achievements", label: "Trophy Shelf", source: "page" },
  { type: "store", label: "Store", source: "page" },
  { type: "memberships", label: "Memberships", source: "page" },
  { type: "links", label: "Social Links", source: "page" },
];

export const PROFILE_BLOCK_TYPE_SET = new Set(PROFILE_BLOCK_TYPES.map((b) => b.type));

/** Sane ceiling: the registry holds 19 types and each type may appear
    at most once, so 24 leaves headroom without ever allowing bloat. */
export const MAX_PROFILE_BLOCKS = 24;

export interface ProfileBlockDto {
  type: string;
  title: string;
  visible: boolean;
  config: Record<string, string | number | boolean | null>;
}

const CONFIG_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

/** Validate + normalize one block's config: a flat record of scalar
    primitives only. Nested objects/arrays are rejected outright — a
    block config can never smuggle markup or code into the page. */
function normalizeBlockConfig(raw: unknown): Record<string, string | number | boolean | null> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 10) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of entries) {
    if (!CONFIG_KEY_RE.test(key)) return null;
    if (value === null || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string" && value.length <= 200) out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else return null;
  }
  return out;
}

export type LayoutValidation =
  | { ok: true; blocks: ProfileBlockDto[] }
  | { ok: false; error: string; message: string };

/** Strictly validate a client-supplied layout. Known block types only,
    one block per type, capped count, plain-text titles, scalar config. */
export function validateLayout(raw: unknown): LayoutValidation {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "INVALID_LAYOUT", message: "Send your layout as a list of blocks." };
  }
  if (raw.length > MAX_PROFILE_BLOCKS) {
    return {
      ok: false,
      error: "TOO_MANY_BLOCKS",
      message: `A profile layout holds at most ${MAX_PROFILE_BLOCKS} blocks.`,
    };
  }
  const seen = new Set<string>();
  const blocks: ProfileBlockDto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "INVALID_BLOCK", message: "Every block must be an object with a type." };
    }
    const rec = item as Record<string, unknown>;
    const type = typeof rec["type"] === "string" ? rec["type"] : "";
    if (!PROFILE_BLOCK_TYPE_SET.has(type)) {
      return { ok: false, error: "UNKNOWN_BLOCK_TYPE", message: `“${type || "?"}” isn't a profile block. Pick from the designed blocks.` };
    }
    if (seen.has(type)) {
      return { ok: false, error: "DUPLICATE_BLOCK", message: `The ${type} block can only appear once in a layout.` };
    }
    seen.add(type);
    const def = PROFILE_BLOCK_TYPES.find((b) => b.type === type)!;
    const titleRaw = rec["title"];
    if (titleRaw !== undefined && (typeof titleRaw !== "string" || titleRaw.trim().length > 80)) {
      return { ok: false, error: "INVALID_BLOCK_TITLE", message: "Block titles are plain text, up to 80 characters." };
    }
    const visibleRaw = rec["visible"];
    if (visibleRaw !== undefined && typeof visibleRaw !== "boolean") {
      return { ok: false, error: "INVALID_BLOCK", message: "A block's visible flag must be true or false." };
    }
    const config = normalizeBlockConfig(rec["config"]);
    if (config === null) {
      return {
        ok: false,
        error: "INVALID_BLOCK_CONFIG",
        message: "Block settings hold simple values only — no code, no markup, no nested objects.",
      };
    }
    blocks.push({
      type,
      title: typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : def.label,
      visible: visibleRaw !== undefined ? visibleRaw : true,
      config,
    });
  }
  return { ok: true, blocks };
}

/* ── Default layout ───────────────────────────────────────────────────────
   The Grand Stage composition — the owner's picked default (Oct 16):
   the masthead (hero) leads, then The Stage → The Front Row → Music →
   Videos → Store → Memberships in that exact order, then anything else
   the profile has in its existing relative order (stored sections, or
   the vertical's starter order when none were ever saved — mirroring
   the frontend STARTER_TEMPLATES), closing with the Trophy Shelf and
   Social Links. Blocks the profile already has as stored sections keep
   their own title and visibility in their Grand Stage slots; the rest
   are synthesized with the picked titles. An owner's SAVED layout
   always wins over this default — the block editor re-arranges within
   the same registry. */

const STARTER_LAYOUTS: Record<string, Array<[string, string]>> = {
  music: [["hero", "Featured Track"], ["tracks", "Music"], ["videos", "Videos"], ["merch", "Merch Shelf"], ["events", "Tour Dates"], ["bio", "About"], ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"]],
  video: [["hero", "Featured Video"], ["videos", "Videos"], ["series", "Series & Playlists"], ["merch", "Merch Shelf"], ["bio", "About"], ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"], ["events", "Events"]],
  gaming: [["hero", "Stream"], ["videos", "Clips & Highlights"], ["schedule", "Stream Schedule"], ["series", "Series"], ["merch", "Merch Shelf"], ["bio", "About"], ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"]],
  podcast: [["hero", "Featured Episode"], ["tracks", "Episodes"], ["series", "Series"], ["videos", "Video Clips"], ["bio", "About the Show"], ["events", "Live Shows"], ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"]],
  film: [["hero", "Featured Trailer"], ["series", "Films & Seasons"], ["videos", "Behind the Scenes"], ["bio", "About"], ["events", "Premieres"], ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"], ["merch", "Merch Shelf"]],
  tv: [["hero", "Featured Trailer"], ["series", "Seasons & Episodes"], ["videos", "Behind the Scenes"], ["bio", "About"], ["events", "Premieres"], ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"], ["merch", "Merch Shelf"]],
  influencer: [["hero", "Featured"], ["mediakit", "Media Kit"], ["videos", "Content"], ["tracks", "Audio"], ["merch", "My Picks"], ["bio", "About"], ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"]],
  education: [["hero", "Featured Lesson"], ["videos", "Lessons"], ["series", "Courses"], ["merch", "Resources"], ["bio", "About"], ["events", "Workshops"], ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"]],
  other: [["hero", "Featured"], ["videos", "Videos"], ["tracks", "Audio"], ["bio", "About"], ["merch", "Merch Shelf"], ["events", "Events"], ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"]],
};

const GRAND_STAGE_SEQUENCE: Array<[string, string]> = [
  ["spotlight", "The Stage"],
  ["court", "The Front Row"],
  ["tracks", "Music"],
  ["videos", "Videos"],
  ["store", "Store"],
  ["memberships", "Memberships"],
];
const PAGE_BLOCK_TAIL: Array<[string, string]> = [
  ["achievements", "Trophy Shelf"],
  ["links", "Social Links"],
];

type ProfileLayoutSource = {
  vertical: string;
  sections: Array<Record<string, unknown>>;
  layoutBlocks: Array<Record<string, unknown>>;
};

/** The profile's effective layout: the saved block list when one exists
    (re-validated on the way out — a stored row that fails validation
    falls back to the default rather than breaking the read), otherwise
    the derived default. `isDefault` tells the caller which one it got. */
export function effectiveLayout(profile: ProfileLayoutSource): { blocks: ProfileBlockDto[]; isDefault: boolean } {
  if (Array.isArray(profile.layoutBlocks) && profile.layoutBlocks.length > 0) {
    const v = validateLayout(profile.layoutBlocks);
    if (v.ok) return { blocks: v.blocks, isDefault: false };
    logger.warn({ vertical: profile.vertical }, "profile-website: stored layout failed validation — serving default");
  }
  const seen = new Set<string>();
  const blocks: ProfileBlockDto[] = [];
  const push = (type: string, title: string, visible: boolean) => {
    if (!PROFILE_BLOCK_TYPE_SET.has(type) || seen.has(type)) return;
    seen.add(type);
    const def = PROFILE_BLOCK_TYPES.find((b) => b.type === type)!;
    blocks.push({ type, title: title || def.label, visible, config: {} });
  };
  /* The section source: the profile's stored sections when it has any,
   * else the vertical's starter order. Titles + visibility come from
   * the source; the Grand Stage slots pull from it first. */
  const stored = Array.isArray(profile.sections) ? profile.sections : [];
  const source: Array<{ type: string; title: string; visible: boolean }> = [];
  if (stored.length > 0) {
    for (const s of stored) {
      if (!s || typeof s !== "object") continue;
      const type = typeof s["type"] === "string" ? s["type"] : "";
      const title = typeof s["title"] === "string" ? s["title"] : "";
      source.push({ type, title, visible: s["visible"] !== false });
    }
  } else {
    for (const [type, title] of STARTER_LAYOUTS[profile.vertical] ?? STARTER_LAYOUTS["other"]!) {
      source.push({ type, title, visible: true });
    }
  }
  const fromSource = (type: string) => source.find((s) => s.type === type);
  /* 1 — the masthead leads (its own stored title when the profile has
   * one, else the starter's, else the registry label). */
  const hero = fromSource("hero");
  push("hero", hero?.title ?? "", hero?.visible ?? true);
  /* 2 — the Grand Stage sequence, in the owner's picked order. */
  for (const [type, pickedTitle] of GRAND_STAGE_SEQUENCE) {
    const s = fromSource(type);
    push(type, s?.title || pickedTitle, s?.visible ?? true);
  }
  /* 3 — everything else the profile has, in its existing order. */
  for (const s of source) push(s.type, s.title, s.visible);
  /* 4 — the closing page blocks. */
  for (const [type, title] of PAGE_BLOCK_TAIL) push(type, title, true);
  return { blocks, isDefault: true };
}

/* ── Profile templates + bounded AI designer (Stack-200, owner-approved
   Oct 25) ────────────────────────────────────────────────────────────────
   LEVEL 1, THE SHELF: six designed templates. Every template is a
   composition over the SAME block registry — an ordered block list, a
   registry colorway KEY, and registry font KEYS. No template carries
   markup, CSS, or a block type outside the registry, so a template can
   never invent page structure.
   LEVEL 2, AI CATEGORY-ARRANGEMENT: the designer below may ONLY
   rearrange, add, or subtract CATEGORIES (blocks) — the three bounded
   ops. It is deterministic and signal-driven (the smart law: defaults
   use what the system already knows — the creator's vertical, the
   sections they actually keep, the content arrays on their profile) —
   never random, never an interruption.
   LEVEL 3, RESTYLE: colorway + fonts flex INSIDE the template's design
   language (registry keys only, resolved server-side like theme
   settings).
   APPROVAL GATE: choosing a template or running the designer writes a
   DRAFT (theme_config.profileTemplateDraft). Nothing goes live until
   the creator approves the draft — approve is the only door from draft
   to the live layout/theme. */

export interface ProfileTemplateDef {
  id: string;
  name: string;
  tagline: string;
  /** Creator lanes this template is designed for (smart defaulting). */
  bestFor: string[];
  colorway: string;
  headingFont: string;
  bodyFont: string;
  /** The composition, in order: registry block type + its picked title. */
  layout: Array<[string, string]>;
}

export const PROFILE_TEMPLATES: ProfileTemplateDef[] = [
  {
    id: "stage",
    name: "Stage",
    tagline: "The Grand Stage — the flagship. Your best work up front, the Front Row under it, then Music, Videos, Store and Memberships in the house order.",
    bestFor: ["music", "video", "gaming", "podcast", "film", "tv", "influencer", "education", "other"],
    colorway: "royal-gold",
    headingFont: "Cinzel",
    bodyFont: "Inter",
    layout: [
      ["hero", "Featured"], ["spotlight", "The Stage"], ["court", "The Front Row"],
      ["tracks", "Music"], ["videos", "Videos"], ["store", "Store"],
      ["memberships", "Memberships"], ["achievements", "Trophy Shelf"], ["links", "Social Links"],
    ],
  },
  {
    id: "booth",
    name: "Booth",
    tagline: "Built for voices and streams — your schedule and latest drops lead, the Front Row and your store ride underneath.",
    bestFor: ["podcast", "gaming", "music"],
    colorway: "stage-lights",
    headingFont: "Bebas Neue",
    bodyFont: "Inter",
    layout: [
      ["hero", "Featured"], ["spotlight", "The Stage"], ["schedule", "Stream Schedule"],
      ["tracks", "Latest Drops"], ["videos", "Clips & Highlights"], ["court", "The Front Row"],
      ["store", "Store"], ["memberships", "Memberships"], ["links", "Social Links"],
    ],
  },
  {
    id: "gallery",
    name: "Gallery",
    tagline: "A visual wall first — films, series and the merch shelf in a clean, quiet frame that lets the work talk.",
    bestFor: ["film", "tv", "video"],
    colorway: "gilded-minimal",
    headingFont: "Playfair Display",
    bodyFont: "Inter",
    layout: [
      ["hero", "Featured"], ["videos", "Films & Videos"], ["series", "Series & Seasons"],
      ["spotlight", "The Stage"], ["merch", "Merch Shelf"], ["store", "Store"],
      ["memberships", "Memberships"], ["achievements", "Trophy Shelf"], ["links", "Social Links"],
    ],
  },
  {
    id: "broadcast",
    name: "Broadcast",
    tagline: "A channel page — live first, episodes and series in order, the Front Row holding the chat's favorite seats.",
    bestFor: ["gaming", "video", "tv"],
    colorway: "chrome-empire",
    headingFont: "Space Grotesk",
    bodyFont: "Inter",
    layout: [
      ["hero", "Featured"], ["spotlight", "The Stage"], ["schedule", "Stream Schedule"],
      ["videos", "Videos"], ["series", "Series & Seasons"], ["court", "The Front Row"],
      ["tracks", "Music"], ["store", "Store"], ["memberships", "Memberships"], ["links", "Social Links"],
    ],
  },
  {
    id: "press-kit",
    name: "Press Kit",
    tagline: "The brand-deal one-pager — media kit and proof up top, booking links one tap away, store and memberships kept on the page.",
    bestFor: ["influencer", "music", "education"],
    colorway: "midnight-gold",
    headingFont: "DM Serif Display",
    bodyFont: "Inter",
    layout: [
      ["hero", "Featured"], ["mediakit", "Media Kit"], ["bio", "About"],
      ["achievements", "Trophy Shelf"], ["topcreators", "Top Creators"], ["spotlight", "The Stage"],
      ["store", "Store"], ["memberships", "Memberships"], ["links", "Social Links"],
    ],
  },
  {
    id: "after-dark",
    name: "After Dark",
    tagline: "The late-night lounge cut — music and events up front under a noir-gold look, for the after-hours crowd.",
    bestFor: ["music", "influencer", "other"],
    colorway: "royal-noir",
    headingFont: "Cinzel",
    bodyFont: "Space Grotesk",
    layout: [
      ["hero", "Featured"], ["spotlight", "The Stage"], ["tracks", "Music"],
      ["events", "Events / Tour"], ["videos", "Videos"], ["court", "The Front Row"],
      ["store", "Store"], ["memberships", "Memberships"], ["shoutwall", "Shout Wall"], ["links", "Social Links"],
    ],
  },
];

export function templateById(id: string | null | undefined): ProfileTemplateDef | null {
  return PROFILE_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** The template the smart default would pick for a creator lane — used
    only to ORDER the shelf (their lane's fit first), never to apply
    anything unasked. */
export function recommendedTemplateId(vertical: string): string {
  for (const t of PROFILE_TEMPLATES) {
    if (t.id !== "stage" && t.bestFor.includes(vertical)) return t.id;
  }
  return "stage";
}

/** A template instantiated as a layout: registry types only, the
    profile's own stored section titles/visibility win for section
    blocks it already has (content carries across a switch untouched). */
export function templateLayout(
  template: ProfileTemplateDef,
  sections: Array<Record<string, unknown>> = [],
): ProfileBlockDto[] {
  const fromSections = new Map<string, { title: string; visible: boolean }>();
  for (const s of sections) {
    if (!s || typeof s !== "object") continue;
    const type = typeof s["type"] === "string" ? s["type"] : "";
    if (!type || fromSections.has(type)) continue;
    fromSections.set(type, {
      title: typeof s["title"] === "string" ? s["title"] : "",
      visible: s["visible"] !== false,
    });
  }
  const blocks: ProfileBlockDto[] = [];
  for (const [type, pickedTitle] of template.layout) {
    const def = PROFILE_BLOCK_TYPES.find((b) => b.type === type);
    if (!def) continue;
    const stored = fromSections.get(type);
    blocks.push({
      type,
      title: stored?.title || pickedTitle,
      visible: stored?.visible ?? true,
      config: {},
    });
  }
  return blocks;
}

/* ── The draft (approval gate) ────────────────────────────────────────────
   Stored in theme_config (an existing jsonb the profile already owns) —
   no new table, no migration. The live page NEVER reads the draft. */

export interface ProfileTemplateDraft {
  templateId: string;
  layout: ProfileBlockDto[];
  colorway: string;
  headingFont: string;
  bodyFont: string;
  /** How this draft came to be: a shelf pick, the AI designer, or the
      creator's own hand on the draft. */
  source: "template" | "ai" | "manual";
  /** Human-readable bounded ops the designer applied (empty otherwise). */
  ops: string[];
  updatedAt: string;
}

const DRAFT_KEY = "profileTemplateDraft";
export const LIVE_TEMPLATE_KEY = "profileTemplateId";

export function readDraft(themeConfig: Record<string, unknown> | null | undefined): ProfileTemplateDraft | null {
  const raw = (themeConfig ?? {})[DRAFT_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const template = templateById(typeof rec["templateId"] === "string" ? rec["templateId"] : null);
  if (!template) return null;
  const v = validateLayout(rec["layout"]);
  if (!v.ok) return null;
  const colorway = typeof rec["colorway"] === "string" && colorwayById(rec["colorway"]) ? rec["colorway"] : template.colorway;
  const headingFont = typeof rec["headingFont"] === "string" && (PROFILE_FONT_IDS as readonly string[]).includes(rec["headingFont"]) ? rec["headingFont"] : template.headingFont;
  const bodyFont = typeof rec["bodyFont"] === "string" && (PROFILE_FONT_IDS as readonly string[]).includes(rec["bodyFont"]) ? rec["bodyFont"] : template.bodyFont;
  return {
    templateId: template.id,
    layout: v.blocks,
    colorway,
    headingFont,
    bodyFont,
    source: rec["source"] === "ai" || rec["source"] === "manual" ? rec["source"] : "template",
    ops: Array.isArray(rec["ops"]) ? rec["ops"].filter((o): o is string => typeof o === "string").slice(0, 20) : [],
    updatedAt: typeof rec["updatedAt"] === "string" ? rec["updatedAt"] : "",
  };
}

export function draftFromTemplate(
  template: ProfileTemplateDef,
  sections: Array<Record<string, unknown>>,
  now: Date = new Date(),
): ProfileTemplateDraft {
  return {
    templateId: template.id,
    layout: templateLayout(template, sections),
    colorway: template.colorway,
    headingFont: template.headingFont,
    bodyFont: template.bodyFont,
    source: "template",
    ops: [],
    updatedAt: now.toISOString(),
  };
}

/* ── The bounded AI designer ──────────────────────────────────────────────
   Signals = ONLY what the system already knows about this creator from
   their own profile row. Ops = rearrange / add / subtract categories,
   each recorded in plain words for the creator to read before they
   approve. The designer's output is a DRAFT — it can never publish. */

export interface DesignerSignals {
  vertical: string;
  sectionTypes: string[];
  hasPin: boolean;
  hasMediaKit: boolean;
  streamScheduleCount: number;
  merchCount: number;
  eventsCount: number;
  seriesCount: number;
  postsCount: number;
  topCreatorsCount: number;
}

export function designerSignalsOf(profile: {
  vertical: string;
  sections: Array<Record<string, unknown>>;
  pinnedKind: string | null;
  mediaKit: Record<string, unknown> | null;
  streamSchedule: unknown[];
  merchItems: unknown[];
  profileEvents: unknown[];
  series: unknown[];
  socialPosts: unknown[];
  topCreators: unknown[];
}): DesignerSignals {
  const sectionTypes: string[] = [];
  for (const s of profile.sections ?? []) {
    if (s && typeof s === "object" && typeof (s as Record<string, unknown>)["type"] === "string") {
      sectionTypes.push((s as Record<string, unknown>)["type"] as string);
    }
  }
  return {
    vertical: profile.vertical,
    sectionTypes,
    hasPin: !!profile.pinnedKind,
    hasMediaKit: !!profile.mediaKit && Object.keys(profile.mediaKit).length > 0,
    streamScheduleCount: Array.isArray(profile.streamSchedule) ? profile.streamSchedule.length : 0,
    merchCount: Array.isArray(profile.merchItems) ? profile.merchItems.length : 0,
    eventsCount: Array.isArray(profile.profileEvents) ? profile.profileEvents.length : 0,
    seriesCount: Array.isArray(profile.series) ? profile.series.length : 0,
    postsCount: Array.isArray(profile.socialPosts) ? profile.socialPosts.length : 0,
    topCreatorsCount: Array.isArray(profile.topCreators) ? profile.topCreators.length : 0,
  };
}

/** Section-sourced blocks whose backing content the signals can PROVE
    empty — the only blocks the designer may subtract, and only when the
    creator never placed the section themselves. Page blocks (spotlight,
    court, store, memberships, achievements, links) resolve their own
    content at render and are never subtracted. */
const EMPTY_PROOF: Array<{ type: string; empty: (s: DesignerSignals) => boolean; why: string }> = [
  { type: "schedule", empty: (s) => s.streamScheduleCount === 0, why: "no stream schedule set" },
  { type: "mediakit", empty: (s) => !s.hasMediaKit, why: "no media kit filled in" },
  { type: "merch", empty: (s) => s.merchCount === 0, why: "no merch on the shelf" },
  { type: "events", empty: (s) => s.eventsCount === 0, why: "no events listed" },
  { type: "series", empty: (s) => s.seriesCount === 0, why: "no series yet" },
  { type: "posts", empty: (s) => s.postsCount === 0, why: "no social posts yet" },
  { type: "topcreators", empty: (s) => s.topCreatorsCount === 0, why: "no top creators picked" },
];

export function designLayout(
  base: ProfileBlockDto[],
  signals: DesignerSignals,
): { layout: ProfileBlockDto[]; ops: string[] } {
  const ops: string[] = [];
  let blocks = base.map((b) => ({ ...b, config: { ...b.config } }));
  const has = (type: string) => blocks.some((b) => b.type === type);
  const label = (type: string) => PROFILE_BLOCK_TYPES.find((d) => d.type === type)?.label ?? type;
  const titleOf = (type: string) => blocks.find((b) => b.type === type)?.title ?? label(type);

  const add = (type: string, title: string, afterType: string | null, why: string) => {
    if (has(type) || blocks.length >= MAX_PROFILE_BLOCKS) return;
    const block: ProfileBlockDto = { type, title, visible: true, config: {} };
    const at = afterType ? blocks.findIndex((b) => b.type === afterType) : -1;
    if (at >= 0) blocks.splice(at + 1, 0, block);
    else blocks.push(block);
    ops.push(`Added ${title} — ${why}.`);
  };
  const moveBefore = (type: string, beforeType: string, why: string) => {
    const i = blocks.findIndex((b) => b.type === type);
    const j = blocks.findIndex((b) => b.type === beforeType);
    if (i < 0 || j < 0 || i === j || i === j - 1) return;
    const [moved] = blocks.splice(i, 1);
    blocks.splice(blocks.findIndex((b) => b.type === beforeType), 0, moved!);
    ops.push(`Moved ${titleOf(type)} above ${titleOf(beforeType)} — ${why}.`);
  };
  const moveAfter = (type: string, afterType: string, why: string) => {
    const i = blocks.findIndex((b) => b.type === type);
    const j = blocks.findIndex((b) => b.type === afterType);
    if (i < 0 || j < 0 || i === j || i === j + 1) return;
    const [moved] = blocks.splice(i, 1);
    blocks.splice(blocks.findIndex((b) => b.type === afterType) + 1, 0, moved!);
    ops.push(`Moved ${titleOf(type)} under ${titleOf(afterType)} — ${why}.`);
  };

  /* 1 — the Grand Stage core is always on the page (add what's missing). */
  add("spotlight", "The Stage", "hero", "every page opens on The Stage");
  add("court", "The Front Row", "spotlight", "your Front Row belongs under The Stage");
  add("store", "Store", null, "your work should be buyable from your page");
  add("memberships", "Memberships", "store", "memberships close the page's money story");
  add("links", "Social Links", null, "your other homes stay one tap away");

  /* 2 — a pinned spotlight leads: The Stage sits right under the masthead. */
  if (signals.hasPin) moveAfter("spotlight", "hero", "you have a spotlight pin — it leads the page");

  /* 3 — lane emphasis (rearrange only). */
  if (signals.vertical === "gaming") {
    if (signals.streamScheduleCount > 0) {
      add("schedule", "Stream Schedule", "spotlight", "you stream on a schedule — it belongs under The Stage");
      moveAfter("schedule", "spotlight", "streamers lead with the schedule");
    }
    moveBefore("videos", "tracks", "your clips carry the page");
  } else if (signals.vertical === "podcast") {
    moveBefore("tracks", "videos", "episodes are the show");
    if (signals.seriesCount > 0) {
      add("series", "Series & Seasons", "tracks", "your series follows the episodes");
      moveAfter("series", "tracks", "your series follows the episodes");
    }
  } else if (signals.vertical === "film" || signals.vertical === "tv") {
    moveBefore("series", "tracks", "films and seasons lead");
  } else if (signals.vertical === "influencer") {
    if (signals.hasMediaKit) {
      add("mediakit", "Media Kit", "hero", "brands read the media kit first");
      moveAfter("mediakit", "hero", "brands read the media kit first");
    }
  } else if (signals.vertical === "education") {
    if (signals.seriesCount > 0) {
      add("series", "Courses", "hero", "courses lead a teaching page");
      moveAfter("series", "hero", "courses lead a teaching page");
    }
  }

  /* 4 — subtract provably-empty section blocks the creator never placed. */
  for (const rule of EMPTY_PROOF) {
    if (!has(rule.type)) continue;
    if (signals.sectionTypes.includes(rule.type)) continue;
    if (!rule.empty(signals)) continue;
    ops.push(`Removed ${titleOf(rule.type)} — ${rule.why}; add it back any time.`);
    blocks = blocks.filter((b) => b.type !== rule.type);
  }

  return { layout: blocks, ops };
}

/* ── Theme settings registry (item 3 plumbing) ────────────────────────────
   Colorways mirror the frontend THEME_PRESETS (lib/artist-profiles.ts),
   resolved server-side from the chosen KEY. Royal Gold leads the list —
   it is the house theme (the owner's pick, Oct 16): golden black marble
   with bronze-gold light. Fonts mirror SAFE_FONTS. A creator picks keys;
   the server writes the resolved values into theme_config. Never raw
   CSS. */

export interface ProfileColorway {
  id: string;
  name: string;
  colors: {
    background: string; surface: string; primary: string; accent: string;
    text: string; mutedText: string; cardBg: string; border: string;
  };
}

export const PROFILE_COLORWAYS: ProfileColorway[] = [
  { id: "royal-gold", name: "Royal Gold", colors: { background: "#0d0a04", surface: "#14100a", primary: "#c9a84c", accent: "#f0d488", text: "#f7ecd2", mutedText: "#a08c5f", cardBg: "#171208", border: "#3d2e12" } },
  { id: "midnight-gold", name: "Midnight Gold", colors: { background: "#0a0a0b", surface: "#121214", primary: "#d4af37", accent: "#f5d67b", text: "#f5f1e6", mutedText: "#a8a29e", cardBg: "#161618", border: "#2a2416" } },
  { id: "royal-noir", name: "Royal Noir", colors: { background: "#0d0c10", surface: "#141218", primary: "#c9a227", accent: "#e8c874", text: "#f2ede3", mutedText: "#9c948a", cardBg: "#17141c", border: "#2e2718" } },
  { id: "stage-lights", name: "Stage Lights", colors: { background: "#08080a", surface: "#101012", primary: "#eab308", accent: "#fde047", text: "#ffffff", mutedText: "#b8b4ad", cardBg: "#121215", border: "#332f1a" } },
  { id: "velvet-lounge", name: "Velvet Lounge", colors: { background: "#100c08", surface: "#171009", primary: "#d4a24e", accent: "#f0c987", text: "#f7efe2", mutedText: "#a89a86", cardBg: "#1a130c", border: "#33261a" } },
  { id: "chrome-empire", name: "Chrome Empire", colors: { background: "#0b0d10", surface: "#111419", primary: "#c8b06a", accent: "#e9d9a6", text: "#eef0f2", mutedText: "#9aa3ad", cardBg: "#141821", border: "#2b2f1e" } },
  { id: "gilded-minimal", name: "Gilded Minimal", colors: { background: "#111110", surface: "#161614", primary: "#bfa14f", accent: "#d9c27a", text: "#f4f2ec", mutedText: "#a3a099", cardBg: "#191917", border: "#26251d" } },
];

export const PROFILE_FONT_IDS = [
  "Cinzel",
  "Playfair Display",
  "Bebas Neue",
  "DM Serif Display",
  "Space Grotesk",
  "Inter",
] as const;

export type ProfileFontId = (typeof PROFILE_FONT_IDS)[number];

export function colorwayById(id: string | null | undefined): ProfileColorway | null {
  return PROFILE_COLORWAYS.find((c) => c.id === id) ?? null;
}

/* ── Paid — the ONE definition (items 7 + 8) ──────────────────────────────
   A profile is PAID when ANY of these hold:
     1. creator_subscriptions: status active|trialing AND tier pro|elite
        (the creator-tier subscription, Stripe-synced).
     2. creator_hosting: status active|trialing (the Hosting plan).
     3. The account's Supabase profiles row carries a paid plan:
        plan_tier >= 4 on the 1–6 ladder (tierFromPlanTier → pro+), or a
        legacy plan name that maps to pro/elite (tierFromLegacyPlan) —
        the same sources require-auth folds into req.userPlan, so nobody
        who already pays reads as free.
   Never throws: any lookup failure reads as NOT paid (the branding mark
   is the safe failure mode — it never hides a mark it shouldn't). */

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export async function resolvePaidPlan(profileId: string, userId: string): Promise<boolean> {
  try {
    const [sub] = await db
      .select({ tier: creatorSubscriptionsTable.tier, status: creatorSubscriptionsTable.status })
      .from(creatorSubscriptionsTable)
      .where(eq(creatorSubscriptionsTable.profileId, profileId))
      .limit(1);
    if (sub && ACTIVE_STATUSES.has(sub.status) && (sub.tier === "pro" || sub.tier === "elite")) {
      return true;
    }
    const [hosting] = await db
      .select({ status: creatorHostingTable.status })
      .from(creatorHostingTable)
      .where(eq(creatorHostingTable.profileId, profileId))
      .limit(1);
    if (hosting && ACTIVE_STATUSES.has(hosting.status)) {
      return true;
    }
    const rows = await db.execute(sql`SELECT plan, plan_tier FROM profiles WHERE id = ${userId} LIMIT 1`);
    const row = (rows.rows[0] ?? null) as { plan?: unknown; plan_tier?: unknown } | null;
    if (row) {
      const byTier = tierFromPlanTier(typeof row.plan_tier === "number" ? row.plan_tier : null);
      const byName = tierFromLegacyPlan(typeof row.plan === "string" ? row.plan : null);
      if (byTier !== "free" || byName !== "free") return true;
    }
    return false;
  } catch (err) {
    logger.warn({ err, profileId }, "resolvePaidPlan: lookup failed — reading as not paid");
    return false;
  }
}

/** Hosting entitlement alone (item 8's own state, for its endpoints). */
export async function resolveHostingEntitlement(
  profileId: string,
): Promise<{ entitled: boolean; status: string | null; currentPeriodEnd: Date | null }> {
  try {
    const [row] = await db
      .select({ status: creatorHostingTable.status, currentPeriodEnd: creatorHostingTable.currentPeriodEnd })
      .from(creatorHostingTable)
      .where(eq(creatorHostingTable.profileId, profileId))
      .limit(1);
    if (!row) return { entitled: false, status: null, currentPeriodEnd: null };
    return {
      entitled: ACTIVE_STATUSES.has(row.status),
      status: row.status,
      currentPeriodEnd: row.currentPeriodEnd ?? null,
    };
  } catch (err) {
    logger.warn({ err, profileId }, "resolveHostingEntitlement: lookup failed");
    return { entitled: false, status: null, currentPeriodEnd: null };
  }
}
