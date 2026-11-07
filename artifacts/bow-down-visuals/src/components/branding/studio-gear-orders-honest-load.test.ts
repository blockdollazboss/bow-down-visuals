/**
 * StudioGearShop orders — honest load states (Stack-200 hardening D2,
 * census section A item 5: the "empty lie" family).
 *
 * Before: loadOrders() never checked res.ok (an error body became
 * setOrders([])) and the catch was a silent "best-effort" comment, so a
 * failed load landed on "No gear orders yet" — hiding made-to-order
 * orders including pending proof approvals. After: failure raises a
 * visible error state with retry and never writes the empty array; a
 * failed reload keeps loaded orders behind an error banner; the empty
 * copy renders ONLY on a confirmed-empty successful load.
 *
 * The FE suite runs in node (no DOM), so — like the sibling honest-load
 * pins — these tests pin the state machine in source: which setter each
 * load outcome calls, and which render branch each state reaches. The
 * new copy keys are English in en.json; the other nine catalogs carry
 * the English verbatim as UNREVIEWED placeholders.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const shop = read("./StudioGearShop.tsx");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

describe("failure path — gear orders never read as empty on a failed load", () => {
  it("the loader throws on a non-ok response instead of parsing an error body as an empty list", () => {
    expect(shop).toContain('if (!res.ok) throw new Error("gear orders load failed");');
  });

  it("the load catch raises the failed flag and never writes the orders state", () => {
    expect(shop).toContain("setOrdersFailed(true)");
    /* setOrders survives exactly once in the file: the success path.
       The failure path must not fabricate an empty orders list. */
    expect(shop.match(/setOrders\(/g)).toHaveLength(1);
    const loadAt = shop.indexOf("async function loadOrders()");
    const catchAt = shop.indexOf("setOrdersFailed(true)", loadAt);
    expect(shop.indexOf("setOrders(", loadAt)).toBeLessThan(catchAt);
  });

  it("a successful load clears the failed flag", () => {
    expect(shop).toContain("setOrdersFailed(false)");
  });

  it("failure with nothing on screen renders the error card with a retry", () => {
    expect(shop).toContain('data-testid="studio-gear-orders-load-error"');
    expect(shop).toContain('t("studioGearOrders.loadError")');
    expect(shop).toContain('t("studioGearOrders.retry")');
    /* the retry is wired to the real loader, in both error branches */
    expect(shop.match(/onClick=\{\(\) => void loadOrders\(\)\}/g)).toHaveLength(2);
  });

  it("a failed reload keeps the loaded orders and shows the error banner over them", () => {
    expect(shop).toContain('data-testid="studio-gear-orders-reload-error"');
    expect(shop).toContain("{ordersFailed && (");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("orders state starts null so the first load is a pending state, not an empty list", () => {
    expect(shop).toContain("useState<GearOrder[] | null>(null)");
  });

  it("the empty copy renders only on a confirmed-empty successful load", () => {
    expect(shop).toContain("orders.length === 0 ? (");
    /* the empty branch sits AFTER the failure and loading branches */
    const errAt = shop.indexOf('data-testid="studio-gear-orders-load-error"');
    const emptyAt = shop.indexOf("No gear orders yet");
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the studioGearOrders honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../../locales/${loc}.json`)));
    for (const k of ["studioGearOrders.loadError", "studioGearOrders.retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
