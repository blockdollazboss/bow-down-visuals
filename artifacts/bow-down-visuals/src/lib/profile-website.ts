/* ─── "The profile IS the website" — client (Stack 3) ────────────────────
   Mirrors the API DTOs from routes/profile-website.ts exactly:
   - Spotlight pin (item 5): GET /creator-profiles/:slug/spotlight,
     PUT /creator-profiles/me/spotlight.
   - Fan collections (item 6): GET /collections/:slug, GET /collections/me,
     PUT /collections/me/visibility.
   The pure view-state helpers are unit-tested in profile-website.test.ts;
   the components stay thin shells (the Front Row pattern). */

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(
      (body as { message?: string; error?: string }).message ||
        (body as { error?: string }).error ||
        `Request failed (${res.status})`,
    ) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = (body as { error?: string }).error;
    throw err;
  }
  return res.json() as Promise<T>;
}

/* ── Spotlight pin ─────────────────────────────────────────────────────── */

export interface SpotlightPin {
  kind: "track" | "video";
  itemId: string;
  title: string;
  mediaUrl: string;
  artworkUrl: string | null;
  durationSec: number;
  creatorSlug: string;
  creatorName: string;
  pageUrl: string;
}

export type SpotlightLoadStatus = "loading" | "ready" | "error";
export type SpotlightView = "loading" | "hidden" | "error" | "owner-empty" | "pin";

/** Section render decision: a pin shows for everyone; no pin hides the
    section for visitors but invites the OWNER to pin ("Pin a track or
    video"); a failed load is its own honest error state, never a
    fake-empty. */
export function spotlightViewState(args: {
  status: SpotlightLoadStatus;
  pin: SpotlightPin | null;
  isOwner: boolean;
}): SpotlightView {
  if (args.status === "loading") return "loading";
  if (args.status === "error") return "error";
  if (args.pin) return "pin";
  return args.isOwner ? "owner-empty" : "hidden";
}

