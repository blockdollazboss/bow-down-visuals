# Dependency Decisions — Accepted Majors & Security Pins

**Date:** 2026-11-08
**Branch:** stack1600/s400-deps
**Source:** Stack 400 census C, section D (C-18…C-24), verified against the
committed `pnpm-lock.yaml` on join14 (`44426f660`).

## Why this file exists

The daily dependency audit scored the **wrong lockfile** for weeks (census
C-31): it read the stale main worktree, so it reported already-fixed
advisories as open and misstated the ones that were genuinely open. Every
version below was re-derived from the shipped branch's committed lockfile.
This file is the in-repo record of the decisions that came out of that
re-check, so no item is silently re-laned or silently dropped.

## C-24 — Excluded by the safe-only rule: fixes that exist ONLY as majors

Patch waves take patches and same-major minors only. The three advisories
below have **no** fix inside their current major line. They are accepted
as known, named residuals until a planned major-upgrade lane takes them —
they are NOT oversights and must not be re-laned as patch items.

| Package | Resolved (join14 lockfile) | Advisory | Only fix | Exposure | Decision |
|---|---|---|---|---|---|
| `glob` | 13.0.6 | GHSA-3g3m-2fjr-6pw4 (moderate) | 14.0.2 (major) | build/test chain only | accepted until a planned major |
| `minimatch` | 10.2.6 | GHSA-g3hv-75wg-m249 (moderate) | 11.0.1 (major) | build/test chain only | accepted until a planned major |
| `@simplewebauthn/server` | 12.0.0 | GHSA-6hxq-p678-4hr2 (low) | 13.3.2 (major) | passkey server library (production) | **own post-launch item:** evaluate the 13.x upgrade as a dedicated lane after launch — a passkey-library major is never a patch-wave passenger |

## C-18 — dompurify: verified, not bumped

The audit's one critical (GHSA-cg2g-xh64-v4q7) was a wrong-lockfile ghost.
Proof from the shipped branch's own files, re-verified on this lane:

- `pnpm-workspace.yaml` override pins `dompurify: 3.4.17`.
- The committed `pnpm-lock.yaml` resolves `dompurify@3.4.17` (packages +
  snapshots); no `dompurify@3.4.13` (the vulnerable line) exists in it.
- A frozen install from that lockfile places exactly one dompurify in the
  tree — `dompurify@3.4.17`, linked under `jspdf` (its only consumer path;
  nothing in `artifacts` or `lib` imports DOMPurify directly) — and its
  `package.json` reads version 3.4.17. 3.4.17 clears all 5 audit advisories
  for this package.
- The pins are held by `dependency-security-pins.test.ts` (FE suite) so a
  silent downgrade fails certification instead of shipping.

## Applied in this lane (C-19…C-23) — for the record

Mechanism matched per package to the repo's own habit: exact-version
overrides in `pnpm-workspace.yaml` for transitive packages, a direct
devDependency bump for the vitest family.

| Item | Package | Before | After | Mechanism |
|---|---|---|---|---|
| C-19 | `fast-uri` | 3.1.7 | 3.1.9 | override pin raised |
| C-20 | `vitest` family (`vitest`, `@vitest/mocker`, `@vitest/spy`) | 5.0.1 | 5.0.3 | direct devDep pinned `5.0.3` in both artifacts |
| C-21 | `ip-address` | 10.7.2 | 10.7.4 | override pin added |
| C-22 | `postcss-selector-parser` | 6.0.10 | 6.1.5 | override pin added (same 6.x line) |
| C-23 | `qs` | 6.16.0 | 6.16.1 | override pin raised |

Family side-effects of the C-20 bump, inside vitest's own dependency set
(dev/test-only): `why-is-node-running` 2.3.0 → 3.2.1, and its former deps
`siginfo@2.0.0` / `stackback@0.0.2` drop out of the tree.
