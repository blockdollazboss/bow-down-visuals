import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/* AES-256-GCM encryption for OAuth tokens stored in `social_accounts`.
   Key comes from SOCIAL_TOKEN_KEY (64 hex chars = 32 bytes). Fail closed:
   any encrypt/decrypt call throws when the key is missing or malformed, so
   tokens can never be written or read without a valid key configured. */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function getKey(): Buffer {
  const raw = process.env["SOCIAL_TOKEN_KEY"] ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "SOCIAL_TOKEN_KEY is not configured (expected 64 hex chars). " +
        "Refusing to handle social tokens.",
    );
  }
  return Buffer.from(raw, "hex");
}

/** Encrypts `plaintext`; returns "ivHex:cipherHex:tagHex". Throws when the key is unset. */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${enc.toString("hex")}:${tag.toString("hex")}`;
}

/** Decrypts a value produced by encryptToken(). Throws on bad key, bad format, or tampering. */
export function decryptToken(payload: string): string {
  const key = getKey();
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("decryptToken: malformed payload");
  const [ivHex, encHex, tagHex] = parts as [string, string, string];
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/** Non-throwing check used by health/config endpoints. */
export function isSocialTokenKeyConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