export async function fetchPublicSpotlight(slug: string): Promise<SpotlightPin | null> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/spotlight`);
  const data = await json<{ pin: SpotlightPin | null }>(res);
  return data.pin ?? null;
}

export async function saveMySpotlight(
  pin: { kind: "track" | "video"; itemId: string } | { kind: null },
): Promise<SpotlightPin | null> {
  const res = await fetch("/api/creator-profiles/me/spotlight", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pin.kind === null ? { kind: null } : { kind: pin.kind, itemId: pin.itemId }),
  });
  const data = await json<{ pin: SpotlightPin | null }>(res);
  return data.pin ?? null;
}

/** One pinnable item from the owner's own catalog (the profile media
    endpoint's snake_case rows, narrowed to what the picker needs). */
export interface PinnableItem {
  kind: "track" | "video";
  id: string;
  title: string;
  artworkUrl: string | null;
}

export async function fetchMyPinnableItems(slug: string): Promise<PinnableItem[]> {
  /* Per-kind settle (S27-46): tracks and videos are independent
     sources — one kind failing (HTTP error OR a rejected fetch) must
     not empty the other kind's items. Only when BOTH kinds fail does
     this throw, so the picker's own error state still shows. */
  const loadKind = async (kind: "track" | "video"): Promise<PinnableItem[]> => {
    const res = await fetch(
      `/api/creator-profiles/${encodeURIComponent(slug)}/media?kind=${kind}&limit=50`,
    );
    const data = await json<{ items: Array<Record<string, unknown>> }>(res);
    const out: PinnableItem[] = [];
    for (const row of data.items ?? []) {
      out.push({
        kind,
        id: String(row["id"] ?? ""),
        title: String(row["title"] ?? "Untitled"),
        artworkUrl: ((kind === "track" ? row["artwork_url"] : row["thumbnail_url"]) as string | null) ?? null,
      });
    }
    return out.filter((i) => i.id);
  };
  const [tracks, videos] = await Promise.allSettled([loadKind("track"), loadKind("video")]);
  if (tracks.status === "rejected" && videos.status === "rejected") {
    throw tracks.reason instanceof Error ? tracks.reason : new Error("Couldn't load your media.");
  }
  return [
    ...(tracks.status === "fulfilled" ? tracks.value : []),
    ...(videos.status === "fulfilled" ? videos.value : []),
  ];
}

/* ── Fan collections ───────────────────────────────────────────────────── */

export interface CollectionItem {
  kind: "track" | "video" | "product";
  itemId: string;
  title: string;
  artworkUrl: string | null;
  creatorName: string;
  creatorSlug: string;
  creatorUrl: string;
  amountCents: number;
  purchasedAt: string;
}

export interface FanCollection {
  fan: { slug: string; displayName: string; avatarUrl: string | null; profileUrl: string };
  visibility: "public" | "private";
  isPrivate?: boolean;
  items: CollectionItem[];
}

/* ── DTO guard batch #2 (same pattern as lib/destination-keys.ts) ──────
 * The collection fetchers used to return raw casts: a 200 payload
 * missing `items` or `fan` crashed the collection page (items.length,
 * fan.displayName) instead of reaching its designed error state.
 * A malformed payload normalizes to null → the fetcher throws → the
 * page's honest error state. Missing `items` alone is the designed
 * EMPTY collection, not an error. */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const finiteNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function normalizeFanCollection(payload: unknown): FanCollection | null {
  if (!isRecord(payload) || !isRecord(payload.fan)) return null;
  const fan = payload.fan;
  if (typeof fan.slug !== "string" || !fan.slug) return null;
  if (typeof fan.displayName !== "string" || !fan.displayName) return null;
  const items: CollectionItem[] = [];
  if (Array.isArray(payload.items)) {
    for (const raw of payload.items) {
      if (!isRecord(raw)) continue;
      const amountCents = finiteNum(raw.amountCents);
      if (amountCents === null) continue; // a purchase row without its real price doesn't render
      const kind = raw.kind === "track" || raw.kind === "video" || raw.kind === "product" ? raw.kind : null;
      if (!kind) continue; // the page has no icon/render for an unknown kind
      items.push({
        kind,
        itemId: typeof raw.itemId === "string" ? raw.itemId : "",
        title: typeof raw.title === "string" ? raw.title : "",
        artworkUrl: typeof raw.artworkUrl === "string" ? raw.artworkUrl : null,
        creatorName: typeof raw.creatorName === "string" ? raw.creatorName : "",
        creatorSlug: typeof raw.creatorSlug === "string" ? raw.creatorSlug : "",
        creatorUrl: typeof raw.creatorUrl === "string" ? raw.creatorUrl : "",
        amountCents,
        purchasedAt: typeof raw.purchasedAt === "string" ? raw.purchasedAt : "",
      });
    }
  }
  return {
    fan: {
      slug: fan.slug,
      displayName: fan.displayName,
      avatarUrl: typeof fan.avatarUrl === "string" ? fan.avatarUrl : null,
      profileUrl: typeof fan.profileUrl === "string" ? fan.profileUrl : "",
    },
    visibility: payload.visibility === "private" ? "private" : "public",
    isPrivate: payload.isPrivate === true,
    items,
  };
}

export type CollectionLoadStatus = "loading" | "ready" | "error" | "not-found";
export type CollectionView = "loading" | "error" | "not-found" | "private" | "empty" | "items";

/** Page render decision: private is an honest state of its own — never
    confused with empty (nothing bought) or missing (no such fan). */
export function collectionViewState(args: {
  status: CollectionLoadStatus;
  collection: FanCollection | null;
}): CollectionView {
  if (args.status === "loading") return "loading";
  if (args.status === "error") return "error";
  if (args.status === "not-found" || !args.collection) return "not-found";
  if (args.collection.isPrivate || args.collection.visibility === "private") return "private";
  return args.collection.items.length > 0 ? "items" : "empty";
}

export async function fetchPublicCollection(slug: string): Promise<FanCollection> {
  const res = await fetch(`/api/collections/${encodeURIComponent(slug)}`);
  const collection = normalizeFanCollection(await json<unknown>(res));
  if (!collection) throw new Error("That collection came back incomplete — try again.");
  return collection;
}

export async function fetchMyCollection(): Promise<FanCollection> {
  const res = await fetch("/api/collections/me");
  const collection = normalizeFanCollection(await json<unknown>(res));
  if (!collection) throw new Error("Your collection came back incomplete — try again.");
  return collection;
}

export async function saveMyCollectionVisibility(
  visibility: "public" | "private",
): Promise<"public" | "private"> {
  const res = await fetch("/api/collections/me/visibility", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility }),
  });
  const data = await json<{ visibility: "public" | "private" }>(res);
  return data.visibility;
}

/** USD display for a collection item's price paid — real money (these
    are store purchases), never Visual Bucs. */
export function collectionMoney(cents: number): string {
  return `$${(Math.max(0, Math.round(cents)) / 100).toFixed(2)}`;
}

/* ── Block layout (the Grand Stage composition) ──────────────────────────
   Mirrors the API DTOs from lib/profile-website.ts (server):
   GET /creator-profiles/:slug/layout (public, visible blocks only),
   GET|PUT /creator-profiles/me/layout (owner). A block is one of the
   registry types, a plain-text title (80 max), a visibility flag and a
   scalar-only config. The DEFAULT for an untouched profile is the
   owner's picked Grand Stage order; a saved layout always wins. */

export interface ProfileBlockDto {
  type: string;
  title: string;
  visible: boolean;
  config: Record<string, string | number | boolean>;
}

export interface ProfileBlockTypeDef {
  type: string;
  label: string;
  source: "section" | "page";
}

export interface ProfileLayoutDto {
  layout: ProfileBlockDto[];
  isDefault: boolean;
  blockTypes: ProfileBlockTypeDef[];
  maxBlocks: number;
  /** The template last approved onto the live page, when the server
      sends it (older builds omit it). */
  templateId?: string | null;
}

/** The owner's picked block order (Oct 16) — The Stage → The Front Row →
    Music → Videos → Store → Memberships, under the masthead. */
export const GRAND_STAGE_SEQUENCE: Array<{ type: string; title: string }> = [
  { type: "spotlight", title: "The Stage" },
  { type: "court", title: "The Front Row" },
  { type: "tracks", title: "Music" },
  { type: "videos", title: "Videos" },
  { type: "store", title: "Store" },
  { type: "memberships", title: "Memberships" },
];

export async function fetchPublicLayout(slug: string): Promise<ProfileLayoutDto> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/layout`);
  return json<ProfileLayoutDto>(res);
}

