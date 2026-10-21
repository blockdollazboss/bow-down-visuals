/**
 * daily-drop-catalog.test.ts — STACK-20 R2 item #18 (Ring 4):
 * Daily Drop template USE + ARCHIVE at the Treasury.
 *
 * Verdict on the premise: the Daily Drop's templates are a
 * code-level catalogue — DAILY_DROPS on the server, 30 curated defs
 * {key, kind, href} rotating one per UTC day. "Use" already existed
 * for TODAY's drop only (the card follows the def's real tool href);
 * the rest of the slate was unreachable and no archive state
 * existed anywhere. The seam below reads the catalogue route
 * (GET /api/retention/daily-drop/catalog) and shapes the two lists
 * the Treasury renders.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DAILY_DROP_ARCHIVE_PATH,
  DAILY_DROP_CATALOG_PATH,
  DAILY_DROP_UNARCHIVE_PATH,
  applyDropArchive,
  normalizeDailyDropCatalog,
  splitDailyDropCatalog,
  type DailyDropCatalogEntry,
} from "./daily-drop-catalog";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const catalogSrc = read("../../components/world/native/DailyDropCatalog.tsx");
const panelSrc = read("../../components/world/StationPanel.tsx");
const slateSrc = read("../../components/DailyDropSlate.tsx");
const dashboardSrc = read("../../pages/dashboard.tsx");
const enLocale = JSON.parse(read("../../locales/en.json")) as {
  retention: { dropCatalog: Record<string, string> };
};

function drop(over: Partial<DailyDropCatalogEntry> = {}): DailyDropCatalogEntry {
  return {
    key: "hype-trailer",
    kind: "video",
    href: "/templates/videos?tab=templates&template=hype-trailer",
    isToday: false,
    archived: false,
    ...over,
  };
}

function payload(drops: unknown[], over: Record<string, unknown> = {}) {
  return { enabled: true, date: "2026-10-19", total: drops.length, drops, ...over };
}

describe("normalizeDailyDropCatalog", () => {
  it("shapes a real payload, keeping hrefs verbatim (use rides them)", () => {
    const c = normalizeDailyDropCatalog(payload([
      { key: "hype-trailer", kind: "video", href: "/templates/videos?tab=templates&template=hype-trailer", isToday: true, archived: false },
      { key: "grow-on-tiktok-hook", kind: "hook", href: "/hooks?template=grow-on-tiktok-hook", isToday: false, archived: true },
    ]));
    expect(c).not.toBeNull();
    expect(c!.enabled).toBe(true);
    expect(c!.date).toBe("2026-10-19");
    expect(c!.drops).toEqual([
      drop({ isToday: true }),
      drop({ key: "grow-on-tiktok-hook", kind: "hook", href: "/hooks?template=grow-on-tiktok-hook", archived: true }),
    ]);
  });

  it("flags are strict: only literal true counts (no truthy drift)", () => {
    const c = normalizeDailyDropCatalog(payload([
      { key: "hype-trailer", kind: "video", href: "/x?template=hype-trailer", isToday: 1, archived: "yes" },
    ]));
    expect(c!.drops[0]!.isToday).toBe(false);
    expect(c!.drops[0]!.archived).toBe(false);
  });

  it("enabled:false closes the catalogue (prefs off), with no drops", () => {
    expect(normalizeDailyDropCatalog({ enabled: false })).toEqual({
      enabled: false,
      date: "",
      drops: [],
    });
  });

  it("any shape drift is null — the panel shows its failed state, never partial rows", () => {
    expect(normalizeDailyDropCatalog(null)).toBeNull();
    expect(normalizeDailyDropCatalog("nope")).toBeNull();
    expect(normalizeDailyDropCatalog({ drops: [] })).toBeNull(); // enabled missing
    expect(normalizeDailyDropCatalog(payload("not-an-array" as never))).toBeNull();
    // one bad row poisons the slate rather than silently dropping it:
    expect(normalizeDailyDropCatalog(payload([
      { key: "ok", kind: "hook", href: "/hooks?template=ok" },
      { key: "bad", kind: "mystery", href: "/hooks?template=bad" },
    ]))).toBeNull();
    expect(normalizeDailyDropCatalog(payload([
      { key: "bad", kind: "hook", href: "https://elsewhere.example/x" },
    ]))).toBeNull(); // hrefs are internal rails only
    expect(normalizeDailyDropCatalog(payload([
      { kind: "hook", href: "/hooks?template=x" },
    ]))).toBeNull(); // no key
  });
});

describe("splitDailyDropCatalog + applyDropArchive", () => {
  it("splits the slate into active and archived lists", () => {
    const drops = [drop(), drop({ key: "b", archived: true }), drop({ key: "c" })];
    const { active, archived } = splitDailyDropCatalog(drops);
    expect(active.map((d) => d.key)).toEqual(["hype-trailer", "c"]);
    expect(archived.map((d) => d.key)).toEqual(["b"]);
  });

  it("apply flips only the named key, both ways, without mutating the input", () => {
    const drops = [drop(), drop({ key: "b" })];
    const archived = applyDropArchive(drops, "b", true);
    expect(archived.map((d) => d.archived)).toEqual([false, true]);
    expect(drops[1]!.archived).toBe(false);
    expect(applyDropArchive(archived, "b", false)).toEqual(drops);
  });

  it("an unknown key leaves the slate untouched", () => {
    const drops = [drop()];
    expect(applyDropArchive(drops, "ghost", true)).toEqual(drops);
  });
});

describe("the Treasury dock (source pins)", () => {
  it("the seam points at the real catalogue routes", () => {
    expect(DAILY_DROP_CATALOG_PATH).toBe("/api/retention/daily-drop/catalog");
    expect(DAILY_DROP_ARCHIVE_PATH).toBe("/api/retention/daily-drop/archive");
    expect(DAILY_DROP_UNARCHIVE_PATH).toBe("/api/retention/daily-drop/unarchive");
    expect(catalogSrc).toContain("DAILY_DROP_CATALOG_PATH");
    expect(catalogSrc).toContain("DAILY_DROP_ARCHIVE_PATH");
    expect(catalogSrc).toContain("DAILY_DROP_UNARCHIVE_PATH");
  });

  it("USE is the def's href as an explicit in-world transfer (new tab, walker stays)", () => {
    expect(catalogSrc).toContain("href={entry.href}");
    expect(catalogSrc).toContain('target="_blank"');
    expect(catalogSrc).toContain("world-daily-drop-use-");
    expect(catalogSrc).toContain("world-daily-drop-archive-");
    expect(catalogSrc).toContain("world-daily-drop-unarchive-");
  });

  it("honest states: failed load is a failed state, rows move only after the server confirms", () => {
    expect(catalogSrc).toContain("NativeErrorState");
    expect(catalogSrc).toContain("NativeLoadingState");
    expect(catalogSrc).toContain("catalogue is unchanged");
    /* applyDropArchive is called inside the toggle AFTER the await —
       pin that the setCatalog sits after the apiJson call. */
    const toggle = catalogSrc.slice(catalogSrc.indexOf("async function toggleArchive"));
    expect(toggle.indexOf("await apiJson")).toBeGreaterThan(-1);
    expect(toggle.indexOf("applyDropArchive")).toBeGreaterThan(toggle.indexOf("await apiJson"));
  });

  it("the copy never promises the rotation changes — archiving tidies the member's own list", () => {
    expect(catalogSrc).toContain("the shared daily rotation stays the same for everyone");
  });

  it("docked in the Treasury panel, directly under the day's drop card", () => {
    expect(panelSrc).toContain("<DailyDropCatalog isLight={isLight} />");
    expect(panelSrc.indexOf("<DailyDropCatalog")).toBeGreaterThan(
      panelSrc.indexOf("<DailyDropCard inWorld />"),
    );
  });
});

