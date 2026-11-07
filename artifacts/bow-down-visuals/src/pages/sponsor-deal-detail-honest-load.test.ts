/**
 * Sponsor deal detail — applications honest load states (Stack-200
 * hardening D1, census section A item 4: the "empty lie" family).
 *
 * Before: loadApplications() had no catch and only set state on
 * res.ok — a failed load left applications = [] and the page printed
 * "No applications yet — share your deal…" directly under a heading
 * showing the REAL deal.applicationCount, hiding the accept /
 * fund-escrow rows behind a self-contradiction.
 *
 * After: failure (network throw OR !res.ok) sets an error flag and
 * keeps any loaded rows. With nothing loaded, an error row with a
 * retry renders instead of the empty copy; with rows loaded, an
 * error banner rides above them. The empty copy renders only after
 * a successful load that genuinely returned zero applications.
 *
 * The FE suite runs in node (no DOM), so — like the sibling pins —
 * these tests pin the state machine in source. The two new keys are
 * English in en.json; the other nine catalogs carry the English
 * verbatim as UNREVIEWED placeholders, flagged in each locale's
 * locale-waves W1 legit-identical allowlist (the codebase's explicit
 * mechanism for deliberate English-identical values).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./sponsor-deal-detail.tsx");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

describe("failure path — applications never read as empty on a failed load", () => {
  it("loadApplications treats !res.ok as failure and catches throws", () => {
    expect(page).toContain('if (!res.ok) throw new Error("applications load failed");');
    expect(page).toContain("setAppsError(true)");
  });

  it("a new load attempt clears the error flag first", () => {
    expect(page).toContain("setAppsError(false)");
  });

  it("failure with nothing loaded renders the error row with retry, not the empty copy", () => {
    expect(page).toContain('data-testid="deal-applications-load-error"');
    expect(page).toContain("appsError && applications.length === 0");
    expect(page).toContain('t("sponsorDealDetail.applicationsLoadError")');
    expect(page).toContain('t("sponsorDealDetail.retryLoad")');
    expect(page).toContain("onClick={() => void loadApplications(dealId)}");
  });

  it("a failed reload keeps loaded rows and banners the error above them", () => {
    expect(page).toContain('data-testid="deal-applications-reload-error"');
    expect(page).toContain("appsError && !appsLoading && applications.length > 0");
    /* failure never clears the rows */
    expect(page).not.toMatch(/catch \{[^}]*setApplications\(\[\]\)/);
  });
});

describe("genuine-empty path stays distinct from failure", () => {
  it("the empty copy branch is only reachable with no error outstanding", () => {
    const errAt = page.indexOf('data-testid="deal-applications-load-error"');
    const emptyAt = page.indexOf('t("sponsorDealDetail.noApplications")');
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errAt);
    expect(page).toContain('t("sponsorDealDetail.applicationsTitle", { count: deal.applicationCount })');
  });

  it("the loading branch still precedes every settled branch", () => {
    const loadAt = page.indexOf('t("sponsorDealDetail.loadingShort")');
    const errAt = page.indexOf('data-testid="deal-applications-load-error"');
    expect(loadAt).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(loadAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the applications honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["sponsorDealDetail.applicationsLoadError", "sponsorDealDetail.retryLoad"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
