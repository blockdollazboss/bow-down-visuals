import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { videoTemplateApplyCost } from "./templates-desk";

const src = (rel: string) => readFileSync(resolve(process.cwd(), "src", rel), "utf8");

const browse = src("components/world/native/TemplatesDesk.tsx");
const bench = src("components/world/native/VideoTemplateBench.tsx");
const panel = src("components/world/StationPanel.tsx");
const createDesks = src("components/world/native/CreateDesks.tsx");
const seam = src("lib/world/templates-desk.ts");
const COST = String(videoTemplateApplyCost());

describe("TemplatesDesk — the browse desk (source pins)", () => {
  it("is one native section riding the seam — no second catalog anywhere", () => {
    expect(browse).toContain('data-testid="world-templates-desk"');
    expect(browse).toContain("filterTemplateCards");
    expect(browse).toContain("templateCategories");
    expect(browse).toContain("TEMPLATE_GALLERIES");
    expect(browse).not.toContain("VIDEO_TEMPLATE_METAS");
    expect(browse).not.toContain("HOOK_TEMPLATES");
    expect(browse).not.toContain("fetch(");
  });

  it("Use rides the payload channel to the owning desk — never a page, never a link out", () => {
    expect(browse).toContain("templateUseTarget(card)");
    expect(browse).toContain("onOpenStation(target.stationId, target.payload)");
    expect(browse).not.toMatch(/<a\s/);
    expect(browse).not.toContain("window.open");
    expect(browse).not.toContain("href=");
    expect(browse).not.toContain("useLocation");
  });

  it("search + category chips are wired to the seam filter, with an honest no-matches state", () => {
    expect(browse).toContain('data-testid="world-templates-desk-search"');
    expect(browse).toContain('data-testid="world-templates-desk-no-matches"');
    expect(browse).toContain("worldDeskRemainder.tplNoMatches");
    expect(browse).toContain("setCategory(\"All\")");
  });

  it("the price line is registry-derived — the literal never appears; browsing stays free", () => {
    expect(browse).toContain("videoTemplateApplyCost()");
    expect(browse).toContain('data-testid="world-templates-desk-video-price"');
    expect(browse).toContain("worldDeskRemainder.tplVideoPrice");
    expect(browse).not.toContain(COST);
    expect(browse).not.toContain("confirmedFetch");
  });

  it("renders both themes from the one component", () => {
    expect(browse).toContain("isLight ? ");
  });
});

describe("VideoTemplateBench — the payload's receiving end (source pins)", () => {
  it("parses the raw panel payload through the seam's prefill (which wraps parsePanelPayloadFor)", () => {
    expect(bench).toContain('data-testid="world-video-template-bench"');
    expect(bench).toContain("videoTemplatePrefill(panelPayload)");
    expect(seam).toContain('parsePanelPayloadFor("video-desk", raw)');
  });

  it("loads the rail's catalog and fails honestly — error + Retry, never an empty shelf", () => {
    expect(bench).toContain("fetch(VIDEO_TEMPLATES_PATH");
    expect(bench).toContain("parseVideoTemplateCatalog");
    expect(bench).toContain('data-testid="world-video-template-bench-load-failed"');
    expect(bench).toContain("NativeErrorState");
    expect(bench).toContain("onRetry");
    expect(bench).toContain("NativeLoadingState");
  });

  it("the deep link preselects only a key the catalog itself carries", () => {
    expect(bench).toContain("catalog.find((t) => t.key === deepLinkKey)");
    expect(bench).toContain("appliedDeepLink");
  });

  it("apply drives the shared rail through the standing confirmation, quoted from the registry", () => {
    expect(bench).toContain("confirmedFetch(VIDEO_TEMPLATE_APPLY_PATH");
    expect(bench).toContain("buildVideoTemplateApplyBody");
    expect(bench).toContain("overrideCost: applyCost");
    expect(bench).toContain("overrideFeature: applyFeature");
    expect(bench).not.toMatch(/overrideCost:\s*\d/);
    expect(bench).not.toContain(COST);
    /* a declined confirmation returns to the form untouched */
    expect(bench).toContain("if (!res) return;");
    /* the balance read refreshes after a spend starts and lands */
    expect(bench).toContain("refreshProfile()");
  });

  it("polls the job rail and finishes in-world — result video, refund honesty on failure", () => {
    expect(bench).toContain("videoTemplateJobPath(jobId)");
    expect(bench).toContain("interpretTemplateJob");
    expect(bench).toContain('data-testid="world-video-template-bench-done"');
    expect(bench).toContain("worldDeskRemainder.vtbRefundSuffix");
    expect(bench).toContain('data-testid="world-video-template-bench-job-error"');
    expect(bench).toContain("worldDeskRemainder.vtbOutOfCredits");
  });

  it("slots fill by upload (R2, the panel's ceiling) or pasted link, gated by the seam's media rules", () => {
    expect(bench).toContain("r2UploadFile");
    expect(bench).toContain("VIDEO_TEMPLATE_UPLOAD_MAX_BYTES");
    expect(bench).toContain("slotAcceptsMedia");
    expect(bench).toContain("missingSlotLabels");
    expect(bench).not.toMatch(/<a\s/);
    expect(bench).not.toContain("window.open");
  });
});

describe("the mounts", () => {
  it("the browse desk stacks at the My Studio board after Setlist, payload handler threaded", () => {
    const lazyAt = panel.indexOf("const TemplatesDesk = lazy(");
    expect(lazyAt).toBeGreaterThan(-1);
    expect(panel).toContain('import("@/components/world/native/TemplatesDesk")');
    const setlistAt = panel.indexOf("<SetlistDesk isLight={isLight} />");
    const mountAt = panel.indexOf("<TemplatesDesk isLight={isLight} onOpenStation={props.onOpenStation} />");
    expect(setlistAt).toBeGreaterThan(-1);
    expect(mountAt).toBeGreaterThan(setlistAt);
    expect(panel.slice(mountAt - 700, mountAt)).toContain("desk\n                    #100");
  });

  it("the bench stacks inside the Video Desk under the storyboard pair, payload threaded raw", () => {
    expect(createDesks).toContain('import { VideoTemplateBench } from "./VideoTemplateBench";');
    const plannerAt = createDesks.indexOf("<StoryboardPlanner");
    const benchAt = createDesks.indexOf(
      "<VideoTemplateBench isLight={isLight} panelPayload={props.panelPayload ?? null} />",
    );
    expect(plannerAt).toBeGreaterThan(-1);
    expect(benchAt).toBeGreaterThan(plannerAt);
  });

  it("testids are unique across the two new components", () => {
    const ids = [...(browse + bench).matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]!);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(10);
  });
});
