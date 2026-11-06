/**
 * Beats license persistence — FE pins (stack1600 Lane W8).
 *
 * Live defect (Nov 5, 2026, staging two-account run): TEST Buyer D
 * licensed the TEST Beat (Basic $20, paid, "Payment confirmed — your
 * license is active"); after reloading /beats the card showed only
 * "License" again, the license dialog showed no already-licensed
 * state, and the purchase survived only in the Dashboard library.
 * The license row was completed server-side the whole time.
 *
 * Root cause, all in pages/beats.tsx: the buyer's licenses were
 * fetched ONLY when the Dashboard tab opened; the browse card and
 * the license modal never consulted them; and the page's local DTO
 * omitted `beatId` — the field GET /api/beats/licenses/mine sends on
 * every row — so no surface could join a license to its beat. The
 * only post-payment evidence was the checkout-return banner, whose
 * state dies with the reload (its effect strips session_id from the
 * URL on first read).
 *
 * These pins hold the fix:
 *  P1 — ownership is a pure join: completedLicenseForBeat returns a
 *       COMPLETED license for the beat (newest first), and pending /
 *       refunded rows never count as ownership.
 *  P2 — the DTO the page consumes carries beatId, and the selector
 *       lives in lib/beats-buyer-licenses (one implementation for
 *       the card, the modal, and these tests).
 *  P3 — the page loads the buyer's licenses on sign-in (any tab),
 *       and re-loads them after a successful checkout-return verify
 *       (verify is what completes the row; the sign-in fetch can
 *       race ahead of it).
 *  P4 — the browse card renders the Licensed badge + downloads for
 *       an owned beat, and the license modal renders its
 *       already-licensed panel, both keyed off the join.
 *  Locales — every catalog carries the lane's two new beats keys.
 *       Non-English values are agent-drafted, UNREVIEWED.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  completedLicenseForBeat,
  type BuyerBeatLicense,
} from "../beats-buyer-licenses";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const page = read("../../pages/beats.tsx");
const lib = read("../beats-buyer-licenses.ts");
const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];

function row(partial: Partial<BuyerBeatLicense>): BuyerBeatLicense {
  return {
    id: "lic-1",
    beatId: "beat-1",
    beatTitle: "TEST Beat — delete pre-launch",
    tier: "basic",
    templateId: null,
    terms: null,
    priceCents: 2000,
    status: "completed",
    createdAt: "2026-11-05T22:00:00.000Z",
    downloadUrl: "https://cdn.example/master.mp3",
    stemsUrl: null,
    ...partial,
  };
}

describe("P1 — the ownership join answers from the license rows alone", () => {
  it("a completed license for the beat is ownership, with its delivery", () => {
    const owned = completedLicenseForBeat([row({})], "beat-1");
    expect(owned?.status).toBe("completed");
    expect(owned?.downloadUrl).toBe("https://cdn.example/master.mp3");
  });

  it("survives the reload scenario: rows re-read from the server still join", () => {
    /* The live defect in data form: after a reload the ONLY input is
       a fresh licenses/mine payload — no banner state, no session
       param. The join must answer from that payload by itself. */
    const freshPayload = [row({})];
    expect(completedLicenseForBeat(freshPayload, "beat-1")).not.toBeNull();
  });

  it("pending and refunded rows are NOT ownership", () => {
    expect(completedLicenseForBeat([row({ status: "pending_payment" })], "beat-1")).toBeNull();
    expect(completedLicenseForBeat([row({ status: "refunded" })], "beat-1")).toBeNull();
  });

  it("another beat's license does not badge this beat", () => {
    expect(completedLicenseForBeat([row({ beatId: "beat-2" })], "beat-1")).toBeNull();
    expect(completedLicenseForBeat([], "beat-1")).toBeNull();
  });

  it("with several licenses on one beat, the newest completed wins (mine is newest-first)", () => {
    const older = row({ id: "lic-old", tier: "basic", downloadUrl: "https://cdn.example/basic.mp3" });
    const newer = row({ id: "lic-new", tier: "premium", downloadUrl: "https://cdn.example/premium.wav" });
    const pendingNewest = row({ id: "lic-pending", status: "pending_payment" });
    const owned = completedLicenseForBeat([pendingNewest, newer, older], "beat-1");
    expect(owned?.id).toBe("lic-new");
  });
});

describe("P2 — the DTO and the join live in the lib, beatId included", () => {
  it("the lib DTO carries the server's beatId join key", () => {
    expect(lib).toContain("beatId: string;");
    expect(lib).toContain('l.status === "completed"');
  });

  it("the page consumes the lib DTO instead of its old beatId-less copy", () => {
    expect(page).toContain('from "@/lib/beats-buyer-licenses"');
    expect(page).toContain("type BuyerLicense = BuyerBeatLicense;");
    expect(page).not.toContain("interface BuyerLicense {");
  });
});

describe("P3 — the page loads licenses with sign-in and again after verify", () => {
  it("a sign-in effect fetches the buyer's licenses on any tab", () => {
    expect(page).toContain("if (user) fetchBuyerLicenses();");
  });

  it("the dashboard-tab fetch still runs (freshness on tab open)", () => {
    expect(page).toContain('if (tab === "dashboard" && user) {');
  });

  it("a successful verify reloads the buyer's licenses", () => {
    const verifyAt = page.indexOf('fetch("/api/beats/licenses/verify"');
    const refetchAt = page.indexOf("fetchBuyerLicenses();", verifyAt);
    expect(verifyAt).toBeGreaterThan(-1);
    expect(refetchAt).toBeGreaterThan(verifyAt);
  });
});

describe("P4 — card and modal render the owned state from the join", () => {
  it("the browse card badges an owned beat with the Licensed pill + downloads", () => {
    expect(page).toContain('data-testid="beat-card-owned"');
    expect(page).toContain('t("beats.licensedBadge")');
    const cardAt = page.indexOf('data-testid="beat-card-owned"');
    const joinAt = page.lastIndexOf("completedLicenseForBeat(buyerLicenses, beat.id)", cardAt);
    expect(joinAt).toBeGreaterThan(-1);
  });

  it("the license modal names the owned license before the shelf", () => {
    expect(page).toContain('data-testid="beat-modal-owned"');
    expect(page).toContain('t("beats.alreadyLicensed")');
    const panelAt = page.indexOf('data-testid="beat-modal-owned"');
    const shelfAt = page.indexOf("LICENSE_TIERS.map", panelAt);
    expect(shelfAt).toBeGreaterThan(panelAt);
  });
});

describe("locales — the lane's two beats keys exist in every catalog", () => {
  const KEYS = ["licensedBadge", "alreadyLicensed"];

  it.each(LOCALES)("%s carries both, non-empty", (loc) => {
    const cat = readJson(`../../locales/${loc}.json`);
    for (const k of KEYS) {
      expect(typeof cat.beats[k], `${loc}: beats.${k}`).toBe("string");
      expect((cat.beats[k] as string).trim().length, `${loc}: beats.${k}`).toBeGreaterThan(0);
    }
  });

  it("English says what the machinery does", () => {
    const en = readJson("../../locales/en.json");
    expect(en.beats.licensedBadge).toBe("Licensed");
    expect(en.beats.alreadyLicensed).toBe("You already own a license for this beat.");
  });
});
