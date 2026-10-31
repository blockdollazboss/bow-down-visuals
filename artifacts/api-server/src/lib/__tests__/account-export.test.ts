/**
 * Account export truth (stack1000 lane R2) — lib/account-export.ts.
 *
 * The old builder read every category from Supabase and swallowed
 * every error into a silent []. But drafts, clips and songs are
 * WRITTEN to the app database (routes/drafts.ts, lib/library-song.ts
 * — Drizzle / DATABASE_URL), so those sections arrived empty for
 * every member, forever. These tests pin the corrected behaviour
 * over pg-mem for the app-database categories and a fake Supabase
 * client for profile + projects:
 *  - each listed category contains the member's real rows;
 *  - another member's rows never leak in;
 *  - a failed read REJECTS — a listed category can never again
 *    arrive fake-empty;
 *  - genuinely empty stores still export as honest empty arrays.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

const h = vi.hoisted(() => ({
  db: null as any,
  supaProfile: null as any,
  supaProjects: [] as any[],
  supaProfileError: null as any,
  supaProjectsError: null as any,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: h.supaProfile, error: h.supaProfileError }),
            }),
          }),
        };
      }
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: h.supaProjects, error: h.supaProjectsError }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { buildAccountExportPayload } from "../account-export";
import { createTestDb } from "./test-db";

const DDL = `
CREATE TABLE project_drafts (id uuid PRIMARY KEY, user_id uuid NOT NULL, workflow_type text NOT NULL, title text, draft_data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE generated_clips (id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid, scene_id text, title text, prompt text, final_prompt text, runway_job_id text, artist_vault_id uuid, video_url text, thumbnail_url text, status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE songs (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, audio_url text NOT NULL, audio_path text, source text NOT NULL DEFAULT 'upload', parent_song_id uuid, artist_vault_id uuid, mashup_sources jsonb, mashup_style text, duration_sec text, lyrics text, karaoke_enabled boolean NOT NULL DEFAULT false, karaoke_share_enabled boolean NOT NULL DEFAULT false, timed_lyrics text, genre text, isrc text, cover_art_url text, created_at timestamptz NOT NULL DEFAULT now());
`;

const USER = randomUUID();
const OTHER = randomUUID();

let mem: any;

beforeEach(() => {
  const t = createTestDb();
  h.db = t.db;
  mem = t.mem;
  mem.public.none(DDL);
  h.supaProfile = { id: USER, email: "member@example.com", credits: 1200 };
  h.supaProjects = [{ id: randomUUID(), user_id: USER, title: "Launch video" }];
  h.supaProfileError = null;
  h.supaProjectsError = null;
});

describe("buildAccountExportPayload", () => {
  it("returns the member's real drafts, clips and songs from the app database", async () => {
    mem.public.none(`
      INSERT INTO project_drafts (id, user_id, workflow_type, draft_data) VALUES ('${randomUUID()}', '${USER}', 'music-video', '{}');
      INSERT INTO generated_clips (id, user_id, title) VALUES ('${randomUUID()}', '${USER}', 'Intro clip');
      INSERT INTO songs (id, user_id, title, audio_url) VALUES ('${randomUUID()}', '${USER}', 'Midnight', 'https://x/midnight.mp3');
    `);
    const payload = await buildAccountExportPayload(USER);
    expect(payload.profile).toMatchObject({ id: USER });
    expect(payload.projects).toHaveLength(1);
    expect(payload.drafts).toHaveLength(1);
    expect(payload.clips).toHaveLength(1);
    expect(payload.songs).toHaveLength(1);
    expect((payload.songs[0] as any).title).toBe("Midnight");
    expect(payload.exportedAt).toBeTruthy();
  });

  it("never leaks another member's rows into any category", async () => {
    mem.public.none(`
      INSERT INTO project_drafts (id, user_id, workflow_type, draft_data) VALUES ('${randomUUID()}', '${OTHER}', 'music-video', '{}');
      INSERT INTO generated_clips (id, user_id) VALUES ('${randomUUID()}', '${OTHER}');
      INSERT INTO songs (id, user_id, title, audio_url) VALUES ('${randomUUID()}', '${OTHER}', 'Theirs', 'https://x/t.mp3');
    `);
    const payload = await buildAccountExportPayload(USER);
    expect(payload.drafts).toEqual([]);
    expect(payload.clips).toEqual([]);
    expect(payload.songs).toEqual([]);
  });

  it("rejects when the projects read fails — no fake-empty section", async () => {
    h.supaProjectsError = { message: "relation does not exist" };
    await expect(buildAccountExportPayload(USER)).rejects.toBeTruthy();
  });

  it("rejects when the profile read fails", async () => {
    h.supaProfileError = { message: "boom" };
    await expect(buildAccountExportPayload(USER)).rejects.toBeTruthy();
  });

  it("exports honest empty arrays when the member truly has nothing", async () => {
    h.supaProjects = [];
    const payload = await buildAccountExportPayload(USER);
    expect(payload.drafts).toEqual([]);
    expect(payload.clips).toEqual([]);
    expect(payload.songs).toEqual([]);
    expect(payload.projects).toEqual([]);
  });
});
