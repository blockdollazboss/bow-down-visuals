/**
 * export-job-poll.test.ts — payfix lane 6, rungs 2–3 (client half).
 *
 * Pins the poll contract the dialog relies on: charge/reserve info is
 * surfaced via onCharge, a server "cancelled" status and a local abort
 * both reject with code "cancelled" (never a fake failure), a done job
 * resolves with its result, and cancelExportJob posts to the cancel
 * endpoint.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  pollExportJob,
  cancelExportJob,
  ExportJobCancelledError,
  isExportCancelledError,
  type ExportChargeInfo,
} from "./export-job-poll";

const token = async () => "tok";

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CHARGE: ExportChargeInfo = {
  branded: false,
  cost: 400,
  reservedAmount: 400,
  chargedAmount: 0,
  chargeState: "reserved",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pollExportJob — charge visibility + cancel", () => {
  it("surfaces charge/reserve info via onCharge and resolves on done", async () => {
    const charges: ExportChargeInfo[] = [];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonRes({ status: "active", stage: "Stitching…", progress: 40, charge: CHARGE }))
        .mockResolvedValueOnce(
          jsonRes({
            status: "done",
            charge: { ...CHARGE, reservedAmount: 0, chargedAmount: 400, chargeState: "settled" },
            result: { url: "https://cdn.example/out.mp4" },
          }),
        ),
    );
    const result = await pollExportJob({
      jobId: "job-1",
      getAccessToken: token,
      pollMs: 1,
      onCharge: (c) => charges.push(c),
    });
    expect(result.url).toBe("https://cdn.example/out.mp4");
    expect(charges).toHaveLength(2);
    expect(charges[0]).toMatchObject({ reservedAmount: 400, chargedAmount: 0 });
    expect(charges[1]).toMatchObject({ reservedAmount: 0, chargedAmount: 400 });
  });

  it("a server cancelled status rejects as cancelled, not as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonRes({ status: "cancelled", charge: { ...CHARGE, reservedAmount: 0, chargeState: "released" } })),
    );
    await expect(pollExportJob({ jobId: "job-1", getAccessToken: token, pollMs: 1 })).rejects.toMatchObject({
      code: "cancelled",
    });
  });

  it("aborting the signal rejects as cancelled (mid-job Cancel control)", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({ status: "active", stage: "Stitching…", progress: 10 })));
    const pending = pollExportJob({ jobId: "job-1", getAccessToken: token, pollMs: 5, signal: controller.signal });
    controller.abort();
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExportJobCancelledError);
    expect(isExportCancelledError(err)).toBe(true);
  });
});

describe("cancelExportJob — POST the cancel endpoint", () => {
  it("posts to /api/export-video-job/:jobId/cancel with auth and returns charge info", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonRes({ status: "cancelled", charge: { ...CHARGE, reservedAmount: 0, chargeState: "released" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await cancelExportJob({ jobId: "job 9", getAccessToken: token });
    expect(out.status).toBe("cancelled");
    expect(out.charge?.chargeState).toBe("released");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/export-video-job/job%209/cancel");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
  });
});
