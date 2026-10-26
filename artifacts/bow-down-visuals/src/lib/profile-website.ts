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
  push("gallery", "Gallery", true);
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

/* ── Fan Art Wall (Stack-200 #157) ───────────────────────────────────────
   Fan-submitted art in the profile's GALLERY block. The server gate is
   the contract: the public endpoint returns APPROVED pieces only, so
   this client never filters for display — it renders what it is given.
   Artist credit (artistName) rides every DTO in every state and is
   always rendered with the piece. Submitting and displaying are free —
   there is no price anywhere in this surface. */

export type FanArtStatus = "pending" | "approved" | "rejected" | "revoked";

export interface FanArtPieceDto {
  id: string;
  creatorProfileId: string;
  artistUserId: string;
  /** The artist's credit name — never stripped, in any state. */
  artistName: string;
  title: string;
  imageUrl: string;
  note: string;
  status: FanArtStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  creatorSlug: string;
  creatorName: string;
  /** Live profile link data — present only while the artist's profile
      is public. The credit NAME shows regardless. */
  artistSlug: string | null;
  artistAvatarUrl: string | null;
}

export interface FanArtWallDto {
  profile: { slug: string; displayName: string };
  pieces: FanArtPieceDto[];
}

export interface FanArtQueueDto extends FanArtWallDto {
  pendingCount: number;
}

const FAN_ART_STATUSES: readonly string[] = ["pending", "approved", "rejected", "revoked"];

/* DTO guard (same pattern as the store catalog above): a piece without
 * a real id, title, image, artist credit, or a known status is dropped
 * — it could only render as a broken or credit-less card, and credit is
 * never optional on this wall. A payload with no pieces array at all is
 * malformed → null → the fetcher throws → the section's error view. */
export function normalizeFanArtPiece(payload: unknown): FanArtPieceDto | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.id !== "string" || !payload.id) return null;
  if (typeof payload.title !== "string" || !payload.title) return null;
  if (typeof payload.imageUrl !== "string" || !payload.imageUrl) return null;
  if (typeof payload.artistName !== "string" || !payload.artistName) return null;
  if (typeof payload.status !== "string" || !FAN_ART_STATUSES.includes(payload.status)) return null;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  return {
    id: payload.id,
    creatorProfileId: str(payload.creatorProfileId),
    artistUserId: str(payload.artistUserId),
    artistName: payload.artistName,
    title: payload.title,
    imageUrl: payload.imageUrl,
    note: str(payload.note),
    status: payload.status as FanArtStatus,
    reviewedByUserId: strOrNull(payload.reviewedByUserId),
    reviewedAt: strOrNull(payload.reviewedAt),
    createdAt: str(payload.createdAt),
    updatedAt: str(payload.updatedAt),
    creatorSlug: str(payload.creatorSlug),
    creatorName: str(payload.creatorName),
    artistSlug: strOrNull(payload.artistSlug),
    artistAvatarUrl: strOrNull(payload.artistAvatarUrl),
  };
}

export function normalizeFanArtWall(payload: unknown): FanArtWallDto | null {
  if (!isRecord(payload) || !Array.isArray(payload.pieces)) return null;
  const pieces = payload.pieces
    .map((p) => normalizeFanArtPiece(p))
    .filter((p): p is FanArtPieceDto => p !== null);
  const profile = isRecord(payload.profile) ? payload.profile : {};
  return {
    profile: {
      slug: typeof profile.slug === "string" ? profile.slug : "",
      displayName: typeof profile.displayName === "string" ? profile.displayName : "",
    },
    pieces,
  };
}

export type FanArtLoadStatus = "loading" | "ready" | "error";
export type FanArtWallView = "loading" | "error" | "hidden" | "owner-empty" | "wall";

/** Wall render decision — the house honesty rules: a failed load is an
    error state (never a fake-empty wall); an empty wall hides from
    visitors and invites the OWNER (their fans haven't hung anything
    yet — the submit door stays open to fans either way). */
export function fanArtWallViewState(args: {
  status: FanArtLoadStatus;
  count: number;
  isOwner: boolean;
}): FanArtWallView {
  if (args.status === "loading") return "loading";
  if (args.status === "error") return "error";
  if (args.count > 0) return "wall";
  return args.isOwner ? "owner-empty" : "hidden";
}

/** The one line a fan sees about where their piece stands. Pending is
    honest — the piece is NOT on the wall until the creator approves
    this exact piece. */
export function fanArtStatusLabel(status: FanArtStatus): string {
  switch (status) {
    case "pending":
      return "Waiting for the creator's approval";
    case "approved":
      return "On the wall";
    case "rejected":
      return "Not accepted for this wall";
    case "revoked":
      return "Taken down by the creator";
  }
}

export type FanArtAction = "approve" | "reject" | "revoke";

/** The legal per-piece decisions from each state — mirrors the API
    transition table exactly (the server re-checks; this only decides
    which buttons exist). */
export function fanArtActionsFor(status: FanArtStatus): FanArtAction[] {
  switch (status) {
    case "pending":
      return ["approve", "reject"];
    case "approved":
      return ["revoke"];
    case "revoked":
      return ["approve"];
    case "rejected":
      return [];
  }
}

export async function fetchPublicFanArtWall(slug: string): Promise<FanArtWallDto> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/fan-art`);
  const wall = normalizeFanArtWall(await json<unknown>(res));
  if (!wall) throw new Error("That fan art wall came back incomplete — try again.");
  return wall;
}

export async function submitFanArtPiece(
  slug: string,
  input: { title: string; imageUrl: string; note?: string; artistName?: string },
): Promise<FanArtPieceDto> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/fan-art`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      image_url: input.imageUrl,
      ...(input.note ? { note: input.note } : {}),
      ...(input.artistName ? { artist_name: input.artistName } : {}),
    }),
  });
  const data = await json<{ piece: unknown }>(res);
  const piece = normalizeFanArtPiece(data.piece);
  if (!piece) throw new Error("That submission came back incomplete — try again.");
  return piece;
}

export async function fetchMyFanArtSubmissions(): Promise<FanArtPieceDto[]> {
  const res = await fetch("/api/fan-art/mine");
  const data = await json<{ pieces: unknown }>(res);
  if (!Array.isArray(data.pieces)) throw new Error("Your submissions came back incomplete — try again.");
  return data.pieces
    .map((p) => normalizeFanArtPiece(p))
    .filter((p): p is FanArtPieceDto => p !== null);
}

export async function fetchFanArtQueue(): Promise<FanArtQueueDto> {
  const res = await fetch("/api/creator-profiles/me/fan-art");
  const data = await json<{ profile: unknown; pieces: unknown; pendingCount: unknown }>(res);
  const wall = normalizeFanArtWall(data);
  if (!wall) throw new Error("Your fan art queue came back incomplete — try again.");
  return {
    ...wall,
    pendingCount:
      finiteNum(data.pendingCount) ?? wall.pieces.filter((p) => p.status === "pending").length,
  };
}

export async function reviewFanArtPiece(pieceId: string, action: FanArtAction): Promise<FanArtPieceDto> {
  const res = await fetch(`/api/creator-profiles/me/fan-art/${encodeURIComponent(pieceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const data = await json<{ piece: unknown }>(res);
  const piece = normalizeFanArtPiece(data.piece);
  if (!piece) throw new Error("That decision came back incomplete — try again.");
  return piece;
}
