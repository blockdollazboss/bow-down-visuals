/**
 * section-boundary.test.ts — Stack-200 hardening wave, section C
 * (census items 41 + 43): per-section render-error isolation for the
 * signed-in feed (/home) and the public homepage.
 *
 * The defect: the app had exactly one error boundary — the App-level
 * RouteErrorBoundary around the whole Switch — so ANY section render
 * throw replaced the ENTIRE page. On /home, one malformed post whose
 * PostCard threw killed the timeline AND the composer (the user
 * couldn't even post). On the public homepage, one throwing marketing
 * section — WebGL hero pieces included — blanked the whole page for
 * every signed-out visitor. Owner law: "one bad section should never
 * take the whole dashboard down." /settings already isolates per
 * card (SettingsCardBoundary, QC-200 G4); this suite pins the generic
 * SectionBoundary extracted from that pattern and its two wirings.
 *
 * How it tests: vitest runs in node with no DOM harness, and React's
 * server renderers don't exercise class-boundary catches the way the
 * client renderer does, so the catch machinery is verified at the
 * level this repo's suites use for component contracts —
 *  (a) the REAL boundary class, instantiated directly: its derived
 *      error state, the fallback markup each variant renders, the
 *      healthy passthrough, and the retry handler's state math;
 *  (b) composition in the two pages' shapes: a failed post's compact
 *      fallback rendered alongside healthy posts, the composer and
 *      page content; a failed homepage section's card alongside its
 *      sibling sections — with the App-level boundary's fallback copy
 *      ("The vault guards tripped.") proven ABSENT, i.e. the section
 *      boundary caught it, not the page boundary;
 *  (c) source pins that feed.tsx and home.tsx actually wrap every
 *      surface named in census items 41 + 43, and that the catalogs
 *      carry the fallback copy. The client-side catch itself is
 *      React's documented class-boundary behavior — the same
 *      mechanism the production RouteErrorBoundary relies on.
 *
 * Locale honesty: the sectionBoundary.* strings are new copy. en
 * carries the source; the other nine catalogs carry the English text
 * VERBATIM as UNREVIEWED placeholders pending real translation (the
 * locale-completeness placeholder contract). The catalog test below
 * pins exactly that — when a real translation lands for a key, it
 * updates this pin in the same commit.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SectionBoundaryCore,
  type SectionBoundaryVariant,
} from "./section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const coreSource = read("./section-boundary.ts");
const wrapperSource = read("./SectionBoundary.tsx");
const feedSource = read("../pages/feed.tsx");
const homeSource = read("../pages/home.tsx");
const appSource = read("../App.tsx");

const LABELS = {
  title: "This section hit a snag",
  description:
    "Something glitched while this part of the page was loading. The rest of the page is fine — try this section again.",
  retryLabel: "Try again",
  postTitle: "This post couldn't be shown",
  composerTitle: "The composer hit a snag",
};

function makeBoundary(
  name: string,
  variant: SectionBoundaryVariant,
  child: ReactElement,
  opts: { isLight?: boolean; title?: string; fallbackClassName?: string } = {},
) {
  return new SectionBoundaryCore({
    name,
    variant,
    isLight: opts.isLight ?? false,
    title: opts.title ?? LABELS.title,
    description: LABELS.description,
    retryLabel: LABELS.retryLabel,
    fallbackClassName: opts.fallbackClassName,
    children: child,
  });
}

function failWith(boundary: SectionBoundaryCore, error: Error) {
  const derived = SectionBoundaryCore.getDerivedStateFromError(error);
  Object.assign(boundary.state, derived);
}

/* The server renderer escapes apostrophes in text (&#x27;) — decode
   before copy assertions so the pins read as the copy reads. */
