import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  SMART_CARD_MAX_LINKS,
  SMART_CARD_MAX_QUANTITY,
  buildSmartCardOrderPayload,
  buildSmartCardProfilePayload,
  newSmartCardOrderKey,
  parseSmartCardOrderResult,
  parseSmartCardOrders,
  parseSmartCardProfile,
  parseSmartCardProfiles,
  smartCardOrderComplete,
  smartCardOrderStatusLabel,
  smartCardOrderTotalCents,
  smartCardQrPath,
  smartCardValidLinks,
  type SmartCardOrderForm,
} from "./smart-cards";
import { STATION_BY_ID } from "./stations";
import { BRANDING_ATELIER_ID } from "./palace-layout";
import { NFC_CARD_STYLES } from "@/lib/nfc-cards";

/* smart-cards (parity P3-C) — the Smart Cards stand's pure logic.
   The pins that matter: the stand takes NO money and charges NO
   Bucs (the line's v1 contract: an order is a reservation, payment
   is collected when production is confirmed), so the credit
   registry must carry no charge for the line's endpoints — the
   stand posts with skipConfirm because there is nothing to confirm;
   the prices it shows are the line's own catalog figures; the
   order body is the page's body field for field, with one
   idempotency key per attempt; and the readers never turn a failed
   load into an empty shelf. */

const creditCostsSrc = readFileSync(new URL("../../lib/credit-costs.ts", import.meta.url), "utf8");
const panelSrc = readFileSync(new URL("../../components/world/StationPanel.tsx", import.meta.url), "utf8");
const standSrc = readFileSync(
  new URL("../../components/world/native/SmartCardsStand.tsx", import.meta.url),
  "utf8",
);

const fullForm: SmartCardOrderForm = {
  cardStyle: "metal-gold",
  quantity: 2,
  displayName: "  Thy Cheat Code  ",
  title: " The King Shark ",
  bio: " Runs the site. ",
  links: [
    { label: " Instagram ", url: " https://instagram.com/x " },
    { label: "", url: "https://orphan.example" },
    { label: "No address", url: "  " },
  ],
  fullName: " Tragedy Boss ",
  email: " boss@example.com ",
  phone: " 555-0100 ",
  street: " 1 Palace Way ",
  city: "New York",
  state: "NY",
  zip: "10001",
};

describe("smart cards — the no-charge contract", () => {
  it("the credit registry carries no charge for the NFC line's endpoints", () => {
    expect(creditCostsSrc).not.toContain('"/api/nfc-cards/order"');
    expect(creditCostsSrc).not.toContain('"/api/nfc-cards/profile"');
  });

  it("the catalog the stand shows is the line's own price list", () => {
    expect(NFC_CARD_STYLES.map((s) => [s.key, s.priceCents])).toEqual([
      ["pvc-matte-black", 2900],
      ["pvc-white", 2900],
      ["wood-bamboo", 3900],
      ["metal-black", 5900],
      ["metal-gold", 6900],
    ]);
  });

  it("the stand posts the reservation with skipConfirm — nothing to confirm, nothing charged", () => {
    expect(standSrc).toContain('"/api/nfc-cards/order"');
    expect(standSrc).toContain("skipConfirm: true");
    expect(standSrc).toContain('data-testid="world-smart-cards-stand"');
  });
});

