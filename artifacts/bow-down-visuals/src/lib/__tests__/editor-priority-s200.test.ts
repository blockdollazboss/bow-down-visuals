import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-200 editor priority lane — source pins for items 186/189/191.
 * (Behavioral pins for the result-meta formatter live in
 * lip-sync-result-meta.test.ts; these pin the wiring so the surfaces
 * cannot silently regress.)
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const editorPage = read("../../pages/video-editor.tsx");
const lipSyncSection = read("../../components/editor/sections/LipSyncSection.tsx");
const finalExport = read("../../components/FinalVideoExport.tsx");
const thyChat = read("../../components/ThyCheatCodeChat.tsx");

describe("186 — editor load: the Ask-Thy opener is not the chat UI", () => {
  it("video-editor imports openThyChat from the tiny lib module", () => {
    expect(editorPage).toContain('from "@/lib/open-thy-chat"');
    expect(editorPage).not.toContain('from "@/components/ThyCheatCodeChat"');
  });
  it("the chat component re-exports the opener for legacy import sites", () => {
    expect(thyChat).toContain('export { openThyChat } from "@/lib/open-thy-chat"');
  });
  it("on-demand surfaces are lazy: template picker + chroma preview", () => {
    expect(editorPage).toContain('const TemplatePicker = lazy(() => import("@/components/TemplatePicker"))');
    expect(editorPage).toContain("const ChromaKeyPreview = lazy(");
    expect(editorPage).not.toMatch(/^import .*TemplatePicker.* from/m);
    expect(editorPage).not.toMatch(/^import .*ChromaKeyPreview.* from/m);
  });
});

describe("191 — export honesty surfaces", () => {
  it("FinalVideoExport records and shows final dimensions for standard exports", () => {
    expect(finalExport).toContain("exportFinalDims");
    expect(finalExport).toContain('data-testid="export-final-size"');
    expect(finalExport).toContain("setExportFinalDims(");
  });
  it("LipSyncSection stores the 0230 resultMeta and renders it at completion", () => {
    expect(lipSyncSection).toContain("lipSyncResultMeta:");
    expect(lipSyncSection).toContain("formatLipSyncResultMeta(ce?.lipSyncResultMeta)");
    expect(lipSyncSection).toContain('data-testid="lipsync-result-meta"');
    expect(lipSyncSection).toContain("resultMeta: job.resultMeta ?? null");
  });
});

describe("189/60 — lip sync dark state is honest and brand-clean", () => {
  it("no Replit Secrets instructions remain in LipSyncSection", () => {
    expect(lipSyncSection).not.toContain("Replit Secrets");
    expect(lipSyncSection).not.toContain("I Have An API Key");
    expect(lipSyncSection).not.toContain("HeyGen, Sync.so, Hedra");
  });
  it("provider names are human labels, never the raw id", () => {
    expect(lipSyncSection).toContain("lipSyncProviderLabel(providerName)");
    expect(lipSyncSection).not.toContain("Connected · {providerName}");
  });
});
