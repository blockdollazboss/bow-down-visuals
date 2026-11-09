/**
 * My Projects — honest load states (Stack 400 C-28: the honest-load
 * pin layer completing the "empty lie" audit; census C-28 names this
 * page explicitly: spot-checked honest — explicit per-list
 * loading/error states — so it needs the PIN, not a fix).
 *
 * This pin is written against the page's POST-JOIN shape, per the
 * manifest's my-projects three-holder sequence: C-26's SectionBoundary
 * wraps (lane s400-resilience-money) FIRST, D-44's delete-failure
 * banner (lane s400-myprojects-failure-copy) SECOND, this pin LAST.
 * Neither holder's change is on this lane's base (join14), so the pin
 * was verified against a scratch composition of the two banked branch
 * shapes (C-26 file + D-44 patch applied) — green there; on the bare
 * join14 page the loader pins pass and the wrap/banner pins fail,
 * exactly as sequenced. At join15 the composed tree must satisfy all
 * of it.
 *
 * What is pinned:
 *  - All five list loads (projects, drafts, clips, websites, history)
 *    follow the same honest machine: the loader raises loading and
 *    clears the error, throws on a non-ok response, records the error
 *    text in its catch, and always clears loading. Each tab renders
 *    spinner → error panel with a retry wired to the real loader →
 *    the empty panel ONLY after both — a failed load can never render
 *    as "you have nothing here".
 *  - The C-26 wraps survive the join (tab bodies ride named
 *    SectionBoundary sections).
 *  - The D-44 post-join truth: delete failures surface through the
 *    in-page deleteError banner, and NO native alert( call remains in
 *    the file. (The C-26 lane's isolation suite pins "exactly 4
 *    alert( sites remain" on ITS branch; the joined tree reconciles
 *    that pin to 0 with both lanes cited — this pin asserts the
 *    reconciled truth so certification catches a missed update.)
 *
 * The FE suite runs in node (no DOM), so — like the sibling
 * honest-load pins — these tests pin the state machines in source.
 * Copy goes through t("myProjects.*") keys; the asserted keys are
 * pinned non-empty in all 10 catalogs below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./my-projects.tsx");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

/* The five list loads: `state` builds the setter names (setProjLoading),
   `loadVar`/`errVar` are the render-side state variables. */
const LISTS = [
  { loader: "loadProjects", cap: "Projects", state: "Proj", loadVar: "projLoading", errVar: "projError", list: "projects" },
  { loader: "loadDrafts", cap: "Drafts", state: "Drafts", loadVar: "draftsLoading", errVar: "draftsError", list: "drafts" },
  { loader: "loadClips", cap: "Clips", state: "Clips", loadVar: "clipsLoading", errVar: "clipsError", list: "clips" },
  { loader: "loadWebsites", cap: "Websites", state: "Websites", loadVar: "websitesLoading", errVar: "websitesError", list: "websites" },
  { loader: "loadHistory", cap: "History", state: "History", loadVar: "historyLoading", errVar: "historyError", list: "history" },
] as const;

function loaderBody(name: string): string {
  const at = page.indexOf(`async function ${name}()`);
  expect(at, `${name} exists`).toBeGreaterThan(-1);
  return page.slice(at, page.indexOf("\n  }", at));
}

describe("loaders — every list load records failure distinctly from empty", () => {
  it.each(LISTS)("$loader throws on non-ok and lands the error in its catch", ({ loader, cap, state }) => {
    const body = loaderBody(loader);
    expect(body).toContain(`set${state}Loading(true);`);
    expect(body).toContain(`set${state}Error(null);`);
    expect(body).toContain(`if (!res.ok) throw new Error(t("myProjects.failedLoad${cap}"));`);
    expect(body).toContain(`set${state}Error(plainErrorText(err, t("myProjects.failedLoad${cap}")));`);
    expect(body).toContain(`set${state}Loading(false);`);
    /* the attempt clears the error before it can fail again */
    expect(body.indexOf(`set${state}Error(null);`)).toBeLessThan(body.indexOf("throw new Error"));
  });
});

describe("render — spinner, then error + retry, and only then the empty panel", () => {
  it.each(LISTS)("$list tab reaches its empty state only after the loading and error branches", ({ loadVar, errVar, list }) => {
    const loadingAt = page.indexOf(`${loadVar} ? (`);
    const errorAt = page.indexOf(`) : ${errVar} ? (`);
    const emptyAt = page.indexOf(`) : ${list}.length === 0 ? (`);
    expect(loadingAt, `${list} loading branch`).toBeGreaterThan(-1);
    expect(errorAt, `${list} error branch`).toBeGreaterThan(loadingAt);
    expect(emptyAt, `${list} empty branch`).toBeGreaterThan(errorAt);
  });

  it.each(LISTS)("$loader's error branch retries through the real loader", ({ loader }) => {
    expect(page).toContain(`onClick={() => void ${loader}()}`);
  });

  it("the shared retry copy is the house key", () => {
    expect(page.match(/t\("myProjects\.tryAgain"\)/g)).toHaveLength(5);
  });
});

describe("post-join shape — C-26 wraps and the D-44 banner both survive", () => {
  it("each list tab body rides its named SectionBoundary", () => {
    for (const name of ["projects", "drafts", "clips", "websites", "history"]) {
      expect(page).toContain(`<SectionBoundary name="my-projects-tab-${name}">`);
    }
  });

  it("no native alert( call remains anywhere in the page", () => {
    expect(page).not.toContain("alert(");
  });

  it("the four delete failures land in the deleteError state with their own keys", () => {
    expect(page).toContain("const [deleteError, setDeleteError] = useState<string | null>(null);");
    for (const cap of ["Project", "Draft", "Clip", "Website"]) {
      expect(page).toContain(`setDeleteError(t("myProjects.failedDelete${cap}"));`);
    }
    /* each attempt clears the banner first so a retry can succeed cleanly */
    expect(page.match(/setDeleteError\(null\);/g)).toHaveLength(4);
  });

  it("the banner renders above the tab bodies", () => {
    expect(page).toContain('<p role="alert" className="text-sm text-red-400 font-semibold mb-3">{deleteError}</p>');
    const bannerAt = page.indexOf("{deleteError && (");
    const tabsAt = page.indexOf('{tab === "projects" && (');
    expect(bannerAt).toBeGreaterThan(-1);
    expect(tabsAt).toBeGreaterThan(bannerAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  const KEYS = [
    "myProjects.failedLoadProjects",
    "myProjects.failedLoadDrafts",
    "myProjects.failedLoadClips",
    "myProjects.failedLoadWebsites",
    "myProjects.failedLoadHistory",
    "myProjects.tryAgain",
    "myProjects.failedDeleteProject",
    "myProjects.failedDeleteDraft",
    "myProjects.failedDeleteClip",
    "myProjects.failedDeleteWebsite",
    "myProjects.noProjects",
    "myProjects.noDrafts",
    "myProjects.noClips",
    "myProjects.noWebsites",
    "myProjects.noHistory",
  ];
  it.each(LOCALES)("%s carries the myProjects honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of KEYS) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
