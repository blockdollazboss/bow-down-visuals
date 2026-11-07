/**
 * SubscriptionHistory — honest load states (Stack-200 hardening D1,
 * census section A item 6: the "empty lie" family).
 *
 * Before: rows started as [], were set only on res.ok, and the catch
 * was a silent "history degrades silently" — any failure (or a
 * non-200) rendered exactly like a subscriber with no receipts: the
 * section returned null and a paying subscriber's whole receipt
 * history disappeared without a trace.
 *
 * After: rows start null (no successful load yet) and [] means a
 * confirmed-empty 200 — the ONLY state that renders nothing. Failure
 * (throw or !res.ok) renders a slim error row with retry; the first
 * load renders a pending row; a failed reload over loaded receipts
 * banners the error above the list.
 *
 * The FE suite runs in node (no DOM), so — like the sibling pins —
 * these tests pin the state machine in source. Copy keys are English
 * in en.json; the other nine catalogs carry the English verbatim as
 * UNREVIEWED placeholders.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const history = read("./SubscriptionHistory.tsx");

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

describe("failure path — receipts never silently vanish", () => {
  it("rows start null, not as a fabricated empty history", () => {
    expect(history).toContain("useState<ReceiptRow[] | null>(null)");
    expect(history).not.toContain("useState<ReceiptRow[]>([])");
  });

  it("!res.ok counts as failure and the catch raises the failed flag", () => {
    expect(history).toContain('if (!res.ok) throw new Error("history load failed");');
    expect(history).toContain("setLoadFailed(true)");
    expect(history).not.toContain("degrades silently");
  });

  it("failure with nothing loaded renders the slim error row with retry", () => {
    expect(history).toContain('data-testid="subscription-history-load-error"');
    expect(history).toContain("loadFailed && (!rows || rows.length === 0)");
    expect(history).toContain('t("subscriptionHistory.loadError")');
    expect(history).toContain("onClick={() => void load()}");
  });

  it("a failed reload keeps loaded receipts and banners the error above them", () => {
    expect(history).toContain('data-testid="subscription-history-reload-error"');
    expect(history).not.toMatch(/catch \{[^}]*setRows\(\[\]\)/);
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the first load renders a pending row", () => {
    expect(history).toContain('data-testid="subscription-history-loading"');
    expect(history).toContain('t("subscriptionHistory.loading")');
  });

  it("nothing renders only for signed-out or a confirmed-empty 200", () => {
    expect(history).toContain("if (!user) return null;");
    expect(history).toContain("if (rows.length === 0) return null;");
    /* the confirmed-empty return sits after the error and loading branches */
    const errAt = history.indexOf('data-testid="subscription-history-load-error"');
    const loadAt = history.indexOf('data-testid="subscription-history-loading"');
    const emptyAt = history.indexOf("if (rows.length === 0) return null;");
    expect(errAt).toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(errAt);
    expect(emptyAt).toBeGreaterThan(loadAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the subscriptionHistory honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["subscriptionHistory.loading", "subscriptionHistory.loadError", "subscriptionHistory.retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
