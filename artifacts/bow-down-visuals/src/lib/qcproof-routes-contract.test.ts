/**
 * qcproof-routes-contract.test.ts — QC-200 PRE-PROOF, routes cluster
 * (Q1–Q109 + Q198), stack1200 lane qcproof-routes.
 *
 * The QC-200 ledger (Oct 25, 2026, build ecc63098) marks all 109 route
 * points BLOCKED-signed-in: each line assembles code evidence (route
 * registered in a stated form, named component file substantive, shell
 * placement IN/OUTER, everything inside AppShell/GuestGate with a
 * RouteErrorBoundary fallback, redirect aliases landing on valid
 * targets with their ?tab=/?panel=/?subtab=/?view= params actually
 * consumed) but the signed-in walk was never run. This suite pins the
 * CODE CORE of every one of those claims against the CURRENT tree, so
 * a registration, form, shell or param-consumption regression fails
 * the build instead of waiting for the owner's sitting-A walk. The
 * live half (signed-in load, primary action, dead buttons,
 * one-website feel) stays the owner's walk — nothing here claims it.
 *
 * Corroborating shipped suites (not replaced): public-routes.test.ts
 * (the App.tsx ↔ ROUTE_MATRIX census), route-integrity.test.ts (every
 * literal link + every App.tsx redirect target resolves),
 * guest-gate-alias-behavior.test.ts (the gate's verdict performs
 * every alias in both auth states), my-projects-tabs.test.ts,
 * editor-mobile-sheet.test.ts (EDITOR_SECTION_IDS ↔ panels).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATCH_ALL_PATH, ROUTE_MATRIX } from "./public-routes";
import { EDITOR_SECTION_IDS } from "./editor-sections";
import { parseMyProjectsTab } from "./my-projects-tabs";

const srcRoot = fileURLToPath(new URL("..", import.meta.url));
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const pagesRoot = path.join(srcRoot, "pages");

function readSrc(rel: string): string {
  return readFileSync(path.join(srcRoot, rel), "utf8");
}

/* ---------- App.tsx zone split: AuthedLayout inner Switch vs outer ---------- */
const innerStart = appSource.indexOf("<AuthedLayout>");
const innerEnd = appSource.indexOf("</AuthedLayout>");
const innerSource = appSource.slice(innerStart, innerEnd);
const outerSource = appSource.slice(0, innerStart) + appSource.slice(innerEnd);

interface ExtractedRoute {
  path: string;
  body: string;
  zone: "IN" | "OUTER";
}

function extract(source: string, zone: "IN" | "OUTER"): ExtractedRoute[] {
  const out: ExtractedRoute[] = [];
  for (const m of source.matchAll(/<Route\s+path="([^"]+)"[^>]*>([\s\S]*?)<\/Route>/g)) {
    out.push({ path: m[1]!, body: m[2]!.replace(/\s+/g, " ").trim(), zone });
  }
  return out;
}

const allRoutes = [...extract(outerSource, "OUTER"), ...extract(innerSource, "IN")];
const routeByPath = new Map<string, ExtractedRoute[]>();
for (const r of allRoutes) {
  const list = routeByPath.get(r.path) ?? [];
  list.push(r);
  routeByPath.set(r.path, list);
}

/* ---------- lazy component var -> page module ---------- */
const componentModule = new Map<string, string>();
for (const m of appSource.matchAll(
  /const\s+(\w+)\s*=\s*lazyWithRetry\(\(\)\s*=>\s*import\("@\/pages\/([^"]+)"\)/g,
)) {
  componentModule.set(m[1]!, m[2]!);
}

function pageFileLines(moduleRel: string): { file: string; lines: number } | null {
  for (const cand of [`${moduleRel}.tsx`, `${moduleRel}.ts`, `${moduleRel}/index.tsx`]) {
    const full = path.join(pagesRoot, cand);
    if (existsSync(full)) {
      return { file: cand, lines: readFileSync(full, "utf8").split("\n").length };
    }
  }
  return null;
}

/* ---------- the ledger table (Q1–Q109) ---------- */
type Form =
  | "direct"
  | "protected"
  | "redirect"
  | "qpr"
  | "createredirect"
  | "wrapper-branddeals"
  | "wrapper-distribute"
  | "verticalhub"
  | "genrehub";

