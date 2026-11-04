/**
 * money-desks-2-components — Stack-100 Money wave II (items 65–70)
 * source-contract pins. Each in-world money surface must ride the
 * SITE's real endpoints (the 2D pages are the reference
 * implementation) and the sanctioned-exit discipline (hosted pages
 * open in a NEW TAB only, never a same-tab walk-out):
 * - #65 the Beats station browses/licenses/sells/dashboards on the
 *   beats page's rails and lives in the Music Hall registry;
 * - #66 the Portrait Card tips on the tip-page rails (checkout
 *   first, 503 intent fallback) only when the profile's tip jar is
 *   on, and the TipJarDesk runs the creator's own settings on the
 *   Tip Jar page's rails, inside the Get Paid Room's board;
 * - #67 the MoneyActionsDesk PUTs permanence elections and PATCHes
 *   claim actions with the ClaimsPanel's gating helpers;
 * - #68 the Marketplace stand's settings carry the DomainsDesk on
 *   lib/domains' own helpers — the "stay on the website" line is
 *   gone;
 * - #69 the PlansDesk reads the creator-tiers catalog and checks
 *   out / portals on the pricing page's rails;
 * - #70 the board's Ledger tab pages the FULL history — the old
 *   30-row cap and its "full history waits on the website" line
 *   are gone.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const beats = read("../../components/world/native/BeatsDesk.tsx");
const portraitTip = read("../../components/world/native/PortraitTip.tsx");
const portraitCard = read("../../components/world/native/PortraitCard.tsx");
const tipJar = read("../../components/world/native/TipJarDesk.tsx");
const moneyActions = read("../../components/world/native/MoneyActionsDesk.tsx");
const plans = read("../../components/world/native/PlansDesk.tsx");
const domains = read("../../components/world/native/DomainsDesk.tsx");
const stands = read("../../components/world/native/ShopStands.tsx");
const earningsBoard = read("../../components/world/native/boards/EarningsBoard.tsx");
const panel = read("../../components/world/StationPanel.tsx");
const portraitLib = read("./portrait-card.ts");

describe("#65 beats station contracts", () => {
  it("rides the beats page's rails end to end", () => {
    expect(beats).toContain("beatsBrowsePath(filters, nextOffset)");
    expect(beats).toContain("beatLicensePath(licenseBeat.id)");
    expect(beats).toContain("beatLicensePayload({ templateId:");
    expect(beats).toContain("beatLicensePayload({ tier: offerKey })");
    expect(beats).toContain('fetch("/api/beats/licenses/verify"');
    expect(beats).toContain('fetch("/api/beats/licenses/mine"');
    expect(beats).toContain('fetch("/api/beats", {');
    expect(beats).toContain('fetch("/api/beats/mine/dashboard"');
    expect(beats).toContain('fetch("/api/beats/license-templates/mine"');
    expect(beats).toContain("`/api/beats/license-templates/${tplEditingId}`");
    expect(beats).toContain('method: "DELETE"');
    expect(beats).toContain("BEATS_COMMISSION_LINE");
    expect(beats).toContain("BEATS_PAYMENT_NOTE");
    expect(beats).toContain('data-testid="world-beats-desk"');
  });

  it("opens hosted checkout in a new tab only, and is hung in the panel", () => {
    expect(beats).toContain('window.open(url, "_blank", "noopener,noreferrer")');
    expect(beats).not.toContain("window.location.href = ");
    expect(panel).toContain('case "beats-desk"');
    expect(panel).toContain("<BeatsDesk");
  });

  /* Stack1100 world-beats parity (X4's licensing-truth outcomes):
     the sell form carries the page's Preview + Stems slots wired to
     the listing form state the payload builder reads; an
     exclusive-sold beat disables the buy button outright (the page's
     modal does the same); and the buyer library renders the beat
     title + the delivery links from the licenses/mine rows, with a
     named failure state instead of a silent swallow. */
  it("sell form carries the page's preview + stems slots (X4 parity)", () => {
    expect(beats).toContain('aria-label="Preview URL (optional)"');
    expect(beats).toContain("listingForm.previewUrl");
    expect(beats).toContain("setL({ previewUrl: e.target.value })");
    expect(beats).toContain('aria-label="Stems URL (optional)"');
    expect(beats).toContain("listingForm.stemsUrl");
    expect(beats).toContain("setL({ stemsUrl: e.target.value })");
    expect(beats).toContain("without one, the full track plays as the preview");
  });

  /* Stack1200 Y1-gap parity: the dashboard's "Your beats" rows carry
     the 2D BeatRow's AI-tags affordance — the charged suggester POST
     through the World's spend confirmation at the seam's pinned
     price, the suggestion rendered on the row, and Apply PATCHing
     the page's exact body, with failures named in place. */
  it("dashboard rows carry the BeatRow AI-tags affordance on the page's rails (stack1200)", () => {
    expect(beats).toContain("confirmedFetch(beatAiTagsPath(beat.id)");
    expect(beats).toContain("overrideCost: BEAT_AI_TAGS_COST_VB");
    expect(beats).toContain("overrideFeature: BEAT_AI_TAGS_FEATURE");
    expect(beats).toContain("beatAiTagsOutcome({ status: res.status, data }, beat.genre)");
    expect(beats).toContain('data-testid="world-beats-ai-tags"');
    expect(beats).toContain('data-testid="world-beats-ai-tags-suggestion"');
    expect(beats).toContain("suggestion.genre");
    expect(beats).toContain("suggestion.moodTags.map");
    expect(beats).toContain("fetch(beatPatchPath(beat.id)");
    expect(beats).toContain('method: "PATCH"');
    expect(beats).toContain("body: JSON.stringify(beatAiTagApplyPayload(suggestion))");
    expect(beats).toContain('data-testid="world-beats-ai-tags-apply"');
    expect(beats).toContain("Not enough Visual Bucs for AI tags");
    expect(beats).toContain("nothing was charged");
    /* The desk consumes only the owner's dashboard rows — the
       public presentation rail is never touched. */
    expect(beats).not.toContain("presentBeatPublic");
  });

  it("an exclusive-sold beat closes the license box and the library delivers (X4 C1/C5)", () => {
    /* Stack1400 ruling #2 widened the buy button's disable: it now
       goes through beatSelectedOfferUnavailable, whose soldOut is
       exclusiveSold OR stems-blocked — an exclusive-sold beat still
       always disables it (the helper's tiers/templates all read
       soldOut on a sold beat), and a stems offer with no stems on
       file disables it too. */
    expect(beats).toContain("disabled={licensing || beatSelectedOfferUnavailable(beat, offerKey)}");
    expect(beats).toContain("beat.exclusiveSold &&");
    expect(beats).toContain("lic.beatTitle ?? lic.terms?.name");
    expect(beats).toContain('data-testid="world-beats-license-download"');
    expect(beats).toContain('data-testid="world-beats-license-download-stems"');
    expect(beats).toContain("lic.downloadUrl");
    expect(beats).toContain("lic.stemsUrl");
    expect(beats).toContain('data-testid="world-beats-licenses-retry"');
    expect(beats).toContain("setLicensesFailed(true)");
  });
});

