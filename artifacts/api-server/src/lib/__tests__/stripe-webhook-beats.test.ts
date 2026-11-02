/**
 * stripe-webhook-beats.test.ts — WEBHOOK-SETTLE (stack1200).
 *
 * Beat licenses were in the Gate #5 tip defect CLASS: checkout
 * sessions stamp purchase_kind "beat_license", and the webhook
 * dispatch had NO branch for them — /beats/licenses/verify was
 * documented as "the ONLY path to 'completed'". A producer who
 * closed the tab after paying kept a pending_payment license
 * forever: money taken, no download, no stems.
 *
 * This suite drives the REAL webhook handler with a fabricated
 * (signature-bypassed via the mocked client) beat-license event
 * and pins:
 *   - a paid license session completes the license exactly once,
 *     with NO verify call;
 *   - a replayed delivery does not re-complete (the settle reads
 *     the completed license back as a duplicate);
 *   - an unpaid session completes nothing;
 *   - a paid session whose beat is gone completes nothing and
 *     answers 200 (the settle's own auto-refund path).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const PRODUCER_ID = "99999999-9999-4999-8999-999999999999";
const BUYER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BEAT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LICENSE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION_ID = "cs_beat_webhook_1";

const h = vi.hoisted(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
  return {
    beats: [] as Array<Record<string, any>>,
    licenses: [] as Array<Record<string, any>>,
    event: null as any,
    refunds: [] as Array<unknown>,
    claims: new Set<string>(),
    tells: [] as Array<Record<string, any>>,
  };
});

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
  addCreditsAtomic: vi.fn(async () => 0),
}));

vi.mock("../stripe-client", () => ({
  createGuardedStripeClient: vi.fn(() => ({
    webhooks: { constructEvent: () => h.event },
  })),
  buildCheckoutSessionIdempotencyKey: vi.fn(() => "beats-key"),
  buildPaymentIntentIdempotencyKey: vi.fn(() => "pi-key"),
}));

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async () => false),
}));

vi.mock("../rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  generationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = BUYER_ID;
    next();
  },
}));

vi.mock("../credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "gpt-test"),
}));

vi.mock("../mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async () => null),
}));

vi.mock("../objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (u: string) => u),
  isStorageRef: (u: string) => typeof u === "string" && (u.startsWith("r2://") || u.startsWith("supabase://")),
}));

vi.mock("../embedded-checkout", () => ({
  isEmbeddedCheckoutEnabled: vi.fn(() => false),
}));

vi.mock("../stripe-checkout", () => ({
  createPaymentCheckout: vi.fn(async () => ({ sessionId: "cs_unused", url: "https://checkout.example.com/pay" })),
  retrieveCheckoutSession: vi.fn(async () => {
    throw new Error("webhook settle never retrieves the session");
  }),
  refundCheckoutSessionPayment: vi.fn(async (session: unknown) => {
    h.refunds.push(session);
    return true;
  }),
  checkoutBaseUrl: () => "https://example.com",
  isCheckoutTestMode: () => true,
}));

/* The producer-tell door (BEATS-SETTLE): the claim is modelled with
   its real contract — createJobNotification resolves true only for
   the (jobType, jobId) claim winner and false for every twin — and
   the door itself is a recording spy. Spread-actual keeps every
   other export the module graph imports from these modules. */
vi.mock("../job-notifications", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createJobNotification: vi.fn(async (input: { jobType: string; jobId: string }) => {
      const key = `${input.jobType}:${input.jobId}`;
      if (h.claims.has(key)) return false;
      h.claims.add(key);
      return true;
    }),
  };
});

vi.mock("../push-events", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    notifyUserEvent: vi.fn(async (input: Record<string, any>) => {
      h.tells.push(input);
      return { delivered: true };
    }),
  };
});

