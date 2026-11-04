/**
 * page-module-placement (stack100 wave 1, item A5) — seven files sat in
 * src/pages/ that were never pages: every route that names them is a
 * redirect in App.tsx, and no route imports any of them as a page. They
 * survive only as modules — tab surfaces lazy-loaded (or statically
 * imported, for Guides) by real host pages — and sitting in pages/ they
 * inflated every route census, perf audit, and KB page-file sweep.
 *
 * They now live in the components/ area folders the codebase already
 * uses for embedded tool surfaces (audio-studio, hub, branding,
 * courses, go-live), with the same exports and the same consumers.
 * This pin holds the placement: the old addresses stay gone, the new
 * homes keep their exports, every importer resolves to the new home,
 * and the App.tsx redirects that are the modules' only routes stay
 * byte-identical — the move changed addresses, never behaviour.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

/** [old pages/ address, new components/ address, export markers the
    consumers rely on] — all paths relative to src/. */
const MOVED: Array<[string, string, string[]]> = [
  ["pages/sounds.tsx", "components/audio-studio/ViralSoundFinder.tsx", ["export default function ViralSoundFinder"]],
  ["pages/ai-audio.tsx", "components/audio-studio/AiAudio.tsx", ["export default function AiAudio", "export function BeatMakerModule"]],
  ["pages/hub.tsx", "components/hub/HubModule.tsx", ["export function HubModule", "export default function Hub"]],
  ["pages/branding-shop.tsx", "components/branding/BrandingShop.tsx", ["export default function BrandingShop"]],
  ["pages/jewelry.tsx", "components/branding/JewelryStudio.tsx", ["export default function JewelryStudio"]],
  ["pages/guides.tsx", "components/courses/Guides.tsx", ["export default function Guides"]],
  ["pages/shows.tsx", "components/go-live/ShowFinder.tsx", ["export default function ShowFinder"]],
];

/** [importer (src-relative), specifier it must now use] */
const IMPORTERS: Array<[string, string]> = [
  ["pages/audio-studio.tsx", 'import("@/components/audio-studio/AiAudio")'],
  ["pages/audio-studio.tsx", 'import("@/components/audio-studio/ViralSoundFinder")'],
  ["pages/create.tsx", 'import("@/components/hub/HubModule")'],
  ["pages/branding-kit.tsx", 'import("@/components/branding/BrandingShop")'],
  ["pages/branding-kit.tsx", 'import("@/components/branding/JewelryStudio")'],
  ["pages/academy.tsx", 'from "@/components/courses/Guides"'],
  ["pages/go-live.tsx", 'import("@/components/go-live/ShowFinder")'],
];

/** The old module specifiers — no source file may use any of them.
    The @/pages forms carry their closing quote: "@/pages/jewelry"
    must not false-positive on the real page "@/pages/jewelry-shop". */
const OLD_SPECIFIERS = [
  '@/pages/sounds"',
  '@/pages/ai-audio"',
  '@/pages/branding-shop"',
  '@/pages/jewelry"',
  '@/pages/guides"',
  '@/pages/shows"',
  '"./hub"',
  '"./ai-audio"',
];

/** The tree scan runs ONCE at module load, not inside the timed test
    body — a whole-src walk under CI contention outlives the default
    5s test timeout (the dialog-dismiss guard hit the same wall). */
const TREE_OFFENDERS: string[] = (() => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && entry.name !== "page-module-placement.test.ts") {
        const text = readFileSync(full, "utf8");
        for (const spec of OLD_SPECIFIERS) {
          if (text.includes(spec)) offenders.push(`${path.relative(SRC, full)} → ${spec}`);
        }
        for (const [oldPath] of MOVED) {
          if (text.includes(oldPath)) offenders.push(`${path.relative(SRC, full)} → ${oldPath}`);
        }
      }
    }
  };
  walk(SRC);
  return offenders;
})();

describe("A5 — the seven module-only files live in components/, not pages/", () => {
  it("none of the seven remains in pages/; each exists at its module home", () => {
    for (const [oldPath, newPath] of MOVED) {
      expect(existsSync(path.join(SRC, oldPath)), `${oldPath} must be gone from pages/`).toBe(false);
      expect(existsSync(path.join(SRC, newPath)), `${newPath} must exist`).toBe(true);
    }
  });

  it("each moved module keeps the exports its consumers import", () => {
    for (const [, newPath, markers] of MOVED) {
      const src = read(newPath);
      for (const marker of markers) {
        expect(src, `${newPath} must keep ${marker}`).toContain(marker);
      }
    }
  });

  it("every importer resolves to the new module home", () => {
    for (const [importer, specifier] of IMPORTERS) {
      expect(read(importer), `${importer} must use ${specifier}`).toContain(specifier);
    }
  });

  it("the hub module's own imports followed the move", () => {
    const hub = read("components/hub/HubModule.tsx");
    expect(hub).toContain('from "../audio-studio/AiAudio"');
    expect(hub).toContain('from "@/pages/thumbnail-studio"');
  });

  it("no source file still references an old module specifier (tree guard)", () => {
    expect(TREE_OFFENDERS).toEqual([]);
  });

  it("the seven routes are still the exact same redirects in App.tsx", () => {
    const app = read("App.tsx");
    for (const line of [
      '<Route path="/sounds"><Redirect to="/audio-studio?tab=sounds" /></Route>',
      '<Route path="/shows"><Redirect to="/go-live?tab=shows" /></Route>',
      '<Route path="/guides"><Redirect to="/academy?tab=guides" /></Route>',
      '<Route path="/branding-shop"><Redirect to="/branding-kit?tab=shop" /></Route>',
      '<Route path="/jewelry"><Redirect to="/branding-kit?tab=jewelry" /></Route>',
      '<Route path="/ai-audio"><QueryPreservingRedirect to="/audio-studio?tab=aiaudio" /></Route>',
      '<Route path="/hub"><CreateRedirect to="/create?panel=hub" /></Route>',
    ]) {
      expect(app, `App.tsx must keep ${line}`).toContain(line);
    }
  });
});
