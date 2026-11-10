/**
 * SchedulerDesk (the World scheduler desk) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 2). One loader, two legs, judged separately:
 *
 * - THE POSTS LEG is the desk: a non-ok read throws into
 *   postsFailed; the queue records only from a proven payload.
 * - THE ACCOUNTS LEG carries its OWN failed flag inside the
 *   same loader: a landed posts list never vouches for the
 *   accounts, and a failed accounts read lands on
 *   accountsFailed — it never paints "no accounts connected"
 *   over a read that didn't happen, and never takes the posts
 *   down with it.
 *
 * NO FIX in this lane — both legs already meet the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./SchedulerDesk.tsx");

const load = desk.slice(desk.indexOf("const load = useCallback(async () => {"), desk.indexOf("useEffect(() => {\n    void load();\n  }, [load]);"));

describe("one loader, two legs, judged separately", () => {
  it("the posts leg throws into postsFailed before recording", () => {
    expect(load).toContain('if (!postsRes.ok) throw new Error("posts");');
    expect(load).toContain("setPosts(parseSchedulerDeskPosts(await postsRes.json().catch(() => null)));");
    expect(load).toContain("setPostsFailed(false);");
    expect(load).toContain("setPostsFailed(true);");
  });

  it("the accounts leg records only on its own ok, else its own flag", () => {
    expect(load).toContain("if (accountsRes.ok) {");
    expect(load).toContain("setAccounts(parseSchedulerAccounts(raw));");
    expect(load).toContain("setAccountsFailed(false);");
    expect(load).toContain("setAccountsFailed(true);");
    expect(load.indexOf("if (accountsRes.ok) {")).toBeLessThan(load.indexOf("setAccounts(parseSchedulerAccounts(raw));"));
  });
});
