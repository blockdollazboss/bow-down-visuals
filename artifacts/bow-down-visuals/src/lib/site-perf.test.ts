/**
 * site-perf (stack1300) — the site-wide performance lane's pins.
 *
 * The world-perf playbook applied to the rest of the site: every
 * fix is behaviour-preserving and measured from the production
 * build, and each is pinned at the source so the weight cannot
 * quietly grow back.
 *
 *  A. jsPDF loads on the CLICK, not the route: the portal's PDF
 *     builders (export-utils, MediaKitBuilder, SplitCalculator)
 *     reach jsPDF only through a dynamic import inside the
 *     async export handler — the ~399 KB library is its own
 *     chunk, fetched when a member actually exports a PDF.
 *  B. /create's ten mode panels ride lazy doors: the route
 *     renders exactly one panel at a time, so each panel chunk
 *     fetches on selection behind a framed Suspense fallback.
 *  C. /audio-studio's thirteen tab modules ride lazy doors;
 *     the three in-file panels (the default cleanup tab, stems,
 *     mix & master) stay in the page chunk.
 *  D. /thumbnail-studio's three photo desks (enhance /
 *     background / canvas editor) ride lazy doors.
 *  E. /analytics-hub's ten non-default tab panels ride lazy
 *     doors, one TabDoor per tab block; the default dashboard
 *     and the in-file connected-accounts tab stay static.
 *  F. /branding-kit's seven non-default tab tools ride lazy
 *     doors; the default brand tab stays static.
 *  G. /go-live's four off-console tab roots ride lazy doors;
 *     the default broadcast console's panel stack — which
 *     renders together — stays static.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(here, rel), "utf8");

const exportUtils = read("./export-utils.ts");
const mediaKit = read("../components/wave8/MediaKitBuilder.tsx");
const splitCalc = read("../components/wave8/SplitCalculator.tsx");
const createPage = read("../pages/create.tsx");
const audioStudio = read("../pages/audio-studio.tsx");
const thumbStudio = read("../pages/thumbnail-studio.tsx");
const analyticsHub = read("../pages/analytics-hub.tsx");
const brandingKit = read("../pages/branding-kit.tsx");
const goLive = read("../pages/go-live.tsx");

/** A runtime (non-type) static import of `mod` in `src`. */
function hasRuntimeStaticImport(src: string, mod: string): boolean {
  const re = new RegExp(`^\\s*import\\s+(?!type\\b)[^;]*?from\\s+"${mod.replace(/[/.]/g, "\\$&")}"`, "m");
  return re.test(src);
}

describe("A — jsPDF loads on the click, not the route", () => {
  it("export-utils reaches jsPDF only through a dynamic import", () => {
    expect(hasRuntimeStaticImport(exportUtils, "jspdf")).toBe(false);
    expect(exportUtils).toContain('const { jsPDF } = await import("jspdf");');
    expect(exportUtils).toContain("export async function downloadPdf");
  });

  it("MediaKitBuilder keeps only the type-only jsPDF import", () => {
    expect(hasRuntimeStaticImport(mediaKit, "jspdf")).toBe(false);
    expect(mediaKit).toContain('import type { jsPDF as JsPDFDoc } from "jspdf";');
    expect(mediaKit).toContain('const { jsPDF } = await import("jspdf");');
    expect(mediaKit).toContain("async function buildMediaKitPdf");
    expect(mediaKit).toContain("const doc = await buildMediaKitPdf(kit);");
  });

  it("SplitCalculator builds its PDF through a dynamic import", () => {
    expect(hasRuntimeStaticImport(splitCalc, "jspdf")).toBe(false);
    expect(splitCalc).toContain('const { jsPDF } = await import("jspdf");');
    expect(splitCalc).toContain("async function buildSplitPdf");
    expect(splitCalc).toContain("await buildSplitPdf(data);");
  });
});

