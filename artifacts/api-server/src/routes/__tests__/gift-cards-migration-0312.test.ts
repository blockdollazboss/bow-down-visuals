/**
 * gift-cards-migration-0312 — the gift-card reconcile migration, proven
 * against pg-mem with the REAL lib functions (lib/gift-cards.ts) and
 * the REAL shipped migration files (0215 + 0312 read from disk).
 *
 * The defect (join-prep census, Nov 2 2026): 0215_gift_cards.sql created
 * the three gift tables in their original shape; the feature was later
 * rebuilt on the session shape the drizzle schema declares, but the
 * reconcile migration was held for join-time numbering and never
 * landed. On any migration-built database every gift WRITE path fails:
 *   - issueGiftCard INSERTs product_id + stripe_session_id and
 *     arbitrates ON CONFLICT (stripe_session_id) — none exist (42703);
 *   - its ledger INSERT names gift_card_id / kind / idempotency_key
 *     (0215: card_id / entry_type, both NOT NULL with no default, and
 *     no idempotency arbiter);
 *   - reserveGiftCard writes gift_card_id, status 'reserved', rails
 *     'shops' / 'digital-store', and redeem/release set updated_at —
 *     0215 has none of those shapes (and its CHECKs forbid the values);
 *   - clawbackUnspentBalance writes status 'refunded' — 0215's status
 *     CHECK forbids it.
 * The fail-closed plumbing converts the throws to GiftCardsUnavailable
 * → 503 on every gift endpoint: the rails are dark, exactly as the
 * World gift surfaces reported. Suite 1 reproduces the failure on
 * 0215 alone; Suite 2 applies the shipped 0312 and runs the whole lib
 * lifecycle (issue → replay → reserve → redeem → release → clawback)
 * plus legacy-row survival.
 *
 * Harness honesty notes:
 *   - 0215's plpgsql DO block (the store_products kind widening) cannot
 *     run in pg-mem (no plpgsql); it is replaced by its direct DDL
 *     effect, the same documented substitution the api-keys repair
 *     suite uses. Every other 0215 statement, and 0312 in full, runs
 *     verbatim from the shipped files.
 *   - pg-mem returns the would-be row for an ON CONFLICT DO NOTHING
 *     replay instead of zero rows (documented in the sponsors arbiter
 *     suite); exactly-once is therefore asserted on TABLE state (one
 *     card per session, one ledger row per key), which pg-mem models
 *     faithfully — the duplicate inserts never land. (The lib's
 *     `duplicate` flag follows the RETURNING length, so a pg-mem replay
 *     reports duplicate=false; on real Postgres the same replay
 *     returns zero rows and duplicate=true.)
 *   - Rows written BEFORE an ADD COLUMN read back through drizzle
 *     without the new keys (undefined) in pg-mem; real Postgres
 *     returns NULL. Legacy-row assertions read through mem directly,
 *     where the NULLs materialize.
 *   - gen_random_uuid is registered impure: pg-mem memoizes a plain
 *     shim's result and generated ids would collide on the PK.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const testState = vi.hoisted(() => ({ db: null as any, mem: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return testState.db;
    },
  };
});

import {
  issueGiftCard,
  reserveGiftCard,
  redeemReservation,
  releaseReservation,
  clawbackUnspentBalance,
  findCardById,
  generateGiftCardCode,
} from "../../lib/gift-cards";
import { createTestDb } from "../../lib/__tests__/test-db";

const mig = (f: string) =>
  readFileSync(resolve(__dirname, "../../../../../lib/db/migrations", f), "utf8");

const SQL_0215 = mig("0215_gift_cards.sql").replace(
  /DO \$\$ BEGIN[\s\S]*?END \$\$;/,
  `ALTER TABLE store_products DROP CONSTRAINT IF EXISTS store_products_kind_check;
   ALTER TABLE store_products ADD CONSTRAINT store_products_kind_check
     CHECK (kind IN ('download','merch','digital','service','ticket','course','gift_card'));`,
);
const SQL_0312 = mig("0312_gift_cards_session_columns.sql");

/* Prerequisites standing in for the earlier migrations (0085 creator
   profiles; the storefront migrations' products/orders). */
