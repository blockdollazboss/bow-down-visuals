/**
 * TrustPanels — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). Seven trust/settings panels (legacy
 * designation + inbox, legacy contact, distribution permanence,
 * catalog exports, earnings statement, content-ID claims, retention)
 * serving the settings and earnings surfaces. The file's own header
 * states the contract: "a failed load says so, an empty state says
 * it's empty — nothing is ever filled in with a plausible-looking
 * zero or curve."
 *
 * Every panel's load rides the shared api() helper, which throws on
 * a non-ok response; every panel records its failure in its own err
 * line — "Could not load your …" — rendered above the panel body, so
 * a failed load is always visible and never reads as recorded data.
 * The two list-bearing panels are stricter still: the legacy inbox
 * and the export jobs render only when non-empty (no empty copy
 * exists to fake), and the claims panel carries the full machine —
 * null state while loading, a loadFailed branch with copy and a
 * retry wired to the real load BEFORE its genuine-empty line.
 *
 * Copy is hardcoded English literals; no catalog block. The FE suite
 * runs in node (no DOM), so these tests pin the machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panels = read("./TrustPanels.tsx");

describe("the shared loader throws, and every panel says so on failure", () => {
  it("the api helper throws on a non-ok response", () => {
    expect(panels).toContain('if (!res.ok) throw new Error(apiErrorMessage(json, "Something went wrong."));');
  });

  it("each settings panel records its own named load failure", () => {
    expect(panels).toContain('setErr("Could not load your legacy settings.");');
    expect(panels).toContain('setErr("Could not load your legacy contact.");');
    expect(panels).toContain('setErr("Could not load your permanence settings.");');
    expect(panels).toContain('setErr("Could not load your exports.");');
    expect(panels).toContain('setErr(plainErrorText(e, "Could not load that statement."));');
    expect(panels).toContain('setErr(plainErrorText(e, "Could not load retention."));');
  });

  it("the error lines render above the panel bodies", () => {
    expect(panels.split("{err &&").length - 1).toBeGreaterThanOrEqual(6);
    expect(panels).toContain('{err && <p className="mt-2 text-sm text-destructive">{err}</p>}');
  });
});

describe("list-bearing panels never render a fake empty", () => {
  it("the legacy inbox renders only when a successful load brought rows", () => {
    expect(panels).toContain("setInbox(i.designations ?? []);");
    expect(panels).toContain("{inbox.length > 0 && (");
  });

  it("the export jobs list renders only when a successful load brought rows", () => {
    expect(panels).toContain("setJobs(j.jobs ?? []);");
    expect(panels).toContain("{jobs.length > 0 &&");
  });
});

describe("the claims panel carries the full machine", () => {
  it("claims start null with a separate failure flag; success clears it", () => {
    expect(panels).toContain("const [claims, setClaims] = useState<any[] | null>(null);");
    expect(panels).toContain("const [loadFailed, setLoadFailed] = useState(false);");
    expect(panels).toContain("setClaims(c.claims ?? []); setLoadFailed(false);");
    expect(panels).toContain("catch { setLoadFailed(true); }");
  });

  it("the panel renders nothing while the first load is in flight", () => {
    expect(panels).toContain("if (claims === null && !loadFailed) return null;");
  });

  it("the failure branch — copy plus a retry wired to the real load — precedes the empty line", () => {
    expect(panels).toContain("Couldn&apos;t load your matches &amp; claims.");
    expect(panels).toContain('onClick={() => void load()}>Retry</button>');
    const failAt = panels.indexOf("{loadFailed ? (");
    const emptyAt = panels.indexOf("No matches recorded yet.");
    expect(failAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(failAt);
  });
});