/* The settle path reads/writes beats + beat_licenses through the
   drizzle builder. The fake matches rows by rendering the
   condition's "col" = $n equality pairs (the beats-payments /
   membership harnesses' pattern) so the status-guarded completion
   flip behaves exactly like the real conditional UPDATE. */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { beatsTable, beatLicensesTable } = actual;
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();

  function storeFor(table: unknown): Array<Record<string, any>> {
    if (table === beatsTable) return h.beats;
    if (table === beatLicensesTable) return h.licenses;
    return [];
  }

  function matchRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    const rows = storeFor(table);
    if (!cond) return [...rows];
    const q = dialect.sqlToQuery(cond as never);
    const pairs: Array<[string, unknown]> = [];
    const re = /"(\w+)"\s*=\s*\$(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(q.sql)) !== null) pairs.push([m[1]!, q.params[Number(m[2]) - 1]]);
    if (pairs.length === 0) return [...rows];
    return rows.filter((r) => pairs.every(([col, val]) => r[col] === val));
  }

  function selectChain(table: unknown) {
    let cond: unknown;
    const chain: any = {
      where: (c: unknown) => {
        cond = c;
        return chain;
      },
      orderBy: (..._a: unknown[]) => chain,
      limit: async (n: number) => matchRows(table, cond).slice(0, n).map((r) => ({ ...r })),
      then: (resolve: (v: unknown) => void) => resolve(matchRows(table, cond).map((r) => ({ ...r }))),
    };
    return chain;
  }

  const fakeDb: any = {
    select: (_proj?: unknown) => ({ from: (table: unknown) => selectChain(table) }),
    insert: (table: unknown) => ({
      values: (v: Record<string, any>) => ({
        returning: async () => {
          const row = { id: randomUUID(), created_at: new Date(), updated_at: new Date(), ...v };
          storeFor(table).push(row);
          return [{ ...row }];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (v: Record<string, any>) => ({
        where: (cond: unknown) => {
          let done: Array<Record<string, any>> | null = null;
          const apply = () => {
            if (done) return done;
            done = matchRows(table, cond);
            for (const r of done) Object.assign(r, v);
            return done;
          };
          return {
            returning: async () => apply().map((r) => ({ ...r })),
            then: (resolve: (v: unknown) => void) => resolve(apply()),
          };
        },
      }),
    }),
    execute: async () => ({ rows: [] }),
  };
  return { ...actual, db: fakeDb };
});

import { stripeWebhookHandler } from "../stripe-webhook";

function seed() {
  h.beats = [
    {
      id: BEAT_ID,
      user_id: PRODUCER_ID,
      title: "Midnight Loops",
      audio_url: "https://cdn.example.com/full.mp3",
      audio_path: null,
      preview_url: "https://cdn.example.com/preview.mp3",
      stems_url: null,
      stems_path: null,
      exclusive_sold: false,
      created_at: new Date(),
      updated_at: new Date(),
    },
  ];
  h.licenses = [
    {
      id: LICENSE_ID,
      beat_id: BEAT_ID,
      buyer_id: BUYER_ID,
      producer_id: PRODUCER_ID,
      tier: "premium",
      price_cents: 3000,
      commission_cents: 450,
      status: "pending_payment",
      stripe_session_id: SESSION_ID,
      terms_snapshot: {
        name: "Premium",
        format: "wav_mp3",
        streamsCap: 100_000,
        salesCap: null,
        musicVideosCap: 1,
        radioTvAllowed: false,
        livePerformancesCap: null,
        termYears: null,
        territory: "Worldwide",
        creditLine: null,
        termsNote: null,
        isExclusive: false,
      },
      created_at: new Date(),
      updated_at: new Date(),
    },
  ];
  h.refunds = [];
}

function beatEvent(paymentStatus: string, beatId = BEAT_ID, licenseId = LICENSE_ID) {
  return {
    id: "evt_beat_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: SESSION_ID,
        payment_status: paymentStatus,
        amount_total: 3000,
        currency: "usd",
        payment_intent: "pi_beat_1",
        metadata: {
          purchase_kind: "beat_license",
          license_id: licenseId,
          buyer_user_id: BUYER_ID,
          beat_id: beatId,
        },
      },
    },
  };
}

async function deliver(event: unknown) {
  h.event = event;
  const res: any = { statusCode: 0, body: null as any };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  const req: any = {
    headers: { "stripe-signature": "sig_test" },
    body: Buffer.from("payload"),
  };
  await stripeWebhookHandler(req, res);
  return res;
}

