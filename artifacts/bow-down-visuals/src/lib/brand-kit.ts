/* ─── Brand kit client — the ONE brand record every surface reads ────────
   Backs GET/PUT/POST /api/brand-kit (the kit persisted on the creator's
   profile record server-side). The Branding hub owns generation + edits;
   the editor's branding picker, the Intros logo field, the press kit and
   the link-in-bio builder all READ from here instead of asking the
   creator to re-upload or re-type their brand (linkage fix, audit DE-5).

   Reads/saves/applies are free; only generateBrandKit charges (200 Visual
   Bucs, server-side, exactly as the endpoint always has). Throws on
   failure: callers show an honest error state, never a fake empty kit. */

export interface BrandKitColor {
  hex: string;
  name: string;
  role: string;
}

export interface BrandKitFont {
  heading: string;
  body: string;
  usage: string;
}

export interface BrandKit {
  brandName: string;
  vibe: string;
  industry: string | null;
  colors: BrandKitColor[];
  fonts: BrandKitFont[];
  logoPrompt: string;
  taglines: string[];
  selectedTagline: string | null;
  logoUrl: string | null;
  bioLines: string[];
  pressFacts: string[];
  generatedAt: string | null;
  updatedAt: string | null;
}

export interface BrandKitPatch {
  brandName?: string;
  logoUrl?: string | null;
  selectedTagline?: string | null;
  bioLines?: string[];
  pressFacts?: string[];
}

export interface GenerateBrandKitResult {
  /** Raw generated kit, as the endpoint has always returned it. */
  kit: {
    colors: BrandKitColor[];
    fonts: BrandKitFont[];
    logoPrompt: string;
    taglines: string[];
  };
  /** The full stored record (generated core + the creator's manual
   *  fields), or null when nothing was stored. */
  brandKit: BrandKit | null;
  /** True when the kit was persisted onto the creator's brand record. */
  saved: boolean;
  creditsRemaining: number | null;
}

export class BrandKitRequestError extends Error {
  status: number;
  code: string | null;
  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "BrandKitRequestError";
    this.status = status;
    this.code = code;
  }
  get outOfCredits(): boolean {
    return this.status === 402 || this.code === "out_of_credits";
  }
}

type GetAccessToken = () => Promise<string | null>;

async function brandKitFetch(
  getAccessToken: GetAccessToken,
  path: string,
  init?: RequestInit,
): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new BrandKitRequestError(
      res.status,
      typeof data["message"] === "string"
        ? (data["message"] as string)
        : typeof data["error"] === "string"
          ? (data["error"] as string)
          : `brand kit request failed: ${res.status}`,
      typeof data["error"] === "string" ? (data["error"] as string) : null,
    );
  }
  return data;
}

/** The creator's saved kit, or null when they haven't got one yet. */
export async function fetchBrandKit(getAccessToken: GetAccessToken): Promise<BrandKit | null> {
  const data = await brandKitFetch(getAccessToken, "/api/brand-kit");
  return (data.brandKit as BrandKit | null) ?? null;
}

/** Generate a fresh kit (charges 200 Visual Bucs server-side) and persist
 *  it as the brand record. Manual fields survive the re-generation. */
export async function generateBrandKit(
  getAccessToken: GetAccessToken,
  input: { brandName: string; vibe: string; industry?: string },
): Promise<GenerateBrandKitResult> {
  const data = await brandKitFetch(getAccessToken, "/api/brand-kit", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return {
    kit: data.kit,
    brandKit: (data.brandKit as BrandKit | null) ?? null,
    saved: data.saved === true,
    creditsRemaining: typeof data.creditsRemaining === "number" ? data.creditsRemaining : null,
  };
}

/** Save manual fields (logo, tagline pick, bio lines, press facts). Free. */
export async function saveBrandKit(getAccessToken: GetAccessToken, patch: BrandKitPatch): Promise<BrandKit> {
  const data = await brandKitFetch(getAccessToken, "/api/brand-kit", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  return data.brandKit as BrandKit;
}

/** Write the kit's colors + fonts into the profile's live theme. Free. */
export async function applyBrandKit(getAccessToken: GetAccessToken): Promise<BrandKit> {
  const data = await brandKitFetch(getAccessToken, "/api/brand-kit/apply", { method: "POST" });
  return data.brandKit as BrandKit;
}

/* ── Consumer projections (pure) ───────────────────────────────────────────
   Each consumer fills ONLY its empty fields from these — the kit never
   overwrites words the creator already wrote on that surface. */

/** The kit's color for a role ("primary" | "accent" | "background" …). */
export function brandKitColor(kit: BrandKit | null, role: string): string | null {
  return kit?.colors.find((c) => c.role === role)?.hex ?? null;
}

/** Fields the press kit can take from the brand kit. The kit's logo is
 *  deliberately NOT offered as a press photo — a logo is not a photo. */
export function pressKitFieldsFromBrandKit(kit: BrandKit | null): {
  artistName?: string;
  tagline?: string;
  bio?: string;
  achievements?: string[];
} {
  if (!kit) return {};
  const out: ReturnType<typeof pressKitFieldsFromBrandKit> = {};
  if (kit.brandName.trim()) out.artistName = kit.brandName;
  const tagline = kit.selectedTagline ?? kit.taglines[0];
  if (tagline) out.tagline = tagline;
  if (kit.bioLines.length) out.bio = kit.bioLines.join("\n\n");
  if (kit.pressFacts.length) out.achievements = [...kit.pressFacts];
  return out;
}

/** Fields the link-in-bio page can take from the brand kit. Here the
 *  logo DOES belong: a bio page's avatar is the creator's mark. */
export function bioPageFieldsFromBrandKit(kit: BrandKit | null): {
  displayName?: string;
  headline?: string;
  bio?: string;
  avatarUrl?: string;
} {
  if (!kit) return {};
  const out: ReturnType<typeof bioPageFieldsFromBrandKit> = {};
  if (kit.brandName.trim()) out.displayName = kit.brandName;
  const tagline = kit.selectedTagline ?? kit.taglines[0];
  if (tagline) out.headline = tagline;
  if (kit.bioLines.length) out.bio = kit.bioLines.join(" ");
  if (kit.logoUrl) out.avatarUrl = kit.logoUrl;
  return out;
}
