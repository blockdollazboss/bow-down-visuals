/**
 * error-truth-2-guard.test.ts — the empty-lie guard (stack1000 Lane Q1).
 *
 * The disease: a data loader catches a fetch failure (or a non-OK response)
 * and falls through to the surface's EMPTY state — "No books yet", "Your
 * vault is empty", "No dates yet" — telling the user their account holds
 * nothing when the page simply couldn't reach it. The mirror shapes ride
 * along: a failure dressed as a missing thing (a live shop rendered "Shop
 * not found"), a failure dressed as eternal loading (the World catalog),
 * and the inverse lie — a charged finder calling a successful EMPTY answer
 * a failure ("Show hunt failed" on zero matches).
 *
 * Every surface fixed by Lane Q1 is pinned here in the L1 guard idiom:
 *  - the loader SETS its failure state on the failure path,
 *  - the render carries an error branch (with a wired retry) that is
 *    evaluated BEFORE / INSTEAD OF the empty branch,
 *  - the old lying shape cannot creep back (forbidden patterns).
 *
 * Behavioural render tests are not available in this harness (vitest node
 * environment, no DOM library — the same constraint L1's guard works
 * under), so the pins assert the source shapes that produce the two
 * different renders and the working retry wiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

interface SurfacePin {
  name: string;
  file: string;
  /** The failure state is set on the loader's failure path. */
  failureSet: RegExp;
  /** The error render exists (retry control / gated error branch). */
  errorRender: RegExp;
  /** When set: [errorMarker, emptyMarker] — error must appear first. */
  order?: [RegExp, RegExp];
  /** Shapes that must never come back. */
  forbidden?: RegExp[];
  /** Extra invariants specific to the surface. */
  extra?: Array<[string, RegExp]>;
}