describe("smart cards — the order body", () => {
  it("an idempotency key is minted fresh per attempt", () => {
    const a = newSmartCardOrderKey();
    const b = newSmartCardOrderKey();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it("half-written link rows never ride the order", () => {
    expect(smartCardValidLinks(fullForm.links)).toEqual([
      { label: " Instagram ", url: " https://instagram.com/x " },
    ]);
    expect(SMART_CARD_MAX_LINKS).toBe(12);
    expect(SMART_CARD_MAX_QUANTITY).toBe(100);
  });

  it("the payload is the page's body, field for field", () => {
    expect(buildSmartCardOrderPayload(fullForm, "key-1")).toEqual({
      cardStyle: "metal-gold",
      quantity: 2,
      displayName: "Thy Cheat Code",
      title: "The King Shark",
      bio: "Runs the site.",
      links: [{ label: " Instagram ", url: " https://instagram.com/x " }],
      fullName: "Tragedy Boss",
      email: "boss@example.com",
      phone: "555-0100",
      shippingAddress: {
        street: " 1 Palace Way ",
        city: "New York",
        state: "NY",
        zip: "10001",
        country: "USA",
      },
      idempotencyKey: "key-1",
    });
  });

  it("the completeness gate needs the card's name and a full, emailable shipping contact", () => {
    expect(smartCardOrderComplete(fullForm)).toBe(true);
    expect(smartCardOrderComplete({ ...fullForm, displayName: "   " })).toBe(false);
    expect(smartCardOrderComplete({ ...fullForm, email: "not-an-email" })).toBe(false);
    expect(smartCardOrderComplete({ ...fullForm, zip: "" })).toBe(false);
    expect(smartCardOrderComplete({ ...fullForm, street: " " })).toBe(false);
  });

  it("the reservation total is the catalog price times the count", () => {
    expect(smartCardOrderTotalCents(6900, 2)).toBe(13800);
    expect(smartCardOrderTotalCents(2900, 1)).toBe(2900);
  });

  it("the QR path and status words ride the rail's own shapes", () => {
    expect(smartCardQrPath("thy-cheat-code")).toBe("/api/nfc-cards/qr/thy-cheat-code.svg");
    expect(smartCardOrderStatusLabel("pending_fulfillment")).toBe("pending fulfillment");
    expect(smartCardOrderStatusLabel("received")).toBe("received");
  });
});

describe("smart cards — the wire readers", () => {
  it("profiles read with honest defaults — a sparse row is still a card", () => {
    const profiles = parseSmartCardProfiles({
      ok: true,
      profiles: [
        {
          slug: "thy-cheat-code",
          display_name: "Thy Cheat Code",
          title: "The King Shark",
          tap_count: 41,
          is_active: true,
          created_at: "2026-10-01T00:00:00Z",
          url: "https://bowdownvisuals.com/c/thy-cheat-code",
        },
        { slug: "second-card" },
        { display_name: "no slug, no card" },
      ],
    });
    expect(profiles).toHaveLength(2);
    expect(profiles![0]).toMatchObject({ slug: "thy-cheat-code", tapCount: 41, isActive: true, bio: "", links: [] });
    expect(profiles![1]).toMatchObject({ slug: "second-card", tapCount: 0, isActive: false });
  });

  it("orders read their first card's slug from either embed shape", () => {
    const orders = parseSmartCardOrders({
      ok: true,
      orders: [
        { id: "o1", card_style: "metal-gold", quantity: 2, status: "received", total_cents: 13800, created_at: "t", nfc_profiles: { slug: "a" } },
        { id: "o2", card_style: "pvc-white", quantity: 1, status: "pending_fulfillment", total_cents: 2900, created_at: "t", nfc_profiles: [{ slug: "b" }] },
      ],
    });
    expect(orders!.map((o) => o.slug)).toEqual(["a", "b"]);
    expect(orders![0]).toMatchObject({ cardStyle: "metal-gold", totalCents: 13800 });
  });

  it("a failed or foreign answer is null, never an empty shelf", () => {
    expect(parseSmartCardProfiles({ ok: false })).toBeNull();
    expect(parseSmartCardProfiles({ ok: true, profiles: "nope" })).toBeNull();
    expect(parseSmartCardProfiles(null)).toBeNull();
    expect(parseSmartCardOrders({ ok: true })).toBeNull();
    expect(parseSmartCardOrders("junk")).toBeNull();
  });

  it("the order result knows a fresh reservation from a deduped retry", () => {
    expect(
      parseSmartCardOrderResult({
        ok: true,
        order: { id: "o1" },
        profiles: [{ slug: "a" }, { slug: "b" }],
        profile: { slug: "a", url: "https://x/c/a" },
      }),
    ).toEqual({ slug: "a", url: "https://x/c/a", slugs: ["a", "b"], deduped: false });
    expect(parseSmartCardOrderResult({ ok: true, order: { id: "o1" } })).toEqual({
      slug: "",
      url: "",
      slugs: [],
      deduped: true,
    });
    expect(parseSmartCardOrderResult({ ok: true })).toBeNull();
    expect(parseSmartCardOrderResult({ ok: false, error: "Order failed" })).toBeNull();
  });

  it("the profile edit reads back and its payload drops half-written links", () => {
    expect(
      parseSmartCardProfile({
        ok: true,
        profile: { slug: "a", display_name: "A", links: [{ label: "Site", url: "https://x" }], is_active: true },
      }),
    ).toMatchObject({ slug: "a", displayName: "A", links: [{ label: "Site", url: "https://x" }] });
    expect(parseSmartCardProfile({ ok: true, profile: {} })).toBeNull();
    expect(
      buildSmartCardProfilePayload({
        displayName: "A",
        title: "",
        bio: "",
        links: [{ label: "Site", url: "https://x" }, { label: "", url: "" }],
      }),
    ).toEqual({ displayName: "A", title: "", bio: "", links: [{ label: "Site", url: "https://x" }] });
  });
});

describe("smart cards — the stand is wired natively", () => {
  it("the station stands in the Branding Atelier as a native business panel", () => {
    const s = STATION_BY_ID.get("smart-cards-stand");
    expect(s).toBeDefined();
    expect(s!.roomId).toBe(BRANDING_ATELIER_ID);
    expect(s!.panel).toEqual({ kind: "native", pattern: "business" });
    expect(s!.websitePath).toBe("/nfc-cards");
  });

  it("StationPanel routes the stand to its native panel", () => {
    expect(panelSrc).toContain('station.id === "smart-cards-stand"');
    expect(panelSrc).toContain("<SmartCardsStand");
  });
});
