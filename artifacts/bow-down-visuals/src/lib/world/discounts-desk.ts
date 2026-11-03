/**
 * discounts-desk — the seam behind the shop stand's native
 * Discount Codes desk (stack1500 world parity wave #3, census
 * item 45; the census counted storefront discount codes
 * ABSENT from the World before this wave).
 *
 * Source of truth: artifacts/api-server/src/routes/
 * storefront.ts (the /storefront/discounts family).
 *   GET    /api/storefront/discounts → { codes: [{ id, code,
 *     percentOff, maxUses (-1 = unlimited), usedCount,
 *     expiresAt (ISO|null), isActive, createdAt, appliesTo }] }
 *     — codes are PROFILE-WIDE: the rail itself says they
 *     apply to every active product, and its appliesTo line
 *     rides into the desk verbatim.
 *   POST   /api/storefront/discounts { code (2–40 chars,
 *     letters/numbers/-/_, stored uppercased), percentOff
 *     (int 1–90), maxUses (int ≥ -1, default -1), expiresAt?
 *     (ISO datetime | null) } → { code }; a duplicate answers
 *     409 CODE_TAKEN with the rail's own message.
 *   PATCH  /api/storefront/discounts/:id { isActive?,
 *     expiresAt?, maxUses? } → the updated row family.
 *   DELETE /api/storefront/discounts/:id → { ok: true }.
 *   GET    /api/storefront/discounts/validate is the BUYER's
 *   public checkout rail — not the seller desk's surface.
 *
 * FREE: no registry row exists for the family (verified —
 * getCreditCost answers null), so the desk rides plain
 * authed fetches and re-reads the list after every action.
 * The code-state helper mirrors the rail's discountUsable
 * order exactly: inactive → expired → used up → live.
 */
import { getCreditCost } from "../credit-costs";

export const DISCOUNTS_PATH = "/api/storefront/discounts";

/** The family is free — the registry has no row for it. */
export const DISCOUNTS_FREE = getCreditCost(DISCOUNTS_PATH) === null;

export function discountPath(id: string): string {
  return `${DISCOUNTS_PATH}/${encodeURIComponent(id)}`;
}

export type DiscountCodeState = "live" | "inactive" | "expired" | "used-up";

export interface DiscountCode {
  id: string;
  code: string;
  percentOff: number;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
  appliesTo: string | null;
}

/** The rail's discountUsable order: inactive → expired →
 *  used up → live. */
export function discountCodeState(
  code: Pick<DiscountCode, "isActive" | "expiresAt" | "maxUses" | "usedCount">,
  now: number = Date.now(),
): DiscountCodeState {
  if (!code.isActive) return "inactive";
  if (code.expiresAt && new Date(code.expiresAt).getTime() < now) return "expired";
  if (code.maxUses !== -1 && code.usedCount >= code.maxUses) return "used-up";
  return "live";
}

export const DISCOUNT_STATE_LABELS: Record<DiscountCodeState, string> = {
  live: "Live",
  inactive: "Switched off",
  expired: "Expired",
  "used-up": "Used up",
};

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function discountCodeOf(raw: unknown): DiscountCode | null {
  const o = obj(raw);
  if (!o) return null;
  const id = typeof o["id"] === "string" ? o["id"] : null;
  const code = typeof o["code"] === "string" ? o["code"] : null;
  const percentOff = num(o["percentOff"]);
  if (!id || !code || percentOff === null) return null;
  return {
    id,
    code,
    percentOff,
    maxUses: num(o["maxUses"]) ?? -1,
    usedCount: num(o["usedCount"]) ?? 0,
    expiresAt: typeof o["expiresAt"] === "string" ? o["expiresAt"] : null,
    isActive: o["isActive"] === true,
    appliesTo: typeof o["appliesTo"] === "string" ? o["appliesTo"] : null,
  };
}

export function discountCodesOf(data: unknown): DiscountCode[] | null {
  const o = obj(data);
  if (!o || !Array.isArray(o["codes"])) return null;
  const codes: DiscountCode[] = [];
  for (const raw of o["codes"]) {
    const code = discountCodeOf(raw);
    if (code) codes.push(code);
  }
  return codes;
}

export interface DiscountForm {
  code: string;
  percentOff: string;
  maxUses: string;
  expiresDate: string;
}

export const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

/** The CreateDiscountSchema, mirrored: code 2–40 chars from
 *  the allowed set (the rail stores it uppercased), percent
 *  an int 1–90, max uses blank = unlimited (-1) or an int
 *  ≥ -1, the expiry date (when given) becomes the ISO
 *  datetime the schema demands. */
export function buildDiscountPayload(form: DiscountForm): Record<string, unknown> | null {
  const code = form.code.trim();
  if (code.length < 2 || code.length > 40 || !CODE_PATTERN.test(code)) return null;
  const percentOff = Number(form.percentOff);
  if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 90) return null;
  let maxUses = -1;
  if (form.maxUses.trim() !== "") {
    const parsed = Number(form.maxUses);
    if (!Number.isInteger(parsed) || parsed < -1) return null;
    maxUses = parsed;
  }
  let expiresAt: string | null = null;
  if (form.expiresDate.trim() !== "") {
    const d = new Date(`${form.expiresDate.trim()}T23:59:59`);
    if (Number.isNaN(d.getTime())) return null;
    expiresAt = d.toISOString();
  }
  return { code, percentOff, maxUses, expiresAt };
}

/** "12 of 50 used" / "3 used · no limit" — the desk's usage line. */
export function discountUsageLine(code: Pick<DiscountCode, "usedCount" | "maxUses">): string {
  return code.maxUses === -1
    ? `${code.usedCount} used · no limit`
    : `${code.usedCount} of ${code.maxUses} used`;
}
