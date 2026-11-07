/**
 * Stack 200 Lane E1, item E-2 — the shared-lib locale remainder.
 *
 * Pins for the six seams the census found rendering shared-lib
 * English on every surface regardless of locale: the publishing
 * labels + split validator (lib/publishing-splits), the split role
 * words (lib/distribution roleLabel), the royalties loader's
 * fallback errors (lib/royalties-load), the brand-kit color-role
 * words (lib/brand-kit), the server stream-pack theme names/blurbs
 * (lib/stream-pack + the World mirror in lib/world/business-desks)
 * and the features registry literals (src/data/features).
 *
 * The contract per seam: with NO strings/translator the English
 * output is byte-identical to the pre-seam literals (every other
 * consumer unchanged); with one, the catalog words win. The new
 * catalog keys resolve in en to exactly those literals and exist,
 * English-verbatim (UNREVIEWED house practice), in all 10 catalogs.
 * PUBLISHING_COPY is deliberately NOT among them — it is
 * server-owned money-adjacent copy and stays the English source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PUBLISHING_COPY,
  publishingStateLabel,
  writerSplitValidationError,
  writerStatusLabel,
} from "./publishing-splits";
import { roleLabel } from "./distribution";
import { loadRoyaltySources } from "./royalties-load";
import { brandKitColorRoleLabel } from "./brand-kit";
import { streamPackThemeBlurb, streamPackThemeName } from "./stream-pack";
import { streamPackThemeLabel } from "./world/business-desks";
import {
  FEATURE_CATEGORIES,
  SITE_FEATURES,
  featureCategoryBlurb,
  featureCategoryLabel,
  featureName,
  featureTagline,
} from "../data/features";

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;

function loadCatalog(locale: string): Record<string, unknown> {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function resolveKey(catalog: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[part];
    return undefined;
  }, catalog);
}

const CATALOGS = Object.fromEntries(LOCALES.map((l) => [l, loadCatalog(l)]));

/** A translator backed by the real en catalog, i18next-shaped:
 *  resolves the key, else the caller's defaultValue. */
function enT(key: string, opts?: Record<string, unknown>): string {
  const v = resolveKey(CATALOGS.en, key);
  if (typeof v === "string") {
    return v.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ""));
  }
  return String(opts?.defaultValue ?? key);
}

/* ─── publishing-splits ───────────────────────────────────────────── */

describe("E-2 publishing seam — defaults are the pre-seam English, byte for byte", () => {
  it("state + writer labels", () => {
    expect(publishingStateLabel("confirmed")).toBe("All writers confirmed");
    expect(publishingStateLabel("awaiting_confirmations")).toBe("Awaiting writer confirmations");
    expect(publishingStateLabel("disputed")).toBe("Disputed — flagged for review (shares unchanged)");
    expect(publishingStateLabel("registered")).toBe("Registered");
    expect(publishingStateLabel("anything-else")).toBe("anything-else");
    expect(writerStatusLabel("confirmed")).toBe("Confirmed");
    expect(writerStatusLabel("disputed")).toBe("Disputed");
    expect(writerStatusLabel("pending")).toBe("Awaiting confirmation");
    expect(writerStatusLabel("unlinked")).toBe("Not on Bow Down Visuals");
    expect(writerStatusLabel("mystery")).toBe("mystery");
  });

  it("validator messages", () => {
    expect(writerSplitValidationError([])).toBe("Add at least one songwriter.");
    expect(writerSplitValidationError([{ name: "A", sharePct: 30 }])).toBe(
      "Songwriter shares must total 100% — yours total 30.00%.",
    );
    expect(writerSplitValidationError([{ name: "", sharePct: 100 }])).toBe("Each songwriter needs a name.");
    expect(writerSplitValidationError([{ name: "A", sharePct: 100.001 }])).toBe(
      "Each songwriter's share must be more than 0% and no more than 100%.",
    );
    expect(writerSplitValidationError([{ name: "A", sharePct: 33.333 }, { name: "B", sharePct: 66.667 }])).toBe(
      "Shares can have at most two decimal places.",
    );
    expect(writerSplitValidationError([{ name: "A", sharePct: 50 }, { name: "B", sharePct: 50 }])).toBeNull();
  });

  it("a strings table replaces every word", () => {
    const table = {
      stateConfirmed: "S-CONFIRMED",
      validationTotalMismatch: (total: string) => `S-TOTAL-${total}`,
    };
    expect(publishingStateLabel("confirmed", table)).toBe("S-CONFIRMED");
    expect(publishingStateLabel("registered", table)).toBe("Registered");
    expect(writerSplitValidationError([{ name: "A", sharePct: 30 }], table)).toBe("S-TOTAL-30.00");
  });

  it("PUBLISHING_COPY stays the server-owned English, untouched by the seam", () => {
    expect(PUBLISHING_COPY.collectionNotice).toBe(
      "Registered — collection activates when publishing administration is connected.",
    );
    expect(PUBLISHING_COPY.registryOnly).toContain("It does not collect or pay royalties");
    expect(resolveKey(CATALOGS.en, "publishingSplits.stateConfirmed")).toBe("All writers confirmed");
  });
});