const unescapeHtml = (html: string) => html.replace(/&#x27;/g, "'");

describe("SectionBoundary — healthy sections pass through untouched", () => {
  it("renders the child content with no error chrome (all variants)", () => {
    for (const variant of ["section", "compact", "silent"] as const) {
      const boundary = makeBoundary(
        "hero",
        variant,
        createElement("p", null, "HEALTHY SECTION"),
      );
      const html = renderToStaticMarkup(boundary.render() as ReactElement);
      expect(html, variant).toContain("HEALTHY SECTION");
      expect(html, variant).not.toContain('role="alert"');
      expect(html, variant).not.toContain("section-error");
    }
  });
});

describe("SectionBoundary — a failed section shows its OWN fallback", () => {
  it("getDerivedStateFromError captures the thrown error", () => {
    const boom = new Error("boom");
    expect(SectionBoundaryCore.getDerivedStateFromError(boom)).toEqual({
      error: boom,
    });
  });

  it("section variant: an honest error card with title, description and retry", () => {
    const boundary = makeBoundary(
      "pricing",
      "section",
      createElement("p", null, "PRICING SECTION"),
    );
    failWith(boundary, new Error("render blew up"));
    const html = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-testid="section-error-pricing"');
    expect(html).toContain('data-section-boundary="pricing"');
    expect(html).toContain(LABELS.title);
    expect(html).toContain("The rest of the page is fine");
    expect(html).toContain(LABELS.retryLabel);
    expect(html).toContain("<button");
    /* The failed section's own content is replaced, not half-rendered. */
    expect(html).not.toContain("PRICING SECTION");
  });

  it("compact variant: a slim contained row — label + retry, no description", () => {
    const boundary = makeBoundary(
      "post-abc",
      "compact",
      createElement("p", null, "ONE POST"),
      { title: LABELS.postTitle },
    );
    failWith(boundary, new Error("malformed post payload"));
    const html = unescapeHtml(
      renderToStaticMarkup(boundary.render() as ReactElement),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-testid="section-error-post-abc"');
    expect(html).toContain(LABELS.postTitle);
    expect(html).toContain(LABELS.retryLabel);
    expect(html).toContain("<button");
    /* Compact means compact: the long section description stays out. */
    expect(html).not.toContain("The rest of the page is fine");
    expect(html).not.toContain("ONE POST");
  });

  it("silent variant: a decorative piece degrades to nothing at all", () => {
    const boundary = makeBoundary(
      "hero-fog",
      "silent",
      createElement("p", null, "FOG CANVAS"),
    );
    failWith(boundary, new Error("WebGL context blew up"));
    const html = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(html).toBe("");
  });

  it("componentDidCatch reports the failing section by slug", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boundary = makeBoundary(
      "composer",
      "compact",
      createElement("p", null, "x"),
    );
    boundary.componentDidCatch(new Error("boom"), {
      componentStack: "\n    in Composer",
    } as never);
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0])).toContain(
      "[SectionBoundary:composer]",
    );
    spy.mockRestore();
  });

  it("fallbackClassName lands on the fallback root so pages can place the card", () => {
    const boundary = makeBoundary(
      "pricing",
      "section",
      createElement("p", null, "X"),
      { fallbackClassName: "mx-5 my-10 max-w-4xl lg:mx-auto" },
    );
    failWith(boundary, new Error("boom"));
    const html = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(html).toContain("mx-5 my-10 max-w-4xl lg:mx-auto");
  });
});

describe("SectionBoundary — fallback exists in BOTH themes", () => {
  it("light theme renders the ivory fallback, dark the solid dark slab", () => {
    for (const variant of ["section", "compact"] as const) {
      const light = makeBoundary("pricing", variant, createElement("p", null, "X"), {
        isLight: true,
      });
      failWith(light, new Error("boom"));
      const lightHtml = renderToStaticMarkup(light.render() as ReactElement);
      expect(lightHtml, variant).toContain("from-[#FCF7EA]");
      expect(lightHtml, variant).toContain("text-[#6B5B36]");

      const dark = makeBoundary("pricing", variant, createElement("p", null, "X"));
      failWith(dark, new Error("boom"));
      const darkHtml = renderToStaticMarkup(dark.render() as ReactElement);
      expect(darkHtml, variant).toContain("from-[#14100a]");
      expect(darkHtml, variant).not.toContain("from-[#FCF7EA]");
    }
  });
});

