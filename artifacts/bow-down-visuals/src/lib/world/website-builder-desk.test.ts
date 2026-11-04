import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getCreditCost } from "../credit-costs";
import {
  WEBSITE_BUILDER_DESK_FOLLOW_ONS,
  WEBSITE_BUILDER_DESK_PROMOTION,
  WEBSITE_BUILDER_EDIT_PATH,
  WEBSITE_BUILDER_GENERATE_PATH,
  WEBSITE_BUILDER_OWNERSHIP_LINE,
  WEBSITE_BUILDER_PROJECTS_PATH,
  WEBSITE_BUILDER_TEMPLATE_KEYS,
  WEBSITE_BUILDER_TEMPLATES,
  WEBSITE_BUILDER_TEMPLATES_PATH,
  WEBSITE_BUILD_COST_VB,
  WEBSITE_BUILD_FEATURE,
  WEBSITE_EDIT_COST_VB,
  WEBSITE_EDIT_FEATURE,
  WEBSITE_PROJECTS_COST_VB,
  buildPreviewHtml,
  buildWebsiteEditBody,
  buildWebsiteGenerateBody,
  buildWebsiteSaveBody,
  isWebsiteTemplateKey,
  normalizeWebsiteEditResult,
  normalizeWebsiteFiles,
  normalizeWebsiteGenerateResult,
  normalizeWebsiteProjectDetail,
  normalizeWebsiteProjects,
  normalizeWebsiteSaveResult,
  normalizeWebsiteVersionPayload,
  websiteBuilderOutOfCredits,
  websiteBriefReady,
  websiteEditReady,
  websiteProjectPath,
  websiteProjectRestorePath,
  websiteProjectVersionPath,
  websiteSourceLabel,
  websiteZipFileName,
  websiteZipFolderName,
} from "./website-builder-desk";

