/**
 * video-template-gallery-price.test.ts — the price on the gallery card
 * must be the price on the rail.
 *
 * Live verification (Oct 22, 2026) found the public gallery at
 * /templates/videos listing all 18 templates with NO price anywhere,
 * while applying one charges a flat 250 Visual Bucs in the editor flow
 * (confirmedFetch's pre-spend dialog). The gallery card now carries a
 * price chip whose value is VIDEO_TEMPLATE_APPLY_COST — read from the
 * central CREDIT_COSTS registry, the same entry the confirmation
 * dialog quotes. This suite pins the whole chain so the displayed
 * price cannot drift from the charge silently:
 *
 *   rail TEMPLATE_COST (api-server video-template.ts)
 *     == CREDIT_COSTS["/api/video-template/apply"]   (registry)
 *     == VIDEO_TEMPLATE_APPLY_COST                    (what the card renders)
 *
 * …and pins the card's render path itself: the page must render the
 * registry-derived export through the applyPrice locale key, and must
 * not grow a hardcoded price literal of its own.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "../lib/credit-costs";
import { VIDEO_TEMPLATE_APPLY_COST } from "./video-templates";

function readSrc(rel: string): string {
  const url = new URL(`../${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

function readApi(rel: string): string {
  const url = new URL(`../../../api-server/src/${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

/** Independent re-derivation of a server cost constant from the named
    server file itself (mirrors credit-costs-rail-truth.test.ts). */
function deriveServerConstant(rel: string, constant: string): number {
  const src = readApi(rel);
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*(?:Number\\(process\\.env\\[["'][A-Z0-9_]+["']\\](?:\\s*\\?\\?\\s*\\d+)?\\)\\s*\\|\\|\\s*)?(\\d+)\\b`,
  );
  const m = src.match(re);
  expect(m, `${constant} in ${rel}`).toBeTruthy();
  return Number(m![1]);
}

describe("video template gallery price == rail charge", () => {
  it("gallery export == registry == TEMPLATE_COST on the rail", () => {
    const rail = deriveServerConstant("routes/generate/video-template.ts", "TEMPLATE_COST");
    expect(rail).toBe(250);
    expect(CREDIT_COSTS["/api/video-template/apply"]?.cost).toBe(rail);
    expect(VIDEO_TEMPLATE_APPLY_COST).toBe(rail);
  });

  it("the gallery page renders the registry-derived price, never a hardcoded literal", () => {
    const page = readSrc("pages/templates/videos.tsx");
    expect(page).toContain("VIDEO_TEMPLATE_APPLY_COST");
    expect(page).toContain("videoTemplatesPage.applyPrice");
    expect(page).not.toMatch(/\b250\b/);
  });

  it("the editor panel initialises its price from the same registry-derived constant (Stack-28 item 17)", () => {
    const panel = readSrc("components/video-editor/TemplatesTabPanel.tsx");
    expect(panel).toContain("VIDEO_TEMPLATE_APPLY_COST");
    expect(panel).toContain("useState<number>(VIDEO_TEMPLATE_APPLY_COST ?? 0)");
    expect(panel).not.toContain("useState(250)");
    // The server catalog still overwrites the initial value with the
    // rail's own price before the apply CTA is reachable.
    expect(panel).toContain("if (typeof data.price === \"number\") setPrice(data.price);");
  });

  it("applyPrice exists in all 10 catalogs with the count + brand intact", () => {
    const catalogs = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"] as const;
    for (const lang of catalogs) {
      const url = new URL(`../locales/${lang}.json`, import.meta.url);
      const json = JSON.parse(readFileSync(url, "utf8")) as {
        videoTemplatesPage?: { applyPrice?: unknown };
      };
      const value = json.videoTemplatesPage?.applyPrice;
      expect(typeof value, `${lang} videoTemplatesPage.applyPrice`).toBe("string");
      expect(value as string).toContain("{{count}}");
      expect(value as string).toContain("Visual Bucs");
    }
  });
});
