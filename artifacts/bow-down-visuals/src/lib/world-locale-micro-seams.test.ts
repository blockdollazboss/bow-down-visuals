/**
 * Stack 200 Lane E1, item E-3 — the World locale micro-seams.
 *
 * Pins for the last English-only seams the census (Part 1 item d)
 * found in shared code: the transfer footer's label
 * (lib/world/station-panel), the shop stands' checkout + quote
 * labels (lib/world/shop-stands), the gift-card form problems
 * (lib/world/gift-cards, rendered by the Creator Rooms store), the
 * Crowns parser's fallback year name (lib/the-crowns), the 2D
 * social-proof strip's locale (components/artist/SocialProofStrip)
 * and the money formatter (lib/shops centsToDisplay).
 *
 * The contract per seam: with NO translator/strings/locale the
 * English output is byte-identical to the pre-seam literals (every
 * existing consumer unchanged, the standing value pins hold); with
 * one, the catalog words / locale formatting win. The new catalog
 * keys resolve in en to exactly those literals and exist,
 * English-verbatim (UNREVIEWED house practice), in all 10 catalogs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TRANSFER_BUTTON_LABEL,
  transferButtonLabel,
} from "./world/station-panel";
import {
  CHECKOUT_TRANSFER_LABEL,
  CONTACT_FOR_QUOTE_LABEL,
  checkoutTransferLabel,
  contactForQuoteLabel,
} from "./world/shop-stands";
import {
  DEFAULT_GIFT_CARD_FORM_STRINGS,
  emptyGiftCardForm,
  giftCardFormProblem,
} from "./world/gift-cards";
import { parseCrownsRead } from "./the-crowns";
import { centsToDisplay } from "./shops";

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;

function loadCatalog(locale: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"),
  ) as Record<string, unknown>;
}

function keyAt(catalog: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[part];
    return undefined;
  }, catalog);
}

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** A translator that resolves every key to its riding default. */
const echoDefault = (_key: string, opts?: Record<string, unknown>): string =>
  String(opts?.defaultValue ?? "");

/** A translator that names the key it was asked for. */
const nameKey = (key: string): string => `<${key}>`;

describe("E-3 transfer footer seam", () => {
  it("defaults are the pre-seam English, byte for byte", () => {
    expect(transferButtonLabel()).toBe("Open on the website ↗");
    expect(transferButtonLabel()).toBe(TRANSFER_BUTTON_LABEL);
    expect(transferButtonLabel(echoDefault)).toBe(TRANSFER_BUTTON_LABEL);
  });

  it("resolves through worldStationPanel.transferButton", () => {
    expect(transferButtonLabel(nameKey)).toBe("<worldStationPanel.transferButton>");
    expect(transferButtonLabel((_k, opts) => String(opts?.defaultValue), "CUSTOM ↗")).toBe("CUSTOM ↗");
  });
});

describe("E-3 shop-stand label seams", () => {
  it("defaults are the pre-seam English, byte for byte", () => {
    expect(checkoutTransferLabel()).toBe("Continue to checkout on the website");
    expect(checkoutTransferLabel()).toBe(CHECKOUT_TRANSFER_LABEL);
    expect(contactForQuoteLabel()).toBe("Contact for quote");
    expect(contactForQuoteLabel()).toBe(CONTACT_FOR_QUOTE_LABEL);
    expect(checkoutTransferLabel(echoDefault)).toBe(CHECKOUT_TRANSFER_LABEL);
    expect(contactForQuoteLabel(echoDefault)).toBe(CONTACT_FOR_QUOTE_LABEL);
  });

  it("resolves through the worldCommerceStands keys", () => {
    expect(checkoutTransferLabel(nameKey)).toBe("<worldCommerceStands.checkoutTransfer>");
    expect(contactForQuoteLabel(nameKey)).toBe("<worldCommerceStands.contactForQuote>");
  });
});

describe("E-3 gift-card form problem seam", () => {
  const denoms = [500, 1000, 2500];

  it("defaults are the pre-seam English, byte for byte", () => {
    expect(giftCardFormProblem(emptyGiftCardForm(), null)).toBe(
      "This gift card has no amounts to pick from yet — the seller hasn't set any.",
    );
    expect(giftCardFormProblem(emptyGiftCardForm(), [])).toBe(
      DEFAULT_GIFT_CARD_FORM_STRINGS.noAmounts,
    );
    expect(DEFAULT_GIFT_CARD_FORM_STRINGS.pickAmount).toBe("Pick an amount first.");
    expect(
      giftCardFormProblem({ ...emptyGiftCardForm(), amountCents: 750 }, denoms),
    ).toBe("Pick one of the offered amounts.");
    expect(giftCardFormProblem(emptyGiftCardForm(), denoms)).toBe(
      "Add the recipient's email — the gift card is delivered there, not to you.",
    );
    expect(
      giftCardFormProblem(
        { ...emptyGiftCardForm(), recipientEmail: "friend@example.com" },
        denoms,
      ),
    ).toBeNull();
  });

  it("a strings table replaces the words; a partial table keeps the rest English", () => {
    expect(
      giftCardFormProblem(emptyGiftCardForm(), null, { noAmounts: "KEINE BETRÄGE" }),
    ).toBe("KEINE BETRÄGE");
    expect(giftCardFormProblem(emptyGiftCardForm(), denoms, { noAmounts: "X" })).toBe(
      DEFAULT_GIFT_CARD_FORM_STRINGS.recipientEmail,
    );
  });
});