export async function fetchMyLayout(): Promise<ProfileLayoutDto> {
  const res = await fetch("/api/creator-profiles/me/layout");
  return json<ProfileLayoutDto>(res);
}

export async function saveMyLayout(blocks: ProfileBlockDto[]): Promise<ProfileLayoutDto> {
  const res = await fetch("/api/creator-profiles/me/layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout: blocks }),
  });
  return json<ProfileLayoutDto>(res);
}

/** The blocks a visitor sees, in order. The public endpoint already
    filters hidden blocks; this keeps the rule if a full layout (the
    owner's own) is ever rendered through the same path. */
export function visibleBlocks(blocks: ProfileBlockDto[]): ProfileBlockDto[] {
  return blocks.filter((b) => b.visible);
}

/** The client-side Grand Stage fallback: when the layout read fails,
    the public page still renders the picked composition from the
    profile's own sections instead of breaking — masthead first, the
    six picked blocks in order (a section's own title/visibility when
    the profile has one), the rest in their stored order, then the
    Trophy Shelf and Social Links. Mirrors the server default. */
export function grandStageFallbackBlocks(
  sections: Array<{ type: string; title: string; visible?: boolean }>,
): ProfileBlockDto[] {
  const out: ProfileBlockDto[] = [];
  const seen = new Set<string>();
  const push = (type: string, title: string, visible: boolean) => {
    if (seen.has(type)) return;
    seen.add(type);
    out.push({ type, title, visible, config: {} });
  };
  const fromSource = (type: string) => sections.find((s) => s.type === type);
  const hero = fromSource("hero");
  push("hero", hero?.title || "Featured", hero?.visible !== false);
  for (const { type, title } of GRAND_STAGE_SEQUENCE) {
    const s = fromSource(type);
    push(type, s?.title || title, s ? s.visible !== false : true);
  }
  for (const s of sections) push(s.type, s.title, s.visible !== false);
  push("achievements", "Trophy Shelf", true);
  push("links", "Social Links", true);
  return out.filter((b) => b.visible);
}

