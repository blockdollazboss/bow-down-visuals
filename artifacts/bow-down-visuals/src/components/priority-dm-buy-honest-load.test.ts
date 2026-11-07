/**
 * PriorityDmComposer buy door — honest load states (Stack-200
 * hardening D2, census section A item 7: the "empty lie" family).
 *
 * Before: the status GET's rejection handler did setStatus(null) and
 * the render was `if (!status) return null` — loading, failed, and
 * confirmed-ineligible were identical, so on any hiccup the fan never
 * saw the paid (100 VB) priority option at all. After: failure keeps
 * status null but raises a failed flag that renders a small "couldn't
 * load" note with a retry wired to the real loader; confirmed states
 * (gate off, not buyable) still render nothing, exactly as before.
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
const panel = read("./PriorityDmPanel.tsx");
const composerAt = panel.indexOf("export function PriorityDmComposer");
const composer = panel.slice(composerAt);

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

describe("failure path — the buy door never silently disappears on a failed load", () => {
  it("the status rejection raises the failed flag instead of collapsing into plain null", () => {
    expect(composer).toContain("setStatusFailed(true)");
    expect(composer).not.toContain("() => setStatus(null)");
  });

  it("a successful load clears the failed flag", () => {
    expect(composer).toContain("setStatusFailed(false)");
  });

  it("failure renders the couldn't-load note with a retry wired to the real loader", () => {
    expect(composer).toContain('data-testid="priority-dm-status-load-error"');
    expect(composer).toContain('t("priorityDmBuy.loadError")');
    expect(composer).toContain('t("priorityDmBuy.retry")');
    expect(composer).toContain("onClick={() => loadStatus()}");
  });
});

describe("confirmed states stay distinct from failure", () => {
  it("the failure note renders only in the no-status branch, before the confirmed-state doors", () => {
    const errAt = composer.indexOf('data-testid="priority-dm-status-load-error"');
    const gateOffAt = composer.indexOf("if (!status.platform_enabled) return null;");
    const buyableAt = composer.indexOf("if (!canBuyPriority(status)) return null;");
    expect(errAt).toBeGreaterThan(-1);
    expect(gateOffAt).toBeGreaterThan(errAt);
    expect(buyableAt).toBeGreaterThan(gateOffAt);
  });

  it("a fresh creator change resets both the status and the failed flag", () => {
    expect(composer).toContain("setStatus(null);\n    setStatusFailed(false);");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the priorityDmBuy honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["priorityDmBuy.loadError", "priorityDmBuy.retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
