/**
 * SchedulerPublishBench (World native) — honest load
 * standard (deep-pins tranche 5). No list load: the bench
 * renders the parent draft, and "no platforms picked" is an
 * honest draft empty (NativeEmptyState), not a load state.
 * Each platform row is its own state machine (idle / busy /
 * error / notice / done) and the done row exists only when
 * the classified outcome of the REAL response says so: the
 * classifier separates out-of-credits, in-progress (a
 * notice, never a done), and failed (the server's message)
 * before success; a cancelled confirmation returns the row
 * to idle with no charge and no error; the idempotency key
 * is retired only on success, so a retry after failure
 * replays safely instead of double-posting.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SchedulerPublishBench.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the publish row — done is classified, never assumed", () => {
  it("cancel returns the row to idle; the outcome kinds are handled in order before done", () => {
    const body = slice(src, "const payload = buildSocialPublishPayload(platform, draft, accounts, idempotencyKey);", "const cost = socialPublishCost(\"instagram\");");
    expect(body).toContain("if (!payload) {");
    expect(body).toContain('setRow(platform, { kind: "busy" });');
    expect(body).toContain("if (!res) {");
    expect(body).toContain('setRow(platform, { kind: "idle" });');
    expect(body).toContain("const outcome = classifySocialPublishResponse(");
    expect(body).toContain('if (outcome.kind === "out-of-credits") {');
    expect(body).toContain('if (outcome.kind === "in-progress") {');
    expect(body).toContain('setRow(platform, { kind: "notice", message: inProgressLine(platform) });');
    expect(body).toContain('if (outcome.kind === "failed") {');
    expect(body).toContain('setRow(platform, { kind: "error", message: outcome.message });');
    expect(body).toContain("retireSocialPublishKey(platform, draft.mediaUrl, storage, keysCache.current);");
    expect(body).toContain('kind: "done",');
    expect(body.indexOf('if (outcome.kind === "failed") {')).toBeLessThan(
      body.indexOf("retireSocialPublishKey(platform, draft.mediaUrl, storage, keysCache.current);"),
    );
    expect(body.indexOf("retireSocialPublishKey(platform, draft.mediaUrl, storage, keysCache.current);")).toBeLessThan(
      body.indexOf('kind: "done",'),
    );
    const catchPart = slice(body, "} catch {", "const cost = socialPublishCost(\"instagram\");");
    expect(catchPart).toContain('setRow(platform, { kind: "error", message: failedFallback(platform) });');
    expect(catchPart).not.toContain("done");
  });

  it("the empty bench is a draft state, labelled as such", () => {
    expect(src).toContain("{draft.platforms.length === 0 ? (");
    expect(src).toContain('<NativeEmptyState isLight={isLight} message={t("worldSchedulerPublish.needPlatform")} />');
  });
});
