/**
 * teams-gate.test.ts — Team Workspace routes, end to end over pg-mem,
 * with the REAL gate (lib/teams.ts) reading the REAL earned rank
 * (lib/creator-rank.ts counting seeded work). Only auth, Supabase,
 * email and the credits rail are faked — the entitlement path itself
 * is production code throughout.
 *
 * Proves the fix for the staging-walk failure (settled stack1500):
 * /team showed "Team Workspace requires Shot Caller tier or higher"
 * with no pool, invites or roles, because the gate read the legacy
 * profiles.plan_tier column (manual admin assignment only, default 1)
 * instead of the earned rank.
 *
 *  - an earned ★2 creator (the walk's 46-point shape) gets the 403
 *    gate sentence on both gated routes — the gate still exists;
 *  - an earned ★3 creator is still gated — the threshold is ★4;
 *  - an earned ★4 creator passes: GET /teams answers with their team,
 *    its shared pool and their pending invites; POST /teams creates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "creator@example.com",
  emailByUser: {} as Record<string, string>,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userEmail = h.userEmail;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => ({})),
  OutOfCreditsError: class OutOfCreditsError extends Error {
    status = 402;
  },
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: h.emailByUser[id] ? { email: h.emailByUser[id] } : null },
          error: null,
        }),
        listUsers: async () => ({ data: { users: [] }, error: null }),
      },
    },
  }),
  addCreditsToProfile: vi.fn(async () => {}),
}));

vi.mock("../../lib/email", () => ({
  sendEmail: vi.fn(async () => ({ sent: false })),
  emailShell: (_title: string, body: string) => body,
  emailButton: () => "",
  escapeHtml: (s: string) => s,
  isEmailConfigured: () => false,
  baseUrlForEmail: () => "http://test.local",
  EMAIL_COLORS: { goldDeep: "#7A5A12" },
}));

import teamsRouter from "../teams";
import { createTestDb } from "../../lib/__tests__/test-db";

const DDL = `
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text,
  owner_id uuid NOT NULL,
  credits integer NOT NULL DEFAULT 0,
  allow_personal_fallback boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'invited',
  invited_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz
);
CREATE TABLE credit_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text,
  credits_used integer,
  team_id uuid,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE profile_tracks (id uuid PRIMARY KEY, profile_id uuid NOT NULL, is_published boolean NOT NULL DEFAULT false);
CREATE TABLE profile_videos (id uuid PRIMARY KEY, profile_id uuid NOT NULL, is_published boolean NOT NULL DEFAULT false);
CREATE TABLE export_jobs (id uuid PRIMARY KEY, user_id uuid NOT NULL, state text NOT NULL DEFAULT 'done');
CREATE TABLE follows (id uuid PRIMARY KEY, profile_id uuid NOT NULL);
CREATE TABLE live_streams (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE tip_jar_tips (id uuid PRIMARY KEY, page_user_id uuid NOT NULL, status text NOT NULL DEFAULT 'paid');
CREATE TABLE live_stream_tips (id uuid PRIMARY KEY, creator_user_id uuid NOT NULL, creator_credited_at timestamptz);
CREATE TABLE world_stage_tips (id uuid PRIMARY KEY, to_user_id uuid NOT NULL, creator_credited_at timestamptz);
CREATE TABLE store_orders (id uuid PRIMARY KEY, profile_id uuid NOT NULL, status text NOT NULL DEFAULT 'completed');
CREATE TABLE shop_events (id uuid PRIMARY KEY, user_id uuid NOT NULL, event_type text NOT NULL DEFAULT 'sale');
CREATE TABLE fan_members (id uuid PRIMARY KEY, user_id uuid NOT NULL, stripe_session_id text, status text NOT NULL DEFAULT 'active');
`;

const GATE_SENTENCE = "Team Workspace requires Shot Caller tier or higher.";

let mem: any;
let server: ReturnType<typeof express.application.listen>;
let base = "";

/** Seed a creator_profile for `userId` plus rank-source rows worth the
 *  given counts (published tracks/videos, followers). */
