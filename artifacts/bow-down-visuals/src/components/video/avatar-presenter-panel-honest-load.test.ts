/**
 * AvatarPresenterPanel — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 1). The panel gates a paid
 * generation rail (HeyGen/Hedra avatar presenter) on a status read,
 * GET /api/avatar-presenter/status. Its honesty contract is the
 * closed-gate shape: the provider reads as connected ONLY when the
 * server actually answered ok and said configured — a non-ok
 * response or a network failure leaves the status null, and the
 * panel renders the "aren't connected yet" notice after its loading
 * branch. A failed read can never dress up as a connected provider,
 * a price, or an avatar catalog: the cost badge renders only when
 * the server sent a cost, and the catalog derives from the loaded
 * status alone.
 *
 * Copy rides i18n keys with English defaultValue fallbacks, so the
 * pin asserts the default literals and carries no catalog block.
 * The FE suite runs in node (no DOM), so these tests pin the source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panel = read("./AvatarPresenterPanel.tsx");

describe("failure path — a failed status read never reads as a connected provider", () => {
  it("the status is recorded only on an ok response", () => {
    expect(panel).toContain('const res = await fetch("/api/avatar-presenter/status");');
    expect(panel).toContain("if (res.ok) {");
    expect(panel).toContain("if (alive) setStatus(data);");
  });

  it("the status starts null and loading clears in the finally", () => {
    expect(panel).toContain("const [status, setStatus] = useState<StatusResponse | null>(null);");
    expect(panel).toContain("const [loading, setLoading] = useState(true);");
    expect(panel).toContain("if (alive) setLoading(false);");
  });

  it("connected requires the loaded status to say so", () => {
    expect(panel).toContain("const configured = status?.configured === true;");
  });

  it("the cost badge and catalog derive from the loaded status alone", () => {
    expect(panel).toContain("const cost = status?.creditCost;");
    expect(panel).toContain("{cost != null && (");
    expect(panel).toContain("const catalog = status?.catalog ?? [];");
  });
});

describe("render order — checking, then the closed gate, then ready", () => {
  it("the loading branch renders the checking line first", () => {
    expect(panel).toContain("{loading ? (");
    expect(panel).toContain('defaultValue: "Checking avatar provider…"');
  });

  it("the not-configured branch follows loading and carries the honest notice", () => {
    const loadingAt = panel.indexOf("{loading ? (");
    const closedAt = panel.indexOf(") : !configured ? (");
    const readyAt = panel.indexOf('defaultValue: "Avatar provider connected ({{provider}})."');
    expect(loadingAt).toBeGreaterThan(-1);
    expect(closedAt).toBeGreaterThan(loadingAt);
    expect(readyAt).toBeGreaterThan(closedAt);
    expect(panel).toContain("AI avatars aren't connected yet");
  });
});
