/**
 * PublishDesk — honest load standard (deep-pins tranche 3, batch 6).
 * Three independent loads, each with its own failed flag: profiles
 * (failure block with retry first in render, then the loaded-empty
 * create card, then the multi-profile picker), and the two shelves
 * (per-kind shelfBlock: failed + retry → loading → honest empty →
 * list — a failed shelf never reads as an empty shelf, and one
 * shelf's failure never touches the other). Save refuses up front
 * with no profile and on a seam-invalid draft before any call. The
 * writes all check: upload throws on non-ok AND on an unusable body;
 * save throws on non-ok AND on an unparseable saved row, and the
 * "now live / now draft" note renders only from the parsed row;
 * toggle applies the state flip only after an ok; delete is a
 * two-tap confirm, throws on non-ok, and removes the row only
 * after. The duration probe is a documented bonus (its failure
 * just leaves the row without a duration).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PublishDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the three loads — each fails as itself", () => {
  it("profiles: non-ok throws into the failed flag; render order is failed → empty → picker", () => {
    const loader = slice(src, "const loadProfiles = useCallback(async () => {", "const loadShelf = useCallback(");
    expect(loader).toContain('if (!res.ok) throw new Error("profiles failed");');
    expect(loader).toContain("setProfilesFailed(true);");
    const failedAt = src.indexOf("{profilesFailed ? (");
    const emptyAt = src.indexOf(") : profiles !== null && profiles.length === 0 ? (");
    const pickerAt = src.indexOf(") : profiles !== null && profiles.length > 1 && !editing ? (");
    expect(failedAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(failedAt);
    expect(pickerAt).toBeGreaterThan(emptyAt);
    expect(src).toContain('data-testid="world-publish-desk-profiles-failed"');
    expect(src).toContain("onClick={() => void loadProfiles()}");
  });

  it("shelves: each kind throws into its own flag; shelfBlock renders failed before loading before empty", () => {
    const loader = slice(src, "const loadShelf = useCallback(", "useEffect(() => {\n    void loadProfiles();");
    expect(loader).toContain('if (!res.ok) throw new Error("shelf failed");');
    expect(loader).toContain("setTracksFailed(true);");
    expect(loader).toContain("setVideosFailed(true);");
    const block = slice(src, "function shelfBlock(kind: PublishKind, items: PublishItem[] | null, failed: boolean) {", "const genreOptions =");
    expect(block.indexOf('t("worldDeskRemainder.pubShelfEmpty"')).toBeGreaterThan(block.indexOf("if (items === null)"));
    expect(block.indexOf("if (items === null)")).toBeGreaterThan(block.indexOf("if (failed) {"));
    expect(block).toContain("onClick={() => void loadShelf(kind)}");
    expect(src).toContain("const shelvesLoading = tracks === null && videos === null && !tracksFailed && !videosFailed;");
  });
});

describe("the writes — success only from a checked, parsed answer", () => {
  it("upload throws on non-ok and on an unusable body", () => {
    const body = slice(src, "const uploadFile = useCallback(", "function probeDuration(");
    expect(body).toContain("if (!res.ok) throw new Error(apiErrorMessage(data,");
    expect(body).toContain("const up = publishUploadOfResponse(data);");
    expect(body).toContain('if (!up) throw new Error(t("worldDeskRemainder.pubUploadUnusable"));');
  });

  it("save refuses without a profile or a valid draft before any call, then throws on non-ok/unparseable", () => {
    const body = slice(src, "async function save() {", "async function toggleState(item: PublishItem) {");
    expect(body).toContain("if (!targetProfileId) {");
    expect(body).toContain('setFormError(t("worldDeskRemainder.pubNoProfile"));');
    expect(body).toContain("const problem = publishDraftError(draft,");
    expect(body.indexOf("await uploadFile(file)")).toBeGreaterThan(body.indexOf("const problem = publishDraftError(draft,"));
    expect(body).toContain("if (!res.ok) throw new Error(apiErrorMessage(data,");
    expect(body).toContain("const saved = publishItemOfSaveResponse(draft.kind, data);");
    expect(body).toContain('if (!saved) throw new Error(t("worldDeskRemainder.pubSaveUnusable"));');
    expect(body.indexOf('t("worldDeskRemainder.pubNowLive"')).toBeGreaterThan(body.indexOf("if (!saved) throw"));
  });

  it("toggle flips state only after an ok; delete is two-tap and removes only after an ok", () => {
    const toggle = slice(src, "async function toggleState(item: PublishItem) {", "async function deleteItem(item: PublishItem) {");
    expect(toggle).toContain("if (!res.ok) throw new Error(apiErrorMessage(data,");
    expect(toggle.indexOf("setTracks(apply)")).toBeGreaterThan(toggle.indexOf("if (!res.ok) throw"));
    const del = slice(src, "async function deleteItem(item: PublishItem) {", "/* ── Render");
    expect(del).toContain("if (confirmDeleteId !== item.id) {");
    expect(del).toContain("setConfirmDeleteId(item.id);");
    expect(del).toContain("if (!res.ok) {");
    expect(del.indexOf("withoutPublishItem(prev, item.id)")).toBeGreaterThan(del.indexOf("if (!res.ok) {"));
    expect(del.indexOf('setNote(t("worldDeskRemainder.pubDeleted"')).toBeGreaterThan(del.indexOf("if (!res.ok) {"));
  });

  it("the duration probe is a documented bonus read", () => {
    expect(src).toContain("/* duration is a bonus — the rail takes the row without it */");
  });
});
