/**
 * ShareForReview + ReviewFeedbackBadge — honest load states
 * (Stack-400 C-28 components residual, deep-pins tranche 1). Two
 * exports serving the editor's client-review flow:
 *
 * - ShareForReview is an ACTION panel: creating a review link is a
 *   POST that throws on a non-ok response and surfaces the failure
 *   as a destructive toast carrying the server's message; the
 *   created URL is recorded only on success, so a failed create can
 *   never present a link that does not exist.
 * - ReviewFeedbackBadge is QUIET-BY-DESIGN: it loads the creator's
 *   review links for one video (GET /api/review-links/mine) into a
 *   null-starting state and renders NOTHING until a successful load
 *   brought at least one link — a non-ok response returns early and
 *   a network failure is swallowed to the same absence. The badge
 *   never prints "no feedback" copy: absence means "nothing to show
 *   you", and its failure mode is identical to its genuine-empty
 *   mode by documented design ("feedback badge is non-critical").
 *   Its actions (mark-seen, regenerate-and-copy) surface failures
 *   honestly too — regenerate throws on non-ok into a failure toast.
 *
 * Copy rides i18n keys; the pin carries the catalog block for the
 * two failure keys. The FE suite runs in node (no DOM), so these
 * tests pin the machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const share = read("./ShareForReview.tsx");

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

describe("the create action never presents a link that does not exist", () => {
  it("the create POST throws on a non-ok response", () => {
    expect(share).toContain('const res = await fetch("/api/review-links", {');
    expect(share).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("review.createFailed")));');
  });

  it("the created URL is recorded only on success, and failure toasts destructively", () => {
    expect(share).toContain("setCreatedUrl(`${window.location.origin}${data.url}`);");
    expect(share).toContain('toast({ title: t("review.createFailed"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });');
  });
});

describe("the feedback badge is quiet-by-design", () => {
  it("links start null — not loaded is a distinct state from loaded-empty", () => {
    expect(share).toContain("const [links, setLinks] = useState<ReviewLinkSummary[] | null>(null);");
  });

  it("a non-ok response returns early without recording links", () => {
    expect(share).toContain("if (!res.ok) return;");
    expect(share).toContain("if (!cancelled) setLinks(data.links ?? []);");
  });

  it("a network failure is swallowed to the same absence, under the file's own note", () => {
    expect(share).toContain("} catch { /* feedback badge is non-critical */ }");
  });

  it("the badge renders only when a successful load brought at least one link", () => {
    expect(share).toContain("if (!links || links.length === 0) return null;");
  });

  it("the regenerate action throws on a non-ok response into a failure toast", () => {
    expect(share).toContain('if (!res.ok || !data.url) throw new Error(apiErrorMessage(data, t("review.notifyFailed")));');
    expect(share).toContain('toast({ title: t("review.notifyFailed"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the review honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["review.createFailed", "review.notifyFailed"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
