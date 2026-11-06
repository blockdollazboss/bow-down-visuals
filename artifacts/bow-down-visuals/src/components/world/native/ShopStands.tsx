import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
  BadgeCheck, BarChart3, Check, Copy, Crown, Gem, Gift, Globe, ImagePlus, Loader2, Minus, Pencil, Plus, RefreshCw,
  Settings2, ShoppingBag, ShoppingCart, Sparkles, Store, Trash2, Upload, Users, Wallet, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import type { PalaceStation } from "@/lib/world/stations";
import { NativeCard } from "./NativeCard";
import { DomainsDesk } from "./DomainsDesk";
import { GiftCardsDesk } from "./GiftCardsDesk";
import { StoreGrowthDesk } from "./StoreGrowthDesk";
import { DiscountCodesDesk } from "./DiscountCodesDesk";
import { PaidSeriesDropsDesk } from "./PaidSeriesDropsDesk";
import { ShoutoutsDesk } from "./ShoutoutsDesk";
import { ShoutoutsSellDesk } from "./ShoutoutsSellDesk";
import { paidWithGiftCard } from "@/lib/world/gift-cards";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import { centsToDisplay, cartKey } from "@/lib/shops";
import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout";
import {
  BRANDING_COLORS, BRANDING_DESIGN_COST, BRANDING_PRODUCTS, BRANDING_STYLES,
  MAX_DESIGN_PRODUCTS, formatMoney, productByKey,
  type BrandStyle, type ColorKey, type ProductKey,
} from "@/lib/branding-shop";
import {
  checkoutTransferLabel, contactForQuoteLabel,
  activeMembershipTiers, addBrandingCartLine, addToCartLines,
  brandingCartTotalCents, brandingDesignComplete, brandingOrderPayload,
  brandingOrderStatusLabel, brandingShippingComplete, checkoutCompletedInWorld,
  detailedMarketCart, hostedCheckoutUrl, isQuoteOnly, marketCartCount, membershipDollars,
  clubStartingLabel, membershipCheckoutPayload, membershipPendingKey, membershipVerifyState,
  parseClubDirectory, parseMembershipPending, parseRecipientUserId,
  marketCartTotalCents, marketOrderFromPayload, marketPendingKey, parseCreatorUserId,
  setBrandingCartQty, setCartLineQty,
  tierAnnualSavingLabel, tierOffersTrial, tierPriceLabel,
  SHOP_AI_DESCRIPTION_COST_VB, SHOP_AI_IMAGE_PREMIUM_COST_VB, SHOP_AI_IMAGE_STANDARD_COST_VB,
  SHOP_AI_SHOP_DESCRIPTION_COST_VB, SHOP_DESCRIPTION_MAX, SHOP_HANDLE_MAX, SHOP_NAME_MAX,
  SHOP_TAGLINE_MAX,
  aiOutOfCredits, applyProductSave, buildProductDescriptionPayload, buildProductImagePayload,
  buildProductPayload, buildShopCreatePayload, buildShopDescriptionPayload,
  buildShopSettingsPayload, emptyProductForm, emptyShopCreateForm,
  isOwnStand, maxDailyViews, parseAiDescription, parseAiImageUrl,
  parseMineShops, parseSellerEarnings, parseShopAnalytics, productFormFromDto, productFormProblem,
  recentShopPending, recentShopSales, removeProduct, savedProductDto, savedShopDto,
  sellerEarningsRows, shopDesignColors,
  SHOP_DOMAIN_CNAME_TARGET,
  buildShopDomainAttachBody, parseShopDomainAttachResult, parseShopDomainVerifyResult,
  shopDomainStatus, shopDomainVerifyHost,
  type ShopDomainAttachResult,
  shopCreateProblem, shopSettingsFormFromShop, shopSettingsProblem,
  type BillingPeriod, type BrandingCartLine, type BrandingDesignResult,
  type BrandingOrderDto, type BrandingShipping, type ClubDirectoryRow, type HubShopDto,
  type MarketOrder, type MembershipPendingCheckout, type MembershipTierDto, type MineShopDto, type MyMembershipDto,
  type ProductFormState, type PublicProductDto,
  type PublicShopDto, type SellerEarnings, type ShopAnalytics, type ShopCreateFormState,
  type ShopSettingsFormState, type TierLabelStrings,
} from "@/lib/world/shop-stands";
import {
  SHOP_DESIGN_STARTERS,
  isStarterApplied,
  shopStarterPatch,
  type ShopDesignStarter,
} from "@/lib/shop-starters";
import type { CartLine } from "@/lib/shops";
import {
  MEMBER_STATUS_OPTIONS,
  MEMBERSHIP_AI_PERKS_COST_VB,
  TIER_PERKS_MAX,
  apiErrorLine,
  applyMemberStatus,
  applyTierSave,
  buildMemberAddPayload,
  buildPerkSuggestPayload,
  buildTierPayload,
  emptyTierForm,
  memberAddProblem,
  memberStatusPayload,
  parseOwnTiers,
  parsePerkSuggestions,
  parseRosterMembers,
  removeMemberRow,
  removeTier,
  savedMemberStatus,
  savedTierDto,
  tierActivePayload,
  tierFormFromDto,
  tierFormFromSuggestion,
  tierFormProblem,
  tierNetCents,
  type AudienceSize,
  type MemberStatusOption,
  type RosterMemberDto,
  type SuggestedTierDto,
  type TierFormState,
} from "@/lib/world/money-desks";

/* ─── ShopStands — the Shop Stand pattern (NATIVE-PLAN §3.3) ────────
   The palace's three buying surfaces, built for the room: goods on
   a stand, the cart in your hand, everything in-world — EXCEPT the
   one sanctioned transfer (§3.9): at the money moment the stand
   POSTs its checkout endpoint and opens the hosted payment page
   the server returns in a NEW TAB. The palace tab, the room and
   your place in it never move. The checkout action carries the
   uniform label for that moment: checkoutTransferLabel(t) — the
   CHECKOUT_TRANSFER_LABEL constant, resolved through the catalogs.
   JOIN2 UPDATE: the Marketplace stand's money moment is embedded
   first (uiMode: "embedded" → the shared EmbeddedSessionCheckout
   mounts in the stand; the server rail landed with this join) —
   the new-tab transfer remains only as the no-publishable-key
   fallback, here and at the Treasury desks.
   SWEEP UPDATE (stack1200): the Crowns stand's join is embedded
   first the same way — the memberships rail answers a clientSecret
   and the crown is paid for right at the stand; the §3.9 new-tab
   transfer remains only as its fallback.
   Prices are the real server charges end to end — payload prices
   (Marketplace, Crowns) and the shared client catalog (Branding)
   are displayed and charged from the same source.

   Stand management (Stack-4 #7): when the walker OWNs the open
   Marketplace stand, the stand itself becomes the shop desk —
   product create/edit/delete and the two product AI helpers ride
   the website's own /api/shops rails with the page's exact
   payloads, in-world. Ownership is proven from the caller's own
   GET /api/shops/mine list (the public stand DTO strips user_id
   by design); guests and non-owners only ever see the buyer's
   stand, and an unlanded ownership read fails closed. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

/** The one way a hosted payment page ever opens from a stand:
 *  a new tab, at the checkout moment, on the walker's click. */
function openCheckoutTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function goldBtn(disabled = false) {
  return `inline-flex items-center justify-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 bdv-touch-target ${disabled ? "opacity-50 hover:scale-100" : ""}`;
}
function chipBtn(isLight: boolean) {
  return `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;
}
function standTabBtn(isLight: boolean, active: boolean) {
  if (active) return "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-black text-black transition bdv-touch-target";
  return chipBtn(isLight);
}
function inputCls(isLight: boolean) {
  return `w-full rounded-xl border px-3 py-2 text-sm outline-none bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60 focus:border-[#7A5A12]"
      : "border-white/15 bg-black/50 text-white placeholder:text-white/30 focus:border-[#d4af37]/60"
  }`;
}
function muted(isLight: boolean) {
  return isLight ? "text-[#6B5B36]" : "text-white/50";
}
function StandTitle({ isLight, children }: { isLight: boolean; children: string }) {
  return (
    <p className={`px-1 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
      {children}
    </p>
  );
}

export interface ShopStandProps {
  station: PalaceStation;
  isLight: boolean;
  isGuest: boolean;
}

/** Dispatch for pattern "shop" — the host swaps this in for the
 *  placeholder on exactly the three shop stations. */
export function ShopStand({ station, isLight, isGuest }: ShopStandProps) {
  switch (station.id) {
    case "marketplace":
      return <MarketplaceStand isLight={isLight} isGuest={isGuest} />;
    case "branding-shop-desk":
      return <BrandingShopStand isLight={isLight} isGuest={isGuest} />;
    case "crowns-desk":
      return <CrownsStand isLight={isLight} isGuest={isGuest} />;
    default:
      return <MarketplaceStand isLight={isLight} isGuest={isGuest} />;
  }
}

/* ═══ 1. The Marketplace — shopfronts as stands ════════════════════ */

