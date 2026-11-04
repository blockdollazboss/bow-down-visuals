import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import pt from "../../locales/pt.json";
import fr from "../../locales/fr.json";
import itCatalog from "../../locales/it.json";
import de from "../../locales/de.json";
import ar from "../../locales/ar.json";
import hi from "../../locales/hi.json";
import ja from "../../locales/ja.json";
import ko from "../../locales/ko.json";
import {
  PLAN_CHANGE_CLEARS_CANCEL_LINE,
  planChangeChargeLine,
  planChangeOutcome,
  planChangeStartLine,
  planIntentOutcome,
  planPriceLabel,
  type PlanChangePreview,
  type SitePlan,
} from "./money-desks-2";
import { checkoutFailureCopy, CheckoutTransportError } from "../checkout-fetch";
import { unlockLabel } from "../courses";
import { ENTRY_METHOD_CATALOG } from "../contests";
import { CURSOR_OPTIONS } from "../cursor-settings";
import {
  MOVE_HOME_ALL_SETTLED_COPY,
  MOVE_HOME_APPROVE_COPY,
  MOVE_HOME_BLOCKER_COPY,
} from "./move-home-desk";
import { DELIGHT_PREF_DEFS, RETENTION_PREF_DEFS } from "./tail-desks";
import {
  DAILY_QUEST_TITLES,
  TUTORIAL_LEDGER_TITLE,
  dailyQuestTitle,
  ledgerEntryKindLabel,
  streakMilestoneTitle,
} from "./treasury-quests";

