/**
 * ShopStands (MarketplaceStand, StandManager, BrandingShopStand,
 * CrownsCreatorDesk, CrownsStand) — honest load states (Stack-400
 * C-28 components residual, deep-pins tranche 2). Every list
 * family in this 3,900-line file rides the null-state machine:
 * null = not yet loaded (loading renders), a failed flag renders
 * the NativeErrorState with a retry wired to the real loader, and
 * the empty state is reachable only after a successful empty load.
 *
 * - MARKETPLACE DIRECTORY: shops stays null until an ok response;
 *   failure sets shopsFailed and the square renders its error
 *   state with a tick retry; success records + clears the flag.
 * - THE STAND ITSELF (openStand): an explicit
 *   idle/loading/ready/failed machine — the products shelf and
 *   its empty line render only behind "ready", and a payload
 *   without a shop is treated as failure, not as an empty stand.
 * - MY SHOPS is a fail-closed ownership probe: null (unloaded OR
 *   failed) renders no management at all.
 * - BRANDING ORDERS: orders null = loading, ordersFailed first,
 *   empty after — the same machine as the 2D shop's.
 * - CROWNS CREATOR DESK: tiers and roster each carry their own
 *   failed flag + error state + retry; the dashboard strip is a
 *   documented additive read (its failure leaves the strip out —
 *   the tiers are the desk).
 * - CROWNS STAND: the club directory has its failed line + retry;
 *   "my memberships" is additive and null-gated — the section
 *   exists only when a load actually landed with rows.
 *
 * The manager's writes are pinned too: a product save applies
 * the SERVER's returned row (never the form's guess) and any
 * failure keeps the form open and the shelf untouched; a delete
 * removes the row only after the server confirms.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const stands = read("./ShopStands.tsx");

describe("the marketplace directory: null is loading, failure is its own state", () => {
  it("shops record only on ok; failure sets the flag; success clears it", () => {
    expect(stands).toContain('const res = await fetch("/api/storefronts?limit=60");');
    expect(stands).toContain('if (!res.ok) throw new Error("shops");');
    expect(stands).toContain("setShops(Array.isArray(data.shops) ? data.shops : []);");
    expect(stands).toContain("setShopsFailed(false);");
    expect(stands).toContain("if (!cancelled) setShopsFailed(true);");
  });

  it("the square renders the error state with a tick retry before any empty", () => {
    expect(stands).toContain("{shopsFailed ? (");
    expect(stands).toContain('title={t("worldCommerceStands.shopSquareFailedTitle")}');
    expect(stands).toContain("onRetry={() => setTick((n) => n + 1)}");
  });
});

describe("the stand itself rides an explicit four-state machine", () => {
  it("openStand loads, and a shop-less payload is failure, not an empty stand", () => {
    expect(stands).toContain('useState<"idle" | "loading" | "ready" | "failed">("idle")');
    expect(stands).toContain('if (!data.shop) throw new Error("stand");');
    expect(stands).toContain('setStandState("ready");');
    expect(stands).toContain('setStandState("failed");');
  });

  it("the shelf and its empty line render only behind ready", () => {
    expect(stands).toContain('{standState === "failed" && (');
    expect(stands).toContain('{standState === "ready" && products.length === 0 && (');
    expect(stands).toContain('{standState === "ready" && products.length > 0 && (');
  });
});

describe("my shops: the ownership probe fails closed", () => {
  it("a failed read leaves ownership unproven and no management renders", () => {
    expect(stands).toContain('if (!res.ok) throw new Error("mine");');
    expect(stands).toContain("fail closed — mineShops stays null, the stand stays a buyer's stand");
    expect(stands).toContain("const [mineShops, setMineShops] = useState<MineShopDto[] | null>(null);");
  });
});

describe("branding orders: the null-state machine, same as the 2D shop", () => {
  it("a non-ok read throws into ordersFailed; success records + clears it", () => {
    expect(stands).toContain('if (!res.ok) throw new Error("orders");');
    expect(stands).toContain("setOrders(Array.isArray(data.orders) ? data.orders : []);");
    expect(stands).toContain("setOrdersFailed(false);");
    expect(stands).toContain("setOrdersFailed(true);");
  });

  it("render order: failed, loading (null), genuine empty, list", () => {
    const failIdx = stands.indexOf("{ordersFailed ? (");
    const loadIdx = stands.indexOf(") : orders === null ? (");
    const emptyIdx = stands.indexOf(") : orders.length === 0 ? (");
    expect(failIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(failIdx);
    expect(emptyIdx).toBeGreaterThan(loadIdx);
    expect(stands).toContain("onRetry={() => void loadOrders()}");
  });
});

describe("the crowns creator desk: tiers and roster fail separately and honestly", () => {
  it("tiers record only from a parseable ok payload; failure sets ownFailed", () => {
    expect(stands).toContain('if (!res.ok) throw new Error("tiers");');
    expect(stands).toContain("if (!parsed) throw new Error(\"tiers\");");
    expect(stands).toContain("setOwnFailed(false);");
    expect(stands).toContain("setOwnFailed(true);");
    expect(stands).toContain('title={t("worldCommerceStands.crownsTiersFailedTitle")}');
    expect(stands).toContain("onRetry={() => void loadOwn()}");
  });

  it("the roster mirrors it with rosterFailed", () => {
    expect(stands).toContain('if (!res.ok) throw new Error("roster");');
    expect(stands).toContain("setRosterFailed(false);");
    expect(stands).toContain("setRosterFailed(true);");
    expect(stands).toContain("{rosterFailed ? (");
  });

  it("the dashboard strip is additive by design — its failure leaves it out", () => {
    expect(stands).toContain("/* the dashboard strip is additive — tiers are the desk */");
  });
});

describe("the crowns stand: directory failure is a line + retry; mine is additive", () => {
  it("the directory records only from a parseable ok payload", () => {
    expect(stands).toContain('if (!res.ok) throw new Error("directory");');
    expect(stands).toContain("setDirectoryFailed(false);");
    expect(stands).toContain("setDirectoryFailed(true);");
    expect(stands).toContain("{directoryFailed ? (");
    expect(stands).toContain("onClick={() => void loadDirectory()}");
  });

  it("my memberships render only when a load landed with rows", () => {
    expect(stands).toContain("const [mine, setMine] = useState<MyMembershipDto[] | null>(null);");
    expect(stands).toContain("{!isGuest && mine && mine.length > 0 && (");
    expect(stands).toContain("/* the fan section is additive — a quiet stand is fine */");
  });
});

describe("the manager's writes apply server truth only — unchanged", () => {
  it("a product save applies the server's returned row, never the form's guess", () => {
    expect(stands).toContain("const saved = savedProductDto(data);");
    expect(stands).toContain("if (!saved) throw new Error(t(\"worldCommerceStands.shopProductSaveEmpty\"));");
    expect(stands).toContain("setProducts((ps) => applyProductSave(ps, saved, editingProduct ? editingProduct.id : null));");
    expect(stands).toContain("keeps the form open and the shelf untouched");
  });

  it("a product delete removes the row only after the server confirms", () => {
    expect(stands).toContain("The row\n     leaves the shelf only after the server confirms; a failure\n     reports and the row stays.");
    expect(stands).toContain('if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.shopProductDeleteFailed"));');
  });
});
