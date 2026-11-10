/**
 * WorldNotificationsBell — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 1). The World shell's
 * inbox bell loads the member's notifications on a poll and renders
 * a three-way panel whose ORDER is the contract: the failure line
 * first, the genuine empty line second, the rows last — so a failed
 * load can never render as "All quiet in the palace."
 *
 * - The load records its error flag on a non-ok response AND on a
 *   network throw; a successful load clears it and records the
 *   items + unread count from the normalized payload.
 * - The panel's failure copy carries a working recovery path (tap
 *   the bell again — opening the panel re-runs the load) and says
 *   plainly that nothing is lost.
 * - Mark-read is optimistic with a documented recovery: a failed
 *   mark-read POST is swallowed because the next poll re-reads the
 *   truth from the rail — the server record, not the local paint,
 *   is authoritative.
 *
 * Copy is literal on this World surface. The FE suite runs in node
 * (no DOM), so these tests pin the machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bell = read("./WorldNotificationsBell.tsx");

describe("the bell load records failure on both failure paths", () => {
  it("items start empty with the error flag down", () => {
    expect(bell).toContain("const [items, setItems] = useState<WorldNotification[]>([]);");
    expect(bell).toContain("const [loadError, setLoadError] = useState(false);");
  });

  it("a non-ok response sets the error flag and returns before recording items", () => {
    expect(bell).toContain("if (!r.ok) { setLoadError(true); return; }");
  });

  it("a network throw sets the same flag", () => {
    expect(bell).toContain("} catch {\n      setLoadError(true);\n    }");
  });

  it("success clears the flag and records items + unread from the payload", () => {
    expect(bell).toContain("setLoadError(false);\n      setItems(parsed.items);\n      setUnread(parsed.unread);");
  });
});

describe("panel render order: failure, then genuine empty, then rows", () => {
  it("the three branches appear in contract order", () => {
    const errIdx = bell.indexOf('data-testid="world-notifications-error"');
    const emptyIdx = bell.indexOf('data-testid="world-notifications-empty"');
    const rowsIdx = bell.indexOf("items.map((item) => {");
    expect(errIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeGreaterThan(errIdx);
    expect(rowsIdx).toBeGreaterThan(emptyIdx);
  });

  it("the failure copy names the retry and that nothing is lost", () => {
    expect(bell).toContain("Your inbox wouldn't open just now — tap the bell again to retry. Nothing is lost; it lives on the same rail as the website bell.");
  });

  it("opening the panel re-runs the load (the retry is real)", () => {
    expect(bell).toContain("onClick={() => { setOpen((o) => !o); if (!open) void load(); }}");
  });

  it("the empty copy speaks only about what will land here", () => {
    expect(bell).toContain("All quiet in the palace. Follows, tips, group news and message requests will land here.");
  });
});

describe("mark-read failure recovers from the rail, by documented design", () => {
  it("the mark-read catch carries the re-read note", () => {
    expect(bell).toContain("/* the next poll re-reads the truth from the rail */");
  });
});
