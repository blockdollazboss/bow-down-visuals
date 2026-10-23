/**
 * honesty-copy-prices.test.ts — displayed prices in social/help/export
 * copy must equal what the rails charge (Stack-27 S27-21/22/25).
 *
 * S27-21: ConnectedAccounts + FacebookPostModal quoted 200 Visual Bucs
 * per social post while every publish rail charges 100. The copy now
 * derives its figure from the credit-costs registry via getCreditCost,
 * and these pins re-derive the rail constants from the server source
 * so display and charge cannot drift apart silently again.
 *
 * S27-22: HelpPanel quoted dead prices ("100–200 Visual Bucs each",
 * "video clips cost 500 Visual Bucs"). Its figures now come from the
 * registry too — except the top of the song range (1,200), which only
 * exists in the rail's SONG_PRICE_TIERS; that tier table is re-derived
 * from the server source here and pinned against the panel's literal.
 *
 * S27-25: FinalVideoExport's scene list printed raw provider names for
 * every provider except one. Both provider displays now render the
 * neutral sceneClip label; the raw-string fallbacks must never return.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, getCreditCost } from "./credit-costs";

function readApi(rel: string): string {
  const url = new URL(`../../../api-server/src/${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

function readComponent(rel: string): string {
  const url = new URL(`../components/${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

/** Re-derive a server cost constant (plain / env-default literal). */
function deriveServerConstant(rel: string, constant: string): number {
  const src = readApi(rel);
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*(?:Number\\(process\\.env\\[["'][A-Z0-9_]+["']\\](?:\\s*\\?\\?\\s*\\d+)?\\)\\s*\\|\\|\\s*)?(\\d+)\\b`,
  );
  const m = src.match(re);
  expect(m, `${constant} in ${rel}`).toBeTruthy();
  return Number(m![1]);
}

describe("S27-21 social publishing copy prices (100, derived)", () => {
  const SOCIAL = [
    { endpoint: "/api/social/instagram/publish", constant: "INSTAGRAM_POST_CREDITS" },
    { endpoint: "/api/social/facebook/publish", constant: "FACEBOOK_POST_CREDITS" },
    { endpoint: "/api/social/tiktok/publish", constant: "TIKTOK_POST_CREDITS" },
  ] as const;

  for (const spec of SOCIAL) {
    it(`${spec.endpoint}: registry == rail charge (100)`, () => {
      const rail = deriveServerConstant("routes/social.ts", spec.constant);
      expect(rail).toBe(100);
      expect(CREDIT_COSTS[spec.endpoint]?.cost).toBe(rail);
      expect(getCreditCost(spec.endpoint)?.cost).toBe(100);
    });
  }

  it("ConnectedAccounts carries no 200 Visual Bucs and derives each platform's cost", () => {
    const src = readComponent("ConnectedAccounts.tsx");
    expect(src).not.toContain("200 Visual Bucs");
    for (const spec of SOCIAL) {
      expect(src).toContain(`getCreditCost("${spec.endpoint}")`);
    }
    expect(src).toContain("{socialPostCost} Visual Bucs per post");
  });

  it("FacebookPostModal carries no 200 Visual Bucs and derives the Facebook cost in both spots", () => {
    const src = readComponent("FacebookPostModal.tsx");
    expect(src).not.toContain("200 Visual Bucs");
    expect(src).toContain('getCreditCost("/api/social/facebook/publish")');
    expect(src.match(/\{facebookPostCost\} Visual Bucs/g) ?? []).toHaveLength(2);
  });

  // Stack-28 #7/#8 (A2-02/A2-03): the Instagram and TikTok modals were
  // the two S27-21 misses — both hardcoded 200 while their rails charge
  // 100. They now derive from the registry exactly like Facebook's.
  it("InstagramPostModal carries no 200 Visual Bucs and derives the Instagram cost in both spots", () => {
    const src = readComponent("InstagramPostModal.tsx");
    expect(src).not.toContain("200 Visual Bucs");
    expect(src).toContain('getCreditCost("/api/social/instagram/publish")');
    expect(src.match(/\{instagramPostCost\} Visual Bucs/g) ?? []).toHaveLength(2);
  });

  it("TikTokPostModal carries no 200 Visual Bucs and derives the TikTok cost in both spots", () => {
    const src = readComponent("TikTokPostModal.tsx");
    expect(src).not.toContain("200 Visual Bucs");
    expect(src).toContain('getCreditCost("/api/social/tiktok/publish")');
    expect(src.match(/\{tiktokPostCost\} Visual Bucs/g) ?? []).toHaveLength(2);
  });
});

describe("S27-22 HelpPanel prices (rail-true, derived)", () => {
  it("the rail's song tiers are 400 / 800 / 1,200 and the registry base matches the first tier", () => {
    const src = readApi("routes/generate/music-audio.ts");
    const tiersBlock = src.slice(src.indexOf("SONG_PRICE_TIERS"));
    const tiers = [...tiersBlock.matchAll(/cost:\s*([\d_]+)/g)]
      .slice(0, 3)
      .map((m) => Number(m[1]!.replace(/_/g, "")));
    expect(tiers).toEqual([400, 800, 1200]);
    expect(CREDIT_COSTS["/api/generate-music-audio"]?.cost).toBe(tiers[0]);
  });

  it("registry figures the panel derives from are the rail-true ones", () => {
    expect(getCreditCost("/api/generate-video-plan")?.cost).toBe(200);
    expect(getCreditCost("/api/generate-promo-clips")?.cost).toBe(100);
    // Stack-28 #5 (A2-08) pin correction: this line pinned 100, but the
    // rail charges TEXT 100 + IMAGE 200 = 300 on delivery and pre-checks
    // 300 — 100 was the failure-path price. Pin now holds the rail truth.
    expect(getCreditCost("/api/generate-thumbnail")?.cost).toBe(300);
    expect(getCreditCost("/api/thumbnail-generator")?.cost).toBe(200);
    expect(getCreditCost("/api/generate-runway-clip")?.cost).toBe(400);
    // S27-73: the "/api/generate-video" registry entry was removed — that
    // endpoint never existed; the 400 clip price is pinned above against the
    // real rail (/api/generate-runway-clip) and the API rail constant.
  });

  it("HelpPanel carries no stale figures and derives its prices from the registry", () => {
    const src = readComponent("HelpPanel.tsx");
    expect(src).not.toContain("500 Visual Bucs");
    expect(src).not.toMatch(/100–200 Visual Bucs each/);
    expect(src).not.toContain("cost 100–200");
    expect(src).toContain('getCreditCost("/api/generate-music-audio")');
    expect(src).toContain('getCreditCost("/api/generate-video-plan")');
    expect(src).toContain('getCreditCost("/api/generate-promo-clips")');
    expect(src).toContain('getCreditCost("/api/generate-thumbnail")');
    expect(src).toContain('getCreditCost("/api/thumbnail-generator")');
    expect(src).toContain('getCreditCost("/api/generate-runway-clip")');
    /* The one literal the registry cannot supply: the song tier max,
       pinned here against the rail table derived above. */
    expect(src).toContain("SONG_COST_MAX = 1_200");
  });
});

describe("Stack-28 #6 homepage Promo Clips price (100, bundle 1,000)", () => {
  // A2-07: the homepage grid + FAQ quoted promo clips at 400 VB and a
  // 1,300 VB bundle; the rail charges 100 (routes/generate/promo.ts
  // CREDIT_COST), so the true bundle is 400+400+100+100 = 1,000.
  it("rail charges 100 and the registry agrees", () => {
    const rail = deriveServerConstant("routes/generate/promo.ts", "CREDIT_COST");
    expect(rail).toBe(100);
    expect(getCreditCost("/api/generate-promo-clips")?.cost).toBe(rail);
  });

  it("en catalog grid + FAQ and the hardcoded home.tsx FAQ carry 100 / 1,000", () => {
    const en = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8")) as {
      home: { studio: { tools: { title: string; cost: string }[] }[]; faqs: { a: string }[] };
    };
    const promo = en.home.studio.flatMap((c) => c.tools).find((t) => t.title === "Promo Clips");
    expect(promo?.cost).toBe("100 VB");
    const faq = en.home.faqs.map((f) => f.a).find((a) => a.includes("hook pack"));
    expect(faq).toContain("promo clips (100 VB)");
    expect(faq).toContain("= 1,000 Visual Bucs");
    const home = readFileSync(new URL("../pages/home.tsx", import.meta.url), "utf8");
    expect(home).toContain("promo clips (100 VB) + a hook pack (100 VB) = 1,000 Visual Bucs");
    expect(home).not.toContain("promo clips (400 VB)");
  });
});

describe("Stack-28 #10 Distribute sandbox qualifier at the sell + confirm moments", () => {
  // A2-10: the hero sold real platform delivery and the pre-spend
  // confirmation carried no sandbox qualifier while the default
  // aggregator is the mock/sandbox adapter. Both moments now carry the
  // same qualifier the in-flow badges use, gated on the server-reported
  // aggregator exactly like those badges.
  it("hero shows the sandbox line when the aggregator is mock", () => {
    const src = readFileSync(new URL("../pages/distribute.tsx", import.meta.url), "utf8");
    const hero = src.slice(src.indexOf("distribute.get_your_music_on_spotify_apple"));
    const heroBlock = hero.slice(0, 600);
    expect(heroBlock).toContain('pricing?.aggregator === "mock"');
    expect(heroBlock).toContain("distribute.sandbox_mode_statuses_will_simul");
  });

  it("the submit window.confirm appends the sandbox note in mock mode", () => {
    const src = readFileSync(new URL("../pages/distribute.tsx", import.meta.url), "utf8");
    expect(src).toContain('Sandbox simulation — the aggregator is in sandbox mode');
    expect(src).toContain("(release.aggregator ?? pricing?.aggregator) === \"mock\"");
  });
});

describe("S27-25 FinalVideoExport never displays a raw provider name", () => {
  it("scene list and check table render the neutral sceneClip label for any provider", () => {
    const src = readComponent("FinalVideoExport.tsx");
    expect(src).not.toContain("scene.provider ||");
    expect(src).not.toContain("row.provider ||");
    expect(src).not.toMatch(/scene\.provider === "Runway" \? t\("videoExport\.sceneClip"\)/);
    expect(src).toContain('scene.provider ? t("videoExport.sceneClip") : "—"');
    expect(src).toContain('row.provider ? t("videoExport.sceneClip") : "—"');
  });
});