describe("B — /create's mode panels ride lazy doors", () => {
  const doors = [
    'import("@/components/hub/HubModule")',
    'import("./make-song")',
    'import("./make-video")',
    'import("./song-and-video")',
    'import("@/components/wallpapers/WallpapersDesk")',
    'import("@/pages/cartoon-studio")',
    'import("@/pages/cover-art")',
    'import("@/components/create/DreamCollabPanel")',
    'import("@/components/create/LinkToHitPanel")',
    'import("@/components/create/CoverInMotionPanel")',
  ];

  it("all ten panels sit behind lazy() doors", () => {
    for (const door of doors) expect(createPage).toContain(door);
    expect(createPage.match(/lazy\(\(\) => import\(/g)).toHaveLength(10);
  });

  it("no panel rides a static import anymore", () => {
    expect(createPage).not.toContain('import { HubModule } from "@/components/hub/HubModule"');
    expect(createPage).not.toContain('import { MakeSongModule } from "./make-song"');
    expect(createPage).not.toContain('import { MakeVideoModule } from "./make-video"');
    expect(createPage).not.toContain('import { SongAndVideoModule } from "./song-and-video"');
    expect(createPage).not.toContain('import { WallpapersDesk } from "@/components/wallpapers/WallpapersDesk"');
    expect(createPage).not.toContain('import CartoonStudio from "@/pages/cartoon-studio"');
    expect(createPage).not.toContain('import CoverArt from "@/pages/cover-art"');
    expect(createPage).not.toContain('import DreamCollabPanel from "@/components/create/DreamCollabPanel"');
    expect(createPage).not.toContain('import LinkToHitPanel from "@/components/create/LinkToHitPanel"');
    expect(createPage).not.toContain('import CoverInMotionPanel from "@/components/create/CoverInMotionPanel"');
  });

  it("the panel block renders inside the framed Suspense fallback", () => {
    expect(createPage).toContain("function CreatePanelFallback()");
    expect(createPage).toContain("<Suspense fallback={<CreatePanelFallback />}>");
    // Deep-link behaviour preserved: the desk param still opens its panel,
    // and the cartoon hand-off still lands on the studio's video tab.
    expect(createPage).toContain('<CartoonStudio initialTab="video" />');
  });
});

describe("C — /audio-studio's tab modules ride lazy doors", () => {
  const doors = [
    'import("@/components/audio-studio/AiAudio")',
    'import("@/components/HumToSong")',
    'import("@/components/audio-studio/VoiceoverStudio")',
    'import("@/components/audio-studio/PodcastStudio")',
    'import("@/components/audio-studio/ViralSoundFinder")',
    'import("@/components/audio-studio/ArrangementStudio")',
    'import("@/components/audio-studio/FinishMySong")',
    'import("@/components/audio-studio/RateMyMix")',
    'import("@/components/audio-studio/PodcastTranscriptEditor")',
    'import("@/components/audio-studio/PodcastPublishPanel")',
    'import("@/components/audio/LufsPanel")',
    'import("@/components/audio/DeverbPanel")',
    'import("@/components/audio/VocalTunePanel")',
  ];

  it("all thirteen tab modules sit behind lazy() doors", () => {
    for (const door of doors) expect(audioStudio).toContain(door);
  });

  it("no tab module rides a static import anymore", () => {
    expect(audioStudio).not.toContain('import AiAudio from "@/components/audio-studio/AiAudio"');
    expect(audioStudio).not.toContain('import { HumToSong } from "@/components/HumToSong"');
    expect(audioStudio).not.toContain('import VoiceoverStudio from "@/components/audio-studio/VoiceoverStudio"');
    expect(audioStudio).not.toContain('import PodcastStudio from "@/components/audio-studio/PodcastStudio"');
    expect(audioStudio).not.toContain('import ViralSoundFinder from "@/components/audio-studio/ViralSoundFinder"');
  });

  it("the in-file panels and shared chrome stay in the page chunk", () => {
    expect(audioStudio).toContain("function CleanupPanel(");
    expect(audioStudio).toContain("function StemsPanel(");
    expect(audioStudio).toContain("function MixMasterPanel(");
    expect(audioStudio).toContain('import { LibrarySongPicker } from "@/components/audio-studio/LibrarySongPicker"');
    expect(audioStudio).toContain('import { VocalPolishModal } from "@/components/song/VocalPolishModal";');
    expect(audioStudio).toContain("<Suspense fallback={<AudioTabFallback />}>");
  });
});

describe("D — /thumbnail-studio's photo desks ride lazy doors", () => {
  it("all three desks sit behind lazy() doors under one Suspense", () => {
    expect(thumbStudio).toContain('import("@/components/photo/PhotoEnhance")');
    expect(thumbStudio).toContain('import("@/components/photo/BgStudio")');
    expect(thumbStudio).toContain('import("@/components/photo/PhotoCanvasEditor")');
    expect(thumbStudio).toContain("<Suspense fallback={<ThumbDeskFallback />}>");
  });

  it("no desk rides a static import; the in-file tabs stay in-file", () => {
    expect(thumbStudio).not.toContain('import { PhotoEnhance } from "@/components/photo/PhotoEnhance";');
    expect(thumbStudio).not.toContain('import { BgStudio } from "@/components/photo/BgStudio";');
    expect(thumbStudio).not.toContain('import { PhotoCanvasEditor } from "@/components/photo/PhotoCanvasEditor";');
    expect(thumbStudio).toContain("export function ThumbnailMakerModule()");
    expect(thumbStudio).toContain('{tab === "library" && <ThumbnailLibrary');
  });
});

describe("E — /analytics-hub's tab panels ride lazy doors", () => {
  const doors = [
    'import("@/components/analytics-hub/ContentIntelligenceChain")',
    'import("@/components/analytics-hub/RetentionDoctor")',
    'import("@/components/analytics-hub/MilestoneTracker")',
    'import("@/components/analytics-hub/ContentIdMonitor")',
    'import("@/components/trust/TrustPanels")',
    'import("@/components/analytics-hub/ChannelAuditPanel")',
    'import("@/components/analytics-hub/ViralityCheckPanel")',
    'import("@/components/analytics-hub/FanDecoderSection")',
    'import("@/components/analytics-hub/AudienceRoomPanel")',
  ];

  it("the panels sit behind lazy() doors (TrustPanels behind two)", () => {
    for (const door of doors) expect(analyticsHub).toContain(door);
    expect(analyticsHub.match(/import\("@\/components\/trust\/TrustPanels"\)/g)).toHaveLength(2);
    // AudienceRoomPanel is a NAMED export — its door must pick it
    // explicitly, or React.lazy gets a module with no default.
    expect(analyticsHub).toContain('import("@/components/analytics-hub/AudienceRoomPanel").then((m) => ({ default: m.AudienceRoomPanel }))');
  });

  it("no panel rides a static import anymore", () => {
    expect(analyticsHub).not.toContain('import ContentIntelligenceChain from');
    expect(analyticsHub).not.toContain('import { ClaimsPanel, RetentionPanel } from');
    expect(analyticsHub).not.toContain('import { AudienceRoomPanel } from');
  });

  it("each panel tab block renders behind its TabDoor", () => {
    expect(analyticsHub).toContain("function TabDoor(");
    for (const tab of ["intelligence", "contentid", "milestones", "channelAudit", "virality", "fandecoder", "audience"]) {
      /* Stack-200 hardening C (item 36): TabDoor became a Suspense +
         SectionBoundary pair and gained a per-tab name + the hubTab
         reset key — still exactly one door per tab block. */
      expect(analyticsHub).toContain(`<TabDoor name="analytics-tab-${tab.toLowerCase()}" resetKey={hubTab}>{hubTab === "${tab}" && (`);
    }
  });

  it("the default dashboard and in-file tab stay static", () => {
    expect(analyticsHub).toContain('import { MonthWrappedCard } from "@/components/MonthWrappedCard";');
    expect(analyticsHub).toContain("function ConnectedAccountsTab");
  });
});

describe("F — /branding-kit's tab tools ride lazy doors", () => {
  const doors = [
    'import("@/pages/logo-maker")',
    'import("@/pages/intros-outros")',
    'import("@/pages/stream-pack")',
    'import("@/components/branding/BrandingShop")',
    'import("@/components/branding/JewelryStudio")',
    'import("@/components/photo/HeadshotStudio")',
    'import("@/components/wallpapers/WallpapersDesk")',
  ];

  it("all seven non-default tools sit behind lazy() doors", () => {
    for (const door of doors) expect(brandingKit).toContain(door);
    expect(brandingKit).toContain("<Suspense fallback={<BrandingTabFallback />}>");
    // Keyed remounts on tab switch are preserved behind the doors.
    expect(brandingKit).toContain('key="wallpapers"');
  });

  it("the default brand tab stays static for an unchanged first paint", () => {
    expect(brandingKit).toContain('import { BrandKitPanel } from "@/components/branding/BrandKitPanel";');
    expect(brandingKit).not.toContain('import { LogoMakerTool } from "@/pages/logo-maker";');
    expect(brandingKit).not.toContain('import BrandingShop from "@/components/branding/BrandingShop";');
  });
});

describe("G — /go-live's off-console tabs ride lazy doors", () => {
  it("the four off-console roots sit behind lazy() doors", () => {
    expect(goLive).toContain('import("@/components/go-live/ShowFinder")');
    expect(goLive).toContain('import("@/pages/discord-bot")');
    expect(goLive).toContain('import("@/pages/gamers")');
    expect(goLive).toContain('import("@/components/go-live/StreamCopilotSection")');
    expect(goLive).toContain("<Suspense fallback={<LiveTabFallback />}>");
    expect(goLive).not.toContain('import ShowFinder from "@/components/go-live/ShowFinder";');
    expect(goLive).not.toContain('import GamersHub from "@/pages/gamers";');
  });

  it("the broadcast console stack — rendered together — stays static", () => {
    expect(goLive).toContain('import BroadcastStudio from "@/components/go-live/BroadcastStudio";');
    expect(goLive).toContain("<BroadcastStudio /><SongRequestDesk /><GuestPanel /><LiveBattlesPanel showMine />");
  });
});
