/**
 * AppSidebar — honest load classification (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The sidebar renders on every
 * signed-in page, but it is NOT a list-load surface: its navigation
 * renders from in-file constants and the auth context's profile. The
 * file carries exactly two network calls, pinned here so a future
 * collection load cannot slip in unclassified:
 *
 * 1. The admin probe (GET /api/admin/status) is FAIL-CLOSED: the
 *    admin-only footer links appear only on an ok response whose
 *    body says isAdmin === true; any failure records not-admin.
 * 2. The dev add-credits button is an action POST — on success it
 *    refreshes the profile from context; on failure it changes
 *    nothing and simply clears its busy state.
 *
 * There is no fetched collection and no empty state in this file,
 * so no load can dress up as "you have nothing here".
 *
 * The FE suite runs in node (no DOM), so these tests pin the source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const sidebar = read("./app-sidebar.tsx");

describe("the sidebar carries no collection load", () => {
  it("the only fetches in the file are the admin probe and the dev action", () => {
    const urls = [...sidebar.matchAll(/fetch\("(\/api\/[^"]+)"/g)].map((m) => m[1]);
    expect(urls).toEqual(["/api/admin/status", "/api/dev/add-credits"]);
    expect(sidebar).not.toContain("useQuery");
  });
});

describe("the admin probe is fail-closed", () => {
  it("admin starts false and a signed-out user short-circuits to false", () => {
    expect(sidebar).toContain("const [isAdmin, setIsAdmin] = useState(false);");
    expect(sidebar).toContain("if (!user) { setIsAdmin(false); return; }");
  });

  it("admin is granted only on an ok response whose body says isAdmin === true", () => {
    expect(sidebar).toContain("if (!cancelled) setIsAdmin(res.ok && data.isAdmin === true);");
    expect(sidebar).toContain("if (!cancelled) setIsAdmin(false);");
  });

  it("the probe gates exactly the admin-only footer links", () => {
    expect(sidebar).toContain("const footerLinks = FOOTER_LINKS.filter((l) => !l.adminOnly || isAdmin);");
  });
});

describe("the dev credit action changes nothing on failure", () => {
  it("the profile refreshes only on an ok response, and busy always clears", () => {
    expect(sidebar).toContain('const res = await fetch("/api/dev/add-credits", { method: "POST", headers });');
    expect(sidebar).toContain("if (res.ok) await refreshProfile();");
    expect(sidebar).toContain("setAddingCredits(false);");
  });
});
