/**
 * MoneyTrackerPanel — honest load standard (deep-pins tranche 3,
 * batch 8). The entries load carries its own states: signed-out is
 * its own prompt before any fetch; the loader throws the server's
 * words on non-ok and lands failures in the page error line while
 * loading settles in finally — an empty month can only be read
 * from loaded entries. The release-options read next to it is a
 * picker enhancement (its options feed only the link-release
 * picker; options simply stay at their default when the read
 * slips), pinned as such. Writes are checked before local state
 * moves: save prepends ONLY an ok answer carrying the entry (form
 * errors stay in the form); delete removes the row ONLY after an ok
 * DELETE (a failed delete keeps the row and lands in the error
 * line); link-release replaces the row ONLY with the server's
 * returned entry, and clears the linking state in both branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./MoneyTrackerPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the entries load — failed, loading and empty never conflate", () => {
  it("signed-out is its own state; non-ok throws into the error line; loading settles in finally", () => {
    const body = slice(src, "async function loadEntries() {", "useEffect(() => {\n    loadEntries();");
    expect(body).toContain("if (!user) {");
    expect(body).toContain("setEntries([]);");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("moneyTracker.errorLoad")));');
    expect(body).toContain('setError(plainErrorText(err, t("moneyTracker.errorLoad")));');
    expect(body).toContain("setLoading(false);\n    }\n  }");
    expect(src).toContain("fetchReleaseOptions(confirmedFetch).then(setReleaseOptions).catch(() => {});");
  });
});

describe("writes — local state moves only on the server's answer", () => {
  it("save prepends only a parsed entry; delete and link apply only after ok", () => {
    const save = slice(src, "async function handleSave() {", "async function handleDelete(id: string) {");
    expect(save).toContain('if (!res.ok || !data.entry) throw new Error(apiErrorMessage(data, t("moneyTracker.errorSave")));');
    expect(save.indexOf("setEntries((prev) => [data.entry!, ...prev]);")).toBeGreaterThan(
      save.indexOf("if (!res.ok || !data.entry) throw"),
    );
    const del = slice(src, "async function handleDelete(id: string) {", "function shiftMonth(delta: number) {");
    expect(del).toContain("if (!res.ok) {");
    expect(del.indexOf("setEntries((prev) => prev.filter((e) => e.id !== id));")).toBeGreaterThan(del.indexOf("if (!res.ok) {"));
    const link = slice(src, "async function linkEntry(entryId: string, releaseId: string | null) {", "function releaseTitle(");
    expect(link).toContain("if (!res.ok || !data.entry) throw new Error(apiErrorMessage(data, \"Couldn't link the release.\"));");
    expect(link.indexOf("setEntries((prev) => prev.map((e) => (e.id === entryId ? data.entry! : e)));")).toBeGreaterThan(
      link.indexOf("if (!res.ok || !data.entry) throw"),
    );
  });
});
