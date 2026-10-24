/**
 * export-doctor-audit.test.ts — Stack-100 #3 Lane 4 deep-audit pins.
 *
 * Lane D verified the doctor's COST surface only (zero charges). This suite
 * pins the rest of the rail's corrected behaviour:
 *  - doctor sessions are owned: every handler resolves sessions through the
 *    ownership helpers, and session records carry the creator's userId;
 *  - one clip-download URL rule across the rail (static list OR public
 *    HTTPS), and the URL Doctor only passes reachable VIDEO responses;
 *  - download fan-out is bounded (clip cap + duplicate scene rejection);
 *  - timeline positioning uses timeline durations, not raw file durations;
 *  - lip-sync detection reads fields that actually exist on session clips;
 *  - overlay reporting covers every animated overlay the editor offers and
 *    never hardcodes "connected"/"preserved" success flags.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isPublicHttpsUrl,
  isAllowedClipDownloadUrl,
  clipUrlAllowed,
  timelineDurationOf,
  isLipSyncClip,
  getOwnedDoctorSession,
  getOwnedMultiSession,
  ANIMATED_OVERLAYS_UNSUPPORTED,
  MAX_DOCTOR_CLIPS,
} from "../generate/export-doctor";

const rail = readFileSync(
  path.resolve(process.cwd(), "src/routes/generate/export-doctor.ts"),
  "utf8",
);
const fe = readFileSync(
  path.resolve(
    process.cwd(),
    "../bow-down-visuals/src/components/editor/sections/ExportDoctor.tsx",
  ),
  "utf8",
);

describe("URL guards", () => {
  it("blocks private / loopback / metadata hosts", () => {
    for (const u of [
      "https://127.0.0.1/clip.mp4",
      "https://10.0.0.5/clip.mp4",
      "https://172.16.0.9/clip.mp4",
      "https://192.168.1.2/clip.mp4",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/clip.mp4",
      "https://metadata.google.internal/clip.mp4",
      "http://cdn.example.com/clip.mp4",
    ]) {
      expect(isPublicHttpsUrl(u), u).toBe(false);
      expect(isAllowedClipDownloadUrl(u), u).toBe(false);
    }
  });

  it("allows public HTTPS media hosts, including R2-style hosts the static list never had", () => {
    for (const u of [
      "https://media.example-cdn.com/clip.mp4",
      "https://abc123.r2.cloudflarestorage.com/clip.mp4",
      "https://d111.cloudfront.net/clip.mp4",
      "https://cdn.runwayml.com/clip.mp4",
    ]) {
      expect(isAllowedClipDownloadUrl(u), u).toBe(true);
    }
  });
});

describe("URL Doctor verdict", () => {
  const base = {
    reachable: true,
    allowedByStaticList: false,
    allowedByPublicHttps: true,
    isVideoContentType: true,
  };
  it("passes a reachable video response from a public host", () => {
    expect(clipUrlAllowed(base)).toBe(true);
  });
  it("fails a reachable HTML page (the old verdict passed it)", () => {
    expect(clipUrlAllowed({ ...base, isVideoContentType: false })).toBe(false);
  });
  it("fails unreachable and disallowed hosts", () => {
    expect(clipUrlAllowed({ ...base, reachable: false })).toBe(false);
    expect(
      clipUrlAllowed({
        ...base,
        allowedByPublicHttps: false,
        allowedByStaticList: false,
      }),
    ).toBe(false);
  });
  it("the check handler falls back to a range GET when HEAD is rejected", () => {
    expect(rail).toContain("r.status === 405 || r.status === 501");
    expect(rail).toContain("clipUrlAllowed({");
  });
});

describe("session ownership", () => {
  it("unknown sessions resolve to null for any user", () => {
    expect(getOwnedDoctorSession("nope", "user-1")).toBeNull();
    expect(getOwnedMultiSession("nope", "user-1")).toBeNull();
    expect(getOwnedDoctorSession(undefined, "user-1")).toBeNull();
    expect(getOwnedMultiSession(null, null)).toBeNull();
  });
  it("every session-consuming handler goes through the ownership helpers", () => {
    expect(rail).not.toContain("sessions.get(doctorId)");
    expect(rail).not.toContain("multiSessions.get(multiId)");
    const ownedCalls = rail.match(/getOwned(Multi)?Session\(/g) ?? [];
    // 2 definitions + 14 handler call sites (2 single + 12 multi).
    expect(ownedCalls.length).toBeGreaterThanOrEqual(16);
  });
  it("session records are stamped with the creator's userId", () => {
    expect(rail).toContain("userId: req.userId ?? \"\"");
  });
});

describe("download hardening", () => {
  it("caps clip fan-out", () => {
    expect(MAX_DOCTOR_CLIPS).toBe(100);
    expect(rail).toContain("clips.length > MAX_DOCTOR_CLIPS");
  });
  it("rejects duplicate scene numbers instead of overwriting clip files", () => {
    expect(rail).toContain("Duplicate scene number");
    expect(rail).toContain("seenSceneNumbers");
  });
  it("session folders are unique per session, not per millisecond", () => {
    expect(rail).toContain("export-doctor-${doctorId}-${Date.now()}");
    expect(rail).toContain("export-doctor-multi-${multiId}-${Date.now()}");
  });
  it("stores the client's sourceType on session clips", () => {
    expect(rail).toContain('sourceType: c.sourceType ?? "original"');
  });
});

describe("timeline durations", () => {
  it("prefers the timeline duration, falls back to raw", () => {
    expect(timelineDurationOf({ timelineDuration: 7.5, duration: 12 })).toBe(7.5);
    expect(timelineDurationOf({ timelineDuration: 0, duration: 12 })).toBe(12);
    expect(timelineDurationOf({ duration: 3 })).toBe(3);
    expect(timelineDurationOf({})).toBe(0);
  });
  it("no duration sum or xfade offset in the rail uses raw durations", () => {
    expect(rail).not.toContain("sum + (c.duration || 0)");
    expect(rail).toContain(
      "const durations = session.clips.map((c) => timelineDurationOf(c));",
    );
  });
});

describe("lip-sync detection reads real fields", () => {
  it("isLipSyncClip keys off sourceType / offset only", () => {
    expect(isLipSyncClip({ sourceType: "lip-sync", clipVideoOffsetSec: 0 })).toBe(true);
    expect(isLipSyncClip({ sourceType: "original", clipVideoOffsetSec: 0.4 })).toBe(true);
    expect(isLipSyncClip({ sourceType: "original", clipVideoOffsetSec: 0 })).toBe(false);
  });
  it("the rail never reads phantom lipSyncUrl/useLipSync fields off session clips", () => {
    expect(rail).not.toContain("as any).lipSyncUrl");
    expect(rail).not.toContain("as any).useLipSync");
    expect(rail).not.toContain("session.clips.slice(firstLipSyncIndex)");
  });
  it("fine-tune 'applied' requires a clip that actually received it", () => {
    expect(rail).toContain(
      "lipSyncOffsetInfo.some((c) => c.fineTuneOffsetSec !== 0)",
    );
  });
});

describe("overlay reporting", () => {
  it("covers every animated overlay the FE classifies as animated", () => {
    const m = fe.match(/const ANIMATED_OVERLAYS = \[([\s\S]*?)\];/);
    expect(m, "FE ANIMATED_OVERLAYS list").toBeTruthy();
    const feNames = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
    expect(feNames.length).toBeGreaterThanOrEqual(21);
    for (const name of feNames) {
      expect(ANIMATED_OVERLAYS_UNSUPPORTED, name).toContain(name);
    }
  });
  it("both overlay handlers use the shared list", () => {
    const uses = rail.match(/const ANIMATED = ANIMATED_OVERLAYS_UNSUPPORTED;/g) ?? [];
    expect(uses.length).toBe(2);
  });
  it("success flags are computed, never hardcoded", () => {
    expect(rail).not.toContain("overlayExportConnected: true");
    expect(rail).not.toContain("effectsPreserved: true");
    const computed = rail.match(/overlayExportConnected: watermarkIncluded/g) ?? [];
    expect(computed.length).toBe(2);
    const fxComputed = rail.match(/effectsPreserved: !!effectFilter/g) ?? [];
    expect(fxComputed.length).toBe(2);
  });
  it("the sync diagnostic never claims a video-only export passed", () => {
    expect(rail).not.toContain("videoOnlyExportPassed");
  });
});
