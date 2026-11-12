/**
 * email-theme-rotation-db.test.ts — the durable rotation store
 * (migration 0338, join21) against a real pg-mem database running
 * the shipped migration file.
 *
 * Pins:
 *  - get/set round-trip through actual SQL, upsert on the
 *    recipient key (one row per customer, never two);
 *  - fail-open against a database where the table has not landed
 *    (get → null, set → swallowed) so a lagging migration degrades
 *    to the in-memory behavior instead of breaking a send;
 *  - the boot wiring: installDbEmailThemeRotationStore() makes the
 *    rotation itself durable — a verified send flips the row, a
 *    peek never writes, and the sequence survives (dark → light →
 *    dark with the count rising).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  mem: null as any,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createTestDb } = await import("./test-db");
  const t = createTestDb();
  const sqlText = readFileSync(
    new URL(
      "../../../../../lib/db/migrations/0338_email_theme_rotation.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const stmt of sqlText
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)) {
    t.mem.public.none(stmt);
  }
  h.mem = t.mem;
  return { ...actual, db: t.db };
});

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createDbEmailThemeRotationStore,
  installDbEmailThemeRotationStore,
} from "../email-theme-rotation-db";
import {
  resolveEmailThemeForRecipient,
  recordEmailThemeSent,
  resetEmailThemeRotationForTests,
} from "../email-theme-rotation";
import { createTestDb } from "./test-db";

const KEY = "fan@example.com";

beforeEach(() => {
  h.mem.public.none(`DELETE FROM email_theme_rotation`);
  resetEmailThemeRotationForTests();
});

describe("DbEmailThemeRotationStore — SQL round-trip", () => {
  it("get on an unknown recipient is null (fresh sequence)", async () => {
    const store = createDbEmailThemeRotationStore();
    expect(await store.get(KEY)).toBeNull();
  });

  it("set then get returns the same state; the raw row matches", async () => {
    const store = createDbEmailThemeRotationStore();
    await store.set(KEY, {
      nextTheme: "light",
      sentCount: 3,
      updatedAt: "2026-11-11T12:00:00.000Z",
    });
    const state = await store.get(KEY);
    expect(state?.nextTheme).toBe("light");
    expect(state?.sentCount).toBe(3);
    expect(state?.updatedAt).toBe("2026-11-11T12:00:00.000Z");

    const rows = h.mem.public.many(
      `SELECT next_theme, sent_count FROM email_theme_rotation WHERE recipient_email = '${KEY}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].next_theme).toBe("light");
    expect(rows[0].sent_count).toBe(3);
  });

  it("a second set upserts the same row — one row per customer, ever", async () => {
    const store = createDbEmailThemeRotationStore();
    await store.set(KEY, { nextTheme: "light", sentCount: 1, updatedAt: null });
    await store.set(KEY, { nextTheme: "dark", sentCount: 2, updatedAt: null });
    const rows = h.mem.public.many(
      `SELECT next_theme, sent_count FROM email_theme_rotation WHERE recipient_email = '${KEY}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].next_theme).toBe("dark");
    expect(rows[0].sent_count).toBe(2);
  });
});

describe("DbEmailThemeRotationStore — fail-open on a lagging database", () => {
  it("get resolves null and set resolves quietly when the table is missing", async () => {
    const bare = createTestDb(); // no migration 0338 applied here
    const store = createDbEmailThemeRotationStore(bare.db as any);
    await expect(store.get(KEY)).resolves.toBeNull();
    await expect(
      store.set(KEY, { nextTheme: "light", sentCount: 1, updatedAt: null }),
    ).resolves.toBeUndefined();
  });
});

describe("boot wiring — installDbEmailThemeRotationStore()", () => {
  it("the rotation turns durable: peeks never write, verified sends flip the row", async () => {
    installDbEmailThemeRotationStore();

    // Peek only: no row is written by resolving a theme.
    expect(await resolveEmailThemeForRecipient(KEY)).toBe("dark");
    expect(await resolveEmailThemeForRecipient(KEY)).toBe("dark");
    let rows = h.mem.public.many(`SELECT * FROM email_theme_rotation`);
    expect(rows).toHaveLength(0);

    // First verified dark send: row lands flipped to light, count 1.
    await recordEmailThemeSent(KEY, "dark");
    rows = h.mem.public.many(
      `SELECT next_theme, sent_count FROM email_theme_rotation WHERE recipient_email = '${KEY}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].next_theme).toBe("light");
    expect(rows[0].sent_count).toBe(1);
    expect(await resolveEmailThemeForRecipient(KEY)).toBe("light");

    // The sequence survives in the table: light send flips back.
    await recordEmailThemeSent(KEY, "light");
    rows = h.mem.public.many(
      `SELECT next_theme, sent_count FROM email_theme_rotation WHERE recipient_email = '${KEY}'`,
    );
    expect(rows[0].next_theme).toBe("dark");
    expect(rows[0].sent_count).toBe(2);
  });
});
