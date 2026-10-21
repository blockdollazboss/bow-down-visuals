import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import {
  createDrizzlePresaveNotifyStore,
  notifyPresaveFansForRelease,
  sweepDuePresaveReleases,
  buildPresaveReleaseEmail,
  presaveReleaseTargetMs,
  type DuePresaveRelease,
  type PresaveNotifyStore,
} from "../presave-release-notify";
import { createTestDb, type TestDb } from "./test-db";
import { DataType } from "pg-mem";

/* Release-day presave fan notifications (wave 3 #15, migration 0185).
 *
 * These tests run the REAL drizzle store against pg-mem — the claim
 * discipline (insert-first ON CONFLICT DO NOTHING, status-guarded
 * retry UPDATEs) is SQL, so a fake store would test nothing about it.
 * Only the sender is faked (deps.send), which is the seam the lib
 * exposes for exactly this. A "restart" is a fresh store instance
 * over the same durable rows. */

const DDL = `
CREATE TABLE distribution_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  artist_name text NOT NULL,
  release_date text,
  platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  presave_slug text,
  presave_platform_links jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE presave_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES distribution_releases(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  platform text,
  source text NOT NULL DEFAULT 'presave',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, email)
);
CREATE TABLE presave_release_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES distribution_releases(id) ON DELETE CASCADE,
  follow_id uuid REFERENCES presave_follows(id) ON DELETE SET NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  provider_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX presave_release_deliveries_release_email_idx
  ON presave_release_deliveries (release_id, email);
`;

/* Fixed clock: Tuesday Nov 10 2026, noon UTC. The standard fixture
   release dropped Monday Nov 9 (YYYY-MM-DD → UTC midnight). */
const NOW = new Date("2026-11-10T12:00:00Z");

let t: TestDb;
let store: PresaveNotifyStore;

beforeEach(() => {
  t = createTestDb();
  /* pg-mem has no gen_random_uuid — register it (the payment-reversals
     test's pattern) so the DDL mirrors' defaults resolve. */
  t.mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    /* impure: pg-mem otherwise simplifies the call to one constant
       for the whole statement, and every row lands the same id. */
    impure: true,
    implementation: () => randomUUID(),
  });
  t.mem.public.none(DDL);
  store = createDrizzlePresaveNotifyStore(t.db as never);
});

async function seedRelease(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  /* Key-presence, not ??: an explicit null (no slug / no date) is a
     fixture case of its own and must not coalesce to the default. */
  const pick = (key: string, fallback: unknown) => (key in overrides ? overrides[key] : fallback);
  await t.db.execute(sql`
    INSERT INTO distribution_releases (id, user_id, title, artist_name, release_date, status, presave_slug, presave_platform_links)
    VALUES (${id}, ${randomUUID()},
      ${pick("title", "Gold Season") as string},
      ${pick("artist_name", "Test Artist") as string},
      ${pick("release_date", "2026-11-09") as string | null},
      ${pick("status", "packaged") as string},
      ${pick("presave_slug", "goldseason1") as string | null},
      ${JSON.stringify(pick("presave_platform_links", {}))}::jsonb)
  `);
  return id;
}

async function seedFollow(releaseId: string, email: string, createdAt: string, name: string | null = null): Promise<string> {
  const id = randomUUID();
  await t.db.execute(sql`
    INSERT INTO presave_follows (id, release_id, email, name, created_at)
    VALUES (${id}, ${releaseId}, ${email}, ${name}, ${createdAt}::timestamptz)
  `);
  return id;
}

async function deliveries(releaseId: string) {
  const r = await t.db.execute(sql`
    SELECT email, status, attempts, provider_id, last_error FROM presave_release_deliveries
    WHERE release_id = ${releaseId} ORDER BY email
  `);
  return r.rows as Array<{ email: string; status: string; attempts: number; provider_id: string | null; last_error: string | null }>;
}

function recordingSender(impl?: (to: string) => { sent: boolean; id?: string; reason?: string }) {
  const calls: string[] = [];
  const send = async (opts: { to: string }) => {
    calls.push(opts.to);
    const r = impl?.(opts.to) ?? { sent: true, id: `msg-${calls.length}` };
    return r;
  };
  return { calls, send };
}

const dueRelease = (id: string): DuePresaveRelease => ({
  id,
  title: "Gold Season",
  artistName: "Test Artist",
  presaveSlug: "goldseason1",
  releaseDate: "2026-11-09",
  platformLinks: {},
});

