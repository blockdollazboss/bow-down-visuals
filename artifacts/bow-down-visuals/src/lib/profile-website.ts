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
  const [tracksRes, videosRes] = await Promise.all([
    fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/media?kind=track&limit=50`),
    fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/media?kind=video&limit=50`),
  ]);
  const tracks = await json<{ items: Array<Record<string, unknown>> }>(tracksRes);
  const videos = await json<{ items: Array<Record<string, unknown>> }>(videosRes);
  const out: PinnableItem[] = [];
  for (const t of tracks.items ?? []) {
    out.push({
      kind: "track",
      id: String(t["id"] ?? ""),
      title: String(t["title"] ?? "Untitled"),
      artworkUrl: (t["artwork_url"] as string | null) ?? null,
    });
  }
  for (const v of videos.items ?? []) {
    out.push({
      kind: "video",
      id: String(v["id"] ?? ""),
      title: String(v["title"] ?? "Untitled"),
      artworkUrl: (v["thumbnail_url"] as string | null) ?? null,
    });
  }
  return out.filter((i) => i.id);
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
  return json<FanCollection>(res);
}

export async function fetchMyCollection(): Promise<FanCollection> {
  const res = await fetch("/api/collections/me");
  return json<FanCollection>(res);
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

export interface ProfileThemeSettingsDto {
  themeId: string;
  colorway: string;
  headingFont: string;
  bodyFont: string;
  colorways: Array<{ id: string; name: string }>;
  fonts: string[];
}

export async function fetchMyThemeSettings(): Promise<ProfileThemeSettingsDto> {
  const res = await fetch("/api/creator-profiles/me/theme-settings");
  return json<ProfileThemeSettingsDto>(res);
}

export async function saveMyThemeSettings(patch: {
  colorway?: string;
  headingFont?: string;
  bodyFont?: string;
}): Promise<ProfileThemeSettingsDto> {
  const res = await fetch("/api/creator-profiles/me/theme-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
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
  priceCents: number;
  price: string;
  compareAtCents: number | null;
  pwyw: { enabled: boolean; minCents: number } | null;
  buyUrl: string;
}

export interface StoreCatalogDto {
  profile: { slug: string; displayName: string; profileUrl: string };
  items: StoreCatalogItemDto[];
  counts: { tracks: number; videos: number; products: number; total: number };
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
  return json<StoreCatalogDto>(res);
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
