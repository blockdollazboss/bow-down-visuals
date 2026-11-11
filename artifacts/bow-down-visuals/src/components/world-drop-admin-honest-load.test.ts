/**
 * WorldDropAdmin (the admin World drop slate) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE SLATE LOAD is a four-state chain: loading line, then
 *   the load-error state (retryNonce re-runs the real
 *   loader), then the genuine empty state, then the rows.
 *   The loader throws on non-ok AND on an unparseable payload
 *   (parseUpcomingDrops returning null) — a shape failure is
 *   a load failure, never an empty slate.
 * - THE BOOK AND CANCEL actions narrate from their checked
 *   responses: booking errors resolve through
 *   dropBookingError into the form error line, the booked
 *   notice lands only on an ok response, and a failed cancel
 *   says cancelFailed instead of removing anything or
 *   claiming the drop is gone. Both reload the slate after a
 *   proven change.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./WorldDropAdmin.tsx");

describe("the slate load: loading, error, empty, rows — in that order", () => {
  it("non-ok and unparseable payloads both throw into the load-error state", () => {
    expect(src).toContain('if (!res.ok) throw new Error("slate");');
    expect(src).toContain('if (parsed === null) throw new Error("slate payload");');
    expect(src).toContain("setLoadError(true);");
    expect(src).toContain("setDrops(parsed);");
  });

  it("the render chain is loading → error → genuine empty → rows", () => {
    const loadingIdx = src.indexOf("{loading ? (");
    const errorIdx = src.indexOf(") : loadError ? (");
    const emptyIdx = src.indexOf(") : drops && drops.length === 0 ? (");
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(loadingIdx);
    expect(emptyIdx).toBeGreaterThan(errorIdx);
  });
});

describe("book and cancel narrate from their checked responses", () => {
  it("the booked notice lands only on ok; failures land on the form error", () => {
    expect(src).toContain("const resolved = dropBookingError(res.status, data);");
    expect(src).toContain('setNotice(\n        t("admin.worldDrops.booked"');
    expect(src).toContain('setFormError(t("admin.worldDrops.errors.failed"));');
  });

  it("a failed cancel claims nothing and keeps the slate", () => {
    expect(src).toContain('setFormError(t("admin.worldDrops.cancelFailed"));');
    expect(src).toContain('setNotice(t("admin.worldDrops.cancelled", { title: drop.title }));');
  });
});
