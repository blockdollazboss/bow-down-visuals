/**
 * scheduler-publish bench — Stack-400 census B item B-12 source pins.
 * The publish bench is its own component file; SchedulerDesk.tsx
 * carries only the import + mount line inside the compose form (the
 * seam world-honesty re-verifies at its join, after this lane). The
 * pins hold: the charge rides confirmedFetch (never a bare fetch),
 * prices read the registry live through the desk seam, the
 * idempotency key retires only on success, TikTok's drafts honesty
 * and the 409 notice survive, and the worldSchedulerPublish catalog
 * namespace is complete in all 10 locales with no orphan keys.
 * Non-English values are the English source verbatim, flagged
 * UNREVIEWED house-style — never agent-translated.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bench = read("../../components/world/native/SchedulerPublishBench.tsx");
const desk = read("../../components/world/native/SchedulerDesk.tsx");
const seam = read("./scheduler-desk.ts");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ja", "ko", "hi", "ar"] as const;
type Catalog = Record<string, Record<string, string>>;
const catalogs = Object.fromEntries(
  LOCALES.map((loc) => [loc, JSON.parse(read(`../../locales/${loc}.json`)) as Catalog]),
) as Record<(typeof LOCALES)[number], Catalog>;

describe("the bench — shape and mount", () => {
  it("is a named component rooted at its testid, mounted once inside the compose form", () => {
    expect(bench).toContain(
      "export function SchedulerPublishBench({",
    );
    expect(bench).toContain('data-testid="world-scheduler-publish"');
    expect(desk).toContain(
      'import { SchedulerPublishBench } from "./SchedulerPublishBench";',
    );
    expect(
      desk.split("<SchedulerPublishBench isLight={isLight} draft={draft} accounts={accounts} />")
        .length - 1,
    ).toBe(1);
  });

  it("renders one publish row per selected platform, with per-state lines", () => {
    for (const needle of [
      "world-scheduler-publish-row-${platform}",
      "world-scheduler-publish-${platform}",
      "world-scheduler-publish-error-${platform}",
      "world-scheduler-publish-notice-${platform}",
      "world-scheduler-publish-done-${platform}",
    ]) {
      expect(bench, needle).toContain(needle);
    }
    /* the no-platform case is the shared honest empty state */
    expect(bench).toContain("NativeEmptyState");
    expect(bench).toContain('t("worldSchedulerPublish.needPlatform")');
  });
});

describe("the charge — confirmedFetch at the registry price, cancel-safe", () => {
  it("publishes only through confirmedFetch on the seam's rails — no bare fetch", () => {
    expect(bench).toContain("useConfirmedApi");
    expect(bench).toContain("confirmedFetch(SOCIAL_PUBLISH_PATHS[platform]");
    expect(bench).not.toMatch(/(^|[^.\w])fetch\(/);
    /* a canceled confirmation returns to idle — no charge, no error */
    expect(bench).toContain('setRow(platform, { kind: "idle" })');
  });

  it("prices come from the registry seam, never a literal", () => {
    expect(bench).toContain("socialPublishCost(platform)");
    expect(seam).toContain('"/api/social/instagram/publish"');
    expect(seam).toContain("getCreditCost(endpoint)");
  });

  it("the idempotency key is loaded before the call and retired only on success", () => {
    const loadAt = bench.indexOf("loadSocialPublishKey(");
    const callAt = bench.indexOf("confirmedFetch(SOCIAL_PUBLISH_PATHS[platform]");
    const retireAt = bench.indexOf("retireSocialPublishKey(");
    expect(loadAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(loadAt);
    expect(retireAt).toBeGreaterThan(callAt);
  });

  it("out-of-credits refreshes the profile and quotes the live registry cost", () => {
    expect(bench).toContain('outcome.kind === "out-of-credits"');
    expect(bench).toContain("refreshProfile()");
    expect(bench).toContain('t("worldSchedulerPublish.outOfBucs", { cost: socialPublishCost(platform) })');
  });
});

describe("honest platform shape", () => {
  it("409 reads as already-publishing, TikTok success says drafts, permalinks offered when present", () => {
    expect(bench).toContain('outcome.kind === "in-progress"');
    expect(bench).toContain('t("worldSchedulerPublish.sentTiktok")');
    expect(bench).toContain("outcome.result.deliveredToDrafts");
    expect(bench).toContain('t("worldSchedulerPublish.viewPost")');
  });

  it("validation runs before any charge and speaks through the desk seam", () => {
    const validateAt = bench.indexOf("validateSocialPublish(platform, draft, accounts, publishStrings)");
    const callAt = bench.indexOf("confirmedFetch(SOCIAL_PUBLISH_PATHS[platform]");
    expect(validateAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(validateAt);
    expect(bench).toContain("buildSocialPublishPayload(platform, draft, accounts, idempotencyKey)");
  });
});

describe("the worldSchedulerPublish catalog namespace", () => {
  const enKeys = Object.keys(catalogs.en.worldSchedulerPublish ?? {});

  it("exists in all 10 locales with the full key set and non-empty values", () => {
    expect(enKeys.length).toBe(24);
    for (const loc of LOCALES) {
      const ns = catalogs[loc].worldSchedulerPublish;
      expect(ns, loc).toBeDefined();
      expect(Object.keys(ns).sort(), loc).toEqual([...enKeys].sort());
      for (const key of enKeys) expect(ns[key].length, `${loc}.${key}`).toBeGreaterThan(0);
    }
  });

  it("non-English values are the English source verbatim (UNREVIEWED, never agent-translated)", () => {
    for (const loc of LOCALES) {
      if (loc === "en") continue;
      expect(catalogs[loc].worldSchedulerPublish, loc).toEqual(catalogs.en.worldSchedulerPublish);
    }
  });

  it("every key is referenced by the bench or the desk seam — no orphans", () => {
    const spoken = bench + seam;
    for (const key of enKeys) {
      expect(spoken, key).toContain(`worldSchedulerPublish.${key}`);
    }
  });

  it("money reaches the copy by interpolation only — no literal Buc figures in the lines", () => {
    for (const key of enKeys) {
      expect(catalogs.en.worldSchedulerPublish[key], key).not.toMatch(/\d+\s*(Visual Bucs|Bucs)/);
    }
    expect(catalogs.en.worldSchedulerPublish.intro).toContain("{{cost}}");
    expect(catalogs.en.worldSchedulerPublish.publishButton).toContain("{{cost}}");
    expect(catalogs.en.worldSchedulerPublish.outOfBucs).toContain("{{cost}}");
  });
});
