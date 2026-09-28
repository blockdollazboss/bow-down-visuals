/**
 * Shared Artist Vault access matrix — the single choke point every team-aware
 * consumer (song remix, generated-song voice swap, press-kit, outfits) uses:
 *
 * - owner: full USE access (MANAGE is enforced separately by strict
 *   ownership checks at each route — see artist-outfits tests)
 * - active member of the vault's team: USE access
 * - member of a DIFFERENT team: denied
 * - nonmember: denied
 * - soft-deleted vault: denied even to the owner
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const drizzleFakes = vi.hoisted(() => {
  const colOf = (d: any) => d?.__col;
  return {
    eq: (col: any, val: any) => ({ __eq: true, col: colOf(col), val }),
    and: (...conds: any[]) => ({ __and: true, conds }),
    isNull: (col: any) => ({ __isNull: true, col: colOf(col) }),
  };
});
vi.mock("drizzle-orm", () => drizzleFakes);

const dbState = vi.hoisted(() => ({
  vaults: [] as any[],
  members: [] as any[],
  teams: [] as any[],
}));

vi.mock("@workspace/db", () => {
  const mkTable = (name: string, cols: string[]) => {
    const t: any = { __table: name };
    for (const c of cols) t[c] = { __col: c };
    return t;
  };
  const artistVaultsTable = mkTable("artist_vaults", ["id", "user_id", "team_id", "deleted_at"]);
  const teamMembersTable = mkTable("team_members", ["id", "teamId", "userId", "status"]);
  const teamsTable = mkTable("teams", ["id", "ownerId"]);

  const matchRow = (row: any, where: any): boolean => {
    if (!where) return true;
    if (where.__eq) return row[where.col] === where.val;
    if (where.__isNull) return row[where.col] == null;
    if (where.__and) return where.conds.every((c: any) => matchRow(row, c));
    return true;
  };
  const rowsFor = (table: any) => {
    switch (table.__table) {
      case "artist_vaults":
        return (dbState as any).vaults;
      case "team_members":
        return (dbState as any).members;
      case "teams":
        return (dbState as any).teams;
      default:
        return [];
    }
  };
  const db = {
    select: () => {
      const b: any = {};
      b.from = (table: any) => {
        b.__table = table;
        return b;
      };
      b.where = (w: any) => {
        b.__where = w;
        return b;
      };
      b.limit = (n: number) =>
        Promise.resolve(rowsFor(b.__table).filter((r) => matchRow(r, b.__where)).slice(0, n));
      return b;
    },
  };
  return { db, artistVaultsTable, teamMembersTable, teamsTable };
});

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { getAccessibleVault } = await import("../teams");

const OWNER = "owner-1";
const MEMBER = "member-1";
const OUTSIDER = "outsider-1";

beforeEach(() => {
  dbState.vaults = [
    { id: "vault-shared", user_id: OWNER, team_id: "team-1", deleted_at: null },
    { id: "vault-private", user_id: OWNER, team_id: null, deleted_at: null },
    { id: "vault-deleted", user_id: OWNER, team_id: "team-1", deleted_at: new Date() },
    { id: "vault-other-team", user_id: "owner-9", team_id: "team-9", deleted_at: null },
  ];
  dbState.teams = [
    { id: "team-1", ownerId: OWNER },
    { id: "team-9", ownerId: "owner-9" },
  ];
  dbState.members = [
    { id: "m-owner", teamId: "team-1", userId: OWNER, status: "active" },
    { id: "m-member", teamId: "team-1", userId: MEMBER, status: "active" },
    { id: "m-out", teamId: "team-9", userId: OUTSIDER, status: "active" },
  ];
});

describe("getAccessibleVault — shared-vault USE matrix", () => {
  it("owner can USE their shared vault", async () => {
    const v = await getAccessibleVault(OWNER, "vault-shared");
    expect(v?.id).toBe("vault-shared");
  });

  it("owner can USE their private (unshared) vault", async () => {
    const v = await getAccessibleVault(OWNER, "vault-private");
    expect(v?.id).toBe("vault-private");
  });

  it("active team member can USE a vault shared with their team", async () => {
    const v = await getAccessibleVault(MEMBER, "vault-shared");
    expect(v?.id).toBe("vault-shared");
  });

  it("team member CANNOT use an unshared vault they don't own", async () => {
    await expect(getAccessibleVault(MEMBER, "vault-private")).resolves.toBeNull();
  });

  it("member of a different team CANNOT use the vault", async () => {
    await expect(getAccessibleVault(OUTSIDER, "vault-shared")).resolves.toBeNull();
  });

  it("nonmember with no team CANNOT use a shared vault", async () => {
    await expect(getAccessibleVault("stranger-1", "vault-shared")).resolves.toBeNull();
  });

  it("soft-deleted vault is denied even to the owner", async () => {
    await expect(getAccessibleVault(OWNER, "vault-deleted")).resolves.toBeNull();
  });

  it("soft-deleted vault is denied to team members", async () => {
    await expect(getAccessibleVault(MEMBER, "vault-deleted")).resolves.toBeNull();
  });

  it("unknown vault id returns null", async () => {
    await expect(getAccessibleVault(OWNER, "vault-nope")).resolves.toBeNull();
  });
});
