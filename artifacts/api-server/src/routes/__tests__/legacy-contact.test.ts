/**
 * Stack 3 — legacy CONTACT route tests (trust router, #2b), driven like
 * real callers over HTTP against the house fake db (_reach-fake-db),
 * the pattern trust.test.ts uses.
 *
 * The contact is a different record from Stack 10's succession
 * designation: name + email of the person Bow Down Visuals should
 * CONTACT about the account if the creator no longer can. Record only —
 * no transfer, payout, or legal effect. The privacy bar is the point of
 * this suite: owner-only read AND write, and the contact's name/email
 * must never surface on any other party's response or any public
 * profile surface.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ fake: null as any }));
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = String(u); next();
  },
}));
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    legacyDesignations: actual.legacyDesignationsTable,
    legacyContacts: actual.legacyContactsTable,
  }, { legacyContacts: [["user_id"]] });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import trustRouter from "../trust";

const OWNER = randomUUID(), HEIR = randomUUID(), STRANGER = randomUUID();
const CONTACT_NAME = "Marisol Vega-Quinn";
const CONTACT_EMAIL = "marisol.vega-quinn@example-legacy.net";
const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(trustRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => { h.fake.clear(); });

async function call(method: string, path: string, user: string | null, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}

describe("legacy contact — set, read back, edit, clear", () => {
  it("starts empty, sets with 201, reads back, edits in place, clears to null", async () => {
    expect((await call("GET", "/legacy/contact", OWNER)).json.contact).toBeNull();

    const made = await call("PUT", "/legacy/contact", OWNER, { name: CONTACT_NAME, email: CONTACT_EMAIL, note: "My sister." });
    expect(made.status).toBe(201);
    expect(made.json.contact).toMatchObject({ name: CONTACT_NAME, email: CONTACT_EMAIL, note: "My sister." });
    expect(made.json.contact.createdAt).toBeTruthy();

    const read = await call("GET", "/legacy/contact", OWNER);
    expect(read.json.contact).toMatchObject({ name: CONTACT_NAME, email: CONTACT_EMAIL, note: "My sister." });

    const edited = await call("PUT", "/legacy/contact", OWNER, { name: "Marisol V. Quinn", email: "mvq@example-legacy.net", note: "" });
    expect(edited.status).toBe(200);
    expect(edited.json.contact).toMatchObject({ name: "Marisol V. Quinn", email: "mvq@example-legacy.net", note: "" });

    const cleared = await call("DELETE", "/legacy/contact", OWNER);
    expect(cleared.status).toBe(200);
    expect(cleared.json.contact).toBeNull();
    expect((await call("GET", "/legacy/contact", OWNER)).json.contact).toBeNull();
    expect((await call("DELETE", "/legacy/contact", OWNER)).status).toBe(404);
  });

  it("note is optional and defaults to empty", async () => {
    const made = await call("PUT", "/legacy/contact", OWNER, { name: CONTACT_NAME, email: CONTACT_EMAIL });
    expect(made.status).toBe(201);
    expect(made.json.contact.note).toBe("");
  });
});

describe("legacy contact — validation", () => {
  it("refuses bad email shapes, empty/overlong names, and overlong notes/emails", async () => {
    for (const body of [
      { name: "", email: CONTACT_EMAIL },
      { name: "   ", email: CONTACT_EMAIL },
      { name: "x".repeat(121), email: CONTACT_EMAIL },
      { name: CONTACT_NAME, email: "not-an-email" },
      { name: CONTACT_NAME, email: "missing-at.example" },
      { name: CONTACT_NAME, email: "" },
      { name: CONTACT_NAME, email: `${"a".repeat(245)}@example.net` },
      { name: CONTACT_NAME, email: CONTACT_EMAIL, note: "n".repeat(1001) },
      { email: CONTACT_EMAIL },
      { name: CONTACT_NAME },
    ]) {
      const r = await call("PUT", "/legacy/contact", OWNER, body);
      expect(r.status).toBe(400);
    }
    expect((await call("GET", "/legacy/contact", OWNER)).json.contact).toBeNull();
  });
});

describe("legacy contact — owner-only in both directions", () => {
  it("requires auth on every verb", async () => {
    expect((await call("GET", "/legacy/contact", null)).status).toBe(401);
    expect((await call("PUT", "/legacy/contact", null, { name: CONTACT_NAME, email: CONTACT_EMAIL })).status).toBe(401);
    expect((await call("DELETE", "/legacy/contact", null)).status).toBe(401);
  });

  it("another user cannot read, overwrite, or remove the owner's contact", async () => {
    await call("PUT", "/legacy/contact", OWNER, { name: CONTACT_NAME, email: CONTACT_EMAIL, note: "owner's" });

    // A stranger reads only their own (empty) contact — never the owner's.
    expect((await call("GET", "/legacy/contact", STRANGER)).json.contact).toBeNull();

    // A stranger's save writes THEIR row, not the owner's.
    const own = await call("PUT", "/legacy/contact", STRANGER, { name: "Stranger Kin", email: "kin@example-legacy.net" });
    expect(own.status).toBe(201);
    const ownerAfter = await call("GET", "/legacy/contact", OWNER);
    expect(ownerAfter.json.contact).toMatchObject({ name: CONTACT_NAME, email: CONTACT_EMAIL, note: "owner's" });

    // A stranger's delete removes only their own row.
    expect((await call("DELETE", "/legacy/contact", STRANGER)).status).toBe(200);
    expect((await call("GET", "/legacy/contact", STRANGER)).json.contact).toBeNull();
    expect((await call("GET", "/legacy/contact", OWNER)).json.contact).toMatchObject({ email: CONTACT_EMAIL });
    // Second stranger delete: nothing of theirs left — 404, owner's row untouched.
    expect((await call("DELETE", "/legacy/contact", STRANGER)).status).toBe(404);
    expect((await call("GET", "/legacy/contact", OWNER)).json.contact).toMatchObject({ email: CONTACT_EMAIL });
  });
});

describe("legacy contact — never leaks to other surfaces", () => {
  it("the heir inbox and the designation payload carry neither the contact name nor email", async () => {
    await call("PUT", "/legacy/contact", OWNER, { name: CONTACT_NAME, email: CONTACT_EMAIL, note: "private note" });
    const made = await call("POST", "/legacy/designation", OWNER, { heirUserId: HEIR, instructions: "Keep the page live." });
    expect(made.status).toBe(201);

    const inbox = await call("GET", "/legacy/inbox", HEIR);
    expect(inbox.status).toBe(200);
    expect(inbox.text).not.toContain(CONTACT_EMAIL);
    expect(inbox.text).not.toContain(CONTACT_NAME);

    const designation = await call("GET", "/legacy/designation", OWNER);
    expect(designation.text).not.toContain(CONTACT_EMAIL);
    expect(designation.text).not.toContain(CONTACT_NAME);

    // The heir reading "their" contact slot sees their own (empty) one.
    expect((await call("GET", "/legacy/contact", HEIR)).json.contact).toBeNull();
  });

  it("public profile surfaces never reference the legacy contact store", () => {
    // toPublicProfile builds the public DTO field-by-field from the
    // creator profile row only; pin that no public-profile-serving
    // route file ever touches the contact table or its columns.
    for (const rel of ["../creator-platform.ts", "../social.ts", "../community.ts", "../discovery.ts", "../embed.ts"]) {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8");
      expect(src).not.toContain("legacyContacts");
      expect(src).not.toContain("legacy_contacts");
      expect(src).not.toContain("contact_email");
      expect(src).not.toContain("contactEmail");
    }
    const platform = readFileSync(new URL("../creator-platform.ts", import.meta.url), "utf8");
    const dtoBlock = platform.slice(platform.indexOf("function toPublicProfile"), platform.indexOf("router.get(\"/creator-profiles\""));
    expect(dtoBlock.length).toBeGreaterThan(0);
    expect(dtoBlock).not.toMatch(/legacy/i);
    expect(dtoBlock).not.toMatch(/contact/i);
  });
});