interface QEntry {
  q: number;
  path: string;
  form: Form;
  zone: "IN" | "OUTER";
  /** Component variable rendered (direct/protected/wrapper/hub forms). */
  component?: string;
  /** Redirect target exactly as written in App.tsx (alias forms). */
  redirectTo?: string;
  /** Page module (under src/pages) whose file must exist + be substantive:
   *  the component's own module, or the redirect target's module. */
  page: string;
  /** Hub slug argument (verticalhub / genrehub forms). */
  slug?: string;
}

const Q: QEntry[] = [
  { q: 1, path: "/", form: "direct", zone: "IN", component: "Home", page: "home" },
  { q: 2, path: "/academy", form: "direct", zone: "IN", component: "CreatorAcademy", page: "academy" },
  { q: 3, path: "/admin", form: "protected", zone: "IN", component: "Admin", page: "admin" },
  { q: 4, path: "/ai-audio", form: "qpr", zone: "IN", redirectTo: "/audio-studio?tab=aiaudio", page: "audio-studio" },
  { q: 5, path: "/albums", form: "redirect", zone: "OUTER", redirectTo: "/my-projects?tab=songs", page: "my-projects" },
  { q: 6, path: "/analytics", form: "redirect", zone: "OUTER", redirectTo: "/analytics-hub?tab=connected", page: "analytics-hub" },
  { q: 7, path: "/analytics-hub", form: "direct", zone: "IN", component: "AnalyticsHub", page: "analytics-hub" },
  { q: 8, path: "/app", form: "direct", zone: "OUTER", component: "AppPage", page: "app" },
  { q: 9, path: "/arcade", form: "protected", zone: "IN", component: "ArcadePage", page: "arcade" },
  { q: 10, path: "/artist-setup", form: "protected", zone: "IN", component: "ArtistSetup", page: "artist-setup" },
  { q: 11, path: "/artist-vault", form: "protected", zone: "IN", component: "ArtistVault", page: "artist-vault" },
  { q: 12, path: "/audio-cleanup", form: "redirect", zone: "OUTER", redirectTo: "/audio-studio?tab=cleanup", page: "audio-studio" },
  { q: 13, path: "/audio-studio", form: "protected", zone: "IN", component: "AudioStudio", page: "audio-studio" },
  { q: 14, path: "/beat-maker", form: "qpr", zone: "IN", redirectTo: "/audio-studio?tab=aiaudio&sub=beats", page: "audio-studio" },
  { q: 15, path: "/beats", form: "direct", zone: "IN", component: "Beats", page: "beats" },
  { q: 16, path: "/beta-access", form: "direct", zone: "OUTER", component: "BetaAccess", page: "beta-access" },
  { q: 17, path: "/books", form: "protected", zone: "IN", component: "Books", page: "books" },
  { q: 18, path: "/brand-calculator", form: "direct", zone: "OUTER", component: "BrandDealCalculator", page: "brand-calculator" },
  { q: 19, path: "/brand-deals", form: "wrapper-branddeals", zone: "OUTER", component: "BrandDeals", page: "brand-deals" },
  { q: 20, path: "/branding-kit", form: "direct", zone: "IN", component: "BrandingKit", page: "branding-kit" },
  { q: 21, path: "/branding-shop", form: "redirect", zone: "OUTER", redirectTo: "/branding-kit?tab=shop", page: "branding-kit" },
  { q: 22, path: "/broadcast", form: "redirect", zone: "OUTER", redirectTo: "/go-live", page: "go-live" },
  { q: 23, path: "/browse", form: "direct", zone: "OUTER", component: "Browse", page: "discovery/browse" },
  { q: 24, path: "/caption-styler", form: "qpr", zone: "IN", redirectTo: "/hooks?tab=styler", page: "hooks" },
  { q: 25, path: "/carousel-maker", form: "protected", zone: "IN", component: "CarouselMaker", page: "carousel-maker" },
  { q: 26, path: "/cartoon-studio", form: "redirect", zone: "IN", redirectTo: "/create?panel=cartoon", page: "create" },
  { q: 27, path: "/catalog-import", form: "protected", zone: "IN", component: "CatalogImport", page: "catalog-import" },
  { q: 28, path: "/challenge", form: "redirect", zone: "OUTER", redirectTo: "/contests", page: "contests" },
  { q: 29, path: "/channel-audit", form: "redirect", zone: "IN", redirectTo: "/analytics-hub?tab=channel-audit", page: "analytics-hub" },
  { q: 30, path: "/charts", form: "direct", zone: "OUTER", component: "Charts", page: "discovery/charts" },
  { q: 31, path: "/choose-artist", form: "protected", zone: "IN", component: "ChooseArtist", page: "choose-artist" },
  { q: 32, path: "/clip-maker", form: "redirect", zone: "OUTER", redirectTo: "/video-editor?tab=repurpose", page: "video-editor" },
  { q: 33, path: "/coach", form: "direct", zone: "IN", component: "MonetizationCoach", page: "coach" },
  { q: 34, path: "/collabs", form: "direct", zone: "IN", component: "Collabs", page: "collabs" },
  { q: 35, path: "/comment-replies", form: "qpr", zone: "OUTER", redirectTo: "/community?tab=replies", page: "community" },
  { q: 36, path: "/community", form: "direct", zone: "IN", component: "CommunityManager", page: "community" },
  { q: 37, path: "/contact", form: "direct", zone: "OUTER", component: "Contact", page: "contact" },
  { q: 38, path: "/content-calendar", form: "qpr", zone: "OUTER", redirectTo: "/scheduler?tab=calendar", page: "scheduler" },
  { q: 39, path: "/contests", form: "direct", zone: "IN", component: "Contests", page: "contests" },
  { q: 40, path: "/contracts", form: "protected", zone: "IN", component: "Contracts", page: "contracts" },
  { q: 41, path: "/copyright", form: "direct", zone: "IN", component: "CopyrightAssistant", page: "copyright" },
  { q: 42, path: "/cover-art", form: "qpr", zone: "IN", redirectTo: "/create?panel=coverart", page: "create" },
  { q: 43, path: "/create", form: "protected", zone: "IN", component: "Create", page: "create" },
  { q: 44, path: "/creator-pricing", form: "direct", zone: "OUTER", component: "CreatorPricing", page: "creator-pricing" },
  { q: 45, path: "/creator/domains", form: "protected", zone: "IN", component: "CreatorDomainsPage", page: "creator-domains" },
  { q: 46, path: "/credit-history", form: "protected", zone: "IN", component: "CreditHistory", page: "credit-history" },
  { q: 47, path: "/cursor-lab", form: "direct", zone: "OUTER", component: "CursorLab", page: "cursor-lab" },
  { q: 48, path: "/dashboard", form: "protected", zone: "IN", component: "Dashboard", page: "dashboard" },
  { q: 49, path: "/detector", form: "protected", zone: "IN", component: "MediaDetector", page: "media-detector" },
  { q: 50, path: "/discord-bot", form: "redirect", zone: "IN", redirectTo: "/go-live?tab=discord", page: "go-live" },
  { q: 51, path: "/distribute", form: "wrapper-distribute", zone: "OUTER", component: "Distribute", page: "distribute" },
  { q: 52, path: "/download", form: "direct", zone: "OUTER", component: "Download", page: "download" },
  { q: 53, path: "/earnings", form: "direct", zone: "IN", component: "Earnings", page: "earnings" },
  { q: 54, path: "/email-list", form: "direct", zone: "IN", component: "EmailList", page: "email-list" },
  { q: 55, path: "/events", form: "direct", zone: "OUTER", component: "Events", page: "events" },
  { q: 56, path: "/explore", form: "direct", zone: "OUTER", component: "Explore", page: "explore" },
  { q: 57, path: "/extension", form: "direct", zone: "OUTER", component: "Extension", page: "extension" },
  { q: 58, path: "/features", form: "direct", zone: "IN", component: "Features", page: "features" },
  { q: 59, path: "/feed", form: "redirect", zone: "IN", redirectTo: "/home?view=drops", page: "feed" },
  { q: 60, path: "/for", form: "direct", zone: "OUTER", component: "ForIndex", page: "seo/for-index" },
  { q: 61, path: "/for/educators", form: "verticalhub", zone: "OUTER", component: "VerticalHubBySlug", page: "seo/vertical-hub", slug: "educators" },
  { q: 62, path: "/for/musicians", form: "verticalhub", zone: "OUTER", component: "VerticalHubBySlug", page: "seo/vertical-hub", slug: "musicians" },
  { q: 63, path: "/for/podcasters", form: "verticalhub", zone: "OUTER", component: "VerticalHubBySlug", page: "seo/vertical-hub", slug: "podcasters" },
  { q: 64, path: "/for/streamers", form: "verticalhub", zone: "OUTER", component: "VerticalHubBySlug", page: "seo/vertical-hub", slug: "streamers" },
  { q: 65, path: "/for/tiktokers", form: "verticalhub", zone: "OUTER", component: "VerticalHubBySlug", page: "seo/vertical-hub", slug: "tiktokers" },
  { q: 66, path: "/for/youtubers", form: "verticalhub", zone: "OUTER", component: "VerticalHubBySlug", page: "seo/vertical-hub", slug: "youtubers" },
  { q: 67, path: "/gamers", form: "redirect", zone: "IN", redirectTo: "/go-live?tab=gamers", page: "go-live" },
  { q: 68, path: "/generations", form: "redirect", zone: "IN", redirectTo: "/my-projects?tab=history", page: "my-projects" },
  { q: 69, path: "/genres", form: "direct", zone: "OUTER", component: "Genres", page: "discovery/genres" },
  { q: 70, path: "/genres/country", form: "genrehub", zone: "OUTER", component: "GenreHubBySlug", page: "seo/genre-hub", slug: "country" },
  { q: 71, path: "/genres/edm", form: "genrehub", zone: "OUTER", component: "GenreHubBySlug", page: "seo/genre-hub", slug: "edm" },
  { q: 72, path: "/genres/hip-hop", form: "genrehub", zone: "OUTER", component: "GenreHubBySlug", page: "seo/genre-hub", slug: "hip-hop" },
  { q: 73, path: "/genres/lofi", form: "genrehub", zone: "OUTER", component: "GenreHubBySlug", page: "seo/genre-hub", slug: "lofi" },
  { q: 74, path: "/genres/pop", form: "genrehub", zone: "OUTER", component: "GenreHubBySlug", page: "seo/genre-hub", slug: "pop" },
  { q: 75, path: "/genres/rnb", form: "genrehub", zone: "OUTER", component: "GenreHubBySlug", page: "seo/genre-hub", slug: "rnb" },
  { q: 76, path: "/genres/rock", form: "genrehub", zone: "OUTER", component: "GenreHubBySlug", page: "seo/genre-hub", slug: "rock" },
  { q: 77, path: "/genres/trap", form: "genrehub", zone: "OUTER", component: "GenreHubBySlug", page: "seo/genre-hub", slug: "trap" },
  { q: 78, path: "/go-live", form: "protected", zone: "IN", component: "GoLive", page: "go-live" },
  { q: 79, path: "/go-live/controller", form: "protected", zone: "IN", component: "StreamControllerPage", page: "stream-controller" },
  { q: 80, path: "/group-detail", form: "redirect", zone: "OUTER", redirectTo: "/groups", page: "groups" },
  { q: 81, path: "/groups", form: "direct", zone: "OUTER", component: "Groups", page: "groups" },
  { q: 82, path: "/guides", form: "redirect", zone: "OUTER", redirectTo: "/academy?tab=guides", page: "academy" },
  { q: 83, path: "/hashtag", form: "redirect", zone: "OUTER", redirectTo: "/trending", page: "trending" },
  { q: 84, path: "/home", form: "protected", zone: "OUTER", component: "SocialHome", page: "feed" },
  { q: 85, path: "/hooks", form: "direct", zone: "IN", component: "HookStudio", page: "hooks" },
  { q: 86, path: "/hub", form: "createredirect", zone: "IN", redirectTo: "/create?panel=hub", page: "create" },
  { q: 87, path: "/import", form: "protected", zone: "OUTER", component: "MediaImport", page: "import" },
  { q: 88, path: "/interview-prep", form: "direct", zone: "OUTER", component: "InterviewPrep", page: "interview-prep" },
  { q: 89, path: "/intros-outros", form: "redirect", zone: "OUTER", redirectTo: "/branding-kit?tab=intros", page: "branding-kit" },
  { q: 90, path: "/jewelry", form: "redirect", zone: "IN", redirectTo: "/branding-kit?tab=jewelry", page: "branding-kit" },
  { q: 91, path: "/jewelry-shop", form: "direct", zone: "OUTER", component: "JewelryShop", page: "jewelry-shop" },
  { q: 92, path: "/label-pitch", form: "protected", zone: "IN", component: "LabelPitch", page: "label-pitch" },
  { q: 93, path: "/library", form: "protected", zone: "IN", component: "Library", page: "library" },
  { q: 94, path: "/live-shopping", form: "protected", zone: "IN", component: "LiveShopping", page: "live-shopping" },
  { q: 95, path: "/llc-guide", form: "direct", zone: "IN", component: "LlcGuide", page: "llc-guide" },
  { q: 96, path: "/locations", form: "redirect", zone: "IN", redirectTo: "/video-editor?tab=locations", page: "video-editor" },
  { q: 97, path: "/login", form: "direct", zone: "OUTER", component: "Login", page: "login" },
  { q: 98, path: "/logo-maker", form: "redirect", zone: "OUTER", redirectTo: "/branding-kit?tab=logo", page: "branding-kit" },
  { q: 99, path: "/lyric-video", form: "redirect", zone: "IN", redirectTo: "/video-editor?tab=lyric-video", page: "video-editor" },
  { q: 100, path: "/make-song", form: "createredirect", zone: "IN", redirectTo: "/create?panel=song", page: "create" },
  { q: 101, path: "/make-video", form: "createredirect", zone: "IN", redirectTo: "/create?panel=video", page: "create" },
  { q: 102, path: "/mastering", form: "redirect", zone: "IN", redirectTo: "/audio-studio?tab=master&mode=quick", page: "audio-studio" },
  { q: 103, path: "/memberships", form: "direct", zone: "IN", component: "Memberships", page: "memberships" },
  { q: 104, path: "/merch", form: "qpr", zone: "IN", redirectTo: "/branding-kit?tab=shop&subtab=merch", page: "branding-kit" },
  { q: 105, path: "/messages", form: "protected", zone: "IN", component: "Messages", page: "messages" },
  { q: 106, path: "/mix-master", form: "qpr", zone: "IN", redirectTo: "/audio-studio?tab=master", page: "audio-studio" },
  { q: 107, path: "/move-home", form: "protected", zone: "IN", component: "MoveHome", page: "move-home" },
  { q: 108, path: "/movies", form: "protected", zone: "IN", component: "Movies", page: "movies" },
  { q: 109, path: "/music-sales", form: "redirect", zone: "IN", redirectTo: "/store/dashboard?view=digital", page: "store-dashboard" },
];