/* ─── distribution roleLabel ──────────────────────────────────────── */

describe("E-2 roleLabel seam", () => {
  it("defaults: the four rail roles map, everything else keeps the caller's word", () => {
    expect(roleLabel("artist")).toBe("Artist");
    expect(roleLabel("Producer")).toBe("Producer");
    expect(roleLabel("writer")).toBe("Writer");
    expect(roleLabel("featured")).toBe("Featured");
    expect(roleLabel("songwriter")).toBe("songwriter");
    expect(roleLabel("manager")).toBe("manager");
    expect(roleLabel("")).toBe("Collaborator");
    expect(roleLabel(null)).toBe("Collaborator");
  });

  it("a strings table supplies the words, including the empty-role fallback", () => {
    expect(roleLabel("artist", { artist: "Artiste" })).toBe("Artiste");
    expect(roleLabel("", { collaborator: "Collab" })).toBe("Collab");
    expect(roleLabel("manager", { artist: "Artiste" })).toBe("manager");
  });
});

/* ─── royalties-load fallbacks ────────────────────────────────────── */

const failGet = (status: number, data: unknown = {}) =>
  async () => ({ res: { ok: false, status }, data }) as never;

describe("E-2 royalties loader seam", () => {
  it("default failure words are byte-identical to the pre-seam literals", async () => {
    const r = await loadRoyaltySources(failGet(503));
    expect(r.summaryError).toBe("Couldn't load your royalty summary (503).");
    expect(r.platformsError).toBe("Couldn't load your platform connections (503).");
    expect(r.payoutsError).toBe("Couldn't load your payouts (503).");
  });

  it("a server-sent error message still wins over the strings table", async () => {
    const r = await loadRoyaltySources(failGet(500, { error: "Royalty rail is down." }), {
      summaryFailed: (s) => `T-SUMMARY-${s}`,
    });
    expect(r.summaryError).toBe("Royalty rail is down.");
  });

  it("the strings table supplies the composed + plain fallback words", async () => {
    const table = {
      summaryFailed: (s: string) => `T-SUMMARY-${s}`,
      summaryFallback: "T-SUMMARY-PLAIN",
    };
    const composed = await loadRoyaltySources(failGet(500), table);
    expect(composed.summaryError).toBe("T-SUMMARY-500");
    const thrown = await loadRoyaltySources((async () => {
      throw new Error("");
    }) as never, table);
    expect(thrown.summaryError).toBe("T-SUMMARY-PLAIN");
  });
});

/* ─── brand-kit color roles ───────────────────────────────────────── */

describe("E-2 brand-kit color-role seam", () => {
  it("defaults are the display words the panel's CSS capitalize used to fake", () => {
    expect(brandKitColorRoleLabel("primary")).toBe("Primary");
    expect(brandKitColorRoleLabel("secondary")).toBe("Secondary");
    expect(brandKitColorRoleLabel("accent")).toBe("Accent");
    expect(brandKitColorRoleLabel("neutral")).toBe("Neutral");
    expect(brandKitColorRoleLabel("background")).toBe("Background");
    expect(brandKitColorRoleLabel("custom-role")).toBe("custom-role");
  });

  it("a strings table supplies the words", () => {
    expect(brandKitColorRoleLabel("primary", { primary: "Primaire" })).toBe("Primaire");
    expect(brandKitColorRoleLabel("accent", { primary: "Primaire" })).toBe("Accent");
  });
});

