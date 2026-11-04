import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* ─── TeamDesk vault-share component contracts (stack100 wave 5,
   item 28) ────────────────────────────────────────────────────────
   Source-level pins for the shared-vaults card: the toggle rides
   the seam end to end (paths/builder/parsers never hand-typed),
   the row's new state comes from the rail's answer and only after
   the call lands (no optimistic flip — a failure leaves the row
   untouched and surfaces through the desk's error line), the
   toggle is a pressed-state button, the failed vault read is its
   own card with a retry, the share never rides the charged rail,
   and the retired "do it on the website" note is gone. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const desk = read("../../components/world/native/TeamDesk.tsx");

const handlerStart = desk.indexOf("async function handleVaultShare");
const handler = desk.slice(handlerStart, desk.indexOf("async function handleCreate", handlerStart));

describe("the toggle rides the seam", () => {
  it("imports the vault paths, builder and parsers from the seam", () => {
    for (const name of [
      "VAULTS_PATH",
      "vaultSharePath",
      "buildVaultSharePayload",
      "parseOwnVaults",
      "parseVaultShareResult",
    ]) {
      expect(desk, name).toContain(name);
    }
  });

  it("never hand-types a vault path inline", () => {
    expect(desk).not.toMatch(/["'`]\/api\/artist-vaults/);
  });

  it("loads the caller's vaults through the seam parser with their identity", () => {
    expect(desk).toContain("parseOwnVaults(await api(VAULTS_PATH), user?.id ?? null)");
    expect(desk).toContain("loadVaults");
  });
});

describe("the toggle itself", () => {
  it("is a pressed-state button carrying the shared truth", () => {
    expect(desk).toContain('data-testid="world-team-vaults"');
    expect(desk).toContain('data-testid="world-team-vault-share-toggle"');
    expect(desk).toContain("aria-pressed={vault.shared}");
    expect(desk).toContain('vault.shared ? "Unshare" : "Share"');
  });

  it("flips on the row's current sharing state, exactly like the page", () => {
    expect(handler).toContain("const sharing = !vault.shared;");
    expect(handler).toContain("buildVaultSharePayload(sharing)");
    expect(handler).toContain('method: "POST"');
  });

  it("the row's new state comes from the rail's answer — after the call, never before", () => {
    const callAt = handler.indexOf("await api(vaultSharePath(vault.id)");
    const parseAt = handler.indexOf("parseVaultShareResult(data)");
    const paintAt = handler.indexOf("setVaults");
    expect(callAt).toBeGreaterThan(-1);
    expect(parseAt).toBeGreaterThan(callAt);
    expect(paintAt).toBeGreaterThan(parseAt);
    expect(handler).toContain("teamId: result.teamId");
    expect(handler).toContain("shared: result.teamId !== null");
    // A broken answer throws before any paint: state stays as it was.
    expect(handler).toContain('if (!result) throw new Error("share shape")');
    expect(handler.indexOf('throw new Error("share shape")')).toBeLessThan(paintAt);
  });

  it("the share never rides the charged rail — it is free", () => {
    expect(handler).not.toContain("confirmedFetch");
    expect(handler).not.toContain("overrideCost");
    expect(desk).toContain("Sharing is free and takes effect at once");
  });
});

describe("honest states", () => {
  it("a failed vault read is its own card with a retry, never a dressed-up empty list", () => {
    expect(desk).toContain('data-testid="world-team-vaults-error"');
    expect(desk).toContain("Your vaults couldn&rsquo;t load");
    expect(desk).toContain("onClick={() => void loadVaults()}");
  });

  it("the empty state is honest about owning no vaults", () => {
    expect(desk).toContain("You don&rsquo;t own any artist vaults yet");
  });
});

describe("the retired note", () => {
  it("the website note is gone from the desk", () => {
    expect(desk).not.toContain("TEAM_SHARED_VAULTS_NOTE");
    expect(desk).not.toContain("mark any artist vault as shared");
    expect(desk).not.toContain("from the Creator Vault page");
  });
});
