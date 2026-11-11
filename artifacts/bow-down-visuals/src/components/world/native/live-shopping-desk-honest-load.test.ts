/**
 * LiveShoppingDesk (the World live-shopping desk) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 2).
 *
 * - THE THREE SOURCES settle INDEPENDENTLY (Promise.allSettled,
 *   like the 2D page's per-source load states): catalog,
 *   streams, and dashboard each record only from a fulfilled
 *   leg, and a fulfilled leg required an ok response (non-ok
 *   throws inside the leg). One source's failure can neither
 *   take down the landed sources nor dress up as their data.
 * - THE DESK'S FAILED FLAG keys to the CORE source by design
 *   (written on the code): the desk has failed only when the
 *   catalog couldn't load — products are the desk; streams and
 *   dashboard degrade independently.
 * - THE ALERTS POLL is documented best-effort: records only on
 *   ok, a miss waits for the next 4-second tick — it never
 *   zeroes the feed it already proved.
 * - CHECKOUT VERIFICATION reads server truth (the file's own
 *   header rule): paid lands the confirmation, unpaid stays an
 *   honest pending — the desk never calls a sale final from
 *   its own hope.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./LiveShoppingDesk.tsx");

const loadAll = desk.slice(desk.indexOf("const loadAll = useCallback(async () => {"), desk.indexOf("useEffect(() => { void loadAll(); }, [loadAll]);"));

describe("the three sources settle independently; each records only on proof", () => {
  it("every leg throws on non-ok before normalizing", () => {
    expect(loadAll).toContain("await Promise.allSettled([");
    expect(loadAll).toContain('if (!r.ok) throw new Error("catalog");');
    expect(loadAll).toContain('if (!r.ok) throw new Error("streams");');
    expect(loadAll).toContain('if (!r.ok) throw new Error("dashboard");');
  });

  it("each source records only from its fulfilled leg", () => {
    expect(loadAll).toContain('if (catalogRes.status === "fulfilled") {');
    expect(loadAll).toContain('if (streamsRes.status === "fulfilled") setStreams(streamsRes.value);');
    expect(loadAll).toContain('if (dashboardRes.status === "fulfilled") setDashboard(dashboardRes.value);');
  });

  it("the desk's failed flag keys to the catalog — the core source, by design", () => {
    expect(loadAll).toContain('setFailed(catalogRes.status === "rejected");');
    expect(loadAll).toContain("The desk has failed only when its core source — the catalog —");
  });
});

describe("the alerts poll and the verify read server truth", () => {
  it("alerts record only on ok; a miss waits for the next tick", () => {
    expect(desk).toContain("if (!res.ok) return;");
    expect(desk).toContain("setAlerts(normalizeLiveShopAlerts(await res.json()");
    expect(desk).toContain("/* overlay polling is best-effort — the next tick retries */");
  });

  it("verify is the in-World confirmation from server truth, not the only path", () => {
    expect(desk).toContain("Verify a pending checkout from server truth (ShopStands'");
  });
});
