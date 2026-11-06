/**
 * Plain-Words Deals item picker — honest load states (Stack-200
 * hardening D2, census section A item 12: the "empty lie" family).
 *
 * Before: the item loaders bailed with bare `if (!res.ok) return;` and
 * the catch did setItemOptions([]), so ANY failure left the picker on
 * its "No items found yet" placeholder — a creator with releases and
 * products was told they had nothing to attach a split to. After: the
 * load is a named retryable function; every branch throws on !res.ok;
 * failure raises itemOptionsFailed and the picker renders an honest
 * error + retry instead of the select; "No items found yet" renders
 * ONLY on a confirmed-empty successful load (including the genuine
 * no-creator-profile answer on the store-product branch).
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
const deals = read("./PlainWordsDeals.tsx");
const loadAt = deals.indexOf("async function loadItemOptions()");
const loader = deals.slice(loadAt, deals.indexOf("useEffect(() => {", loadAt));

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

describe("failure path — the item picker never reads as empty on a failed load", () => {
  it("every branch throws on a non-ok response instead of bailing silently", () => {
    expect(loader).not.toContain("if (!res.ok) return;");
    expect(loader.match(/throw new Error\("items load failed"\)/g)).toHaveLength(4);
  });

  it("the load catch raises the failed flag and never writes the options state", () => {
    expect(loader).toContain("setItemOptionsFailed(true)");
    const catchAt = loader.indexOf("setItemOptionsFailed(true)");
    /* the only setItemOptions calls sit on success/genuine paths, before the catch */
    expect(loader.lastIndexOf("setItemOptions(")).toBeLessThan(catchAt);
  });

  it("successful loads clear the failed flag", () => {
    expect(loader).toContain("setItemOptionsFailed(false)");
  });

  it("failure renders the error state with a retry wired to the real loader, in place of the select", () => {
    expect(deals).toContain('data-testid="plain-deals-items-load-error"');
    expect(deals).toContain('t("plainDealsItems.loadError")');
    expect(deals).toContain('t("plainDealsItems.retry")');
    expect(deals).toContain("onClick={() => void loadItemOptions()}");
    expect(deals).toContain("{itemOptionsFailed ? (");
  });
});

describe("genuine-empty path stays distinct from failure", () => {
  it("the no-profile store answer is a confirmed empty, not a failure", () => {
    const noProfileAt = loader.indexOf("if (!profile?.id) {");
    const block = loader.slice(noProfileAt, noProfileAt + 400);
    expect(block).toContain("setItemOptions([]);");
    expect(block).toContain("setItemOptionsFailed(false);");
  });

  it("the 'No items found yet' placeholder survives only inside the non-failed select", () => {
    const errAt = deals.indexOf('data-testid="plain-deals-items-load-error"');
    const emptyAt = deals.indexOf("No items found yet");
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the plainDealsItems honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../../locales/${loc}.json`)));
    for (const k of ["plainDealsItems.loadError", "plainDealsItems.retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