/* ── Layout editor ops (pure — the editor component is a thin shell) ── */

export function moveBlock(blocks: ProfileBlockDto[], type: string, dir: -1 | 1): ProfileBlockDto[] {
  const i = blocks.findIndex((b) => b.type === type);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= blocks.length) return blocks;
  const next = [...blocks];
  const [moved] = next.splice(i, 1);
  next.splice(j, 0, moved!);
  return next;
}

export function toggleBlockVisibility(blocks: ProfileBlockDto[], type: string): ProfileBlockDto[] {
  return blocks.map((b) => (b.type === type ? { ...b, visible: !b.visible } : b));
}

export function retitleBlock(blocks: ProfileBlockDto[], type: string, title: string): ProfileBlockDto[] {
  const clean = title.slice(0, 80);
  return blocks.map((b) => (b.type === type ? { ...b, title: clean } : b));
}

export function removeBlock(blocks: ProfileBlockDto[], type: string): ProfileBlockDto[] {
  return blocks.filter((b) => b.type !== type);
}

export function addBlock(blocks: ProfileBlockDto[], def: ProfileBlockTypeDef): ProfileBlockDto[] {
  if (blocks.some((b) => b.type === def.type)) return blocks;
  return [...blocks, { type: def.type, title: def.label, visible: true, config: {} }];
}

/** Registry types the layout doesn't carry yet — the editor's add menu. */
export function addableBlockTypes(
  blocks: ProfileBlockDto[],
  blockTypes: ProfileBlockTypeDef[],
): ProfileBlockTypeDef[] {
  const present = new Set(blocks.map((b) => b.type));
  return blockTypes.filter((d) => !present.has(d.type));
}

/** One-line read-back of a saved layout ("Layout saved: The Stage · The
    Front Row · …") — what the owner sees is what the page renders. */
export function layoutSummary(blocks: ProfileBlockDto[]): string {
  return blocks.filter((b) => b.visible).map((b) => b.title || b.type).join(" · ");
}

/* ── Profile templates + bounded AI designer (Stack-200) ──────────────────
   Mirrors routes/profile-website.ts #3b:
   GET    /creator-profiles/me/template            (shelf + live + draft)
   PUT    /creator-profiles/me/template/draft      (pick → draft only)
   PUT    /creator-profiles/me/template/draft/layout (edit the draft)
   POST   /creator-profiles/me/template/ai-design  (bounded ops → draft)
   POST   /creator-profiles/me/template/approve    (the ONLY door to live)
   DELETE /creator-profiles/me/template/draft      (discard)
   A template is a composition over the same block registry — never
   freeform code. The designer may only rearrange / add / subtract
   categories, and its work lands as a draft the creator approves. */

export interface ProfileTemplateDefDto {
  id: string;
  name: string;
  tagline: string;
  bestFor: string[];
  colorway: string;
  headingFont: string;
  bodyFont: string;
  /** The composition instantiated for THIS creator (their own section
      titles/visibility carried across the switch). */
  layout: ProfileBlockDto[];
}

export interface ProfileTemplateDraftDto {
  templateId: string;
  layout: ProfileBlockDto[];
  colorway: string;
  headingFont: string;
  bodyFont: string;
  source: "template" | "ai" | "manual";
  ops: string[];
  updatedAt: string;
}

export interface ProfileTemplateStateDto {
  liveTemplateId: string | null;
  layout: ProfileBlockDto[];
  isDefault: boolean;
  draft: ProfileTemplateDraftDto | null;
  recommendedTemplateId: string;
  templates: ProfileTemplateDefDto[];
}

/** Shelf order: the creator's recommended fit first, the flagship Stage
    right behind it, the rest in shelf order. Smart by default — the
    shelf reads what the system knows (their lane) without applying
    anything unasked. */
export function templateShelfOrder(
  templates: ProfileTemplateDefDto[],
  recommendedId: string,
): ProfileTemplateDefDto[] {
  const rank = (t: ProfileTemplateDefDto) =>
    t.id === recommendedId ? 0 : t.id === "stage" ? 1 : 2;
  return [...templates].sort((a, b) => rank(a) - rank(b));
}

/** What approving this draft would change on the live page, in plain
    words: categories added, categories removed, and whether the order
    moves. The approval read-back — the creator sees exactly what
    "Approve" does before it does it. */
