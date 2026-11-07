/**
 * Webhook delivery history — honest load states (Stack-200 hardening
 * D2, census section A item 8: the "empty lie" family).
 *
 * Before: toggleHistory()'s catch did setDeliveries([]), so a failed
 * history read rendered "No deliveries yet for this endpoint" — a
 * developer debugging a broken endpoint was told nothing was ever
 * delivered exactly when the history read broke. After: the fetch is a
 * retryable loader; failure raises a failed flag that renders an error
 * row with a retry; the empty copy renders ONLY on a confirmed-empty
 * successful load, and the loading row stays distinct from both.
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
const settings = read("./DeveloperApiSettings.tsx");

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

describe("failure path — delivery history never reads as empty on a failed load", () => {
  it("the load catch raises the failed flag and never writes the empty array", () => {
    expect(settings).toContain("setDeliveriesFailed(true)");
    expect(settings).not.toContain("setDeliveries([])");
  });

  it("a successful load clears the failed flag", () => {
    expect(settings).toContain("setDeliveriesFailed(false)");
  });

  it("failure renders the error row with a retry wired to the real loader", () => {
    expect(settings).toContain('data-testid="webhook-deliveries-load-error"');
    expect(settings).toContain('t("webhookDeliveries.loadError")');
    expect(settings).toContain('t("webhookDeliveries.retry")');
    expect(settings).toContain("onClick={() => void loadDeliveries(h.id)}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the error branch renders BEFORE the loading and confirmed-empty branches", () => {
    const errAt = settings.indexOf('data-testid="webhook-deliveries-load-error"');
    const loadAt = settings.indexOf("Loading deliveries…");
    const emptyAt = settings.indexOf("No deliveries yet for this endpoint.");
    expect(errAt).toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(errAt);
    expect(emptyAt).toBeGreaterThan(loadAt);
  });

  it("opening a history resets to the loading state, not the empty list", () => {
    expect(settings).toContain("setDeliveries(null);");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the webhookDeliveries honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["webhookDeliveries.loadError", "webhookDeliveries.retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
