/**
 * MysteryCrate — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The floating crate chip loads
 * GET /api/bonus/status through a helper that throws on any non-ok
 * response; a throw lands on loadError, and so does a payload whose
 * wheel half never arrived (degraded === "crates") — the crate's
 * honest state is its load-failure panel with a retry wired to the
 * real loadStatus, never an endless spinner or a fake ready crate.
 * The dialog's action button becomes the retry while loadError
 * stands. (Profile-side degradation leaves the crate whole by
 * design: only the bonus note and balance line stay hidden.)
 *
 * Copy is hardcoded English literals, pinned as literals. The FE
 * suite runs in node (no DOM), so — like the sibling honest-load
 * pins — these tests pin the state machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const crate = read("./MysteryCrate.tsx");

describe("failure path — a failed status load is the failure panel, not a spinner", () => {
  it("the shared api helper throws on a non-ok response", () => {
    expect(crate).toContain("if (!res.ok) throw new Error(`Request failed: ${res.status} ${path}`);");
  });

  it("a thrown status load sets the error state", () => {
    expect(crate).toContain("const [loadError, setLoadError] = useState(false);");
    expect(crate).toContain("} catch {\n      setLoadError(true);\n    }");
  });

  it("a crates-degraded payload is the same honest failure, at the source", () => {
    expect(crate).toContain('setLoadError(s.degraded === "crates");');
  });

  it("the cooldown is coerced at the source so a partial payload never renders NaN", () => {
    expect(crate).toContain("setCooldown(coerceCooldownSeconds(s.wheelCooldownSeconds));");
  });
});

describe("the failure renders — in the chip and in the dialog", () => {
  it("the chip renders its error face while loadError stands", () => {
    expect(crate).toContain(") : loadError ? (");
  });

  it("the dialog action becomes a retry wired to the real load while loadError stands", () => {
    expect(crate).toContain("onClick={loadError ? () => { void loadStatus(); } : handleOpen}");
    expect(crate).toContain("disabled={loadError ? false : !ready}");
  });

  it("the periodic refresh re-runs the same honest load", () => {
    expect(crate).toContain("const t = setInterval(loadStatus, 60_000);");
  });
});
