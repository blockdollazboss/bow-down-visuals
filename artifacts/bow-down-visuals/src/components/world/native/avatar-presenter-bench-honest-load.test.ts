/**
 * AvatarPresenterBench — honest load standard (deep-pins tranche
 * 4, batch E). This bench rides the Hedra avatar presenter
 * (1,200 Bucs), which the owner has ruled SHIPS DARK — wallet $0,
 * funding declined. That dark state is a standing ruling, not a
 * defect, and this pin holds the bench to exactly its current
 * honest behaviour in it: the status read is the only source of
 * truth about whether a provider exists; while it reads
 * not-configured the bench renders the honest not-configured
 * line, keeps avatar + script editable as a plan note (the 2D
 * behaviour), and renders NO generate control — nothing can
 * charge and nothing pretends to work. A thrown status read is
 * its own failed state with retry, never the dark state and
 * never the ready state. When a provider IS connected: generate
 * is gated on canGenerate + a built payload, a decline returns
 * to idle uncharged, 402 is the named out-of-credits ending, a
 * non-ok or job-id-less answer throws to the error state, and
 * the poll's terminal states are real — done sets the clip,
 * failed and done-without-a-clip are failures, a lost poll read
 * is retried only until the deadline, which itself fails
 * honestly as a timeout.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AvatarPresenterBench.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the status read — loading, failed and dark are three different faces", () => {
  it("a non-ok status read throws into the failed flag; the status is set only from the parse", () => {
    const body = slice(src, "/* The status read — the bench's only source of truth about", "const canGenerate = avatarPresenterCanGenerate(status);");
    expect(body).toContain("if (!res.ok) throw new Error(\"status\");");
    expect(body.indexOf("setStatus(parseAvatarPresenterStatus(data));")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
    expect(body).toContain("if (alive) setStatusFailed(true);");
  });

  it("renders loading → failed+retry → dark → ready, in that order", () => {
    const body = slice(src, "{status === null && !statusFailed ? (", "</section>");
    expect(body.indexOf("{status === null && !statusFailed ? (")).toBeLessThan(body.indexOf(") : statusFailed ? ("));
    expect(body.indexOf(") : statusFailed ? (")).toBeLessThan(body.indexOf(") : !canGenerate ? ("));
    expect(body).toContain("setStatusNonce((n) => n + 1);");
  });

  it("the dark branch shows the not-configured line and the plan note, and has no generate control at all", () => {
    const dark = slice(src, 'data-testid="world-avatar-presenter-dark"', 't("worldAvatarPresenterBench.ready", {');
    expect(dark).toContain('t("worldAvatarPresenterBench.notConfigured")');
    expect(dark).toContain('t("worldAvatarPresenterBench.savedNote")');
    expect(dark).not.toContain("onClick");
    expect(dark).not.toContain("generate()");
  });
});

describe("generate and the poll — success only from real terminal states", () => {
  it("generate is gated, a decline returns to idle, 402 is named, and polling starts only from a job id on an ok answer", () => {
    const body = slice(src, "async function generate() {", "return (\n    <section data-testid=\"world-avatar-presenter-bench\"");
    expect(body).toContain("if (!canGenerate || !payload || run === \"running\") return;");
    expect(body).toContain("if (!res) {");
    expect(body).toContain("/* Spend confirmation declined — nothing ran, no charge. */");
    expect(body).toContain("if (res.status === 402 || (data as { error?: string }).error === \"out_of_credits\") {");
    expect(body).toContain("const jobId = presenterSubmitOf(data);");
    expect(body).toContain("if (!res.ok || !jobId) {");
    expect(body.indexOf("pollJob(jobId, Date.now() + AVATAR_PRESENTER_POLL_DEADLINE_MS);")).toBeGreaterThan(
      body.indexOf("if (!res.ok || !jobId) {"),
    );
    expect(body).toContain("setError(plainErrorText(e, t(\"worldAvatarPresenterBench.failed\")));");
  });

  it("the poll: a non-ok read yields no view; done sets the clip, failed and done-no-clip fail, and the deadline ends it", () => {
    const body = slice(src, "function pollJob(jobId: string, deadline: number) {", "async function generate() {");
    expect(body).toContain("const view = res.ok ? parseAvatarPresenterJob(data) : null;");
    expect(body).toContain("if (outcome === \"done\") {");
    expect(body).toContain("setClipUrl(view.outputUrl);");
    expect(body).toContain("if (outcome === \"failed\") {");
    expect(body).toContain("if (outcome === \"done-no-clip\") {");
    expect(body).toContain('setError(t("worldAvatarPresenterBench.doneNoClip"));');
    expect(body).toContain("/* a lost poll read is retried until the deadline — the");
    expect(body).toContain("if (Date.now() > deadline) {");
    expect(body).toContain('setError(t("worldAvatarPresenterBench.pollTimeout"));');
  });

  it("the clip renders only in the done state with a URL", () => {
    expect(src).toContain("{run === \"done\" && clipUrl ? (");
    expect(src).toContain('data-testid="world-avatar-presenter-result"');
  });
});
