import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Dependency security pins (Stack 400 census C, items C-18…C-23).
 *
 * The daily dependency audit scored the WRONG lockfile for weeks (census
 * C-31): it read the stale main worktree and reported the dompurify
 * critical as open against a branch where it was already fixed — while
 * genuinely open patch bumps sat misstated in the same report. These pins
 * hold the shipped tree's security floor in the committed files
 * themselves, so a silent downgrade of any of these packages fails the
 * suite instead of shipping.
 *
 * C-18 is a verification, not a bump: dompurify enters only as jspdf's
 * optionalDependency, the workspace override pins 3.4.17, and the
 * committed lockfile resolves exactly that (3.4.17 clears all 5 audit
 * advisories, incl. critical GHSA-cg2g-xh64-v4q7). The vulnerable 3.4.13
 * existed only in the stale worktree install. Full record:
 * docs/dependency-decisions.md (which also records the C-24 exclusions —
 * glob / minimatch / @simplewebauthn/server — whose only fixes are
 * breaking majors, deliberately not taken here).
 */
const workspaceYaml = readFileSync(
  new URL("../../../../../pnpm-workspace.yaml", import.meta.url),
  "utf8",
);
const lockfile = readFileSync(
  new URL("../../../../../pnpm-lock.yaml", import.meta.url),
  "utf8",
);
const fePackageJson = readFileSync(
  new URL("../../../package.json", import.meta.url),
  "utf8",
);
const apiPackageJson = readFileSync(
  new URL("../../../../api-server/package.json", import.meta.url),
  "utf8",
);

describe("dependency security pins (census C-18…C-23)", () => {
  it("C-18: dompurify stays pinned to the advisory-clearing 3.4.17", () => {
    expect(workspaceYaml).toContain("dompurify: 3.4.17");
    expect(lockfile).toContain("dompurify@3.4.17:");
    // The vulnerable line the stale-basis audit kept reporting.
    expect(lockfile).not.toContain("dompurify@3.4.13");
  });

  it("C-19: fast-uri override is raised to 3.1.9 and resolves there", () => {
    expect(workspaceYaml).toContain("fast-uri: 3.1.9");
    expect(lockfile).toContain("fast-uri@3.1.9:");
    expect(lockfile).not.toContain("fast-uri@3.1.7");
  });

  it("C-20: the vitest family is pinned at 5.0.3 in both artifacts", () => {
    expect(fePackageJson).toContain('"vitest": "5.0.3"');
    expect(apiPackageJson).toContain('"vitest": "5.0.3"');
    expect(lockfile).toContain("vitest@5.0.3");
    expect(lockfile).toContain("'@vitest/mocker@5.0.3'");
    expect(lockfile).not.toContain("vitest@5.0.1");
    expect(lockfile).not.toContain("@vitest/mocker@5.0.1");
  });

  it("C-21: ip-address override pins 10.7.4 and resolves there", () => {
    expect(workspaceYaml).toContain("ip-address: 10.7.4");
    expect(lockfile).toContain("ip-address@10.7.4:");
    expect(lockfile).not.toContain("ip-address@10.7.2");
  });

  it("C-22: postcss-selector-parser override pins 6.1.5 and resolves there", () => {
    expect(workspaceYaml).toContain("postcss-selector-parser: 6.1.5");
    expect(lockfile).toContain("postcss-selector-parser@6.1.5:");
    expect(lockfile).not.toContain("postcss-selector-parser@6.0.10");
  });

  it("C-23: qs override is raised to 6.16.1 and resolves there", () => {
    expect(workspaceYaml).toContain("qs: 6.16.1");
    expect(lockfile).toContain("qs@6.16.1:");
    expect(lockfile).not.toContain("qs@6.16.0");
  });
});
