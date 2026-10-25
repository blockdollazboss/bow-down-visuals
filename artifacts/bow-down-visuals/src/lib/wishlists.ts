/* ─── Wishlists client (Wave 4 #38) ─────────────────────────────────────
   Thin fetchers over /api/wishlists. The server owns the price law:
   saving records today's price; a later drop below the lowest price
   since the save sends the fan ONE in-app notification per drop.
   Removing the item stops all future alerts. */

export type WishlistItemKind = "store_product" | "shop_product";

export interface WishlistEntry {
  id: string;
  itemKind: WishlistItemKind;
  itemId: string;
  title: string;
  priceAtAddCents: number;
  lowestCents: number;
  /** Null when the product no longer exists. */
  currentPriceCents: number | null;
  available: boolean;
  link: string;
  createdAt: string;
}

type GetAccessToken = () => Promise<string | null>;

async function authInit(getAccessToken: GetAccessToken, init: RequestInit = {}): Promise<RequestInit> {
  const token = await getAccessToken();
  return {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  };
}

export async function fetchWishlist(getAccessToken: GetAccessToken): Promise<WishlistEntry[]> {
  const res = await fetch("/api/wishlists", await authInit(getAccessToken));
  if (!res.ok) throw new Error("Could not load your wishlist.");
  const data = (await res.json()) as { items?: WishlistEntry[] };
  return data.items ?? [];
}

export async function fetchWishlisted(
  getAccessToken: GetAccessToken,
  itemKind: WishlistItemKind,
  itemId: string,
): Promise<boolean> {
  const res = await fetch(
    `/api/wishlists/check?itemKind=${encodeURIComponent(itemKind)}&itemId=${encodeURIComponent(itemId)}`,
    await authInit(getAccessToken),
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { wishlisted?: boolean };
  return data.wishlisted === true;
}

export async function addToWishlist(
  getAccessToken: GetAccessToken,
  itemKind: WishlistItemKind,
  itemId: string,
): Promise<boolean> {
  const res = await fetch("/api/wishlists", await authInit(getAccessToken, {
    method: "POST",
    body: JSON.stringify({ itemKind, itemId }),
  }));
  return res.ok;
}

export async function removeFromWishlist(
  getAccessToken: GetAccessToken,
  itemKind: WishlistItemKind,
  itemId: string,
): Promise<boolean> {
  const res = await fetch(`/api/wishlists/${itemKind}/${itemId}`, await authInit(getAccessToken, {
    method: "DELETE",
  }));
  if (!res.ok) return false;
  const data = (await res.json().catch(() => null)) as { removed?: boolean } | null;
  return data?.removed === true;
}

export function wishlistMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