function seedCreator(userId: string, email: string, counts: { tracks?: number; videos?: number; followers?: number }) {
  const profileId = randomUUID();
  h.emailByUser[userId] = email;
  const stmts: string[] = [`INSERT INTO creator_profiles (id, user_id) VALUES ('${profileId}', '${userId}');`];
  for (let i = 0; i < (counts.tracks ?? 0); i++)
    stmts.push(`INSERT INTO profile_tracks (id, profile_id, is_published) VALUES ('${randomUUID()}', '${profileId}', true);`);
  for (let i = 0; i < (counts.videos ?? 0); i++)
    stmts.push(`INSERT INTO profile_videos (id, profile_id, is_published) VALUES ('${randomUUID()}', '${profileId}', true);`);
  for (let i = 0; i < (counts.followers ?? 0); i++)
    stmts.push(`INSERT INTO follows (id, profile_id) VALUES ('${randomUUID()}', '${profileId}');`);
  mem.public.none(stmts.join("\n"));
  return profileId;
}

function as(userId: string, email: string) {
  h.userId = userId;
  h.userEmail = email;
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeEach(async () => {
  const t = createTestDb();
  h.db = t.db;
  mem = t.mem;
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  h.emailByUser = {};

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", teamsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Team Workspace gate — earned rank, end to end", () => {
  it("earned ★2 (the walk's 46-point shape): both gated routes answer the gate sentence", async () => {
    const user = randomUUID();
    seedCreator(user, "hustler@example.com", { tracks: 2, videos: 1, followers: 11 });
    as(user, "hustler@example.com");

    const list = await api("GET", "/api/teams");
    expect(list.status).toBe(403);
    expect(list.body.error).toBe(GATE_SENTENCE);

    const create = await api("POST", "/api/teams", { name: "Hustler Crew" });
    expect(create.status).toBe(403);
    expect(create.body.error).toBe(GATE_SENTENCE);
  });

  it("earned ★3 Gangster (100 pts): still gated — the threshold is exactly ★4", async () => {
    const user = randomUUID();
    seedCreator(user, "gangster@example.com", { tracks: 10 });
    as(user, "gangster@example.com");

    const list = await api("GET", "/api/teams");
    expect(list.status).toBe(403);
    expect(list.body.error).toBe(GATE_SENTENCE);
  });

  it("earned ★4 Shot Caller (300 pts): the list answers with team, pool and pending invites", async () => {
    const owner = randomUUID();
    seedCreator(owner, "shotcaller@example.com", { tracks: 10, videos: 10, followers: 50 });
    as(owner, "shotcaller@example.com");

    // Their own team with a funded pool and an active membership.
    const teamId = randomUUID();
    mem.public.none(`
      INSERT INTO teams (id, name, owner_id, credits) VALUES ('${teamId}', 'Shot Caller Crew', '${owner}', 750);
      INSERT INTO team_members (id, team_id, user_id, email, role, status, joined_at)
        VALUES ('${randomUUID()}', '${teamId}', '${owner}', 'shotcaller@example.com', 'owner', 'active', now());
    `);
    // A pending invite addressed to them from someone else's team.
    const otherTeam = randomUUID();
    const otherOwner = randomUUID();
    mem.public.none(`
      INSERT INTO teams (id, name, owner_id, credits) VALUES ('${otherTeam}', 'Inviting Crew', '${otherOwner}', 0);
      INSERT INTO team_members (id, team_id, user_id, email, role, status)
        VALUES ('${randomUUID()}', '${otherTeam}', NULL, 'shotcaller@example.com', 'member', 'invited');
    `);

    const list = await api("GET", "/api/teams");
    expect(list.status).toBe(200);
    expect(list.body.teams).toHaveLength(1);
    expect(list.body.teams[0].name).toBe("Shot Caller Crew");
    expect(list.body.teams[0].credits).toBe(750);
    expect(list.body.teams[0].myRole).toBe("owner");
    expect(list.body.invites).toHaveLength(1);
    expect(list.body.invites[0].team.name).toBe("Inviting Crew");

    // The detail read (members + roles surface) opens for the member too.
    const detail = await api("GET", `/api/teams/${teamId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.myRole).toBe("owner");
    expect(detail.body.members).toHaveLength(1);
    expect(detail.body.members[0].role).toBe("owner");
  });

  it("earned ★4 Shot Caller: POST /teams creates the workspace", async () => {
    const user = randomUUID();
    seedCreator(user, "founder@example.com", { tracks: 30 }); // 300 pts at the tracks cap
    as(user, "founder@example.com");

    const create = await api("POST", "/api/teams", { name: "Founder Crew" });
    expect(create.status).toBe(200);
    expect(create.body.team.name).toBe("Founder Crew");
    expect(create.body.team.ownerId).toBe(user);

    const list = await api("GET", "/api/teams");
    expect(list.status).toBe(200);
    expect(list.body.teams.map((t: any) => t.name)).toContain("Founder Crew");
  });
});
