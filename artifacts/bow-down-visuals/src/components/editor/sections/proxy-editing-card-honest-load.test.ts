/**
 * ProxyEditingCard — honest load standard (deep-pins tranche 4,
 * batch B). No price anywhere: proxies are free editor tooling.
 * The load is the server truth for both the enabled flag and the
 * rows — a non-ok answer returns early and a throw leaves the
 * panel on originals (its own comment: the safe default), which
 * the per-clip badge states outright ("Viewing: Original —
 * full-res" via previewUrlFor) rather than dressing a failure as
 * a proxy state. The card prints the export honesty line on its
 * face. The progress poll exists only while a row is pending or
 * generating and its cleanup clears the interval, so it stops
 * the moment the reload shows a terminal row. Requesting a
 * proxy claims nothing itself: a null response and a throw land
 * in the still-editing-from-the-original note, a not_heavy
 * outcome is the plain refusal note, a non-ok is its own note,
 * and the visible status afterwards comes only from reloading
 * the server rows. The toggle flips locally first, then
 * reloads — load() is the arbiter that restores the server
 * truth. The empty state is local and honest: no clips on the
 * timeline yet.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ProxyEditingCard.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("load — server truth or the stated safe default", () => {
  it("enabled and rows land only from an ok answer; failure stays on originals", () => {
    const body = slice(src, "const load = useCallback(async () => {", "useEffect(() => { void load(); }, [load]);");
    expect(body).toContain("if (!res || !res.ok) return;");
    expect(body.indexOf("setEnabled(data.enabled);")).toBeGreaterThan(body.indexOf("if (!res || !res.ok) return;"));
    expect(body).toContain("setRows(data.proxies ?? []);");
    expect(body).toContain("catch { /* panel stays on originals — the safe default */ }");
    expect(src).toContain("{EXPORT_HONESTY_LINE}");
    expect(src).toContain("const preview = previewUrlFor(url, row, enabled);");
    expect(src).toContain("{preview.badge}");
    expect(src).toContain("proxyStatusLabel(row)");
  });

  it("the poll runs only while a row is in flight and clears on cleanup", () => {
    expect(src).toContain('if (!rows.some((r) => r.status === "pending" || r.status === "generating")) return;');
    expect(src).toContain("const id = window.setInterval(() => { void load(); }, 3000);");
    expect(src).toContain("return () => window.clearInterval(id);");
  });
});

describe("request + toggle — no claim without the server reload", () => {
  it("request: null / not_heavy / non-ok are notes; the status comes from the reload that follows", () => {
    const body = slice(src, "const requestProxy = async (url: string) => {", "const toggle = async () => {");
    expect(body).toContain('if (!res) { setNote("Could not request a proxy. You are still editing from the original."); return; }');
    expect(body).toContain('if (data.outcome === "not_heavy") setNote(apiErrorMessage(data, "This clip is light enough to edit from the original — no proxy needed."));');
    expect(body).toContain('else if (!res.ok) setNote(apiErrorMessage(data, "Proxy editing is off for this account."));');
    expect(body.indexOf("await load();")).toBeGreaterThan(body.indexOf("else if (!res.ok) setNote"));
    expect(body).toContain('setNote("Could not request a proxy. You are still editing from the original.");');
  });

  it("toggle flips locally, writes, then reloads the server truth", () => {
    const body = slice(src, "const toggle = async () => {", "const clipUrls =");
    expect(body).toContain("setEnabled(next);");
    expect(body.indexOf("setEnabled(next);")).toBeLessThan(body.indexOf('"/api/proxy-editing/prefs"'));
    expect(body).toContain("/* load() on next poll restores the server truth */");
    expect(body.indexOf("void load();")).toBeGreaterThan(body.indexOf('"/api/proxy-editing/prefs"'));
  });

  it("the empty state is the local no-clips line, not a load result", () => {
    expect(src).toContain("clipUrls.length === 0 && <p className=\"text-xs opacity-70\">Add a clip to the timeline and it will show up here.</p>");
  });
});