/* ─── Stack 100 locale unit 52 — the partial-i18n remainder sweep
   (manifest item 52, [D19]): the twelve World files that already
   called useTranslation but still carried English literals now
   speak through the catalogs (worldRemainder).

   SCOPE: AcademyDesk, CarouselDesk, CourtGatheringBlock,
   DailyDropCatalog, GiftCardsDesk, MoveHomeDesk, PacksDesk,
   PlansDesk, ShoutoutsSellDesk, StageBookingBlock, TailDesks,
   TreasuryQuestDepths — plus the seams they share copy through:
   money-desks-2.ts (the plan-change family ONLY — unit 40 threaded
   the coach/money functions and unit 49 the tip functions of the
   same module; the three bundles touch different functions and
   merge textually at the join), checkout-fetch.ts
   (checkoutFailureCopy), lib/tutorials.ts (resumeLabel),
   lib/courses.ts (unlockLabel), lib/contests.ts (formatDrawnAt +
   the entry-method labels the giveaway desk maps), and the
   desk-side key maps over lib-owned tables of record
   (move-home-desk copy tables, tail-desks pref defs,
   cursor-settings names, treasury-quests kind/daily/streak
   labels). Seam bundles/mappers are OPTIONAL with byte-identical
   English defaults, so every existing seam suite passes unchanged
   and English rendering is identical, key for key. CourtGathering
   and StageBooking were verified already fully keyed on their own
   namespaces — their only remainder was fmtWhen/fmtShowWhen using
   the runtime locale; both now format with i18n.language.
   NO-OVERLAP: the twelve components were verified against every
   file list of units 36–51 in the manifest census — none appears
   in any earlier unit, and Boards files (unit 50) are untouched.

   MONEY LAW: lines stating a specific charge, fee, payout,
   amount, refund or no-charge fact carry the English source
   VERBATIM in every catalog (figures by interpolation where the
   line takes one) — 67 keys, enumerated in MONEY_KEYS and asserted
   byte-identical in all ten catalogs below: the Academy AI cost +
   refund lines, the carousel export cost line, the Move Home free
   claims, every PacksDesk checkout line + the shared checkout
   failure pair (chk*), the whole PlansDesk plan-change family
   (pln*), the Shoutouts decline/refund/fee lines, the Giveaway
   announce + free lines, the Jackpot prize lines, and the
   Treasury VB amount lines.

   REUSED KEYS (byte-identical verified against en.json — the
   family rides the existing catalog instead of duplicating):
   academy.* + tutorials.* across AcademyDesk (signIn, goalLabel,
   the lesson/coach rails, the how-to shelf's whole vocabulary),
   retention.dropCatalog.* across DailyDropCatalog (title, use,
   archive, unarchive, archivedTitle, loading, failedTitle,
   emptyAll, emptyArchived, saveFailed — the website slate's own
   family, byte-identical to the desk's words; near-misses kept
   desk-side: the headline's curly apostrophe differs from the
   blurb's straight one, the desk's failed body names the Treasury
   where the slate's names the dashboard, and the desk's today
   marker is a " · " suffix composition),
   worldGiftCardsDesk.tryAgain for the gift-cards retry button,
   worldPlansDesk.* stays PlansDesk's own namespace (the pln* keys
   here are only the money-desks-2 seam's lines), balance.permanent_
   amount at the Packs/Accounts desks. Honest near-misses rejected:
   academy.firstStep/lessonsComplete/readLesson/markIncomplete/
   preparingLesson/coachHeader (all differ from the desk's words),
   tutorials.loadError (carries a trailing period the desk's title
   lacks).

   DELIBERATELY NOT EXTRACTED: rail/enum tokens (gift-card status,
   giveaway contest status, entry-method keys and vertical enums
   rendered as data, the carousel background style tokens); rail-
   provided text (plan names/taglines/features, server notes,
   shoutout fan words, contest/entry data, leaderboard names);
   brand stamps ("MADE WITH BOW DOWN VISUALS" IS extracted as
   carMadeWith — it is the preview's own copy; "Bow Down Visuals"
   as a badge/name stays a brand literal); the Academy override-
   Feature literals (a named join follow-on since unit 41);
   CREDIT_PACKS price labels (the rail's price data, pinned
   against the server PACK_MAP); internal thrown errors that never
   render ("court slate", "load failed", "move-home"); the
   "#hashtags" placeholder (a language-neutral format token).

   All non-English values in worldRemainder are AGENT-DRAFTED and
   UNREVIEWED — no native speaker has checked them. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const NS = "worldRemainder";
type Catalog = Record<string, Record<string, string>>;
const CATALOGS: Record<string, Catalog> = {
  en: en as unknown as Catalog,
  es: es as unknown as Catalog,
  pt: pt as unknown as Catalog,
  fr: fr as unknown as Catalog,
  it: itCatalog as unknown as Catalog,
  de: de as unknown as Catalog,
  ar: ar as unknown as Catalog,
  hi: hi as unknown as Catalog,
  ja: ja as unknown as Catalog,
  ko: ko as unknown as Catalog,
};
const EN = CATALOGS.en[NS];

const COMPONENTS = [
  "../../components/world/native/AcademyDesk.tsx",
  "../../components/world/native/CarouselDesk.tsx",
  "../../components/world/native/CourtGatheringBlock.tsx",
  "../../components/world/native/DailyDropCatalog.tsx",
  "../../components/world/native/GiftCardsDesk.tsx",
  "../../components/world/native/MoveHomeDesk.tsx",
  "../../components/world/native/PacksDesk.tsx",
  "../../components/world/native/PlansDesk.tsx",
  "../../components/world/native/ShoutoutsSellDesk.tsx",
  "../../components/world/native/StageBookingBlock.tsx",
  "../../components/world/native/TailDesks.tsx",
  "../../components/world/native/TreasuryQuestDepths.tsx",
];
const SEAMS = [
  "./money-desks-2.ts",
  "../checkout-fetch.ts",
  "../tutorials.ts",
  "../courses.ts",
  "../contests.ts",
  "./treasury-quests.ts",
  "./move-home-desk.ts",
  "./tail-desks.ts",
];

const MONEY_KEYS = [
  "acdAiCostNote", "acdBuildPathButton", "acdCoachCardTitle", "acdCoachFailedRefund",
  "acdLearnButton", "acdLessonFailedRefund", "acdOutOfCredits", "acdPathCardTitle", "acdPathFailedRefund",
  "carExportCostLine", "carOutOfCredits",
  "chkServerError", "chkUnreachable",
  "mvhBuildDrafts", "mvhGuestBody", "mvhIntro",
  "pakAdded", "pakBalance", "pakCancelNoCharge", "pakCheckoutDidntStart", "pakConfirming",
  "pakHostedNote", "pakNoPaymentPage", "pakTestModeNote",
  "plnChangeDidntGoThrough", "plnChargeToday", "plnClearsCancel", "plnCreditLine", "plnFree",
  "plnNothingCharged", "plnPerMonth", "plnRenewalStays", "plnSameRenewal", "plnStartLine",
  "shoAiTitle", "shoDeclineFree", "shoDeclineRefund", "shoDeclineRefundButton", "shoDeclineUnpaid",
  "shoDeclinedRefunded", "shoFeeLine", "shoFreeSuffix", "shoNotPaidSuffix", "shoOutOfCredits", "shoPaidSuffix",
  "taiAdminEventMeta", "taiAdminPrizeLabel", "taiAnnounceButton", "taiAnnounceConfirm", "taiAnnounceFailed",
  "taiAttemptButton", "taiCreateButton", "taiAddEntryButton", "taiDrawButton", "taiGiveawayIntro",
  "taiJackpotPrizeLine", "taiOutcomeUnreached", "taiOutcomeWin", "taiPhaseLiveLine", "taiPrefDailyDropNote",
  "treCatalogMeta", "treDailyFootnote", "treMomentClaimed", "treMomentWaiting",
  "treVbAmount", "treVbClaimed", "treVbPlus",
];

const tokensOf = (value: string): string[] => {
  const found = value.match(/\{\{[A-Za-z0-9_]+\}\}/g) ?? [];
  return [...found].sort();
};
const digitsOf = (value: string): string[] => value.match(/[0-9][0-9,]*/g) ?? [];