/* ─── stream-pack themes ──────────────────────────────────────────── */

describe("E-2 stream-pack theme seam", () => {
  it("without a translator the served/mirror strings render as-is", () => {
    expect(streamPackThemeName({ id: "gold-luxury", name: "Gold Luxury" })).toBe("Gold Luxury");
    expect(streamPackThemeBlurb({ id: "gold-luxury", blurb: "Black & gold." })).toBe("Black & gold.");
    expect(streamPackThemeLabel("neon-cyber")).toBe("Neon Cyber");
    expect(streamPackThemeLabel("nope")).toBeNull();
    expect(streamPackThemeLabel(null)).toBeNull();
  });

  it("with the catalog translator the catalog words win, keyed by theme id", () => {
    expect(streamPackThemeName({ id: "gold-luxury", name: "IGNORED" }, enT)).toBe("Gold Luxury");
    expect(streamPackThemeBlurb({ id: "arctic-frost", blurb: "IGNORED" }, enT)).toBe(
      "Ice blue & white. Clean and sharp.",
    );
    expect(streamPackThemeLabel("violet-noir", enT)).toBe("Violet Noir");
    const probe = (key: string) => key;
    expect(streamPackThemeName({ id: "x", name: "N" }, probe)).toBe("streamPack.theme.x.name");
  });

  it("the en catalog's theme words equal the SERVER catalog's, id by id", () => {
    const serverSrc = readFileSync(
      new URL("../../../api-server/src/routes/generate/stream-pack.ts", import.meta.url),
      "utf8",
    );
    const entries = [...serverSrc.matchAll(/id: "([\w-]+)",\s*\n\s*name: "([^"]+)",\s*\n\s*blurb: "([^"]+)"/g)];
    expect(entries.length).toBe(6);
    for (const [, id, name, blurb] of entries) {
      expect(resolveKey(CATALOGS.en, `streamPack.theme.${id}.name`)).toBe(name);
      expect(resolveKey(CATALOGS.en, `streamPack.theme.${id}.blurb`)).toBe(blurb);
    }
  });
});

/* ─── features registry ───────────────────────────────────────────── */

describe("E-2 features registry seam", () => {
  it("without a translator the registry literals render as-is", () => {
    const f = SITE_FEATURES[0]!;
    expect(featureName(f)).toBe(f.name);
    expect(featureTagline(f)).toBe(f.tagline);
    const c = FEATURE_CATEGORIES[0]!;
    expect(featureCategoryLabel(c)).toBe(c.label);
    expect(featureCategoryBlurb(c)).toBe(c.blurb);
  });

  it("the en catalog mirrors every registry literal, key by key", () => {
    expect(SITE_FEATURES.length).toBeGreaterThan(40);
    for (const f of SITE_FEATURES) {
      expect(resolveKey(CATALOGS.en, `features.registry.${f.key}.name`)).toBe(f.name);
      expect(resolveKey(CATALOGS.en, `features.registry.${f.key}.tagline`)).toBe(f.tagline);
      expect(featureName(f, enT)).toBe(f.name);
      expect(featureTagline(f, enT)).toBe(f.tagline);
    }
    for (const c of FEATURE_CATEGORIES) {
      expect(resolveKey(CATALOGS.en, `features.category.${c.key}.label`)).toBe(c.label);
      expect(resolveKey(CATALOGS.en, `features.category.${c.key}.blurb`)).toBe(c.blurb);
      expect(featureCategoryLabel(c, enT)).toBe(c.label);
      expect(featureCategoryBlurb(c, enT)).toBe(c.blurb);
    }
  });
});

/* ─── catalog presence: every new key, all 10 catalogs ────────────── */