describe("E-3 Crowns year-name seam", () => {
  const payload = {
    current: { year: 2027 },
    years: [{ year: 2026 }],
  };

  it("defaults are the pre-seam English, byte for byte", () => {
    const parsed = parseCrownsRead(payload)!;
    expect(parsed.current.name).toBe("The Crowns of 2027");
    expect(parsed.years[0]!.name).toBe("The Crowns of 2026");
  });

  it("a yearName builder supplies both fallback names", () => {
    const parsed = parseCrownsRead(payload, {
      yearName: (year) => `Les Couronnes de ${year}`,
    })!;
    expect(parsed.current.name).toBe("Les Couronnes de 2027");
    expect(parsed.years[0]!.name).toBe("Les Couronnes de 2026");
  });

  it("a server-sent name wins over the seam and the default alike", () => {
    const named = {
      current: { year: 2027, name: "The Server's Crowns" },
      years: [{ year: 2026, name: "Named Year" }],
    };
    const parsed = parseCrownsRead(named, { yearName: (y) => `X ${y}` })!;
    expect(parsed.current.name).toBe("The Server's Crowns");
    expect(parsed.years[0]!.name).toBe("Named Year");
  });
});

describe("E-3 centsToDisplay locale seam", () => {
  it("without a locale the legacy literals hold, byte for byte", () => {
    expect(centsToDisplay(1999)).toBe("$19.99");
    expect(centsToDisplay(0)).toBe("$0.00");
    expect(centsToDisplay(100000)).toBe("$1000.00");
    expect(centsToDisplay(-250)).toBe("$0.00");
  });

  it("with a locale the Intl USD formatter for that locale wins", () => {
    expect(centsToDisplay(100000, "en-US")).toBe("$1,000.00");
    expect(centsToDisplay(1999, "de-DE")).toBe(
      new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD" }).format(19.99),
    );
    expect(centsToDisplay(1999, "de-DE")).not.toBe(centsToDisplay(1999));
  });
});

describe("E-3 catalog presence — the new keys exist in all 10 catalogs, English-verbatim", () => {
  const NEW_KEYS: Record<string, string> = {
    "worldStationPanel.transferButton": "Open on the website ↗",
    "worldCommerceStands.checkoutTransfer": "Continue to checkout on the website",
    "worldCommerceStands.contactForQuote": "Contact for quote",
    "worldCreatorRooms.crownsYearFallback": "The Crowns of {{year}}",
    "worldCreatorRooms.giftProblemNoAmounts":
      "This gift card has no amounts to pick from yet — the seller hasn't set any.",
    "worldCreatorRooms.giftProblemPickAmount": "Pick an amount first.",
    "worldCreatorRooms.giftProblemPickOffered": "Pick one of the offered amounts.",
    "worldCreatorRooms.giftProblemRecipientEmail":
      "Add the recipient's email — the gift card is delivered there, not to you.",
  };

  it("en carries exactly the pre-seam literals", () => {
    const en = loadCatalog("en");
    for (const [key, literal] of Object.entries(NEW_KEYS)) {
      expect(keyAt(en, key), key).toBe(literal);
    }
  });

  it("all present and non-empty everywhere, identical to en until reviewed translations land", () => {
    for (const locale of LOCALES) {
      const catalog = loadCatalog(locale);
      for (const [key, literal] of Object.entries(NEW_KEYS)) {
        expect(keyAt(catalog, key), `${locale}:${key}`).toBe(literal);
      }
    }
  });
});

describe("E-3 consumer wiring — the surfaces pass their locale into the seams", () => {
  const transferFooter = read("../components/world/native/TransferFooter.tsx");
  const businessDesks = read("../components/world/native/BusinessDesks.tsx");
  const shopStands = read("../components/world/native/ShopStands.tsx");
  const creatorRooms = read("../components/world/native/CreatorRooms.tsx");
  const paidSeries = read("../components/world/native/PaidSeriesDropsDesk.tsx");
  const crownsChamber = read("../components/world/native/CrownsChamber.tsx");
  const posMode = read("../components/PosMode.tsx");

  it("both transfer doors resolve the shared label through the catalog", () => {
    expect(transferFooter).toContain("transferButtonLabel(t, TRANSFER_BUTTON_LABEL)");
    expect(businessDesks).toContain("transferButtonLabel(t, TRANSFER_BUTTON_LABEL)");
  });

  it("the stands resolve the checkout + quote labels through the catalog", () => {
    expect(shopStands).toContain("checkoutTransferLabel(t)");
    expect(shopStands).toContain("contactForQuoteLabel(t)");
    expect(creatorRooms).toContain("checkoutTransferLabel(t)");
    expect(paidSeries).toContain("checkoutTransferLabel(t)");
  });

  it("the Creator Rooms store feeds the gift form its catalog sentences", () => {
    expect(creatorRooms).toContain(
      "giftCardFormProblem(giftForm, giftItem.giftCardDenominationsCents, giftFormStrings)",
    );
    expect(creatorRooms).toContain('t("worldCreatorRooms.giftProblemNoAmounts")');
    expect(creatorRooms).toContain('t("worldCreatorRooms.giftProblemRecipientEmail")');
  });

  it("the Crowns Chamber threads its catalog fallback into the fetch", () => {
    expect(crownsChamber).toContain('t("worldCreatorRooms.crownsYearFallback", { year })');
  });

  it("PosMode formats every amount with the active locale", () => {
    const bare = posMode.match(/centsToDisplay\([^,)]*\)/g) ?? [];
    expect(bare.filter((c) => !c.startsWith("centsToDisplay }"))).toEqual([]);
    expect(posMode).toContain("i18n.language");
  });

  it("the Creator Rooms store formats its amounts with the active locale", () => {
    expect(creatorRooms).toContain("centsToDisplay(total, i18n.language)");
    expect(creatorRooms).toContain("centsToDisplay(d, i18n.language)");
  });
});
