/**
 * VideoStudioDesk (World native) — honest load standard
 * (deep-pins tranche 5). No mount list load: the desk's
 * videos are built in-session. The pinned surface is the
 * paid generate + poll: a declined credit confirmation
 * returns silently; the submit must answer ok AND parse or
 * it throws the server's words; the poll runs to a hard
 * 5-minute deadline (never an unbounded spin); a "done"
 * verdict without a usable clip is its own thrown error
 * (worldVideoStudio.emptySuccess — an empty success is a
 * failure, never a result); a failed verdict throws the
 * rail's composed message; only a real url reaches
 * setVideos / addAsset. Busy settles in finally, guarded
 * by the mounted ref.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./VideoStudioDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("generate + poll — every ending is honest", () => {
  it("declined confirmation returns silently; submit needs ok + a parsed body before the poll starts", () => {
    const body = slice(src, "async function handleGenerate() {", "return (");
    expect(body).toContain("if (submitRes === null) return; // member declined — nothing ran");
    expect(body).toContain("if (!submitRes.ok || !submit) {");
    expect(body).toContain('throw new Error(apiErrorMessage(submitData, t("worldVideoStudio.failed")));');
    expect(body.indexOf("if (!submitRes.ok || !submit) {")).toBeLessThan(
      body.indexOf("const deadline = Date.now() + VIDEO_STUDIO_POLL_DEADLINE_MS;"),
    );
  });

  it("the poll is deadline-bounded; empty success throws; timeout throws; only a url lands a video", () => {
    const body = slice(src, "async function handleGenerate() {", "return (");
    expect(body).toContain("while (Date.now() < deadline) {");
    expect(body).toContain('if (verdict.state === "done") {');
    expect(body).toContain('if (verdict.state === "empty") {');
    expect(body).toContain('throw new Error(t("worldVideoStudio.emptySuccess"));');
    expect(body).toContain('if (verdict.state === "failed") {');
    expect(body).toContain('if (!videoUrl) throw new Error(t("worldVideoStudio.timedOut"));');
    expect(body).toContain("setVideos((prev) => [{ url: videoUrl as string, prompt: prompt.trim(), camera }, ...prev]);");
    expect(body.indexOf('if (!videoUrl) throw new Error(t("worldVideoStudio.timedOut"));')).toBeLessThan(
      body.indexOf("setVideos((prev) => [{ url: videoUrl as string"),
    );
    const catchPart = slice(body, "} catch (err) {", "} finally {");
    expect(catchPart).toContain("setError(plainErrorText(err, t(\"worldVideoStudio.failed\")));");
    expect(catchPart).not.toContain("setVideos");
  });
});