beforeEach(() => {
  seed();
  h.event = null;
  h.claims = new Set();
  h.tells = [];
});

describe("stripe webhook — beat license settle (WEBHOOK-SETTLE)", () => {
  it("a paid beat-license session completes the license with no verify call", async () => {
    const res = await deliver(beatEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "beat_license" });
    expect(h.licenses).toHaveLength(1);
    expect(h.licenses[0]).toMatchObject({ id: LICENSE_ID, status: "completed" });
  });

  it("a replayed delivery leaves the completed license completed exactly once", async () => {
    await deliver(beatEvent("paid"));
    const res = await deliver(beatEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(h.licenses).toHaveLength(1);
    expect(h.licenses[0]?.status).toBe("completed");
  });

  it("an unpaid beat-license session completes nothing", async () => {
    const res = await deliver(beatEvent("unpaid"));
    expect(res.statusCode).toBe(200);
    expect(h.licenses[0]?.status).toBe("pending_payment");
  });

  it("a paid session whose beat is gone completes nothing and answers 200 (settle auto-refunds)", async () => {
    h.beats = [];
    const res = await deliver(beatEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(h.licenses[0]?.status).toBe("pending_payment");
    expect(h.refunds).toHaveLength(1);
  });
});

describe("stripe webhook — beat license producer tell (BEATS-SETTLE)", () => {
  /* The notify-census lane (sibling branch stack1200/notify-census,
     fix #5) wired the producer tell into ITS verify-local completion;
     its finding #4 said beats has no webhook settle. On THIS lineage
     the settle exists (WEBHOOK-SETTLE da87f4240) but the tell exists
     nowhere — neither door told the producer. The tell therefore
     belongs in the shared settle, at the completion-flip win, so a
     closed-tab sale tells exactly like a returned-browser sale.
     Net on the seed: $30.00 price − $4.50 commission = $25.50. */
  it("a closed-tab paid settle tells the producer exactly once, naming the true net", async () => {
    const res = await deliver(beatEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(h.licenses[0]?.status).toBe("completed");
    expect(h.tells).toHaveLength(1);
    expect(h.tells[0]).toMatchObject({
      userId: PRODUCER_ID,
      category: "money",
      kind: "beat_sale",
      title: "Your beat just sold 👑",
      link: "/beats",
    });
    expect(h.tells[0]?.body).toContain("Midnight Loops (premium)");
    expect(h.tells[0]?.body).toContain("net $25.50");
    expect(h.claims.has("sale:beat-license:" + LICENSE_ID)).toBe(true);
  });

  it("a replayed delivery does not tell twice", async () => {
    await deliver(beatEvent("paid"));
    await deliver(beatEvent("paid"));
    expect(h.licenses[0]?.status).toBe("completed");
    expect(h.tells).toHaveLength(1);
  });

  it("the verify door after a webhook settle does not tell twice", async () => {
    await deliver(beatEvent("paid"));
    expect(h.tells).toHaveLength(1);
    const { settleBeatLicenseSession } = await import("../../routes/generate/beats");
    const session: any = {
      id: SESSION_ID,
      payment_status: "paid",
      amount_total: 3000,
      metadata: {
        purchase_kind: "beat_license",
        license_id: LICENSE_ID,
        buyer_user_id: BUYER_ID,
        beat_id: BEAT_ID,
      },
    };
    const result = await settleBeatLicenseSession(session, { buyerUserId: BUYER_ID });
    expect(result.httpStatus).toBe(200);
    expect(result.body).toMatchObject({ success: true, duplicate: true });
    expect(h.tells).toHaveLength(1);
  });

  it("an unpaid session tells nothing", async () => {
    await deliver(beatEvent("unpaid"));
    expect(h.licenses[0]?.status).toBe("pending_payment");
    expect(h.tells).toHaveLength(0);
  });

  it("a paid session whose beat is gone tells nothing (the auto-refund stands instead)", async () => {
    h.beats = [];
    await deliver(beatEvent("paid"));
    expect(h.refunds).toHaveLength(1);
    expect(h.tells).toHaveLength(0);
  });
});
