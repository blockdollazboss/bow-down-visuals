/* app-downloads.ts — the ONE place the /app page's download facts live.
 *
 * Every version, size and checksum below was read from the artifact
 * itself — never from release titles or memory:
 *
 * ANDROID APK — served from GitHub Releases, the codebase's established
 * pattern for the app binary (pages/download.tsx links the same asset).
 * The asset at `android.url` is the signed build of Oct 13, 2026:
 *   - its AndroidManifest.xml reports versionName "1.0", versionCode 1,
 *     package com.bowdownvisuals.app;
 *   - the file is 73,726,268 bytes;
 *   - its SHA-256 (892c7322…) matches the digest the GitHub API reports
 *     for the release asset, byte for byte.
 * A NEWER signed build is banked at
 * ~/workspace/android-build/apk-out/app-release-20261020.apk
 * (Oct 20, 2026; same versionName "1.0"; 224,929,717 bytes; SHA-256
 * c41056f21bc8882b7a6ca0235679d023b700255a349c885dafc071751dfd3e9c),
 * but it is NOT the file the URL serves yet: uploads.github.com rejects
 * the stored GitHub API credential (401 Bad credentials, probed
 * 2026-10-24), so the upload has to happen through an authenticated
 * GitHub session. When it lands, flip `android.url`, `android.sizeBytes`
 * and `android.sha256` here — this config is the only place the /app
 * page reads them from, and app-downloads.test.ts pins the shapes.
 *
 * CHROME EXTENSION — served same-origin from public/, like the rest of
 * the site's static files. public/bow-down-visuals-extension-v2.zip is
 * byte-identical to the banked v2.0.2 zip (md5
 * 2462054bf45c8391fdf75ef9a5d7f478, verified 2026-10-24); the
 * manifest.json inside it reports version "2.0.2"; 84,903 bytes;
 * SHA-256 9887f56a… computed from the file itself.
 *
 * iPHONE / iPAD / DESKTOP — no binary exists and none is promised: the
 * site is an installable web app (public/manifest.json — standalone
 * display, maskable icons — plus the production service worker
 * registered in main.tsx), so those cards give the real install steps.
 */

export interface AppDownload {
  /** Where the button points. Cross-origin release asset or same-origin path. */
  url: string;
  /** Version exactly as the artifact's own metadata reports it. */
  version: string;
  /** Exact byte size of the served file. */
  sizeBytes: number;
  /** File name the visitor's browser saves. */
  fileName: string;
  /** SHA-256 of the served file, hex — for the verify-it-yourself line. */
  sha256: string;
}

export const APP_DOWNLOADS: { android: AppDownload; extension: AppDownload } = {
  android: {
    url: "https://github.com/blockdollazboss/bow-down-visuals/releases/download/v1.0.1-android/bow-down-visuals.apk",
    version: "1.0",
    sizeBytes: 73726268,
    fileName: "bow-down-visuals.apk",
    sha256: "892c73225d6729f0a5551be329c6c552e28ad0eef8762767ccb2111501923d01",
  },
  extension: {
    url: "/bow-down-visuals-extension-v2.zip",
    version: "2.0.2",
    sizeBytes: 84903,
    fileName: "bow-down-visuals-extension-v2.zip",
    sha256: "9887f56a8f3628448a994febbd7cc0892c83bc9ecf187131610a0a04cf26a504",
  },
};

/** Human size for a byte count: "70.3 MB", "83 KB", "512 B". */
export function formatDownloadSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
