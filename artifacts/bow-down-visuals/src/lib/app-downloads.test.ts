/**
 * app-downloads.test.ts — the /app page's download facts stay honest.
 *
 * The config is the single source the page renders from; these pins
 * keep its shape (absolute release URL for the APK, same-origin path
 * for the extension, plausible versions, real byte counts, full-length
 * hex checksums) from drifting into invented numbers. The values were
 * verified against the artifacts on 2026-10-24 — see the provenance
 * comment in app-downloads.ts before changing any of them.
 */
import { describe, expect, it } from "vitest";
import { APP_DOWNLOADS, formatDownloadSize } from "./app-downloads";

describe("app-downloads config", () => {
  it("android points at the GitHub Releases asset (the codebase's APK pattern)", () => {
    expect(APP_DOWNLOADS.android.url).toMatch(
      /^https:\/\/github\.com\/blockdollazboss\/bow-down-visuals\/releases\/download\//,
    );
    expect(APP_DOWNLOADS.android.url.endsWith(".apk")).toBe(true);
    expect(APP_DOWNLOADS.android.fileName.endsWith(".apk")).toBe(true);
  });

  it("extension is served same-origin from public/", () => {
    expect(APP_DOWNLOADS.extension.url.startsWith("/")).toBe(true);
    expect(APP_DOWNLOADS.extension.url.endsWith(".zip")).toBe(true);
    expect(APP_DOWNLOADS.extension.fileName.endsWith(".zip")).toBe(true);
  });

  it("versions and sizes are the artifacts' own (verified 2026-10-24)", () => {
    // APK: AndroidManifest.xml versionName of the served signed build.
    expect(APP_DOWNLOADS.android.version).toBe("1.0");
    expect(APP_DOWNLOADS.android.sizeBytes).toBe(73726268);
    // Extension: manifest.json version inside the served zip.
    expect(APP_DOWNLOADS.extension.version).toBe("2.0.2");
    expect(APP_DOWNLOADS.extension.sizeBytes).toBe(84903);
  });

  it("checksums are full-length lowercase hex SHA-256", () => {
    for (const d of [APP_DOWNLOADS.android, APP_DOWNLOADS.extension]) {
      expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // The APK digest also matches what the GitHub API reports for the asset.
    expect(APP_DOWNLOADS.android.sha256).toBe(
      "892c73225d6729f0a5551be329c6c552e28ad0eef8762767ccb2111501923d01",
    );
  });

  it("formatDownloadSize renders honest human sizes", () => {
    expect(formatDownloadSize(73726268)).toBe("70.3 MB");
    expect(formatDownloadSize(84903)).toBe("83 KB");
    expect(formatDownloadSize(512)).toBe("512 B");
    expect(formatDownloadSize(-1)).toBe("");
    expect(formatDownloadSize(Number.NaN)).toBe("");
  });
});
