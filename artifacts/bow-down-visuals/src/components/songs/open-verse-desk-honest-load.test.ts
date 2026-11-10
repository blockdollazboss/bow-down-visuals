/**
 * OpenVerseDesk — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The desk loads three reads in
 * parallel (open posts, my posts, my songs) into one picture.
 *
 * FINDING + FIX IN THIS LANE: the load parsed the three responses
 * WITHOUT ever checking res.ok — a 500 from any read parsed as {}
 * and landed as posts=[] with open_verse_ready defaulting true, so
 * a failed load rendered the desk's genuine empty copy ("No open
 * verses yet — post yours above…") with the feature stamped ready.
 * The load now throws when ANY of the three reads is not ok,
 * landing in the desk's existing error state ("Couldn't load open
 * verses — try again."); it also clears a stale error at load
 * start so a recovered load stops showing the old failure; and the
 * empty copy is gated on no-error, so the two states can never
 * render together. The desk's action rail (call()) already threw
 * on non-ok with the server's message — unchanged.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./OpenVerseDesk.tsx");

const load = desk.slice(
  desk.indexOf("const load = useCallback"),
  desk.indexOf("useEffect(() => {\n    if (user) void load();"),
);

describe("the desk load — a failed read is a failed load, never an empty desk", () => {
  it("any non-ok read throws before any body is trusted", () => {
    expect(load).toContain('if (!openRes.ok || !mineRes.ok || !songsRes.ok) throw new Error("open verse load failed");');
    expect(load.indexOf('throw new Error("open verse load failed")')).toBeLessThan(
      load.indexOf("openBody.posts ?? []"),
    );
  });

  it("the throw lands in the desk's error state", () => {
    expect(load).toContain('setError("Couldn\'t load open verses — try again.");');
  });

  it("a fresh load clears a stale error first, so recovery stops showing the old failure", () => {
    expect(load).toContain("setLoading(true);\n    setError(null);");
  });

  it("posts and readiness are recorded only from ok responses", () => {
    expect(load).toContain("setPosts([...byId.values()]);");
    expect(load).toContain("setReady((openBody.open_verse_ready ?? true) && (mineBody.open_verse_ready ?? true));");
  });
});

describe("render: loading, then error-gated empty, then the posts", () => {
  it("the empty copy can never render alongside a load error", () => {
    expect(desk).toContain(") : posts.length === 0 && !error ? (");
    expect(desk).toContain("No open verses yet — post yours above, or check back when a creator opens a slot.");
  });

  it("the error line renders above the list region", () => {
    expect(desk).toContain('{error && <p className="mt-4 text-sm text-red-400">{error}</p>}');
    expect(desk.indexOf("{error &&")).toBeLessThan(desk.indexOf("No open verses yet"));
  });
});

describe("the action rail already threw honestly — unchanged", () => {
  it("call() throws the server's message on a non-ok response", () => {
    expect(desk).toContain('throw new Error(apiErrorMessage(data, "That didn\'t go through — try again."));');
  });
});