describe("SectionBoundary — retry remounts just the failed section", () => {
  it("handleRetry clears the error and bumps the remount attempt", () => {
    const boundary = makeBoundary(
      "pricing",
      "section",
      createElement("p", null, "HEALTHY SECTION"),
    );
    failWith(boundary, new Error("boom"));
    expect(boundary.state.error).not.toBeNull();
    const attemptBefore = boundary.state.attempt;
    let captured: unknown;
    boundary.setState = ((updater: unknown) => {
      captured = updater;
    }) as never;
    boundary.handleRetry();
    expect(typeof captured).toBe("function");
    const next = (captured as (s: typeof boundary.state) => object)(
      boundary.state,
    );
    Object.assign(boundary.state, next);
    expect(boundary.state.error).toBeNull();
    expect(boundary.state.attempt).toBe(attemptBefore + 1);
    const html = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(html).toContain("HEALTHY SECTION");
    expect(html).not.toContain('role="alert"');
  });

  it("the remount is keyed by attempt, so the section restarts from scratch", () => {
    expect(coreSource).toContain("key: this.state.attempt");
    expect(coreSource).toContain("attempt: s.attempt + 1");
  });
});

describe("feed shape — one bad post never takes the timeline or composer down", () => {
  it("a failed post's fallback renders alongside healthy posts, the composer and the rails", () => {
    const badPost = makeBoundary(
      "post-bad",
      "compact",
      createElement("article", null, "MALFORMED POST"),
      { title: LABELS.postTitle },
    );
    failWith(badPost, new Error("malformed post payload"));
    const goodPost = makeBoundary(
      "post-good",
      "compact",
      createElement("article", null, "HEALTHY POST"),
      { title: LABELS.postTitle },
    );
    const composer = makeBoundary(
      "composer",
      "compact",
      createElement("div", null, "COMPOSER BOX"),
      { title: LABELS.composerTitle },
    );
    const stories = makeBoundary(
      "stories-rail",
      "compact",
      createElement("div", null, "STORIES RAIL"),
    );
    const html = unescapeHtml(
      renderToStaticMarkup(
        createElement(
          "div",
          null,
          createElement("h1", null, "Your Timeline"),
          stories.render() as ReactElement,
          composer.render() as ReactElement,
          goodPost.render() as ReactElement,
          badPost.render() as ReactElement,
          createElement("span", null, "RETENTION RAIL BELOW"),
        ),
      ),
    );
    /* Page shell + composer + healthy neighbours all still render. */
    expect(html).toContain("Your Timeline");
    expect(html).toContain("STORIES RAIL");
    expect(html).toContain("COMPOSER BOX");
    expect(html).toContain("HEALTHY POST");
    expect(html).toContain("RETENTION RAIL BELOW");
    /* The bad post degrades to its own contained placeholder — an
       honest label, NOT a fake empty timeline. */
    expect(html).toContain('data-testid="section-error-post-bad"');
    expect(html).toContain(LABELS.postTitle);
    expect(html).not.toContain("MALFORMED POST");
    /* (c) The SECTION boundary caught it — the App-level page
       boundary's fallback never rendered. */
    expect(html).not.toContain("The vault guards tripped.");
  });

  it("a failed composer degrades alone — the posts still render", () => {
    const composer = makeBoundary(
      "composer",
      "compact",
      createElement("div", null, "COMPOSER BOX"),
      { title: LABELS.composerTitle },
    );
    failWith(composer, new Error("composer blew up"));
    const post = makeBoundary(
      "post-1",
      "compact",
      createElement("article", null, "HEALTHY POST"),
      { title: LABELS.postTitle },
    );
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        composer.render() as ReactElement,
        post.render() as ReactElement,
      ),
    );
    expect(html).toContain('data-testid="section-error-composer"');
    expect(html).toContain(LABELS.composerTitle);
    expect(html).toContain("HEALTHY POST");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("homepage shape — one bad section never blanks the homepage", () => {
  it("a failed section's card renders alongside the hero and sibling sections", () => {
    const pricing = makeBoundary(
      "pricing",
      "section",
      createElement("section", null, "PRICING BAND"),
      { fallbackClassName: "mx-5 my-10 max-w-4xl lg:mx-auto" },
    );
    failWith(pricing, new Error("pricing render blew up"));
    const hero = makeBoundary(
      "hero",
      "section",
      createElement("section", null, "HERO WITH DOORS"),
    );
    const faq = makeBoundary(
      "faq",
      "section",
      createElement("section", null, "FAQ BAND"),
    );
    const fog = makeBoundary(
      "hero-fog",
      "silent",
      createElement("canvas", null, "FOG"),
    );
    failWith(fog, new Error("WebGL context blew up"));
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        hero.render() as ReactElement,
        fog.render() as ReactElement,
        pricing.render() as ReactElement,
        faq.render() as ReactElement,
        createElement("footer", null, "FOOTER DOORS"),
      ),
    );
    expect(html).toContain("HERO WITH DOORS");
    expect(html).toContain("FAQ BAND");
    expect(html).toContain("FOOTER DOORS");
    expect(html).toContain('data-testid="section-error-pricing"');
    expect(html).not.toContain("PRICING BAND");
    /* The dead fog canvas left no trace and no error chrome. */
    expect(html).not.toContain("FOG");
    expect(html).not.toContain("section-error-hero-fog");
    /* (c) The page-level boundary never fired. */
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("SectionBoundary — the catch contract (source pins)", () => {
  it("is a real error boundary: derived state + didCatch with the section slug", () => {
    expect(coreSource).toContain("static getDerivedStateFromError");
    expect(coreSource).toContain("componentDidCatch");
    expect(coreSource).toContain("[SectionBoundary:${this.props.name}]");
  });

  it("is independent of the App-level RouteErrorBoundary", () => {
    /* No import of, and no inheritance from, the page boundary —
       the section boundary stands alone (its header comment names
       the App boundary only to document the relationship). */
    expect(coreSource).not.toMatch(/import[^;]*RouteErrorBoundary/);
    expect(wrapperSource).not.toMatch(/import[^;]*RouteErrorBoundary/);
    expect(coreSource).not.toContain("extends RouteErrorBoundary");
    /* …which still exists, with its own distinct page-level fallback. */
    expect(appSource).toContain("class RouteErrorBoundary");
    expect(appSource).toContain("The vault guards tripped.");
  });

  it("the exported wrapper resolves copy + theme for the class", () => {
    expect(wrapperSource).toContain("export function SectionBoundary");
    expect(wrapperSource).toContain('t("sectionBoundary.title"');
    expect(wrapperSource).toContain('t("sectionBoundary.description"');
    expect(wrapperSource).toContain('t("sectionBoundary.retry"');
    expect(wrapperSource).toContain('t("sectionBoundary.postTitle"');
    expect(wrapperSource).toContain('t("sectionBoundary.composerTitle"');
    expect(wrapperSource).toContain("useIsLightTheme()");
    expect(wrapperSource).toContain("SectionBoundaryCore");
  });
});

describe("feed.tsx — every census-41 surface is isolated (source pins)", () => {
  it("the composer is wrapped with its own label", () => {
    expect(feedSource).toMatch(
      /<SectionBoundary name="composer" variant="compact" label="composer">\s*<Composer/,
    );
  });

  it("every post in BOTH timeline slices renders through the per-post boundary", () => {
    expect(feedSource).toMatch(
      /<SectionBoundary key=\{p\.id\} name=\{`post-\$\{p\.id\}`\} variant="compact" label="post">\s*<PostCard/,
    );
    const slices = feedSource.match(/\.map\(renderPost\)/g) ?? [];
    expect(slices).toHaveLength(2);
  });

  it("the rails and the Drops view are wrapped", () => {
    expect(feedSource).toMatch(
      /<SectionBoundary name="stories-rail" variant="compact">\s*<StoriesRail/,
    );
    expect(feedSource).toMatch(
      /<SectionBoundary name="retention-rail" variant="compact">\s*<SocialRetentionRail/,
    );
    expect(feedSource).toMatch(
      /<SectionBoundary name="close-friends" variant="compact">\s*<CloseFriendsPanel/,
    );
    expect(feedSource).toMatch(
      /<SectionBoundary name="drops-wire">\s*<DropsWire/,
    );
  });

  it("feed.tsx carries exactly the six boundary usages", () => {
    const wraps = feedSource.match(/<SectionBoundary /g) ?? [];
    expect(wraps).toHaveLength(6);
    expect(feedSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });
});

describe("home.tsx — every census-43 surface is isolated (source pins)", () => {
  const SECTIONS: Array<[string, string]> = [
    ["hero", "HeroSection"],
    ["studio-set-strip", "StudioSetStrip"],
    ["social-proof", "SocialProofBand"],
    ["proof-band", "ProofBand"],
    ["cheat-code-demo", "CheatCodeDemo"],
    ["creator-vault", "CreatorVaultSection"],
    ["music-video-teaser", "MusicVideoTeaser"],
    ["how-it-works", "HowItWorks"],
    ["built-for-creators", "BuiltForCreators"],
    ["studio-showcase", "StudioShowcase"],
    ["templates-band", "TemplatesBand"],
    ["branding-shop", "BrandingShopSection"],
    ["pricing", "PricingSection"],
    ["promo-strip", "PromoStrip"],
    ["academy", "AcademySection"],
    ["faq", "FAQSection"],
    ["waitlist", "WaitlistSection"],
  ];

  it("wraps each top-level section in its own boundary", () => {
    for (const [slug, component] of SECTIONS) {
      const pattern = new RegExp(
        `<SectionBoundary name="${slug}" fallbackClassName=\\{SECTION_FALLBACK_CLASS\\}>\\s*<${component}[ />]`,
      );
      expect(homeSource, `${component} (${slug})`).toMatch(pattern);
    }
  });

  it("the ContestHub widget is wrapped inside its band", () => {
    expect(homeSource).toMatch(
      /<SectionBoundary name="contest-hub">\s*<ContestHubWidget/,
    );
  });

  it("the hero's canvas/WebGL pieces are individually SILENT-bounded", () => {
    const pieces: Array<[string, string]> = [
      ["hero-spotlights", "SpotlightRig"],
      ["hero-hanging-mic", "HangingMic"],
      ["hero-logo-3d", "HeroLogo3D"],
      ["hero-fog", "FogCanvas"],
    ];
    for (const [slug, component] of pieces) {
      /* [\\s/>]: FogCanvas opens with a newline before its props. */
      const pattern = new RegExp(
        `<SectionBoundary name="${slug}" variant="silent">\\s*<${component}[\\s/>]`,
      );
      expect(homeSource, `${component} (${slug})`).toMatch(pattern);
    }
  });

  it("home.tsx carries exactly the 22 boundary usages", () => {
    const wraps = homeSource.match(/<SectionBoundary /g) ?? [];
    expect(wraps).toHaveLength(22);
    expect(homeSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });
});

describe("sectionBoundary copy — present in all 10 catalogs (UNREVIEWED pin)", () => {
  const LOCALES = ["en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"];
  const KEYS = ["title", "description", "retry", "postTitle", "composerTitle"];
  const load = (loc: string) =>
    JSON.parse(read(`../locales/${loc}.json`)) as Record<string, unknown>;

  it("every catalog carries all five keys, non-empty", () => {
    for (const loc of LOCALES) {
      const ns = load(loc).sectionBoundary as Record<string, unknown>;
      expect(ns, loc).toBeTruthy();
      for (const k of KEYS) {
        expect(typeof ns[k] === "string" && (ns[k] as string).trim() !== "", `${loc}: sectionBoundary.${k}`).toBe(true);
      }
    }
  });

  it("non-en values are the English text verbatim — UNREVIEWED placeholders, not drafted translations", () => {
    const en = load("en").sectionBoundary as Record<string, string>;
    for (const loc of LOCALES.filter((l) => l !== "en")) {
      const ns = load(loc).sectionBoundary as Record<string, string>;
      for (const k of KEYS) {
        expect(ns[k], `${loc}: sectionBoundary.${k}`).toBe(en[k]);
      }
    }
  });
});