/* ---------- per-point contract ---------- */
describe("QC-200 routes contract — Q1–Q109 registration, form, shell, file", () => {
  it("the table itself covers Q1–Q109 exactly once (vacuity guard)", () => {
    expect(Q).toHaveLength(109);
    expect(new Set(Q.map((e) => e.q)).size).toBe(109);
    expect(new Set(Q.map((e) => e.path)).size).toBe(109);
    expect(Math.min(...Q.map((e) => e.q))).toBe(1);
    expect(Math.max(...Q.map((e) => e.q))).toBe(109);
  });

  for (const entry of Q) {
    it(`Q${entry.q} ${entry.path} — registered exactly once, ledger form + shell`, () => {
      const found = routeByPath.get(entry.path) ?? [];
      expect(found, `${entry.path} registrations`).toHaveLength(1);
      const route = found[0]!;
      expect(route.zone, `${entry.path} shell zone`).toBe(entry.zone);
      const body = route.body;
      switch (entry.form) {
        case "direct":
          expect(body).toBe(`<${entry.component} />`);
          break;
        case "protected":
          expect(body).toBe(
            `<ProtectedRoute><${entry.component} /></ProtectedRoute>`,
          );
          break;
        case "redirect":
          expect(body).toBe(`<Redirect to="${entry.redirectTo}" />`);
          break;
        case "qpr":
          expect(body).toBe(
            `<QueryPreservingRedirect to="${entry.redirectTo}" />`,
          );
          break;
        case "createredirect":
          expect(body).toBe(`<CreateRedirect to="${entry.redirectTo}" />`);
          break;
        case "wrapper-branddeals":
          expect(body).toBe(`<BrandDealsRoute />`);
          break;
        case "wrapper-distribute":
          expect(body).toBe(`<DistributeRoute />`);
          break;
        case "verticalhub":
          expect(body).toBe(
            `<VerticalHubBySlug slug="${entry.slug}" />`,
          );
          break;
        case "genrehub":
          expect(body).toBe(`<GenreHubBySlug slug="${entry.slug}" />`);
          break;
      }
    });

    it(`Q${entry.q} ${entry.path} — named component file exists and is substantive`, () => {
      if (entry.component) {
        // The rendered variable must be the lazy import of the named module.
        expect(componentModule.get(entry.component!), entry.component).toBe(entry.page);
      }
      const info = pageFileLines(entry.page);
      expect(info, `pages/${entry.page}`).not.toBeNull();
      // Ledger line counts run 90–6051; the smallest current Q file is
      // trending.tsx at ~92 lines. 60 is a stub tripwire, not a target.
      expect(info!.lines, `pages/${info!.file} lines`).toBeGreaterThanOrEqual(60);
      const text = readFileSync(path.join(pagesRoot, info!.file), "utf8");
      expect(text).toMatch(/export\s+(default|function|const|\{)/);
    });

    if (entry.redirectTo) {
      it(`Q${entry.q} ${entry.path} — redirect target is a registered route`, () => {
        const targetPath = entry.redirectTo!.split(/[?#]/)[0]!;
        expect(routeByPath.get(targetPath) ?? [], targetPath).toHaveLength(1);
        const matrix = ROUTE_MATRIX.find((e) => e.path === entry.path);
        expect(matrix?.disposition).toBe("redirect");
        expect(matrix?.redirectTo).toBe(entry.redirectTo);
      });
    }
  }
});

/* ---------- shell invariants claimed on every ledger line ---------- */
describe("QC-200 routes contract — the shared shell every line claims", () => {
  it("every Q route sits inside AppShell's GuestGate, inside RouteErrorBoundary", () => {
    const gateOpen = appSource.indexOf("<GuestGate>");
    const gateClose = appSource.indexOf("</GuestGate>");
    const boundaryOpen = appSource.indexOf("<RouteErrorBoundary");
    const boundaryClose = appSource.indexOf("</RouteErrorBoundary>");
    expect(gateOpen).toBeGreaterThan(-1);
    expect(boundaryOpen).toBeGreaterThan(-1);
    expect(boundaryOpen).toBeLessThan(gateOpen);
    expect(gateClose).toBeLessThan(boundaryClose);
    for (const entry of Q) {
      const at = appSource.indexOf(`<Route path="${entry.path}"`);
      expect(at, entry.path).toBeGreaterThan(gateOpen);
      expect(at, entry.path).toBeLessThan(gateClose);
    }
    // The boundary is keyed by location (a trip clears on navigation).
    expect(appSource).toContain("<RouteErrorBoundary key={location}>");
    expect(appSource).toContain("class RouteErrorBoundary");
  });

  it("AuthedLayout is the sidebar shell (AppSidebar + VideoBanner + content panel)", () => {
    const layout = appSource.slice(
      appSource.indexOf("function AuthedLayout"),
      appSource.indexOf("function AppShell"),
    );
    expect(layout).toContain("<AppSidebar />");
    expect(layout).toContain("<VideoBanner />");
    expect(layout).toContain("content-panel");
    // And the inner Switch is mounted inside it.
    expect(appSource).toContain("<AuthedLayout>");
  });

  it("the two wrapper routes forward ?subtab= as initialTab (Q19/Q51 contract)", () => {
    expect(appSource).toContain("function BrandDealsRoute()");
    expect(appSource).toContain(
      'subtab === "pitch" || subtab === "finder" || subtab === "marketplace"',
    );
    expect(appSource).toContain("function DistributeRoute()");
    expect(appSource).toContain(
      'subtab === "plan" || subtab === "new" || subtab === "releases"',
    );
  });
});

/* ---------- alias params are consumed by the target page ---------- */
function unionMembers(source: string, re: RegExp): Set<string> {
  const m = source.match(re);
  const members = new Set<string>();
  if (m) {
    for (const q of m[1]!.matchAll(/"([^"]+)"/g)) members.add(q[1]!);
  }
  return members;
}

describe("QC-200 routes contract — alias params land in the target's consumed set", () => {
  it("audio-studio StudioTab consumes aiaudio / cleanup / master (Q4/Q12/Q102/Q106)", () => {
    const src = readSrc("pages/audio-studio.tsx");
    const tabs = unionMembers(src, /type StudioTab = ([^;]+);/);
    expect(tabs.size).toBeGreaterThanOrEqual(10);
    for (const t of ["aiaudio", "cleanup", "master"]) {
      expect(tabs.has(t), t).toBe(true);
    }
    // The tab state is actually read from ?tab= on mount.
    expect(src).toContain('get("tab")');
    // Q102's mode=quick rides the same page's mode reader.
    expect(src).toContain('get("mode") === "quick"');
  });

  it("AiAudio sub-tab consumes sub=beats (Q14), plus sfx/samples siblings", () => {
    const src = readSrc("pages/ai-audio.tsx");
    const tabs = unionMembers(src, /type AiAudioTab = ([^;]+);/);
    expect(tabs).toEqual(new Set(["beats", "samples", "sfx"]));
    expect(src).toContain('params.get("sub")');
  });

  it("create isPanel consumes cartoon / coverart / song / video / hub (Q26/Q42/Q86/Q100/Q101)", () => {
    const src = readSrc("pages/create.tsx");
    const panels = unionMembers(src, /export type CreatePanel = ([^;]+);/);
    for (const p of ["cartoon", "coverart", "song", "video", "hub"]) {
      expect(panels.has(p), p).toBe(true);
    }
    expect(src).toContain("function isPanel(");
    expect(src).toContain('get("panel")');
  });

  it("branding-kit tabs consume shop / intros / jewelry / logo (Q21/Q89/Q90/Q98)", () => {
    const src = readSrc("pages/branding-kit.tsx");
    const tabs = unionMembers(src, /type TabKey = ([^;]+);/);
    for (const t of ["shop", "intros", "jewelry", "logo"]) {
      expect(tabs.has(t), t).toBe(true);
    }
    expect(src).toContain('get("tab")');
  });

  it("BrandingShop consumes subtab=merch under the shop tab (Q104)", () => {
    const src = readSrc("pages/branding-shop.tsx");
    expect(src).toContain('q.get("subtab") === "merch"');
  });

  it("go-live LiveTab consumes discord / gamers (Q50/Q67)", () => {
    const src = readSrc("pages/go-live.tsx");
    const tabs = unionMembers(src, /type LiveTab = ([^;]+);/);
    expect(tabs).toEqual(
      new Set(["broadcast", "golive", "shows", "discord", "gamers", "copilot"]),
    );
    expect(src).toContain('get("tab")');
  });

  it("scheduler consumes ?tab=calendar (Q38) — its default and named tab", () => {
    const src = readSrc("pages/scheduler.tsx");
    const tabs = unionMembers(src, /type Tab = ([^;]+);/);
    expect(tabs.has("calendar")).toBe(true);
    expect(src).toContain('get("tab")');
    // The initialiser falls through to the calendar tab, so the alias's
    // ?tab=calendar lands on Calendar — not on a hub default elsewhere.
    expect(src).toContain('return "calendar"');
  });

  it("analytics-hub consumes tab=connected and tab=channel-audit (Q6/Q29)", () => {
    const src = readSrc("pages/analytics-hub.tsx");
    expect(src).toContain('params.get("tab") === "connected"');
    expect(src).toContain('params.get("tab") === "channel-audit"');
  });

  it("hooks consumes tab=styler (Q24)", () => {
    const src = readSrc("pages/hooks.tsx");
    const tabs = unionMembers(src, /type TabKey = ([^;]+);/);
    expect(tabs.has("styler")).toBe(true);
    expect(src).toContain('tabParam === "styler"');
  });

  it("my-projects consumes tab=songs and tab=history (Q5/Q68) — real parser", () => {
    expect(parseMyProjectsTab("?tab=songs")).toBe("songs");
    expect(parseMyProjectsTab("?tab=history")).toBe("history");
    const src = readSrc("pages/my-projects.tsx");
    expect(src).toContain("parseMyProjectsTab(window.location.search)");
  });

  it("academy consumes tab=guides (Q82)", () => {
    const src = readSrc("pages/academy.tsx");
    expect(src).toContain('q === "guides"');
    expect(src).toContain('get("tab")');
  });

  it("store-dashboard consumes view=digital (Q109)", () => {
    const src = readSrc("pages/store-dashboard.tsx");
    expect(src).toContain('get("view") === "digital"');
  });

  it("feed (SocialHome) consumes view=drops (Q59/Q84)", () => {
    const src = readSrc("pages/feed.tsx");
    expect(src).toContain('get("view") === "drops"');
  });

  it("community consumes tab=replies (Q35)", () => {
    const src = readSrc("pages/community.tsx");
    expect(src).toContain('get("tab") === "replies"');
  });

  it("video-editor deep-link set consumes repurpose / locations / lyric-video (Q32/Q96/Q99)", () => {
    for (const t of ["repurpose", "locations", "lyric-video"]) {
      expect(EDITOR_SECTION_IDS.includes(t as never), t).toBe(true);
    }
    const src = readSrc("pages/video-editor.tsx");
    expect(src).toContain('params.get("tab")');
    expect(src).toContain("RAIL_TAB_IDS");
  });
});

/* ---------- Q198: the alias census, config + shipped behaviour pin ---------- */
describe("QC-200 Q198 — alias config half on this lineage", () => {
  it("App.tsx aliases == ROUTE_MATRIX redirect entries, zero mismatches both directions", () => {
    const appRedirects = new Map<string, string>();
    for (const r of allRoutes) {
      const m = r.body.match(
        /<(?:Redirect|QueryPreservingRedirect|CreateRedirect)\b[^>]*\bto="([^"]+)"/,
      );
      if (m) appRedirects.set(r.path, m[1]!);
    }
    const matrixRedirects = new Map<string, string>();
    for (const e of ROUTE_MATRIX) {
      if (e.disposition === "redirect") matrixRedirects.set(e.path, e.redirectTo!);
    }
    // The ledger counted exactly 70 at ecc63098; the table has grown
    // since (bare front doors added by later stacks). The invariant
    // Q198 actually asserts is the two-direction zero-mismatch diff —
    // pinned here at the current count so silent growth/shrinkage
    // shows up as a diff to review, not a drift nobody notices.
    expect(appRedirects.size).toBe(73);
    expect(matrixRedirects.size).toBe(73);
    expect(appRedirects).toEqual(matrixRedirects);
    // Whole-table reconciliation, catch-all included.
    expect(ROUTE_MATRIX.length).toBe(allRoutes.length + 1);
    expect(ROUTE_MATRIX.some((e) => e.path === CATCH_ALL_PATH)).toBe(true);
  });

  it("the seven incident aliases keep their exact targets (Q198 named set)", () => {
    const expected: Record<string, string> = {
      "/sponsor-dashboard": "/sponsors/dashboard",
      "/tip-page": "/tips",
      "/nfc-card-profile": "/nfc-cards",
      "/group-detail": "/groups",
      "/challenge": "/contests",
      "/albums": "/my-projects?tab=songs",
      "/hashtag": "/trending",
    };
    for (const [alias, target] of Object.entries(expected)) {
      const entry = ROUTE_MATRIX.find((e) => e.path === alias);
      expect(entry?.redirectTo, alias).toBe(target);
    }
    expect(
      ROUTE_MATRIX.find((e) => e.path === "/video-studio")?.redirectTo,
    ).toBe("/video-editor");
  });

  it("the shipped guest-gate behaviour pin still exists for the in-session half", () => {
    const pin = path.join(srcRoot, "components/guest-gate-alias-behavior.test.ts");
    expect(existsSync(pin)).toBe(true);
    const text = readFileSync(pin, "utf8");
    expect(text).toContain("resolveGateVerdict");
    expect(text).toContain("EVERY redirect disposition in the matrix resolves");
  });
});