const fill = (template: string, vars: Record<string, string | number>): string =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v)), template);

const preview = (patch: Partial<PlanChangePreview>): PlanChangePreview => ({
  fromTier: "pro",
  fromPlanName: "Creator Pro",
  toTier: "elite",
  toPlanName: "Creator Elite",
  amountDueTodayCents: 0,
  creditCents: 0,
  currency: "usd",
  renewalDate: null,
  clearsPendingCancel: false,
  ...patch,
});
const freePlan = { priceUsdPerMonth: null } as unknown as SitePlan;
const paidPlan = { priceUsdPerMonth: 12 } as unknown as SitePlan;

describe("unit 52 — the remainder family resolves through the catalog", () => {
  it("every family component imports and calls useTranslation", () => {
    for (const rel of COMPONENTS) {
      const src = read(rel);
      expect(src, rel).toContain('import { useTranslation } from "react-i18next"');
      expect(src, rel).toContain("useTranslation()");
    }
  });

  it("the en namespace carries the full family key set (527 keys)", () => {
    expect(Object.keys(EN)).toHaveLength(527);
  });

  it("referenced keys == catalog keys (zero orphans, zero missing) across components + seams", () => {
    const joined = [...COMPONENTS, ...SEAMS].map(read).join("\n");
    const referenced = new Set([...joined.matchAll(/worldRemainder\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
    expect([...referenced].sort()).toEqual(Object.keys(EN).sort());
  });

  it("no hard-coded en-US formatting remains in the family components", () => {
    for (const rel of COMPONENTS) {
      const src = read(rel);
      expect(src, rel).not.toContain('toLocaleString("en-US"');
      expect(src, rel).not.toContain('toLocaleDateString("en-US"');
      expect(src, rel).not.toContain(".toLocaleString()");
      expect(src, rel).not.toContain(".toLocaleDateString()");
      expect(src, rel).not.toContain("toLocaleString(undefined");
      expect(src, rel).not.toContain("toLocaleDateString(undefined");
    }
  });

  it("representative en values are the desks' own words, verbatim", () => {
    expect(EN.acdTitle).toBe("Creator Academy — learn the game, master the craft");
    expect(EN.carExportCostLine).toBe("Export costs {{cost}} Visual Bucs — shown before anything runs.");
    expect(EN.ddcHeadline).toContain("the shared daily rotation stays the same for everyone");
    expect(EN.gcdTitle).toBe("Gift cards");
    expect(EN.mvhTitle).toBe("Move your home here");
    expect(EN.pakTitle).toBe("Visual Buc packs");
    expect(EN.plnClearsCancel).toBe(PLAN_CHANGE_CLEARS_CANCEL_LINE);
    expect(EN.shoGuestTitle).toBe("Your shoutout counter");
    expect(EN.taiTitle).toBe("Account settings");
    expect(EN.treMarksTitle).toBe("Quest marks — all time");
  });

  it("the drop catalogue rides the website slate's retention keys where byte-identical", () => {
    const desk = read("../../components/world/native/DailyDropCatalog.tsx");
    for (const key of [
      "title", "use", "archive", "unarchive", "archivedTitle",
      "loading", "failedTitle", "emptyAll", "emptyArchived", "saveFailed",
    ]) {
      expect(desk).toContain(`t("retention.dropCatalog.${key}")`);
    }
    const dropCatalog = ((en as unknown as Record<string, unknown>).retention as Record<string, Record<string, string>>).dropCatalog;
    expect(dropCatalog.title).toBe("Drop catalogue — every template");
    expect(dropCatalog.saveFailed).toBe("That didn't save — your catalogue is unchanged.");
    expect(dropCatalog.blurb).not.toBe(EN.ddcHeadline);
  });

  it("the seams' English defaults ARE the catalog's English values", () => {
    /* money-desks-2 plan family */
    expect(planPriceLabel(freePlan)).toBe(EN.plnFree);
    expect(planPriceLabel(paidPlan)).toBe(fill(EN.plnPerMonth, { price: 12 }));
    expect(planChangeChargeLine(preview({ amountDueTodayCents: 1700 }))).toBe(
      fill(EN.plnChargeToday, { amount: "$17.00", from: "Creator Pro", to: "Creator Elite" }),
    );
    expect(planChangeChargeLine(preview({ creditCents: 1200 }))).toBe(
      fill(EN.plnCreditLine, { amount: "$12.00", from: "Creator Pro" }),
    );
    expect(planChangeChargeLine(preview({}))).toBe(EN.plnNothingCharged);
    const renewalDate = "2026-12-01T00:00:00.000Z";
    const renewalText = new Date(renewalDate).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    expect(planChangeStartLine(preview({ renewalDate }))).toBe(
      fill(EN.plnStartLine, {
        to: "Creator Elite",
        renewal: fill(EN.plnRenewalStays, { date: renewalText }),
      }),
    );
    expect(planChangeStartLine(preview({}))).toBe(
      fill(EN.plnStartLine, { to: "Creator Elite", renewal: EN.plnSameRenewal }),
    );
    const intentOk = planIntentOutcome({ ok: true, status: 200, data: {} }, "Creator Pro");
    expect(intentOk.kind).toBe("error");
    if (intentOk.kind === "error") expect(intentOk.message).toBe(EN.pakCheckoutDidntStart);
    const intent502 = planIntentOutcome({ ok: false, status: 502, data: {} }, "Creator Pro");
    if (intent502.kind === "error") expect(intent502.message).toBe(fill(EN.chkServerError, { status: 502 }));
    const changeOk = planChangeOutcome({ ok: true, status: 200, data: {} });
    if (changeOk.kind === "error") expect(changeOk.message).toBe(EN.plnChangeDidntGoThrough);
    /* checkout-fetch shared failure copy */
    expect(checkoutFailureCopy(new CheckoutTransportError("x", 502))).toBe(
      fill(EN.chkServerError, { status: 502 }),
    );
    expect(checkoutFailureCopy(new Error("down"))).toBe(EN.chkUnreachable);
    /* move-home copy tables of record */
    expect(MOVE_HOME_BLOCKER_COPY.no_connected_accounts).toBe(EN.mvhBlockerNoAccounts);
    expect(MOVE_HOME_BLOCKER_COPY.needs_media).toBe(EN.mvhBlockerNeedsMedia);
    expect(MOVE_HOME_BLOCKER_COPY.needs_profile).toBe(EN.mvhBlockerNeedsProfile);
    expect(MOVE_HOME_APPROVE_COPY.profile).toBe(EN.mvhApproveProfile);
    expect(MOVE_HOME_APPROVE_COPY.store).toBe(EN.mvhApproveStore);
    expect(MOVE_HOME_APPROVE_COPY.press_kit).toBe(EN.mvhApprovePressKit);
    expect(MOVE_HOME_APPROVE_COPY.email_list).toBe(EN.mvhApproveEmailList);
    expect(MOVE_HOME_APPROVE_COPY.launch_posts).toBe(EN.mvhApproveLaunchPosts);
    expect(MOVE_HOME_ALL_SETTLED_COPY).toBe(EN.mvhAllSettled);
    /* tail-desks pref defs of record */
    const retByKey = Object.fromEntries(RETENTION_PREF_DEFS.map((d) => [d.key, d]));
    expect(retByKey.daily_drop_enabled.label).toBe(EN.taiPrefDailyDrop);
    expect(retByKey.daily_drop_enabled.blurb).toBe(EN.taiPrefDailyDropNote);
    expect(retByKey.quests_enabled.label).toBe(EN.taiPrefQuests);
    expect(retByKey.fomo_feed_enabled.blurb).toBe(EN.taiPrefFomoFeedNote);
    const delByKey = Object.fromEntries(DELIGHT_PREF_DEFS.map((d) => [d.key, d]));
    expect(delByKey.sharkDropsEnabled.label).toBe(EN.taiDelightSharkDrops);
    expect(delByKey.leaderboardVisible.blurb).toBe(EN.taiDelightLeaderboardNote);
    /* contests entry methods + cursor names of record */
    const methodByKey = Object.fromEntries(ENTRY_METHOD_CATALOG.map((m) => [m.key, m.label]));
    expect(methodByKey.follow).toBe(EN.taiMethodFollow);
    expect(methodByKey.purchase).toBe(EN.taiMethodPurchase);
    const cursorById = Object.fromEntries(CURSOR_OPTIONS.map((o) => [o.id, o.name]));
    expect(cursorById["shark-fin"]).toBe(EN.taiCursorSharkFin);
    expect(cursorById["bucs-coin"]).toBe(EN.taiCursorBucsCoin);
    expect(cursorById.gamepad).toBe(EN.taiCursorGamepad);
    /* treasury-quests labels of record */
    expect(ledgerEntryKindLabel("quest")).toBe(EN.treKindQuest);
    expect(ledgerEntryKindLabel("king-gift")).toBe(EN.treKindKingGift);
    expect(ledgerEntryKindLabel("streak-milestone")).toBe(EN.treKindStreakMilestone);
    expect(DAILY_QUEST_TITLES["daily-ship-it"]).toBe(EN.treDailyShipIt);
    expect(dailyQuestTitle("daily-ship-it")).toBe(EN.treDailyShipIt);
    expect(dailyQuestTitle(null)).toBe(EN.treKindDailyQuest);
    expect(streakMilestoneTitle("7")).toBe(fill(EN.treStreakMilestoneTitle, { days: 7 }));
    expect(TUTORIAL_LEDGER_TITLE).toBe(EN.treTutorialTitle);
    /* courses unlock label default */
    const future = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    expect(unlockLabel(future)).toBe(
      fill(EN.acdUnlocks, {
        date: new Date(future).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      }),
    );
  });
});

describe("unit 52 — all ten catalogs carry the family whole", () => {
  it("every catalog has exactly the en key set, no empty values", () => {
    const enKeys = Object.keys(EN).sort();
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const ns = catalog[NS];
      expect(ns, locale).toBeDefined();
      expect(Object.keys(ns).sort(), locale).toEqual(enKeys);
      for (const [key, value] of Object.entries(ns)) {
        expect(typeof value, `${locale}.${key}`).toBe("string");
        expect(value.length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("interpolation tokens match the English per key in every catalog", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      if (locale === "en") continue;
      const ns = catalog[NS];
      for (const [key, enValue] of Object.entries(EN)) {
        expect(tokensOf(ns[key]), `${locale}.${key}`).toEqual(tokensOf(enValue));
      }
    }
  });

  it("digit sequences match the English per key in every catalog", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      if (locale === "en") continue;
      const ns = catalog[NS];
      for (const [key, enValue] of Object.entries(EN)) {
        expect(digitsOf(ns[key]), `${locale}.${key}`).toEqual(digitsOf(enValue));
      }
    }
  });

  it("leading/trailing spaces match the English per key (composed strings depend on them)", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      if (locale === "en") continue;
      const ns = catalog[NS];
      for (const [key, enValue] of Object.entries(EN)) {
        expect(ns[key].startsWith(" "), `${locale}.${key} leading`).toBe(enValue.startsWith(" "));
        expect(ns[key].endsWith(" "), `${locale}.${key} trailing`).toBe(enValue.endsWith(" "));
      }
    }
  });

  it("money lines are byte-identical English in all ten catalogs", () => {
    expect(MONEY_KEYS).toHaveLength(67);
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const ns = catalog[NS];
      for (const key of MONEY_KEYS) {
        expect(ns[key], `${locale}.${key}`).toBe(EN[key]);
      }
    }
  });
});
