/**
 * CSP pin for the Go Live kit's engine assets (Stack-100 #3 Lane C).
 *
 * The kit's background engines load BUCKET-FIRST from the site's
 * own media bucket (the frontend's MEDIA_CDN_URL, lib/media-cdn.ts):
 * the MediaPipe + RVM runtime scripts via script tags and worker
 * importScripts, and the ORT WASM + RVM model via fetch inside the
 * engine worker. The app CSP named jsdelivr for those engines but
 * never the bucket, so in production every bucket hop was refused
 * (script-src governs the script loads, connect-src the fetches)
 * and only the same-origin fallback copies ever served — the
 * bucket-first chain was dead on arrival. These pins keep the
 * bucket origin in both directives. Source contract, matching the
 * suite's readFileSync pin pattern: app.ts is the one place the
 * header is built.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/* The media bucket's public origin — the same literal the
   frontend's media-cdn.ts builds every engine URL from. */
const MEDIA_BUCKET_ORIGIN = "https://pub-424304b1e8d24fa28e3a072be022c74b.r2.dev";

const appSrc = readFileSync(new URL("../../app.ts", import.meta.url), "utf8");

function directive(name: string): string {
  /* The MAIN policy's line — identified by the jsdelivr allowance
     the embed policy never carries (the embed branch is written
     first in the ternary, so a bare first-match would land there). */
  const line = appSrc
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(`"${name} `) && l.includes("cdn.jsdelivr.net"));
  expect(line, `main CSP directive ${name} present in app.ts`).toBeTruthy();
  return line!;
}

describe("app CSP — the kit's engine bucket is reachable", () => {
  it("script-src allows the media bucket (engine scripts + worker importScripts)", () => {
    expect(directive("script-src")).toContain(MEDIA_BUCKET_ORIGIN);
  });

  it("connect-src allows the media bucket (ORT WASM + model fetches inside the worker)", () => {
    expect(directive("connect-src")).toContain(MEDIA_BUCKET_ORIGIN);
  });

  it("the bucket appears exactly twice — both directives of the main policy, never the embed policy", () => {
    const occurrences = appSrc.split(MEDIA_BUCKET_ORIGIN).length - 1;
    expect(occurrences).toBe(2);
  });
});