describe("the website parity dock (source pins)", () => {
  /* The catalogue was World-only: the website showed today's drop
     card and nothing else. The slate now docks on the dashboard
     under the same card, on the same seam and the same routes. */
  it("the website slate rides the same seam and routes as the Treasury's", () => {
    expect(slateSrc).toContain("DAILY_DROP_CATALOG_PATH");
    expect(slateSrc).toContain("DAILY_DROP_ARCHIVE_PATH");
    expect(slateSrc).toContain("DAILY_DROP_UNARCHIVE_PATH");
    expect(slateSrc).toContain("normalizeDailyDropCatalog");
    expect(slateSrc).toContain("splitDailyDropCatalog");
  });

  it("USE on the website is the def's href as a same-tab Link (the website card's idiom, not the in-world new tab)", () => {
    expect(slateSrc).toContain("<Link href={entry.href}");
    expect(slateSrc).not.toContain('target="_blank"');
    expect(slateSrc).toContain("website-daily-drop-use-");
    expect(slateSrc).toContain("website-daily-drop-archive-");
    expect(slateSrc).toContain("website-daily-drop-unarchive-");
  });

  it("rows move only after the server confirms, same as in-world", () => {
    const toggle = slateSrc.slice(slateSrc.indexOf("async function toggleArchive"));
    expect(toggle.indexOf("await apiJson")).toBeGreaterThan(-1);
    expect(toggle.indexOf("applyDropArchive")).toBeGreaterThan(toggle.indexOf("await apiJson"));
  });

  it("honest states: failed load retries, prefs-off and signed-out render nothing", () => {
    expect(slateSrc).toContain('t("common.retry")');
    expect(slateSrc).toContain("retention.dropCatalog.failedTitle");
    expect(slateSrc).toContain("if (!catalog || !catalog.enabled) return null;");
    expect(slateSrc).toContain("if (!user) return null;");
  });

  it("docked on the dashboard, directly under the day's drop card", () => {
    expect(dashboardSrc).toContain("<DailyDropSlate />");
    expect(dashboardSrc.indexOf("<DailyDropSlate />")).toBeGreaterThan(
      dashboardSrc.indexOf("<DailyDropCard />"),
    );
  });

  it("the website copy carries the same rotation honesty as the Treasury's", () => {
    expect(enLocale.retention.dropCatalog.title).toContain("every template");
    expect(enLocale.retention.dropCatalog.blurb).toContain(
      "the shared daily rotation stays the same for everyone",
    );
    expect(enLocale.retention.dropCatalog.saveFailed).toContain("catalogue is unchanged");
  });
});