describe("#66 tip contracts", () => {
  it("portrait tipping rides the tip page's rails with its 503 fallback", () => {
    expect(portraitTip).toContain("tipPagePath(slug)");
    expect(portraitTip).toContain("tipCheckoutPath(page.handle)");
    expect(portraitTip).toContain("tipIntentPath(page.handle)");
    expect(portraitTip).toContain("co.status !== 503");
    expect(portraitTip).toContain("page.notice");
    expect(portraitTip).toContain('window.open(url, "_blank", "noopener,noreferrer")');
    expect(portraitTip).not.toContain("window.location.href = ");
    /* The card offers it only under the profile's own gate. */
    expect(portraitLib).toContain("tipJarEnabled: p.tip_jar_enabled === true");
    expect(portraitCard).toContain("card.tipJarEnabled");
    expect(portraitCard).toContain("<PortraitTip");
  });

  it("the tip-jar desk runs the creator's own page on its rails, in the Get Paid Room", () => {
    expect(tipJar).toContain('fetch("/api/tips/dashboard"');
    expect(tipJar).toContain('fetch("/api/tips/settings"');
    expect(tipJar).toContain('fetch("/api/tips/settings", {');
    expect(tipJar).toContain("buildTipSettingsPayload(form)");
    expect(tipJar).toContain("tipFeedStatusLabel(tip.status)");
    expect(tipJar).toContain('data-testid="world-tipjar-desk"');
    expect(earningsBoard).toContain("<TipJarDesk");
  });
});

