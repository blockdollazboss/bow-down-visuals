/**
 * admin-unrestricted.test.ts — stack900 Lane B5 (owner directive,
 * Oct 29, 2026: "My account shouldn't have restrictions like
 * customers").
 *
 * Pins, per exempted surface:
 *  - the ONE admin predicate (lib/admin) is the existing fail-closed
 *    ADMIN_EMAILS rule: unset/empty env → NOBODY is admin, from any
 *    direction (email, request, user-id lookup); lookup failures
 *    fail closed;
 *  - requireTier: an admin passes every tier gate (resolved as
 *    elite); a member's allow/deny is byte-identical to before;
 *  - requireProTier (shops): an admin on a free plan passes; a free
 *    member gets the exact shipped 403 body;
 *  - canUseCredits under the pre-launch lockdown (CREDITS_ADMIN_ONLY):
 *    admin true with NO grant, member false, member-with-grant true,
 *    and everyone true when the lockdown is off;
 *  - profile hosting: an admin reads as paid + entitled with
 *    source "admin" (no Stripe row is ever created by the bypass);
 *  - createAdminAwareUpload: the disk-upload factory enforces the
 *    member fileSize for members and the 1 GB owner ceiling for
 *    admins, same storage/filter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

const ADMIN = "owner@example.test";
const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  emails: new Map<string, string>(),
  tiers: new Map<string, { subscription_tier: string; plan: string | null }>(),
  supabaseError: false,
  grantRows: [] as Array<{ id: string }>,
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, val: string) => {
          const lookup = () => {
            if (h.supabaseError) return { data: null, error: { message: "boom" } };
            if (table === "profiles") {
              const email = h.emails.get(val);
              return { data: email ? { id: val, email } : null, error: null };
            }
            if (table === "creator_profiles") {
              return { data: h.tiers.get(val) ?? null, error: null };
            }
            return { data: null, error: null };
          };
          return {
            maybeSingle: async () => lookup(),
            single: async () => {
              const r = lookup();
              return r.data
                ? r
                : { data: null, error: r.error ?? { code: "PGRST116", message: "not found" } };
            },
          };
        },
      }),
    }),
  }),
  addCreditsToProfile: vi.fn(async () => {}),
  addCreditsAtomic: vi.fn(async () => {}),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => h.grantRows,
    then: (res: any, rej: any) => Promise.resolve(h.grantRows).then(res, rej),
  };
  return {
    ...actual,
    db: { select: () => chain, execute: async () => ({ rows: [] }) },
  };
});

import { adminEmails, isAdminEmail, isAdminRequest, isAdminUserId, skipIfAdmin } from "../admin";
import { requireTier } from "../../middlewares/require-tier";
import { requireProTier } from "../../routes/generate/shops";
import { canUseCredits } from "../credits";
import { resolvePaidPlan, resolveHostingEntitlement } from "../profile-website";
import { createAdminAwareUpload, ADMIN_UPLOAD_MAX_BYTES } from "../upload-storage";
import multer from "multer";

const SAVED = {
  ADMIN_EMAILS: process.env["ADMIN_EMAILS"],
  CREDITS_ADMIN_ONLY: process.env["CREDITS_ADMIN_ONLY"],
};

beforeEach(() => {
  h.emails.clear();
  h.tiers.clear();
  h.supabaseError = false;
  h.grantRows = [];
  h.emails.set(ADMIN_ID, ADMIN);
  h.emails.set(MEMBER_ID, "member@example.test");
  delete process.env["ADMIN_EMAILS"];
  delete process.env["CREDITS_ADMIN_ONLY"];
});

afterEach(() => {
  if (SAVED.ADMIN_EMAILS === undefined) delete process.env["ADMIN_EMAILS"];
  else process.env["ADMIN_EMAILS"] = SAVED.ADMIN_EMAILS;
  if (SAVED.CREDITS_ADMIN_ONLY === undefined) delete process.env["CREDITS_ADMIN_ONLY"];
  else process.env["CREDITS_ADMIN_ONLY"] = SAVED.CREDITS_ADMIN_ONLY;
});

describe("the predicate — fail-closed ADMIN_EMAILS, one definition", () => {
  it("unset ADMIN_EMAILS: nobody is admin from any direction", async () => {
    expect(adminEmails()).toEqual([]);
    expect(isAdminEmail(ADMIN)).toBe(false);
    expect(isAdminEmail("member@example.test")).toBe(false);
    expect(isAdminRequest({ userEmail: ADMIN } as never)).toBe(false);
    expect(skipIfAdmin({ userEmail: ADMIN } as never)).toBe(false);
    expect(await isAdminUserId(ADMIN_ID)).toBe(false);
  });

  it("matching is exact-list, case-insensitive, whitespace-tolerant", () => {
    process.env["ADMIN_EMAILS"] = ` ${ADMIN.toUpperCase()} , second@example.test `;
    expect(adminEmails()).toEqual([ADMIN, "second@example.test"]);
    expect(isAdminEmail(ADMIN)).toBe(true);
    expect(isAdminEmail("SECOND@example.test")).toBe(true);
    expect(isAdminEmail("member@example.test")).toBe(false);
    expect(isAdminEmail("owner@example.test.evil.com")).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
  });

  it("isAdminUserId resolves through the profile email and fails closed", async () => {
    process.env["ADMIN_EMAILS"] = ADMIN;
    expect(await isAdminUserId(ADMIN_ID)).toBe(true);
    expect(await isAdminUserId(MEMBER_ID)).toBe(false);
    expect(await isAdminUserId("99999999-9999-4999-8999-999999999999")).toBe(false);
    h.supabaseError = true;
    expect(await isAdminUserId(ADMIN_ID)).toBe(false);
  });

  it("skipIfAdmin reads the request identity only", () => {
    process.env["ADMIN_EMAILS"] = ADMIN;
    expect(skipIfAdmin({ userEmail: ADMIN } as never)).toBe(true);
    expect(skipIfAdmin({ userEmail: "member@example.test" } as never)).toBe(false);
    expect(skipIfAdmin({} as never)).toBe(false);
  });
});

function fakeRes() {
  const r: any = {
    statusCode: 0,
    body: null as unknown,
    status(c: number) {
      r.statusCode = c;
      return r;
    },
    json(b: unknown) {
      r.body = b;
      return r;
    },
  };
  return r;
}

describe("requireTier — admins pass every tier gate; members unchanged", () => {
  /* With no creator-profile row in the fake db, resolveCreatorTier
     falls back to the legacy plan leg — userPlan drives the member
     tier deterministically ("free" → free, "Pro Artist" → pro). */
  function tierReq(over: Record<string, unknown>) {
    return {
      userId: MEMBER_ID,
      userEmail: "member@example.test",
      userPlan: "free",
      headers: {},
      originalUrl: "/creator-sites",
      path: "/creator-sites",
      ...over,
    } as any;
  }

  it("admin on a free plan passes requireTier('elite') and reports elite", async () => {
    process.env["ADMIN_EMAILS"] = ADMIN;
    const req = tierReq({ userId: ADMIN_ID, userEmail: ADMIN, userPlan: "free" });
    const res = fakeRes();
    const next = vi.fn();
    await requireTier("elite")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.creatorTier).toBe("elite");
    expect(res.statusCode).toBe(0);
  });

  it("member on free is refused with the exact shipped gate contract", async () => {
    process.env["ADMIN_EMAILS"] = ADMIN;
    const req = tierReq({});
    const res = fakeRes();
    const next = vi.fn();
    await requireTier("pro")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: "TIER_REQUIRED",
      requiredTier: "pro",
      currentTier: "free",
      message:
        "That's a Pro move. Upgrade to unlock it — or keep creating free, your earnings stay yours to see.",
      upgradeUrl: "/creator-pricing?returnTo=%2Fcreator-sites",
      backUrl: "/dashboard",
    });
    expect(req.creatorTier).toBe("free");
  });

  it("member on a pro legacy plan passes requireTier('pro') exactly as before", async () => {
    const req = tierReq({ userPlan: "Pro Artist" });
    const res = fakeRes();
    const next = vi.fn();
    await requireTier("pro")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.creatorTier).toBe("pro");
  });

  it("ADMIN_EMAILS unset: the owner's address is tier-gated like everyone (fail-closed)", async () => {
    const req = tierReq({ userId: ADMIN_ID, userEmail: ADMIN, userPlan: "free" });
    const res = fakeRes();
    const next = vi.fn();
    await requireTier("pro")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe("requireProTier — the shops gate", () => {
  function run(req: any) {
    const res = fakeRes();
    const next = vi.fn();
    requireProTier(req, res, next);
    return { res, next };
  }

  it("free member: the exact shipped 403 body", () => {
    const { res, next } = run({ userEmail: "member@example.test", userPlan: "free" });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: "PRO_TIER_REQUIRED",
      message: "Storefronts require a Pro plan or higher. Upgrade to open your own shop.",
      upgradeUrl: "/pricing",
    });
  });

  it("pro member passes as before", () => {
    const { next } = run({ userEmail: "member@example.test", userPlan: "pro" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("admin on a FREE plan passes — the plan never gates the owner", () => {
    process.env["ADMIN_EMAILS"] = ADMIN;
    const { res, next } = run({ userEmail: ADMIN, userPlan: "free" });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it("ADMIN_EMAILS unset: the owner's address is gated like everyone (fail-closed)", () => {
    const { res, next } = run({ userEmail: ADMIN, userPlan: "free" });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe("canUseCredits — the lockdown exemption is real and total", () => {
  it("lockdown OFF: everyone can spend", async () => {
    expect(await canUseCredits(MEMBER_ID)).toBe(true);
    expect(await canUseCredits(ADMIN_ID)).toBe(true);
  });

  it("lockdown ON: admin spends with NO grant; member refused; member-with-grant allowed", async () => {
    process.env["CREDITS_ADMIN_ONLY"] = "true";
    process.env["ADMIN_EMAILS"] = ADMIN;
    h.grantRows = [];
    expect(await canUseCredits(ADMIN_ID)).toBe(true);
    expect(await canUseCredits(MEMBER_ID)).toBe(false);
    h.grantRows = [{ id: "grant-1" }];
    expect(await canUseCredits(MEMBER_ID)).toBe(true);
  });

  it("lockdown ON + ADMIN_EMAILS unset: the grant whitelist still works, nobody is admin", async () => {
    process.env["CREDITS_ADMIN_ONLY"] = "true";
    h.grantRows = [{ id: "grant-1" }];
    expect(await canUseCredits(MEMBER_ID)).toBe(true);
    h.grantRows = [];
    expect(await canUseCredits(ADMIN_ID)).toBe(false);
  });
});

describe("profile hosting — the admin legs create no third-party row", () => {
  it("resolvePaidPlan: admin reads paid on a free profile", async () => {
    process.env["ADMIN_EMAILS"] = ADMIN;
    expect(await resolvePaidPlan(PROFILE_ID, ADMIN_ID)).toBe(true);
  });

  it("resolveHostingEntitlement: admin is entitled with source 'admin'", async () => {
    process.env["ADMIN_EMAILS"] = ADMIN;
    const ent = await resolveHostingEntitlement(PROFILE_ID, ADMIN_ID);
    expect(ent.entitled).toBe(true);
    expect(ent.status).toBe("active");
    expect(ent.source).toBe("admin");
    expect(ent.currentPeriodEnd).toBeNull();
  });
});

describe("createAdminAwareUpload — disk-upload ceilings", () => {
  const dest = mkdtempSync(join(tmpdir(), "bdv-admin-upload-"));
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dest),
    filename: (_req, _file, cb) => cb(null, "f.bin"),
  });

  function multipartReq(userEmail: string | undefined, bytes: number): any {
    const boundary = "----bdvtestboundary";
    const head =
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.bin"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(head), Buffer.alloc(bytes, 97), Buffer.from(tail)]);
    const req: any = Readable.from([body]);
    req.headers = {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.length),
    };
    if (userEmail !== undefined) req.userEmail = userEmail;
    return req;
  }

  function run(mw: (req: any, res: any, next: any) => void, req: any): Promise<{ err: unknown; fileSize?: number }> {
    return new Promise((resolve) => {
      mw(req, {}, (err?: unknown) => resolve({ err: err ?? null, fileSize: req.file?.size }));
    });
  }

  it("the owner ceiling is 1 GB", () => {
    expect(ADMIN_UPLOAD_MAX_BYTES).toBe(1024 * 1024 * 1024);
  });

  it("member over the member cap is refused; admin passes with the same file; member under passes", async () => {
    process.env["ADMIN_EMAILS"] = ADMIN;
    const upload = createAdminAwareUpload({ storage, limits: { fileSize: 1024 } });

    const memberOver = await run(upload.single("file"), multipartReq("member@example.test", 2048));
    expect((memberOver.err as { code?: string } | null)?.code).toBe("LIMIT_FILE_SIZE");

    const adminOver = await run(upload.single("file"), multipartReq(ADMIN, 2048));
    expect(adminOver.err).toBeNull();
    expect(adminOver.fileSize).toBe(2048);

    const memberUnder = await run(upload.single("file"), multipartReq("member@example.test", 512));
    expect(memberUnder.err).toBeNull();
    expect(memberUnder.fileSize).toBe(512);

    const anonOver = await run(upload.single("file"), multipartReq(undefined, 2048));
    expect((anonOver.err as { code?: string } | null)?.code).toBe("LIMIT_FILE_SIZE");
  });
});