export function draftChanges(
  live: ProfileBlockDto[],
  draft: ProfileBlockDto[],
): { added: string[]; removed: string[]; reordered: boolean } {
  const liveTypes = live.map((b) => b.type);
  const draftTypes = draft.map((b) => b.type);
  const added = draft.filter((b) => !liveTypes.includes(b.type)).map((b) => b.title || b.type);
  const removed = live.filter((b) => !draftTypes.includes(b.type)).map((b) => b.title || b.type);
  const sharedLive = liveTypes.filter((t) => draftTypes.includes(t));
  const sharedDraft = draftTypes.filter((t) => liveTypes.includes(t));
  const reordered = sharedLive.some((t, i) => sharedDraft[i] !== t);
  return { added, removed, reordered };
}

/** One-line draft summary for the studio header ("Draft: Booth — 9
    blocks · Royal Noir · Cinzel / Space Grotesk"). */
export function draftSummary(
  draft: ProfileTemplateDraftDto,
  templates: ProfileTemplateDefDto[],
  colorwayName: (id: string) => string | undefined,
): string {
  const name = templates.find((t) => t.id === draft.templateId)?.name ?? draft.templateId;
  const visible = draft.layout.filter((b) => b.visible).length;
  return `${name} — ${visible} blocks · ${colorwayName(draft.colorway) ?? draft.colorway} · ${draft.headingFont} / ${draft.bodyFont}`;
}

export async function fetchMyTemplateState(): Promise<ProfileTemplateStateDto> {
  const res = await fetch("/api/creator-profiles/me/template");
  return json<ProfileTemplateStateDto>(res);
}

export async function pickTemplateDraft(templateId: string): Promise<ProfileTemplateStateDto> {
  const res = await fetch("/api/creator-profiles/me/template/draft", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId }),
  });
  return json<ProfileTemplateStateDto>(res);
}

export async function saveDraftLayout(args: {
  layout: ProfileBlockDto[];
  colorway?: string;
  headingFont?: string;
  bodyFont?: string;
}): Promise<ProfileTemplateStateDto> {
  const res = await fetch("/api/creator-profiles/me/template/draft/layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return json<ProfileTemplateStateDto>(res);
}

export async function runAiDesigner(): Promise<ProfileTemplateStateDto> {
  const res = await fetch("/api/creator-profiles/me/template/ai-design", { method: "POST" });
  return json<ProfileTemplateStateDto>(res);
}

export async function approveTemplateDraft(): Promise<ProfileTemplateStateDto> {
  const res = await fetch("/api/creator-profiles/me/template/approve", { method: "POST" });
  return json<ProfileTemplateStateDto>(res);
}

export async function discardTemplateDraft(): Promise<ProfileTemplateStateDto> {
  const res = await fetch("/api/creator-profiles/me/template/draft", { method: "DELETE" });
  return json<ProfileTemplateStateDto>(res);
}

/* ── Theme settings ──────────────────────────────────────────────────────
   GET|PUT /creator-profiles/me/theme-settings. Creators pick KEYS
   (colorway id, font names); the server resolves them into
   theme_config. Royal Gold is the house colorway and leads the list. */

/* The picks are honestly nullable in the DTO: the server reports null
   for a pick that was never made (an untouched profile, or a legacy
   "custom" look with no registry colorway). Null means "no pick" —
   the editor renders it as unset, and a save never sends it back as
   if it were a value. */
export interface ProfileThemeSettingsDto {
  colorway: string | null;
  headingFont: string | null;
  bodyFont: string | null;
  colorways: Array<{ id: string; name: string }>;
  fonts: string[];
}

export async function fetchMyThemeSettings(): Promise<ProfileThemeSettingsDto> {
  const res = await fetch("/api/creator-profiles/me/theme-settings");
  return json<ProfileThemeSettingsDto>(res);
}

export interface ThemeSettingsPatch {
  colorway?: string;
  headingFont?: string;
  bodyFont?: string;
}

/** The save body for a theme-settings state: real picks only. Null /
    undefined fields are "no pick" and are left out entirely, so the
    wire carries exactly what the creator chose (the server also
    tolerates nulls as no-change — this keeps the intent explicit). */
export function themeSettingsPatch(settings: {
  colorway?: string | null;
  headingFont?: string | null;
  bodyFont?: string | null;
}): ThemeSettingsPatch {
  const patch: ThemeSettingsPatch = {};
  if (settings.colorway != null) patch.colorway = settings.colorway;
  if (settings.headingFont != null) patch.headingFont = settings.headingFont;
  if (settings.bodyFont != null) patch.bodyFont = settings.bodyFont;
  return patch;
}

export async function saveMyThemeSettings(patch: {
  colorway?: string | null;
  headingFont?: string | null;
  bodyFont?: string | null;
}): Promise<ProfileThemeSettingsDto> {
  const res = await fetch("/api/creator-profiles/me/theme-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(themeSettingsPatch(patch)),
  });
  return json<ProfileThemeSettingsDto>(res);
}