describe("presaveReleaseTargetMs — the release moment rule", () => {
  it("reads YYYY-MM-DD as UTC midnight, parses ISO, rejects junk", () => {
    expect(presaveReleaseTargetMs("2026-11-09")).toBe(Date.UTC(2026, 10, 9));
    expect(presaveReleaseTargetMs("2026-11-09T06:30:00Z")).toBe(Date.UTC(2026, 10, 9, 6, 30));
    expect(presaveReleaseTargetMs("not-a-date")).toBeNull();
    expect(presaveReleaseTargetMs(null)).toBeNull();
    expect(presaveReleaseTargetMs("")).toBeNull();
  });
});

describe("due-release selection", () => {
  it("only packaged releases with a presave page whose date has arrived are due", async () => {
    const due = await seedRelease();
    await seedRelease({ presave_slug: "draftone", status: "draft" });
    await seedRelease({ presave_slug: "futureone", release_date: "2026-12-01" });
    await seedRelease({ presave_slug: null });
    await seedRelease({ presave_slug: "nodate", release_date: null });
    await seedRelease({ presave_slug: "isoone", release_date: "2026-11-10T06:00:00Z" });

    const rows = await store.listDueReleases(NOW);
    expect(rows.map((r) => r.id).sort()).toEqual([due, ...(await (async () => {
      const r2 = await t.db.execute(sql`SELECT id FROM distribution_releases WHERE presave_slug = 'isoone'`);
      return [(r2.rows[0] as { id: string }).id];
    })())].sort());
    expect(rows.find((r) => r.id === due)?.presaveSlug).toBe("goldseason1");
  });
});

