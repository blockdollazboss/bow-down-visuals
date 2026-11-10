/**
 * HubProjectsSection — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The section lists the signed-in
 * creator's hub projects (GET /api/hub/projects) on the projects
 * surface. Its loader throws on a non-ok response and records the
 * error state in its catch; the render order is spinner → error
 * panel with a retry wired to the real load → the genuine-empty
 * line → the rows, so a failed load can never read as "no projects
 * yet". Row-level open/delete failures surface as their own alert
 * lines above the loaded list, never by silently dropping the row
 * or the section.
 *
 * Copy rides i18n keys, so the pin asserts the keys and carries the
 * catalog block. The FE suite runs in node (no DOM), so — like the
 * sibling honest-load pins — these tests pin the machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const section = read("./HubProjectsSection.tsx");
const loadAt = section.indexOf("const load = useCallback(async () => {");
const loader = section.slice(loadAt, section.indexOf("useEffect(() => {", loadAt));

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

describe("failure path — a failed projects load never reads as an empty list", () => {
  it("the state machine starts loading with no error", () => {
    expect(section).toContain("const [loading, setLoading] = useState(true);");
    expect(section).toContain("const [loadError, setLoadError] = useState<string | null>(null);");
  });

  it("the loader throws on a non-ok response", () => {
    expect(loader).toContain('const res = await fetch("/api/hub/projects", {');
    expect(loader).toContain('if (!res.ok) throw new Error(t("myProjects.failedLoadHubProjects"));');
  });

  it("the catch records the error state and the finally clears loading", () => {
    expect(loader).toContain("setLoadError(plainErrorText(err, t(\"myProjects.failedLoadHubProjects\")));");
    expect(loader).toContain("setLoading(false);");
  });

  it("failure renders the error with a retry wired to the real load", () => {
    expect(section).toContain('<p className="text-red-400 font-semibold">{loadError}</p>');
    expect(section).toContain("onClick={() => void load()}");
    expect(section).toContain('t("myProjects.tryAgain")');
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("render order is loading → error → genuine empty → rows", () => {
    const loadingAt = section.indexOf("{loading ? (");
    const errorAt = section.indexOf(") : loadError ? (");
    const emptyAt = section.indexOf(") : rows.length === 0 ? (");
    const rowsAt = section.indexOf("{rows.map((row, index) => {");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(rowsAt).toBeGreaterThan(emptyAt);
  });

  it("the empty line renders only in the post-error empty branch", () => {
    expect(section).toContain('t("myProjects.noHubProjects")');
  });

  it("row action failures surface as alerts above the loaded list, not as a lost section", () => {
    expect(section).toContain("{deleteError && (");
    expect(section).toContain("{openError && (");
    expect(section).toContain('t("myProjects.failedDeleteHubProject")');
    expect(section).toContain('t("myProjects.failedOpenHubProject")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the hub-projects honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of [
      "myProjects.failedLoadHubProjects",
      "myProjects.tryAgain",
      "myProjects.noHubProjects",
    ]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