describe("#67 money management contracts", () => {
  it("permanence elections PUT on the distribution rails", () => {
    expect(moneyActions).toContain('fetch("/api/distribution/permanence"');
    expect(moneyActions).toContain("catalogPermanencePath()");
    expect(moneyActions).toContain("releasePermanencePath(releaseId)");
    expect(moneyActions).toContain('method: "PUT"');
    expect(moneyActions).toContain("permanencePayload(election)");
    expect(moneyActions).toContain('data-testid="world-permanence-desk"');
  });

  it("claim work PATCHes with the panel's gating + resolve-note law", () => {
    expect(moneyActions).toContain('fetch("/api/content-id/claims"');
    expect(moneyActions).toContain("claimActionPath(claim.id)");
    expect(moneyActions).toContain('method: "PATCH"');
    expect(moneyActions).toContain("claimActionsFor(claim)");
    expect(moneyActions).toContain("claimActionProblem(action, note, t(");
    expect(moneyActions).toContain('data-testid="world-claims-desk"');
    expect(earningsBoard).toContain("<MoneyActionsDesk");
    /* The board no longer calls either surface read-only. */
    expect(earningsBoard).not.toContain('meta="Read-only"');
  });
});

describe("#68 custom domain contracts", () => {
  it("the stand's settings ride lib/domains' own helpers", () => {
    expect(domains).toContain("fetchMyDomains(token)");
    expect(domains).toContain("claimDomain(token, hostname.trim())");
    expect(domains).toContain("verifyDomain(token, domain.id)");
    expect(domains).toContain("deleteDomain(token, domain.id)");
    expect(domains).toContain("dnsInstructionsFor(d.hostname, d.verification_token)");
    expect(domains).toContain('data-testid="world-domains-desk"');
    expect(stands).toContain("<DomainsDesk");
    expect(stands).not.toContain("Custom domains live on your shop");
    expect(stands).not.toContain("Custom domains stay on the website");
  });
});

describe("#69 site plan contracts", () => {
  it("reads the catalog from the rail and checks out on it — no local prices", () => {
    expect(plans).toContain('fetch("/api/creator-tiers/plans")');
    expect(plans).toContain('fetch("/api/creator-tiers/me"');
    expect(plans).toContain('fetch("/api/creator-tiers/checkout"');
    expect(plans).toContain('fetch("/api/creator-tiers/portal"');
    expect(plans).toContain("planCheckoutPayload(plan.tier)");
    expect(plans).toContain("plansNote(payload)");
    expect(plans).toContain('data-testid="world-plans-desk"');
    expect(plans).toContain('window.open(url, "_blank", "noopener,noreferrer")');
    expect(plans).not.toContain("window.location.href = ");
    expect(earningsBoard).toContain("<PlansDesk");
  });
});

describe("#70 full ledger contracts", () => {
  it("the Ledger tab pages the whole history — cap and website line retired", () => {
    expect(earningsBoard).toContain("ledgerPage(ledger, ledgerPg)");
    expect(earningsBoard).toContain('data-testid="world-ledger-full"');
    expect(earningsBoard).toContain('data-testid="world-ledger-next"');
    expect(earningsBoard).toContain('data-testid="world-ledger-prev"');
    expect(earningsBoard).not.toContain("LEDGER_CAP");
    expect(earningsBoard).not.toContain("the full history waits on the website");
  });
});
