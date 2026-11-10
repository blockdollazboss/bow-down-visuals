/**
 * PartyTableSection — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 1). CLASSIFICATION PIN:
 * this public-profile section is QUIET-BY-DESIGN under a rationale
 * its own header states — "No open table — or a failed read —
 * renders NOTHING: never an empty dressed-up block on a creator's
 * page (the LiveNowBadge precedent)." The section is an auxiliary
 * presence indicator on a public storefront: it makes no claim in
 * copy when absent, so a failed read and a genuinely table-less
 * creator are indistinguishable BY DESIGN, and neither dresses up
 * as an empty state.
 *
 * The pin fixes the classification facts: the file's one load is
 * the party-tables read; rooms start null; a non-ok response
 * returns without recording; a throw is swallowed to the same
 * absence; and the section renders only when a successful load
 * brought at least one room for the surface in view. If a future
 * change adds a collection load or empty copy here, it must
 * re-classify first.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const sec = read("./PartyTableSection.tsx");

describe("classification: quiet-by-design presence section", () => {
  it("the file states its own absence rule", () => {
    expect(sec).toContain("renders NOTHING: never an empty dressed-up block on a");
  });

  it("the file's fetch URLs are exactly the party-tables read and the clipboard-free invite build", () => {
    const urls = [...sec.matchAll(/fetch\(\s*`([^`]+)`|fetch\(\s*"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
    expect(urls).toEqual(["/api/creator-profiles/${encodeURIComponent(slug)}/party-tables"]);
  });

  it("rooms start null — not loaded is distinct from loaded-empty in state", () => {
    expect(sec).toContain("const [rooms, setRooms] = useState<PartyOpenRoom[] | null>(null);");
  });

  it("a non-ok response returns without recording rooms", () => {
    expect(sec).toContain("if (!res.ok) return;");
    expect(sec).toContain("if (!cancelled) setRooms(parsePartyRooms(data));");
  });

  it("a throw is swallowed to the same absence, under the file's own note", () => {
    expect(sec).toContain("/* the section just stays hidden — the page itself loaded */");
  });

  it("the section renders only when a load brought a room for this surface", () => {
    expect(sec).toContain("if (!rooms) return null;");
    expect(sec).toContain("if (shown.length === 0) return null;");
    expect(sec).toContain('data-testid="profile-party-tables"');
  });
});
