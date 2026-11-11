/**
 * CommunityGrantsAdmin — honest load standard (deep-pins
 * tranche 5). The load parses through a strict reader: a
 * non-ok response OR an unparseable body both land on
 * loadError — never on the empty board. Render order is
 * loading → loadError card (title + body + a "Try again"
 * that bumps retryNonce, re-running the load) → the honest
 * admin.grants.empty line → the rounds. Actions speak only
 * after res.ok: open/save report success inside the ok
 * branch, and settle reads the server's outcome and names
 * it exactly (paid / tie / no candidates / already settled /
 * failed) behind a two-step confirm that states the tie
 * rule before any money moves.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CommunityGrantsAdmin.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the load — unparseable is failed, never empty", () => {
  it("non-ok short-circuits the parse to null; null and throws both set loadError; success alone sets the read", () => {
    const body = slice(src, "const load = useCallback(async () => {", "useEffect(() => { void load(); }, [load, retryNonce]);");
    expect(body).toContain("const parsed = res.ok ? parseGrantsAdmin(await res.json()) : null;");
    expect(body).toContain("if (parsed) {");
    expect(body).toContain("setRead(parsed);");
    expect(body).toContain("setLoadError(true);");
    const elsePart = slice(body, "} else {", "} catch {");
    expect(elsePart).toContain("setLoadError(true);");
    expect(elsePart).not.toContain("setRead");
    const catchPart = slice(body, "} catch {", "} finally {");
    expect(catchPart).toContain("setLoadError(true);");
    expect(catchPart).not.toContain("setRead");
    expect(src).toContain("useEffect(() => { void load(); }, [load, retryNonce]);");
  });

  it("render order: loading → loadError + Try again → honest empty → the rounds", () => {
    const body = slice(src, "{loading ? (", "{surfaces.map((surface) => {");
    expect(body).toContain(") : loadError ? (");
    expect(body).toContain('{t("admin.grants.loadErrorTitle")}');
    expect(body).toContain('{t("admin.grants.loadErrorBody")}');
    expect(body).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(body).toContain(") : surfaces.length === 0 ? (");
    expect(body).toContain('{t("admin.grants.empty")}');
    expect(body.indexOf("{loading ? (")).toBeLessThan(body.indexOf(") : loadError ? ("));
    expect(body.indexOf(") : loadError ? (")).toBeLessThan(body.indexOf(") : surfaces.length === 0 ? ("));
  });
});

describe("the actions — outcomes named from the server, after ok", () => {
  it("settle names the server's outcome exactly, inside the res.ok branch", () => {
    const body = slice(src, "const settle = async (surface: GrantRoundSurfaceRow) => {", "setBusy(null);");
    expect(body).toContain("if (res.ok) {");
    expect(body).toContain('msg = t("admin.grants.settlePaid", {');
    expect(body).toContain('msg = t("admin.grants.settleTie");');
    expect(body).toContain('msg = t("admin.grants.settleNoCandidates");');
    expect(body).toContain('msg = t("admin.grants.settleAlready");');
    expect(body).toContain('msg = t("admin.grants.settleFailed");');
    expect(body.indexOf("if (res.ok) {")).toBeLessThan(body.indexOf('msg = t("admin.grants.settlePaid", {'));
    expect(src).toContain("const [settleConfirmFor, setSettleConfirmFor] = useState<string | null>(null);");
  });
});