describe("E-2 catalog presence — the new keys exist in all 10 catalogs, English-verbatim", () => {
  const newKeys: string[] = [
    ...[
      "stateConfirmed", "stateAwaitingConfirmations", "stateDisputed", "stateRegistered",
      "writerConfirmed", "writerDisputed", "writerPending", "writerUnlinked",
      "validationEmpty", "validationTooMany", "validationNameRequired", "validationShareNotNumber",
      "validationShareRange", "validationShareDecimals", "validationDuplicateAccount", "validationTotalMismatch",
    ].map((k) => `publishingSplits.${k}`),
    ...["roleArtist", "roleProducer", "roleWriter", "roleFeatured", "roleCollaborator"].map(
      (k) => `distribution.${k}`,
    ),
    ...[
      "loadSummaryFailed", "loadPlatformsFailed", "loadPayoutsFailed",
      "loadSummaryFallback", "loadPlatformsFallback", "loadPayoutsFallback",
    ].map((k) => `royalties.${k}`),
    ...["primary", "secondary", "accent", "neutral", "background"].map((k) => `brandingKit.colorRole.${k}`),
    ...["gold-luxury", "neon-cyber", "crimson-royal", "emerald-empire", "violet-noir", "arctic-frost"].flatMap(
      (id) => [`streamPack.theme.${id}.name`, `streamPack.theme.${id}.blurb`],
    ),
    ...SITE_FEATURES.flatMap((f) => [`features.registry.${f.key}.name`, `features.registry.${f.key}.tagline`]),
    ...FEATURE_CATEGORIES.flatMap((c) => [`features.category.${c.key}.label`, `features.category.${c.key}.blurb`]),
  ];

  it("all present and non-empty everywhere, identical to en until reviewed translations land", () => {
    expect(newKeys.length).toBe(16 + 5 + 6 + 5 + 12 + SITE_FEATURES.length * 2 + FEATURE_CATEGORIES.length * 2);
    for (const key of newKeys) {
      const enValue = resolveKey(CATALOGS.en, key);
      expect(typeof enValue, `en ${key}`).toBe("string");
      expect((enValue as string).length, `en ${key}`).toBeGreaterThan(0);
      for (const locale of LOCALES) {
        expect(resolveKey(CATALOGS[locale], key), `${locale} ${key}`).toBe(enValue);
      }
    }
  });
});

/* ─── consumer wiring pins ────────────────────────────────────────── */

describe("E-2 consumer wiring — the surfaces pass their catalog words into the seams", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("the publishing + splits surfaces build the strings tables", () => {
    const panel = read("../components/coach/PublishingSplitsPanel.tsx");
    expect(panel).toContain('t("publishingSplits.stateConfirmed")');
    expect(panel).toContain("publishingStateLabel(item.state, publishingStrings)");
    expect(panel).toContain("writerStatusLabel(w.confirmation_status, publishingStrings)");
    const world = read("../components/world/native/CoachMoneySubViews.tsx");
    expect(world).toContain("publishingStringsFrom(t)");
    expect(world).toContain("roleStringsFrom(t)");
    expect(world).toContain("royaltiesLoadStringsFrom(t)");
  });

  it("the role surfaces pass roleStrings into roleLabel", () => {
    for (const rel of [
      "../components/coach/SplitsOverview.tsx",
      "../components/world/native/ReleaseDesk.tsx",
      "../pages/distribute.tsx",
      "../pages/splits-agreement.tsx",
    ]) {
      const src = read(rel);
      expect(src, rel).toContain('t("distribution.roleArtist")');
      expect(src, rel).toMatch(/roleLabel\([\s\S]{0,40}roleStrings\)/);
    }
    const tracker = read("../components/coach/RoyaltyTrackerPanel.tsx");
    expect(tracker).toContain('t("royalties.loadSummaryFailed"');
  });

  it("brand-kit, stream-pack and features surfaces resolve through the helpers", () => {
    expect(read("../components/branding/BrandKitPanel.tsx")).toContain("brandKitColorRoleLabel(r, brandKitRoleStrings)");
    const page = read("../pages/stream-pack.tsx");
    expect(page).toContain("streamPackThemeName(theme, t)");
    expect(page).toContain("streamPackThemeBlurb(theme, t)");
    expect(read("../components/world/native/BusinessDesks.tsx")).toContain("streamPackThemeLabel(asset.themeId, t)");
    const features = read("../pages/features.tsx");
    expect(features).toContain("featureName(f, t)");
    expect(features).toContain("featureTagline(f, t)");
    expect(features).toContain("featureCategoryLabel(cat, t)");
    expect(read("../pages/promote.tsx")).toContain("featureName(f, t)");
  });
});
