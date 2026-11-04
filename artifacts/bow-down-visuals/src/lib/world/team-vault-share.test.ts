import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  VAULTS_PATH,
  buildVaultSharePayload,
  parseOwnVaults,
  parseVaultShareResult,
  vaultSharePath,
  type TeamVaultRow,
} from "./team-desk";
import { getCreditCost } from "../credit-costs";

/* ─── Team vault share seam (stack100 wave 5, item 28) ─────────────
   The TeamDesk's share/unshare toggle rides the vault's own rail —
   POST /api/artist-vaults/:id/share — with the 2D Creator Vault
   page's exact semantics. These tests pin: the paths are the
   route's own endpoints (read from the route file), the body is
   the page's body field-for-field, the rail answers { ok, teamId }
   and never charges, sharing is free in the registry, the list
   parser keeps only rows the caller OWNs (the rail is owner-only),
   the result parser is strict (a broken answer is a failed read,
   never a guessed state), and the retired "do it on the website"
   note is gone from the seam. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const ME = "user-me";

function vaultRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "vault-1",
    user_id: ME,
    artist_name: "King Solo",
    team_id: null,
    ...over,
  };
}

describe("rails + price", () => {
  it("the paths are the artist-vaults route's own endpoints", () => {
    const routes = read("../../../../api-server/src/routes/artist-vaults.ts");
    expect(routes).toContain('router.get("/artist-vaults"');
    expect(routes).toContain('router.post("/artist-vaults/:id/share"');
    expect(VAULTS_PATH).toBe("/api/artist-vaults");
    expect(vaultSharePath("vault-1")).toBe("/api/artist-vaults/vault-1/share");
  });

  it("sharing is free — no registry row prices the share rail", () => {
    expect(getCreditCost("/api/artist-vaults/:id/share")).toBeNull();
    expect(getCreditCost(vaultSharePath("vault-1"))).toBeNull();
    // The registry's artist-vaults rows are other actions entirely.
    expect(getCreditCost("/api/artist-vaults/:id/voice/clone")?.cost).toBe(200);
    expect(getCreditCost("/api/artist-vaults/:id/identity-photos")?.cost).toBe(0);
  });

  it("the rail never charges for sharing", () => {
    const routes = read("../../../../api-server/src/routes/artist-vaults.ts");
    const start = routes.indexOf('router.post("/artist-vaults/:id/share"');
    expect(start).toBeGreaterThan(-1);
    const handler = routes.slice(start, routes.indexOf("/** Start a seamless-loop", start));
    expect(handler).not.toMatch(/charge/i);
    expect(handler).not.toMatch(/credits/i);
  });
});

describe("the 2D page's exact semantics", () => {
  it("the rail reads share === true strictly and answers { ok, teamId }", () => {
    const routes = read("../../../../api-server/src/routes/artist-vaults.ts");
    expect(routes).toContain("req.body?.share === true");
    expect(routes).toContain("res.json({ ok: true, teamId: activeTeam.team.id })");
    expect(routes).toContain("res.json({ ok: true, teamId: null })");
    // Sharing without a team is the rail's own 400 sentence.
    expect(routes).toContain('"Join a team first to share this vault."');
    // Owner-only: the rail looks the vault up scoped to the caller.
    expect(routes).toContain("eq(artistVaultsTable.user_id, req.userId!)");
  });

  it("the body builder is the page's body, field-for-field", () => {
    const page = read("../../pages/artist-vault.tsx");
    // The page posts JSON.stringify({ share: sharing }) to the share
    // path — the seam's builder produces exactly that body.
    expect(page).toContain("/share`,");
    expect(page).toContain("body: JSON.stringify({ share: sharing })");
    expect(buildVaultSharePayload(true)).toEqual({ share: true });
    expect(buildVaultSharePayload(false)).toEqual({ share: false });
    expect(Object.keys(buildVaultSharePayload(true))).toEqual(["share"]);
  });

  it("the page flips on team_id presence; the seam's shared flag is the same read", () => {
    const page = read("../../pages/artist-vault.tsx");
    expect(page).toContain("const sharing = !vault.team_id;");
    const rows = parseOwnVaults(
      { vaults: [vaultRow({ team_id: "team-9" }), vaultRow({ id: "vault-2" })] },
      ME,
    );
    expect(rows?.map((r) => r.shared)).toEqual([true, false]);
  });
});

describe("parseOwnVaults — only the caller's own vaults", () => {
  it("keeps own rows, drops teammates' rows (shared or not)", () => {
    const rows = parseOwnVaults(
      {
        vaults: [
          vaultRow(),
          vaultRow({ id: "vault-2", artist_name: "Duo Partner", team_id: "team-9" }),
          vaultRow({ id: "vault-3", user_id: "user-teammate", team_id: "team-9" }),
          vaultRow({ id: "vault-4", user_id: "user-teammate", team_id: null }),
        ],
      },
      ME,
    );
    expect(rows).toEqual<TeamVaultRow[]>([
      { id: "vault-1", name: "King Solo", teamId: null, shared: false },
      { id: "vault-2", name: "Duo Partner", teamId: "team-9", shared: true },
    ]);
  });

  it("reads camelCase rows too, and preserves server order", () => {
    const rows = parseOwnVaults(
      {
        vaults: [
          { id: "b", userId: ME, artistName: "Second", teamId: "team-1" },
          { id: "a", userId: ME, artistName: "First", teamId: null },
        ],
      },
      ME,
    );
    expect(rows?.map((r) => r.id)).toEqual(["b", "a"]);
    expect(rows?.[0]).toMatchObject({ teamId: "team-1", shared: true });
  });

  it("with no current user id, no row can be proven own", () => {
    expect(parseOwnVaults({ vaults: [vaultRow()] }, null)).toEqual([]);
    expect(parseOwnVaults({ vaults: [vaultRow()] }, undefined)).toEqual([]);
    expect(parseOwnVaults({ vaults: [vaultRow()] }, "")).toEqual([]);
  });

  it("an empty-string team_id is private, and a nameless vault gets the house fallback", () => {
    const rows = parseOwnVaults(
      { vaults: [vaultRow({ team_id: "" }), vaultRow({ id: "v2", artist_name: "   " })] },
      ME,
    );
    expect(rows?.[0]).toMatchObject({ teamId: null, shared: false });
    expect(rows?.[1]?.name).toBe("Untitled character");
  });

  it("rows without an id are skipped; a broken envelope is a failed read", () => {
    expect(
      parseOwnVaults({ vaults: [vaultRow({ id: "" }), vaultRow({ id: "ok" })] }, ME)?.map(
        (r) => r.id,
      ),
    ).toEqual(["ok"]);
    expect(parseOwnVaults(null, ME)).toBeNull();
    expect(parseOwnVaults([], ME)).toBeNull();
    expect(parseOwnVaults({}, ME)).toBeNull();
    expect(parseOwnVaults({ vaults: "nope" }, ME)).toBeNull();
    expect(parseOwnVaults({ vaults: [] }, ME)).toEqual([]);
  });
});

describe("parseVaultShareResult — the answer is the state", () => {
  it("maps the rail's answers field-for-field", () => {
    expect(parseVaultShareResult({ ok: true, teamId: "team-9" })).toEqual({
      teamId: "team-9",
    });
    expect(parseVaultShareResult({ ok: true, teamId: null })).toEqual({
      teamId: null,
    });
  });

  it("anything else is a failed read, never a guessed state", () => {
    expect(parseVaultShareResult(null)).toBeNull();
    expect(parseVaultShareResult("ok")).toBeNull();
    expect(parseVaultShareResult({})).toBeNull();
    expect(parseVaultShareResult({ ok: false, teamId: null })).toBeNull();
    expect(parseVaultShareResult({ ok: true })).toBeNull();
    expect(parseVaultShareResult({ ok: true, teamId: 42 })).toBeNull();
    expect(parseVaultShareResult({ ok: true, teamId: undefined })).toBeNull();
  });
});

describe("the retired note", () => {
  it("the seam no longer carries the website note", () => {
    const seam = read("./team-desk.ts");
    expect(seam).not.toContain("TEAM_SHARED_VAULTS_NOTE");
    expect(seam).not.toContain(
      "mark any artist vault as shared from the Creator Vault page",
    );
  });
});
