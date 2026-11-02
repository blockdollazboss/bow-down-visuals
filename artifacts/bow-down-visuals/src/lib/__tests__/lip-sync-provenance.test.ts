/**
 * Lip-sync recovery-path provenance (stack1200 — Z3 residual).
 *
 * Z3 (stack1100) fixed every serving path and the poll helper, but four
 * FE recovery paths in LipSyncSection still hardcoded
 * `lipSyncProvider: "sync.so"` as display provenance even when sync-3
 * never ran the job: saveResultToScene, useResultInPlayer, the
 * onSyncLabsJobAccepted callbacks, and the attachResult fallback.
 *
 * The rule these pins hold: a recovery stamp names the route that
 * actually ran — threaded from the job's own record (poll answer /
 * check-provider-job answer / previously recorded stamp) — and when
 * the route is genuinely unknowable the stamp is null. Never a guess,
 * never the premium route by default.
 *
 * Behavioural pins on the resolver + structural pins that the section
 * stamps through it (house precedent: provider-label-honesty.test.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeLipSyncProviderId,
  resolveLipSyncProvenance,
} from "../lip-sync-result-meta";

const section = readFileSync(
  new URL(
    "../../components/editor/sections/LipSyncSection.tsx",
    import.meta.url,
  ),
  "utf8",
);

describe("normalizeLipSyncProviderId — closed set, canonical ids", () => {
  it("the default route's ids canonicalize to latentsync", () => {
    expect(normalizeLipSyncProviderId("latentsync")).toBe("latentsync");
    expect(normalizeLipSyncProviderId("wavespeed")).toBe("latentsync");
    expect(normalizeLipSyncProviderId("Latent-Sync")).toBe("latentsync");
  });

  it("the premium route's ids canonicalize to sync — a genuine sync job still stamps truthfully", () => {
    expect(normalizeLipSyncProviderId("sync")).toBe("sync");
    expect(normalizeLipSyncProviderId("sync.so")).toBe("sync");
    expect(normalizeLipSyncProviderId(" Sync-Labs ")).toBe("sync");
  });

  it("unknown, empty and missing values are null — never passed through", () => {
    expect(normalizeLipSyncProviderId("some-future-engine")).toBeNull();
    expect(normalizeLipSyncProviderId("")).toBeNull();
    expect(normalizeLipSyncProviderId(null)).toBeNull();
    expect(normalizeLipSyncProviderId(undefined)).toBeNull();
  });
});

describe("resolveLipSyncProvenance — freshest evidence wins, unknown is null", () => {
  it("a job that ran on the default route never resolves to the premium route", () => {
    expect(resolveLipSyncProvenance("latentsync")).toBe("latentsync");
    expect(resolveLipSyncProvenance(null, "latentsync")).toBe("latentsync");
  });

  it("fresh check evidence beats a stale recorded stamp", () => {
    expect(resolveLipSyncProvenance("latentsync", "sync")).toBe("latentsync");
    expect(resolveLipSyncProvenance("sync", "latentsync")).toBe("sync");
  });

  it("a recorded stamp survives when no fresher evidence exists", () => {
    expect(resolveLipSyncProvenance(undefined, "sync")).toBe("sync");
    expect(resolveLipSyncProvenance(null, "sync.so")).toBe("sync");
  });

  it("genuinely unknowable provenance resolves to null, not a guessed provider", () => {
    expect(resolveLipSyncProvenance()).toBeNull();
    expect(resolveLipSyncProvenance(null, null)).toBeNull();
    expect(resolveLipSyncProvenance(undefined, "")).toBeNull();
    expect(resolveLipSyncProvenance("unrecorded-engine", null)).toBeNull();
  });
});

describe("LipSyncSection recovery stamps (structural pins)", () => {
  it("no lipSyncProvider stamp anywhere in the section is a string literal", () => {
    const literalStamps = section.match(/lipSyncProvider:\s*"/g) ?? [];
    expect(literalStamps).toHaveLength(0);
    expect(section).not.toContain('?? "sync.so"');
  });

  it("the poll helper hands the accepted callback the job's own recorded route", () => {
    expect(section).toMatch(
      /onSyncLabsJobAccepted\?\.\(job\.syncLabsJobId, resolveLipSyncProvenance\(job\.provider\)\)/,
    );
  });

  it("both job-accepted callbacks (single + run-all) stamp the threaded provider", () => {
    expect(
      section.match(/lipSyncProvider: provider \}/g) ?? [],
    ).toHaveLength(2);
  });

  it("save/use recovery handlers resolve checked evidence before the recorded stamp", () => {
    const handlerStamps =
      section.match(
        /resolveLipSyncProvenance\(checkedProvider, selectedClipEdit\?\.lipSyncProvider\)/g,
      ) ?? [];
    expect(handlerStamps).toHaveLength(2);
  });

  it("the check-job flow captures the server-reported route and passes it to both handlers", () => {
    expect(section).toMatch(/provider:\s+data\.provider \?\? null/);
    expect(section).toContain("useResultInPlayer(cjr.jobId, cjr.outputUrl!, cjr.provider)");
    expect(section).toContain("saveResultToScene(cjr.jobId, cjr.outputUrl!, cjr.provider)");
  });

  it("attachResult preserves the recorded stamp through the resolver — no fallback fabrication", () => {
    expect(section).toContain(
      "lipSyncProvider:       resolveLipSyncProvenance(ce?.lipSyncProvider)",
    );
  });
});
