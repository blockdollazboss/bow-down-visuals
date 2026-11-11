/**
 * ShoutoutsSellDesk — honest load standard (deep-pins tranche 3,
 * batch 9). The two loads (requests by status, revenue) carry the
 * loaded-ref pattern: each throws on non-ok AND on an unparsed body
 * (normalizeShoutoutRequests / normalizeShoutoutRevenue null), and
 * the error flag is set ONLY when nothing has ever loaded — a
 * failed REFRESH keeps the real list/figures on screen instead of
 * painting an error over truth, and a successful load clears the
 * flag. Guests fire no loads. Writes: patchRequest checks res.ok
 * before applying; the delivery upload checks before the note; the
 * words polish rides confirmedFetch — a decline returns (its own
 * comment), 402 is named, non-ok lands in the polish error.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ShoutoutsSellDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the loads — a failed refresh never paints over truth", () => {
  it("both loaders throw on unparsed and gate the error flag on the loaded ref", () => {
    const req = slice(src, "const loadRequests = useCallback(async () => {", "const loadRevenue = useCallback(async () => {");
    expect(req).toContain('if (!res.ok) throw new Error("load failed");');
    expect(req).toContain('if (!parsed) throw new Error("load failed");');
    expect(req).toContain("requestsLoadedRef.current = true;");
    expect(req).toContain("if (!requestsLoadedRef.current) setRequestsError(true);");
    const rev = slice(src, "const loadRevenue = useCallback(async () => {", "async function patchRequest(");
    expect(rev).toContain("if (!revenueLoadedRef.current) setRevenueError(true);");
    expect(src).toContain("if (isGuest) return;\n    void loadRevenue();");
  });
});

describe("the writes — checked before the note", () => {
  it("patch and upload check res.ok; polish names its decline and 402", () => {
    const polish = src.slice(src.indexOf("async function polishWords(req: ShoutoutSellRequest) {"));
    expect(polish).toContain("if (!res) return; /* the walker declined the Bucs confirm */");
    expect(polish).toContain("if (res.status === 402) {");
    expect(polish).toContain("if (!res.ok) {");
  });
});