/* ── Profile store ───────────────────────────────────────────────────────
   GET /creator-profiles/:slug/store-catalog (public). One catalog over
   the creator's priced tracks, videos and products; every item's
   buyUrl lands on the surface that charges exactly the shown price. */

export interface StoreCatalogItemDto {
  kind: "track" | "video" | "product";
  productKind: string | null;
  id: string;
  title: string;
  artworkUrl: string | null;
  /* #29: accessibility description of the artwork, when provided. */
  artworkAlt: string | null;
  priceCents: number;
  price: string;
  compareAtCents: number | null;
  pwyw: { enabled: boolean; minCents: number } | null;
  buyUrl: string;
  /** The finished UGC ad pinned to this shop product (migration
      0178), or null — only shop products can carry one. */
  pinnedAd: { id: string; videoUrl: string } | null;
}

export interface StoreCatalogDto {
  profile: { slug: string; displayName: string; profileUrl: string };
  items: StoreCatalogItemDto[];
  counts: { tracks: number; videos: number; products: number; total: number };
}

/* DTO guard batch #2: the catalog fetcher was a raw cast and the section
 * reads catalog.items.length / catalog.items.map — a payload missing
 * `items` crashed the profile's Store block. Malformed → null → the
 * fetcher throws → the section's honest error view. An item without a
 * real price or a buy link is dropped (it could only render as a fake
 * or dead buy button); missing counts are derived from the items. */
export function normalizeStoreCatalog(payload: unknown): StoreCatalogDto | null {
  if (!isRecord(payload)) return null;
  const items: StoreCatalogItemDto[] = [];
  if (Array.isArray(payload.items)) {
    for (const raw of payload.items) {
      if (!isRecord(raw)) continue;
      const kind = raw.kind === "track" || raw.kind === "video" || raw.kind === "product" ? raw.kind : null;
      const priceCents = finiteNum(raw.priceCents);
      if (!kind || priceCents === null) continue;
      if (typeof raw.buyUrl !== "string" || !raw.buyUrl) continue;
      items.push({
        kind,
        productKind: typeof raw.productKind === "string" ? raw.productKind : null,
        id: typeof raw.id === "string" ? raw.id : "",
        title: typeof raw.title === "string" ? raw.title : "",
        artworkUrl: typeof raw.artworkUrl === "string" ? raw.artworkUrl : null,
        artworkAlt: typeof raw.artworkAlt === "string" && raw.artworkAlt ? raw.artworkAlt : null,
        priceCents,
        price: typeof raw.price === "string" ? raw.price : "",
        compareAtCents: finiteNum(raw.compareAtCents),
        pwyw: isRecord(raw.pwyw) && finiteNum(raw.pwyw.minCents) !== null
          ? { enabled: raw.pwyw.enabled === true, minCents: finiteNum(raw.pwyw.minCents)! }
          : null,
        buyUrl: raw.buyUrl,
        pinnedAd: isRecord(raw.pinnedAd) && typeof raw.pinnedAd.videoUrl === "string" && raw.pinnedAd.videoUrl
          ? {
              id: typeof raw.pinnedAd.id === "string" ? raw.pinnedAd.id : "",
              videoUrl: raw.pinnedAd.videoUrl,
            }
          : null,
      });
    }
  }
  const profile = isRecord(payload.profile) ? payload.profile : {};
  const counts = isRecord(payload.counts) ? payload.counts : {};
  const derived = {
    tracks: items.filter((i) => i.kind === "track").length,
    videos: items.filter((i) => i.kind === "video").length,
    products: items.filter((i) => i.kind === "product").length,
    total: items.length,
  };
  return {
    profile: {
      slug: typeof profile.slug === "string" ? profile.slug : "",
      displayName: typeof profile.displayName === "string" ? profile.displayName : "",
      profileUrl: typeof profile.profileUrl === "string" ? profile.profileUrl : "",
    },
    items,
    counts: {
      tracks: finiteNum(counts.tracks) ?? derived.tracks,
      videos: finiteNum(counts.videos) ?? derived.videos,
      products: finiteNum(counts.products) ?? derived.products,
      total: finiteNum(counts.total) ?? derived.total,
    },
  };
}