const PREREQ_DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY);
CREATE TABLE store_products (
  id uuid PRIMARY KEY,
  kind text NOT NULL DEFAULT 'download',
  CONSTRAINT store_products_kind_check CHECK (kind IN ('download','merch','digital','service','ticket','course'))
);
CREATE TABLE store_orders (id uuid PRIMARY KEY);
`;

const PROFILE = randomUUID();
const PRODUCT = randomUUID();
const BUYER = randomUUID();
const SESSION = "cs_test_giftcard_0312";

function setup0215() {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: "uuid" as never,
    implementation: () => randomUUID(),
    impure: true,
  } as never);
  mem.public.none(PREREQ_DDL);
  mem.public.none(SQL_0215);
  mem.public.none(`INSERT INTO creator_profiles (id) VALUES ('${PROFILE}');`);
  mem.public.none(`INSERT INTO store_products (id) VALUES ('${PRODUCT}');`);
  testState.db = db;
  testState.mem = mem;
  return mem;
}

function apply0312(mem: any) {
  mem.public.none(SQL_0312);
}

function issueArgs(session = SESSION) {
  return {
    code: generateGiftCardCode(),
    profileId: PROFILE,
    productId: PRODUCT as string | null,
    buyerUserId: BUYER,
    recipientEmail: "rcpt@example.com",
    recipientName: "Rcpt",
    message: null,
    amountCents: 2500,
    stripeSessionId: session,
  };
}

beforeEach(() => {
  testState.db = null;
  testState.mem = null;
});

describe("0215 alone — the live defect", () => {
  it("the shipped 0215 substitute still lacks the session shape", () => {
    expect(SQL_0215).not.toContain("DO $$");
    const mem = setup0215();
    const cols = mem.public
      .many(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'gift_cards'`,
      )
      .map((r: any) => r.column_name);
    expect(cols).not.toContain("product_id");
    expect(cols).not.toContain("stripe_session_id");
  });

  it("issueGiftCard's exact INSERT throws on the missing columns", () => {
    const mem = setup0215();
    expect(() =>
      mem.public.none(`
        INSERT INTO gift_cards
          (code_hash, code_last4, profile_id, product_id, buyer_user_id,
           recipient_email, recipient_name, message, initial_cents, balance_cents,
           reserved_cents, status, stripe_session_id)
        VALUES ('h', '4242', '${PROFILE}', '${PRODUCT}', '${BUYER}',
                'rcpt@example.com', 'Rcpt', NULL, 2500, 2500, 0, 'active', '${SESSION}')
        ON CONFLICT (stripe_session_id) DO NOTHING
        RETURNING *`),
    ).toThrow(/product_id/);
  });

  it("the real issueGiftCard fails closed and writes nothing", async () => {
    const mem = setup0215();
    let err: any = null;
    try {
      await issueGiftCard(issueArgs());
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    /* Real Postgres dresses this as 42703 → GiftCardsUnavailable;
       pg-mem's dressing differs, so pin the defect itself: the throw
       is the missing product_id column (or its converted form). */
    expect(
      err.name === "GiftCardsUnavailable" || /product_id/.test(String(err.message ?? err)),
    ).toBe(true);
    const cards = mem.public.many(`SELECT id FROM gift_cards`);
    expect(cards).toHaveLength(0);
  });
});

