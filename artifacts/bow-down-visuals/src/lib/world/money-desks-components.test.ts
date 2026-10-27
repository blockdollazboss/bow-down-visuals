/**
 * money-desks-components — Stack-100 Money wave I (items 61–64)
 * source-contract pins. The four in-world money surfaces must ride
 * the SITE's real endpoints (the 2D pages are the reference
 * implementation) and the sanctioned-exit discipline (hosted pages
 * open in a NEW TAB only, never a same-tab walk-out):
 * - #61 the packs desk POSTs /api/create-checkout-session and
 *   renders the lib's verified pack table (never its own prices);
 * - #62 the payout desk reads /api/connect/status and rides
 *   onboard/refresh/payout, with the dashboard's states;
 * - #63 the Crowns creator desk CRUDs /api/memberships/tiers and
 *   shows the rail-reported fee's net line;
 * - #64 the room store carts on the Marketplace rails
 *   (/api/storefronts/checkout + verify), buys tracks/videos on
 *   /api/store/checkout and store products on
 *   /api/storefront/checkout — and the blanket "Buy on the
 *   website" survives ONLY as the fallback for unsellable kinds.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const packs = read("../../components/world/native/PacksDesk.tsx");
const payout = read("../../components/world/native/PayoutDesk.tsx");
const earningsBoard = read("../../components/world/native/boards/EarningsBoard.tsx");
const stands = read("../../components/world/native/ShopStands.tsx");
const rooms = read("../../components/world/native/CreatorRooms.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("#61 packs desk contracts", () => {
  it("rides the pricing page's checkout rail and the verified pack table", () => {
    expect(packs).toContain('fetch("/api/create-checkout-session"');
    expect(packs).toContain("packCheckoutPayload(pack)");
    expect(packs).toContain("CREDIT_PACKS");
    expect(packs).toContain("PACKS_TEST_MODE_NOTE");
    expect(packs).toContain('data-testid="world-treasury-packs"');
    /* The hosted page opens in a NEW TAB — the palace never moves. */
    expect(packs).toContain('window.open(url, "_blank", "noopener,noreferrer")');
    expect(packs).not.toContain("window.location.href = ");
    /* The station is hung in the panel and the registry. */
    expect(panel).toContain('case "treasury-packs"');
    expect(panel).toContain("<PacksDesk");
  });
});

describe("#62 payout desk contracts", () => {
  it("rides the Connect rails with the dashboard's three states", () => {
    expect(payout).toContain('fetch("/api/connect/status"');
    expect(payout).toContain('"/api/connect/onboard"');
    expect(payout).toContain('"/api/connect/refresh"');
    expect(payout).toContain('fetch("/api/connect/payout"');
    expect(payout).toContain("canCashOut(status)");
    expect(payout).toContain("payoutSuccessNote(data)");
    expect(payout).toContain('data-testid="world-payout-desk"');
    /* Hosted bank setup: new tab only, never a walk-out. */
    expect(payout).toContain('window.open(url, "_blank", "noopener,noreferrer")');
    expect(payout).not.toContain("window.location.href = ");
    /* The desk hangs inside the Get Paid Room's board. */
    expect(earningsBoard).toContain("<PayoutDesk");
  });
});

describe("#63 crowns creator desk contracts", () => {
  it("CRUDs the caller's own tiers on the memberships rail", () => {
    expect(stands).toContain('fetch("/api/memberships/tiers"');
    expect(stands).toContain("`/api/memberships/tiers/${editingId}`");
    expect(stands).toContain('fetch("/api/memberships/dashboard"');
    expect(stands).toContain("buildTierPayload(form)");
    expect(stands).toContain("tierActivePayload(tier)");
    expect(stands).toContain('method: "DELETE"');
    expect(stands).toContain('data-testid="world-crowns-creator-desk"');
    /* The fee honesty: the rail-reported % and the net line. */
    expect(stands).toContain("tierNetCents(tier.priceCents, feePct)");
    expect(stands).toContain("after {feePct}% platform fee");
    /* Members only — the desk never renders for a guest. */
    expect(stands).toContain("{!isGuest && <CrownsCreatorDesk isLight={isLight} />}");
  });
});

