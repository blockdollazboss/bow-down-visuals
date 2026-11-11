/**
 * PublishingSplitsPanel — honest load standard (deep-pins tranche 3,
 * batch 4). The songwriter-splits registry panel.
 *
 * The registry load renders in the house order — loading spinner,
 * then the error card (with a Try again wired to the real load),
 * then the honest empty ("No songs registered yet…") only on a
 * successful read with zero registrations, then the list. The
 * loader throws the server's words on non-ok before setData, so a
 * failed read can never reach the empty copy.
 *
 * The OPTIONS reads inside openForm are the documented degradation
 * family and pin as-is: the songs read is best-effort (its catch
 * comment: "the release list alone still lets the form work") — the
 * form's primary data is the registry itself, and the submit
 * validates the pick ("Pick the song these splits belong to") so a
 * missing options list can never become a silent wrong save.
 *
 * Writes pin as-is: register/amend validates the writer rows with
 * the seam's validator BEFORE the call, throws on non-ok, and only
 * closes the form + reloads on ok. Confirm/dispute and the split
 * sheet read follow the same rule — non-ok (or a sheet-less body)
 * throws into the panel's action-error line; nothing claims success
 * over a failed write.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PublishingSplitsPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("load — failed read is the error card, never the empty registry", () => {
  it("the loader throws the server's words on non-ok before setData", () => {
    const loader = slice(src, "async function load() {", "useEffect(() => {");
    expect(loader).toContain("if (!res.ok) throw new Error(apiErrorMessage(json,");
    expect(loader.indexOf("setData(json)")).toBeGreaterThan(loader.indexOf("if (!res.ok) throw"));
    expect(loader).toContain("setError(plainErrorText(err,");
    expect(loader).toContain("setLoading(false)");
  });

  it("render order is loading → error → empty → list, retry wired to the real loader", () => {
    const loadAt = src.indexOf("{loading ? (");
    const errAt = src.indexOf(") : error ? (");
    const emptyAt = src.indexOf("data.registrations.length === 0");
    const listAt = src.indexOf("data.registrations.map(");
    expect(loadAt).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(loadAt);
    expect(emptyAt).toBeGreaterThan(errAt);
    expect(listAt).toBeGreaterThan(emptyAt);
    expect(src).toContain("No songs registered yet.");
    const errBlock = src.slice(errAt, src.indexOf("data.registrations.length === 0", errAt));
    expect(errBlock).toContain("onClick={load}");
    expect(errBlock).toContain("Try again");
  });
});

describe("form options — the documented best-effort reads", () => {
  it("the songs options read is best-effort by design; the submit re-validates the pick", () => {
    const form = slice(src, "async function openForm(", "async function submitForm()");
    expect(form).toContain("if (releases.length === 0) setReleases(await fetchReleaseOptions(confirmedFetch));");
    expect(form).toContain('if (res && res.ok) {');
    expect(form).toContain("/* the release list alone still lets the form work */");
    const submit = slice(src, "async function submitForm() {", "async function act(");
    expect(submit).toContain('setFormError("Pick the song these splits belong to.")');
  });
});

describe("writes — validated first, checked before success", () => {
  it("register/amend: the seam validator runs before the call; non-ok throws; the form closes only on ok", () => {
    const submit = slice(src, "async function submitForm() {", "async function act(");
    expect(submit).toContain("writerSplitValidationError(");
    expect(submit.indexOf("const res = await confirmedFetch(path")).toBeGreaterThan(
      submit.indexOf("writerSplitValidationError("),
    );
    expect(submit).toContain("if (!res.ok) throw new Error(apiErrorMessage(json, \"Couldn't save the registration.\"));");
    expect(submit.indexOf("setShowForm(false)")).toBeGreaterThan(submit.indexOf("if (!res.ok) throw"));
    expect(submit).toContain("await load();");
  });

  it("confirm/dispute: non-ok throws into the action-error line; ok reloads", () => {
    const body = slice(src, "async function act(", "async function openSheet(");
    expect(body).toContain("if (!res.ok) throw new Error(");
    expect(body.indexOf("await load();")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
    expect(body).toContain("setActionError(plainErrorText(err,");
    expect(body).toContain("setBusyId(null)");
  });

  it("the split sheet: non-ok or a sheet-less body throws before the sheet renders", () => {
    const body = slice(src, "async function openSheet(", "function downloadSheet()");
    expect(body).toContain("if (!res.ok || !json.sheet_text) throw new Error(");
    expect(body.indexOf("setSheet({ code:")).toBeGreaterThan(body.indexOf("if (!res.ok || !json.sheet_text)"));
  });
});