export type StoreLoadStatus = "loading" | "ready" | "error";
export type StoreView = "loading" | "error" | "hidden" | "owner-empty" | "items";

/** Store render decision — the house honesty rules: a failed load is an
    error state (never a fake-empty store); an empty store hides from
    visitors and invites the OWNER to price something. */
export function storeViewState(args: {
  status: StoreLoadStatus;
  count: number;
  isOwner: boolean;
}): StoreView {
  if (args.status === "loading") return "loading";
  if (args.status === "error") return "error";
  if (args.count > 0) return "items";
  return args.isOwner ? "owner-empty" : "hidden";
}

export async function fetchStoreCatalog(slug: string): Promise<StoreCatalogDto> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/store-catalog`);
  const catalog = normalizeStoreCatalog(await json<unknown>(res));
  if (!catalog) throw new Error("That store came back incomplete — try again.");
  return catalog;
}

/* ── Memberships ─────────────────────────────────────────────────────────
   GET /memberships/public/:creatorUserId (public). The creator's fan
   membership tiers, shown on the profile under the Store. */

export interface MembershipTierDto {
  id: string;
  creatorUserId: string;
  name: string;
  priceDollars: string;
  priceCents: number;
  description: string;
  perks: string[];
  isActive: boolean;
  trialEnabled: boolean;
  annualDiscountPct: number;
  annualPriceCents: number;
  annualPriceDollars: string;
  createdAt: string;
}

export interface PublicMembershipsDto {
  creatorUserId: string;
  tiers: MembershipTierDto[];
  testMode: boolean;
}

export type MembershipsLoadStatus = "loading" | "ready" | "error";
export type MembershipsView = "loading" | "error" | "hidden" | "owner-empty" | "tiers";

/** Memberships render decision — same honesty rules as the store: an
    error is an error, no tiers hides the block for visitors, and the
    owner gets the set-up invitation instead. Inactive tiers never
    render for anyone. */
export function membershipsViewState(args: {
  status: MembershipsLoadStatus;
  tiers: MembershipTierDto[];
  isOwner: boolean;
}): MembershipsView {
  if (args.status === "loading") return "loading";
  if (args.status === "error") return "error";
  if (args.tiers.some((t) => t.isActive)) return "tiers";
  return args.isOwner ? "owner-empty" : "hidden";
}

export function activeTiers(tiers: MembershipTierDto[]): MembershipTierDto[] {
  return tiers.filter((t) => t.isActive);
}

/** "$25.00 / month" — or "Free" for a $0 tier. Prices are the tier's own
    DTO strings end to end: what's shown is what checkout charges. */
export function membershipPriceLabel(tier: MembershipTierDto): string {
  return tier.priceCents > 0 ? `$${tier.priceDollars} / month` : "Free";
}

/** The annual line when the tier carries a real annual price: the
    discounted yearly total plus the saving. Null when annual billing
    isn't offered (no discount set, or a free tier). */
export function membershipAnnualLabel(tier: MembershipTierDto): string | null {
  if (tier.priceCents <= 0 || tier.annualDiscountPct <= 0) return null;
  return `$${tier.annualPriceDollars} / year — save ${tier.annualDiscountPct}%`;
}

export async function fetchPublicMemberships(creatorUserId: string): Promise<PublicMembershipsDto> {
  const res = await fetch(`/api/memberships/public/${encodeURIComponent(creatorUserId)}`);
  return json<PublicMembershipsDto>(res);
}