const SURFACES: SurfacePin[] = [
  {
    name: "choose-artist vault load (the named instance)",
    file: "pages/choose-artist.tsx",
    failureSet: /setLoadError\(true\)/,
    errorRender: /data-testid="btn-retry-vaults"/,
    order: [/loadError \?/, /vaults\.length === 0 \?/],
    forbidden: [/silently show empty state/],
  },
  {
    name: "ArtistVaultSelector vault load",
    file: "components/ArtistVaultSelector.tsx",
    failureSet: /setLoadError\(true\)/,
    errorRender: /data-testid="btn-retry-vaults"/,
    order: [/!loaded && loadError/, /!loaded && vaults\.length === 0/],
    forbidden: [/\/\* silent \*\//],
  },
  {
    name: "LinkedCharactersSection links load",
    file: "components/LinkedCharactersSection.tsx",
    failureSet: /setLoadError\(true\)/,
    errorRender: /data-testid="btn-retry-links"/,
    order: [/loadError \?/, /links\.length === 0 \?/],
    forbidden: [/\/\* show empty \*\//],
  },
  {
    name: "artist-vault page vault list",
    file: "pages/artist-vault.tsx",
    failureSet: /setVaultsError\(true\)/,
    errorRender: /data-testid="btn-retry-vaults"/,
    order: [/vaultsError && vaults\.length === 0/, /emptyProfilesTitle/],
    extra: [["fetchVaults throws on non-OK", /async function fetchVaults[\s\S]{0,600}?if \(!res\.ok\) throw/]],
  },
  {
    name: "books library load",
    file: "pages/books.tsx",
    failureSet: /setLoadError\(true\)/,
    errorRender: /data-testid="btn-retry-books"/,
    order: [/loadError \?/, /books\.length === 0 \?/],
    forbidden: [/toast\(\{ title: "Failed to load books"/],
  },
  {
    name: "promo-clip project picker load",
    file: "pages/promo-clip.tsx",
    failureSet: /setProjectsError\(true\)/,
    errorRender: /data-testid="btn-retry-projects"/,
    order: [/projectsError \?/, /promo-clip\.noProjects/],
    extra: [["loadProjects has a catch (it had none)", /async function loadProjects\(\) \{[\s\S]{0,700}?catch \{/]],
  },
  {
    name: "tour dates load",
    file: "pages/tour.tsx",
    failureSet: /setDatesError\(true\)/,
    errorRender: /data-testid="btn-retry-dates"/,
    order: [/datesError \?/, /dates\.length === 0 \?/],
    forbidden: [/dates list is a nicety/],
  },
  {
    name: "branding-shop orders load",
    file: "pages/branding-shop.tsx",
    failureSet: /setOrdersError\(true\)/,
    errorRender: /data-testid="btn-retry-orders"/,
    order: [/ordersError \?/, /orders\.length === 0 \?/],
    forbidden: [/orders list is best-effort/],
    extra: [["loadOrders checks res.ok before trusting the body", /async function loadOrders\(\) \{[\s\S]{0,500}?if \(!res\.ok\) throw/]],
  },
  {
    name: "distribute song library load",
    file: "pages/distribute.tsx",
    failureSet: /setSongsError\(true\)/,
    errorRender: /data-testid="btn-retry-songs"/,
    order: [/songsError \?/, /no_songs_in_your_library_yet_gen/],
    forbidden: [/empty library still renders/],
  },
  {
    name: "sample-clearance declarations + offers loads",
    file: "components/sample-clearance/SampleClearancePanel.tsx",
    failureSet: /setDeclLoadFailed\(true\)/,
    errorRender: /data-testid="btn-retry-declarations"/,
    order: [/declLoadFailed \?/, /declarations\.length === 0 \?/],
    forbidden: [/honest silence on the panel body/],
    extra: [
      ["offers leg has its own failure flag", /setOffersLoadFailed\(true\)/],
      ["offers retry is wired", /data-testid="btn-retry-offers"/],
      ["offers error renders before the marketplace-empty copy", /offersLoadFailed \?[\s\S]{0,900}?No licensable beats/],
    ],
  },
  {
    name: "songs page covers panel",
    file: "pages/songs.tsx",
    failureSet: /setCoversError\(songId\)/,
    errorRender: /btn-retry-covers-/,
    forbidden: [/\/\* empty state shown \*\//],
    extra: [
      ["mashups panel has its own failure state", /setMashupsError\(songId\)/],
      ["mashups retry is wired", /btn-retry-mashups-/],
      ["covers error renders before the no-covers copy", /coversError === s\.id \?[\s\S]{0,1200}?No covers yet/],
      ["mashups error renders before the empty copy", /mashupsError === s\.id \?[\s\S]{0,1200}?mashupsUsingThisEmpty/],
    ],
  },
  {
    name: "leaderboard widget board load",
    file: "components/retention/LeaderboardWidget.tsx",
    failureSet: /setBoardFailed\(true\)/,
    errorRender: /data-testid="btn-retry-board"/,
    order: [/boardFailed && !board/, /board_empty/],
    extra: [["a settled rejection also fails the board", /bRes\.status === "fulfilled" && bRes\.value\.ok[\s\S]{0,1400}?setBoardFailed\(true\)/]],
  },
  {
    name: "unlock gates load",
    file: "components/promote/UnlockGatesPanel.tsx",
    failureSet: /setLoadFailed\(true\)/,
    errorRender: /data-testid="btn-retry-gates"/,
    forbidden: [/setErr\("Couldn't load your unlock gates\."\); setGates\(\[\]\)/],
    extra: [["a failed load leaves gates null so the empty line cannot render", /setGates\(null\)/]],
  },
  {
    name: "live stage desk streams load",
    file: "components/go-live/LiveStageDesk.tsx",
    failureSet: /setStreamsError\(true\)/,
    errorRender: /data-testid="btn-retry-streams"/,
    extra: [["the picker option itself tells the truth", /streamsError \? "Couldn't load your streams" : "No streams yet"/]],
  },
  {
    name: "sound detail page (failure is not a missing sound)",
    file: "pages/sound.tsx",
    failureSet: /setLoadFailed\(true\)/,
    errorRender: /data-testid="btn-retry-sound"/,
    order: [/!data && loadFailed/, /That sound's not on the map\./],
    extra: [
      ["a real 404 is recognised separately", /res\.status === 404/],
      ["the not-heard toast only fires after the 404 check", /res\.status === 404[\s\S]{0,700}?Never heard of that sound/],
    ],
  },
  {
    name: "shop page (failure is not a missing shop)",
    file: "pages/shop.tsx",
    failureSet: /setLoadFailed\(true\)/,
    errorRender: /data-testid="btn-retry-shop"/,
    order: [/loadFailed \?/, /notFound \|\| !shop/],
    extra: [
      ["a real 404 is recognised separately", /res\.status === 404/],
      ["non-OK responses throw into the failure state", /if \(!res\.ok\) throw new Error\(String\(res\.status\)\)/],
    ],
    forbidden: [/catch \{\s*if \(!cancelled\) setNotFound\(true\)/],
  },
  {
    name: "press-kit kits leg",
    file: "pages/press-kit.tsx",
    failureSet: /setKitsError\(true\)/,
    errorRender: /data-testid="btn-retry-kits"/,
    order: [/kitsError && kits\.length === 0/, /t\("press-kit\.emptyKits"\)/],
  },
  {
    name: "world screen catalog (failure is not eternal loading)",
    file: "pages/world.tsx",
    failureSet: /setCatalogFailed\(true\)/,
    errorRender: /data-testid="btn-retry-world-catalog"/,
    order: [/catalog === null && catalogFailed/, /Nothing playable yet/],
    forbidden: [/the panel keeps its honest empty states/],
  },
  {
    name: "show finder (an empty answer is not a failed hunt)",
    file: "pages/shows.tsx",
    failureSet: /setResults\(data\.opportunities\)/,
    errorRender: /shows\.noMatches/,
    forbidden: [/!Array\.isArray\(data\.opportunities\) \|\| data\.opportunities\.length === 0/],
    extra: [["the throw guard covers transport + shape only", /if \(!res\.ok \|\| !Array\.isArray\(data\.opportunities\)\) \{\s*throw/]],
  },
  {
    name: "brand-deal hunt (an empty answer is not a failed hunt)",
    file: "pages/brand-deals.tsx",
    failureSet: /setDeals\(data\.deals\)/,
    errorRender: /brandDeals\.noMatchesHunt/,
    forbidden: [/!Array\.isArray\(data\.deals\) \|\| data\.deals\.length === 0/],
    extra: [["the throw guard covers transport + shape only", /if \(!res\.ok \|\| !Array\.isArray\(data\.deals\)\) \{\s*throw/]],
  },
  {
    /* Q1 recorded this corner as observed-not-fixed; the stack1100
       residuals round-up convicted it: local-first library + a
       swallowed server merge meant a signed-in member whose sounds
       live on the server (made on another device) was told "Nothing
       here yet — generate your first sound effect" when the merge
       leg failed. Only the narrow shape is pinned: signed-in, local
       empty, merge failed. A member with local sounds renders their
       real list either way. */
    name: "ai-audio SFX library server merge (the cross-device corner)",
    file: "pages/ai-audio.tsx",
    failureSet: /setLibrarySyncFailed\(true\)/,
    errorRender: /data-testid="btn-retry-sfx-library"/,
    order: [/librarySyncFailed && library\.length === 0 \?/, /library\.length === 0 \?/],
    forbidden: [/library merge is a nicety/],
    extra: [
      ["the merge throws on non-OK before trusting the body", /if \(!res\.ok\) throw new Error\("sfx library load failed"\)/],
      ["the retry is wired to the real merge loader", /onClick=\{\(\) => void loadServerLibrary\(\)\}/],
    ],
  },
];

describe("error-truth-2 guard — a failed load never renders as an empty account", () => {
  for (const s of SURFACES) {
    it(`${s.name}: failure state is set on the failure path`, () => {
      expect(read(s.file)).toMatch(s.failureSet);
    });
    it(`${s.name}: an error render with a wired retry exists`, () => {
      expect(read(s.file)).toMatch(s.errorRender);
    });
    if (s.order) {
      it(`${s.name}: the error branch is evaluated before the empty branch`, () => {
        const src = read(s.file);
        const [errRe, emptyRe] = s.order!;
        const errIdx = src.search(errRe);
        const emptyIdx = src.search(emptyRe);
        expect(errIdx, `error marker ${errRe} not found`).toBeGreaterThanOrEqual(0);
        expect(emptyIdx, `empty marker ${emptyRe} not found`).toBeGreaterThanOrEqual(0);
        expect(errIdx).toBeLessThan(emptyIdx);
      });
    }
    for (const bad of s.forbidden ?? []) {
      it(`${s.name}: the old lying shape stays gone (${bad})`, () => {
        expect(read(s.file)).not.toMatch(bad);
      });
    }
    for (const [label, re] of s.extra ?? []) {
      it(`${s.name}: ${label}`, () => {
        expect(read(s.file)).toMatch(re);
      });
    }
  }

  it("both label-pitch trackers set their failure state", () => {
    const src = read("pages/label-pitch.tsx");
    const bodies = src.split("async function loadTracker()").slice(1);
    expect(bodies.length).toBe(2);
    for (const body of bodies) {
      expect(body.slice(0, 600)).toMatch(/setTrackerError\(true\)/);
      expect(body.slice(0, 600)).toMatch(/if \(!res\.ok\) throw/);
    }
    expect(src).toMatch(/data-testid="btn-retry-tracker"/);
    expect(src).toMatch(/data-testid="btn-retry-playlist-tracker"/);
  });

  it("the fixed surfaces' error copy differs from their empty copy", () => {
    // The two renders must not be the same sentence wearing two hats:
    // every error testid in the table pairs with empty copy that never
    // claims a failure, and error copy that never claims emptiness.
    const pairs: Array<[string, RegExp, RegExp]> = [
      ["pages/choose-artist.tsx", /chooseArtist\.loadErrorTitle/, /chooseArtist\.emptyTitle/],
      ["pages/books.tsx", /We couldn(?:'|&apos;)t load your books/, /No books yet/],
      ["pages/tour.tsx", /tour\.datesLoadError/, /tour\.noDates/],
      ["pages/shop.tsx", /shop\.loadErrorTitle/, /shop\.notFoundTitle/],
      ["pages/shows.tsx", /shows\.noMatches/, /shows\.errorSearchFailed/],
      ["pages/brand-deals.tsx", /brandDeals\.noMatchesHunt/, /brandDeals\.errorHuntFailed/],
      ["pages/ai-audio.tsx", /sfx\.librarySyncFailed/, /sfx\.libraryEmpty/],
    ];
    for (const [file, errRe, emptyRe] of pairs) {
      const src = read(file);
      expect(src, `${file} error copy`).toMatch(errRe);
      expect(src, `${file} empty copy`).toMatch(emptyRe);
    }
  });
});