describe("release-day fan-out", () => {
  it("emails every eligible fan exactly once — a restart + replay sends nothing twice", async () => {
    const id = await seedRelease();
    await seedFollow(id, "a@fan.test", "2026-11-01T00:00:00Z");
    await seedFollow(id, "b@fan.test", "2026-11-05T00:00:00Z");
    await seedFollow(id, "c@fan.test", "2026-11-09T12:00:00Z"); // release-day, inside grace
    const sender = recordingSender();

    const first = await sweepDuePresaveReleases({ store, send: sender.send, now: NOW });
    expect(first).toMatchObject({ releases: 1, follows: 3, sent: 3, failed: 0 });
    expect(sender.calls.sort()).toEqual(["a@fan.test", "b@fan.test", "c@fan.test"]);
    const rows = await deliveries(id);
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
    expect(rows.every((r) => r.provider_id && r.attempts === 1)).toBe(true);

    /* Restart: fresh store instance, same durable rows, sweep again. */
    const store2 = createDrizzlePresaveNotifyStore(t.db as never);
    const second = await sweepDuePresaveReleases({ store: store2, send: sender.send, now: NOW });
    expect(second).toMatchObject({ follows: 3, sent: 0, skipped: 3 });
    expect(sender.calls).toHaveLength(3);
  });

  it("excludes fans who followed long after release day — they joined the list, not the pre-save", async () => {
    const id = await seedRelease();
    await seedFollow(id, "early@fan.test", "2026-11-01T00:00:00Z");
    await seedFollow(id, "late@fan.test", "2026-11-15T00:00:00Z"); // 6 days after the drop
    const sender = recordingSender();

    const r = await notifyPresaveFansForRelease(dueRelease(id), { store, send: sender.send, now: NOW });
    expect(r.follows).toBe(1);
    expect(sender.calls).toEqual(["early@fan.test"]);
    const rows = await deliveries(id);
    expect(rows.map((x) => x.email)).toEqual(["early@fan.test"]);
  });

  it("failure isolation: a throwing send and a provider refusal never block the rest, and both retry to sent", async () => {
    const id = await seedRelease();
    await seedFollow(id, "good@fan.test", "2026-11-01T00:00:00Z");
    await seedFollow(id, "throws@fan.test", "2026-11-02T00:00:00Z");
    await seedFollow(id, "flaky@fan.test", "2026-11-03T00:00:00Z");

    let throwsFixed = false;
    let flakyFixed = false;
    const sender = recordingSender((to) => {
      if (to === "throws@fan.test" && !throwsFixed) throw new Error("smtp exploded");
      if (to === "flaky@fan.test" && !flakyFixed) return { sent: false, reason: "provider-error" };
      return { sent: true, id: "msg-ok" };
    });

    const first = await notifyPresaveFansForRelease(dueRelease(id), { store, send: sender.send, now: NOW });
    expect(first).toMatchObject({ follows: 3, sent: 1, failed: 2 });
    let rows = await deliveries(id);
    expect(rows.find((r) => r.email === "good@fan.test")?.status).toBe("sent");
    /* The throw was isolated AFTER the claim: row stays 'pending'
       (stale-claim retry path); the refusal is ledgered 'failed'. */
    expect(rows.find((r) => r.email === "throws@fan.test")?.status).toBe("pending");
    expect(rows.find((r) => r.email === "flaky@fan.test")).toMatchObject({ status: "failed", last_error: "provider-error", attempts: 1 });

    /* Next sweep after the stale-pending window: both retry, both land. */
    throwsFixed = true;
    flakyFixed = true;
    const later = new Date(NOW.getTime() + 20 * 60 * 1000);
    const second = await notifyPresaveFansForRelease(dueRelease(id), { store, send: sender.send, now: later });
    expect(second).toMatchObject({ sent: 2, failed: 0 });
    rows = await deliveries(id);
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
    /* The good fan was never emailed twice across all passes. */
    expect(sender.calls.filter((c) => c === "good@fan.test")).toHaveLength(1);
  });

  it("no-provider gap: attempts are ledgered 'failed' with the reason, nothing claims sent, cap turns the row 'dead'", async () => {
    const id = await seedRelease();
    await seedFollow(id, "a@fan.test", "2026-11-01T00:00:00Z");
    /* lib/email.ts fail-open shape when RESEND_API_KEY is unset. */
    const sender = recordingSender(() => ({ sent: false, reason: "no-provider" }));

    for (let pass = 0; pass < 3; pass++) {
      await notifyPresaveFansForRelease(dueRelease(id), { store, send: sender.send, now: NOW, maxAttempts: 3 });
    }
    const rows = await deliveries(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "dead", attempts: 3, last_error: "no-provider" });
    expect(sender.calls).toHaveLength(3);

    /* Terminal: a fourth pass does not even attempt. */
    const fourth = await notifyPresaveFansForRelease(dueRelease(id), { store, send: sender.send, now: NOW, maxAttempts: 3 });
    expect(fourth).toMatchObject({ sent: 0, failed: 0, skipped: 1 });
    expect(sender.calls).toHaveLength(3);
  });

  it("racing sweeps: two concurrent fan-outs still email each fan exactly once", async () => {
    const id = await seedRelease();
    await seedFollow(id, "a@fan.test", "2026-11-01T00:00:00Z");
    await seedFollow(id, "b@fan.test", "2026-11-02T00:00:00Z");
    const sender = recordingSender();

    await Promise.all([
      notifyPresaveFansForRelease(dueRelease(id), { store, send: sender.send, now: NOW }),
      notifyPresaveFansForRelease(dueRelease(id), { store, send: sender.send, now: NOW }),
    ]);
    expect(sender.calls.sort()).toEqual(["a@fan.test", "b@fan.test"]);
    const rows = await deliveries(id);
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent"]);
  });
});

describe("buildPresaveReleaseEmail", () => {
  it("carries the smartlink, escapes artist-controlled strings, and lists platform links", () => {
    const mail = buildPresaveReleaseEmail(
      {
        id: "r1",
        title: 'Gold <script>alert(1)</script> Season',
        artistName: "Test & Co",
        presaveSlug: "goldseason1",
        releaseDate: "2026-11-09",
        platformLinks: { spotify: "https://open.spotify.com/album/x", apple_music: "https://music.apple.com/y", bogus: "javascript:alert(1)" },
      },
      { email: "fan@test", name: "Jo <Fan>" },
    );
    expect(mail.to).toBe("fan@test");
    expect(mail.subject).toContain("Gold");
    expect(mail.html).toContain("/presave/goldseason1");
    expect(mail.html).not.toContain("<script>alert(1)</script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("Test &amp; Co");
    expect(mail.html).toContain("Jo &lt;Fan&gt;");
    expect(mail.html).toContain("https://open.spotify.com/album/x");
    expect(mail.html).not.toContain("javascript:alert(1)");
    expect(mail.text).toContain("/presave/goldseason1");
  });
});