describe("#64 room store contracts", () => {
  it("carts shop goods on the Marketplace rails and confirms from server truth", () => {
    expect(rooms).toContain("parseRoomCatalog");
    expect(rooms).toContain("roomItemRail(item)");
    expect(rooms).toContain('fetch("/api/storefronts/checkout"');
    expect(rooms).toContain('fetch("/api/storefronts/checkout/verify"');
    expect(rooms).toContain("marketPendingKey(handle)");
    expect(rooms).toContain("detailedMarketCart(cart, marketProducts)");
    expect(rooms).toContain("roomCartKey(handle, detail.slug)");
    expect(rooms).toContain('data-testid="world-room-store-checkout"');
    /* The fee model line, the stand's own words. */
    expect(rooms).toContain("Sellers keep 95% — the 5% platform fee");
  });

  it("buys tracks/videos and store products on their own rails", () => {
    expect(rooms).toContain('fetch("/api/store/checkout"');
    expect(rooms).toContain("storeCheckoutPayload(item");
    expect(rooms).toContain('fetch("/api/storefront/checkout"');
    expect(rooms).toContain("storefrontCheckoutPayload(item");
    /* Hosted pages open in a new tab only. */
    expect(rooms).toContain('window.open(url, "_blank", "noopener,noreferrer")');
    expect(rooms).not.toContain("window.location.href = ");
  });
});

describe("#63b crowns depth contracts (parity P3 — par-membership-depth)", () => {
  it("the roster rides the members rail — list, status PATCH, remove, manual add", () => {
    expect(stands).toContain('fetch("/api/memberships/members"');
    expect(stands).toContain("`/api/memberships/members/${member.id}`");
    expect(stands).toContain('method: "PATCH"');
    expect(stands).toContain("memberStatusPayload(status)");
    expect(stands).toContain("buildMemberAddPayload(memberTierId, memberLabel)");
    expect(stands).toContain('data-testid="world-crowns-roster"');
    expect(stands).toContain('data-testid="world-crowns-roster-row"');
    expect(stands).toContain('data-testid="world-crowns-member-add"');
    expect(stands).toContain('data-testid="world-crowns-member-remove"');
    /* Roster writes land only from server answers. */
    expect(stands).toContain("savedMemberStatus(data)");
    expect(stands).toContain("applyMemberStatus(list, saved)");
    expect(stands).toContain("removeMemberRow(list, member.id)");
    /* The manual add's honesty: a record, no payment taken. */
    expect(stands).toContain("It takes no payment and sends them nothing.");
  });

  it("the perk suggester rides the confirmed-spend seam at the rail's own price", () => {
    expect(stands).toContain('confirmedFetch("/api/memberships/ai-perks"');
    expect(stands).toContain("overrideCost: MEMBERSHIP_AI_PERKS_COST_VB");
    expect(stands).toContain("buildPerkSuggestPayload({ niche, audienceSize })");
    expect(stands).toContain("parsePerkSuggestions(data)");
    expect(stands).toContain('data-testid="world-crowns-perk-suggest"');
    expect(stands).toContain('data-testid="world-crowns-perk-use"');
    /* A suggestion fills the FORM — the save stays the creator's tap. */
    expect(stands).toContain("tierFormFromSuggestion(f, s)");
  });

  it("clubs are browsable — the directory lists, the paste door stays", () => {
    expect(stands).toContain('fetch("/api/memberships/directory")');
    expect(stands).toContain("parseClubDirectory(await res.json())");
    expect(stands).toContain('data-testid="world-crowns-directory"');
    expect(stands).toContain('data-testid="world-crowns-directory-row"');
    expect(stands).toContain("clubStartingLabel(row)");
    expect(stands).toContain("onClick={() => void loadClub(row.creatorUserId)}");
    expect(stands).toContain("parseCreatorUserId(creatorInput)");
  });

  it("gifting rides the checkout rail's recipient — free gifts land in-world, trials hide", () => {
    expect(stands).toContain("membershipCheckoutPayload(tier.id, period, recipientId)");
    expect(stands).toContain("parseRecipientUserId(recipientInput)");
    expect(stands).toContain('data-testid="world-crowns-gift"');
    expect(stands).toContain("Gift sent — they're a member now.");
    expect(stands).toContain("tierOffersTrial(tier) && !recipientId");
  });

  it("the return VERIFY confirms the landing — stash at checkout, verify on return", () => {
    expect(stands).toContain("localStorage.setItem(membershipPendingKey(), JSON.stringify(pending))");
    expect(stands).toContain("parseMembershipPending(localStorage.getItem(membershipPendingKey()))");
    expect(stands).toContain('fetch("/api/memberships/verify"');
    expect(stands).toContain("membershipVerifyState(res.status, data)");
    expect(stands).toContain('data-testid="world-crowns-join-confirmation"');
    expect(stands).toContain('data-testid="world-crowns-verify"');
    /* The money moment is still the ONE marked transfer, new tab only. */
    expect(stands).toContain('window.open(url, "_blank", "noopener,noreferrer")');
    expect(stands).not.toContain("window.location.href = ");
  });
});