describe("0215 + 0312 — the reconcile", () => {
  it("0312's shipped file is 22 idempotent statements, no transaction control", () => {
    const stmts = SQL_0312.split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(stmts).toHaveLength(22);
    for (const s of stmts) {
      expect(s).not.toMatch(/\bBEGIN\b|\bCOMMIT\b|CONCURRENTLY/i);
    }
    expect(SQL_0312).toContain("gift_cards_session_ux");
    expect(SQL_0312).toContain("gift_card_ledger_idem_ux");
  });

  it("issueGiftCard lands: card + exactly one ledger issue row; replay is a duplicate", async () => {
    const mem = setup0215();
    apply0312(mem);
    const first = await issueGiftCard(issueArgs());
    expect(first.duplicate).toBe(false);
    expect(first.card.product_id).toBe(PRODUCT);
    expect(first.card.stripe_session_id).toBe(SESSION);
    expect(Number(first.card.balance_cents)).toBe(2500);

    /* Replay: on real Postgres this returns duplicate=true with the
       original card (see header note); pg-mem makes the lib see the
       would-be row, so the pin here is the table state — the money
       truth in every engine. */
    await issueGiftCard(issueArgs());

    const cards = mem.public.many(
      `SELECT id FROM gift_cards WHERE stripe_session_id = '${SESSION}'`,
    );
    expect(cards).toHaveLength(1);
    const ledger = mem.public.many(
      `SELECT kind, idempotency_key FROM gift_card_ledger WHERE gift_card_id = '${first.card.id}'`,
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0].kind).toBe("issue");
    expect(ledger[0].idempotency_key).toBe(`issue:${SESSION}`);
  });

  it("the full tender lifecycle runs: reserve (shops rail) → redeem → release → clawback", async () => {
    const mem = setup0215();
    apply0312(mem);
    const { card } = await issueGiftCard(issueArgs());

    const hold = await reserveGiftCard({
      cardId: String(card.id),
      rail: "shops",
      ref: "grp-0312",
      amountCents: 500,
    });
    expect(hold).toBeTruthy();
    expect(hold!.status).toBe("reserved");
    let now = await findCardById(String(card.id));
    expect(Number(now!.reserved_cents)).toBe(500);

    const redeemed = await redeemReservation({
      reservationId: String(hold!.id),
      ref: "grp-0312",
    });
    expect(redeemed).toEqual({ redeemedCents: 500, balanceAfterCents: 2000 });
    const redeemedReplay = await redeemReservation({
      reservationId: String(hold!.id),
      ref: "grp-0312",
    });
    expect(redeemedReplay).toEqual({ redeemedCents: 500, balanceAfterCents: 2000 });

    const hold2 = await reserveGiftCard({
      cardId: String(card.id),
      rail: "digital-store",
      ref: "order-0312",
      amountCents: 300,
    });
    expect(hold2).toBeTruthy();
    await releaseReservation(String(hold2!.id));
    now = await findCardById(String(card.id));
    expect(Number(now!.reserved_cents)).toBe(0);
    expect(Number(now!.balance_cents)).toBe(2000);

    const claw = await clawbackUnspentBalance(String(card.id));
    expect(claw).toEqual({ refundedCents: 2000, duplicate: false });
    now = await findCardById(String(card.id));
    expect(now!.status).toBe("refunded");
    expect(Number(now!.balance_cents)).toBe(0);
    const clawReplay = await clawbackUnspentBalance(String(card.id));
    expect(clawReplay).toEqual({ refundedCents: 0, duplicate: true });

    const kinds = mem.public
      .many(
        `SELECT kind FROM gift_card_ledger WHERE gift_card_id = '${card.id}' ORDER BY created_at, kind`,
      )
      .map((r: any) => r.kind)
      .sort();
    expect(kinds).toEqual(["issue", "redeem", "refund_clawback"]);
  });

  it("0312 is idempotent: a second application changes nothing", async () => {
    const mem = setup0215();
    apply0312(mem);
    apply0312(mem);
    const { card, duplicate } = await issueGiftCard(issueArgs());
    expect(duplicate).toBe(false);
    expect(card.stripe_session_id).toBe(SESSION);
  });

  it("0215-era rows survive: legacy card/ledger/reservation intact and backfilled", async () => {
    const mem = setup0215();
    const legacyCard = randomUUID();
    mem.public.none(`
      INSERT INTO gift_cards (id, profile_id, code_hash, code_last4, initial_cents, balance_cents, currency, status, recipient_email, source_session_id)
      VALUES ('${legacyCard}', '${PROFILE}', 'legacyhash', '9999', 1000, 1000, 'usd', 'active', 'old@example.com', 'cs_legacy_1');
      INSERT INTO gift_card_ledger (card_id, entry_type, amount_cents, balance_after_cents, ref)
      VALUES ('${legacyCard}', 'issue', 1000, 1000, 'cs_legacy_1');
      INSERT INTO gift_card_ledger (card_id, entry_type, amount_cents, balance_after_cents, ref)
      VALUES ('${legacyCard}', 'reserve', 200, 1000, 'res-old');
      INSERT INTO gift_card_reservations (card_id, rail, ref, amount_cents, status, expires_at)
      VALUES ('${legacyCard}', 'storefront', 'old-ref', 200, 'active', now() + interval '30 minutes');
    `);
    apply0312(mem);

    const card = await findCardById(legacyCard);
    expect(card).toBeTruthy();
    const legacyRow = mem.public.many(
      `SELECT stripe_session_id, product_id FROM gift_cards WHERE id = '${legacyCard}'`,
    )[0];
    expect(legacyRow.stripe_session_id).toBeNull();
    expect(legacyRow.product_id).toBeNull();

    const ledger = mem.public.many(
      `SELECT gift_card_id, kind, entry_type FROM gift_card_ledger ORDER BY entry_type`,
    );
    expect(ledger).toHaveLength(2);
    for (const row of ledger) expect(row.gift_card_id).toBe(legacyCard);
    expect(ledger.find((r: any) => r.entry_type === "issue")!.kind).toBe("issue");
    /* Legacy-only kinds keep kind NULL — their truth stays in entry_type. */
    expect(ledger.find((r: any) => r.entry_type === "reserve")!.kind).toBeNull();

    const res = mem.public.many(
      `SELECT gift_card_id, updated_at FROM gift_card_reservations WHERE ref = 'old-ref'`,
    );
    expect(res).toHaveLength(1);
    expect(res[0].gift_card_id).toBe(legacyCard);
    expect(res[0].updated_at).toBeTruthy();

    /* …and new issuance works alongside the legacy rows. */
    const { duplicate } = await issueGiftCard(issueArgs());
    expect(duplicate).toBe(false);
  });

  it("the premise still holds in the lib source (drift pin)", () => {
    const lib = readFileSync(
      resolve(__dirname, "../../lib/gift-cards.ts"),
      "utf8",
    );
    expect(lib).toContain("ON CONFLICT (stripe_session_id) DO NOTHING");
    expect(lib).toContain("ON CONFLICT (idempotency_key) DO NOTHING");
    expect(lib).toContain("product_id, buyer_user_id");
  });
});
