/**
 * RemixChain — honest load standard (deep-pins tranche 5).
 * PINNED POST-FIX. THE FIX (this tranche): the chain load's
 * failures used to land in the shared verb-error state while
 * the render chain ran loading → empty-copy → list, so a
 * failed first load painted "No versions yet" copy. The load
 * now owns a loadError state, set only by load(), and the
 * render order is loading → loadError + Retry → empty →
 * list; verb errors (create / promote / remove) keep the
 * bottom error box and never touch loadError. The verbs
 * themselves were already honest: every one throws on !ok
 * before setVersions can run, so a failed write never
 * repaints the chain.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./RemixChain.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("THE FIX — the chain load fails honestly", () => {
  it("load() writes loadError (never the verb error), and clears it only on a checked success", () => {
    expect(src).toContain("const [loadError, setLoadError] = useState<string | null>(null);");
    const body = slice(src, "async function load() {", "async function createVersion(");
    expect(body).toContain("setLoading(true);");
    expect(body).toContain("setLoadError(null);");
    expect(body).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, t(\"wave9.remix.errorGeneric\")));");
    expect(body).toContain("setVersions(data.versions ?? []);");
    expect(body).toContain("setLoadError(plainErrorText(err, t(\"wave9.remix.errorGeneric\")));");
    expect(body).not.toContain("setError(");
    expect(body.indexOf("if (!res.ok) throw new Error(")).toBeLessThan(body.indexOf("setVersions(data.versions ?? []);"));
    // success clears the failure AFTER the list lands
    expect(body.indexOf("setVersions(data.versions ?? []);")).toBeLessThan(
      body.lastIndexOf("setLoadError(null);"),
    );
  });

  it("render order: loading → loadError + Retry → honest empty → the chain", () => {
    const body = slice(src, "{loading ? (", "{error && (");
    expect(body).toContain('{t("wave9.remix.loading")}');
    expect(body).toContain(") : loadError && versions.length === 0 ? (");
    expect(body).toContain("onClick={() => void load()}");
    expect(body).toContain('{t("common.retry")}');
    expect(body).toContain(") : versions.length === 0 ? (");
    expect(body).toContain('{t("wave9.remix.empty")}');
    expect(body.indexOf("{loading ? (")).toBeLessThan(body.indexOf(") : loadError && versions.length === 0 ? ("));
    expect(body.indexOf(") : loadError && versions.length === 0 ? (")).toBeLessThan(
      body.indexOf(") : versions.length === 0 ? ("),
    );
    expect(body.indexOf(") : versions.length === 0 ? (")).toBeLessThan(body.indexOf('{t("wave9.remix.empty")}'));
  });

  it("the loader only runs while the chain is empty, so a verb's append is never re-fetched over", () => {
    const body = slice(src, "useEffect(() => {", "/* Consume a structure handoff");
    expect(body).toContain("if (open && versions.length === 0 && !loading) void load();");
  });
});

describe("the verbs — no success repaint after an unchecked write", () => {
  it("create / promote / remove each gate on the checked response before setVersions", () => {
    const create = slice(src, "async function createVersion() {", "async function promote(");
    expect(create).toContain("if (!res.ok || !data.version) throw new Error(apiErrorMessage(data, t(\"wave9.remix.errorGeneric\")));");
    expect(create).toContain("setVersions((vs) => [...vs, data.version!]);");
    expect(create.indexOf("if (!res.ok || !data.version) throw new Error(")).toBeLessThan(
      create.indexOf("setVersions((vs) => [...vs, data.version!]);"),
    );
    const promote = slice(src, "async function promote(", "async function remove(");
    expect(promote).toContain("if (!res.ok || !data.version) throw new Error(apiErrorMessage(data, t(\"wave9.remix.errorGeneric\")));");
    expect(promote.indexOf("if (!res.ok || !data.version) throw new Error(")).toBeLessThan(
      promote.indexOf("setVersions((vs) => vs.map((v) => (v.id === id ? data.version! : { ...v, promoted: false })));"),
    );
    const remove = slice(src, "async function remove(", "const promoteTarget =");
    expect(remove).toContain("if (!res.ok) {");
    expect(remove).toContain("setVersions((vs) => vs.filter((v) => v.id !== id));");
    expect(remove.indexOf("if (!res.ok) {")).toBeLessThan(
      remove.indexOf("setVersions((vs) => vs.filter((v) => v.id !== id));"),
    );
    // verb failures land in the shared bottom box, not in loadError
    expect(create).toContain("setError(plainErrorText(err, t(\"wave9.remix.errorGeneric\")));");
    expect(create).not.toContain("setLoadError");
  });
});
