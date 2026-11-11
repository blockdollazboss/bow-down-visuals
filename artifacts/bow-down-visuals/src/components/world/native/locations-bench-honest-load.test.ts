/**
 * LocationsBench — honest load standard (deep-pins tranche 4,
 * batch D). The collection load is the textbook ordering: a
 * non-ok read throws, and an ok read the seam's parser returns
 * null for throws too — both land loadFailed, whose render
 * branch (error state + retry) stands BEFORE the loading
 * branch (locations still null), which stands before the
 * honestly-empty branch, so the page's "No locations yet" line
 * appears only after a successful empty load and a failure
 * never renders as an empty gallery. The writes are free
 * rails held to the same rule: add-by-URL and upload validate
 * before the trip (bad body / oversize / name-first are their
 * own error lines), throw on non-ok before anything clears,
 * and reload the list from the rail after a proven save;
 * delete removes the row locally ONLY after the rail's ok —
 * a failed delete leaves the row standing and lands its error.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LocationsBench.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the load: failed, loading, empty, loaded — in that order", () => {
  const load = slice(src, "const load = useCallback", "useEffect(() => {\n    void load();");

  it("non-ok throws; a null parse throws; the list records only after both guards", () => {
    expect(load).toContain('if (!res.ok) throw new Error("load");');
    expect(load).toContain("const parsed = locationsOf(await res.json().catch(() => null));");
    expect(load).toContain('if (parsed === null) throw new Error("load");');
    expect(load.indexOf("setLocations(parsed);")).toBeGreaterThan(load.indexOf('if (parsed === null) throw new Error("load");'));
    expect(load).toContain("setLoadFailed(true);");
  });

  it("the render orders the error branch before loading before empty before the gallery", () => {
    expect(src.indexOf("{loadFailed ? (")).toBeLessThan(src.indexOf("locations === null ? ("));
    expect(src.indexOf("locations === null ? (")).toBeLessThan(src.indexOf("locations.length === 0 ? ("));
    expect(src.indexOf("locations.length === 0 ? (")).toBeLessThan(src.indexOf('data-testid="world-locations-bench-gallery"'));
    expect(src).toContain('message={t("locations.errLoad")}');
    expect(src).toContain("onRetry={() => setReloadNonce((n) => n + 1)}");
    expect(src).toContain('message={t("locations.noLocations")}');
  });
});

describe("the writes: success is claimed only after the rail's ok", () => {
  it("add-by-URL validates first, throws on non-ok, and reloads after a proven save", () => {
    const add = slice(src, "async function handleAddByUrl() {", "async function handleUpload(file: File) {");
    expect(add).toContain("if (!body) {");
    expect(add).toContain('setError(t("locations.errNameUrl"));');
    expect(add).toContain('if (!res.ok) throw new Error("save");');
    expect(add.indexOf("await load();")).toBeGreaterThan(add.indexOf('if (!res.ok) throw new Error("save");'));
    expect(add).toContain('setError(t("locations.errSave"));');
  });

  it("upload refuses oversize and name-first before the trip, and throws on non-ok", () => {
    const up = slice(src, "async function handleUpload(file: File) {", "async function handleDelete(id: string) {");
    expect(up).toContain('if (problem === "too-large") {');
    expect(up).toContain('setError(t("locations.errImageTooLarge"));');
    expect(up).toContain('if (problem === "name-first") {');
    expect(up).toContain('setError(t("locations.errNameFirst"));');
    expect(up.indexOf('if (problem === "too-large") {')).toBeLessThan(up.indexOf("fetch(LOCATIONS_UPLOAD_PATH"));
    expect(up).toContain('if (!res.ok) throw new Error("upload");');
    expect(up).toContain('setError(t("locations.errUpload"));');
  });

  it("delete removes the row only after the rail's ok; failure leaves it standing", () => {
    const del = slice(src, "async function handleDelete(id: string) {", "const muted =");
    expect(del).toContain('if (!res.ok) throw new Error("delete");');
    expect(del.indexOf("prev.filter((l) => l.id !== id)")).toBeGreaterThan(del.indexOf('if (!res.ok) throw new Error("delete");'));
    expect(del).toContain('setError(t("locations.errDelete"));');
  });
});