/* ─── Website Builder desk seam (stack100 wave 4, item 23, #97) ────
   The builder native at My Studio, on the builder router's own
   rails. These tests pin the seam: the paths against the API route
   file itself, the price chain rail-default == registry row ==
   seam constant (derived, never a desk literal), the request bodies
   field-for-field against the page's own sends, the form gates
   against the rail's zod schemas, and the normalizers' refusal to
   dress a file-less response up as a build. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const rail = read("../../../../api-server/src/routes/generate/website-builder.ts");

const FILES = {
  "index.html": "<html><head><link rel=\"stylesheet\" href=\"styles.css\"></head><body>Hi</body></html>",
  "styles.css": "body { margin: 0; }",
  "script.js": "console.log('x');",
};

const PROJECT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "TRGDY TRBLZ",
  template: "artist-site",
  templateLabel: "Artist Site",
  versionCount: 3,
  latestVersion: 3,
  fileCount: 4,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

describe("rail paths", () => {
  it("are the builder router's own paths, verbatim", () => {
    expect(WEBSITE_BUILDER_TEMPLATES_PATH).toBe("/api/website-builder/templates");
    expect(WEBSITE_BUILDER_GENERATE_PATH).toBe("/api/website-builder/generate");
    expect(WEBSITE_BUILDER_EDIT_PATH).toBe("/api/website-builder/edit");
    expect(WEBSITE_BUILDER_PROJECTS_PATH).toBe("/api/website-builder/projects");
    expect(websiteProjectPath("abc 123")).toBe("/api/website-builder/projects/abc%20123");
    expect(websiteProjectVersionPath("p1", 2)).toBe("/api/website-builder/projects/p1/versions/2");
    expect(websiteProjectRestorePath("p1", 2)).toBe(
      "/api/website-builder/projects/p1/versions/2/restore",
    );
  });

  it("every seam path is a route the API file actually registers", () => {
    expect(rail).toContain('router.get("/templates"');
    expect(rail).toContain('router.post("/generate"');
    expect(rail).toContain('router.post("/edit"');
    expect(rail).toContain('router.get("/projects"');
    expect(rail).toContain('router.post("/projects"');
    expect(rail).toContain('router.get("/projects/:id"');
    expect(rail).toContain('router.get("/projects/:id/versions/:version"');
    expect(rail).toContain('"/projects/:id/versions/:version/restore"');
    expect(rail).toContain('router.delete("/projects/:id"');
  });
});

describe("the price chain — rail default == registry row == seam constant", () => {
  function deriveRailDefault(name: string): number {
    const m = rail.match(new RegExp(`${name} = Number\\(process\\.env\\["[A-Z_]+"\\]\\) \\|\\| (\\d+)`));
    if (!m) throw new Error(`rail default for ${name} not found`);
    return Number(m[1]);
  }

  it("build is 3,000 and edit is 200 at every link of the chain", () => {
    expect(deriveRailDefault("WEBSITE_BUILD_CREDITS")).toBe(3000);
    expect(deriveRailDefault("WEBSITE_EDIT_CREDITS")).toBe(200);
    expect(getCreditCost(WEBSITE_BUILDER_GENERATE_PATH)).toEqual({
      cost: 3000,
      feature: "Website Build",
    });
    expect(getCreditCost(WEBSITE_BUILDER_EDIT_PATH)).toEqual({
      cost: 200,
      feature: "Website Edit",
    });
    expect(WEBSITE_BUILD_COST_VB).toBe(3000);
    expect(WEBSITE_BUILD_FEATURE).toBe("Website Build");
    expect(WEBSITE_EDIT_COST_VB).toBe(200);
    expect(WEBSITE_EDIT_FEATURE).toBe("Website Edit");
  });

  it("projects are free — the registry row says 0 and the seam reads it", () => {
    expect(getCreditCost(WEBSITE_BUILDER_PROJECTS_PATH)).toEqual({
      cost: 0,
      feature: "Save Website Project (free)",
    });
    expect(WEBSITE_PROJECTS_COST_VB).toBe(0);
    const costs = read("../credit-costs.ts");
    expect(costs).toContain(
      '"/api/website-builder/generate": { cost: 3000, feature: "Website Build" }',
    );
    expect(costs).toContain('"/api/website-builder/edit": { cost: 200, feature: "Website Edit" }');
    expect(costs).toContain(
      '"/api/website-builder/projects": { cost: 0, feature: "Save Website Project (free)" }',
    );
  });

  it("the seam DERIVES its prices from the registry — no assignment literal", () => {
    const seam = read("./website-builder-desk.ts");
    expect(seam).toContain("getCreditCost(WEBSITE_BUILDER_GENERATE_PATH)?.cost ?? -1");
    expect(seam).toContain("getCreditCost(WEBSITE_BUILDER_EDIT_PATH)?.cost ?? -1");
    expect(seam).not.toMatch(/WEBSITE_BUILD_COST_VB\s*=\s*\d/);
    expect(seam).not.toMatch(/WEBSITE_EDIT_COST_VB\s*=\s*\d/);
  });

  it("the rail charges exactly the constants it exports, and refunds on failure", () => {
    expect(rail).toContain("chargeCredits(req.userId!, WEBSITE_BUILD_CREDITS");
    expect(rail).toContain("refundCredits(req.userId!, WEBSITE_BUILD_CREDITS");
    expect(rail).toContain("chargeCredits(req.userId!, WEBSITE_EDIT_CREDITS");
    expect(rail).toContain("refundCredits(req.userId!, WEBSITE_EDIT_CREDITS");
  });
});

describe("templates", () => {
  it("the key set is the rail's enum: 4 gallery keys + the 3 brief-only keys", () => {
    expect([...WEBSITE_BUILDER_TEMPLATE_KEYS]).toEqual([
      "artist-site",
      "podcast-home",
      "streamer-hub",
      "showreel-portfolio",
      "press-kit",
      "link-in-bio",
      "tour-page",
    ]);
    expect(isWebsiteTemplateKey("podcast-home")).toBe(true);
    expect(isWebsiteTemplateKey("tour-page")).toBe(true);
    expect(isWebsiteTemplateKey("blog")).toBe(false);
  });

  it("the picker offers the page's four brief templates with the page's words", () => {
    expect(WEBSITE_BUILDER_TEMPLATES.map((t) => t.key)).toEqual([
      "artist-site",
      "press-kit",
      "link-in-bio",
      "tour-page",
    ]);
    expect(WEBSITE_BUILDER_TEMPLATES[0]).toEqual({
      key: "artist-site",
      label: "Artist Site",
      blurb: "Full homepage: hero, music, about, shows, gallery, mailing list.",
    });
  });
});

describe("form gates — the rail's zod rules", () => {
  const ok = {
    businessName: "TRGDY TRBLZ",
    description: "A homepage with my latest single front and center.",
    style: "",
    colorScheme: "",
  };

  it("the brief gate mirrors generateSchema's boundaries", () => {
    expect(websiteBriefReady(ok)).toBe(true);
    expect(websiteBriefReady({ ...ok, businessName: " " })).toBe(false);
    expect(websiteBriefReady({ ...ok, businessName: "x".repeat(121) })).toBe(false);
    expect(websiteBriefReady({ ...ok, businessName: "x".repeat(120) })).toBe(true);
    expect(websiteBriefReady({ ...ok, description: "x".repeat(19) })).toBe(false);
    expect(websiteBriefReady({ ...ok, description: "x".repeat(20) })).toBe(true);
    expect(websiteBriefReady({ ...ok, description: "x".repeat(3001) })).toBe(false);
    expect(websiteBriefReady({ ...ok, style: "x".repeat(501) })).toBe(false);
    expect(websiteBriefReady({ ...ok, style: "x".repeat(500) })).toBe(true);
    expect(websiteBriefReady({ ...ok, colorScheme: "x".repeat(201) })).toBe(false);
    expect(websiteBriefReady({ ...ok, colorScheme: "x".repeat(200) })).toBe(true);
  });

  it("the edit gate mirrors editSchema: a real build + 5–1000 trimmed chars", () => {
    expect(websiteEditReady(FILES, "make it darker")).toBe(true);
    expect(websiteEditReady(FILES, "four")).toBe(false);
    expect(websiteEditReady(FILES, "five!")).toBe(true);
    expect(websiteEditReady(FILES, "x".repeat(1001))).toBe(false);
    expect(websiteEditReady(null, "make it darker")).toBe(false);
    expect(websiteEditReady({ "styles.css": "x" }, "make it darker")).toBe(false);
  });
});

describe("request bodies — the page's exact key sets", () => {
  it("generate trims the brief and carries projectId only when one is open", () => {
    const body = buildWebsiteGenerateBody({
      template: "artist-site",
      businessName: "  TRGDY TRBLZ ",
      description: "  A homepage with my latest single. ",
      style: " bold ",
      colorScheme: " black and gold ",
      clientRef: "ref-1",
    });
    expect(Object.keys(body)).toEqual([
      "template",
      "businessName",
      "description",
      "style",
      "colorScheme",
      "clientRef",
    ]);
    expect(body).toEqual({
      template: "artist-site",
      businessName: "TRGDY TRBLZ",
      description: "A homepage with my latest single.",
      style: "bold",
      colorScheme: "black and gold",
      clientRef: "ref-1",
    });
    const targeted = buildWebsiteGenerateBody({
      template: "press-kit",
      businessName: "X",
      description: "d",
      style: "",
      colorScheme: "",
      projectId: "p-9",
      clientRef: "ref-2",
    });
    expect(Object.keys(targeted)).toContain("projectId");
    expect(targeted["projectId"]).toBe("p-9");
  });

  it("edit sends the working files untouched and the trimmed request", () => {
    const body = buildWebsiteEditBody({
      template: "artist-site",
      businessName: " TRGDY TRBLZ ",
      currentFiles: FILES,
      editRequest: "  make the hero darker ",
    });
    expect(Object.keys(body)).toEqual(["template", "businessName", "currentFiles", "editRequest"]);
    expect(body["currentFiles"]).toBe(FILES);
    expect(body["editRequest"]).toBe("make the hero darker");
    const targeted = buildWebsiteEditBody({
      template: "artist-site",
      businessName: "X",
      currentFiles: FILES,
      editRequest: "darker",
      projectId: "p-9",
    });
    expect(targeted["projectId"]).toBe("p-9");
  });

  it("save carries the brief as one object and the clientRef for idempotency", () => {
    const body = buildWebsiteSaveBody({
      clientRef: "ref-1",
      template: "tour-page",
      businessName: " TRGDY TRBLZ ",
      brief: { description: " d ", style: " s ", colorScheme: " c " },
      files: FILES,
    });
    expect(Object.keys(body)).toEqual(["clientRef", "template", "businessName", "brief", "files"]);
    expect(body["brief"]).toEqual({ description: "d", style: "s", colorScheme: "c" });
    expect(body["files"]).toBe(FILES);
  });
});

describe("normalizers", () => {
  it("a file map needs the completeness pair — index.html + styles.css", () => {
    expect(normalizeWebsiteFiles(FILES)).toEqual(FILES);
    expect(normalizeWebsiteFiles({ "index.html": "x" })).toBeNull();
    expect(normalizeWebsiteFiles({ "index.html": "x", "styles.css": 42 })).toBeNull();
    expect(normalizeWebsiteFiles(null)).toBeNull();
    expect(normalizeWebsiteFiles(["index.html"])).toBeNull();
  });

  it("the projects list drops a malformed row but never invents one", () => {
    const list = normalizeWebsiteProjects({ projects: [PROJECT, { id: "broken" }, null] });
    expect(list).toEqual([
      {
        id: PROJECT.id,
        name: "TRGDY TRBLZ",
        template: "artist-site",
        templateLabel: "Artist Site",
        versionCount: 3,
        latestVersion: 3,
        fileCount: 4,
        createdAt: PROJECT.createdAt,
        updatedAt: PROJECT.updatedAt,
      },
    ]);
    expect(normalizeWebsiteProjects({})).toBeNull();
    expect(normalizeWebsiteProjects({ projects: [] })).toEqual([]);
  });

  it("the detail carries the summary + brief + version metas", () => {
    const detail = normalizeWebsiteProjectDetail({
      project: { ...PROJECT, brief: { description: "d", style: "s", colorScheme: "c" } },
      versions: [
        {
          id: "v3",
          version: 3,
          source: "edit",
          note: "darker hero",
          fileCount: 4,
          createdAt: PROJECT.updatedAt,
        },
        { version: 2 },
      ],
    });
    expect(detail?.project.brief).toEqual({ description: "d", style: "s", colorScheme: "c" });
    expect(detail?.versions).toEqual([
      {
        id: "v3",
        version: 3,
        source: "edit",
        note: "darker hero",
        fileCount: 4,
        createdAt: PROJECT.updatedAt,
      },
    ]);
    expect(normalizeWebsiteProjectDetail({})).toBeNull();
    expect(normalizeWebsiteProjectDetail({ project: { name: "no id" } })).toBeNull();
  });

  it("a version payload without a real build is not a build", () => {
    const payload = normalizeWebsiteVersionPayload({
      projectId: PROJECT.id,
      version: 2,
      source: "generate",
      note: null,
      brief: { description: "d", style: "", colorScheme: "" },
      files: FILES,
      fileCount: 3,
      createdAt: PROJECT.createdAt,
    });
    expect(payload?.files).toEqual(FILES);
    expect(payload?.version).toBe(2);
    expect(
      normalizeWebsiteVersionPayload({ projectId: "p", version: 1, files: { "a.txt": "x" } }),
    ).toBeNull();
  });

  it("generate: no files, no result — and saved is false ONLY when the rail says so", () => {
    expect(normalizeWebsiteGenerateResult({ template: "artist-site" })).toBeNull();
    const result = normalizeWebsiteGenerateResult({
      files: FILES,
      templateLabel: "Artist Site",
      businessName: "TRGDY TRBLZ",
      fileCount: 3,
      seededFrom: { profile: true, brandKit: false, songs: 2, videos: 1, products: 0, shows: 3 },
      ownership: WEBSITE_BUILDER_OWNERSHIP_LINE,
      projectId: PROJECT.id,
      version: 1,
      saved: false,
    });
    expect(result?.saved).toBe(false);
    expect(result?.seededFrom).toEqual({
      profile: true,
      brandKit: false,
      songs: 2,
      videos: 1,
      products: 0,
      shows: 3,
    });
    const legacy = normalizeWebsiteGenerateResult({ files: FILES });
    expect(legacy?.saved).toBe(true);
    expect(legacy?.projectId).toBeNull();
    expect(legacy?.seededFrom).toBeNull();
  });

  it("edit + save results normalize their persistence tails", () => {
    const edit = normalizeWebsiteEditResult({ files: FILES, fileCount: 3 });
    expect(edit?.projectId).toBeNull();
    expect(edit?.saved).toBe(true);
    expect(normalizeWebsiteEditResult({ fileCount: 3 })).toBeNull();
    const save = normalizeWebsiteSaveResult({
      project: PROJECT,
      version: 4,
      created: false,
      deduplicated: true,
    });
    expect(save).toEqual({ project: expect.objectContaining({ id: PROJECT.id }), version: 4, created: false, deduplicated: true });
    expect(normalizeWebsiteSaveResult({ version: 1 })).toBeNull();
  });

  it("out-of-credits reads the 402 or the machine error name", () => {
    expect(websiteBuilderOutOfCredits(402, {})).toBe(true);
    expect(websiteBuilderOutOfCredits(200, { error: "out_of_credits" })).toBe(true);
    expect(websiteBuilderOutOfCredits(500, { error: "generation_failed" })).toBe(false);
    expect(websiteBuilderOutOfCredits(200, null)).toBe(false);
  });
});

describe("preview + zip + labels — the page's own logic", () => {
  it("the preview inliner swaps the stylesheet and script tags, escaping the script close", () => {
    const html = buildPreviewHtml({
      "index.html":
        "<head><link rel=\"stylesheet\" href=\"styles.css\"></head><body><script src=\"script.js\"></script></body>",
      "styles.css": "body{color:#000}",
      "script.js": "a</script>b",
    });
    expect(html).toContain("<style>\nbody{color:#000}\n</style>");
    expect(html).toContain("<script>\na<\\/script>b\n</script>");
    expect(buildPreviewHtml({ "index.html": "<p>x</p>", "styles.css": "" })).toBe("<p>x</p>");
  });

  it("zip names slug the site name the page's way", () => {
    expect(websiteZipFolderName("TRGDY TRBLZ")).toBe("trgdy-trblz-site");
    expect(websiteZipFileName("TRGDY TRBLZ")).toBe("trgdy-trblz-website.zip");
    /* Trailing punctuation slugs to a trailing dash — the page's own
       regex, kept faithful rather than prettied. */
    expect(websiteZipFolderName("  My  Site!! ")).toBe("my-site--site");
  });

  it("version sources read in the page's English words", () => {
    expect(websiteSourceLabel("generate")).toBe("Initial build");
    expect(websiteSourceLabel("regenerate")).toBe("Rebuild");
    expect(websiteSourceLabel("edit")).toBe("Edit");
    expect(websiteSourceLabel("restore")).toBe("Restore");
    expect(websiteSourceLabel("save")).toBe("Saved copy");
    expect(websiteSourceLabel("something-else")).toBe("something-else");
  });

  it("the ownership line is the rail's own response string, verbatim", () => {
    expect(rail).toContain(WEBSITE_BUILDER_OWNERSHIP_LINE);
  });
});

describe("the desk's registry entry", () => {
  it("promotion #97 names the desk, the stack, and the no-hosting law", () => {
    expect(WEBSITE_BUILDER_DESK_PROMOTION).toContain("#97 Website Builder");
    expect(WEBSITE_BUILDER_DESK_PROMOTION).toContain("My Studio stack");
    expect(WEBSITE_BUILDER_DESK_PROMOTION).toContain(
      "nothing is published or hosted on bowdownvisuals.com",
    );
    expect(WEBSITE_BUILDER_DESK_FOLLOW_ONS.length).toBeGreaterThan(0);
  });
});
