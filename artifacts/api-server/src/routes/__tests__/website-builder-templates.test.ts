/**
 * Website Builder template gallery — GET /api/website-builder/templates
 * plus the gallery data contract.
 *
 * Pins:
 *  - the gallery holds at least 4 templates, one per creator vertical
 *    with the strongest AI Page Designer tuning (music, podcast, gaming,
 *    video), and every vertical is a real Page Designer vertical;
 *  - every template is a REAL starting build: its file map validates
 *    against the builder's build schema (siteFilesSchema — the same
 *    completeness rule generate/edit enforce on AI output) and carries
 *    the standard 5 files;
 *  - every gallery id is accepted by the generate AND edit schemas, so
 *    a remixed build can be refined and re-generated like any build;
 *  - creator facts in template copy are bracketed placeholders
 *    ([Your …]), never invented specifics, and there is no lorem ipsum;
 *  - GET /templates serves exactly the module data, free — no auth, no
 *    credit charge, no AI call.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  chargeCalls: [] as Array<{ userId: string; amount: number }>,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  chargeCredits: vi.fn(async (userId: string, amount: number) => {
    testState.chargeCalls.push({ userId, amount });
    return 0;
  }),
  refundCredits: vi.fn(async () => {}),
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  getOpenAI: () => ({
    chat: {
      completions: {
        create: vi.fn(async () => {
          throw new Error("AI must not be called by the gallery");
        }),
      },
    },
  }),
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_q: any, _s: any, n: any) => n(),
}));

import websiteBuilderRouter, {
  generateSchema,
  editSchema,
} from "../generate/website-builder";
import {
  WEBSITE_TEMPLATES,
  WEBSITE_TEMPLATE_IDS,
  TEMPLATE_VERTICALS,
  siteFilesSchema,
} from "../generate/website-templates";

/** The Page Designer's vertical list, read from its source so this pin
    catches drift between the designer and the gallery without importing
    the designer's whole router. */
function designerVerticals(): string[] {
  const src = readFileSync(
    new URL("../ai-page-designer.ts", import.meta.url),
    "utf8",
  );
  const m = src.match(/VERTICALS = \[([\s\S]*?)\] as const/);
  if (!m) throw new Error("could not find VERTICALS in ai-page-designer.ts");
  return [...m[1]!.matchAll(/"([a-z]+)"/g)].map((x) => x[1]!);
}

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {} };
    next();
  });
  app.use(websiteBuilderRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("gallery data", () => {
  it("has at least 4 templates spanning music, podcast, gaming, and video", () => {
    expect(WEBSITE_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    const verticals = new Set(WEBSITE_TEMPLATES.map((t) => t.vertical));
    for (const v of ["music", "podcast", "gaming", "video"]) {
      expect(verticals.has(v as any)).toBe(true);
    }
  });

  it("template ids are unique and exactly the exported id list", () => {
    const ids = WEBSITE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...WEBSITE_TEMPLATE_IDS].sort());
  });

  it("every template vertical is a real AI Page Designer vertical", () => {
    const designer = designerVerticals();
    expect(designer).toHaveLength(9);
    for (const t of WEBSITE_TEMPLATES) {
      expect(designer).toContain(t.vertical);
      expect(TEMPLATE_VERTICALS).toContain(t.vertical);
    }
    // The module's mirror list and the designer's list are the same set.
    expect([...TEMPLATE_VERTICALS].sort()).toEqual([...designer].sort());
  });

  it("every template carries plain-language metadata and a usable starter brief", () => {
    for (const t of WEBSITE_TEMPLATES) {
      expect(t.name.trim().length).toBeGreaterThan(0);
      expect(t.verticalLabel.trim().length).toBeGreaterThan(0);
      expect(t.bestFor.trim().length).toBeGreaterThan(10);
      expect(t.description.trim().length).toBeGreaterThan(20);
      expect(t.sections.length).toBeGreaterThanOrEqual(4);
      for (const s of t.sections) expect(s.trim().length).toBeGreaterThan(0);
      // The starter brief must itself satisfy the generate schema's
      // minimum description length, so remix -> "build my version" works.
      expect(t.brief.description.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("every template's files validate against the builder's build schema", () => {
    for (const t of WEBSITE_TEMPLATES) {
      const parsed = siteFilesSchema.safeParse(t.files);
      expect(parsed.success, `${t.id} must satisfy siteFilesSchema`).toBe(true);
      for (const required of [
        "index.html",
        "about.html",
        "styles.css",
        "script.js",
        "README.md",
      ]) {
        expect(
          typeof t.files[required] === "string" &&
            (t.files[required] as string).length > 0,
          `${t.id} must include ${required}`,
        ).toBe(true);
      }
      // The preview inliner depends on these exact references.
      expect(t.files["index.html"]).toContain('href="styles.css"');
      expect(t.files["index.html"]).toContain('src="script.js"');
    }
  });

  it("creator facts are bracketed placeholders — no invented specifics, no lorem ipsum", () => {
    for (const t of WEBSITE_TEMPLATES) {
      expect(
        t.files["index.html"],
        `${t.id} index must carry a [Your …] identity placeholder`,
      ).toContain("[Your");
      for (const [path, content] of Object.entries(t.files)) {
        expect(
          content.toLowerCase(),
          `${t.id}/${path} must not contain lorem ipsum`,
        ).not.toContain("lorem ipsum");
      }
    }
  });
});

describe("build-schema acceptance", () => {
  it("generate accepts every gallery template id", () => {
    for (const t of WEBSITE_TEMPLATES) {
      const parsed = generateSchema.safeParse({
        template: t.id,
        businessName: "Test Creator",
        description: t.brief.description,
      });
      expect(parsed.success, `generate must accept ${t.id}`).toBe(true);
    }
  });

  it("edit accepts every gallery template id with the template's own files as the current build", () => {
    for (const t of WEBSITE_TEMPLATES) {
      const parsed = editSchema.safeParse({
        template: t.id,
        businessName: "Test Creator",
        currentFiles: t.files,
        editRequest: "make the hero bigger",
      });
      expect(parsed.success, `edit must accept ${t.id}`).toBe(true);
    }
  });

  it("the original brief-only templates still validate (no regression)", () => {
    for (const id of ["press-kit", "link-in-bio", "tour-page"]) {
      expect(
        generateSchema.safeParse({
          template: id,
          businessName: "Test Creator",
          description: "a".repeat(24),
        }).success,
      ).toBe(true);
    }
  });
});

describe("GET /templates", () => {
  it("serves the gallery data exactly, free of charge", async () => {
    const res = await realFetch(`${baseUrl}/templates`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body.templates)).toBe(true);
    expect(body.templates).toHaveLength(WEBSITE_TEMPLATES.length);
    expect(body.templates.map((t: any) => t.id)).toEqual(
      WEBSITE_TEMPLATES.map((t) => t.id),
    );
    for (let i = 0; i < WEBSITE_TEMPLATES.length; i++) {
      // Remix seeds from these files — they must be the template's real
      // build, byte for byte.
      expect(body.templates[i].files).toEqual(WEBSITE_TEMPLATES[i]!.files);
      expect(body.templates[i].vertical).toBe(WEBSITE_TEMPLATES[i]!.vertical);
      expect(body.templates[i].bestFor).toBe(WEBSITE_TEMPLATES[i]!.bestFor);
    }
    expect(testState.chargeCalls).toHaveLength(0);
  });
});
