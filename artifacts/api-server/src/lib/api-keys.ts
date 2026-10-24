import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db, apiKeysTable, type ApiKey } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { logger } from "./logger";

/* ─── Public Creator API keys (Stack-100 #3, feature #9) ─────────────────
   Lets a signed-in creator mint scoped keys so they — and their own
   agents/tools — can build on Bow Down through /api/v1.

   Hard rules (credit-leak surface — treat casually and it leaks):
   - Plaintext is returned ONCE from createApiKey() and never stored,
     never logged, never readable again. Only its SHA-256 hash persists.
   - A key authenticates as its owner ONLY. There is no admin surface,
     no cross-user read, anywhere in this module or its routes.
   - Revocation is a timestamp checked on EVERY auth lookup — a revoked
     key dies on the next request, no caching anywhere.
   - If the api_keys table is missing (migration held — see the lane's
     MIGRATION-NEEDED.md) lookups throw and the auth middleware fails
     CLOSED (401). Nothing in this module fails open. */

/** The complete v1 scope set. Anything not listed here does not exist. */
export const API_KEY_SCOPES = [
  "profile:read",
  "content:read",
  "earnings:read",
  "generate:bio",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const API_KEY_PREFIX = "bdv_live_";

/** Non-secret display fragment length (prefix + first random chars). */
const DISPLAY_PREFIX_LEN = API_KEY_PREFIX.length + 4;

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

/** Validate a creator-picked scope list: non-empty, all known, deduped. */
export function normalizeScopes(input: unknown): ApiKeyScope[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: ApiKeyScope[] = [];
  for (const s of input) {
    if (typeof s !== "string" || !isApiKeyScope(s)) return null;
    if (!out.includes(s)) out.push(s);
  }
  return out.length > 0 ? out : null;
}

export function parseScopes(stored: string): ApiKeyScope[] {
  return stored
    .split(",")
    .map((s) => s.trim())
    .filter(isApiKeyScope);
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function isApiKeyFormat(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX) && value.length >= API_KEY_PREFIX.length + 32;
}

export interface GeneratedApiKey {
  /** Shown to the creator exactly once. Never persisted anywhere. */
  plaintext: string;
  keyPrefix: string;
  keyHash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const plaintext = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return {
    plaintext,
    keyPrefix: plaintext.slice(0, DISPLAY_PREFIX_LEN),
    keyHash: hashApiKey(plaintext),
  };
}

/** Constant-time hash comparison (defence in depth over the DB lookup). */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface ApiKeyPublic {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

function toPublic(row: ApiKey): ApiKeyPublic {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: parseScopes(row.scopes),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

/** Create a key for `userId`. Returns the public row + the one-time plaintext. */
export async function createApiKey(
  userId: string,
  name: string,
  scopes: ApiKeyScope[],
): Promise<{ key: ApiKeyPublic; plaintext: string }> {
  const gen = generateApiKey();
  const [row] = await db
    .insert(apiKeysTable)
    .values({
      userId,
      name,
      keyPrefix: gen.keyPrefix,
      keyHash: gen.keyHash,
      scopes: scopes.join(","),
    })
    .returning();
  if (!row) throw new Error("api key insert returned no row");
  // NOTE: gen.plaintext is deliberately never logged here or anywhere.
  return { key: toPublic(row), plaintext: gen.plaintext };
}

export async function listApiKeys(userId: string): Promise<ApiKeyPublic[]> {
  const rows = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.userId, userId))
    .orderBy(desc(apiKeysTable.createdAt));
  return rows.map(toPublic);
}

/** Revoke a key the caller owns. Returns false when not found / not theirs. */
export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const updated = await db
    .update(apiKeysTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeysTable.id, keyId),
        eq(apiKeysTable.userId, userId),
        isNull(apiKeysTable.revokedAt),
      ),
    )
    .returning({ id: apiKeysTable.id });
  return updated.length > 0;
}

export interface ResolvedApiKey {
  keyId: string;
  userId: string;
  scopes: ApiKeyScope[];
}

/**
 * Resolve a plaintext key to its owner + scopes — and NOTHING more.
 * Returns null for unknown, malformed, or revoked keys. Throws only on
 * infrastructure failure (e.g. table missing pre-migration); the caller
 * (auth middleware) treats a throw as a failed auth, never as a pass.
 */
export async function resolveApiKey(plaintext: string): Promise<ResolvedApiKey | null> {
  if (!isApiKeyFormat(plaintext)) return null;
  const hash = hashApiKey(plaintext);
  const [row] = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.keyHash, hash))
    .limit(1);
  if (!row) return null;
  if (!hashesEqual(row.keyHash, hash)) return null;
  if (row.revokedAt) return null;
  // Best-effort last-used stamp; a failure here must not fail the request.
  void db
    .update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, row.id))
    .catch((err) => logger.warn({ err }, "[api-keys] last_used stamp failed"));
  return { keyId: row.id, userId: row.userId, scopes: parseScopes(row.scopes) };
}
