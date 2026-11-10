/**
 * StationPanel (Treasury sections) — honest load states (Stack-400
 * C-28 components residual, deep-pins tranche 1). The World shell's
 * station panel hosts the Treasury's bonus surfaces; their render
 * isolation carries its own suite (station-panel-isolation.test.ts).
 * This pin covers the DATA honesty of the two Treasury load
 * families:
 *
 * - THE VAULT LEDGER (daily drop + streak): the status load throws
 *   on a non-ok response AND on a degraded-profile payload — a
 *   server answer that says its own profile read degraded is
 *   treated as failure, never painted as the member's streak. The
 *   render runs failure line, then the opening line, then the real
 *   figures; the claim action narrates every outcome truthfully
 *   (claimed with the granted amount, already-claimed, or "didn't
 *   land — the chest is untouched").
 * - THE HOURLY CRATE + SHARK DROP: the drop rides an explicit
 *   loading/ready/failed state machine — non-ok or thrown loads
 *   land on failed, whose copy says the rail wouldn't answer and
 *   the drops are safe; "No drop waiting right now" is reachable
 *   only behind ready. The crate status records only on ok (its
 *   claim button exists only when availability is proven). Both
 *   claim actions narrate failure as failure.
 *
 * Copy is literal on this World surface. The FE suite runs in node
 * (no DOM), so these tests pin the machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panel = read("./StationPanel.tsx");

describe("the vault ledger never paints a degraded read as the member's streak", () => {
  it("the status load throws on a non-ok response", () => {
    expect(panel).toContain('const res = await fetch("/api/bonus/status", { headers: await authHeaders() });');
    expect(panel).toContain('if (!res.ok) throw new Error("status");');
  });

  it("a degraded-profile payload is treated as failure, not data", () => {
    expect(panel).toContain('if (s.degraded === "profile" || typeof s.streak !== "number") throw new Error("status");');
  });

  it("success records the status and clears the failure flag; failure sets it", () => {
    expect(panel).toContain("setStatus(s);\n      setFailed(false);");
    expect(panel).toContain("} catch {\n      setFailed(true);\n    }");
  });

  it("render order: failure line, then the opening line, then the figures", () => {
    const failIdx = panel.indexOf("The vault ledger wouldn&rsquo;t open — your streak and drops are safe on the real rails.");
    const loadIdx = panel.indexOf("Opening the vault ledger…");
    const dataIdx = panel.indexOf("Claim today&rsquo;s drop");
    expect(failIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(failIdx);
    expect(dataIdx).toBeGreaterThan(loadIdx);
  });

  it("the daily claim narrates claimed, already-claimed, and didn't-land truthfully", () => {
    expect(panel).toContain("Today's drop is already claimed — the chest refills at midnight UTC.");
    expect(panel).toContain("The claim didn't land — the chest is untouched. Try again.");
  });
});

describe("the shark drop rides an explicit three-state machine", () => {
  it("the drop state starts at loading", () => {
    expect(panel).toContain('const [dropState, setDropState] = useState<"loading" | "ready" | "failed">("loading");');
  });

  it("an ok drop response lands on ready; non-ok and thrown loads land on failed", () => {
    expect(panel).toContain('setDropState("ready");');
    expect(panel).toContain('setDropState("failed");');
  });

  it("render order: loading, failed, drop present, genuine none", () => {
    const loadIdx = panel.indexOf("Listening for fins…");
    const failIdx = panel.indexOf("The drop rail wouldn&rsquo;t answer — your drops are safe; the King&rsquo;s dice roll on their own schedule.");
    const noneIdx = panel.indexOf("No drop waiting right now — shark drops land on their own tide, at most two a week.");
    expect(loadIdx).toBeGreaterThan(-1);
    expect(failIdx).toBeGreaterThan(loadIdx);
    expect(noneIdx).toBeGreaterThan(failIdx);
  });

  it("the crate records only on an ok response — its claim exists only on proven availability", () => {
    expect(panel).toContain("if (crateRes.ok) setCrate(");
    expect(panel).toContain("crate.available ? (");
  });

  it("both claim actions narrate failure as failure", () => {
    expect(panel).toContain("The crate didn't open — nothing was claimed. Try again.");
    expect(panel).toContain('setNote(apiErrorMessage(data, "The drop slipped away — it may have expired."));');
    expect(panel).toContain("The claim didn't land. Try again.");
  });
});
