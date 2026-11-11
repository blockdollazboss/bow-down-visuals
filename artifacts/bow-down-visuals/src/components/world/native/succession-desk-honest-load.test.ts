/**
 * SuccessionDesk (the World legacy/succession desk) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 2). A surface where a fake load would be cruel —
 * this is the member's heir designation — and it is built
 * accordingly:
 *
 * - THE DESIGNATION: a non-ok read throws, and a payload that
 *   parses to null throws too — both land on stateFailed. The
 *   current designation (and the form's heir/instructions
 *   seeding) records only from the proven payload; a failed
 *   read can never paint "no designation" over one that
 *   exists. The inbox leg rides after, recording only on ok.
 * - THE EMERGENCY CONTACT: contactFailed on any failure, and
 *   contactLoaded set on BOTH outcomes — the panel leaves its
 *   loading state for the failure state rather than spinning,
 *   and the form seeds only from a proven contact.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./SuccessionDesk.tsx");

describe("the designation: failure never paints 'none' over a real one", () => {
  it("non-ok and unparseable both throw into stateFailed before recording", () => {
    expect(desk).toContain('if (!res.ok) throw new Error("designation");');
    expect(desk).toContain("const parsed = parseLegacyDesignationState(await res.json());");
    expect(desk).toContain('if (!parsed) throw new Error("designation");');
    expect(desk).toContain("setState(parsed);");
    expect(desk).toContain("setStateFailed(false);");
    expect(desk).toContain("} catch { setStateFailed(true); }");
    expect(desk.indexOf("if (!parsed) throw")).toBeLessThan(desk.indexOf("setState(parsed);"));
  });

  it("the inbox records only on ok, after the proven designation", () => {
    expect(desk).toContain("if (inboxRes.ok) setInbox(parseLegacyInbox(await inboxRes.json()));");
  });
});

describe("the contact: loaded resolves on both outcomes, failed tells them apart", () => {
  it("success seeds the form; failure sets the flag — both set loaded", () => {
    expect(desk).toContain('if (!res.ok) throw new Error("contact");');
    expect(desk).toContain("setContactFailed(false);");
    expect(desk).toContain("setContactLoaded(true);");
    expect(desk).toContain("} catch { setContactFailed(true); setContactLoaded(true); }");
  });
});