function MarketplaceStand({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t } = useTranslation();
  const authHeaders = useAuthHeaders();
  const [shops, setShops] = useState<HubShopDto[] | null>(null);
  const [shopsFailed, setShopsFailed] = useState(false);
  const [tick, setTick] = useState(0);

  /* My shops — the ownership proof for stand management (Stack-4
     #7). Null means the read hasn't landed OR failed: either way
     ownership is unproven and NO management renders (fail closed).
     Guests never fetch it at all. */
  const [mineShops, setMineShops] = useState<MineShopDto[] | null>(null);
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/shops/mine", { headers: await authHeaders() });
        if (!res.ok) throw new Error("mine");
        const data = (await res.json()) as unknown;
        if (!cancelled) setMineShops(parseMineShops(data));
      } catch { /* fail closed — mineShops stays null, the stand stays a buyer's stand */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  const [openHandle, setOpenHandle] = useState<string | null>(null);
  const [shop, setShop] = useState<PublicShopDto | null>(null);
  const [products, setProducts] = useState<PublicProductDto[]>([]);
  const [feePct, setFeePct] = useState(10);
  const [standState, setStandState] = useState<"idle" | "loading" | "ready" | "failed">("idle");

  const [cart, setCart] = useState<CartLine[]>([]);
  const cartLoadedFor = useRef<string | null>(null);
  const [buyerEmail, setBuyerEmail] = useState("");
  /* The gift-card tender, mirroring the shop page's cart box: a
     card from THIS shop's creator pays here; whatever it doesn't
     cover goes on the card payment, and what's left stays on it. */
  const [giftCardInput, setGiftCardInput] = useState("");
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  /* The confirmed (PAID) order — the reward moment, rendered only
     from server truth via marketOrderFromPayload. A pending order is
     a note + a refresh door, never this block. */
  const [paidOrder, setPaidOrder] = useState<MarketOrder | null>(null);
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  /* JOIN2 money moment: the embedded session's clientSecret, when the
     checkout answered one — the shared EmbeddedSessionCheckout mounts
     in this stand so the buyer pays without leaving the palace. */
  const [embeddedSecret, setEmbeddedSecret] = useState<string | null>(null);
  const [refreshingOrder, setRefreshingOrder] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/storefronts?limit=60");
        if (!res.ok) throw new Error("shops");
        const data = (await res.json()) as { shops?: HubShopDto[] };
        if (!cancelled) {
          setShops(Array.isArray(data.shops) ? data.shops : []);
          setShopsFailed(false);
        }
      } catch {
        if (!cancelled) setShopsFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [tick]);

  const openStand = async (handle: string) => {
    setOpenHandle(handle);
    setStandState("loading");
    setShop(null);
    setProducts([]);
    setPaidOrder(null);
    setPendingNote(null);
    setOrderError(null);
    try {
      const res = await fetch(`/api/storefronts/slug/${encodeURIComponent(handle)}`);
      if (!res.ok) throw new Error("stand");
      const data = (await res.json()) as { shop?: PublicShopDto; products?: PublicProductDto[]; platformFeePct?: number };
      if (!data.shop) throw new Error("stand");
      setShop(data.shop);
      setProducts(Array.isArray(data.products) ? data.products : []);
      setFeePct(data.platformFeePct ?? 5);
      setStandState("ready");
      /* An unfinished checkout from an earlier visit refreshes from
         server truth the moment the stand reopens. */
      void refreshOrder(handle);
    } catch {
      setStandState("failed");
    }
  };

  /* Refresh an order from SERVER truth (POST verify retrieves the
     session and flips the order only when Stripe says paid). Paid →
     the reward moment + the cart clears; still pending → an honest
     pending note; expired → the note says so and the marker drops. */
  const refreshOrder = async (handle: string) => {
    let sessionId: string | null = null;
    try { sessionId = localStorage.getItem(marketPendingKey(handle)); } catch { /* storage blocked */ }
    if (!sessionId || refreshingOrder) return;
    setRefreshingOrder(true);
    try {
      const res = await fetch("/api/storefronts/checkout/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error("verify");
      const order = marketOrderFromPayload(data["order"] ?? data);
      if (order?.paid) {
        setPaidOrder(order);
        setPendingNote(null);
        setCart([]);
        try { localStorage.removeItem(marketPendingKey(handle)); } catch { /* ignore */ }
      } else if (order?.status === "expired") {
        setPendingNote(t("worldCommerceStands.shopOrderExpiredNote"));
        try { localStorage.removeItem(marketPendingKey(handle)); } catch { /* ignore */ }
      } else {
        setPendingNote(t("worldCommerceStands.shopOrderPendingHosted"));
      }
    } catch {
      setPendingNote(t("worldCommerceStands.shopOrderPendingStale"));
    } finally {
      setRefreshingOrder(false);
    }
  };

  /* Coming back from the hosted checkout tab: refresh the pending
     order in-world when the palace tab takes focus again. */
  useEffect(() => {
    if (!openHandle) return;
    const onFocus = () => void refreshOrder(openHandle);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openHandle]);

  /* The cart is the shop page's own: local lines, persisted per
     shop handle under the same localStorage key the page uses. */
  useEffect(() => {
    if (!openHandle) return;
    cartLoadedFor.current = null;
    try {
      const raw = localStorage.getItem(cartKey(openHandle));
      const parsed = raw ? (JSON.parse(raw) as CartLine[]) : [];
      setCart(Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.productId === "string") : []);
    } catch {
      setCart([]);
    }
    cartLoadedFor.current = openHandle;
  }, [openHandle ]);

  useEffect(() => {
    if (!openHandle || cartLoadedFor.current !== openHandle) return;
    try {
      localStorage.setItem(cartKey(openHandle), JSON.stringify(cart));
    } catch { /* storage blocked — the cart just won't persist */ }
  }, [cart, openHandle]);

  const detailed = useMemo(() => detailedMarketCart(cart, products), [cart, products]);
  const total = marketCartTotalCents(detailed);
  const count = marketCartCount(detailed);

  /* The management gate: the open shop's id must appear in MY OWN
     shops list — the only ownership proof the public DTO allows. */
  const ownsStand = isOwnStand(mineShops, shop?.id);
  /* The owner's own full record for the open shop — the settings
     form's source (tagline/description in full, which the public
     DTO also carries, kept in step by every confirmed save). */
  const ownMineShop = ownsStand ? (mineShops?.find((m) => m.id === shop?.id) ?? null) : null;

  /* Checkout — the marked transfer (§3.9). ONE POST for the whole
     cart: the server records the order as PENDING, prices it from
     its own product rows, and answers the hosted payment URL, which
     opens in a NEW TAB. The order is not a sale yet — the cart stays
     put until the payment confirms (refreshOrder, on focus/reopen),
     and only a server-confirmed paid order renders as paid. A free
     cart completes in-world (checkoutCompletedInWorld) with the
     paid confirmation straight away. Session-creation failure is an
     honest error with the cart untouched. */
  const checkout = async () => {
    if (!shop || detailed.length === 0 || placing) return;
    setPlacing(true);
    setOrderError(null);
    setPendingNote(null);
    setEmbeddedSecret(null);
    try {
      const res = await fetch("/api/storefronts/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId: shop.id,
          items: detailed.map((l) => ({ productId: l.productId, quantity: l.qty })),
          buyerEmail: buyerEmail.trim() || undefined,
          /* The tender rides only when a code was pasted — the rail
             treats it as tender (never a discount) and answers
             WRONG_STORE for a card from another creator's store,
             which surfaces through the stand's honest error line. */
          giftCardCode: giftCardInput.trim() || undefined,
          /* JOIN2: ask for the embedded presentation when this device
             can mount it (publishable key configured) — the server
             answers a clientSecret instead of a hosted URL and the
             buyer pays right here. Otherwise the hosted rail below
             remains the fallback. */
          uiMode: hasStripePublishableKey() ? "embedded" : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.shopCheckoutFailed")));
      /* A gift card that covers the whole bill answers paid with
         NO payment page (paidWithGiftCard) — that's a completed
         in-world purchase too, and falling through to the URL hunt
         would call a successful buy a failure. */
      if (checkoutCompletedInWorld(data) || paidWithGiftCard(data)) {
        const order = marketOrderFromPayload(data);
        if (order?.paid) setPaidOrder(order);
        setCart([]);
        return;
      }
      if (typeof data.clientSecret === "string" && data.clientSecret) {
        if (typeof data.sessionId === "string" && openHandle) {
          try { localStorage.setItem(marketPendingKey(openHandle), data.sessionId); } catch { /* storage blocked — refresh on reopen just won't find it */ }
        }
        setEmbeddedSecret(data.clientSecret);
        setPendingNote(t("worldCommerceStands.shopOrderPendingEmbedded"));
        return;
      }
      const url = hostedCheckoutUrl(data);
      if (url) {
        if (typeof data.sessionId === "string" && openHandle) {
          try { localStorage.setItem(marketPendingKey(openHandle), data.sessionId); } catch { /* storage blocked — refresh on reopen just won't find it */ }
        }
        openCheckoutTab(url);
        setPendingNote(t("worldCommerceStands.shopOrderPendingTab"));
        return;
      }
      throw new Error(t("worldCommerceStands.shopCheckoutNoPage"));
    } catch (e) {
      setOrderError(plainErrorText(e, t("worldCommerceStands.shopCheckoutFailedCart")));
    } finally {
      setPlacing(false);
    }
  };

  if (openHandle) {
    return (
      <div className="space-y-3" data-testid="world-shop-marketplace-stand">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setOpenHandle(null)} className={chipBtn(isLight)}>
            {t("worldCommerceStands.shopAllStands")}
          </button>
          {shop && (
            <span className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{shop.name}</span>
          )}
          {shop?.tagline && <span className={`text-xs ${muted(isLight)}`}>{shop.tagline}</span>}
          {count > 0 && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1 text-xs font-black text-black">
              <ShoppingBag className="h-3.5 w-3.5" /> {t("worldCommerceStands.shopCartPill", { count, total: centsToDisplay(total) })}
            </span>
          )}
        </div>

        {standState === "loading" && <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.shopStandLoading")} />}
        {standState === "failed" && (
          <NativeErrorState
            isLight={isLight}
            title={t("worldCommerceStands.shopStandFailedTitle")}
            message={t("worldCommerceStands.shopStandFailedMsg")}
            onRetry={() => void openStand(openHandle)}
          />
        )}
        {standState === "ready" && products.length === 0 && (
          <NativeEmptyState isLight={isLight} message={t("worldCommerceStands.shopStandEmpty")} />
        )}
        {standState === "ready" && products.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <NativeCard key={p.id} isLight={isLight}>
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="mb-2 h-28 w-full rounded-xl object-cover" />
                ) : null}
                <p className={`truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{p.name}</p>
                {p.description && <p className={`mt-0.5 line-clamp-2 text-xs ${muted(isLight)}`}>{p.description}</p>}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm font-black text-[#d4af37]">{centsToDisplay(p.price_cents)}</span>
                  <button
                    type="button"
                    data-testid="world-shop-add-to-cart"
                    onClick={() => setCart((c) => addToCartLines(c, p.id))}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
                  >
                    <Plus className="h-3.5 w-3.5" /> {t("worldCommerceStands.shopAddToCart")}
                  </button>
                </div>
              </NativeCard>
            ))}
          </div>
        )}

        {standState === "ready" && ownsStand && shop && ownMineShop && (
          <StandManager
            key={shop.id}
            shop={shop}
            mineShop={ownMineShop}
            products={products}
            setProducts={setProducts}
            isLight={isLight}
            onShopSaved={(pub, mine) => {
              setShop(pub);
              setMineShops((ms) => (ms ? ms.map((m) => (m.id === mine.id ? mine : m)) : ms));
              setTick((n) => n + 1);
            }}
            onShopDeleted={() => {
              setMineShops((ms) => (ms ? ms.filter((m) => m.id !== shop.id) : ms));
              setOpenHandle(null);
              setTick((n) => n + 1);
            }}
          />
        )}

        {standState === "ready" && (detailed.length > 0 || paidOrder || pendingNote) && (
          <NativeCard isLight={isLight} title={count > 0 ? t("worldCommerceStands.shopCartTitleCount", { count }) : t("worldCommerceStands.shopCartTitle")}>
            {detailed.map((l) => (
              <div key={l.productId} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className={`min-w-0 flex-1 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{l.product.name}</span>
                <span className="text-sm font-black text-[#d4af37]">{centsToDisplay(l.product.price_cents * l.qty)}</span>
                <span className="inline-flex items-center gap-1.5">
                  <button type="button" aria-label={t("worldCommerceStands.shopOneLess")} onClick={() => setCart((c) => setCartLineQty(c, l.productId, l.qty - 1))} className={`${chipBtn(isLight)} bdv-touch-box`}><Minus className="h-3 w-3" /></button>
                  <span className="w-5 text-center text-sm font-bold">{l.qty}</span>
                  <button type="button" aria-label={t("worldCommerceStands.shopOneMore")} onClick={() => setCart((c) => setCartLineQty(c, l.productId, l.qty + 1))} className={`${chipBtn(isLight)} bdv-touch-box`}><Plus className="h-3 w-3" /></button>
                  <button type="button" aria-label={t("worldCommerceStands.shopRemoveFromCart")} onClick={() => setCart((c) => setCartLineQty(c, l.productId, 0))} className={`${chipBtn(isLight)} bdv-touch-box`}><Trash2 className="h-3 w-3" /></button>
                </span>
              </div>
            ))}
            {detailed.length > 0 && !paidOrder && (
              <div className="mt-2 space-y-2 border-t border-[#d4af37]/25 pt-3">
                <div className="flex items-center justify-between text-sm">
                  <span className={muted(isLight)}>{t("worldCommerceStands.shopTotal")}</span>
                  <span className="text-lg font-black">{centsToDisplay(total)}</span>
                </div>
                <input
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  type="email"
                  placeholder={t("worldCommerceStands.shopReceiptEmail")}
                  aria-label={t("worldCommerceStands.shopReceiptEmail")}
                  className={inputCls(isLight)}
                />
                <input
                  value={giftCardInput}
                  onChange={(e) => setGiftCardInput(e.target.value)}
                  placeholder={t("worldCommerceStands.shopGiftCardPlaceholder")}
                  aria-label={t("worldCommerceStands.shopGiftCardAria")}
                  data-testid="world-shop-gift-card-input"
                  className={inputCls(isLight)}
                />
                <p className={`text-[11px] ${muted(isLight)}`}>
                  {t("worldCommerceStands.shopGiftCardNote")}
                </p>
                {orderError && <p className="text-xs font-semibold text-red-400">{orderError}</p>}
                {/* The ONE marked door out of this stand: payment. */}
                <button type="button" data-testid="world-shop-checkout" onClick={() => void checkout()} disabled={placing} className={`${goldBtn(placing)} w-full`}>
                  {placing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
                  {checkoutTransferLabel(t)} · {centsToDisplay(total)}
                </button>
                <p className={`text-[11px] ${muted(isLight)}`}>
                  {t("worldCommerceStands.shopFeeLine", { keep: 100 - feePct, fee: feePct })}
                </p>
              </div>
            )}
            {embeddedSecret && !paidOrder && (
              <div className="mt-2 space-y-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-shop-embedded-checkout">
                <EmbeddedSessionCheckout clientSecret={embeddedSecret} />
                <button type="button" onClick={() => setEmbeddedSecret(null)} className={`${chipBtn(isLight)}`}>
                  {t("worldCommerceStands.shopEmbeddedClose")}
                </button>
              </div>
            )}
            {pendingNote && !paidOrder && (
              <div className="mt-2 space-y-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-shop-pending-order">
                <p className="flex items-start gap-2 text-xs font-semibold text-amber-300">
                  <Loader2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${refreshingOrder ? "animate-spin" : ""}`} />
                  <span>{pendingNote}</span>
                </p>
                <p className={`text-[11px] ${muted(isLight)}`}>
                  {t("worldCommerceStands.shopPendingHonesty")}
                </p>
                <button type="button" data-testid="world-shop-refresh-order" onClick={() => openHandle && void refreshOrder(openHandle)} disabled={refreshingOrder} className={`${chipBtn(isLight)}`}>
                  <RefreshCw className="h-3 w-3" /> {t("worldCommerceStands.shopCheckPayment")}
                </button>
              </div>
            )}
            {paidOrder && (
              /* The reward moment: the acquired items, named proudly
                 from the server's own confirmed order — never from a
                 local guess. */
              <div className="py-2 text-center" data-testid="world-shop-paid-confirmation">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#d4af37]/20 ring-2 ring-[#d4af37]/60">
                  <Sparkles className="h-6 w-6 text-[#d4af37]" />
                </span>
                <p className={`mt-2 text-base font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  {t("worldCommerceStands.shopPaidTitle")}
                </p>
                <div className="mx-auto mt-2 max-w-sm space-y-1">
                  {paidOrder.lines.map((l) => (
                    <p key={l.saleId} className="flex items-center justify-center gap-1.5 text-sm font-bold">
                      <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-300" />
                      <span className={isLight ? "text-[#2a1e07]" : "text-white"}>
                        {l.quantity > 1 ? t("worldCommerceStands.shopQtyPrefix", { qty: l.quantity }) : ""}{l.productName ?? t("worldCommerceStands.shopYourItem")}
                      </span>
                      <span className="text-[#d4af37]">{centsToDisplay(l.gross_cents)}</span>
                    </p>
                  ))}
                </div>
                <p className={`mt-2 text-xs ${muted(isLight)}`}>
                  {t("worldCommerceStands.shopPaidSummary", { gross: centsToDisplay(paidOrder.gross_cents), fee: feePct, feeAmount: centsToDisplay(paidOrder.platform_fee_cents), net: centsToDisplay(paidOrder.seller_net_cents) })}
                </p>
                <button type="button" onClick={() => setPaidOrder(null)} className={`${chipBtn(isLight)} mt-2`}>{t("worldCommerceStands.shopKeepBrowsing")}</button>
              </div>
            )}
          </NativeCard>
        )}
        {isGuest && (
          <p className={`px-1 text-[11px] ${muted(isLight)}`}>{t("worldCommerceStands.shopGuestBuyNote")}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="world-shop-marketplace">
      <StandTitle isLight={isLight}>{t("worldCommerceStands.shopSquareTitle")}</StandTitle>
      {shopsFailed ? (
        <NativeErrorState isLight={isLight} title={t("worldCommerceStands.shopSquareFailedTitle")} message={t("worldCommerceStands.shopSquareFailedMsg")} onRetry={() => setTick((n) => n + 1)} />
      ) : shops === null ? (
        <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.shopSquareLoading")} />
      ) : shops.length === 0 ? (
        <NativeEmptyState isLight={isLight} message={t("worldCommerceStands.shopSquareEmpty")} detail={t("worldCommerceStands.shopSquareEmptyDetail")} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shops.map((s) => (
            <NativeCard key={s.id} isLight={isLight}>
              <p className={`flex items-center gap-2 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                <Store className="h-4 w-4 shrink-0 text-[#d4af37]" /> {s.name}
              </p>
              {s.tagline && <p className={`mt-0.5 line-clamp-2 text-xs ${muted(isLight)}`}>{s.tagline}</p>}
              <div className="mt-2 flex items-center gap-2">
                <span className={`text-xs font-semibold ${muted(isLight)}`}>
                  {t(s.product_count === 1 ? "worldCommerceStands.shopProductOne" : "worldCommerceStands.shopProductMany", { count: s.product_count })}
                </span>
                <button type="button" data-testid="world-shop-open-stand" onClick={() => void openStand(s.handle)} className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target">
                  {t("worldCommerceStands.shopVisitStand")}
                </button>
              </div>
            </NativeCard>
          ))}
        </div>
      )}
      {/* Gift-card truth at the square (the read half of gift-card
          parity): any code's balance — the code is the capability,
          guests included — and, for members, the cards in their
          name, all from the rails' own answers. */}
      <GiftCardsDesk isLight={isLight} isGuest={isGuest} />
      {/* Paid series + product drops (parity wave 1) — series
          unlocks and timed product drops, on their own rails,
          in the PaidSeriesDropsDesk below the square. */}
      <PaidSeriesDropsDesk isLight={isLight} isGuest={isGuest} />
      {/* Shoutouts marketplace, buy-side (stack1500 parity wave
          #4b, census item 27): browse the creators taking requests
          and book one on the shoutout rails — payment embedded
          first, new tab only at the money moment, verify on
          return — plus the member's own selling settings, in the
          ShoutoutsDesk below the square. */}
      <ShoutoutsDesk isLight={isLight} isGuest={isGuest} />
      {/* Shoutouts sell-side (stack1500 parity wave 4c) — the
          creator's counter: request inbox, accept / record /
          deliver, revenue and the message helper, on the shoutouts
          rails. Members only — every sell rail is requireAuth, and
          guests keep the square alone. */}
      {!isGuest && <ShoutoutsSellDesk isLight={isLight} isGuest={isGuest} />}
      {/* Opening a shop (Stack-4 wave-2 #6) — the website's own
          create rail, offered only once the caller's mine read has
          landed (a signed-in member surface; guests and an unlanded
          read see the square alone). The new stand joins the square
          from the refreshed server list, never from a local guess. */}
      {!isGuest && mineShops !== null && (
        <StandCreateShop
          isLight={isLight}
          onCreated={(mine) => {
            setMineShops((ms) => (ms ? [mine, ...ms] : [mine]));
            setTick((n) => n + 1);
          }}
        />
      )}
      {/* Store growth trio (stack1400 parity wave #1 item 3): lead
          magnets, order bumps and the post-purchase upsell
          designation for the seller's own storefront store, on the
          storefront rails — its own desk component
          (StoreGrowthDesk), self-gating (members only; a
          no-profile account gets its honest setup state). */}
      {!isGuest && <StoreGrowthDesk isLight={isLight} isGuest={isGuest} />}
      {/* Discount codes (stack1500 parity wave #3 item 45):
          the seller's profile-wide codes — create, switch,
          delete — on the free /api/storefront/discounts rails,
          its own desk component (DiscountCodesDesk),
          self-gating the same way. */}
      {!isGuest && <DiscountCodesDesk isLight={isLight} isGuest={isGuest} />}
    </div>
  );
}

/* ═══ 1a. Open a shop — the create rail, at the square ════════════
   POST /api/shops with the My Shop page's exact body. Opening a
   shop is a Pro-tier rail on the server; a refusal (tier, taken
   handle) is the rail's own answer, shown as-is — the form stays
   and nothing appears on the square until the server confirms. */

function StandCreateShop({
  isLight,
  onCreated,
}: {
  isLight: boolean;
  onCreated: (mine: MineShopDto) => void;
}) {
  const { t } = useTranslation();
  const formStrings = {
    productNameFirst: t("worldCommerceStands.shopProbProductName"),
    priceValid: t("worldCommerceStands.shopProbPriceValid"),
    shopNameFirst: t("worldCommerceStands.shopProbShopName"),
    nameMax: t("worldCommerceStands.shopProbNameMax"),
    taglineMax: t("worldCommerceStands.shopProbTaglineMax"),
    descMax: t("worldCommerceStands.shopProbDescMax"),
    handleProblem: t("worldCommerceStands.shopProbHandle"),
  };
  const authHeaders = useAuthHeaders();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ShopCreateFormState>(emptyShopCreateForm());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const set = (patch: Partial<ShopCreateFormState>) => setForm((f) => ({ ...f, ...patch }));

  const create = async () => {
    if (creating) return;
    const problem = shopCreateProblem(form, formStrings);
    if (problem) { setError(problem); return; }
    const payload = buildShopCreatePayload(form);
    if (!payload) { setError(t("worldCommerceStands.shopCreateBad")); return; }
    setCreating(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/shops", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.shopCreateFailed"));
      const saved = savedShopDto(data);
      if (!saved) throw new Error(t("worldCommerceStands.shopCreateEmpty"));
      onCreated(saved.mine);
      setForm(emptyShopCreateForm());
      setOpen(false);
      setNote(t("worldCommerceStands.shopCreatedNote", { name: saved.mine.name }));
    } catch (e) {
      setError(plainErrorText(e, t("worldCommerceStands.shopCreateFailed")));
    } finally {
      setCreating(false);
    }
  };

  return (
    <NativeCard isLight={isLight} title={t("worldCommerceStands.shopCreateCardTitle")}>
      <div className="space-y-2" data-testid="world-shop-create">
        <p className={`text-xs ${muted(isLight)}`}>
          {t("worldCommerceStands.shopCreateIntro")}
        </p>
        {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
        {note && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
        {!open ? (
          <button type="button" data-testid="world-shop-create-open" onClick={() => { setOpen(true); setError(null); }} className={goldBtn()}>
            <Store className="h-4 w-4" /> {t("worldCommerceStands.shopOpenShop")}
          </button>
        ) : (
          <div className="space-y-2" data-testid="world-shop-create-form">
            <input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder={t("worldCommerceStands.shopNameLabel")}
              aria-label={t("worldCommerceStands.shopNameLabel")}
              maxLength={SHOP_NAME_MAX}
              className={inputCls(isLight)}
            />
            <input
              value={form.handle}
              onChange={(e) => set({ handle: e.target.value })}
              placeholder={t("worldCommerceStands.shopHandlePlaceholder")}
              aria-label={t("worldCommerceStands.shopHandleAria")}
              maxLength={SHOP_HANDLE_MAX}
              className={inputCls(isLight)}
            />
            <input
              value={form.tagline}
              onChange={(e) => set({ tagline: e.target.value })}
              placeholder={t("worldCommerceStands.shopTaglinePlaceholder")}
              aria-label={t("worldCommerceStands.shopTaglinePlaceholder")}
              maxLength={SHOP_TAGLINE_MAX}
              className={inputCls(isLight)}
            />
            <div className="flex flex-wrap gap-1.5">
              <button type="button" data-testid="world-shop-create-submit" onClick={() => void create()} disabled={creating} className={goldBtn(creating)}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t("worldCommerceStands.shopOpenSubmit")}
              </button>
              <button type="button" onClick={() => { setOpen(false); setError(null); }} className={chipBtn(isLight)}>
                <X className="h-3 w-3" /> {t("worldCommerceStands.shopCancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </NativeCard>
  );
}

/* ═══ 1b. Stand management — the owner's desk at their own stand ══
   Rendered ONLY for the stand's proven owner (see the gate in
   MarketplaceStand). Every verb rides the website's own shops
   rails with the My Shop page's exact payloads — no parallel API:
   create/edit/delete products, plus the two product AI helpers
   through the World's confirmed-spend seam, prices shown before
   each run. The shelf changes ONLY from server-confirmed answers;
   a failed save or delete reports honestly and changes nothing.

   Wave-2 #6 completes the desk: SHOP SETTINGS (name/tagline/
   description on PATCH /api/shops/:id, the shop-description
   writer on the same confirmed-spend seam, delete-the-shop behind
   the same two-step discipline as product deletes) and the SALES
   view (GET /api/storefronts/:id/analytics — the owner-scoped
   ledger the My Shop page reads; totals, the 30-day views strip,
   recent sales, and pending checkouts kept visibly apart from
   sales). Custom domains dock here too (Stack-100 #68): the
   DomainsDesk under the settings form rides the creator-domains
   page's own lib/domains rails (claim / verify / remove). The
   SHOP's own storefront domain docks beside it (Stack-100 #29):
   the ShopDomainSection rides the storefront domain rails
   (/api/storefronts/:id/domain + /domain/verify) the My Shop
   page's DomainManager runs — connect, the rail's own DNS
   instructions, verify, disconnect. */

/* ─── ShopDomainSection — the SHOP's storefront domain ────────────
   Stack-100 #29: connect + DNS-verify a custom domain for THIS
   shop, in the stand's settings, on the storefront domain rails
   the website's My Shop page and the storefront builder ride —
   POST /api/storefronts/:id/domain, POST
   /api/storefronts/domain/verify, DELETE
   /api/storefronts/:id/domain. (The DomainsDesk further down is
   a different rail — the creator PAGE's domains.) Free: none of
   the three rails carries a credit cost, so there is no spend to
   confirm; the server's Pro gate on attach answers for itself and
   its refusal shows as-is. The state shown is always the shop's
   own record (the parent's mine row): "verified" appears only
   when the record says the server's TXT check passed — a verify
   tap that comes back "not yet" shows the rail's own reason and
   changes nothing. The token rides only the attach answer, so a
   returning session sees it masked with the page's remedy —
   reconnect for a fresh one. Detach is two-step, the World's
   delete discipline. */
function ShopDomainSection({
  shop,
  mineShop,
  isLight,
  onShopSaved,
}: {
  shop: PublicShopDto;
  mineShop: MineShopDto;
  isLight: boolean;
  onShopSaved: (pub: PublicShopDto, mine: MineShopDto) => void;
}) {
  const { t } = useTranslation();
  const authHeaders = useAuthHeaders();
  const status = shopDomainStatus(mineShop);
  const domain = mineShop.custom_domain ?? null;

  const [input, setInput] = useState(domain ?? "");
  /* The attach answer (token + the rail's DNS words) — session-only,
     like the page's: it is never re-read from any rail. */
  const [attachInfo, setAttachInfo] = useState<ShopDomainAttachResult | null>(null);
  const [busy, setBusy] = useState<"attach" | "verify" | "detach" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* The verify rail's "not yet" reason, verbatim — pending news,
     not an error and never a silent pass. */
  const [pendingReason, setPendingReason] = useState<string | null>(null);
  const [confirmingDetach, setConfirmingDetach] = useState(false);
  const [copied, setCopied] = useState(false);

  const attach = async (value: string) => {
    if (busy) return;
    const body = buildShopDomainAttachBody(value);
    if (!body) { setError(t("worldJoinSweep.domainNeedDomain")); return; }
    setBusy("attach");
    setError(null);
    setPendingReason(null);
    try {
      const res = await fetch(`/api/storefronts/${shop.id}/domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldJoinSweep.domainConnectFailed")));
      const parsed = parseShopDomainAttachResult(data);
      if (!parsed) throw new Error(t("worldJoinSweep.domainNoDnsInstructions"));
      setAttachInfo(parsed);
      setInput(parsed.domain);
      setConfirmingDetach(false);
      onShopSaved(shop, { ...mineShop, custom_domain: parsed.domain, domain_verified: false });
    } catch (e) {
      setError(plainErrorText(e, t("worldJoinSweep.domainConnectFailed")));
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    if (busy) return;
    setBusy("verify");
    setError(null);
    setPendingReason(null);
    try {
      const res = await fetch("/api/storefronts/domain/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ shopId: shop.id }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldJoinSweep.domainVerifyDidntRun")));
      const result = parseShopDomainVerifyResult(data);
      if (!result) throw new Error(t("worldJoinSweep.domainVerifyUnreadable"));
      if (result.verified) {
        setAttachInfo(null);
        onShopSaved(shop, { ...mineShop, custom_domain: result.domain ?? domain, domain_verified: true });
      } else {
        setPendingReason(result.reason ?? t("worldJoinSweep.domainNotVerifiedYet"));
      }
    } catch (e) {
      setError(plainErrorText(e, t("worldJoinSweep.domainVerifyDidntRun")));
    } finally {
      setBusy(null);
    }
  };

  const detach = async () => {
    if (busy) return;
    setBusy("detach");
    setError(null);
    setPendingReason(null);
    try {
      const res = await fetch(`/api/storefronts/${shop.id}/domain`, {
        method: "DELETE",
        headers: { ...(await authHeaders()) },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(apiErrorMessage(data, t("worldJoinSweep.domainDisconnectFailed")));
      }
      setAttachInfo(null);
      setInput("");
      setConfirmingDetach(false);
      onShopSaved(shop, { ...mineShop, custom_domain: null, domain_verified: false });
    } catch (e) {
      setError(plainErrorText(e, t("worldJoinSweep.domainDisconnectFailed")));
    } finally {
      setBusy(null);
    }
  };

  const copyToken = () => {
    if (!attachInfo) return;
    navigator.clipboard?.writeText(attachInfo.verification.value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const detachRow = (
    <div className="flex flex-wrap items-center gap-1.5">
      {confirmingDetach ? (
        <>
          <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
            {t("worldJoinSweep.domainDisconnectPrompt", { domain })}
          </span>
          <button
            type="button"
            data-testid="world-shop-domain-detach-confirm"
            onClick={() => void detach()}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-full border border-red-400/50 bg-red-400/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
          >
            {busy === "detach" ? <Loader2 className="h-3 w-3 animate-spin" /> : null} {t("worldJoinSweep.domainDisconnectIt")}
          </button>
          <button type="button" onClick={() => setConfirmingDetach(false)} className={chipBtn(isLight)}>{t("worldJoinSweep.domainKeepIt")}</button>
        </>
      ) : (
        <button
          type="button"
          data-testid="world-shop-domain-detach"
          onClick={() => { setConfirmingDetach(true); setError(null); }}
          className={chipBtn(isLight)}
        >
          {t("worldJoinSweep.domainDisconnect")}
        </button>
      )}
    </div>
  );

  return (
    <div className={`space-y-2 border-t pt-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`} data-testid="world-shop-domain">
      <div className="flex items-center gap-2">
        <Globe className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#d4af37]"}`} />
        <p className={`text-[11px] font-black uppercase tracking-wider ${isLight ? "text-[#7A5A12]" : "text-[#d4af37]"}`}>
          {t("worldJoinSweep.domainTitle")}
        </p>
        {status === "verified" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
            <BadgeCheck className="h-3.5 w-3.5" /> {t("worldJoinSweep.domainVerifiedBadge")}
          </span>
        )}
      </div>

      {error && <p className="text-xs font-semibold text-red-400">{error}</p>}

      {status === "none" && (
        <>
          <p className={`text-[11px] ${muted(isLight)}`}>
            {t("worldJoinSweep.domainIntro")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="shop.yourname.com"
              aria-label={t("worldJoinSweep.domainInputLabel")}
              className={`${inputCls(isLight)} min-w-0 flex-1`}
              data-testid="world-shop-domain-input"
            />
            <button
              type="button"
              data-testid="world-shop-domain-connect"
              onClick={() => void attach(input)}
              disabled={busy !== null || !input.trim()}
              className={goldBtn(busy !== null || !input.trim())}
            >
              {busy === "attach" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />} {t("worldJoinSweep.domainConnect")}
            </button>
          </div>
        </>
      )}

      {status === "pending" && domain && (
        <div className="space-y-2">
          <p className={`text-xs ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            <span className="font-mono font-bold">{domain}</span>{" "}
            <span className={muted(isLight)}>{t("worldJoinSweep.domainConnectedSuffix")}</span>
          </p>
          <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
            <p className={`text-[11px] font-black uppercase tracking-wider ${isLight ? "text-[#7A5A12]" : "text-[#d4af37]"}`}>
              {t("worldJoinSweep.domainTxtRecordLabel")}
            </p>
            {attachInfo?.dns.step1 && <p className={`mt-1 text-[11px] ${muted(isLight)}`}>{attachInfo.dns.step1}</p>}
            <p className="mt-1 font-mono text-xs break-all">
              <span className={muted(isLight)}>{t("worldJoinSweep.domainHostLabel")}</span>{" "}
              <span className={isLight ? "text-[#92600a]" : "text-amber-300"} data-testid="world-shop-domain-txt-host">
                {attachInfo ? attachInfo.verification.host : shopDomainVerifyHost(domain)}
              </span>
            </p>
            <div className="mt-1 flex items-start justify-between gap-2">
              <p className="font-mono text-xs break-all">
                <span className={muted(isLight)}>{t("worldJoinSweep.domainValueLabel")}</span>{" "}
                <span className={isLight ? "text-[#92600a]" : "text-amber-300"} data-testid="world-shop-domain-txt-value">
                  {attachInfo ? attachInfo.verification.value : "••••••••"}
                </span>
              </p>
              {attachInfo && (
                <button type="button" onClick={copyToken} className="shrink-0 text-white/50 hover:text-white" title={t("worldJoinSweep.domainCopyTokenTitle")} data-testid="world-shop-domain-copy">
                  {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                </button>
              )}
            </div>
            {!attachInfo && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <p className={`text-[11px] ${muted(isLight)}`}>{t("worldJoinSweep.domainTokenIssuedNote")}</p>
                <button
                  type="button"
                  data-testid="world-shop-domain-reconnect"
                  onClick={() => void attach(domain)}
                  disabled={busy !== null}
                  className={chipBtn(isLight)}
                >
                  {busy === "attach" ? <Loader2 className="h-3 w-3 animate-spin" /> : null} {t("worldJoinSweep.domainReconnect")}
                </button>
              </div>
            )}
          </div>
          <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
            <p className={`text-[11px] font-black uppercase tracking-wider ${isLight ? "text-[#7A5A12]" : "text-[#d4af37]"}`}>
              {t("worldJoinSweep.domainCnameRecordLabel")}
            </p>
            {attachInfo?.dns.step2 ? (
              <p className={`mt-1 text-[11px] ${muted(isLight)}`}>{attachInfo.dns.step2}</p>
            ) : (
              <p className="mt-1 font-mono text-xs break-all">
                <span className={muted(isLight)}>{t("worldJoinSweep.domainHostLabel")}</span> @ <span className={muted(isLight)}>→</span>{" "}
                <span className={isLight ? "text-[#92600a]" : "text-amber-300"}>{SHOP_DOMAIN_CNAME_TARGET}</span>
              </p>
            )}
          </div>
          {attachInfo?.dns.step3 && <p className={`text-[11px] ${muted(isLight)}`}>{attachInfo.dns.step3}</p>}
          {pendingReason && (
            <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-shop-domain-pending-reason">
              {pendingReason}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="world-shop-domain-verify"
              onClick={() => void verify()}
              disabled={busy !== null}
              className={goldBtn(busy !== null)}
            >
              {busy === "verify" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} {t("worldJoinSweep.domainVerifyButton")}
            </button>
            {detachRow}
          </div>
        </div>
      )}

      {status === "verified" && domain && (
        <div className="space-y-2">
          <p className="font-mono text-sm font-bold text-emerald-300" data-testid="world-shop-domain-verified-domain">{domain}</p>
          <p className={`text-[11px] ${muted(isLight)}`}>
            {t("worldJoinSweep.domainVerifiedNote")}
          </p>
          {detachRow}
        </div>
      )}
    </div>
  );
}

function StandManager({
  shop,
  mineShop,
  products,
  setProducts,
  isLight,
  onShopSaved,
  onShopDeleted,
}: {
  shop: PublicShopDto;
  mineShop: MineShopDto;
  products: PublicProductDto[];
  setProducts: Dispatch<SetStateAction<PublicProductDto[]>>;
  isLight: boolean;
  onShopSaved: (pub: PublicShopDto, mine: MineShopDto) => void;
  onShopDeleted: () => void;
}) {
  const { t, i18n } = useTranslation();
  const formStrings = {
    productNameFirst: t("worldCommerceStands.shopProbProductName"),
    priceValid: t("worldCommerceStands.shopProbPriceValid"),
    shopNameFirst: t("worldCommerceStands.shopProbShopName"),
    nameMax: t("worldCommerceStands.shopProbNameMax"),
    taglineMax: t("worldCommerceStands.shopProbTaglineMax"),
    descMax: t("worldCommerceStands.shopProbDescMax"),
    handleProblem: t("worldCommerceStands.shopProbHandle"),
  };
  const earningsLabels = {
    store: t("worldCommerceStands.shopEarningsStore"),
    storeNoun: t("worldCommerceStands.shopEarningsStoreNoun"),
    storeNounOne: t("worldCommerceStands.shopEarningsStoreNounOne"),
    memberships: t("worldCommerceStands.shopEarningsMemberships"),
    membershipsNoun: t("worldCommerceStands.shopEarningsMembershipsNoun"),
    membershipsNounOne: t("worldCommerceStands.shopEarningsMembershipsNounOne"),
    deals: t("worldCommerceStands.shopEarningsDeals"),
    dealsNoun: t("worldCommerceStands.shopEarningsDealsNoun"),
    dealsNounOne: t("worldCommerceStands.shopEarningsDealsNounOne"),
  };
  const authHeaders = useAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();

  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PublicProductDto | null>(null);
  const [form, setForm] = useState<ProductFormState>(emptyProductForm());
  const [saving, setSaving] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [manageNote, setManageNote] = useState<string | null>(null);
  /* Two-step delete (the World's own discipline — the vault
     characters' remove works the same way): the first tap arms the
     row, the second fires the DELETE. Never one-click. */
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [aiDescBusy, setAiDescBusy] = useState(false);
  const [aiImageBusy, setAiImageBusy] = useState<"standard" | "premium" | null>(null);

  /* The desk's three benches (wave-2 #6): products (the #7 desk),
     shop settings, and the sales ledger. */
  const [section, setSection] = useState<"products" | "settings" | "sales">("products");

  /* Settings state — prefilled from the owner's own mine record;
     the form changes nothing until the PATCH confirms. */
  const [settingsForm, setSettingsForm] = useState<ShopSettingsFormState>(() => shopSettingsFormFromShop(mineShop));
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
  const [shopNiche, setShopNiche] = useState("");
  const [aiShopDescBusy, setAiShopDescBusy] = useState(false);
  /* Org wave #4: the Look starters shelf (the My Shop page's design
     starters, in the stand) — which starter is mid-apply, if any. */
  const [applyingStarterId, setApplyingStarterId] = useState<string | null>(null);
  /* Delete-the-shop arms exactly like a product delete: first tap
     asks, second tap fires — and the stand only closes on the
     server's confirmation. */
  const [confirmingDeleteShop, setConfirmingDeleteShop] = useState(false);
  const [deletingShop, setDeletingShop] = useState(false);

  /* Sales state: undefined = not asked yet, null = asked and the
     ledger wouldn't open (an honest failure, never fake zeros). */
  const [analytics, setAnalytics] = useState<ShopAnalytics | null | undefined>(undefined);
  const [analyticsBusy, setAnalyticsBusy] = useState(false);

  /* The seller's whole picture (Parity P3): undefined = not asked
     yet, null = asked and the picture wouldn't open (an honest
     failure line with a retry, never fake zeros). */
  const [earnings, setEarnings] = useState<SellerEarnings | null | undefined>(undefined);
  const [earningsBusy, setEarningsBusy] = useState(false);

  const set = (patch: Partial<ProductFormState>) => setForm((f) => ({ ...f, ...patch }));

  const openNew = () => {
    setEditingProduct(null);
    setForm(emptyProductForm());
    setManageError(null);
    setManageNote(null);
    setConfirmingDeleteId(null);
    setFormOpen(true);
  };
  const openEdit = (p: PublicProductDto) => {
    setEditingProduct(p);
    setForm(productFormFromDto(p));
    setManageError(null);
    setManageNote(null);
    setConfirmingDeleteId(null);
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    setEditingProduct(null);
    setManageError(null);
  };

  /* Save — the page's flow exactly: its two gates first, then POST
     (create) or PATCH (edit) with its body; the shelf takes the
     SERVER's returned row, never the form's guess. Any failure
     keeps the form open and the shelf untouched. */
  const saveProduct = async () => {
    if (saving) return;
    const problem = productFormProblem(form, formStrings);
    if (problem) { setManageError(problem); return; }
    const payload = buildProductPayload(form);
    if (!payload) { setManageError(t("worldCommerceStands.shopProductSaveBad")); return; }
    setSaving(true);
    setManageError(null);
    setManageNote(null);
    try {
      const res = await fetch(
        editingProduct ? `/api/shops/${shop.id}/products/${editingProduct.id}` : `/api/shops/${shop.id}/products`,
        {
          method: editingProduct ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.shopProductSaveFailed"));
      const saved = savedProductDto(data);
      if (!saved) throw new Error(t("worldCommerceStands.shopProductSaveEmpty"));
      setProducts((ps) => applyProductSave(ps, saved, editingProduct ? editingProduct.id : null));
      setManageNote(editingProduct ? t("worldCommerceStands.shopProductUpdatedNote", { name: saved.name }) : t("worldCommerceStands.shopProductAddedNote", { name: saved.name }));
      setFormOpen(false);
      setEditingProduct(null);
    } catch (e) {
      setManageError(plainErrorText(e, t("worldCommerceStands.shopProductSaveFailed")));
    } finally {
      setSaving(false);
    }
  };

  /* Delete — fires ONLY from the armed (second) step. The row
     leaves the shelf only after the server confirms; a failure
     reports and the row stays. */
  const deleteProduct = async (p: PublicProductDto) => {
    if (deletingId) return;
    setDeletingId(p.id);
    setManageError(null);
    setManageNote(null);
    try {
      const res = await fetch(`/api/shops/${shop.id}/products/${p.id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.shopProductDeleteFailed"));
      setProducts((ps) => removeProduct(ps, p.id));
      if (editingProduct?.id === p.id) closeForm();
      setConfirmingDeleteId(null);
      setManageNote(t("worldCommerceStands.shopProductDeletedNote", { name: p.name }));
    } catch (e) {
      setManageError(plainErrorText(e, t("worldCommerceStands.shopProductDeleteFailed")));
    } finally {
      setDeletingId(null);
    }
  };

  /* AI description — the page's exact body, through the World's
     confirmed-spend seam (the registry prices this endpoint at
     100 VB, confirmed before the run). A declined confirm is a
     quiet no-op; an out-of-credits answer names the wallet, not
     the stand; the text lands in the form only, unsaved — saving
     the product is still the owner's own tap. */
  const runAiDescription = async () => {
    if (aiDescBusy) return;
    if (!form.name.trim()) { setManageError(t("worldCommerceStands.shopAiNameFirstDesc")); return; }
    setAiDescBusy(true);
    setManageError(null);
    try {
      const res = await confirmedFetch("/api/shops/ai/product-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildProductDescriptionPayload(form)),
      });
      if (!res) return; /* the owner declined the spend confirm — nothing charged, nothing changed */
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (aiOutOfCredits(res.status, data)) {
        setManageError(t("worldCommerceStands.shopAiOutWriter"));
        return;
      }
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.shopAiWriterFailed"));
      const description = parseAiDescription(data);
      if (!description) throw new Error(t("worldCommerceStands.shopAiWriterEmpty"));
      set({ description });
      setManageNote(t("worldCommerceStands.shopAiDescWrittenNote"));
    } catch (e) {
      setManageError(plainErrorText(e, t("worldCommerceStands.shopAiWriterFailed")));
    } finally {
      setAiDescBusy(false);
    }
  };

  /* AI product image — same seam; premium carries its own price
     (200 VB, the server constant) as the confirm's override. The
     URL lands in the form's image field only — nothing reaches
     the shelf until the product saves. */
  const runAiImage = async (tier: "standard" | "premium") => {
    if (aiImageBusy) return;
    if (!form.name.trim()) { setManageError(t("worldCommerceStands.shopAiNameFirstImage")); return; }
    setAiImageBusy(tier);
    setManageError(null);
    try {
      const res = await confirmedFetch("/api/shops/ai/product-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildProductImagePayload(form, tier)),
        ...(tier === "premium"
          ? { overrideCost: SHOP_AI_IMAGE_PREMIUM_COST_VB, overrideFeature: "Product Image — Premium" }
          : {}),
      });
      if (!res) return; /* declined — nothing charged, nothing changed */
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (aiOutOfCredits(res.status, data)) {
        setManageError(t("worldCommerceStands.shopAiOutImage"));
        return;
      }
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.shopAiImageFailed"));
      const url = parseAiImageUrl(data);
      if (!url) throw new Error(t("worldCommerceStands.shopAiImageEmpty"));
      set({ imageUrl: url });
      setManageNote(t("worldCommerceStands.shopAiImageMadeNote"));
    } catch (e) {
      setManageError(plainErrorText(e, t("worldCommerceStands.shopAiImageFailed")));
    } finally {
      setAiImageBusy(null);
    }
  };

  const setSettings = (patch: Partial<ShopSettingsFormState>) => setSettingsForm((f) => ({ ...f, ...patch }));

  /* Settings save — PATCH /api/shops/:id with the page's exact
     body. The stand's header and the owner's record take the
     SERVER's returned row (through the parent), never the form's
     guess; a failure keeps the form and changes nothing. */
  const saveSettings = async () => {
    if (settingsSaving) return;
    const problem = shopSettingsProblem(settingsForm, formStrings);
    if (problem) { setSettingsError(problem); return; }
    const payload = buildShopSettingsPayload(settingsForm);
    if (!payload) { setSettingsError(t("worldCommerceStands.shopSettingsSaveBad")); return; }
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsNote(null);
    try {
      const res = await fetch(`/api/shops/${shop.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.shopSettingsSaveFailed"));
      const saved = savedShopDto(data);
      if (!saved) throw new Error(t("worldCommerceStands.shopSettingsSaveEmpty"));
      onShopSaved(saved.pub, { ...saved.mine, product_count: mineShop.product_count });
      setSettingsForm(shopSettingsFormFromShop(saved.mine));
      setSettingsNote(t("worldCommerceStands.shopSettingsSavedNote"));
    } catch (e) {
      setSettingsError(plainErrorText(e, t("worldCommerceStands.shopSettingsSaveFailed")));
    } finally {
      setSettingsSaving(false);
    }
  };

  /* Look starters — the My Shop page's design starters (the ONE
     registry, lib/shop-starters), applied through the SAME settings
     rail: PATCH /api/shops/:id with shopStarterPatch(starter) ONLY —
     the two persisted design fields, nothing else, so a look can
     never clobber the shop's name, tagline or story. Free, like shop
     setup on the page. The stand adopts the SERVER's returned row;
     a failure changes nothing and says so — the colors the shelf
     shows are always the shop's true colors. */
  const designColors = shopDesignColors(mineShop);
  const applyStarter = async (starter: ShopDesignStarter) => {
    if (applyingStarterId) return;
    setApplyingStarterId(starter.id);
    setSettingsError(null);
    setSettingsNote(null);
    try {
      const res = await fetch(`/api/shops/${shop.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(shopStarterPatch(starter)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.shopLookSaveFailed"));
      const saved = savedShopDto(data);
      if (!saved) throw new Error(t("worldCommerceStands.shopSettingsSaveEmpty"));
      onShopSaved(saved.pub, { ...saved.mine, product_count: mineShop.product_count });
      setSettingsNote(t("worldCommerceStands.shopLookLiveNote", { name: starter.name }));
    } catch (e) {
      setSettingsError(plainErrorText(e, t("worldCommerceStands.shopLookSaveFailed")));
    } finally {
      setApplyingStarterId(null);
    }
  };

  /* AI shop description — the page's exact body, through the same
     confirmed-spend seam as the product helpers (100 VB, shown
     before the run). The text lands in the form only, unsaved —
     saving the settings is still the owner's own tap. */
  const runAiShopDescription = async () => {
    if (aiShopDescBusy) return;
    if (!(settingsForm.name.trim() || shop.name)) { setSettingsError(t("worldCommerceStands.shopAiNameFirstShop")); return; }
    setAiShopDescBusy(true);
    setSettingsError(null);
    try {
      const res = await confirmedFetch("/api/shops/ai/shop-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildShopDescriptionPayload({
          shopName: settingsForm.name.trim() || shop.name,
          tagline: settingsForm.tagline,
          niche: shopNiche,
          productNames: products.map((p) => p.name),
        })),
      });
      if (!res) return; /* the owner declined the spend confirm — nothing charged, nothing changed */
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (aiOutOfCredits(res.status, data)) {
        setSettingsError(t("worldCommerceStands.shopAiOutWriter"));
        return;
      }
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.shopAiWriterFailed"));
      const description = parseAiDescription(data);
      if (!description) throw new Error(t("worldCommerceStands.shopAiWriterEmpty"));
      setSettings({ description });
      setSettingsNote(t("worldCommerceStands.shopSettingsAiWrittenNote"));
    } catch (e) {
      setSettingsError(plainErrorText(e, t("worldCommerceStands.shopAiWriterFailed")));
    } finally {
      setAiShopDescBusy(false);
    }
  };

  /* Delete the shop — fires ONLY from the armed (second) step.
     On the server's confirmation the parent closes the stand and
     the square refreshes; a failure reports and the shop stands. */
  const deleteShop = async () => {
    if (deletingShop) return;
    setDeletingShop(true);
    setSettingsError(null);
    setSettingsNote(null);
    try {
      const res = await fetch(`/api/shops/${shop.id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.shopDeleteFailed"));
      onShopDeleted();
    } catch (e) {
      setSettingsError(plainErrorText(e, t("worldCommerceStands.shopDeleteFailed")));
      setDeletingShop(false);
    }
  };

  /* The sales ledger — read lazily when the bench first opens,
     from the owner-scoped analytics rail the My Shop page reads.
     A failed read is a failure state with a retry, never zeros. */
  const loadAnalytics = async () => {
    if (analyticsBusy) return;
    setAnalyticsBusy(true);
    try {
      const res = await fetch(`/api/storefronts/${shop.id}/analytics`, { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as unknown;
      if (!res.ok) throw new Error("analytics");
      const parsed = parseShopAnalytics(data);
      if (!parsed) throw new Error("analytics");
      setAnalytics(parsed);
    } catch {
      setAnalytics(null);
    } finally {
      setAnalyticsBusy(false);
    }
  };
  useEffect(() => {
    if (section === "sales" && analytics === undefined) void loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  /* The seller's whole picture — GET /api/earnings, read when the
     desk opens. Display-only: the numbers are the endpoint's own
     (store sales + memberships + brand deals in cents, stream tips
     in Visual Bucs kept apart by the rail's contract). A failed
     read is a failure line with a retry, never zeros. At Join #2
     the endpoint's aggregation upgrades onto payfix's shared
     lib/seller-earnings.ts — this read doesn't change. */
  const loadEarnings = async () => {
    if (earningsBusy) return;
    setEarningsBusy(true);
    try {
      const res = await fetch("/api/earnings", { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as unknown;
      if (!res.ok) throw new Error("earnings");
      const parsed = parseSellerEarnings(data);
      if (!parsed) throw new Error("earnings");
      setEarnings(parsed);
    } catch {
      setEarnings(null);
    } finally {
      setEarningsBusy(false);
    }
  };
  useEffect(() => {
    void loadEarnings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <NativeCard isLight={isLight} title={t("worldCommerceStands.shopManageTitle")}>
      <div className="space-y-2">
        <p className={`text-xs ${muted(isLight)}`}>
          {t("worldCommerceStands.shopManageIntro")}
        </p>

        {/* The seller's whole picture (Parity P3) — every rail they
            sell on, read off GET /api/earnings: this stand's sales
            are one line of it. Display-only; the numbers are the
            endpoint's own, and tips stay in Visual Bucs, apart. */}
        <div
          data-testid="world-shop-earnings"
          className={`space-y-1.5 rounded-xl border px-3 py-2.5 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
        >
          {earnings === undefined || earningsBusy ? (
            <p className={`flex items-center gap-2 text-xs ${muted(isLight)}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("worldCommerceStands.shopEarningsLoading")}
            </p>
          ) : earnings === null ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold text-red-400">
                {t("worldCommerceStands.shopEarningsFailed")}
              </p>
              <button
                type="button"
                data-testid="world-shop-earnings-retry"
                onClick={() => { setEarnings(undefined); void loadEarnings(); }}
                className={chipBtn(isLight)}
              >
                <RefreshCw className="h-3 w-3" /> {t("worldCommerceStands.shopTryAgain")}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Wallet className="h-4 w-4 shrink-0 text-[#d4af37]" />
                <span className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  {t("worldCommerceStands.shopEarnedLine", { total: centsToDisplay(earnings.totalCents) })}
                </span>
                {earnings.partial && (
                  <span className={`text-[11px] font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                    {t("worldCommerceStands.shopEarningsPartial")}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sellerEarningsRows(earnings, earningsLabels).map((row) => (
                  <span
                    key={row.key}
                    data-testid="world-shop-earnings-source"
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/10 text-white/70"}`}
                  >
                    {row.label}
                    {row.source.status === "error" || row.source.totalCents === null || row.source.count === null ? (
                      <span className={isLight ? "text-[#92600a]" : "text-amber-300"}>{t("worldCommerceStands.shopEarningsUnreadable")}</span>
                    ) : (
                      <span className={isLight ? "text-[#2a1e07]" : "text-white"}>
                        {centsToDisplay(row.source.totalCents)} · {row.source.count}{" "}
                        {row.source.count === 1 ? row.nounOne : row.noun}
                      </span>
                    )}
                  </span>
                ))}
              </div>
              {earnings.streamTipsVb !== null && (earnings.streamTipsVb > 0 || (earnings.streamTipCount ?? 0) > 0) && (
                <p className={`text-[11px] ${muted(isLight)}`}>
                  {t("worldCommerceStands.shopStreamTipsLabel")} <span className="font-bold text-[#d4af37]">{t("worldCommerceStands.shopTipsVbSuffix", { vb: earnings.streamTipsVb.toLocaleString(i18n.language) })}</span>
                  {earnings.streamTipCount !== null && earnings.streamTipCount > 0
                    ? t(earnings.streamTipCount === 1 ? "worldCommerceStands.shopTipsFromOne" : "worldCommerceStands.shopTipsFromMany", { count: earnings.streamTipCount })
                    : ""}{t("worldCommerceStands.shopTipsKeptApart")}
                </p>
              )}
              {earnings.stageTipsVb !== null && (earnings.stageTipsVb > 0 || (earnings.stageTipCount ?? 0) > 0) && (
                <p className={`text-[11px] ${muted(isLight)}`}>
                  {t("worldCommerceStands.shopStageTipsLabel")} <span className="font-bold text-[#d4af37]">{t("worldCommerceStands.shopTipsVbSuffix", { vb: earnings.stageTipsVb.toLocaleString(i18n.language) })}</span>
                  {earnings.stageTipCount !== null && earnings.stageTipCount > 0
                    ? t(earnings.stageTipCount === 1 ? "worldCommerceStands.shopTipsFromOne" : "worldCommerceStands.shopTipsFromMany", { count: earnings.stageTipCount })
                    : ""}{t("worldCommerceStands.shopTipsKeptApart")}
                </p>
              )}
              {earnings.tipJarPendingCount !== null && earnings.tipJarPendingCount > 0 && (
                <p className={`text-[11px] ${muted(isLight)}`}>
                  {t(earnings.tipJarPendingCount === 1 ? "worldCommerceStands.shopTipJarPendingOne" : "worldCommerceStands.shopTipJarPendingMany", { count: earnings.tipJarPendingCount, worthPart: earnings.tipJarPendingCents !== null ? t("worldCommerceStands.shopTipJarWorth", { amount: centsToDisplay(earnings.tipJarPendingCents) }) : "" })}
                </p>
              )}
              <p className={`text-[11px] ${muted(isLight)}`}>
                {t("worldCommerceStands.shopEarningsFooter")}
              </p>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("worldCommerceStands.shopBenchesAria")}>
          <button type="button" role="tab" aria-selected={section === "products"} data-testid="world-shop-manage-tab-products" onClick={() => setSection("products")} className={standTabBtn(isLight, section === "products")}>
            <ShoppingBag className="h-3 w-3" /> {t("worldCommerceStands.shopTabProducts")}
          </button>
          <button type="button" role="tab" aria-selected={section === "settings"} data-testid="world-shop-manage-tab-settings" onClick={() => setSection("settings")} className={standTabBtn(isLight, section === "settings")}>
            <Settings2 className="h-3 w-3" /> {t("worldCommerceStands.shopTabSettings")}
          </button>
          <button type="button" role="tab" aria-selected={section === "sales"} data-testid="world-shop-manage-tab-sales" onClick={() => setSection("sales")} className={standTabBtn(isLight, section === "sales")}>
            <BarChart3 className="h-3 w-3" /> {t("worldCommerceStands.shopTabSales")}
          </button>
        </div>

        {section === "products" && (
        <div className="space-y-2" data-testid="world-shop-manage">
        {manageError && <p className="text-xs font-semibold text-red-400">{manageError}</p>}
        {manageNote && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{manageNote}</p>}

        <div className="space-y-1.5">
          {products.map((p) => (
            <div
              key={p.id}
              data-testid="world-shop-manage-row"
              className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
            >
              <span className={`min-w-0 flex-1 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{p.name}</span>
              <span className="text-sm font-black text-[#d4af37]">{centsToDisplay(p.price_cents)}</span>
              {confirmingDeleteId === p.id ? (
                <>
                  <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{t("worldCommerceStands.shopDeleteArmQ")}</span>
                  <button
                    type="button"
                    data-testid="world-shop-manage-delete-confirm"
                    onClick={() => void deleteProduct(p)}
                    disabled={deletingId === p.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-red-400/50 bg-red-400/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
                  >
                    {deletingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} {t("worldCommerceStands.shopRemoveIt")}
                  </button>
                  <button type="button" onClick={() => setConfirmingDeleteId(null)} className={chipBtn(isLight)}>{t("worldCommerceStands.shopKeepIt")}</button>
                </>
              ) : (
                <>
                  <button type="button" data-testid="world-shop-manage-edit" onClick={() => openEdit(p)} className={chipBtn(isLight)}>
                    <Pencil className="h-3 w-3" /> {t("worldCommerceStands.shopEdit")}
                  </button>
                  <button
                    type="button"
                    data-testid="world-shop-manage-delete"
                    onClick={() => { setConfirmingDeleteId(p.id); setManageError(null); }}
                    className={chipBtn(isLight)}
                  >
                    <Trash2 className="h-3 w-3" /> {t("worldCommerceStands.shopRemove")}
                  </button>
                </>
              )}
            </div>
          ))}
          {products.length === 0 && (
            <p className={`text-xs ${muted(isLight)}`}>{t("worldCommerceStands.shopStandBare")}</p>
          )}
        </div>

        {!formOpen ? (
          <button type="button" data-testid="world-shop-manage-add" onClick={openNew} className={goldBtn()}>
            <Plus className="h-4 w-4" /> {t("worldCommerceStands.shopAddProduct")}
          </button>
        ) : (
          <div className="space-y-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-shop-manage-form">
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {editingProduct ? t("worldCommerceStands.shopEditingProduct", { name: editingProduct.name }) : t("worldCommerceStands.shopNewProduct")}
            </p>
            <input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder={t("worldCommerceStands.shopProductNameLabel")}
              aria-label={t("worldCommerceStands.shopProductNameLabel")}
              maxLength={120}
              className={inputCls(isLight)}
            />
            <input
              value={form.price}
              onChange={(e) => set({ price: e.target.value })}
              placeholder={t("worldCommerceStands.shopPricePlaceholder")}
              aria-label={t("worldCommerceStands.shopPriceAria")}
              inputMode="decimal"
              className={inputCls(isLight)}
            />
            <textarea
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder={t("worldCommerceStands.shopProductDescPlaceholder")}
              aria-label={t("worldCommerceStands.shopProductDescAria")}
              maxLength={2000}
              rows={3}
              className={inputCls(isLight)}
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-testid="world-shop-manage-ai-description"
                onClick={() => void runAiDescription()}
                disabled={aiDescBusy}
                className={chipBtn(isLight)}
              >
                {aiDescBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {t("worldCommerceStands.shopAiDescButton", { cost: SHOP_AI_DESCRIPTION_COST_VB })}
              </button>
              <button
                type="button"
                data-testid="world-shop-manage-ai-image-standard"
                onClick={() => void runAiImage("standard")}
                disabled={aiImageBusy !== null}
                className={chipBtn(isLight)}
              >
                {aiImageBusy === "standard" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                {t("worldCommerceStands.shopAiImageButton", { cost: SHOP_AI_IMAGE_STANDARD_COST_VB })}
              </button>
              <button
                type="button"
                data-testid="world-shop-manage-ai-image-premium"
                onClick={() => void runAiImage("premium")}
                disabled={aiImageBusy !== null}
                className={chipBtn(isLight)}
              >
                {aiImageBusy === "premium" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                {t("worldCommerceStands.shopAiImagePremiumButton", { cost: SHOP_AI_IMAGE_PREMIUM_COST_VB })}
              </button>
            </div>
            <input
              value={form.styleHint}
              onChange={(e) => set({ styleHint: e.target.value })}
              placeholder={t("worldCommerceStands.shopStyleHintPlaceholder")}
              aria-label={t("worldCommerceStands.shopStyleHintAria")}
              maxLength={300}
              className={inputCls(isLight)}
            />
            <input
              value={form.imageUrl}
              onChange={(e) => set({ imageUrl: e.target.value })}
              placeholder={t("worldCommerceStands.shopImageLinkPlaceholder")}
              aria-label={t("worldCommerceStands.shopImageLinkAria")}
              className={inputCls(isLight)}
            />
            {form.imageUrl.trim() && (
              <img src={form.imageUrl.trim()} alt="" className="h-24 w-24 rounded-xl border border-[#d4af37]/40 object-cover" />
            )}
            <p className={`text-[11px] ${muted(isLight)}`}>
              {t("worldCommerceStands.shopHelpersNote")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" data-testid="world-shop-manage-save" onClick={() => void saveProduct()} disabled={saving} className={goldBtn(saving)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {editingProduct ? t("worldCommerceStands.shopSaveChanges") : t("worldCommerceStands.shopPutOnStand")}
              </button>
              <button type="button" onClick={closeForm} className={chipBtn(isLight)}>
                <X className="h-3 w-3" /> {t("worldCommerceStands.shopCancel")}
              </button>
            </div>
          </div>
        )}
        </div>
        )}

        {section === "settings" && (
        <div className="space-y-2" data-testid="world-shop-settings">
          <p className={`text-xs ${muted(isLight)}`}>
            {t("worldCommerceStands.shopSettingsIntroBefore")}<span className="font-mono">{shop.handle}</span>{t("worldCommerceStands.shopSettingsIntroAfter")}
          </p>
          {settingsError && <p className="text-xs font-semibold text-red-400">{settingsError}</p>}
          {settingsNote && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{settingsNote}</p>}
          <input
            value={settingsForm.name}
            onChange={(e) => setSettings({ name: e.target.value })}
            placeholder={t("worldCommerceStands.shopNameLabel")}
            aria-label={t("worldCommerceStands.shopNameLabel")}
            maxLength={SHOP_NAME_MAX}
            className={inputCls(isLight)}
          />
          <input
            value={settingsForm.tagline}
            onChange={(e) => setSettings({ tagline: e.target.value })}
            placeholder={t("worldCommerceStands.shopTaglineFieldPlaceholder")}
            aria-label={t("worldCommerceStands.shopTaglineAria")}
            maxLength={SHOP_TAGLINE_MAX}
            className={inputCls(isLight)}
          />
          <textarea
            value={settingsForm.description}
            onChange={(e) => setSettings({ description: e.target.value })}
            placeholder={t("worldCommerceStands.shopStoryPlaceholder")}
            aria-label={t("worldCommerceStands.shopStoryAria")}
            maxLength={SHOP_DESCRIPTION_MAX}
            rows={4}
            className={inputCls(isLight)}
          />
          <input
            value={shopNiche}
            onChange={(e) => setShopNiche(e.target.value)}
            placeholder={t("worldCommerceStands.shopNichePlaceholder")}
            aria-label={t("worldCommerceStands.shopNicheAria")}
            maxLength={120}
            className={inputCls(isLight)}
          />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" data-testid="world-shop-settings-save" onClick={() => void saveSettings()} disabled={settingsSaving} className={goldBtn(settingsSaving)}>
              {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t("worldCommerceStands.shopSaveSettings")}
            </button>
            <button
              type="button"
              data-testid="world-shop-settings-ai-description"
              onClick={() => void runAiShopDescription()}
              disabled={aiShopDescBusy}
              className={chipBtn(isLight)}
            >
              {aiShopDescBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {t("worldCommerceStands.shopAiStoryButton", { cost: SHOP_AI_SHOP_DESCRIPTION_COST_VB })}
            </button>
          </div>
          <p className={`text-[11px] ${muted(isLight)}`}>
            {t("worldCommerceStands.shopWriterNote")}
          </p>
          {/* Org wave #4: the Look starters shelf — the My Shop page's
              design starters from the ONE registry (lib/shop-starters),
              with the preview mirroring the storefront's own banner:
              the gradient runs from the banner color, the eyebrow
              rides the accent. Applying writes only the two design
              colors through the settings rail (see applyStarter). */}
          <div className="space-y-2 pt-1" data-testid="world-shop-starters">
            <p className={`text-[11px] font-black uppercase tracking-wider ${isLight ? "text-[#7A5A12]" : "text-[#d4af37]"}`}>
              {t("worldCommerceStands.shopStartersTitle")}
            </p>
            <div
              data-testid="world-shop-banner-preview"
              className="rounded-xl px-3 py-2.5"
              style={{ background: `linear-gradient(135deg, ${designColors.banner_color}, #000)` }}
            >
              <span className="block text-[10px] font-black uppercase tracking-widest" style={{ color: designColors.accent_color }}>
                Bow Down Visuals Shop
              </span>
              <span className="block text-sm font-black text-white">{shop.name}</span>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {SHOP_DESIGN_STARTERS.map((starter) => {
                const applied = isStarterApplied(designColors, starter);
                return (
                  <div
                    key={starter.id}
                    data-testid={`world-shop-starter-${starter.id}`}
                    className={`rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex rounded-md border border-white/20">
                        <span className="block h-4 w-4" style={{ background: starter.settings.banner_color }} />
                        <span className="block h-4 w-4" style={{ background: starter.settings.accent_color }} />
                      </span>
                      <span className={`text-xs font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{starter.name}</span>
                    </div>
                    <p className={`mt-1 text-[11px] ${muted(isLight)}`}>{starter.blurb}</p>
                    <p className={`text-[11px] ${muted(isLight)}`}>{starter.bestFor}</p>
                    <button
                      type="button"
                      data-testid={`world-shop-starter-apply-${starter.id}`}
                      disabled={applied || applyingStarterId !== null}
                      onClick={() => void applyStarter(starter)}
                      className={chipBtn(isLight)}
                    >
                      {applied ? t("worldCommerceStands.shopStarterApplied") : applyingStarterId === starter.id ? t("worldCommerceStands.shopStarterApplying") : t("worldCommerceStands.shopStarterApply")}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className={`text-[11px] ${muted(isLight)}`}>
              {t("worldCommerceStands.shopStartersNote")}
            </p>
          </div>
          {/* Stack-100 #29: the SHOP's storefront domain — connect,
              DNS instructions and verify on the storefront domain
              rails, right here in the stand's settings. NOT the
              creator-domains desk below: that one points a domain
              at the creator page, this one points it at this shop. */}
          <ShopDomainSection shop={shop} mineShop={mineShop} isLight={isLight} onShopSaved={onShopSaved} />

          {/* Stack-100 #68: custom domains — claim, DNS instructions,
              verify and remove on the creator-domains rails,
              right here in the stand's settings. */}
          <DomainsDesk isLight={isLight} />

          <div className="space-y-2 border-t border-red-400/30 pt-3">
            <p className={`text-xs font-black uppercase tracking-[0.14em] text-red-300`}>{t("worldCommerceStands.shopCloseTitle")}</p>
            <p className={`text-xs ${muted(isLight)}`}>
              {t("worldCommerceStands.shopCloseIntro")}
            </p>
            {confirmingDeleteShop ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{t("worldCommerceStands.shopCloseArmQ", { name: shop.name })}</span>
                <button
                  type="button"
                  data-testid="world-shop-settings-delete-confirm"
                  onClick={() => void deleteShop()}
                  disabled={deletingShop}
                  className="inline-flex items-center gap-1.5 rounded-full border border-red-400/50 bg-red-400/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
                >
                  {deletingShop ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} {t("worldCommerceStands.shopCloseIt")}
                </button>
                <button type="button" onClick={() => setConfirmingDeleteShop(false)} className={chipBtn(isLight)}>{t("worldCommerceStands.shopKeepMyShop")}</button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="world-shop-settings-delete"
                onClick={() => { setConfirmingDeleteShop(true); setSettingsError(null); }}
                className={chipBtn(isLight)}
              >
                <Trash2 className="h-3 w-3" /> {t("worldCommerceStands.shopCloseButton")}
              </button>
            )}
          </div>
        </div>
        )}

        {section === "sales" && (
        <div className="space-y-2" data-testid="world-shop-sales">
          {analytics === undefined || analyticsBusy ? (
            <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.shopSalesLoading")} />
          ) : analytics === null ? (
            <NativeErrorState
              isLight={isLight}
              title={t("worldCommerceStands.shopSalesFailedTitle")}
              message={t("worldCommerceStands.shopSalesFailedMsg")}
              onRetry={() => { setAnalytics(undefined); void loadAnalytics(); }}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: t("worldCommerceStands.shopStatViews"), value: String(analytics.totals.views) },
                  { label: t("worldCommerceStands.shopStatSales"), value: String(analytics.totals.sales) },
                  { label: t("worldCommerceStands.shopStatGross"), value: centsToDisplay(analytics.totals.gross_cents) },
                  { label: t("worldCommerceStands.shopStatYouKeep"), value: centsToDisplay(analytics.totals.seller_net_cents), gold: true },
                ].map((s) => (
                  <div
                    key={s.label}
                    className={`rounded-xl border px-3 py-2.5 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
                  >
                    <div className={`text-lg font-black ${s.gold ? "text-[#d4af37]" : isLight ? "text-[#2a1e07]" : "text-white"}`}>{s.value}</div>
                    <div className={`mt-0.5 text-[10px] font-bold uppercase tracking-wider ${muted(isLight)}`}>{s.label}</div>
                  </div>
                ))}
              </div>

              {analytics.dailyViews.length > 0 && (
                <div>
                  <p className={`text-[11px] font-bold uppercase tracking-wider ${muted(isLight)}`}>{t("worldCommerceStands.shopViewsTitle")}</p>
                  <div className="mt-1.5 flex h-16 items-end gap-1">
                    {analytics.dailyViews.map((d) => (
                      <div
                        key={d.day}
                        title={t("worldCommerceStands.shopViewsTooltip", { day: d.day, views: d.views })}
                        className="flex-1 rounded-t bg-gradient-to-t from-amber-500/40 to-amber-300/80"
                        style={{ height: `${Math.max(4, (d.views / maxDailyViews(analytics)) * 100)}%` }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className={`text-[11px] font-bold uppercase tracking-wider ${muted(isLight)}`}>
                  {t("worldCommerceStands.shopRecentSales")} <span className="normal-case font-normal">{t("worldCommerceStands.shopRecentSalesFee", { fee: analytics.platformFeePct })}</span>
                </p>
                {analytics.sales.length === 0 ? (
                  <p className={`mt-1.5 text-xs ${muted(isLight)}`}>{t("worldCommerceStands.shopNoSales")}</p>
                ) : (
                  <div className="mt-1.5 space-y-1.5">
                    {recentShopSales(analytics).map((sale) => (
                      <div
                        key={sale.id}
                        data-testid="world-shop-sales-row"
                        className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{sale.product_name ?? t("worldCommerceStands.shopProductFallback")}</span>
                            {sale.payment_status === "paid" && (
                              <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300">{t("worldCommerceStands.shopPaidChip")}</span>
                            )}
                            {sale.payment_status === "no_payment_required" && (
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${isLight ? "bg-black/10 text-[#6B5B36]" : "bg-white/10 text-white/60"}`}>{t("worldCommerceStands.shopFreeOrderChip")}</span>
                            )}
                          </div>
                          <div className={`text-[11px] ${muted(isLight)}`}>
                            {new Date(sale.paid_at ?? sale.created_at).toLocaleDateString(i18n.language)}{sale.buyer_email ? ` · ${sale.buyer_email}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{centsToDisplay(sale.amount_cents)}</div>
                          <div className="text-[11px] font-semibold text-emerald-300">{t("worldCommerceStands.shopYouKeepLine", { net: centsToDisplay(sale.seller_net_cents) })}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {analytics.pendingSales.length > 0 && (
                <div>
                  <p className={`text-[11px] font-bold uppercase tracking-wider ${muted(isLight)}`}>
                    {t("worldCommerceStands.shopAwaitingTitle")} <span className="normal-case font-normal">{t("worldCommerceStands.shopAwaitingNote")}</span>
                  </p>
                  <div className="mt-1.5 space-y-1.5">
                    {recentShopPending(analytics).map((sale) => (
                      <div
                        key={sale.id}
                        data-testid="world-shop-sales-pending-row"
                        className={`flex items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-2 opacity-75 ${isLight ? "border-[#C9A84C]/40 bg-white/40" : "border-white/15 bg-white/[0.03]"}`}
                      >
                        <div className="min-w-0">
                          <div className={`truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{sale.product_name ?? t("worldCommerceStands.shopProductFallback")}</div>
                          <div className={`text-[11px] ${muted(isLight)}`}>{new Date(sale.created_at).toLocaleDateString(i18n.language)}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{centsToDisplay(sale.amount_cents)}</div>
                          <div className="text-[11px] font-semibold text-amber-300">{sale.payment_status === "expired" ? t("worldCommerceStands.shopCheckoutExpired") : t("worldCommerceStands.shopPendingChip")}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className={`text-[11px] ${muted(isLight)}`}>
                {t("worldCommerceStands.shopSalesFooter")}
              </p>
            </>
          )}
        </div>
        )}
      </div>
    </NativeCard>
  );
}

/* ═══ 2. The Branding Shop — the same stand, over the catalog ══════ */

function BrandingShopStand({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t, i18n } = useTranslation();
  const authHeaders = useAuthHeaders();
  const [sel, setSel] = useState<Record<ProductKey, { color: ColorKey; size: string; qty: number }>>(() =>
    Object.fromEntries(
      BRANDING_PRODUCTS.map((p) => [p.key, { color: "black" as ColorKey, size: p.sizes[0]!, qty: 1 }]),
    ) as Record<ProductKey, { color: ColorKey; size: string; qty: number }>,
  );
  const [cart, setCart] = useState<BrandingCartLine[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Rug logo upload — required before a rug can be carted. */
  const [rugLogo, setRugLogo] = useState<{ url: string; fileName: string } | null>(null);
  const [rugUploading, setRugUploading] = useState(false);

  /* The design desk. */
  const [brandName, setBrandName] = useState("");
  const [niche, setNiche] = useState("");
  const [style, setStyle] = useState<BrandStyle>("luxury-gold");
  const [designProducts, setDesignProducts] = useState<ProductKey[]>([]);
  const [designing, setDesigning] = useState(false);
  const [design, setDesign] = useState<BrandingDesignResult | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* Shipping + orders. */
  const [shipping, setShipping] = useState<BrandingShipping>({ name: "", email: "", address: "", city: "", state: "", zip: "" });
  const [placing, setPlacing] = useState(false);
  const [orders, setOrders] = useState<BrandingOrderDto[] | null>(null);
  const [ordersFailed, setOrdersFailed] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  /* The embedded session's clientSecret + the order it pays for,
     when the rail answers one — the payment form mounts in the
     panel below the cart and the buyer never leaves the World. */
  const [paySecret, setPaySecret] = useState<string | null>(null);
  const [paySecretOrderId, setPaySecretOrderId] = useState<string | null>(null);

  const cartTotal = brandingCartTotalCents(cart);
  const cartCount = cart.reduce((n, i) => n + i.qty, 0);

  const loadOrders = async () => {
    if (isGuest) return;
    try {
      const res = await fetch("/api/branding-shop/orders", { headers: await authHeaders() });
      if (!res.ok) throw new Error("orders");
      const data = (await res.json()) as { orders?: BrandingOrderDto[]; demo?: boolean };
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setDemoMode(data.demo === true);
      setOrdersFailed(false);
    } catch {
      setOrdersFailed(true);
    }
  };
  useEffect(() => {
    void loadOrders();
    // Returning from the hosted checkout tab: refresh the orders
    // in-world when the palace tab takes focus again (§3.3).
    const onFocus = () => void loadOrders();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  const membersOnlyNote = () => {
    setError(t("worldCommerceStands.brandMembersOnly"));
  };

  const addToCart = (key: ProductKey) => {
    if (isQuoteOnly(key)) return;
    if (key === "rug" && !rugLogo) {
      setError(t("worldCommerceStands.brandRugNeedsLogo"));
      return;
    }
    const s = sel[key];
    setCart((prev) =>
      addBrandingCartLine(prev, {
        product: key, color: s.color, size: s.size, qty: s.qty,
        ...(key === "rug" && rugLogo ? { logoUrl: rugLogo.url } : {}),
      }),
    );
    setError(null);
    setNote(t("worldCommerceStands.brandAddedNote", { label: productByKey(key).label }));
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    if (isGuest) { membersOnlyNote(); return; }
    if (!file.type.startsWith("image/")) { setError(t("worldCommerceStands.brandUploadImageType")); return; }
    if (file.size > 10 * 1024 * 1024) { setError(t("worldCommerceStands.brandUploadTooBig")); return; }
    setRugUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/branding-shop/upload-logo", {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(apiErrorMessage(data, t("worldCommerceStands.brandUploadFailed")));
      setRugLogo({ url: data.url, fileName: file.name });
      setNote(t("worldCommerceStands.brandLogoReadyNote"));
    } catch (e) {
      setError(plainErrorText(e, t("worldCommerceStands.brandUploadFailed")));
    } finally {
      setRugUploading(false);
    }
  };

  const runDesign = async () => {
    if (isGuest) { membersOnlyNote(); return; }
    const form = { brandName, niche, style, products: designProducts };
    if (!brandingDesignComplete(form)) {
      setError(t("worldCommerceStands.brandDesignIncomplete"));
      return;
    }
    setDesigning(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await fetch("/api/branding-shop/design", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => ({}))) as BrandingDesignResult & { error?: string; message?: string };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok || !data.logo?.url) throw new Error(apiErrorMessage(data, t("worldCommerceStands.brandDesignFailed")));
      setDesign(data);
      setNote(t("worldCommerceStands.brandDesignedNote", { cost: BRANDING_DESIGN_COST.toLocaleString(i18n.language) }));
    } catch (e) {
      setError(plainErrorText(e, t("worldCommerceStands.brandDesignHiccup")));
    } finally {
      setDesigning(false);
    }
  };

  /* Checkout: place the order in-world first (intake is free;
     the server recomputes the total), then POST checkout asking
     for the embedded session whenever a publishable key is
     present — the rail answers a clientSecret and the payment
     form mounts right here in the panel, so the buyer never
     leaves the palace. The hosted payment page in a NEW TAB
     remains only as the no-key / hosted-answer fallback (§3.9's
     marked transfer). Demo mode (no payment key on the server)
     completes in-world instead, clearly labelled. */
  const checkout = async () => {
    if (isGuest) { membersOnlyNote(); return; }
    if (cart.length === 0 || placing) return;
    if (!brandingShippingComplete(shipping)) {
      setError(t("worldCommerceStands.brandShippingIncomplete"));
      return;
    }
    setPlacing(true);
    setError(null);
    setNote(null);
    try {
      const orderRes = await fetch("/api/branding-shop/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(brandingOrderPayload(cart, shipping)),
      });
      const orderData = (await orderRes.json().catch(() => ({}))) as { order?: { id: string }; error?: string; message?: string };
      if (!orderRes.ok || !orderData.order?.id) {
        throw new Error(apiErrorMessage(orderData, t("worldCommerceStands.brandOrderPlaceFailed")));
      }
      const orderId = orderData.order.id;
      const coRes = await fetch("/api/branding-shop/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          orderId,
          /* Ask for the embedded presentation when this device can
             mount it (publishable key configured) — the server
             answers a clientSecret instead of a hosted URL and the
             buyer pays right here. Otherwise the hosted rail below
             remains the fallback. */
          uiMode: hasStripePublishableKey() ? "embedded" : undefined,
        }),
      });
      const coData = (await coRes.json().catch(() => ({}))) as { error?: string; message?: string; clientSecret?: string };
      if (!coRes.ok) {
        setNote(t("worldCommerceStands.brandCheckoutSavedNote"));
        void loadOrders();
        return;
      }
      /* The clientSecret branch precedes the tab fallback: an
         embedded answer mounts the payment form in the panel and
         the buyer never leaves the World. */
      if (typeof coData.clientSecret === "string" && coData.clientSecret) {
        setPaySecret(coData.clientSecret);
        setPaySecretOrderId(orderId);
        setCart([]);
        setNote(t("worldCommerceStands.brandEmbeddedNote"));
        void loadOrders();
        return;
      }
      const url = hostedCheckoutUrl(coData);
      if (url) {
        openCheckoutTab(url);
        setCart([]);
        setNote(t("worldCommerceStands.brandTabNote"));
        void loadOrders();
        return;
      }
      if (checkoutCompletedInWorld(coData)) {
        setCart([]);
        setNote(apiErrorMessage(coData, t("worldCommerceStands.brandDemoNote")));
        void loadOrders();
        return;
      }
      setNote(t("worldCommerceStands.brandOrderPlacedNote"));
      setCart([]);
      void loadOrders();
    } catch (e) {
      setError(plainErrorText(e, t("worldCommerceStands.brandOrderFailedCart")));
    } finally {
      setPlacing(false);
    }
  };

  const payForOrder = async (orderId: string) => {
    if (payingId) return;
    setPayingId(orderId);
    setError(null);
    try {
      const res = await fetch("/api/branding-shop/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          orderId,
          /* Same embedded ask as the cart checkout above. */
          uiMode: hasStripePublishableKey() ? "embedded" : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; clientSecret?: string };
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.brandCheckoutStartFailed")));
      /* The clientSecret branch precedes the tab fallback. */
      if (typeof data.clientSecret === "string" && data.clientSecret) {
        setPaySecret(data.clientSecret);
        setPaySecretOrderId(orderId);
        setNote(t("worldCommerceStands.brandPayEmbeddedNote"));
        return;
      }
      const url = hostedCheckoutUrl(data);
      if (url) {
        openCheckoutTab(url);
        setNote(t("worldCommerceStands.brandPayTabNote"));
        return;
      }
      setNote(apiErrorMessage(data, t("worldCommerceStands.brandOrderSettled")));
      void loadOrders();
    } catch (e) {
      setError(plainErrorText(e, t("worldCommerceStands.brandPayFailed")));
    } finally {
      setPayingId(null);
    }
  };

  const refreshOrder = async (orderId: string) => {
    if (refreshingId) return;
    setRefreshingId(orderId);
    try {
      const res = await fetch(`/api/branding-shop/orders/${encodeURIComponent(orderId)}/refresh`, {
        method: "POST",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("refresh");
      void loadOrders();
    } catch {
      setError(t("worldCommerceStands.brandRefreshFailed"));
    } finally {
      setRefreshingId(null);
    }
  };

  const shipField = (key: keyof BrandingShipping, placeholder: string) => (
    <input
      value={shipping[key]}
      onChange={(e) => setShipping((s) => ({ ...s, [key]: e.target.value }))}
      placeholder={placeholder}
      aria-label={placeholder}
      className={inputCls(isLight)}
    />
  );

  return (
    <div className="space-y-4" data-testid="world-shop-branding">
      {isGuest && (
        <p className={`px-1 text-xs ${muted(isLight)}`}>
          {t("worldCommerceStands.brandGuestNote")}
        </p>
      )}
      {error && <p className="px-1 text-xs font-semibold text-red-400">{error}</p>}
      {note && <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
      {outOfCredits && (
        <p className="px-1 text-xs font-semibold text-red-400">
          {t("worldCommerceStands.brandOutOfCredits", { cost: BRANDING_DESIGN_COST.toLocaleString(i18n.language) })}
        </p>
      )}

      <div className="space-y-2">
        <StandTitle isLight={isLight}>{t("worldCommerceStands.brandGoodsTitle")}</StandTitle>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BRANDING_PRODUCTS.map((p) => {
            const s = sel[p.key];
            return (
              <NativeCard key={p.key} isLight={isLight}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{p.label}</p>
                    <p className={`mt-0.5 line-clamp-2 text-xs ${muted(isLight)}`}>{p.blurb}</p>
                  </div>
                  <span className="ml-auto shrink-0 text-sm font-black text-[#d4af37]">{formatMoney(p.priceCents)}</span>
                </div>
                {!p.quoteOnly && (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={`text-[11px] font-semibold ${muted(isLight)}`}>{t("worldCommerceStands.brandColor")}</span>
                      {BRANDING_COLORS.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => setSel((prev) => ({ ...prev, [p.key]: { ...prev[p.key], color: c.key } }))}
                          className={`${chipBtn(isLight)} ${s.color === c.key ? "border-[#d4af37] text-[#d4af37]" : ""}`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={`text-[11px] font-semibold ${muted(isLight)}`}>{t("worldCommerceStands.brandSize")}</span>
                      {p.sizes.map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => setSel((prev) => ({ ...prev, [p.key]: { ...prev[p.key], size: sz } }))}
                          className={`${chipBtn(isLight)} ${s.size === sz ? "border-[#d4af37] text-[#d4af37]" : ""}`}
                        >
                          {sz}
                        </button>
                      ))}
                    </div>
                    {p.key === "rug" && (
                      <div className="mt-2">
                        {rugLogo ? (
                          <p className="flex items-center gap-2 text-xs font-semibold">
                            <img src={rugLogo.url} alt="" className="h-8 w-8 rounded object-contain" />
                            <span className="min-w-0 flex-1 truncate">{rugLogo.fileName}{t("worldCommerceStands.brandLogoReadySuffix")}</span>
                            <button type="button" onClick={() => setRugLogo(null)} className={chipBtn(isLight)}>{t("worldCommerceStands.brandChange")}</button>
                          </p>
                        ) : (
                          <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#d4af37]/50 px-3 py-2 text-xs font-bold bdv-touch-target ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                            <Upload className="h-3.5 w-3.5" />
                            {rugUploading ? t("worldCommerceStands.brandUploading") : t("worldCommerceStands.brandUploadRug")}
                            <input type="file" accept="image/*" className="hidden" disabled={rugUploading} onChange={(e) => void uploadLogo(e.target.files?.[0])} />
                          </label>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      data-testid="world-branding-add-to-cart"
                      onClick={() => addToCart(p.key)}
                      className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
                    >
                      <ShoppingCart className="h-3.5 w-3.5" /> {t("worldCommerceStands.shopAddToCart")}
                    </button>
                  </>
                )}
                {p.quoteOnly && (
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-3 py-1.5 text-xs font-bold text-[#e8c86a]" data-testid="world-branding-quote-only">
                    <Gem className="h-3.5 w-3.5" /> {contactForQuoteLabel(t)}
                  </p>
                )}
              </NativeCard>
            );
          })}
        </div>
      </div>

      {/* The design desk — in-world, priced in Visual Bucs up front. */}
      <NativeCard isLight={isLight} title={t("worldCommerceStands.brandDesignCardTitle", { cost: BRANDING_DESIGN_COST.toLocaleString(i18n.language) })}>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder={t("worldCommerceStands.brandNameLabel")} aria-label={t("worldCommerceStands.brandNameLabel")} maxLength={80} className={inputCls(isLight)} />
          <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder={t("worldCommerceStands.brandNichePlaceholder")} aria-label={t("worldCommerceStands.brandNicheLabel")} maxLength={120} className={inputCls(isLight)} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {BRANDING_STYLES.map((st) => (
            <button
              key={st.key}
              type="button"
              onClick={() => setStyle(st.key)}
              title={st.blurb}
              className={`${chipBtn(isLight)} ${style === st.key ? "border-[#d4af37] text-[#d4af37]" : ""}`}
            >
              {st.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {BRANDING_PRODUCTS.filter((p) => !p.quoteOnly).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() =>
                setDesignProducts((prev) =>
                  prev.includes(p.key) ? prev.filter((x) => x !== p.key) : prev.length >= MAX_DESIGN_PRODUCTS ? prev : [...prev, p.key],
                )
              }
              className={`${chipBtn(isLight)} ${designProducts.includes(p.key) ? "border-[#d4af37] text-[#d4af37]" : ""}`}
            >
              {p.label}
            </button>
          ))}
          <span className={`self-center text-[11px] ${muted(isLight)}`}>{t("worldCommerceStands.brandMockupsHint", { max: MAX_DESIGN_PRODUCTS })}</span>
        </div>
        <button type="button" data-testid="world-branding-design" onClick={() => void runDesign()} disabled={designing} className={`${goldBtn(designing)} mt-3`}>
          {designing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {designing ? t("worldCommerceStands.brandDesigning") : t("worldCommerceStands.brandDesignButton", { cost: BRANDING_DESIGN_COST.toLocaleString(i18n.language) })}
        </button>
        <p className={`mt-1.5 text-[11px] ${muted(isLight)}`}>{t("worldCommerceStands.brandRefundNote")}</p>
        {design && (
          <div className="mt-3 space-y-2" data-testid="world-branding-design-result">
            <div className="flex flex-wrap items-center gap-3">
              <img src={design.logo.url} alt={t("worldCommerceStands.brandLogoAlt")} className="h-20 w-20 rounded-2xl border border-[#d4af37]/40 object-cover" />
              <div>
                {design.brief.tagline && <p className="text-sm font-bold text-[#d4af37]">&ldquo;{design.brief.tagline}&rdquo;</p>}
                {design.brief.palette.length > 0 && (
                  <span className="mt-1 flex gap-1.5">
                    {design.brief.palette.map((c) => (
                      <span key={c} title={c} className="h-6 w-6 rounded-full border border-white/20" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {design.mockups.map((m) => (
                <span key={m.product} className="inline-flex flex-col items-center gap-1">
                  <img src={m.url} alt={productByKey(m.product).label} className="h-16 w-16 rounded-xl object-cover" />
                  <span className={`text-[11px] font-semibold ${muted(isLight)}`}>{productByKey(m.product).label}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </NativeCard>

      {/* The cart — in your hand, in-world. */}
      <NativeCard isLight={isLight} title={cartCount > 0 ? t("worldCommerceStands.shopCartTitleCount", { count: cartCount }) : t("worldCommerceStands.shopCartTitle")}>
        {cart.length === 0 ? (
          <NativeEmptyState isLight={isLight} message={t("worldCommerceStands.brandCartEmpty")} />
        ) : (
          <div className="space-y-2">
            {cart.map((item, idx) => {
              const p = productByKey(item.product);
              return (
                <div key={`${item.product}-${item.color}-${item.size}-${idx}`} className="flex flex-wrap items-center gap-2">
                  <span className={`min-w-0 flex-1 text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                    {p.label} <span className={`font-semibold capitalize ${muted(isLight)}`}>· {item.color} · {item.size}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <button type="button" aria-label={t("worldCommerceStands.shopOneLess")} onClick={() => setCart((c) => setBrandingCartQty(c, idx, item.qty - 1))} className={chipBtn(isLight)}><Minus className="h-3 w-3" /></button>
                    <span className="w-5 text-center text-sm font-bold">{item.qty}</span>
                    <button type="button" aria-label={t("worldCommerceStands.shopOneMore")} onClick={() => setCart((c) => setBrandingCartQty(c, idx, item.qty + 1))} className={chipBtn(isLight)}><Plus className="h-3 w-3" /></button>
                    <button type="button" aria-label={t("worldCommerceStands.shopRemoveFromCart")} onClick={() => setCart((c) => setBrandingCartQty(c, idx, 0))} className={chipBtn(isLight)}><Trash2 className="h-3 w-3" /></button>
                  </span>
                  <span className="text-sm font-black text-[#d4af37]">{formatMoney(p.priceCents * item.qty)}</span>
                </div>
              );
            })}
            <div className="space-y-2 border-t border-[#d4af37]/25 pt-3">
              <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("worldCommerceStands.brandShippingTitle")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {shipField("name", t("worldCommerceStands.brandShipName"))}
                {shipField("email", t("worldCommerceStands.brandShipEmail"))}
              </div>
              {shipField("address", t("worldCommerceStands.brandShipAddress"))}
              <div className="grid grid-cols-3 gap-2">
                {shipField("city", t("worldCommerceStands.brandShipCity"))}
                {shipField("state", t("worldCommerceStands.brandShipState"))}
                {shipField("zip", t("worldCommerceStands.brandShipZip"))}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className={muted(isLight)}>{t("worldCommerceStands.shopTotal")}</span>
                <span className="text-lg font-black">{formatMoney(cartTotal)}</span>
              </div>
              {/* The ONE marked door out of this stand: payment. */}
              <button type="button" data-testid="world-branding-checkout" onClick={() => void checkout()} disabled={placing} className={`${goldBtn(placing)} w-full`}>
                {placing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                {checkoutTransferLabel(t)} · {formatMoney(cartTotal)}
              </button>
              <p className={`text-[11px] ${muted(isLight)}`}>
                {t("worldCommerceStands.brandCheckoutNote")}
              </p>
            </div>
          </div>
        )}
      </NativeCard>

      {/* The embedded payment form — mounted in-panel when the
          rail answered a clientSecret (cart checkout or an
          order's Pay button); the order stays saved either way. */}
      {paySecret && (
        <div className="space-y-2 rounded-2xl border border-[#d4af37]/25 p-3" data-testid="world-branding-embedded-checkout">
          <p className={`text-xs font-semibold ${muted(isLight)}`}>
            {t("worldCommerceStands.brandPayingFor", { id: paySecretOrderId ? paySecretOrderId.slice(0, 8) : "" })}
          </p>
          <EmbeddedSessionCheckout clientSecret={paySecret} />
          <button
            type="button"
            onClick={() => { setPaySecret(null); setPaySecretOrderId(null); }}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${isLight ? "border-[#7A5A12]/40 text-[#2a1e07]" : "border-white/20 text-white"}`}
          >
            {t("worldCommerceStands.brandEmbeddedClose")}
          </button>
        </div>
      )}

      {/* Your orders — status rows, refreshed in-world. */}
      {!isGuest && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <StandTitle isLight={isLight}>{t("worldCommerceStands.brandYourOrders")}</StandTitle>
            <button type="button" onClick={() => void loadOrders()} className={`${chipBtn(isLight)} ml-auto`}>
              <RefreshCw className="h-3 w-3" /> {t("worldCommerceStands.brandRefreshOrders")}
            </button>
          </div>
          {demoMode && orders && orders.length > 0 && (
            <p className={`px-1 text-[11px] ${muted(isLight)}`}>{t("worldCommerceStands.brandDemoFulfillment")}</p>
          )}
          {ordersFailed ? (
            <NativeErrorState isLight={isLight} title={t("worldCommerceStands.brandOrdersFailedTitle")} message={t("worldCommerceStands.brandOrdersFailedMsg")} onRetry={() => void loadOrders()} />
          ) : orders === null ? (
            <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.brandOrdersLoading")} />
          ) : orders.length === 0 ? (
            <NativeEmptyState isLight={isLight} message={t("worldCommerceStands.brandOrdersEmpty")} />
          ) : (
            orders.map((o) => (
              <div
                key={o.id}
                data-testid="world-branding-order-row"
                className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
              >
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                    #{o.id.slice(0, 8)} · {t(o.items.reduce((n, i) => n + i.qty, 0) === 1 ? "worldCommerceStands.brandItemOne" : "worldCommerceStands.brandItemMany", { count: o.items.reduce((n, i) => n + i.qty, 0) })}
                  </span>
                  <span className={`block truncate text-xs ${muted(isLight)}`}>
                    {o.items.map((i) => t("worldCommerceStands.brandOrderItemQty", { qty: i.qty, label: productByKey(i.product).label })).join(", ")}
                    {o.trackingNumber ? t("worldCommerceStands.brandTrackingPart", { n: o.trackingNumber }) : ""}
                  </span>
                </span>
                <span className={`ml-auto inline-flex items-center gap-2 text-xs font-semibold ${muted(isLight)}`}>
                  {brandingOrderStatusLabel(o.status)} · {formatMoney(o.totalCents)}
                </span>
                {o.paid ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                    <BadgeCheck className="h-3 w-3" /> {t("worldCommerceStands.brandPaidChip")}
                  </span>
                ) : (
                  <button type="button" onClick={() => void payForOrder(o.id)} disabled={payingId === o.id} className={chipBtn(isLight)}>
                    {payingId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null} {t("worldCommerceStands.brandPayButton", { total: formatMoney(o.totalCents) })}
                  </button>
                )}
                {o.providerOrderId && (
                  <button type="button" onClick={() => void refreshOrder(o.id)} disabled={refreshingId === o.id} className={chipBtn(isLight)}>
                    {refreshingId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} {t("worldCommerceStands.brandStatusButton")}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ═══ 3a. Crowns — the CREATOR side: your tiers, managed here ══════
   Stack-100 #63. Fans could already join at this stand; now the
   creator builds what's being sold, on the memberships page's own
   rails: GET /api/memberships/tiers (the caller's OWN tiers —
   paused ones included; management sees what fans can't),
   POST/PUT/DELETE on the same endpoints with the page's exact
   bodies (lib/world/money-desks), and the dashboard strip from
   GET /api/memberships/dashboard. The platform fee is whatever
   the rail reports (10% today) and is displayed the way the 2D
   surface displays it — the net line, "after 10% platform fee" —
   on the dashboard strip and under every tier's price. Tier
   create/edit/pause are FREE management actions (no Visual Bucs
   move), so no spend confirmation applies; deletion keeps the
   stand's two-step discipline, and the row leaves only on the
   server's confirm. Members only — this whole desk never renders
   for a guest. */

interface MembershipDashboardDto {
  activeMembers: number;
  trialingMembers: number;
  mrrDollars: number;
  netMrrCents: number;
  churnPct: number;
  testMode: boolean;
}

function CrownsCreatorDesk({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const authHeaders = useAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();
  const tierStrings: TierLabelStrings = {
    free: t("worldCommerceStands.crownsTierFree"),
    perMonth: t("worldCommerceStands.crownsTierPerMonth"),
    perYear: t("worldCommerceStands.crownsTierPerYear"),
    saving: t("worldCommerceStands.crownsTierSaving"),
    freeCrowns: t("worldCommerceStands.crownsStartingFree"),
    crownsFrom: t("worldCommerceStands.crownsStartingFrom"),
  };
  const md = (n: number) => membershipDollars(n, i18n.language);
  const [ownTiers, setOwnTiers] = useState<MembershipTierDto[] | null>(null);
  const [ownFailed, setOwnFailed] = useState(false);
  const [feePct, setFeePct] = useState(10);
  const [dash, setDash] = useState<MembershipDashboardDto | null>(null);
  const [form, setForm] = useState<TierFormState>(emptyTierForm());
  const [perkInput, setPerkInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /* Depth (parity P3): the member roster the dashboard only
     counted, and the perk suggester — both on the memberships
     page's own rails (GET/PATCH/DELETE/POST /api/memberships/
     members, POST /api/memberships/ai-perks). */
  const [roster, setRoster] = useState<RosterMemberDto[] | null>(null);
  const [rosterFailed, setRosterFailed] = useState(false);
  const [rosterMsg, setRosterMsg] = useState<string | null>(null);
  const [memberTierId, setMemberTierId] = useState("");
  const [memberLabel, setMemberLabel] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [niche, setNiche] = useState("");
  const [audienceSize, setAudienceSize] = useState<AudienceSize>("starting");
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedTierDto[] | null>(null);
  const [suggestMsg, setSuggestMsg] = useState<string | null>(null);

  const loadOwn = async () => {
    try {
      const res = await fetch("/api/memberships/tiers", { headers: await authHeaders() });
      if (!res.ok) throw new Error("tiers");
      const parsed = parseOwnTiers(await res.json());
      if (!parsed) throw new Error("tiers");
      setOwnTiers(parsed.tiers);
      setFeePct(parsed.platformFeePct);
      setOwnFailed(false);
    } catch {
      setOwnFailed(true);
    }
    try {
      const res = await fetch("/api/memberships/dashboard", { headers: await authHeaders() });
      if (res.ok) {
        const d = (await res.json()) as Partial<MembershipDashboardDto>;
        if (typeof d.mrrDollars === "number" && typeof d.netMrrCents === "number") {
          setDash({
            activeMembers: typeof d.activeMembers === "number" ? d.activeMembers : 0,
            trialingMembers: typeof d.trialingMembers === "number" ? d.trialingMembers : 0,
            mrrDollars: d.mrrDollars,
            netMrrCents: d.netMrrCents,
            churnPct: typeof d.churnPct === "number" ? d.churnPct : 0,
            testMode: d.testMode === true,
          });
        }
      }
    } catch { /* the dashboard strip is additive — tiers are the desk */ }
  };
  const loadRoster = async () => {
    try {
      const res = await fetch("/api/memberships/members", { headers: await authHeaders() });
      if (!res.ok) throw new Error("roster");
      const parsed = parseRosterMembers(await res.json());
      if (!parsed) throw new Error("roster");
      setRoster(parsed);
      setRosterFailed(false);
    } catch {
      setRosterFailed(true);
    }
  };
  useEffect(() => {
    void loadOwn();
    void loadRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The roster's status verb — the page's own PATCH, applied to
     the row ONLY from the server's confirmed answer. */
  const changeMemberStatus = async (member: RosterMemberDto, status: MemberStatusOption) => {
    if (memberBusyId || status === member.status) return;
    setMemberBusyId(member.id);
    setRosterMsg(null);
    try {
      const res = await fetch(`/api/memberships/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(memberStatusPayload(status)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldCommerceStands.crownsStatusFailed")));
      const saved = savedMemberStatus(data);
      if (!saved) throw new Error(t("worldCommerceStands.crownsStatusFailed"));
      setRoster((list) => (list ? applyMemberStatus(list, saved) : list));
      setRosterMsg(t("worldCommerceStands.crownsStatusUpdated", { name: member.fanLabel, status: saved.status.replace("_", " ") }));
    } catch (e) {
      setRosterMsg(plainErrorText(e, t("worldCommerceStands.crownsStatusFailed")));
    } finally {
      setMemberBusyId(null);
    }
  };

  /* Remove a seat — two taps like tier delete, and the row goes
     only after the server confirms the delete. */
  const removeMember = async (member: RosterMemberDto) => {
    if (confirmingRemoveId !== member.id) {
      setConfirmingRemoveId(member.id);
      return;
    }
    setMemberBusyId(member.id);
    setRosterMsg(null);
    try {
      const res = await fetch(`/api/memberships/members/${member.id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(apiErrorLine(data, t("worldCommerceStands.crownsMemberRemoveFailed")));
      }
      setRoster((list) => (list ? removeMemberRow(list, member.id) : list));
      setRosterMsg(t("worldCommerceStands.crownsMemberRemoved", { name: member.fanLabel }));
    } catch (e) {
      setRosterMsg(plainErrorText(e, t("worldCommerceStands.crownsMemberRemoveFailed")));
    } finally {
      setMemberBusyId(null);
      setConfirmingRemoveId(null);
    }
  };

  /* The manual add — the page's "track a member by hand" for
     subscribers collected elsewhere. Honest by construction:
     the rail records the seat; no payment is taken here and the
     copy never pretends otherwise. */
  const addMember = async () => {
    const problem = memberAddProblem(memberTierId, memberLabel);
    if (problem) {
      setRosterMsg(problem);
      return;
    }
    const body = buildMemberAddPayload(memberTierId, memberLabel);
    if (!body) return;
    setAddingMember(true);
    setRosterMsg(null);
    try {
      const res = await fetch("/api/memberships/members", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldCommerceStands.crownsMemberAddFailed")));
      setMemberLabel("");
      setRosterMsg(t("worldCommerceStands.crownsMemberAdded", { name: body.fanLabel }));
      void loadRoster();
    } catch (e) {
      setRosterMsg(plainErrorText(e, t("worldCommerceStands.crownsMemberAddFailed")));
    } finally {
      setAddingMember(false);
    }
  };

  /* The perk suggester — POST /api/memberships/ai-perks through
     the confirmed-spend seam at the server's own price (100 VB;
     the endpoint isn't in the client registry, so the price
     rides as the confirm's override). A declined confirm is a
     quiet no-op; the suggestions land as drafts — using one
     fills the tier form, and nothing saves until save is tapped. */
  const runPerkSuggest = async () => {
    if (suggestBusy) return;
    if (!niche.trim()) {
      setSuggestMsg(t("worldCommerceStands.crownsSuggestNeedNiche"));
      return;
    }
    setSuggestBusy(true);
    setSuggestMsg(null);
    try {
      const res = await confirmedFetch("/api/memberships/ai-perks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPerkSuggestPayload({ niche, audienceSize })),
        overrideCost: MEMBERSHIP_AI_PERKS_COST_VB,
        overrideFeature: "Membership perk suggester",
      });
      if (!res) return; /* the creator declined the spend confirm — nothing charged, nothing changed */
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (aiOutOfCredits(res.status, data)) {
        setSuggestMsg(t("worldCommerceStands.crownsSuggestOut"));
        return;
      }
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldCommerceStands.crownsSuggestFailed")));
      const got = parsePerkSuggestions(data);
      if (!got) throw new Error(t("worldCommerceStands.crownsSuggestEmpty"));
      setSuggestions(got);
      setSuggestMsg(t("worldCommerceStands.crownsSuggestReady"));
    } catch (e) {
      setSuggestMsg(plainErrorText(e, t("worldCommerceStands.crownsSuggestFailed")));
    } finally {
      setSuggestBusy(false);
    }
  };

  const applySuggestion = (s: SuggestedTierDto) => {
    setEditingId(null);
    setPerkInput("");
    setForm((f) => tierFormFromSuggestion(f, s));
    setMsg(t("worldCommerceStands.crownsSuggestionLoaded", { name: s.name }));
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyTierForm());
    setPerkInput("");
  };

  const startEdit = (tier: MembershipTierDto) => {
    setEditingId(tier.id);
    setForm(tierFormFromDto(tier));
    setPerkInput("");
    setMsg(null);
  };

  const addPerk = () => {
    const perk = perkInput.trim();
    if (!perk) return;
    if (form.perks.length >= TIER_PERKS_MAX) {
      setMsg(t("worldCommerceStands.crownsPerksMax", { max: TIER_PERKS_MAX }));
      return;
    }
    setForm((f) => ({ ...f, perks: [...f.perks, perk] }));
    setPerkInput("");
  };

  const save = async () => {
    const problem = tierFormProblem(form);
    if (problem) {
      setMsg(problem);
      return;
    }
    const body = buildTierPayload(form);
    if (!body) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(editingId ? `/api/memberships/tiers/${editingId}` : "/api/memberships/tiers", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldCommerceStands.crownsTierSaveFailed")));
      const saved = savedTierDto(data);
      if (!saved) throw new Error(t("worldCommerceStands.crownsTierSaveFailed"));
      setOwnTiers((list) => applyTierSave(list ?? [], saved, editingId));
      setMsg(editingId ? t("worldCommerceStands.crownsTierUpdated", { name: saved.name }) : t("worldCommerceStands.crownsTierCreated", { name: saved.name }));
      resetForm();
      void loadOwn();
    } catch (e) {
      setMsg(plainErrorText(e, t("worldCommerceStands.crownsTierSaveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (tier: MembershipTierDto) => {
    if (pausingId) return;
    setPausingId(tier.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/memberships/tiers/${tier.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(tierActivePayload(tier)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldCommerceStands.crownsTierUpdateFailed")));
      const saved = savedTierDto(data);
      if (saved) setOwnTiers((list) => (list ? applyTierSave(list, saved, tier.id) : list));
      else void loadOwn();
      setMsg(saved && !saved.isActive
        ? t("worldCommerceStands.crownsTierPaused", { name: tier.name })
        : t("worldCommerceStands.crownsTierLive", { name: tier.name }));
    } catch (e) {
      setMsg(plainErrorText(e, t("worldCommerceStands.crownsTierUpdateFailed")));
    } finally {
      setPausingId(null);
    }
  };

  const deleteTier = async (tier: MembershipTierDto) => {
    if (confirmingDeleteId !== tier.id) {
      setConfirmingDeleteId(tier.id);
      return;
    }
    setDeletingId(tier.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/memberships/tiers/${tier.id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(apiErrorLine(data, t("worldCommerceStands.crownsTierDeleteFailed")));
      }
      setOwnTiers((list) => (list ? removeTier(list, tier.id) : list));
      if (editingId === tier.id) resetForm();
      setMsg(t("worldCommerceStands.crownsTierDeleted", { name: tier.name }));
    } catch (e) {
      setMsg(plainErrorText(e, t("worldCommerceStands.crownsTierDeleteFailed")));
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  };

  const field = (label: string, node: ReactNode) => (
    <label className="block">
      <span className={`mb-1 block text-[11px] font-bold uppercase tracking-wide ${muted(isLight)}`}>{label}</span>
      {node}
    </label>
  );

  return (
    <NativeCard isLight={isLight} title={t("worldCommerceStands.crownsDeskTitle")}>
      <div data-testid="world-crowns-creator-desk" className="space-y-3">
        {dash && (
          <p className={`text-xs ${muted(isLight)}`} data-testid="world-crowns-dash">
            {t(dash.activeMembers === 1 ? "worldCommerceStands.crownsDashMembersOne" : "worldCommerceStands.crownsDashMembersMany", { count: dash.activeMembers })}
            {dash.trialingMembers > 0 ? t("worldCommerceStands.crownsDashTrial", { count: dash.trialingMembers }) : ""}
            {t("worldCommerceStands.crownsDashMoneyBefore", { mrr: md(dash.mrrDollars) })}
            <span className="font-semibold">{t("worldCommerceStands.crownsDashNetFee", { net: md(dash.netMrrCents / 100), fee: feePct })}</span>
            {dash.testMode ? t("worldCommerceStands.crownsDashTestMode") : ""}
          </p>
        )}

        {ownFailed ? (
          <NativeErrorState isLight={isLight} title={t("worldCommerceStands.crownsTiersFailedTitle")} message={t("worldCommerceStands.crownsTiersFailedMsg")} onRetry={() => void loadOwn()} />
        ) : ownTiers === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.crownsTiersLoading")} />
        ) : (
          <>
            {ownTiers.length === 0 ? (
              <p className={`text-xs ${muted(isLight)}`}>
                {t("worldCommerceStands.crownsNoTiers")}
              </p>
            ) : (
              <div className="space-y-1.5">
                {ownTiers.map((tier) => (
                  <div
                    key={tier.id}
                    data-testid="world-crowns-own-tier"
                    className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
                  >
                    <Crown className={`h-4 w-4 shrink-0 ${tier.isActive ? "text-[#d4af37]" : "text-white/30"}`} />
                    <span className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{tier.name}</span>
                    <span className={`text-xs ${muted(isLight)}`}>
                      {tierPriceLabel(tier, "monthly", tierStrings, i18n.language)}
                      {tier.priceCents > 0 && (
                        <>{t("worldCommerceStands.crownsYouKeep", { net: md(tierNetCents(tier.priceCents, feePct) / 100), fee: feePct })}</>
                      )}
                      {tier.trialEnabled && tier.priceCents > 0 ? t("worldCommerceStands.crownsTrialSuffix") : ""}
                      {tier.annualDiscountPct > 0 ? t("worldCommerceStands.crownsAnnualOff", { pct: tier.annualDiscountPct }) : ""}
                    </span>
                    {!tier.isActive && (
                      <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/50">{t("worldCommerceStands.crownsPausedChip")}</span>
                    )}
                    <span className="ml-auto inline-flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => startEdit(tier)} className={chipBtn(isLight)}>
                        <Pencil className="h-3 w-3" /> {t("worldCommerceStands.crownsEdit")}
                      </button>
                      <button type="button" data-testid="world-crowns-tier-toggle" onClick={() => void toggleActive(tier)} disabled={pausingId === tier.id} className={chipBtn(isLight)}>
                        {pausingId === tier.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        {tier.isActive ? t("worldCommerceStands.crownsPause") : t("worldCommerceStands.crownsUnpause")}
                      </button>
                      <button
                        type="button"
                        data-testid="world-crowns-tier-delete"
                        onClick={() => void deleteTier(tier)}
                        disabled={deletingId === tier.id}
                        className={`${chipBtn(isLight)} ${confirmingDeleteId === tier.id ? "border-red-400 text-red-300" : ""}`}
                      >
                        {deletingId === tier.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        {confirmingDeleteId === tier.id ? t("worldCommerceStands.crownsTapDelete") : t("worldCommerceStands.crownsDelete")}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className={`space-y-2 rounded-2xl border px-3 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/40" : "border-white/10 bg-black/30"}`}>
              <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                {editingId ? t("worldCommerceStands.crownsFormEditTitle") : t("worldCommerceStands.crownsFormNewTitle")}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {field(t("worldCommerceStands.crownsTierNameLabel"), (
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("worldCommerceStands.crownsTierNamePlaceholder")} aria-label={t("worldCommerceStands.crownsTierNameLabel")} className={inputCls(isLight)} maxLength={70} />
                ))}
                {field(t("worldCommerceStands.crownsPriceLabel"), (
                  <input value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} inputMode="decimal" placeholder="5" aria-label={t("worldCommerceStands.crownsPriceAria")} className={inputCls(isLight)} />
                ))}
              </div>
              {field(t("worldCommerceStands.crownsDescLabel"), (
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} aria-label={t("worldCommerceStands.crownsDescAria")} className={inputCls(isLight)} maxLength={520} />
              ))}
              <div>
                <span className={`mb-1 block text-[11px] font-bold uppercase tracking-wide ${muted(isLight)}`}>{t("worldCommerceStands.crownsPerksLabel")}</span>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={perkInput}
                    onChange={(e) => setPerkInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPerk(); } }}
                    placeholder={t("worldCommerceStands.crownsPerkPlaceholder")}
                    aria-label={t("worldCommerceStands.crownsPerkAria")}
                    className={`${inputCls(isLight)} min-w-0 flex-1`}
                    maxLength={150}
                  />
                  <button type="button" onClick={addPerk} className={chipBtn(isLight)}>
                    <Plus className="h-3.5 w-3.5" /> {t("worldCommerceStands.crownsAddPerk")}
                  </button>
                </div>
                {form.perks.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {form.perks.map((perk, i) => (
                      <li key={i} className={`flex items-center gap-2 text-xs ${muted(isLight)}`}>
                        <Check className="h-3 w-3 shrink-0 text-[#d4af37]" />
                        <span className="min-w-0 flex-1">{perk}</span>
                        <button type="button" aria-label={t("worldCommerceStands.crownsRemovePerkAria", { perk })} onClick={() => setForm((f) => ({ ...f, perks: f.perks.filter((_, j) => j !== i) }))} className={chipBtn(isLight)}>
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className={`space-y-2 rounded-xl border border-dashed px-3 py-2.5 ${isLight ? "border-[#C9A84C]/50 bg-white/30" : "border-white/15 bg-white/[0.03]"}`}>
                <span className={`block text-[11px] font-bold uppercase tracking-wide ${muted(isLight)}`}>
                  {t("worldCommerceStands.crownsSuggestTitle", { cost: MEMBERSHIP_AI_PERKS_COST_VB })}
                </span>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                    placeholder={t("worldCommerceStands.crownsNichePlaceholder")}
                    className={`${inputCls(isLight)} min-w-0 flex-1`}
                    maxLength={80}
                    aria-label={t("worldCommerceStands.crownsNicheAria")}
                  />
                  <select
                    value={audienceSize}
                    onChange={(e) => setAudienceSize(e.target.value as AudienceSize)}
                    className={`${inputCls(isLight)} w-auto`}
                    aria-label={t("worldCommerceStands.crownsAudienceAria")}
                  >
                    <option value="starting">{t("worldCommerceStands.crownsAudienceStarting")}</option>
                    <option value="growing">{t("worldCommerceStands.crownsAudienceGrowing")}</option>
                    <option value="established">{t("worldCommerceStands.crownsAudienceEstablished")}</option>
                  </select>
                  <button type="button" data-testid="world-crowns-perk-suggest" onClick={() => void runPerkSuggest()} disabled={suggestBusy} className={chipBtn(isLight)}>
                    {suggestBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {t("worldCommerceStands.crownsSuggestButton")}
                  </button>
                </div>
                {suggestMsg && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{suggestMsg}</p>}
                {suggestions && (
                  <div className="space-y-1.5">
                    {suggestions.map((s, i) => (
                      <div
                        key={`${s.name}-${i}`}
                        data-testid="world-crowns-perk-suggestion"
                        className={`rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{s.name}</span>
                          <span className={`text-xs ${muted(isLight)}`}>{t("worldCommerceStands.crownsSuggestPriceLine", { price: md(s.priceDollars) })}</span>
                          <span className="ml-auto">
                            <button type="button" data-testid="world-crowns-perk-use" onClick={() => applySuggestion(s)} className={chipBtn(isLight)}>
                              <Plus className="h-3 w-3" /> {t("worldCommerceStands.crownsUseTier")}
                            </button>
                          </span>
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {s.perks.map((perk, j) => (
                            <li key={j} className={`flex items-center gap-2 text-xs ${muted(isLight)}`}>
                              <Check className="h-3 w-3 shrink-0 text-[#d4af37]" />
                              <span>{perk}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className={`inline-flex items-center gap-2 text-xs font-semibold ${muted(isLight)}`}>
                  <input
                    type="checkbox"
                    checked={form.trialEnabled}
                    onChange={(e) => setForm((f) => ({ ...f, trialEnabled: e.target.checked }))}
                    className="h-4 w-4 accent-[#d4af37]"
                  />
                  {t("worldCommerceStands.crownsTrialCheckbox")}
                </label>
                <label className="block">
                  <span className={`mb-1 block text-[11px] font-bold uppercase tracking-wide ${muted(isLight)}`}>{t("worldCommerceStands.crownsAnnualDiscountLabel")}</span>
                  <input value={form.annualDiscount} onChange={(e) => setForm((f) => ({ ...f, annualDiscount: e.target.value }))} inputMode="numeric" placeholder="0" className={`${inputCls(isLight)} w-24`} />
                </label>
                <span className={`text-[11px] ${muted(isLight)}`}>
                  {t("worldCommerceStands.crownsFeeNote", { fee: feePct })}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" data-testid="world-crowns-tier-save" onClick={() => void save()} disabled={saving} className={goldBtn(saving)}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
                  {editingId ? t("worldCommerceStands.crownsSaveTier") : t("worldCommerceStands.crownsCreateTier")}
                </button>
                {editingId && (
                  <button type="button" onClick={resetForm} className={chipBtn(isLight)}>
                    {t("worldCommerceStands.crownsCancelEdit")}
                  </button>
                )}
              </div>
            </div>

            <div className={`space-y-2 rounded-2xl border px-3 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/40" : "border-white/10 bg-black/30"}`}>
              <p className={`flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                <Users className="h-3.5 w-3.5" /> {t("worldCommerceStands.crownsMembersTitle")}
              </p>
              <div data-testid="world-crowns-roster" className="space-y-2">
                {rosterFailed ? (
                  <NativeErrorState isLight={isLight} title={t("worldCommerceStands.crownsRosterFailedTitle")} message={t("worldCommerceStands.crownsRosterFailedMsg")} onRetry={() => void loadRoster()} />
                ) : roster === null ? (
                  <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.crownsRosterLoading")} />
                ) : (
                  <>
                    {roster.length === 0 ? (
                      <p className={`text-xs ${muted(isLight)}`}>
                        {t("worldCommerceStands.crownsNoMembers")}
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {roster.map((m) => (
                          <div
                            key={m.id}
                            data-testid="world-crowns-roster-row"
                            className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
                          >
                            <span className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{m.fanLabel}</span>
                            <span className={`text-xs ${muted(isLight)}`}>
                              {m.tierName ?? t("worldCommerceStands.crownsMembershipFallback")} · {md(m.priceDollars)}{m.billingPeriod === "annual" ? t("worldCommerceStands.crownsPerYear") : t("worldCommerceStands.crownsPerMonth")}
                              {m.isGift ? t("worldCommerceStands.crownsGiftSuffix") : ""}
                              {m.joinedAt ? t("worldCommerceStands.crownsJoinedSuffix", { date: m.joinedAt.slice(0, 10) }) : ""}
                            </span>
                            <span className="ml-auto inline-flex flex-wrap items-center gap-1.5">
                              <select
                                aria-label={t("worldCommerceStands.crownsStatusAria", { name: m.fanLabel })}
                                value={m.status}
                                disabled={memberBusyId === m.id}
                                onChange={(e) => void changeMemberStatus(m, e.target.value as MemberStatusOption)}
                                className={`${inputCls(isLight)} w-auto py-1 text-xs`}
                              >
                                {(MEMBER_STATUS_OPTIONS as readonly string[]).includes(m.status) ? null : (
                                  <option value={m.status}>{m.status.replace("_", " ")}</option>
                                )}
                                {MEMBER_STATUS_OPTIONS.map((s) => (
                                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                data-testid="world-crowns-member-remove"
                                onClick={() => void removeMember(m)}
                                disabled={memberBusyId === m.id}
                                className={`${chipBtn(isLight)} ${confirmingRemoveId === m.id ? "border-red-400 text-red-300" : ""}`}
                              >
                                {memberBusyId === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                                {confirmingRemoveId === m.id ? t("worldCommerceStands.crownsTapRemove") : t("worldCommerceStands.crownsRemove")}
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={memberTierId}
                        onChange={(e) => setMemberTierId(e.target.value)}
                        className={`${inputCls(isLight)} w-auto flex-1`}
                        aria-label={t("worldCommerceStands.crownsTierSelectAria")}
                      >
                        <option value="">{t("worldCommerceStands.crownsTierPickPlaceholder")}</option>
                        {ownTiers.map((t2) => (
                          <option key={t2.id} value={t2.id}>{t("worldCommerceStands.crownsTierOptionLine", { name: t2.name, price: tierPriceLabel(t2, "monthly", tierStrings, i18n.language) })}</option>
                        ))}
                      </select>
                      <input
                        value={memberLabel}
                        onChange={(e) => setMemberLabel(e.target.value)}
                        placeholder={t("worldCommerceStands.crownsMemberLabelPlaceholder")}
                        className={`${inputCls(isLight)} min-w-0 flex-1`}
                        maxLength={120}
                        aria-label={t("worldCommerceStands.crownsMemberLabelAria")}
                      />
                      <button type="button" data-testid="world-crowns-member-add" onClick={() => void addMember()} disabled={addingMember} className={goldBtn(addingMember)}>
                        {addingMember ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        {t("worldCommerceStands.crownsAddMember")}
                      </button>
                    </div>
                    <p className={`text-[11px] ${muted(isLight)}`}>
                      {t("worldCommerceStands.crownsMemberAddNote")}
                    </p>
                  </>
                )}
                {rosterMsg && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{rosterMsg}</p>}
              </div>
            </div>
          </>
        )}
        {msg && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{msg}</p>}
      </div>
    </NativeCard>
  );
}

/* ═══ 3. Crowns & Memberships — tiers as crown cards ═══════════════ */

function CrownsStand({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t, i18n } = useTranslation();
  const authHeaders = useAuthHeaders();
  const tierStrings: TierLabelStrings = {
    free: t("worldCommerceStands.crownsTierFree"),
    perMonth: t("worldCommerceStands.crownsTierPerMonth"),
    perYear: t("worldCommerceStands.crownsTierPerYear"),
    saving: t("worldCommerceStands.crownsTierSaving"),
    freeCrowns: t("worldCommerceStands.crownsStartingFree"),
    crownsFrom: t("worldCommerceStands.crownsStartingFrom"),
  };
  const md = (n: number) => membershipDollars(n, i18n.language);
  const [creatorInput, setCreatorInput] = useState("");
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [tiers, setTiers] = useState<MembershipTierDto[] | null>(null);
  const [tiersFailed, setTiersFailed] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [mine, setMine] = useState<MyMembershipDto[] | null>(null);
  /* Depth (parity P3): the browsable club directory, the gift
     recipient, and the checkout-return verify — the stand used
     to take a pasted join ID only, gift nothing, and trust that
     a paid join landed because the tab closed. */
  const [directory, setDirectory] = useState<ClubDirectoryRow[] | null>(null);
  const [directoryFailed, setDirectoryFailed] = useState(false);
  const [recipientInput, setRecipientInput] = useState("");
  const [pendingCheckout, setPendingCheckout] = useState<MembershipPendingCheckout | null>(null);
  const [joinNote, setJoinNote] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  /* Embedded join: the clientSecret of a join being paid for right
     here at the stand (the hosted tab is only the fallback). */
  const [joinSecret, setJoinSecret] = useState<string | null>(null);

  const recipientId = parseRecipientUserId(recipientInput);
  const recipientInvalid = recipientInput.trim() !== "" && recipientId === null;

  const loadMine = async () => {
    if (isGuest) return;
    try {
      const res = await fetch("/api/memberships/mine", { headers: await authHeaders() });
      if (!res.ok) return;
      const data = (await res.json()) as { memberships?: MyMembershipDto[] };
      setMine(Array.isArray(data.memberships) ? data.memberships : []);
    } catch { /* the fan section is additive — a quiet stand is fine */ }
  };

  const loadDirectory = async () => {
    try {
      const res = await fetch("/api/memberships/directory");
      if (!res.ok) throw new Error("directory");
      const parsed = parseClubDirectory(await res.json());
      if (!parsed) throw new Error("directory");
      setDirectory(parsed);
      setDirectoryFailed(false);
    } catch {
      setDirectoryFailed(true);
    }
  };
  useEffect(() => {
    void loadDirectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The return verify — POST /api/memberships/verify is the ONLY
     path from a paid hosted checkout to an active membership,
     and the checkout response handed this stand the sessionId,
     so the stand confirms the landing itself: on mount, when the
     palace tab takes focus again, and whenever the walker taps
     the check button. Three honest outcomes (membershipVerifyState):
     confirmed clears the stash and names the crown; pending keeps
     it and says finish paying first; dead drops it and claims
     nothing. */
  const verifyPending = async (pending: MembershipPendingCheckout) => {
    if (isGuest) return;
    setVerifying(true);
    try {
      const res = await fetch("/api/memberships/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ sessionId: pending.sessionId }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const state = membershipVerifyState(res.status, data);
      if (state === "confirmed") {
        try { localStorage.removeItem(membershipPendingKey()); } catch { /* the state below still clears */ }
        setPendingCheckout(null);
        setJoinSecret(null);
        setJoinNote(
          pending.isGift
            ? t("worldCommerceStands.crownsVerifyGiftConfirmed", { name: pending.tierName })
            : t("worldCommerceStands.crownsVerifyConfirmed", { name: pending.tierName }),
        );
        setMsg(null);
        void loadMine();
      } else if (state === "pending") {
        setJoinNote(t("worldCommerceStands.crownsVerifyPending", { name: pending.tierName }));
      } else {
        try { localStorage.removeItem(membershipPendingKey()); } catch { /* the state below still clears */ }
        setPendingCheckout(null);
        setJoinSecret(null);
        setJoinNote(t("worldCommerceStands.crownsVerifyClosed"));
      }
    } catch {
      /* A failed CHECK claims nothing and keeps the stash — the
         seat is untouched and the walker can check again. */
      setJoinNote(t("worldCommerceStands.crownsVerifyCheckFailed"));
    } finally {
      setVerifying(false);
    }
  };
  useEffect(() => {
    void loadMine();
    // Coming back from the hosted checkout tab: your memberships
    // refresh in-world when the palace tab takes focus again —
    // and a checkout this stand opened gets VERIFIED, not just
    // refreshed past.
    const stashed = parseMembershipPending(localStorage.getItem(membershipPendingKey()));
    if (stashed) {
      setPendingCheckout(stashed);
      void verifyPending(stashed);
    }
    const onFocus = () => {
      void loadMine();
      const s = parseMembershipPending(localStorage.getItem(membershipPendingKey()));
      if (s) {
        setPendingCheckout(s);
        void verifyPending(s);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  const loadClub = async (id: string) => {
    setCreatorId(id);
    setTiers(null);
    setTiersFailed(false);
    setMsg(null);
    try {
      const res = await fetch(`/api/memberships/public/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("club");
      const data = (await res.json()) as { tiers?: MembershipTierDto[]; testMode?: boolean };
      if (!Array.isArray(data.tiers)) throw new Error("club");
      setTiers(data.tiers);
      setTestMode(data.testMode === true);
    } catch {
      setTiersFailed(true);
    }
  };

  const submitCreator = () => {
    const id = parseCreatorUserId(creatorInput);
    if (!id) {
      setMsg(t("worldCommerceStands.crownsJoinIdBad"));
      return;
    }
    void loadClub(id);
  };

  /* Joining: the trial happens right here at the stand; a paid
     join is embedded first — POST checkout asking for the embedded
     presentation, and the payment form mounts right here. Only
     when no clientSecret comes back does the join ride the §3.9
     transfer (the hosted page it returns opens in a NEW TAB).
     A free tier activates in-world with no payment page at all.
     Guests get the pitch, never a dead button: joining rides an
     account, and sign-in lives on the website by design. */
  const join = async (tier: MembershipTierDto, mode: "checkout" | "trial") => {
    if (isGuest) {
      setMsg(t("worldCommerceStands.crownsJoinGuest"));
      return;
    }
    if (mode === "checkout" && recipientInvalid) {
      setMsg(t("worldCommerceStands.crownsGiftBad"));
      return;
    }
    setBusy(tier.id + mode);
    setMsg(null);
    setJoinSecret(null);
    try {
      if (mode === "trial") {
        const res = await fetch("/api/memberships/join-trial", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ tierId: tier.id }),
        });
        const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.crownsTrialFailed")));
        setMsg(t("worldCommerceStands.crownsTrialOn"));
        void loadMine();
        return;
      }
      const gifting = recipientId !== null;
      const res = await fetch("/api/memberships/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          ...membershipCheckoutPayload(tier.id, period, recipientId),
          /* Embedded first, like the Marketplace stand above: ask
             for the in-stand presentation whenever this device can
             mount it; the hosted tab below stays the fallback. */
          uiMode: hasStripePublishableKey() ? "embedded" : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.crownsCheckoutFailed")));
      if (checkoutCompletedInWorld(data)) {
        /* A free crown activates in-world at once — for a gift,
           the seat is THEIRS, in the memberships page's own words. */
        setMsg(gifting ? t("worldCommerceStands.crownsGiftSent") : t("worldCommerceStands.crownsJoinedFree"));
        void loadMine();
        return;
      }
      const clientSecret = (data as { clientSecret?: unknown }).clientSecret;
      if (typeof clientSecret === "string" && clientSecret) {
        /* Stash the session exactly like the hosted path: the
           verify (check button, focus, reopen) confirms THIS
           payment rather than trusting the form's say-so. */
        const sessionId = (data as { sessionId?: unknown }).sessionId;
        if (typeof sessionId === "string" && sessionId) {
          const pending: MembershipPendingCheckout = { sessionId, tierName: tier.name, isGift: gifting };
          try { localStorage.setItem(membershipPendingKey(), JSON.stringify(pending)); } catch { /* no stash — the stand still says where the truth lives */ }
          setPendingCheckout(pending);
        }
        setJoinSecret(clientSecret);
        setJoinNote(gifting
          ? t("worldCommerceStands.crownsGiftCheckoutNote", { name: tier.name })
          : t("worldCommerceStands.crownsJoinCheckoutNote", { name: tier.name }));
        setMsg(null);
        return;
      }
      const url = hostedCheckoutUrl(data);
      if (url) {
        /* Stash the session before the tab opens: the verify on
           return confirms THIS payment (gift or self-join) rather
           than trusting that closing the tab meant it landed. */
        const sessionId = (data as { sessionId?: unknown }).sessionId;
        if (typeof sessionId === "string" && sessionId) {
          const pending: MembershipPendingCheckout = { sessionId, tierName: tier.name, isGift: gifting };
          try { localStorage.setItem(membershipPendingKey(), JSON.stringify(pending)); } catch { /* no stash — the stand still says where the truth lives */ }
          setPendingCheckout(pending);
          setJoinNote(null);
        }
        openCheckoutTab(url);
        setMsg(gifting
          ? t("worldCommerceStands.crownsGiftTabNote")
          : t("worldCommerceStands.crownsJoinTabNote"));
        return;
      }
      throw new Error(t("worldCommerceStands.crownsCheckoutFailed"));
    } catch (e) {
      setMsg(plainErrorText(e, t("worldCommerceStands.crownsStandError")));
    } finally {
      setBusy(null);
    }
  };

  const active = tiers ? activeMembershipTiers(tiers) : [];

  return (
    <div className="space-y-4" data-testid="world-shop-crowns">
      {/* Stack-100 #63: the creator side of this stand — members
          manage their own tiers here; guests never see the desk. */}
      {!isGuest && <CrownsCreatorDesk isLight={isLight} />}
      {!isGuest && mine && mine.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <StandTitle isLight={isLight}>{t("worldCommerceStands.crownsMineTitle")}</StandTitle>
            <button type="button" onClick={() => void loadMine()} className={`${chipBtn(isLight)} ml-auto`}>
              <RefreshCw className="h-3 w-3" /> {t("worldCommerceStands.crownsRefresh")}
            </button>
          </div>
          {mine.map((m) => (
            <div
              key={m.id}
              data-testid="world-crowns-mine-row"
              className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
            >
              <Crown className="h-4 w-4 text-[#d4af37]" />
              <span className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {m.tierName ?? t("worldCommerceStands.crownsMembershipFallback")}{m.isGift ? t("worldCommerceStands.crownsMineGifted") : ""}
              </span>
              <span className={`text-xs ${muted(isLight)}`}>
                {md(m.priceDollars)} · {m.billingPeriod}
                {m.status === "trialing" && m.trialEndsAt ? t("worldCommerceStands.crownsMineTrialEnds", { date: new Date(m.trialEndsAt).toLocaleDateString(i18n.language) }) : ""}
                {m.status !== "trialing" && m.currentPeriodEnd ? t(m.status === "expired" ? "worldCommerceStands.crownsMineEnded" : "worldCommerceStands.crownsMineRenews", { date: new Date(m.currentPeriodEnd).toLocaleDateString(i18n.language) }) : ""}
              </span>
              <span className="ml-auto rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-2.5 py-0.5 text-[11px] font-bold capitalize text-[#e8c86a]">{m.status.replace(/_/g, " ")}</span>
            </div>
          ))}
        </div>
      )}

      {!isGuest && (pendingCheckout || joinNote) && (
        <div
          data-testid="world-crowns-join-confirmation"
          className={`space-y-2 rounded-2xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/50 bg-[#fdf6dd]" : "border-[#d4af37]/30 bg-[#d4af37]/[0.07]"}`}
        >
          <p className={`flex items-start gap-2 text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#d4af37]" />
            <span>
              {joinNote ??
                (pendingCheckout
                  ? t("worldCommerceStands.crownsWaitingNote", { name: pendingCheckout.tierName, what: pendingCheckout.isGift ? t("worldCommerceStands.crownsWhatGift") : t("worldCommerceStands.crownsWhatCrown") })
                  : "")}
            </span>
          </p>
          {pendingCheckout && (
            <button
              type="button"
              data-testid="world-crowns-verify"
              onClick={() => void verifyPending(pendingCheckout)}
              disabled={verifying}
              className={chipBtn(isLight)}
            >
              {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t("worldCommerceStands.crownsCheckPayment")}
            </button>
          )}
          {joinSecret && (
            <div className="space-y-2" data-testid="world-crowns-embedded-checkout">
              <EmbeddedSessionCheckout clientSecret={joinSecret} />
              <button type="button" onClick={() => setJoinSecret(null)} className={chipBtn(isLight)}>
                {t("worldCommerceStands.crownsEmbeddedClose")}
              </button>
            </div>
          )}
        </div>
      )}

      <NativeCard isLight={isLight} title={t("worldCommerceStands.crownsJoinCardTitle")}>
        <p className={`text-xs ${muted(isLight)}`}>
          {t("worldCommerceStands.crownsJoinIntroBefore")}<span className="font-mono">/memberships?creator=…</span>{t("worldCommerceStands.crownsJoinIntroAfter")}
        </p>
        {directoryFailed ? (
          <p className={`mt-2 flex flex-wrap items-center gap-2 text-xs ${muted(isLight)}`}>
            <span>{t("worldCommerceStands.crownsDirectoryFailed")}</span>
            <button type="button" onClick={() => void loadDirectory()} className={chipBtn(isLight)}>
              <RefreshCw className="h-3 w-3" /> {t("worldCommerceStands.crownsDirectoryRetry")}
            </button>
          </p>
        ) : directory === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.crownsDirectoryLoading")} />
        ) : directory.length === 0 ? (
          <p className={`mt-2 text-xs ${muted(isLight)}`}>{t("worldCommerceStands.crownsDirectoryEmpty")}</p>
        ) : (
          <div className="mt-2 space-y-1.5" data-testid="world-crowns-directory">
            {directory.map((row) => (
              <button
                key={row.creatorUserId}
                type="button"
                data-testid="world-crowns-directory-row"
                onClick={() => void loadClub(row.creatorUserId)}
                className={`flex w-full flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-left transition hover:scale-[1.01] ${creatorId === row.creatorUserId
                  ? "border-[#d4af37] bg-[#d4af37]/10"
                  : isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
              >
                {row.avatarUrl ? (
                  <img src={row.avatarUrl} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
                ) : (
                  <Crown className="h-4 w-4 shrink-0 text-[#d4af37]" />
                )}
                <span className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  {row.displayName ?? t("worldCommerceStands.crownsCreatorClubFallback")}
                </span>
                {row.slug && <span className={`text-xs ${muted(isLight)}`}>@{row.slug}</span>}
                <span className={`ml-auto text-xs ${muted(isLight)}`}>
                  {t(row.tierCount === 1 ? "worldCommerceStands.crownsCountOne" : "worldCommerceStands.crownsCountMany", { count: row.tierCount })} · {clubStartingLabel(row, tierStrings, i18n.language)}
                  {row.hasTrial ? t("worldCommerceStands.crownsFreeTrialSuffix") : ""}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={creatorInput}
            onChange={(e) => setCreatorInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitCreator(); }}
            placeholder={t("worldCommerceStands.crownsCreatorInputLabel")}
            aria-label={t("worldCommerceStands.crownsCreatorInputLabel")}
            className={`${inputCls(isLight)} min-w-0 flex-1`}
          />
          <button type="button" onClick={submitCreator} className={goldBtn()}>
            <Crown className="h-4 w-4" /> {t("worldCommerceStands.crownsShowCrowns")}
          </button>
        </div>
        {msg && <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{msg}</p>}
      </NativeCard>

      {creatorId && (
        <div className="space-y-2">
          {tiersFailed ? (
            <NativeErrorState isLight={isLight} title={t("worldCommerceStands.crownsClubFailedTitle")} message={t("worldCommerceStands.crownsClubFailedMsg")} onRetry={() => void loadClub(creatorId)} />
          ) : tiers === null ? (
            <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.crownsClubLoading")} />
          ) : active.length === 0 ? (
            <NativeEmptyState isLight={isLight} message={t("worldCommerceStands.crownsClubEmpty")} detail={t("worldCommerceStands.crownsClubEmptyDetail")} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StandTitle isLight={isLight}>{t("worldCommerceStands.crownsOnOfferTitle")}</StandTitle>
                {testMode && (
                  <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/50">{t("worldCommerceStands.crownsTestModeChip")}</span>
                )}
                <span className="ml-auto inline-flex gap-1.5">
                  {([["monthly", t("worldCommerceStands.crownsPeriodMonthly")], ["annual", t("worldCommerceStands.crownsPeriodAnnual")]] as const).map(([p, label]) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPeriod(p)}
                      className={`${chipBtn(isLight)} ${period === p ? "border-[#d4af37] text-[#d4af37]" : ""}`}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              </div>
              {!isGuest && (
                <div className="flex flex-wrap items-center gap-2" data-testid="world-crowns-gift">
                  <Gift className="h-4 w-4 shrink-0 text-[#d4af37]" />
                  <input
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    placeholder={t("worldCommerceStands.crownsGiftPlaceholder")}
                    className={`${inputCls(isLight)} min-w-0 flex-1`}
                    aria-label={t("worldCommerceStands.crownsGiftAria")}
                  />
                  {recipientId && (
                    <span className="text-xs font-semibold text-emerald-300">{t("worldCommerceStands.crownsGiftModeNote")}</span>
                  )}
                  {recipientInvalid && (
                    <span className="text-xs font-semibold text-red-300">{t("worldCommerceStands.crownsGiftInvalid")}</span>
                  )}
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {active.map((tier) => (
                  <NativeCard key={tier.id} isLight={isLight}>
                    <p className={`flex items-center gap-2 text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                      <Crown className="h-4 w-4 shrink-0 text-[#d4af37]" /> {tier.name}
                    </p>
                    <p className="mt-1 text-sm font-black text-[#d4af37]">{tierPriceLabel(tier, period, tierStrings, i18n.language)}</p>
                    {period === "annual" && tierAnnualSavingLabel(tier, tierStrings) && (
                      <p className="text-xs font-semibold text-emerald-300">{tierAnnualSavingLabel(tier, tierStrings)}</p>
                    )}
                    {tier.description && <p className={`mt-1 line-clamp-3 text-xs ${muted(isLight)}`}>{tier.description}</p>}
                    {tier.perks.length > 0 && (
                      <ul className={`mt-2 space-y-1 text-xs ${muted(isLight)}`}>
                        {tier.perks.map((perk, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <Check className="mt-0.5 h-3 w-3 shrink-0 text-[#d4af37]" /> {perk}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-3 space-y-1.5">
                      {/* Paid joins pay right here at the stand
                          (embedded first); the ONE marked transfer
                          — the hosted checkout page in a new tab
                          (§3.9) — is only the fallback. With a gift
                          recipient named, the same buttons buy the
                          crown FOR them — the trial hides, exactly
                          as on the memberships page (a trial is a
                          seat you take yourself). */}
                      <button
                        type="button"
                        data-testid="world-crowns-join"
                        onClick={() => void join(tier, "checkout")}
                        disabled={busy === tier.id + "checkout"}
                        className={`${goldBtn(busy === tier.id + "checkout")} w-full`}
                      >
                        {busy === tier.id + "checkout" ? <Loader2 className="h-4 w-4 animate-spin" /> : recipientId ? <Gift className="h-4 w-4" /> : <Crown className="h-4 w-4" />}
                        {tier.priceCents <= 0
                          ? recipientId ? t("worldCommerceStands.crownsGiftFreeButton") : t("worldCommerceStands.crownsJoinFreeButton")
                          : recipientId ? t("worldCommerceStands.crownsGiftButton", { label: checkoutTransferLabel(t) }) : checkoutTransferLabel(t)}
                      </button>
                      {tierOffersTrial(tier) && !recipientId && (
                        <button
                          type="button"
                          data-testid="world-crowns-trial"
                          onClick={() => void join(tier, "trial")}
                          disabled={busy === tier.id + "trial"}
                          className={`${chipBtn(isLight)} w-full justify-center`}
                        >
                          {busy === tier.id + "trial" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          {t("worldCommerceStands.crownsTrialButton")}
                        </button>
                      )}
                    </div>
                  </NativeCard>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {isGuest && (
        <p className={`px-1 text-[11px] ${muted(isLight)}`}>{t("worldCommerceStands.crownsGuestFooter")}</p>
      )}
    </div>
  );
}
