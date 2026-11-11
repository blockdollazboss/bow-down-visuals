/**
 * YourOwnTag — honest load standard (deep-pins tranche 4,
 * batch B-fix). Loading the member's tag has three honest states:
 * an ok answer sets the tag AND the ready state, while a non-ok
 * answer or a thrown fetch sets only the failed state — a failed
 * load never calls setMine, so it can never masquerade as "no tag
 * yet". The render keeps that order on screen: the active tag
 * block first, then the loading copy, then the failed panel with
 * its error copy and a Retry button that re-enters loading and
 * re-calls the load, and only in the final else — after a load
 * that actually succeeded — the "No tag yet…" copy. The write
 * paths were already honest and stay pinned: draft and approve
 * check for a real tag on an ok answer before any success notice,
 * approve returns untouched on a declined confirmation, and the
 * stamp toggle checks non-ok before it ever reloads.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./YourOwnTag.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("loadMine — success readies, failure never touches mine", () => {
  it("ok sets mine and ready; non-ok and thrown both set only failed", () => {
    const body = slice(src, "const loadMine = useCallback(async () => {", "useEffect(() => {");
    expect(body).toContain("if (res.ok) {");
    expect(body).toContain("setMine((await res.json()) as MineResponse);");
    expect(body).toContain('setLoadState("ready");');
    expect(body.indexOf("setMine((await res.json()) as MineResponse);")).toBeGreaterThan(body.indexOf("if (res.ok) {"));
    expect(body.indexOf('setLoadState("ready");')).toBeGreaterThan(body.indexOf("setMine((await res.json()) as MineResponse);"));
    const nonOk = slice(body, "} else {", "} catch {");
    expect(nonOk).toContain('setLoadState("failed");');
    expect(nonOk).not.toContain("setMine(");
    const thrown = body.slice(body.indexOf("} catch {"));
    expect(thrown).toContain('setLoadState("failed");');
    expect(thrown).not.toContain("setMine(");
    // The one and only setMine in the loader lives inside the ok branch.
    expect(body.match(/setMine\(/g)).toHaveLength(1);
  });
});

describe("render — active, loading, failed-with-retry, and only then 'no tag yet'", () => {
  it("the four branches render in source order", () => {
    const active = src.indexOf("{mine?.active ? (");
    const loading = src.indexOf(') : loadState === "loading" ? (');
    const failed = src.indexOf(') : loadState === "failed" ? (');
    const noTag = src.indexOf("No tag yet. Make a draft, listen to it, and approve the one that sounds like you.");
    expect(active).toBeGreaterThan(-1);
    expect(loading).toBeGreaterThan(active);
    expect(failed).toBeGreaterThan(loading);
    expect(noTag).toBeGreaterThan(failed);
    const loadingBranch = src.slice(loading, failed);
    expect(loadingBranch).toContain("Loading your tag…");
    // The "No tag yet…" copy sits in the final else, after the failed branch closes.
    const finalElse = src.slice(failed, src.indexOf("{/* ── New draft ── */}"));
    expect(finalElse).toContain(") : (");
    expect(finalElse.indexOf("No tag yet.")).toBeGreaterThan(finalElse.indexOf(") : ("));
  });

  it("the failed panel carries the error copy and a Retry that reloads", () => {
    const panel = slice(src, ') : loadState === "failed" ? (', "No tag yet.");
    expect(panel).toContain("Your tag couldn't load — it may still be there. Check your connection and try again.");
    expect(panel).toContain("onClick={() => {");
    expect(panel).toContain('setLoadState("loading");');
    expect(panel).toContain("void loadMine();");
    expect(panel.indexOf('setLoadState("loading");')).toBeLessThan(panel.indexOf("void loadMine();"));
    expect(panel).toContain("Retry");
    expect(panel.indexOf("Retry")).toBeGreaterThan(panel.indexOf("void loadMine();"));
  });
});

describe("write paths — success notices wait for a real tag on an ok answer", () => {
  it("draft checks !res.ok || !data.tag before its success notice", () => {
    const body = slice(src, "async function makeDraft() {", "async function approve(tag: TagRow) {");
    expect(body).toContain("if (!res.ok || !data.tag) {");
    expect(body).toContain('setError(apiErrorMessage(data, "The draft couldn\'t be made. Nothing was charged — drafts are free."));');
    expect(body.indexOf('setNotice("Draft ready — give it a listen below, then approve it by ear.");')).toBeGreaterThan(body.indexOf("if (!res.ok || !data.tag) {"));
  });

  it("approve returns on decline and checks !res.ok || !data.tag before its success notice", () => {
    const body = slice(src, "async function approve(tag: TagRow) {", "async function toggleStamp(next: boolean) {");
    expect(body).toContain("if (!res) return; // user cancelled the credit confirmation");
    expect(body).toContain("if (!res.ok || !data.tag) {");
    expect(body).toContain('setError(apiErrorMessage(data, "Approval didn\'t go through."));');
    expect(body.indexOf("if (!res) return;")).toBeLessThan(body.indexOf("if (!res.ok || !data.tag) {"));
    expect(body.indexOf("data.giftApplied")).toBeGreaterThan(body.indexOf("if (!res.ok || !data.tag) {"));
    expect(body).toContain('"That\'s your tag now — on the house. 🎁 It sounds on your profile and stamps your exports."');
  });

  it("toggle checks !res.ok before reloading", () => {
    const body = slice(src, "async function toggleStamp(next: boolean) {", "const approveCost =");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain('setError(apiErrorMessage(data, "The toggle didn\'t save."));');
    expect(body.indexOf("await loadMine();")).toBeGreaterThan(body.indexOf("if (!res.ok) {"));
  });
});
